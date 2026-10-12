import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import {
  CAFE_MATERIAL, TrainingEngine, createInitialSnapshot, exportSession, getDraft, replay,
  type EngineClock, type EventPayload, type Material, type TrainingEvent, type TrainingSnapshot,
} from './training.ts';
import * as frozenV62 from './fixtures/training-v62.ts';
import { isReferenceExposure, projectAttemptReferenceExposure, validateOptionalReferenceExposure, type ReferenceExposure } from './reference-exposure.ts';
import { LOCAL_REFERENCE_MEDIA_ID, LOCAL_REFERENCE_MEDIA_SHA256, LOCAL_REFERENCE_TRACK_ID } from './local-reference.ts';
import { LegacyHistoryError, readLegacyHistoryRecord } from './legacy-history.ts';
import { IndexedDBTrainingRepository, readTrainingHistorySegment } from './repository.ts';
import { TrainingHistorySegmentProjector } from './training-history-segment.ts';

const EDITOR: ReferenceExposure = { version: 'reference-exposure-v1', surface: 'correction-editor' };
const CONFIRMATION: ReferenceExposure = { version: 'reference-exposure-v1', surface: 'corrected-version-confirmation' };
const EXPORT_AT = '2026-10-10T00:00:00.000Z';
function driver(name = 'case') {
  let now = 0, serial = 0;
  const clock: EngineClock = { now: () => now, wallTime: () => new Date(Date.UTC(2026, 9, 9) + now).toISOString(), id: () => `${name}-${++serial}` };
  return { clock, advance(ms: number) { now += ms; } };
}
function corrected(index = 2): Material {
  return { ...CAFE_MATERIAL, version: 'local-ref:test-version', cues: CAFE_MATERIAL.cues.map((cue, position) =>
    position === index ? { ...cue, text: 'I would like a very small hot coffee.', start: cue.start + 0.1, end: cue.end - 0.1 } : { ...cue }),
  localReference: { version: 'local-reference-v1', trackId: LOCAL_REFERENCE_TRACK_ID, language: 'en', parentVersion: CAFE_MATERIAL.version,
    editedCueId: CAFE_MATERIAL.cues[index].id, media: { id: LOCAL_REFERENCE_MEDIA_ID, sha256: LOCAL_REFERENCE_MEDIA_SHA256, durationSeconds: 72 } } };
}
function stored(snapshot: TrainingSnapshot) { return { sessionId: snapshot.sessionId, sequence: snapshot.sequence, snapshot, updatedAt: EXPORT_AT }; }
function event(engine: TrainingEngine, payload: EventPayload): TrainingEvent {
  const state = engine.getSnapshot(), first = state.events[0];
  return { ...payload, eventId: `manual-${state.sequence + 1}`, sessionId: state.sessionId, sequence: state.sequence + 1,
    wallTime: EXPORT_AT, activeMs: state.activeMs, cueId: engine.cue.id, inputVersion: getDraft(state).version,
    schemaVersion: first.schemaVersion, ruleVersion: first.ruleVersion, paceRuleVersion: first.paceRuleVersion,
    materialId: state.material.id, materialVersion: state.material.version };
}

test('the frozen v62 compatibility oracle matches immutable c50e271 source', () => {
  const source = readFileSync(new URL('./fixtures/training-v62.ts', import.meta.url), 'utf8').replace("'../input-observation.ts'", "'./input-observation.ts'");
  assert.equal(createHash('sha256').update(source).digest('hex'), '8930de8fe1afbb84b96662719e0b032a1d90d2957f2f053c48b2f2d4a72e3024');
});

test('old inputs, scores, events, reset and fixed-boundary JSON/CSV remain byte-identical to v62', () => {
  const currentDriver = driver(), oldDriver = driver();
  const current = new TrainingEngine({ clock: currentDriver.clock, inputObservation: { runId: 'run' } });
  const old = new frozenV62.TrainingEngine({ clock: oldDriver.clock, inputObservation: { runId: 'run' } });
  for (const [engine, clock] of [[current, currentDriver], [old, oldDriver]] as const) {
    engine.exposeHint('hint'); engine.input('Could I have a coffee'); clock.advance(120); engine.submit();
    engine.exposeHint('reveal'); engine.input('Could I have a coffee, please?'); clock.advance(50); engine.submit();
    engine.nextCue(3); engine.input('Do you have any oat milk?', 'paste'); engine.submit();
  }
  assert.equal(JSON.stringify(current.getSnapshot()), JSON.stringify(old.getSnapshot()));
  assert.deepEqual(exportSession(current.getSnapshot(), EXPORT_AT), frozenV62.exportSession(old.getSnapshot(), EXPORT_AT));
  assert.deepEqual(readLegacyHistoryRecord(stored(current.getSnapshot())).snapshot, old.getSnapshot());
  current.resetSession(); old.resetSession();
  assert.equal(JSON.stringify(current.getSnapshot()), JSON.stringify(old.getSnapshot()));
  assert.deepEqual(exportSession(current.getSnapshot(), EXPORT_AT), frozenV62.exportSession(old.getSnapshot(), EXPORT_AT));
  assert.ok(current.getSnapshot().events.every(item => !Object.hasOwn(item, 'referenceExposure')));
  assert.ok(!Object.hasOwn(current.getSnapshot().material, 'localReference'));
});

test('old material without metadata keeps the existing relaxed engine and history read rules', () => {
  const material: Material = { id: 'retained', version: 'old', title: '', rights: '', cues: [{ id: 'empty-preview', text: '', start: 2, end: 2 }] };
  const current = new TrainingEngine({ material, clock: driver().clock }).getSnapshot();
  const old = new frozenV62.TrainingEngine({ material, clock: driver().clock }).getSnapshot();
  assert.deepEqual(current, old); assert.deepEqual(replay(current.events), current);
  assert.deepEqual(readLegacyHistoryRecord(stored(current)).snapshot, current);
});

test('real editor exposure survives cancel, navigation and input edits; earlier attempts stay untouched', () => {
  const engine = new TrainingEngine({ clock: driver().clock });
  engine.input(engine.cue.text); const first = engine.submit()!, before = exportSession(engine.getSnapshot(), EXPORT_AT);
  engine.exposeHint('reveal', EDITOR); // Closing/canceling the editor has no Training operation.
  assert.equal(projectAttemptReferenceExposure(engine.getSnapshot(), first).status, 'unknown');
  assert.equal(first.conditions.revealed, false); assert.deepEqual(before.snapshot.attempts[0], first);
  engine.nextCue(1); engine.nextCue(0); engine.input(`${engine.cue.text} extra`); const second = engine.submit()!;
  assert.equal(second.conditions.revealed, true);
  const projected = projectAttemptReferenceExposure(engine.getSnapshot(), second);
  assert.equal(projected.status, 'recorded');
  if (projected.status !== 'recorded') assert.fail('expected positive evidence');
  assert.deepEqual(projected.surfaces, ['correction-editor']); assert.equal(projected.eventIds.length, 1);
  assert.ok(Object.isFrozen(projected)); assert.ok(Object.isFrozen(projected.surfaces));
  assert.deepEqual(projectAttemptReferenceExposure(engine.getSnapshot(), first), { status: 'unknown' });
  assert.equal(JSON.stringify(first), JSON.stringify(before.snapshot.attempts[0]));
});

test('an exposure after submitRequested but before judgment cannot relabel that attempt', () => {
  const engine = new TrainingEngine({ clock: driver().clock }); engine.input(engine.cue.text);
  engine.dispatch(event(engine, { type: 'submitRequested', attemptId: 'pending', answer: engine.draft, draftVersion: getDraft(engine.getSnapshot()).version }));
  engine.exposeHint('reveal', EDITOR); engine.dispatch(event(engine, { type: 'judgmentApplied', attemptId: 'pending' }));
  const attempt = engine.getSnapshot().attempts[0]; assert.equal(attempt.conditions.revealed, false);
  assert.deepEqual(projectAttemptReferenceExposure(engine.getSnapshot(), attempt), { status: 'unknown' });
});

test('positive projection is scoped to exact session, round, material, version, cue and submit identity', () => {
  const engine = new TrainingEngine({ clock: driver().clock }); engine.exposeHint('reveal', EDITOR);
  engine.nextCue(1); engine.input(engine.cue.text); const otherCue = engine.submit()!;
  assert.deepEqual(projectAttemptReferenceExposure(engine.getSnapshot(), otherCue), { status: 'unknown' });
  engine.nextCue(0); engine.input(engine.cue.text); const attempt = engine.submit()!, state = engine.getSnapshot();
  assert.equal(projectAttemptReferenceExposure(state, attempt).status, 'recorded');
  for (const mismatch of [{ sessionId: 'other' }, { roundId: 'other' }, { materialId: 'other' }, { materialVersion: 'other' },
    { cueId: 'other' }, { attemptId: 'other' }, { inputVersion: attempt.inputVersion + 1 }, { answer: 'other' }, { reference: 'other' }]) {
    assert.deepEqual(projectAttemptReferenceExposure(state, { ...attempt, ...mismatch }), { status: 'unknown' });
  }
  assert.deepEqual(projectAttemptReferenceExposure({ ...state, events: state.events.filter(item => item.type !== 'submitRequested') }, attempt), { status: 'unknown' });
  for (const mismatch of [{ sessionId: 'other' }, { materialId: 'other' }, { materialVersion: 'other' }, { cueId: 'other' }]) {
    const altered = { ...state, events: state.events.map(item => item.type === 'hintExposed' ? { ...item, ...mismatch } : item) };
    assert.deepEqual(projectAttemptReferenceExposure(altered, attempt), { status: 'unknown' });
  }
});

test('ordinary reveal and missing metadata yield unknown provenance, never false or unassisted', () => {
  for (const kind of [undefined, 'hint', 'reveal'] as const) {
    const engine = new TrainingEngine({ clock: driver().clock }); if (kind) engine.exposeHint(kind);
    engine.input(engine.cue.text); const attempt = engine.submit()!;
    assert.deepEqual(projectAttemptReferenceExposure(engine.getSnapshot(), attempt), { status: 'unknown' });
    assert.equal(attempt.conditions.revealed, kind === 'reveal');
  }
});

test('multiple real causes are positive evidence only for the submission after them', () => {
  const engine = new TrainingEngine({ clock: driver().clock });
  engine.exposeHint('reveal', CONFIRMATION); engine.exposeHint('reveal', EDITOR); engine.exposeHint('reveal', EDITOR);
  engine.input(engine.cue.text); const attempt = engine.submit()!, before = engine.getSnapshot();
  const projected = projectAttemptReferenceExposure(before, attempt);
  assert.equal(projected.status, 'recorded');
  if (projected.status !== 'recorded') assert.fail('expected positive evidence');
  assert.deepEqual(projected.surfaces, ['corrected-version-confirmation', 'correction-editor']);
  assert.equal(projected.eventIds.length, 3);
  assert.equal(projected.submitSequence, before.events.find(item => item.type === 'submitRequested')!.sequence);
  assert.equal(engine.getSnapshot(), before);
});

test('new reference starts at the selected nonfirst cue, without credit or invented exposure', () => {
  const d = driver(), engine = new TrainingEngine({ clock: d.clock, inputObservation: { runId: 'page' } });
  engine.exposeHint('reveal', EDITOR); engine.input(engine.cue.text); engine.submit();
  const old = engine.getSnapshot(), saved = exportSession(old, EXPORT_AT), selected = corrected();
  d.advance(40_000); engine.startReferenceSession(selected, 2);
  const fresh = engine.getSnapshot(); assert.notEqual(fresh.sessionId, old.sessionId); assert.equal(fresh.roundId, fresh.sessionId);
  assert.deepEqual(fresh.material, selected); assert.equal(fresh.cueIndex, 2); assert.equal(engine.cue.id, selected.cues[2].id);
  assert.deepEqual(fresh.events.map(item => item.type), ['sessionStarted', 'cueChanged']);
  assert.deepEqual(fresh.drafts, {}); assert.deepEqual(fresh.attempts, []); assert.equal(fresh.earnedWords, 0); assert.equal(fresh.activeMs, 0);
  assert.deepEqual(fresh.confirmedPositions, []); assert.deepEqual(fresh.completedCueIds, []); assert.deepEqual(replay(fresh.events), fresh);
  assert.deepEqual(exportSession(old, EXPORT_AT), saved);
  engine.exposeHint('reveal', CONFIRMATION); engine.input(engine.cue.text); const attempt = engine.submit()!;
  assert.equal(attempt.reference, selected.cues[2].text); assert.equal(attempt.cueId, selected.cues[2].id); assert.equal(attempt.materialVersion, selected.version);
  assert.equal(attempt.conditions.revealed, true); assert.equal(attempt.accuracy, 100);
  const provenance = projectAttemptReferenceExposure(engine.getSnapshot(), attempt);
  assert.equal(provenance.status, 'recorded'); if (provenance.status === 'recorded') assert.deepEqual(provenance.surfaces, ['corrected-version-confirmation']);
  const input = engine.getSnapshot().events.find(item => item.type === 'inputCommitted')!;
  assert.equal(input.inputObservation?.runId, 'page:round-1'); assert.equal(input.inputObservation?.restartReason, 'start');
  engine.resetSession(); engine.input(engine.cue.text); assert.equal(engine.submit()!.conditions.revealed, false);
  assert.deepEqual(exportSession(old, EXPORT_AT), saved);
});

test('new reference start from passive restore clears passive state without mutating the saved old round', () => {
  const source = new TrainingEngine({ clock: driver('source').clock }); source.input(source.cue.text); source.submit();
  const old = source.getSnapshot(), engine = new TrainingEngine({ snapshot: old, clock: driver('restored').clock, restoredReadOnly: true });
  assert.equal(engine.isPassiveRestored, true); engine.setFrozen('background', true);
  engine.startReferenceSession(corrected(), 2); assert.equal(engine.isPassiveRestored, false);
  assert.deepEqual(engine.getSnapshot().frozenReasons, ['idle']); assert.deepEqual(engine.getSnapshot().events.map(item => item.type), ['sessionStarted', 'cueChanged']);
  assert.deepEqual(source.getSnapshot(), old);
});

test('invalid selected cue or envelope leaves the entire old state untouched', () => {
  const d = driver(), engine = new TrainingEngine({ clock: d.clock }); engine.input('old pending input'); d.advance(900);
  const before = engine.getSnapshot();
  for (const index of [-1, 12, 0.5, NaN, Infinity]) {
    assert.throws(() => engine.startReferenceSession(corrected(), index), /cue index/); assert.equal(engine.getSnapshot(), before);
  }
  const invalid = { ...corrected(), localReference: { ...corrected().localReference!, version: 'future-reference' } } as unknown as Material;
  assert.throws(() => engine.startReferenceSession(invalid, 2)); assert.equal(engine.getSnapshot(), before);
});

test('strict exposure envelope rejects malformed, unknown and misplaced metadata without a partial action', () => {
  const malformed: unknown[] = [undefined, null, {}, [], 'correction-editor', { ...EDITOR, version: 'future' }, { ...EDITOR, surface: 'other' },
    { version: EDITOR.version }, { surface: EDITOR.surface }, { ...EDITOR, extra: true }, Object.assign(Object.create(null), EDITOR)];
  for (const metadata of malformed) {
    assert.equal(isReferenceExposure(metadata), false);
    assert.throws(() => validateOptionalReferenceExposure({ type: 'hintExposed', kind: 'reveal', referenceExposure: metadata }), /reference exposure/);
    const engine = new TrainingEngine({ clock: driver().clock }), before = engine.getSnapshot();
    assert.throws(() => engine.dispatch({ ...event(engine, { type: 'hintExposed', kind: 'reveal' }), referenceExposure: metadata } as TrainingEvent), /reference exposure/);
    assert.equal(engine.getSnapshot(), before);
  }
  for (const payload of [{ type: 'hintExposed', kind: 'hint' }, { type: 'inputCommitted', text: 'hello', source: 'typed' }]) {
    assert.throws(() => validateOptionalReferenceExposure({ ...payload, referenceExposure: EDITOR }), /reference exposure/);
  }
  const d = driver(), engine = new TrainingEngine({ clock: d.clock }); engine.input('old'); d.advance(300);
  const before = engine.getSnapshot(); assert.throws(() => engine.exposeHint('hint', EDITOR), /reference exposure/); assert.equal(engine.getSnapshot(), before);
  assert.equal(isReferenceExposure(EDITOR), true); assert.equal(isReferenceExposure(CONFIRMATION), true);
  validateOptionalReferenceExposure({ type: 'hintExposed', kind: 'reveal' });
});

test('provenance validation preserves the existing duplicate-event short circuit', () => {
  const engine = new TrainingEngine({ clock: driver().clock }); engine.exposeHint('reveal', EDITOR);
  const before = engine.getSnapshot(), duplicate = { ...before.events.at(-1)!, referenceExposure: null } as unknown as TrainingEvent;
  assert.equal(engine.dispatch(duplicate), before);
  assert.equal(engine.getSnapshot(), before);
});

test('legacy readback rejects malformed new envelopes and keeps the supplied record intact', () => {
  const engine = new TrainingEngine({ material: corrected(), clock: driver().clock }); engine.exposeHint('reveal', EDITOR);
  engine.input(engine.cue.text); engine.submit(); const raw = stored(engine.getSnapshot());
  assert.deepEqual(readLegacyHistoryRecord(raw).snapshot, engine.getSnapshot());
  const malformed = [null, {}, { ...EDITOR, version: 'future' }, { ...EDITOR, extra: true }];
  for (const metadata of malformed) {
    const broken = structuredClone(raw) as unknown as { snapshot: { events: Record<string, unknown>[] } };
    broken.snapshot.events.find(item => item.type === 'hintExposed')!.referenceExposure = metadata;
    const untouched = JSON.stringify(broken);
    assert.throws(() => readLegacyHistoryRecord(broken), (error: unknown) => error instanceof LegacyHistoryError && error.code === 'unsupported-schema');
    assert.equal(JSON.stringify(broken), untouched);
  }
  for (const kind of ['hint', 'unknown']) {
    const broken = structuredClone(raw) as unknown as { snapshot: { events: Record<string, unknown>[] } };
    broken.snapshot.events.find(item => item.type === 'hintExposed')!.kind = kind;
    assert.throws(() => readLegacyHistoryRecord(broken), (error: unknown) => error instanceof LegacyHistoryError && error.code === 'unsupported-schema');
  }
  for (const metadata of [null, {}, { ...corrected().localReference, version: 'future' }]) {
    const material = { ...corrected(), localReference: metadata } as unknown as Material;
    assert.throws(() => createInitialSnapshot('bad', material));
    const broken = structuredClone(raw) as unknown as { snapshot: { material: Material; events: Record<string, unknown>[] } };
    broken.snapshot.material = material; broken.snapshot.events[0].material = material;
    const untouched = JSON.stringify(broken);
    assert.throws(() => readLegacyHistoryRecord(broken), (error: unknown) => error instanceof LegacyHistoryError && error.code === 'invalid-material');
    assert.throws(() => replay(broken.snapshot.events as unknown as TrainingEvent[])); assert.equal(JSON.stringify(broken), untouched);
  }
});

test('new full sessions replay and export losslessly through the frozen old client and back', async () => {
  const engine = new TrainingEngine({ clock: driver('new').clock }); engine.startReferenceSession(corrected(), 2);
  engine.exposeHint('reveal', CONFIRMATION); engine.input(engine.cue.text); engine.submit();
  const current = engine.getSnapshot(), fixed = exportSession(current, EXPORT_AT);
  const oldReplay = frozenV62.replay(current.events as readonly frozenV62.TrainingEvent[]); assert.deepEqual(oldReplay, current);
  assert.deepEqual(frozenV62.exportSession(oldReplay, EXPORT_AT), fixed);
  const old = new frozenV62.TrainingEngine({ snapshot: current as frozenV62.TrainingSnapshot, clock: driver('old').clock });
  old.input(`${old.cue.text} extra`); old.submit(); const returned = replay(old.getSnapshot().events);
  assert.deepEqual(returned, old.getSnapshot()); assert.deepEqual((returned.material as Material).localReference, (current.material as Material).localReference);
  assert.equal(returned.attempts.at(-1)!.conditions.revealed, true);
  assert.equal(projectAttemptReferenceExposure(returned, returned.attempts.at(-1)!).status, 'recorded');
  const repository = new IndexedDBTrainingRepository({ indexedDB: new IDBFactory(), dbName: 'reference-full' });
  try {
    await repository.saveSession(returned); assert.deepEqual(await repository.loadLatest(), returned);
    const history = await repository.loadHistorySession(returned.sessionId); assert.deepEqual(history?.snapshot, returned);
    assert.ok(fixed.json.includes('local-reference-v1')); assert.ok(fixed.json.includes('reference-exposure-v1'));
    assert.ok(fixed.csv.includes('local-reference-v1')); assert.ok(fixed.csv.includes('reference-exposure-v1'));
  } finally { await repository.close(); }
});

test('partial history preserves only the old reveal shape and never backfills pre-admission exposure', async () => {
  const d = driver(), engine = new TrainingEngine({ clock: d.clock }); engine.startReferenceSession(corrected(), 2);
  engine.exposeHint('reveal', EDITOR); // OFF: later ON has no right to backfill this fact.
  const repository = new IndexedDBTrainingRepository({ indexedDB: new IDBFactory(), dbName: 'reference-partial' });
  try {
    await repository.enableAutomaticHistory(0);
    const projector = new TrainingHistorySegmentProjector(engine.getSnapshot(), { segmentId: 'reference-segment', writerInstanceId: 'writer', generation: 1, startedAt: d.clock.wallTime() });
    const { permit } = await repository.beginTrainingHistorySegment(projector.getSegment(), 1);
    assert.deepEqual(projector.getSegment().facts, []);
    engine.exposeHint('reveal', CONFIRMATION); projector.observe(engine.getSnapshot());
    engine.input(engine.cue.text); engine.submit(); const segment = projector.observe(engine.getSnapshot());
    const reveal = segment.facts.find(item => item.type === 'hintExposed'); assert.ok(reveal);
    assert.deepEqual(Object.keys(reveal).sort(), ['sourceEventId', 'ordinal', 'wallTime', 'cueId', 'type', 'kind'].sort());
    assert.equal(reveal.type === 'hintExposed' && reveal.kind, 'reveal');
    assert.equal(segment.facts.filter(item => item.type === 'hintExposed').length, 1);
    assert.ok(!JSON.stringify(segment).includes('referenceExposure')); assert.ok(!JSON.stringify(segment).includes('localReference'));
    assert.deepEqual(readTrainingHistorySegment(segment), segment);
    await repository.saveTrainingHistorySegment(permit, segment); assert.deepEqual(await repository.loadTrainingHistorySegment(segment.segmentId), segment);
    const invalid = structuredClone(segment) as unknown as { facts: Record<string, unknown>[] };
    invalid.facts.find(item => item.type === 'hintExposed')!.referenceExposure = CONFIRMATION;
    assert.throws(() => readTrainingHistorySegment(invalid), /Unsupported or invalid history segment/);
    assert.deepEqual(await repository.loadLatest(), null);
  } finally { await repository.close(); }
});
