import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TRAINING_SCHEMA, NPS_MATERIAL, NPS_COURSE_MEDIA } from './builtin-material.ts';
import { TrainingEngine, SCHEMA_VERSION, RULE_VERSION, PACE_RULE_VERSION, CAFE_MATERIAL, createInitialSnapshot, replay, reduceTraining, validateSnapshot, exportSession, type Material, type TrainingSnapshot, type TrainingEvent } from './training.ts';
import { LegacyHistoryError, readLegacyHistoryRecord } from './legacy-history.ts';
import { TrainingHistorySegmentProjector, assertWritableTrainingHistorySegment } from './training-history-segment.ts';
import { readTrainingHistorySegment } from './repository.ts';
import { exportTrainingHistorySegment } from './segment-history-reader.ts';
import { buildReviewTarget, captureReviewTarget, validateFullReviewSource, validatePartialReviewSource } from './review-tasks.ts';
import { LOCAL_REFERENCE_MEDIA_ID, LOCAL_REFERENCE_MEDIA_SHA256, buildLocalReferenceProposal } from './local-reference.ts';

function fixture(material: Material = NPS_MATERIAL) {
  let serial = 0, now = 0;
  const clock = { now: () => now, wallTime: () => new Date(Date.UTC(2026, 9, 10) + now).toISOString(), id: () => `builtin-test-${++serial}` };
  return { engine: new TrainingEngine({ material, clock }), clock, advance(ms: number) { now += ms; } };
}
function record(snapshot: TrainingSnapshot) { return { sessionId: snapshot.sessionId, sequence: snapshot.sequence, snapshot, updatedAt: '2026-10-10T01:00:00.000Z' }; }
function projector(snapshot: TrainingSnapshot) { return new TrainingHistorySegmentProjector(snapshot, { segmentId: 'nps-partial', writerInstanceId: 'writer', generation: 1, startedAt: '2026-10-10T00:00:00.000Z' }); }
const media = { id: NPS_COURSE_MEDIA.mediaId, sha256: NPS_COURSE_MEDIA.mediaSha256, durationSeconds: NPS_COURSE_MEDIA.durationSeconds };
const cafeMedia = { id: LOCAL_REFERENCE_MEDIA_ID, sha256: LOCAL_REFERENCE_MEDIA_SHA256, durationSeconds: 72 };
const native = (data: string) => ({ version: 'dom-edit-v1' as const, kind: 'input' as const, inputType: 'insertText', data });

test('NPS full session and every actual event use the new profile with unchanged grading rules', () => {
  const f = fixture(); f.engine.input('Hi, everybody.', 'typed', native('Hi, everybody.')); f.advance(125); const attempt = f.engine.submit()!;
  f.engine.nextCue(); f.engine.exposeHint('hint'); f.engine.input('My name'); f.engine.submit();
  const snapshot = f.engine.getSnapshot();
  assert.equal(snapshot.schemaVersion, BUILTIN_TRAINING_SCHEMA);
  assert.ok(snapshot.events.length > 4); assert.ok(snapshot.events.every(e => e.schemaVersion === BUILTIN_TRAINING_SCHEMA && e.ruleVersion === RULE_VERSION && e.paceRuleVersion === PACE_RULE_VERSION));
  assert.equal(attempt.accuracy, 100); assert.equal(attempt.words, 2); assert.equal(attempt.gain, 2);
  assert.equal(attempt.reference, NPS_MATERIAL.cues[0].text); assert.equal(attempt.materialId, NPS_MATERIAL.id); assert.equal(attempt.materialVersion, NPS_MATERIAL.version);
  assert.deepEqual(replay(snapshot.events), snapshot); assert.deepEqual(validateSnapshot(structuredClone(snapshot)), snapshot);
  const restored = new TrainingEngine({ snapshot, clock: f.clock, restoredReadOnly: true });
  assert.equal(restored.isPassiveRestored, true); assert.deepEqual(restored.getSnapshot(), snapshot);
  const exported = exportSession(snapshot, '2026-10-10T02:00:00.000Z');
  assert.deepEqual(JSON.parse(exported.json).session, snapshot); assert.ok(exported.csv.includes(BUILTIN_TRAINING_SCHEMA));
  const read = readLegacyHistoryRecord(record(snapshot)); assert.deepEqual(read.snapshot, snapshot); assert.equal(read.summary.schemaVersion, BUILTIN_TRAINING_SCHEMA);
  f.engine.resetSession(); assert.equal(f.engine.getSnapshot().schemaVersion, BUILTIN_TRAINING_SCHEMA); assert.equal(f.engine.getSnapshot().attempts.length, 0);
  f.engine.startReferenceSession(CAFE_MATERIAL, 0); assert.equal(f.engine.getSnapshot().schemaVersion, SCHEMA_VERSION);
  f.engine.startReferenceSession(NPS_MATERIAL, 10); assert.equal(f.engine.getSnapshot().schemaVersion, BUILTIN_TRAINING_SCHEMA); assert.equal(f.engine.cue.id, NPS_MATERIAL.cues[10].id);
});

test('snapshot, event and material profile mismatches reject rather than normalize or downgrade', () => {
  const { engine } = fixture(); engine.input(engine.cue.text); engine.submit(); const valid = engine.getSnapshot();
  for (const index of valid.events.keys()) {
    const changed = structuredClone(valid) as any; changed.events[index].schemaVersion = SCHEMA_VERSION;
    assert.throws(() => replay(changed.events)); assert.throws(() => validateSnapshot(changed));
    assert.throws(() => new TrainingEngine({ snapshot: changed })); assert.throws(() => readLegacyHistoryRecord(record(changed)));
    assert.throws(() => exportSession(changed)); assert.throws(() => projector(changed));
  }
  for (const source of [valid, fixture(CAFE_MATERIAL).engine.getSnapshot()]) {
    const changed = structuredClone(source) as any; changed.schemaVersion = source.schemaVersion === SCHEMA_VERSION ? BUILTIN_TRAINING_SCHEMA : SCHEMA_VERSION;
    assert.throws(() => validateSnapshot(changed)); assert.throws(() => new TrainingEngine({ snapshot: changed }));
    assert.throws(() => readLegacyHistoryRecord(record(changed))); assert.throws(() => exportSession(changed)); assert.throws(() => projector(changed));
  }
  const unknown = structuredClone(valid) as any; unknown.schemaVersion = 'future'; unknown.events.forEach((e: any) => { e.schemaVersion = 'future'; });
  assert.throws(() => replay(unknown.events)); assert.throws(() => readLegacyHistoryRecord(record(unknown)), (e: unknown) => e instanceof LegacyHistoryError && e.code === 'unsupported-schema');
  const initial = createInitialSnapshot(valid.sessionId, NPS_MATERIAL);
  assert.throws(() => reduceTraining(initial, { ...valid.events[0], schemaVersion: SCHEMA_VERSION }));
});

test('missing or modified NPS source binding is rejected at engine, replay, history and transition admission', () => {
  const f = fixture(CAFE_MATERIAL); const unchanged = f.engine.getSnapshot();
  const source = fixture().engine.getSnapshot();
  for (const edit of [(v: any) => { delete v.builtinReference; }, (v: any) => { v.builtinReference.media.sha256 = '0'.repeat(64); }, (v: any) => { v.cues[0].text = 'invented'; }]) {
    const material = structuredClone(NPS_MATERIAL); edit(material);
    assert.throws(() => createInitialSnapshot('invalid', material)); assert.throws(() => new TrainingEngine({ material }));
    assert.throws(() => f.engine.startReferenceSession(material, 0)); assert.equal(f.engine.getSnapshot(), unchanged);
    const invalid = structuredClone(source) as any; invalid.material = material; invalid.events[0].material = material;
    assert.throws(() => replay(invalid.events)); assert.throws(() => validateSnapshot(invalid));
    assert.throws(() => readLegacyHistoryRecord(record(invalid)), (e: unknown) => e instanceof LegacyHistoryError && e.code === 'invalid-material');
  }
});

test('structural full history preserves actual stored scores and unknown historical rules without rescoring', () => {
  const { engine } = fixture(); engine.input(engine.cue.text); engine.submit();
  const saved = structuredClone(engine.getSnapshot()) as any;
  saved.attempts[0].accuracy = 37; saved.attempts[0].ruleVersion = 'historical-rule'; saved.earnedWords = 77;
  saved.events.forEach((e: any) => { e.ruleVersion = 'historical-rule'; });
  const read = readLegacyHistoryRecord(record(saved));
  assert.equal(read.snapshot.attempts[0].accuracy, 37); assert.equal(read.summary.earnedWords, 77);
  assert.deepEqual(read.summary.ruleVersions, ['historical-rule']); assert.deepEqual(read.snapshot, saved);
});

test('NPS partial history changes only existing rule provenance and retains unknown/permission boundaries', () => {
  const f = fixture(); f.engine.input('private-before-on'); const p = projector(f.engine.getSnapshot());
  const unsubscribe = f.engine.subscribe(() => p.observe(f.engine.getSnapshot()));
  f.engine.input('private-before-on updated', 'typed', native(' updated')); f.engine.submit();
  const segment = p.getSegment();
  assert.equal(segment.schemaVersion, 'lingotrace-history-segment-v1'); assert.equal(segment.rules.trainingSchemaVersion, BUILTIN_TRAINING_SCHEMA);
  assert.deepEqual(Object.keys(segment).sort(), ['schemaVersion','sessionId','segmentId','writerInstanceId','generation','material','rules','startedAt','endedAt','coverage','replayable','facts'].sort());
  assert.deepEqual(segment.material, { id: NPS_MATERIAL.id, version: NPS_MATERIAL.version });
  assert.equal(segment.coverage, 'partial'); assert.equal(segment.replayable, false);
  const json = JSON.stringify(segment);
  for (const absent of ['private-before-on','builtinReference','sourcePage','officialCaptionSha256','sentenceMapSha256','durationSeconds','conditions','reference']) assert.equal(json.includes(absent), false, absent);
  assert.ok(segment.facts.filter(fact => fact.type === 'inputCommitted' || fact.type === 'submitRequested' || fact.type === 'judgmentApplied').every(fact => 'retention' in fact && fact.retention === 'redacted'));
  assert.doesNotThrow(() => assertWritableTrainingHistorySegment(segment));
  const read = readTrainingHistorySegment(structuredClone(segment)); assert.deepEqual(read, segment);
  assert.throws(() => assertWritableTrainingHistorySegment(read));
  const exported = exportTrainingHistorySegment(read); assert.deepEqual(JSON.parse(exported.json), segment); assert.ok(exported.csv.includes(BUILTIN_TRAINING_SCHEMA));
  assert.equal(f.engine.getSnapshot().schemaVersion, BUILTIN_TRAINING_SCHEMA);
  unsubscribe();
});

test('partial observation rejects mixed source/event profiles before adding any facts', () => {
  const f = fixture(), p = projector(f.engine.getSnapshot()), before = p.getSegment();
  f.engine.input('Hi', 'typed', native('Hi'));
  const invalid = structuredClone(f.engine.getSnapshot()) as any; invalid.events.at(-1).schemaVersion = SCHEMA_VERSION;
  assert.throws(() => p.observe(invalid)); assert.equal(p.getSegment(), before);
  const wrongTop = { ...f.engine.getSnapshot(), schemaVersion: SCHEMA_VERSION } as TrainingSnapshot;
  assert.throws(() => p.observe(wrongTop)); assert.equal(p.getSegment(), before);
  const wrongPrefix = structuredClone(f.engine.getSnapshot()) as any; wrongPrefix.events[0].schemaVersion = SCHEMA_VERSION;
  assert.throws(() => p.observe(wrongPrefix)); assert.equal(p.getSegment(), before);
  const missingStartBinding = structuredClone(f.engine.getSnapshot()) as any; delete missingStartBinding.events[0].material.builtinReference;
  assert.throws(() => p.observe(missingStartBinding)); assert.equal(p.getSegment(), before);
  assert.throws(() => projector(missingStartBinding)); assert.throws(() => exportSession(missingStartBinding));
  p.observe(f.engine.getSnapshot()); assert.equal(p.getSegment().facts.length, 1);
});

test('review targets bind exact NPS reference to its own media/hash and actual bounded duration', async () => {
  for (const delta of [0, 0.0005, -0.0005]) {
    const target = await buildReviewTarget(NPS_MATERIAL, NPS_MATERIAL.cues[10].id, { ...media, durationSeconds: media.durationSeconds + delta });
    assert.deepEqual(target.material, NPS_MATERIAL); assert.equal(target.media.id, media.id);
    assert.equal(captureReviewTarget(target).materialDigest, target.materialDigest);
  }
  for (const invalidMedia of [cafeMedia, { ...media, id: cafeMedia.id }, { ...media, sha256: cafeMedia.sha256 }, { ...media, durationSeconds: 72 }, { ...media, durationSeconds: 43 },
    { ...media, durationSeconds: NaN }, { ...media, durationSeconds: Infinity }, { ...media, durationSeconds: 0 }, { ...media, durationSeconds: media.durationSeconds + 0.0011 }]) {
    await assert.rejects(buildReviewTarget(NPS_MATERIAL, NPS_MATERIAL.cues[0].id, invalidMedia));
  }
  await assert.rejects(buildReviewTarget(CAFE_MATERIAL, CAFE_MATERIAL.cues[0].id, media));
  const missing = structuredClone(NPS_MATERIAL) as any; delete missing.builtinReference;
  await assert.rejects(buildReviewTarget(missing, NPS_MATERIAL.cues[0].id, media));
  const altered = structuredClone(NPS_MATERIAL) as any; altered.cues[0].text = 'altered';
  await assert.rejects(buildReviewTarget(altered, altered.cues[0].id, media));
  await assert.rejects(buildReviewTarget({ ...CAFE_MATERIAL, id: 'arbitrary' }, CAFE_MATERIAL.cues[0].id, cafeMedia));
});

test('genuine NPS full and retained-partial attempts prove review source without fabricating assistance', async () => {
  const f = fixture(), p = projector(f.engine.getSnapshot()); f.engine.subscribe(() => p.observe(f.engine.getSnapshot()));
  f.engine.input(f.engine.cue.text, 'typed', native(f.engine.cue.text)); const attempt = f.engine.submit()!;
  const snapshot = f.engine.getSnapshot(), target = await buildReviewTarget(NPS_MATERIAL, f.engine.cue.id, media);
  const submit = snapshot.events.find(e => e.type === 'submitRequested')!, judgment = snapshot.events.find(e => e.type === 'judgmentApplied')!;
  const full = { kind: 'full' as const, sessionId: snapshot.sessionId, attemptId: attempt.attemptId, submitEventId: submit.eventId, judgmentEventId: judgment.eventId };
  assert.deepEqual(validateFullReviewSource(snapshot, full, target), attempt);
  const partial = { ...full, kind: 'partial' as const, segmentId: p.getSegment().segmentId, generation: 1 };
  const result = validatePartialReviewSource(p.getSegment(), partial, target);
  assert.deepEqual(result, { answer: attempt.answer, accuracy: attempt.accuracy, errors: attempt.errors, words: attempt.words, alignment: attempt.alignment });
  assert.equal('conditions' in result, false); assert.equal('reference' in result, false);
  assert.throws(() => validateFullReviewSource({ ...snapshot, schemaVersion: SCHEMA_VERSION }, full, target));
  const mixed = structuredClone(snapshot) as any; mixed.events.at(-1).schemaVersion = SCHEMA_VERSION;
  assert.throws(() => validateFullReviewSource(mixed, full, target));
  assert.throws(() => validatePartialReviewSource({ ...p.getSegment(), rules: { ...p.getSegment().rules, trainingSchemaVersion: SCHEMA_VERSION } }, partial, target));
});

test('cafe and local-correction sessions keep v1 while NPS correction remains unavailable', async () => {
  const proposal = await buildLocalReferenceProposal({ parent: CAFE_MATERIAL, original: CAFE_MATERIAL, editedCueId: CAFE_MATERIAL.cues[0].id,
    text: 'Could I please have a coffee?', start: 0, end: 6, media: cafeMedia, saveRequestId: 'coffee-only', version: 'local-ref:coffee-only', createdAt: '2026-10-10T00:00:00.000Z' });
  for (const material of [CAFE_MATERIAL, proposal.material]) {
    const f = fixture(material); f.engine.input(f.engine.cue.text); f.engine.submit(); const saved = f.engine.getSnapshot();
    assert.equal(saved.schemaVersion, SCHEMA_VERSION); assert.ok(saved.events.every(e => e.schemaVersion === SCHEMA_VERSION));
    assert.equal('builtinReference' in saved.material, false); assert.equal(projector(saved).getSegment().rules.trainingSchemaVersion, SCHEMA_VERSION);
    assert.equal(JSON.stringify(exportSession(saved)).includes(BUILTIN_TRAINING_SCHEMA), false);
    assert.deepEqual((await buildReviewTarget(material, material.cues[0].id, cafeMedia)).material, material);
  }
  await assert.rejects(buildLocalReferenceProposal({ parent: NPS_MATERIAL, original: CAFE_MATERIAL, editedCueId: NPS_MATERIAL.cues[0].id,
    text: 'Hello, everybody.', start: 0.77, end: 1.53, media, saveRequestId: 'unsupported-nps-correction' }));
});
