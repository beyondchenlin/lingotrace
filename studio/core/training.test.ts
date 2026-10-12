import assert from 'node:assert/strict';
import {
  TrainingEngine, CAFE_MATERIAL, SCHEMA_VERSION, RULE_VERSION, PACE_RULE_VERSION,
  align, tokens, graphemes, reduceTraining, replay, validateSnapshot, deriveCurves, exportSession, csvCell,
  type TrainingEvent, type EventPayload, type EngineClock, type Material,
} from './training.ts';
import { IndexedDBTrainingRepository } from './repository.ts';

let passed = 0;
function test(name: string, run: () => void) { run(); passed++; process.stdout.write(`✓ ${name}\n`); }
function fixture(material: Material = CAFE_MATERIAL) {
  let now = 0, serial = 0;
  const clock: EngineClock = { now: () => now, wallTime: () => new Date(1_700_000_000_000 + now).toISOString(), id: () => `id-${++serial}` };
  const engine = new TrainingEngine({ clock, material });
  return { engine, advance(ms: number) { now += ms; }, event(payload: EventPayload): TrainingEvent {
    const state = engine.getSnapshot();
    return { ...payload, eventId: `external-${++serial}`, sessionId: state.sessionId, sequence: state.sequence + 1,
      wallTime: clock.wallTime(), activeMs: state.activeMs, cueId: engine.cue.id, inputVersion: state.drafts[engine.cue.id]?.version ?? 0,
      schemaVersion: SCHEMA_VERSION, ruleVersion: RULE_VERSION, paceRuleVersion: PACE_RULE_VERSION, materialId: material.id, materialVersion: material.version };
  } };
}
const shortMaterial: Material = { id: 'test', version: 'v1', title: 'test', rights: 'original', cues: [{ id: 'one', text: 'one two three', start: 0, end: 6 }, { id: 'two', text: 'four five', start: 6, end: 12 }] };

test('fresh sessions have no fabricated data, rewards or curves', () => {
  const { engine } = fixture(); const snapshot = engine.getSnapshot();
  assert.equal(snapshot.earnedWords, 0); assert.equal(snapshot.pace, 0); assert.equal(snapshot.attempts.length, 0);
  assert.deepEqual(deriveCurves(snapshot), []); assert.equal(CAFE_MATERIAL.cues.length, 12);
});
test('NFKC/case/apostrophe normalization and edit-distance tie favor actual matches', () => {
  assert.deepEqual(tokens('ＩＴ’s A COFFEE.'), ["it's", 'a', 'coffee']);
  assert.equal(align("It's coffee", 'ＩＴ’S COFFEE!').errors, 0);
  const result = align('a b', 'b a');
  assert.equal(result.errors, 2);
  assert.equal(result.alignment.filter(token => token.kind === 'match').length, 1);
  assert.equal(align('one two', 'one two extra').errors, 1);
});
test('event dedupe precedes mutation and replay is deterministic', () => {
  const { engine, advance } = fixture(); engine.input('Could I'); advance(117); engine.input('Could I have'); engine.submit();
  const before = engine.getSnapshot();
  const duplicate = { ...before.events[1], sequence: -3, sessionId: 'wrong', activeMs: NaN } as TrainingEvent;
  assert.equal(reduceTraining(before, duplicate), before);
  assert.deepEqual(replay(before.events), before);
  assert.deepEqual(replay([...before.events, before.events[1]]), before);
  assert.throws(() => { (before.events as unknown[]).push({}); }, TypeError);
  assert.throws(() => { (before.drafts[engine.cue.id] as { text: string }).text = 'mutated'; }, TypeError);
});
test('time is sampled at action boundaries and every freeze holds time and pace', () => {
  const { engine, advance } = fixture(); advance(5000); engine.input('a');
  assert.equal(engine.getSnapshot().activeMs, 0); assert.equal(engine.getSnapshot().pace, 20);
  advance(120); engine.setFrozen('paused', true); assert.equal(engine.getSnapshot().activeMs, 120);
  const held = engine.getSnapshot().pace;
  for (const reason of ['listening', 'background', 'modal', 'review'] as const) engine.setFrozen(reason, true);
  advance(10_000); engine.sampleClock(); assert.equal(engine.getSnapshot().activeMs, 120); assert.equal(engine.getSnapshot().pace, held);
  engine.setFrozen('paused', false);
  for (const reason of ['listening', 'background', 'modal', 'review'] as const) engine.setFrozen(reason, false);
  advance(3000); engine.sampleClock();
  assert.equal(engine.getSnapshot().activeMs, 3120); assert.ok(Math.abs(engine.getSnapshot().pace - held / Math.E) < 1e-10);
  assert.deepEqual(replay(engine.getSnapshot().events), engine.getSnapshot());
});
test('IME composition commits once, freezes its duration, and counts graphemes', () => {
  const { engine, advance } = fixture(); engine.input('a'); advance(10); engine.beginComposition();
  const before = engine.getSnapshot(); advance(9000); engine.sampleClock();
  assert.equal(engine.getSnapshot().activeMs, 10); assert.equal(engine.getSnapshot().pace, before.pace);
  assert.throws(() => engine.input('uncommitted'), /composition/);
  engine.endComposition('a👩‍💻'); const committed = engine.getSnapshot(); engine.input('a👩‍💻');
  assert.equal(engine.getSnapshot(), committed); assert.equal(committed.activeMs, 10); assert.equal(committed.pace, before.pace + 20);
  assert.equal(graphemes('👩‍💻').length, 1);
});
test('paste and deletion do not boost pace; typing after either retains source conditions', () => {
  const { engine } = fixture(); engine.input('hello', 'paste'); assert.equal(engine.getSnapshot().pace, 0);
  engine.input('hell'); assert.equal(engine.getSnapshot().pace, 0);
  engine.input('hello'); assert.equal(engine.getSnapshot().pace, 20);
  const result = engine.submit()!; assert.equal(result.conditions.pasted, true); assert.equal(result.conditions.inputSource, 'typed');
});
test('partial credit is unique, extra words block completion, corrections never subtract', () => {
  const { engine } = fixture(shortMaterial);
  engine.input('one wrong three'); const first = engine.submit()!;
  assert.equal(first.gain, 2); assert.equal(first.conditions.exposure, 'first'); assert.equal(engine.getSnapshot().earnedWords, 2);
  engine.input('one two three extra'); const extra = engine.submit()!;
  assert.equal(extra.gain, 1); assert.equal(extra.conditions.exposure, 'retry'); assert.equal(engine.getSnapshot().completedCueIds.length, 0);
  engine.input('one two three'); const correct = engine.submit()!;
  assert.equal(correct.gain, 0); assert.equal(correct.firstCompletion, true); assert.equal(engine.getSnapshot().earnedWords, 3);
  const unchanged = engine.getSnapshot(); assert.equal(engine.submit(), correct); assert.equal(engine.getSnapshot(), unchanged);
  engine.input('wrong'); engine.submit(); assert.equal(engine.getSnapshot().earnedWords, 3);
  assert.equal(engine.getSnapshot().completedCueIds.length, 1);
  engine.nextCue(); engine.input('four five'); engine.submit(); assert.equal(engine.getSnapshot().earnedWords, 5);
  const curves = deriveCurves(engine.getSnapshot()); assert.equal(curves.length, 5); assert.deepEqual(curves.map(point => point.earnedWords), [2, 3, 3, 3, 5]);
});
test('hint, reveal, paste and first/retry conditions remain explicit', () => {
  const { engine } = fixture(shortMaterial); engine.exposeHint('hint'); engine.input('one', 'paste');
  const a = engine.submit()!; engine.exposeHint('reveal'); engine.input('one two three'); const b = engine.submit()!;
  assert.deepEqual(a.conditions, { exposure: 'first', hinted: true, revealed: false, pasted: true, inputSource: 'paste' });
  assert.deepEqual(b.conditions, { exposure: 'retry', hinted: true, revealed: true, pasted: true, inputSource: 'typed' });
});
test('an old asynchronous judgment cannot credit or replace a newer draft', () => {
  const { engine, event } = fixture(shortMaterial); engine.input('one two three');
  engine.dispatch(event({ type: 'submitRequested', attemptId: 'async-one', answer: engine.draft, draftVersion: 1 }));
  engine.input('wrong'); engine.dispatch(event({ type: 'judgmentApplied', attemptId: 'async-one' }));
  assert.equal(engine.getSnapshot().earnedWords, 0); assert.equal(engine.getSnapshot().attempts.length, 0); assert.equal(engine.currentResult, null);
  assert.deepEqual(engine.getSnapshot().discardedJudgmentIds, ['async-one']); assert.equal(engine.getSnapshot().frozenReasons.includes('checking'), false);
});
test('cue navigation rejects pending previous-cue judgments', () => {
  const { engine, event } = fixture(shortMaterial); engine.input('one two three');
  engine.dispatch(event({ type: 'submitRequested', attemptId: 'async-cue', answer: engine.draft, draftVersion: 1 }));
  engine.nextCue(); engine.dispatch(event({ type: 'judgmentApplied', attemptId: 'async-cue' }));
  assert.equal(engine.getSnapshot().earnedWords, 0); assert.equal(engine.getSnapshot().attempts.length, 0);
});
test('refresh recovers interrupted local judgments and composition without adding offline time', () => {
  const { engine, event } = fixture(shortMaterial); engine.input('one two three');
  engine.dispatch(event({ type: 'submitRequested', attemptId: 'crash-attempt', answer: engine.draft, draftVersion: 1 }));
  const restored = new TrainingEngine({ snapshot: engine.getSnapshot() });
  assert.equal(restored.getSnapshot().earnedWords, 3); assert.equal(restored.getSnapshot().activeMs, 0);
  assert.equal(restored.getSnapshot().frozenReasons.includes('checking'), false);
  engine.beginComposition();
  const recoveredComposition = new TrainingEngine({ snapshot: engine.getSnapshot() });
  assert.equal(recoveredComposition.getSnapshot().frozenReasons.includes('composition'), false);
  recoveredComposition.input('one two'); assert.equal(recoveredComposition.draft, 'one two');
});
test('reset creates a genuinely new zeroed round while previous snapshot remains exportable', () => {
  const { engine } = fixture(shortMaterial); engine.input('one two three'); engine.submit(); const previous = engine.getSnapshot();
  engine.resetSession(); assert.notEqual(engine.getSnapshot().sessionId, previous.sessionId); assert.equal(engine.getSnapshot().earnedWords, 0);
  assert.equal(previous.earnedWords, 3); assert.equal(JSON.parse(exportSession(previous).json).session.earnedWords, 3);
});
test('JSON and CSV capture the identical real dataset and use safe, quoted BOM/CRLF CSV', () => {
  const { engine } = fixture(shortMaterial); engine.input('=SUM(1,2)\n"quoted"', 'paste'); engine.submit();
  const before = engine.getSnapshot(); const exported = exportSession(before, '2026-10-07T00:00:00.000Z');
  assert.deepEqual(JSON.parse(exported.json).rawEvents, before.events); assert.deepEqual(JSON.parse(exported.json).attempts, before.attempts);
  assert.equal(exported.csv[0], '\uFEFF'); assert.ok(exported.csv.endsWith('\r\n'));
  assert.ok(exported.csv.includes(csvCell('=SUM(1,2)\n"quoted"'))); assert.ok(exported.csv.includes('"metric_definitions"'));
  assert.ok(exported.csv.includes('"conditions"')); assert.equal(exported.snapshot.attempts.length, 1);
  assert.equal(csvCell('  =1+2'), '"\'  =1+2"'); assert.equal(csvCell('@formula'), '"\'@formula"'); assert.equal(csvCell('"quoted"'), '"""quoted"""');
  engine.resetSession(); assert.equal(exported.snapshot.session.sessionId, before.sessionId);
});
test('explicit time events reject backwards or nonfinite elapsed deltas', () => {
  const { engine, event } = fixture(); engine.input('a');
  assert.throws(() => engine.tick(-1), /Elapsed/); assert.throws(() => engine.tick(Infinity), /Elapsed/);
  assert.throws(() => engine.dispatch(event({ type: 'timeAdvanced', deltaMs: -1 })), /Elapsed/);
});
test('long-session persistence validation uses proven immutable snapshots and replays foreign data', () => {
  const { engine, event } = fixture(shortMaterial); engine.input('one two three');
  for (let i = 0; i < 3600; i++) engine.tick(1000);
  const longSession = engine.getSnapshot();
  const started = performance.now();
  for (let i = 0; i < 1000; i++) assert.equal(validateSnapshot(longSession), longSession);
  process.stdout.write(`  3,602-event snapshot × 1,000 trusted validations: ${(performance.now() - started).toFixed(2)} ms\n`);
  const foreign = structuredClone(longSession); (foreign as { earnedWords: number }).earnedWords = 999;
  const canonical = validateSnapshot(foreign); assert.equal(canonical.earnedWords, 0); assert.notEqual(canonical, foreign);
  // Calling the public reducer with forged prior state must not grant it trusted provenance.
  const forgedReduction = reduceTraining(foreign, event({ type: 'timeAdvanced', deltaMs: 1000 }));
  assert.equal(forgedReduction.earnedWords, 999); assert.equal(validateSnapshot(forgedReduction).earnedWords, 0);
});

// No DOM emulation dependency needed to verify visible, recoverable failure semantics.
const repository = new IndexedDBTrainingRepository({ indexedDB: undefined });
const saved = fixture().engine.getSnapshot();
await assert.rejects(repository.saveSession(saved), /IndexedDB is unavailable/);
assert.equal(repository.getStatus().state, 'error'); assert.equal(repository.getStatus().pendingWrites, 0);
assert.equal(repository.getStatus().lastPersistedSequence, null);
await assert.rejects(repository.saveSession(saved), /IndexedDB is unavailable/);
assert.equal(repository.getStatus().pendingWrites, 0);
assert.equal(exportSession(saved).snapshot.session.sessionId, saved.sessionId);
passed++; process.stdout.write('✓ persistence failure is visible, retryable, and leaves export intact\n');
process.stdout.write(`\n${passed} tests passed.\n`);
