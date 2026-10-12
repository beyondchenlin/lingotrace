import test from 'node:test';
import assert from 'node:assert/strict';
import { TrainingEngine, type EngineClock, type FreezeReason, type InputSource } from '../core/training';
import { TransparentInputProjector } from './transparent-input';

function harness(subscribe = true) {
  let now = 0, nextId = 0;
  const clock: EngineClock = { now: () => now, wallTime: () => new Date(now).toISOString(), id: () => `event-${++nextId}` };
  const engine = new TrainingEngine({ sessionId: 'session', clock });
  const projector = new TransparentInputProjector();
  projector.attach(engine.getSnapshot(), now);
  if (subscribe) engine.subscribe(() => projector.observe(engine.getSnapshot(), now));
  return {
    engine, projector, clock,
    at(time: number) { now = time; },
    observe(time: number) { now = time; projector.observe(engine.getSnapshot(), now); return projector.frame(now); },
    frame(time: number) { now = time; return projector.frame(now); },
    input(text: string, time: number, source: InputSource = 'typed') { now = time; engine.input(text, source); },
  };
}

test('fresh attach has no history, input, or energy; metadata never counts', () => {
  const h = harness();
  assert.deepEqual(h.frame(0), { commits10s: 0, energy: 0, latestRate: null, observedMs: 0, frozen: true, points: [], pulses: [] });
  h.engine.exposeHint('hint');
  h.engine.tick(900);
  h.engine.nextCue();
  assert.equal(h.frame(0).commits10s, 0);
  assert.equal(h.frame(0).energy, 0);
  assert.deepEqual(h.frame(0).points, []);
});

test('measures complete one-second bins, never a count disguised as a rate', () => {
  const fast = harness(), slow = harness();
  fast.input('a', 0); fast.input('ab', 100); fast.input('abc', 200); fast.input('abcd', 300);
  const burst = fast.frame(1000);
  assert.equal(burst.commits10s, 4);
  assert.deepEqual(burst.points, [{ atMs: 1000, value: 4 }]);
  slow.input('a', 0); slow.input('ab', 1000); slow.input('abc', 2000); slow.input('abcd', 3000);
  assert.deepEqual(slow.frame(4000).points.map(p => p.value), [1, 1, 1, 1]);
  assert.equal(slow.frame(4000).commits10s, 4);
  const recent = harness();
  recent.input('a', 0); recent.input('ab', 100); recent.input('abc', 200); recent.input('abcd', 300);
  assert.ok(recent.frame(300).energy > slow.frame(4000).energy);
  assert.equal(fast.frame(1000).observedMs, 1000);
});

test('paste and deletion count actual changes without adding measured input or pulses', () => {
  const h = harness();
  h.input('large pasted text', 0, 'paste');
  h.input('large pasted', 100);
  h.input('large pasted', 200); // A same-value DOM input is not a commit.
  assert.equal(h.frame(200).commits10s, 2);
  assert.equal(h.frame(200).energy, 0);
  assert.deepEqual(h.frame(200).pulses, []);
  assert.equal(h.frame(1000).latestRate, 0);
  h.input('large pasted!', 1100);
  assert.equal(h.frame(1100).pulses[0].added, 1);
  assert.equal(h.frame(2000).latestRate, 1);
});

test('IME final text counts once, uses graphemes, and preserves composition gaps', () => {
  const h = harness();
  h.engine.beginComposition();
  assert.deepEqual(h.frame(1000).points, [{ atMs: 1000, value: null }]);
  h.at(1100); h.engine.endComposition('👩🏽‍💻é');
  h.engine.input('👩🏽‍💻é');
  const input = h.frame(1100);
  assert.equal(input.commits10s, 1);
  assert.equal(input.pulses.length, 1);
  assert.equal(input.pulses[0].source, 'ime');
  assert.equal(input.pulses[0].added, 2);
  assert.equal(h.frame(2100).latestRate, 2);
});

test('cursor deduplicates repeated observe, engine event dispatch, and render sampling', () => {
  const h = harness(false);
  h.input('a', 0); h.input('ab', 100);
  h.observe(100);
  const snapshot = h.engine.getSnapshot();
  for (let i = 0; i < 8; i++) h.projector.observe(snapshot, 100);
  h.engine.dispatch(snapshot.events.at(-1)!);
  assert.equal(h.observe(100).commits10s, 2);
  assert.equal(h.frame(1100).latestRate, 2);
  assert.equal(h.frame(1100).pulses.length, 2);
});

test('primes every cue draft and reuses addedGraphemes for replacements', () => {
  const h = harness();
  h.input('coffee', 0);
  h.at(100); h.engine.nextCue(1); h.engine.input('milk');
  h.projector.attach(h.engine.getSnapshot(), 100);
  assert.equal(h.frame(100).commits10s, 0);
  h.at(200); h.engine.nextCue(0); h.engine.input('cofFee');
  assert.equal(h.frame(200).pulses[0].added, 1);
  h.at(300); h.engine.nextCue(1); h.engine.input('milks');
  assert.equal(h.frame(300).pulses[0].added, 1);
  assert.equal(h.frame(300).commits10s, 2);
});

test('every freeze reason has null gaps; resume starts a complete fresh bin', () => {
  for (const reason of ['paused', 'background', 'listening', 'modal', 'composition', 'review', 'checking', 'idle'] satisfies FreezeReason[]) {
    const h = harness();
    h.input('a', 0);
    h.at(400); h.engine.setFrozen(reason, true);
    const frozen = h.frame(1400);
    assert.equal(frozen.latestRate, null, reason);
    assert.equal(frozen.energy, 0, reason);
    assert.ok(frozen.points.every(point => point.value === null), reason);
    h.at(1500); h.engine.setFrozen(reason, false);
    h.input('ab', 1600);
    assert.equal(h.frame(2499).latestRate, null, reason);
    assert.equal(h.frame(2500).latestRate, 1, reason);
    assert.equal(h.frame(2500).observedMs, 1400, reason);
  }
});

test('commits while paused still count changes but cannot boost on resume', () => {
  const h = harness();
  h.engine.setFrozen('paused', true);
  h.input('abc', 100);
  assert.equal(h.frame(100).commits10s, 1);
  assert.equal(h.frame(100).energy, 0);
  h.at(200); h.engine.setFrozen('paused', false);
  assert.equal(h.frame(1200).latestRate, 0);
  h.input('abcd', 1300);
  assert.equal(h.frame(1300).pulses[0].added, 1);
});

test('pulse evidence and commits last ten seconds while energy keeps its 700 ms decay', () => {
  const h = harness();
  h.input('abc', 0);
  const initial = h.frame(0);
  assert.ok(initial.energy > 0 && initial.energy <= 1);
  assert.ok(Math.abs(h.frame(700).pulses[0].strength / initial.pulses[0].strength - Math.exp(-1)) < 1e-12);
  assert.ok(h.frame(1000).energy < initial.energy);
  for (let time = 2000; time <= 9000; time += 1000) h.observe(time);
  const old = h.frame(9999);
  assert.ok(old.energy < 0.000001);
  assert.equal(old.commits10s, 1);
  assert.equal(old.pulses.length, 1);
  assert.equal(old.pulses[0].ageMs, 9999);
  assert.equal(old.pulses[0].added, 3);
  const expired = h.frame(10000);
  assert.equal(expired.commits10s, 0);
  assert.equal(expired.energy, 0);
  assert.deepEqual(expired.pulses, []);
});

test('review preserves past pulse evidence with zero energy; frozen edits add no positive pulse', () => {
  const h = harness();
  h.input('coffee', 0);
  const original = h.frame(0).pulses[0];
  h.at(200); h.engine.submit();
  const review = h.frame(200);
  assert.equal(review.frozen, true);
  assert.equal(review.energy, 0);
  assert.equal(review.latestRate, null);
  assert.equal(review.commits10s, 1);
  assert.equal(review.pulses.length, 1);
  assert.equal(review.pulses[0].eventId, original.eventId);
  assert.equal(review.pulses[0].ageMs, 200);
  assert.ok(review.pulses[0].strength < original.strength);
  h.at(300); h.engine.setFrozen('paused', true);
  h.input('coffees', 400);
  const paused = h.frame(400);
  assert.equal(paused.energy, 0);
  assert.equal(paused.commits10s, 2);
  assert.equal(paused.pulses.length, 1);
  assert.equal(paused.pulses[0].eventId, original.eventId);
  for (let time = 1000; time <= 9000; time += 1000) h.observe(time);
  assert.equal(h.frame(9999).pulses.length, 1);
  assert.deepEqual(h.frame(10000).pulses, []);
  assert.equal(h.frame(10000).commits10s, 1); // Paused edit remains a real commit.
});

test('subscription, timer, and repeated RAF calls at the same now produce exact bins and a stop gap', () => {
  const h = harness();
  h.input('a', 0);
  for (let time = 250; time <= 3000; time += 250) {
    h.at(time);
    if (time === 750) h.engine.input('ab');
    if (time === 1250) h.engine.input('abc');
    h.engine.sampleClock(); // queueSave observes this metadata notification.
    h.observe(time);       // RAF observe and frame share the same now.
    h.observe(time);       // A repeated render is idempotent too.
    h.frame(time);
  }
  const running = h.frame(3000);
  assert.deepEqual(running.points, [{ atMs: 1000, value: 2 }, { atMs: 2000, value: 1 }, { atMs: 3000, value: 0 }]);
  assert.equal(running.observedMs, 3000);
  assert.equal(running.commits10s, 3);
  h.at(9000);
  h.engine.sampleClock(); // First queued timer after a long page stall.
  const resumed = h.observe(9000);
  assert.equal(resumed.observedMs, 3000);
  assert.equal(resumed.latestRate, null);
  assert.deepEqual(resumed.points.slice(3), [{ atMs: 9000, value: null }]);
  assert.equal(h.frame(10000).latestRate, 0); // Only this fresh full second is observed.
});

test('engine restart and explicit session restore never replay input', () => {
  const h = harness();
  h.input('saved text', 0);
  const saved = h.engine.getSnapshot();
  h.at(100); h.engine.resetSession();
  assert.equal(h.frame(100).commits10s, 0);
  assert.deepEqual(h.frame(100).points, []);
  const restored = new TrainingEngine({ snapshot: saved, clock: h.clock });
  h.projector.attach(restored.getSnapshot(), 200);
  assert.equal(h.projector.frame(200).energy, 0);
  assert.deepEqual(h.projector.frame(200).points, []);
  h.at(300); restored.input('saved texts');
  h.projector.observe(restored.getSnapshot(), 300);
  assert.equal(h.projector.frame(300).commits10s, 1);
  assert.equal(h.projector.frame(300).pulses[0].added, 1);
});

test('a rollback or divergent snapshot tail is a replacement, not new input', () => {
  const h = harness();
  h.input('a', 0);
  const before = h.engine.getSnapshot();
  h.input('ab', 100);
  h.projector.observe(before, 200);
  assert.equal(h.projector.frame(200).commits10s, 0);
  const other = new TrainingEngine({ sessionId: 'session', clock: h.clock });
  other.input('different');
  h.projector.observe(other.getSnapshot(), 300);
  assert.equal(h.projector.frame(300).commits10s, 0);
  assert.deepEqual(h.projector.frame(300).points, []);
});

test('missing render intervals are gaps; unseen input is primed without fresh boosts', () => {
  for (const frameFirst of [false, true]) {
    const h = harness(false);
    h.input('a', 0); h.observe(0);
    h.frame(1000);
    h.input('hidden input', 4000);
    if (frameFirst) h.frame(5000);
    const resumed = h.observe(5000);
    assert.equal(resumed.latestRate, null);
    assert.equal(resumed.energy, 0);
    assert.equal(resumed.commits10s, 1);
    assert.equal(resumed.observedMs, 1000);
    assert.deepEqual(resumed.points, [{ atMs: 1000, value: 1 }, { atMs: 5000, value: null }]);
    h.input('hidden inputs', 5100); h.observe(5100);
    assert.equal(h.frame(5100).pulses[0].added, 1);
    assert.equal(h.frame(6000).latestRate, 1);
  }
});

test('render sampling cannot bridge a freeze/resume cycle hidden between frames', () => {
  const h = harness(false);
  h.input('a', 0); h.observe(0);
  h.at(200); h.engine.setFrozen('paused', true);
  h.at(800); h.engine.setFrozen('paused', false);
  h.input('ab', 900);
  const resumed = h.observe(1000);
  assert.equal(resumed.commits10s, 2);
  assert.equal(resumed.observedMs, 0);
  assert.ok(resumed.points.every(point => point.value === null));
  assert.equal(h.frame(2000).latestRate, 1);
});

test('a no-op judgment metadata event does not fabricate a review gap', () => {
  const h = harness();
  h.input('a', 0);
  const snapshot = h.engine.getSnapshot();
  h.engine.dispatch({ ...snapshot.events.at(-1)!, type: 'judgmentApplied', attemptId: 'never-pending',
    eventId: 'no-op-judgment', sequence: snapshot.sequence + 1, inputVersion: 1 });
  assert.equal(h.frame(1000).commits10s, 1);
  assert.deepEqual(h.frame(1000).points, [{ atMs: 1000, value: 1 }]);
});

test('backward clock resets transient time data, marks a gap, and safely resumes', () => {
  const h = harness(false);
  h.input('a', 0); h.observe(0); h.frame(1000);
  h.input('ab', 900);
  const reversed = h.observe(900);
  assert.equal(reversed.energy, 0);
  assert.equal(reversed.commits10s, 0);
  assert.equal(reversed.observedMs, 0);
  assert.deepEqual(reversed.points, [{ atMs: 900, value: null }]);
  h.input('abc', 1000); h.observe(1000);
  assert.equal(h.frame(1900).latestRate, 1);
});

test('history stays within thirty seconds; frame values cannot corrupt projection', () => {
  const h = harness();
  h.input('a', 0);
  for (let time = 1000; time <= 45000; time += 1000) h.observe(time);
  const value = h.frame(45000);
  assert.ok(value.points.length <= 64);
  assert.ok(value.points.every(point => point.atMs >= 15000));
  assert.equal(value.latestRate, 0);
  (value.points[0] as { value: number | null }).value = 999;
  assert.equal(h.frame(45000).points[0].value, 0);
  for (const invalid of [NaN, Infinity, -1]) assert.throws(() => h.frame(invalid), RangeError);
});
