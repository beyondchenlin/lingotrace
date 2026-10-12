import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INPUT_OBSERVATION_VERSION, MAX_OBSERVATION_GAP_MS, InputObservationClock,
  isInputObservationEvidence, type InputObservationEvidence,
} from './input-observation';

const idle = { blockedReasons: [], activity: false } as const;
const committed = { blockedReasons: [], activity: true } as const;

test('starts only on unblocked committed input, with no remembered blocked activity', () => {
  const clock = new InputObservationClock('run-one');
  assert.equal(clock.isObserving, false);
  assert.equal(clock.needsHeartbeat(), false);
  assert.equal(clock.step(0, idle), null);
  assert.equal(clock.step(100, { blockedReasons: ['background'], activity: true }), null);
  assert.equal(clock.step(200, idle), null);
  assert.equal(clock.step(300, { ...idle, forceBoundary: true }), null);
  assert.deepEqual(clock.step(400, committed), {
    version: INPUT_OBSERVATION_VERSION, runId: 'run-one', segment: 1, atMs: 400,
    state: 'observing', reasons: [], restartReason: 'start',
  });
  assert.equal(clock.isObserving, true);
  assert.equal(clock.needsHeartbeat(), true);
});

test('composition alone preserves observation and heartbeats without storing candidates', () => {
  const clock = new InputObservationClock('composition-run');
  assert.equal(clock.step(0, { blockedReasons: ['composition'], activity: false }), null);
  clock.step(100, committed);
  for (let atMs = 1100; atMs <= 10100; atMs += 1000) {
    const evidence = clock.step(atMs, { blockedReasons: ['composition'], activity: false })!;
    assert.equal(evidence.segment, 1);
    assert.equal(evidence.state, 'observing');
    assert.equal(evidence.restartReason, null);
    assert.deepEqual(evidence.reasons, []);
    assert.equal(clock.needsHeartbeat(), true);
  }
  const end = clock.step(10100, committed)!;
  assert.equal(end.segment, 1);
  assert.deepEqual(Object.keys(end).sort(), ['atMs', 'reasons', 'restartReason', 'runId', 'segment', 'state', 'version']);
});

test('each practice or foreground blocker suspends until the last blocker clears', () => {
  for (const reason of ['idle', 'paused', 'listening', 'background', 'modal', 'checking', 'review', 'unfocused']) {
    const clock = new InputObservationClock(`blocked-${reason}`);
    clock.step(0, committed);
    const blocked = clock.step(1000, { blockedReasons: ['composition', reason], activity: false })!;
    assert.equal(blocked.state, 'suspended');
    assert.equal(blocked.segment, 1);
    assert.deepEqual(blocked.reasons, [reason]);
    assert.equal(clock.needsHeartbeat(), false);
    const overlap = clock.step(2000, { blockedReasons: [reason, 'modal'], activity: false })!;
    assert.equal(overlap.segment, 1);
    assert.equal(overlap.state, 'suspended');
    const stillBlocked = clock.step(20000, { blockedReasons: [reason], activity: false })!;
    assert.equal(stillBlocked.segment, 1);
    assert.equal(stillBlocked.restartReason, null);
    const resumed = clock.step(21000, idle)!;
    assert.equal(resumed.state, 'observing');
    assert.equal(resumed.segment, 2);
    assert.equal(resumed.restartReason, 'resume');
    assert.equal(clock.isObserving, true);
  }
});

test('same-time actual events preserve a segment; explicit suspension and resume still divide it', () => {
  const clock = new InputObservationClock('same-time');
  clock.step(100, committed);
  for (let i = 0; i < 4; i += 1) {
    const evidence = clock.step(100, committed)!;
    assert.equal(evidence.segment, 1);
    assert.equal(evidence.restartReason, null);
  }
  assert.equal(clock.step(100, { blockedReasons: ['paused'], activity: false })!.segment, 1);
  assert.equal(clock.step(100, idle)!.segment, 2);
});

test('the observation gap threshold is inclusive, and missed coverage starts a fresh segment', () => {
  const clock = new InputObservationClock('gap-run');
  clock.step(0, committed);
  const exact = clock.step(MAX_OBSERVATION_GAP_MS, idle)!;
  assert.equal(exact.segment, 1);
  assert.equal(exact.restartReason, null);
  const gap = clock.step(MAX_OBSERVATION_GAP_MS * 2 + 1, idle)!;
  assert.equal(gap.segment, 2);
  assert.equal(gap.restartReason, 'unobserved');
  assert.equal(gap.state, 'observing');
  assert.equal(clock.step(gap.atMs + 1000, idle)!.segment, 2);
});

test('a late blocked boundary also marks missing coverage before suspension', () => {
  const clock = new InputObservationClock('late-blocker');
  clock.step(0, committed);
  const blocked = clock.step(10000, { blockedReasons: ['background'], activity: false })!;
  assert.equal(blocked.state, 'suspended');
  assert.equal(blocked.segment, 2);
  assert.equal(blocked.restartReason, 'unobserved');
  const resumed = clock.step(20000, idle)!;
  assert.equal(resumed.segment, 3);
  assert.equal(resumed.restartReason, 'resume');
});

test('backward timestamps and explicit boundaries reset segments without manufacturing elapsed time', () => {
  const clock = new InputObservationClock('reset-run');
  clock.step(1000, committed);
  clock.step(2000, idle);
  const reset = clock.step(500, idle)!;
  assert.equal(reset.segment, 2);
  assert.equal(reset.restartReason, 'clock-reset');
  assert.equal(reset.atMs, 500);
  const explicit = clock.step(500, { ...idle, forceBoundary: true })!;
  assert.equal(explicit.segment, 3);
  assert.equal(explicit.restartReason, 'explicit');
  assert.equal(clock.step(1500, idle)!.segment, 3);
  assert.equal('elapsedMs' in explicit, false);
  assert.equal('activeMs' in explicit, false);
});

test('instances have independent startup and run identities even after previously observed input', () => {
  const first = new InputObservationClock('first');
  first.step(100, committed);
  const second = new InputObservationClock('second');
  assert.equal(second.step(10000, idle), null);
  assert.equal(second.needsHeartbeat(), false);
  const evidence = second.step(10100, committed)!;
  assert.equal(evidence.runId, 'second');
  assert.equal(evidence.segment, 1);
  assert.equal(evidence.restartReason, 'start');
});

test('evidence is immutable and reason normalization does not mutate callers', () => {
  const clock = new InputObservationClock('immutable');
  clock.step(0, committed);
  const reasons = ['paused', 'modal', 'paused', 'composition'];
  const evidence = clock.step(1000, { blockedReasons: reasons, activity: false })!;
  assert.deepEqual(reasons, ['paused', 'modal', 'paused', 'composition']);
  assert.deepEqual(evidence.reasons, ['modal', 'paused']);
  reasons.push('background');
  assert.deepEqual(evidence.reasons, ['modal', 'paused']);
  assert.ok(Object.isFrozen(evidence));
  assert.ok(Object.isFrozen(evidence.reasons));
});

test('invalid input fails without mutating clock state', () => {
  for (const runId of ['', '   ']) assert.throws(() => new InputObservationClock(runId), /run ID/);
  const clock = new InputObservationClock('validation');
  clock.step(100, committed);
  for (const atMs of [NaN, Infinity, -Infinity]) assert.throws(() => clock.step(atMs, idle), /timestamp/);
  assert.throws(() => clock.step(200, { blockedReasons: [''], activity: false }), /observation step/);
  assert.throws(() => clock.step(200, { blockedReasons: ['   '], activity: false }), /observation step/);
  const next = clock.step(100 + MAX_OBSERVATION_GAP_MS, idle)!;
  assert.equal(next.segment, 1);
  assert.equal(next.restartReason, null);
});

test('validation accepts clock evidence and rejects missing, malformed or contradictory evidence', () => {
  const clock = new InputObservationClock('evidence');
  const start = clock.step(0, committed)!;
  const suspended = clock.step(100, { blockedReasons: ['background'], activity: false })!;
  assert.equal(isInputObservationEvidence(start), true);
  assert.equal(isInputObservationEvidence(suspended), true);
  const malformed: unknown[] = [null, undefined, {}, [],
    { ...start, version: 'other' }, { ...start, runId: ' ' },
    { ...start, segment: 0 }, { ...start, segment: 1.5 }, { ...start, segment: Infinity },
    { ...start, atMs: NaN }, { ...start, atMs: Infinity },
    { ...start, state: 'unknown' }, { ...start, reasons: ['background'] },
    { ...start, restartReason: 'unknown' }, { ...start, restartReason: undefined },
    { ...suspended, reasons: [] }, { ...suspended, reasons: ['composition'] },
    { ...suspended, reasons: ['background', 'background'] }, { ...suspended, reasons: [''] },
    { ...suspended, reasons: [1] }, { ...suspended, restartReason: 'start' }, { ...suspended, restartReason: 'resume' },
  ];
  for (const evidence of malformed) assert.equal(isInputObservationEvidence(evidence), false);
  const independentCopy: InputObservationEvidence = JSON.parse(JSON.stringify(suspended));
  assert.equal(isInputObservationEvidence(independentCopy), true);
});
