import assert from 'node:assert/strict';
import test from 'node:test';
import { TrainingEngine, SCHEMA_VERSION, RULE_VERSION, PACE_RULE_VERSION, type EngineClock, type EventPayload, type Material, type NativeEditEvidence, type TrainingEvent } from './training.ts';
import { TrainingHistorySegmentProjector, assertWritableTrainingHistorySegment, type TrainingHistoryFact, type TrainingHistorySegment } from './training-history-segment.ts';

const MATERIAL: Material = { id: 'segment-test', version: 'v1', title: 'test', rights: 'original', cues: [
  { id: 'one', text: 'one two three', start: 0, end: 6 }, { id: 'two', text: 'four five', start: 6, end: 12 },
] };
const PRIVATE = 'privatesecretneedle';
const native = (inputType: string | null = 'insertText', data: string | null = null): NativeEditEvidence => ({ version: 'dom-edit-v1', kind: 'input', inputType, data });
const ime = (data: string | null): NativeEditEvidence => ({ version: 'dom-edit-v1', kind: 'compositionend', inputType: null, data });
function fixture(observation = false) {
  let now = 0, serial = 0;
  const clock: EngineClock = { now: () => now, wallTime: () => new Date(1_700_000_000_000 + now).toISOString(), id: () => `id-${++serial}` };
  const engine = new TrainingEngine({ material: MATERIAL, clock, ...(observation ? { inputObservation: { runId: 'private-observation-run' } } : {}) });
  return { engine, clock, advance(ms: number) { now += ms; }, input(text: string, inserted = text) { engine.input(text, 'typed', native('insertText', inserted)); },
    projector(generation = 1) { return new TrainingHistorySegmentProjector(engine.getSnapshot(), { segmentId: `segment-${++serial}`, writerInstanceId: 'writer', generation, startedAt: clock.wallTime() }); },
    event(payload: EventPayload): TrainingEvent {
      const snapshot = engine.getSnapshot();
      return { ...payload, eventId: `external-${++serial}`, sessionId: snapshot.sessionId, sequence: snapshot.sequence + 1, wallTime: clock.wallTime(), activeMs: snapshot.activeMs,
        cueId: engine.cue.id, inputVersion: snapshot.drafts[engine.cue.id]?.version ?? 0, schemaVersion: SCHEMA_VERSION, ruleVersion: RULE_VERSION, paceRuleVersion: PACE_RULE_VERSION,
        materialId: MATERIAL.id, materialVersion: MATERIAL.version };
    },
  };
}
function watch(f: ReturnType<typeof fixture>, p: TrainingHistorySegmentProjector) { return f.engine.subscribe(() => p.observe(f.engine.getSnapshot())); }
function byType<T extends TrainingHistoryFact['type']>(segment: TrainingHistorySegment, type: T): Extract<TrainingHistoryFact, { type: T }>[] {
  return segment.facts.filter(fact => fact.type === type) as Extract<TrainingHistoryFact, { type: T }>[];
}
function assertPrivate(segment: TrainingHistorySegment) {
  const serialized = JSON.stringify(segment);
  assert.ok(!serialized.toLowerCase().includes(PRIVATE));
  const forbidden = new Set(['sequence', 'inputVersion', 'activeMs', 'pace', 'earnedWords', 'confirmedPositions', 'pendingAttempts', 'inputObservation', 'nativeEdit', 'gain', 'firstCompletion', 'conditions', 'draftVersion', 'reference', 'createdAt']);
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) { assert.ok(!forbidden.has(key), `forbidden persisted key: ${key}`); visit(child); }
  }
  visit(segment);
}

test('ON captures only a cursor and safe references, with no private draft, prior scores, or source counters', () => {
  const f = fixture(true); f.input(PRIVATE); f.advance(500); f.engine.submit();
  const source = f.engine.getSnapshot(), serializedSource = JSON.stringify(source);
  const p = f.projector();
  assert.deepEqual(p.getSegment().facts, []);
  assert.equal(p.getSegment().sessionId, source.sessionId);
  assert.deepEqual(p.getSegment().material, { id: MATERIAL.id, version: MATERIAL.version });
  assert.equal(p.getSegment().coverage, 'partial'); assert.equal(p.getSegment().replayable, false);
  assertPrivate(p.getSegment());
  assert.equal(f.engine.getSnapshot(), source); assert.equal(JSON.stringify(source), serializedSource);
});

test('private text edited and submitted ON remains occurrence-only, including its applied alignment', () => {
  const f = fixture(true); f.input(PRIVATE); const p = f.projector(); watch(f, p);
  f.input(`${PRIVATE} two`, ' two'); const actual = f.engine.submit()!;
  const segment = p.getSegment(); assertPrivate(segment);
  assert.ok(actual.answer.includes(PRIVATE));
  for (const fact of segment.facts.filter(fact => ['inputCommitted', 'submitRequested', 'judgmentApplied'].includes(fact.type))) {
    assert.equal('retention' in fact && fact.retention, 'redacted');
    assert.equal('answer' in fact || 'result' in fact || 'alignment' in fact || 'accuracy' in fact, false);
  }
});

test('a full native replacement cannot clear a private draft; observed empty draft can', () => {
  const f = fixture(); f.input(PRIVATE); const p = f.projector(); watch(f, p);
  f.input('one two three'); f.engine.submit();
  assert.equal(byType(p.getSegment(), 'judgmentApplied')[0].retention, 'redacted');
  f.engine.input('', 'typed', native('deleteContentBackward'));
  f.input('one wrong three'); const actual = f.engine.submit()!;
  const judgment = byType(p.getSegment(), 'judgmentApplied').at(-1)!;
  assert.equal(judgment.retention, 'recorded');
  if (judgment.retention !== 'recorded') assert.fail('clean answer should be retained');
  assert.deepEqual(judgment.result, { answer: actual.answer, words: actual.words, errors: actual.errors, accuracy: actual.accuracy, alignment: actual.alignment });
  assert.equal(judgment.result.accuracy, 67); assert.equal(judgment.result.errors, 1);
  assert.notEqual(judgment.result.alignment, actual.alignment);
  assertPrivate(p.getSegment());
});

test('IME begun OFF remains tainted through compositionEnded and its ON commit', () => {
  const f = fixture(true); f.engine.beginComposition(); const p = f.projector(); watch(f, p);
  f.advance(800); f.engine.endComposition(PRIVATE, ime(PRIVATE)); f.engine.submit();
  const input = byType(p.getSegment(), 'inputCommitted')[0];
  assert.equal(input.retention, 'redacted');
  if (input.retention === 'redacted') assert.equal(input.redactionReason, 'composition-crossed-boundary');
  assert.equal(byType(p.getSegment(), 'judgmentApplied')[0].retention, 'redacted');
  assertPrivate(p.getSegment());
});

test('canceled crossing IME creates no answer, and a later observed empty-origin edit is clean', () => {
  const f = fixture(true); f.engine.beginComposition(); const p = f.projector(); watch(f, p);
  f.advance(200); f.engine.endComposition('', ime(''));
  assert.equal(byType(p.getSegment(), 'inputCommitted').length, 0);
  assert.equal(byType(p.getSegment(), 'judgmentApplied').length, 0);
  f.input('one two three'); f.engine.submit();
  assert.equal(byType(p.getSegment(), 'judgmentApplied')[0].retention, 'recorded');
  assertPrivate(p.getSegment());
});

test('same-value crossing IME and empty or missing native evidence never cleanse private text', () => {
  for (const evidence of [ime(''), ime(null), ime(PRIVATE)]) {
    const f = fixture(); f.input(PRIVATE); f.engine.beginComposition(); const p = f.projector(); watch(f, p);
    f.engine.endComposition(PRIVATE, evidence); f.engine.submit();
    assert.equal(byType(p.getSegment(), 'judgmentApplied')[0].retention, 'redacted');
    assertPrivate(p.getSegment());
  }
});

test('an IME answer wholly begun and committed ON uses the actual existing score', () => {
  const f = fixture(); const p = f.projector(); watch(f, p);
  f.engine.beginComposition(); f.advance(300); f.engine.endComposition('one two three', ime('one two three'));
  const actual = f.engine.submit()!; const judgment = byType(p.getSegment(), 'judgmentApplied')[0];
  assert.equal(judgment.retention, 'recorded');
  if (judgment.retention !== 'recorded') assert.fail('expected retained IME result');
  assert.equal(judgment.result.accuracy, actual.accuracy); assert.deepEqual(judgment.result.alignment, actual.alignment);
  assertPrivate(p.getSegment());
});

test('undo/redo after a clean draft taints all following answers until another observed empty draft', () => {
  for (const inputType of ['historyUndo', 'historyRedo']) {
    const f = fixture(); f.input(PRIVATE); f.engine.input('', 'typed', native('deleteContentBackward'));
    const p = f.projector(); watch(f, p); f.input('one two');
    f.engine.input(PRIVATE, 'typed', native(inputType)); f.input(`${PRIVATE} three`, ' three'); f.engine.submit();
    assert.equal(byType(p.getSegment(), 'judgmentApplied')[0].retention, 'redacted');
    assertPrivate(p.getSegment());
  }
});

test('same-value undo and unknown edits taint even an ON-clean draft', () => {
  for (const evidence of [native('historyUndo'), native('insertReplacementText'), native(null), undefined]) {
    const f = fixture(); const p = f.projector(); watch(f, p); f.input('one two');
    f.engine.input(evidence ? 'one two' : 'one two three', 'typed', evidence);
    f.engine.submit(); assert.equal(byType(p.getSegment(), 'judgmentApplied')[0].retention, 'redacted');
    assertPrivate(p.getSegment());
  }
});

test('privacy provenance is per cue and navigation cannot reveal another cue’s OFF answer', () => {
  const f = fixture(); f.input(PRIVATE); const p = f.projector(); watch(f, p);
  f.engine.nextCue(); f.input('four five'); f.engine.submit();
  f.engine.nextCue(0); f.input(`${PRIVATE} two`, ' two'); f.engine.submit();
  const results = byType(p.getSegment(), 'judgmentApplied');
  assert.equal(results[0].retention, 'recorded'); assert.equal(results[1].retention, 'redacted');
  assertPrivate(p.getSegment());
});

test('a pending judgment requested OFF records only its ON occurrence', () => {
  const f = fixture(); f.input(PRIVATE);
  f.engine.dispatch(f.event({ type: 'submitRequested', attemptId: 'pending-before-on', answer: f.engine.draft, draftVersion: 1 }));
  const p = f.projector(); watch(f, p);
  f.engine.dispatch(f.event({ type: 'judgmentApplied', attemptId: 'pending-before-on' }));
  const result = byType(p.getSegment(), 'judgmentApplied')[0];
  assert.equal(result.retention, 'redacted');
  if (result.retention === 'redacted') assert.equal(result.redactionReason, 'request-outside-segment');
  assert.equal(f.engine.getSnapshot().attempts.length, 1); assertPrivate(p.getSegment());
});

test('invalidated ON judgment stays unavailable without fabricated zero score', () => {
  const f = fixture(); const p = f.projector(); watch(f, p); f.input('one two');
  f.engine.dispatch(f.event({ type: 'submitRequested', attemptId: 'stale', answer: f.engine.draft, draftVersion: 1 }));
  f.input('one two three', ' three'); f.engine.dispatch(f.event({ type: 'judgmentApplied', attemptId: 'stale' }));
  const result = byType(p.getSegment(), 'judgmentApplied')[0];
  assert.equal(result.retention, 'unavailable'); assert.equal('result' in result, false);
});

test('repeated judgment events do not present an old actual attempt as a newly applied score', () => {
  const f = fixture(); const p = f.projector(); watch(f, p); f.input('one two three');
  const actual = f.engine.submit()!;
  f.engine.dispatch(f.event({ type: 'judgmentApplied', attemptId: actual.attemptId }));
  f.engine.dispatch(f.event({ type: 'submitRequested', attemptId: actual.attemptId, answer: f.engine.draft, draftVersion: 1 }));
  f.engine.dispatch(f.event({ type: 'judgmentApplied', attemptId: actual.attemptId }));
  assert.deepEqual(byType(p.getSegment(), 'judgmentApplied').map(fact => fact.retention), ['recorded', 'unavailable', 'unavailable']);
  assert.equal(f.engine.getSnapshot().attempts.length, 1);
});

test('first time delta is unknown rather than zero, subsequent fully observed active delta is copied', () => {
  const f = fixture(true); f.input(PRIVATE); f.advance(900); const p = f.projector(); watch(f, p);
  f.advance(100); f.engine.sampleClock(); f.advance(250); f.engine.sampleClock();
  const times = byType(p.getSegment(), 'timeAdvanced');
  assert.deepEqual(times.map(time => [time.deltaMs, time.durationCoverage]), [[null, 'boundary-unknown'], [250, 'observed']]);
  assert.equal(f.engine.getSnapshot().activeMs, 1250); assertPrivate(p.getSegment());
  f.engine.setFrozen('paused', true); f.engine.dispatch(f.event({ type: 'timeAdvanced', deltaMs: 500 }));
  assert.equal(byType(p.getSegment(), 'timeAdvanced').at(-1)!.deltaMs, null);
  assert.equal(byType(p.getSegment(), 'timeAdvanced').at(-1)!.durationCoverage, 'frozen');
});

test('repeat and batched snapshot observation deduplicate and keep contiguous segment ordinals', () => {
  const f = fixture(); f.input(PRIVATE); const initial = f.engine.getSnapshot(); const p = f.projector();
  f.engine.input('', 'typed', native('deleteContentBackward')); f.input('one wrong three'); const actual = f.engine.submit()!;
  const source = f.engine.getSnapshot(), segment = p.observe(source);
  assert.equal(p.observe(source), segment); assert.equal(p.observe(initial), segment);
  assert.deepEqual(segment.facts.map(fact => fact.ordinal), segment.facts.map((_, index) => index + 1));
  assert.deepEqual(segment.facts.map(fact => fact.sourceEventId), source.events.slice(initial.events.length).map(event => event.eventId));
  const result = byType(segment, 'judgmentApplied')[0]; assert.equal(result.retention, 'recorded');
  if (result.retention === 'recorded') assert.equal(result.result.accuracy, actual.accuracy);
  assertPrivate(segment);
});

test('native edit payloads and original observation evidence never appear even in clean retained facts', () => {
  const f = fixture(true); const p = f.projector(); watch(f, p);
  f.engine.input('one two three', 'paste', native('insertFromPaste', PRIVATE)); f.advance(500); f.engine.sampleClock(); f.engine.submit();
  assert.equal(byType(p.getSegment(), 'judgmentApplied')[0].retention, 'recorded');
  assertPrivate(p.getSegment()); assert.ok(!JSON.stringify(p.getSegment()).includes('private-observation-run'));
});

test('segments are deeply immutable, writable only through live provenance, and closing never mutates Training', () => {
  const f = fixture(); const p = f.projector(); const stop = watch(f, p); f.input('one two three'); f.engine.submit(); stop();
  const before = f.engine.getSnapshot(), beforeJSON = JSON.stringify(before), open = p.getSegment();
  assertWritableTrainingHistorySegment(open);
  assert.throws(() => assertWritableTrainingHistorySegment(structuredClone(open)), /live projector/);
  assert.throws(() => assertWritableTrainingHistorySegment(before), /live projector/);
  assert.throws(() => { (open.facts as unknown[]).push({}); }, TypeError);
  const result = byType(open, 'judgmentApplied')[0];
  if (result.retention !== 'recorded') assert.fail('expected score');
  assert.throws(() => { (result.result.alignment[0] as { actual: string }).actual = 'tampered'; }, TypeError);
  f.advance(100); const closed = p.close(f.clock.wallTime()); assertWritableTrainingHistorySegment(closed);
  assert.equal(closed.facts, open.facts); assert.equal(open.endedAt, null); assert.notEqual(closed.endedAt, null);
  assert.equal(p.close(f.clock.wallTime()), closed); assert.throws(() => p.observe(before), /no longer observing/);
  assert.equal(f.engine.getSnapshot(), before); assert.equal(JSON.stringify(before), beforeJSON);
  p.dispose(); p.dispose(); assert.throws(() => p.observe(before), /no longer observing/); assert.equal(p.getSegment(), closed);
});

test('new recording windows in the same session never backfill OFF facts or inherit answer provenance', () => {
  const f = fixture(); const first = f.projector(); const stop = watch(f, first); f.input('one two'); stop(); first.close(f.clock.wallTime()); first.dispose();
  f.input(PRIVATE); f.advance(20); const second = f.projector(2); watch(f, second); f.input(`${PRIVATE} three`, ' three'); f.engine.submit();
  assert.equal(second.getSegment().sessionId, first.getSegment().sessionId);
  assert.notEqual(second.getSegment().segmentId, first.getSegment().segmentId);
  assert.equal(byType(second.getSegment(), 'judgmentApplied')[0].retention, 'redacted'); assertPrivate(second.getSegment());
});

test('session resets are refused and cannot become part of an existing segment', () => {
  const f = fixture(); const p = f.projector(); f.engine.resetSession();
  assert.throws(() => p.observe(f.engine.getSnapshot()), /cross sessions/); assert.deepEqual(p.getSegment().facts, []);
});
