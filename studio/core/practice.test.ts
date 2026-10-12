import assert from 'node:assert/strict';
import { test } from 'node:test';
import { align, type EngineClock } from './training.ts';
import {
  ORIGINAL_PRACTICE_MATERIAL, PRACTICE_SCHEMA_VERSION, PracticeEngine, replayPracticeEvents, validatePracticeSnapshot,
  type PracticeEvent, type PracticeEventPayload, type PracticeMaterial, type PracticeSnapshot,
} from './practice.ts';

function fixture(catalog: readonly PracticeMaterial[] = [ORIGINAL_PRACTICE_MATERIAL]) {
  let now = 0, serial = 0;
  const clock: EngineClock = { now: () => now, wallTime: () => new Date(Date.UTC(2026, 9, 8) + now).toISOString(), id: () => `test-${++serial}` };
  const engine = new PracticeEngine({ clock, catalog });
  return { engine, clock, advance(ms: number) { now += ms; }, start(mode: 'dictation' | 'recording-comparison' = 'dictation') {
    engine.startRound({ materialId: catalog[0].materialId });
    return engine.startAttempt({ unitId: catalog[0].units[0].unitId, mode });
  }, event(payload: PracticeEventPayload): PracticeEvent {
    const snapshot = engine.getSnapshot();
    return { schemaVersion: PRACTICE_SCHEMA_VERSION, eventId: `external-${++serial}`, sessionId: snapshot.sessionId,
      sequence: snapshot.sequence + 1, occurredAt: clock.wallTime(), recordedAt: clock.wallTime(), payload };
  } };
}
function current(snapshot: PracticeSnapshot) { return snapshot.projections.attempts[snapshot.projections.currentAttemptId!]; }
function round(snapshot: PracticeSnapshot) { return snapshot.projections.rounds[snapshot.projections.currentRoundId!]; }

// These tests use actual commands and replayed facts, not a prepopulated success fixture.
test('an opt-in catalog has one original material and three immutable timed units; a default engine is empty', () => {
  assert.equal(ORIGINAL_PRACTICE_MATERIAL.units.length, 3);
  assert.equal(ORIGINAL_PRACTICE_MATERIAL.durationSeconds, 18);
  assert.deepEqual(ORIGINAL_PRACTICE_MATERIAL.units.map(unit => [unit.references[0].startSeconds, unit.references[0].endSeconds]), [[0, 6], [6, 12], [12, 18]]);
  const engine = new PracticeEngine();
  assert.deepEqual(engine.getSnapshot().projections.catalog, []);
  assert.deepEqual(engine.getSnapshot().projections.attempts, {});
  assert.equal(engine.getSnapshot().events.length, 1);
  assert.throws(() => { (ORIGINAL_PRACTICE_MATERIAL.units as unknown[]).push({}); }, TypeError);
});

test('first answer X remains immutable after Y revision within the same logical attempt', () => {
  const f = fixture(); const attempt = f.start();
  f.engine.input('X'); const first = f.engine.submit(); const firstSnapshot = f.engine.getSnapshot();
  f.engine.input('Y'); const revision = f.engine.submit();
  const result = current(f.engine.getSnapshot());
  assert.equal(result.attemptId, attempt.attemptId); assert.equal(result.firstSubmission?.answer, 'X');
  assert.equal(result.firstSubmission, first); assert.equal(result.revisions.length, 1);
  assert.equal(result.revisions[0].answer, 'Y'); assert.equal(revision, result.revisions[0]);
  assert.equal(current(firstSnapshot).draft.text, 'X');
  assert.equal(current(firstSnapshot).revisions.length, 0);
  assert.throws(() => { (result.firstSubmission as { answer: string }).answer = 'Y'; }, TypeError);
  const before = f.engine.getSnapshot(); assert.equal(f.engine.submit(), revision); assert.equal(f.engine.getSnapshot(), before);
  assert.deepEqual(replayPracticeEvents(before.events), before);
});

test('input sources and added graphemes preserve paste history without inventing typed effort', () => {
  const f = fixture(); f.start(); f.engine.input('X', 'paste'); f.engine.input('X👩‍💻', 'ime'); f.engine.input('X👩‍💻!', 'typed');
  const submission = f.engine.submit(), draft = current(f.engine.getSnapshot()).draft;
  assert.equal(draft.addedTypedGraphemes, 2); assert.equal(draft.pasted, true);
  assert.deepEqual(submission.inputSources, ['paste', 'ime', 'typed']); assert.equal(submission.inputSource, 'typed');
  assert.equal(submission.pasted, true);
  const before = f.engine.getSnapshot(); f.engine.input(draft.text, 'ime'); assert.equal(f.engine.getSnapshot(), before);
  f.engine.input('X'); assert.equal(current(f.engine.getSnapshot()).draft.addedTypedGraphemes, 2);
});

test('retry and mode changes create related fixed-mode attempts; mode switches do not rewrite old answers', () => {
  const f = fixture(); const first = f.start(); f.engine.input('X'); f.engine.submit();
  const retry = f.engine.retryAttempt(); assert.notEqual(retry.attemptId, first.attemptId);
  assert.deepEqual(retry.relation, { kind: 'retry', attemptId: first.attemptId });
  assert.equal(retry.mode, 'dictation'); assert.equal(retry.draft.text, '');
  const comparison = f.engine.switchMode('recording-comparison');
  assert.deepEqual(comparison.relation, { kind: 'mode-switch', attemptId: retry.attemptId });
  assert.equal(comparison.mode, 'recording-comparison');
  assert.equal(f.engine.getSnapshot().projections.attempts[first.attemptId].firstSubmission?.answer, 'X');
  assert.equal(f.engine.getSnapshot().projections.attempts[retry.attemptId].mode, 'dictation');
  assert.throws(() => f.engine.switchMode('recording-comparison'), /change mode/);
  assert.throws(() => f.engine.startAttempt({ unitId: first.reference.unitId, mode: 'dictation' }), /explicit retry/);
});

test('exposure is cumulative by round and unit across mode switches/retries, with the first-submission boundary preserved', () => {
  const f = fixture(); const first = f.start();
  f.engine.exposeReference('translation'); f.engine.input('X'); const firstSubmission = f.engine.submit();
  f.engine.exposeReference('reveal'); f.engine.input('Y'); const revision = f.engine.submit();
  assert.deepEqual(firstSubmission.exposureAtSubmission.map(item => item.kind), ['translation']);
  assert.deepEqual(revision.exposureAtSubmission.map(item => item.kind), ['translation', 'reveal']);
  f.engine.switchMode('recording-comparison'); f.engine.exposeReference('reference');
  f.engine.switchMode('dictation'); f.engine.retryAttempt(); f.engine.input('Z'); const retry = f.engine.submit();
  assert.deepEqual(retry.exposureAtSubmission.map(item => item.kind), ['translation', 'reveal', 'reference']);
  const exposure = round(f.engine.getSnapshot()).unitExposure[first.reference.unitId];
  assert.equal(exposure.firstSubmissionSequence, firstSubmission.sequence);
  assert.deepEqual(exposure.beforeFirstSubmission.map(item => item.kind), ['translation']);
  assert.deepEqual(exposure.afterFirstSubmission.map(item => item.kind), ['reveal', 'reference']);
  assert.equal(firstSubmission.exposureAtSubmission.length, 1);
  f.engine.startAttempt({ unitId: 'cafe-choice', mode: 'dictation' }); f.engine.input('Other unit');
  assert.deepEqual(f.engine.submit().exposureAtSubmission, []);
});

test('restore resumes the exact round, draft, attempt and frozen reference without counting offline time', () => {
  const f = fixture(); const attempt = f.start(); f.engine.exposeReference('hint'); f.engine.input('unfinished', 'ime');
  f.advance(1000); f.engine.sampleClock(); f.engine.pausePractice();
  const before = f.engine.getSnapshot(); f.advance(80_000);
  const restored = new PracticeEngine({ clock: f.clock, snapshot: JSON.parse(JSON.stringify(before)) });
  assert.deepEqual(restored.getSnapshot(), before);
  assert.equal(current(restored.getSnapshot()).attemptId, attempt.attemptId);
  assert.equal(current(restored.getSnapshot()).draft.text, 'unfinished');
  assert.deepEqual(current(restored.getSnapshot()).reference, attempt.reference);
  restored.resumePractice(); f.advance(500); restored.sampleClock();
  assert.equal(restored.getSnapshot().projections.activeMs, 1500);
  assert.equal(round(restored.getSnapshot()).unitExposure[attempt.reference.unitId].beforeFirstSubmission.length, 1);
});

test('manual pause freezes 20 seconds and rejects input and submission; 10 seconds then 5 yields 15 seconds', () => {
  const f = fixture(); const attempt = f.start(); f.engine.input('X'); f.advance(10_000); f.engine.pausePractice();
  const paused = f.engine.getSnapshot(); assert.equal(paused.projections.activeMs, 10_000);
  f.advance(20_000); assert.throws(() => f.engine.input('discard this'), /manually paused/);
  assert.throws(() => f.engine.submit(), /manually paused/); assert.equal(f.engine.getSnapshot(), paused);
  assert.throws(() => f.engine.dispatch(f.event({ type: 'inputCommitted', attemptId: attempt.attemptId, text: 'injected', source: 'typed' })), /manually paused/);
  assert.throws(() => f.engine.dispatch(f.event({ type: 'submissionCommitted', attemptId: attempt.attemptId, submissionId: 'blocked', draftVersion: 1 })), /manually paused/);
  assert.throws(() => f.engine.dispatch(f.event({ type: 'timeAdvanced', deltaMs: 20_000 })), /cannot advance/);
  f.engine.resumePractice(); f.advance(5000); const submission = f.engine.submit();
  assert.equal(submission.answer, 'X'); assert.equal(submission.activeMs, 15_000);
  assert.equal(f.engine.getSnapshot().projections.activeMs, 15_000);
  assert.equal(round(f.engine.getSnapshot()).activeMs, 15_000);
  assert.equal(current(f.engine.getSnapshot()).attemptId, attempt.attemptId);
});

test('pausing video alone continues practice time and permits real input and submission', () => {
  const f = fixture(); f.start(); f.engine.setVideoPaused(true); f.advance(12_000); f.engine.input('Video is paused');
  const submission = f.engine.submit(); assert.equal(submission.activeMs, 12_000);
  assert.equal(f.engine.getSnapshot().projections.manualPaused, false);
  assert.equal(f.engine.getSnapshot().projections.videoPaused, true);
  assert.equal(submission.answer, 'Video is paused');
});

test('only an explicitly ended round permits a new round with reset local exposure', () => {
  const f = fixture(); const attempt = f.start(); f.engine.exposeReference('reveal'); f.engine.input('X'); f.engine.submit();
  const oldRound = round(f.engine.getSnapshot());
  assert.throws(() => f.engine.startRound({ materialId: oldRound.materialId }), /Explicitly end/);
  f.engine.endRound(); f.engine.startRound({ materialId: oldRound.materialId });
  f.engine.startAttempt({ unitId: attempt.reference.unitId, mode: 'dictation' }); f.engine.input('Y');
  assert.deepEqual(f.engine.submit().exposureAtSubmission, []);
  const restored = new PracticeEngine({ clock: f.clock, snapshot: f.engine.getSnapshot() });
  assert.equal(round(restored.getSnapshot()).practiceRoundId, round(f.engine.getSnapshot()).practiceRoundId);
  assert.equal(restored.getSnapshot().projections.rounds[oldRound.practiceRoundId].unitExposure[attempt.reference.unitId].beforeFirstSubmission.length, 1);
  assert.notEqual(round(restored.getSnapshot()).practiceRoundId, oldRound.practiceRoundId);
});

test('new reference versions cannot retarget old attempts; text and time edits under old versions reject', () => {
  const f = fixture(); const oldAttempt = f.start(); const material = ORIGINAL_PRACTICE_MATERIAL;
  const edited: PracticeMaterial = { ...material, units: [{ unitId: oldAttempt.reference.unitId, references: [{ referenceVersion: 'v2', text: 'Could I have some tea, please?', startSeconds: 1, endSeconds: 5 }] }] };
  f.engine.registerMaterial(edited); f.engine.input('X'); f.engine.submit();
  assert.equal(current(f.engine.getSnapshot()).reference.text, oldAttempt.reference.text);
  assert.equal(current(f.engine.getSnapshot()).reference.startSeconds, 0);
  assert.equal(f.engine.retryAttempt().reference.referenceVersion, 'v1');
  const changedText: PracticeMaterial = { ...edited, units: [{ unitId: oldAttempt.reference.unitId, references: [{ ...material.units[0].references[0], text: 'silently rewritten' }] }] };
  assert.throws(() => f.engine.registerMaterial(changedText), /content conflict/);
  const changedRange: PracticeMaterial = { ...edited, units: [{ unitId: oldAttempt.reference.unitId, references: [{ ...material.units[0].references[0], endSeconds: 5 }] }] };
  assert.throws(() => f.engine.registerMaterial(changedRange), /content conflict/);
  f.engine.endRound(); f.engine.startRound({ materialId: material.materialId });
  const next = f.engine.startAttempt({ unitId: oldAttempt.reference.unitId, mode: 'dictation' });
  assert.equal(next.reference.referenceVersion, 'v2'); assert.equal(next.reference.text, edited.units[0].references[0].text);
  assert.equal(next.reference.startSeconds, 1); assert.equal(next.reference.endSeconds, 5);
  assert.deepEqual(f.engine.getSnapshot().projections.attempts[oldAttempt.attemptId].reference, oldAttempt.reference);
});

test('reference bounds are finite and verified against known duration; unknown duration stays explicitly unverified', () => {
  const material = ORIGINAL_PRACTICE_MATERIAL;
  function changedReference(startSeconds: number, endSeconds: number): PracticeMaterial {
    return { ...material, units: [{ ...material.units[0], references: [{ ...material.units[0].references[0], startSeconds, endSeconds }] }] };
  }
  for (const invalid of [[-1, 6], [6, 6], [7, 6], [0, 19], [0, Infinity], [NaN, 5]]) {
    assert.throws(() => fixture([changedReference(invalid[0], invalid[1])]));
  }
  const f = fixture([{ ...changedReference(1, 100), durationSeconds: null }]); const attempt = f.start();
  assert.equal(attempt.reference.rangeVerification, 'duration-unknown'); assert.equal(attempt.reference.materialDurationSeconds, null);
  assert.equal(attempt.reference.endSeconds, 100);
  assert.equal(fixture().start().reference.rangeVerification, 'verified');
});

test('recording comparison remains in progress and unassessed without invented media evidence', () => {
  const f = fixture(); const attempt = f.start('recording-comparison'); f.engine.input('A note is not a recording');
  const before = f.engine.getSnapshot(); assert.throws(() => f.engine.submit(), /real media evidence/);
  assert.equal(f.engine.getSnapshot(), before);
  const comparison = current(before); assert.equal(comparison.practiceComplete, false);
  assert.equal(comparison.evaluationComplete, false); assert.equal(comparison.targetMet, null);
  assert.equal(comparison.firstSubmission, null); assert.deepEqual(comparison.revisions, []);
  assert.throws(() => f.engine.dispatch(f.event({ type: 'submissionCommitted', attemptId: attempt.attemptId, submissionId: 'fabricated-audio', draftVersion: 1 })), /real media evidence/);
});

test('practice completion, word evaluation and target correctness are distinct and follow the existing alignment rules', () => {
  const f = fixture(); const attempt = f.start(); f.engine.input('X'); const wrong = f.engine.submit();
  assert.equal(wrong.practiceComplete, true); assert.equal(wrong.evaluationComplete, true); assert.equal(wrong.targetMet, false);
  assert.deepEqual(wrong.alignment, align(attempt.reference.text, 'X'));
  f.engine.input(attempt.reference.text); const correct = f.engine.submit();
  assert.equal(correct.targetMet, true); assert.deepEqual(correct.alignment, align(attempt.reference.text, attempt.reference.text));
  f.engine.input('An unsubmitted revision'); const inProgress = current(f.engine.getSnapshot());
  assert.equal(inProgress.practiceComplete, true); assert.equal(inProgress.evaluationComplete, false); assert.equal(inProgress.targetMet, null);
  assert.equal(inProgress.revisions[0].targetMet, true); assert.equal(inProgress.firstSubmission?.targetMet, false);
  const unscorable: PracticeMaterial = { ...ORIGINAL_PRACTICE_MATERIAL, units: [{ unitId: 'non-english', references: [{ referenceVersion: 'v1', text: '你好', startSeconds: 0, endSeconds: 6 }] }] };
  const other = fixture([unscorable]); other.start(); other.engine.input('你好'); const unassessed = other.engine.submit();
  assert.equal(unassessed.practiceComplete, true); assert.equal(unassessed.evaluationComplete, false);
  assert.equal(unassessed.alignment, null); assert.equal(unassessed.targetMet, null);
});

test('exact event duplicates are idempotent while a reused ID with different facts is rejected', () => {
  const f = fixture(); f.start(); f.engine.input('X'); f.engine.submit(); const before = f.engine.getSnapshot();
  const event = before.events.find(item => item.payload.type === 'inputCommitted')!;
  assert.equal(f.engine.dispatch(structuredClone(event)), before);
  assert.deepEqual(replayPracticeEvents([...before.events, structuredClone(event)]), before);
  const altered = { ...event, payload: { ...event.payload, text: 'Y' } } as PracticeEvent;
  assert.throws(() => f.engine.dispatch(altered), /Conflicting duplicate/);
  assert.throws(() => replayPracticeEvents([...before.events, altered]), /Conflicting duplicate/);
  assert.equal(f.engine.getSnapshot(), before);
});

test('JSON restoration checks schema, sequence, payload shape and projections instead of trusting cached facts', () => {
  const f = fixture(); f.start(); f.engine.input('X'); f.engine.submit(); const before = f.engine.getSnapshot();
  assert.equal(validatePracticeSnapshot(before), before);
  const wire = JSON.parse(JSON.stringify(before)) as PracticeSnapshot;
  assert.deepEqual(validatePracticeSnapshot(wire), before);
  const forged = structuredClone(before) as unknown as { projections: { activeMs: number } }; forged.projections.activeMs = 999;
  assert.throws(() => validatePracticeSnapshot(forged as PracticeSnapshot), /canonical event replay/);
  const wrongSchema = { ...wire, schemaVersion: 'future' } as unknown as PracticeSnapshot;
  assert.throws(() => validatePracticeSnapshot(wrongSchema), /Unsupported practice snapshot/);
  const missing = before.events.filter((_, index) => index !== 2); assert.throws(() => replayPracticeEvents(missing), /noncontiguous/);
  const unexpected = { ...before.events[0], silentUserData: 'forbidden extra' };
  assert.throws(() => replayPracticeEvents([unexpected]), /JSON fields/);
  assert.throws(() => new PracticeEngine({ snapshot: before, catalog: [] }), /overriding catalog/);
  assert.throws(() => new PracticeEngine({ snapshot: before, sessionId: 'different' }), /session ID mismatch/);
  assert.deepEqual(Object.keys(before).sort(), ['events', 'projections', 'schemaVersion', 'sequence', 'sessionId']);
});

test('time sampling only observes open attempt intervals and rejects a backwards monotonic clock', () => {
  const f = fixture(); f.advance(10_000); f.start(); f.advance(2000); f.engine.sampleClock(); f.engine.endRound();
  f.advance(9000); f.engine.sampleClock(); assert.equal(f.engine.getSnapshot().projections.activeMs, 2000);
  f.advance(-1); assert.throws(() => f.engine.sampleClock(), /backwards/);
});


test('preparation, correction and shadowing exposure precede an attempt and survive refresh', () => {
  const f = fixture(); f.engine.startRound({ materialId: ORIGINAL_PRACTICE_MATERIAL.materialId });
  f.engine.exposeUnitReference('cafe-order', 'correction'); f.engine.exposeUnitReference('cafe-order', 'shadowing');
  const prepared = f.engine.getSnapshot(); assert.equal(prepared.projections.currentAttemptId, null);
  const restored = new PracticeEngine({ clock: f.clock, snapshot: JSON.parse(JSON.stringify(prepared)) });
  restored.startAttempt({ unitId: 'cafe-order', mode: 'dictation' }); restored.input('X');
  const submission = restored.submit();
  assert.deepEqual(submission.exposureAtSubmission.map(item => item.kind), ['correction', 'shadowing']);
  assert.deepEqual(submission.exposureAtSubmission.map(item => item.attemptId), [null, null]);
  assert.equal(round(restored.getSnapshot()).unitExposure['cafe-order'].afterFirstSubmission.length, 0);
  assert.throws(() => restored.exposeUnitReference('missing-unit', 'hint'), /Unknown exposure unit/);
  restored.pausePractice(); const paused = restored.getSnapshot();
  assert.throws(() => restored.exposeUnitReference('cafe-order', 'hint'), /manually paused/);
  assert.equal(restored.getSnapshot(), paused);
});


test('ordinary prototype method names remain valid unit, round and attempt IDs across JSON replay', () => {
  const names = ['toString', 'valueOf', 'hasOwnProperty'];
  const material: PracticeMaterial = { ...ORIGINAL_PRACTICE_MATERIAL,
    units: ORIGINAL_PRACTICE_MATERIAL.units.map((unit, index) => ({ ...unit, unitId: names[index] })) };
  const f = fixture([material]);
  for (const [index, name] of names.entries()) {
    f.engine.startRound({ materialId: material.materialId, practiceRoundId: name });
    if (index === 0) f.engine.exposeUnitReference(name, 'correction');
    const attempt = f.engine.startAttempt({ unitId: name, mode: 'dictation', attemptId: name });
    assert.equal(attempt.attemptId, name); assert.equal(attempt.reference.unitId, name);
    assert.equal(round(f.engine.getSnapshot()).practiceRoundId, name);
    if (index === 1) f.engine.exposeReference('hint');
    f.engine.input('X'); const first = f.engine.submit();
    assert.equal(first.answer, 'X');
    assert.equal(first.exposureAtSubmission.length, index < 2 ? 1 : 0);
    f.engine.exposeReference('reveal');
    const exposure = round(f.engine.getSnapshot()).unitExposure[name];
    assert.equal(exposure.firstSubmissionSequence, first.sequence);
    assert.equal(exposure.afterFirstSubmission.length, 1);
    f.advance(10); f.engine.sampleClock(); assert.equal(current(f.engine.getSnapshot()).activeMs, 10);
    const restored = new PracticeEngine({ clock: f.clock, snapshot: JSON.parse(JSON.stringify(f.engine.getSnapshot())) });
    assert.deepEqual(restored.getSnapshot(), f.engine.getSnapshot());
    assert.equal(current(restored.getSnapshot()).firstSubmission?.answer, 'X');
    f.engine.endRound();
    assert.throws(() => f.engine.startRound({ materialId: material.materialId, practiceRoundId: name }), /already exists/);
  }
  f.engine.startRound({ materialId: material.materialId, practiceRoundId: 'after-special-ids' });
  assert.throws(() => f.engine.startAttempt({ unitId: names[0], mode: 'dictation', attemptId: names[0] }), /Attempt ID already exists/);
  assert.deepEqual(replayPracticeEvents(f.engine.getSnapshot().events), f.engine.getSnapshot());
});

test('reserved prototype keys still reject at every ID boundary without prototype pollution', () => {
  for (const name of ['__proto__', 'constructor', 'prototype']) {
    assert.throws(() => new PracticeEngine({ sessionId: name }), /Invalid stable ID/);
    const material: PracticeMaterial = { ...ORIGINAL_PRACTICE_MATERIAL,
      units: [{ ...ORIGINAL_PRACTICE_MATERIAL.units[0], unitId: name }] };
    assert.throws(() => fixture([material]), /Invalid stable ID/);
    const f = fixture();
    assert.throws(() => f.engine.startRound({ materialId: ORIGINAL_PRACTICE_MATERIAL.materialId, practiceRoundId: name }), /Invalid stable ID/);
    f.engine.startRound({ materialId: ORIGINAL_PRACTICE_MATERIAL.materialId });
    assert.throws(() => f.engine.startAttempt({ unitId: 'cafe-order', mode: 'dictation', attemptId: name }), /Invalid stable ID/);
    assert.throws(() => f.engine.exposeUnitReference(name, 'hint'), /Invalid stable ID/);
    const invalidEvent = f.event({ type: 'referenceExposed', unitId: name, attemptId: null, kind: 'hint' });
    assert.throws(() => replayPracticeEvents([...f.engine.getSnapshot().events, invalidEvent]), /Invalid stable ID/);
    assert.equal(Object.getPrototypeOf(f.engine.getSnapshot().projections.rounds), Object.prototype);
    assert.deepEqual(f.engine.getSnapshot().projections.attempts, {});
    assert.deepEqual(round(f.engine.getSnapshot()).unitExposure, {});
  }
});


test('practice v1 rejects missing Intl.Segmenter before creation or replay instead of changing grapheme facts', () => {
  const f = fixture(); const attempt = f.start(); f.engine.input('👩‍💻', 'ime');
  const before = f.engine.getSnapshot(); const wire = JSON.parse(JSON.stringify(before)) as PracticeSnapshot;
  assert.equal(current(before).draft.addedTypedGraphemes, 1);
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')!;
  Object.defineProperty(Intl, 'Segmenter', { ...descriptor, value: undefined });
  try {
    assert.throws(() => new PracticeEngine(), /Unsupported practice environment: Intl.Segmenter is required/);
    assert.throws(() => new PracticeEngine({ snapshot: before }), /Intl.Segmenter is required/);
    assert.throws(() => replayPracticeEvents(wire.events), /Intl.Segmenter is required/);
    assert.throws(() => validatePracticeSnapshot(wire), /Intl.Segmenter is required/);
    assert.throws(() => validatePracticeSnapshot(before), /Intl.Segmenter is required/);
    assert.throws(() => f.engine.input('👩‍💻!'), /Intl.Segmenter is required/);
    assert.throws(() => f.engine.dispatch(f.event({ type: 'inputCommitted', attemptId: attempt.attemptId, text: '👩‍💻!', source: 'typed' })), /Intl.Segmenter is required/);
    assert.equal(f.engine.getSnapshot(), before);
    assert.equal(current(before).draft.addedTypedGraphemes, 1);
  } finally { Object.defineProperty(Intl, 'Segmenter', descriptor); }
  assert.deepEqual(validatePracticeSnapshot(wire), before);
});
