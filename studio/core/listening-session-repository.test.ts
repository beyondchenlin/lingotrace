import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { IndexedDBTrainingRepository } from './repository.ts';
import { TrainingEngine, type NativeEditEvidence } from './training.ts';
import { ListeningConditions } from './listening-flow.ts';
import { readListeningSession, type ListeningSessionRecord } from './listening-session.ts';
import { TrainingHistorySegmentProjector } from './training-history-segment.ts';
const options = { scopeId: 'scope-1', startedAt: '2026-10-11T00:00:00.000Z', referenceVersion: 'reference-1' };
function fixture(t: TestContext) {
  const factory = new IDBFactory(), dbName = t.name, repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  let id = 0; const clock = { now: () => 0, wallTime: () => '2026-10-11T00:00:00.000Z', id: () => `event-${++id}` };
  const engine = new TrainingEngine({ sessionId: 'training-one', clock }); t.after(() => repository.close());
  const s = engine.getSnapshot(), conditions = new ListeningConditions({ sessionId: s.sessionId, roundId: s.roundId, materialId: s.material.id, materialVersion: s.material.version, referenceVersion: options.referenceVersion }, 'complete-to-submit');
  const input = (text: string) => engine.input(text, 'typed', { version: 'dom-edit-v1', kind: 'input', inputType: 'insertText', data: text } satisfies NativeEditEvidence);
  const submit = () => { const captured = conditions.capture(engine.getSnapshot()); engine.submit(); conditions.complete(captured, engine.getSnapshot()); };
  return { repository, factory, dbName, engine, conditions, input, submit };
}
async function rows(f: ReturnType<typeof fixture>) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = f.factory.open(f.dbName); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try { const result: Record<string, unknown> = { version: db.version }; await new Promise<void>((resolve, reject) => { const tx = db.transaction(['sessions', 'events', 'meta'], 'readonly'); for (const name of ['sessions', 'events', 'meta']) { const r = tx.objectStore(name).getAll(); r.onsuccess = () => { result[name] = r.result; }; } tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error); }); return result; } finally { db.close(); }
}
test('B scope preserves old record and existing version/settings; no B writes before admission', async t => {
  const f = fixture(t); f.input('old answer'); await f.repository.saveSession(f.engine.getSnapshot()); const before = await rows(f);
  const admitted = await f.repository.beginListeningSessionScope(f.engine.getSnapshot(), options), after = await rows(f);
  assert.deepEqual(admitted.record.preBRecord, (before.sessions as unknown[])[0]); assert.deepEqual(after.meta, before.meta); assert.deepEqual(after.events, before.events); assert.equal(after.version, before.version);
  assert.equal(admitted.record.trainingSnapshot.roundId, f.engine.getSnapshot().roundId); assert.deepEqual(admitted.record.snapshot, { schemaVersion: 'listening-session-v1', events: null });
  assert.deepEqual(await f.repository.loadLatestListeningSession(), admitted.record); await assert.rejects(f.repository.loadLatest());
  await assert.rejects(f.repository.saveSession(f.engine.getSnapshot()), /atomic listening/);
});
test('every actual submission is saved atomically with immutable assistance and no fake attempt', async t => {
  const f = fixture(t), { permit, record } = await f.repository.beginListeningSessionScope(f.engine.getSnapshot(), options);
  const cue = f.engine.getSnapshot().material.cues[0]; f.conditions.present(cue.id, 'automatic-text', true, options.referenceVersion);
  f.input(cue.text); f.submit(); const snapshot = f.engine.getSnapshot(), conditions = f.conditions.snapshot();
  const stored = await f.repository.saveListeningSession(permit, snapshot, conditions, 0);
  assert.equal(stored.conditions.boundaries.length, 1); assert.equal(stored.conditions.boundaries[0].assistance, 'known-assisted'); assert.equal(stored.trainingSnapshot.attempts.length, 1);
  assert.equal(stored.trainingSnapshot.attempts[0].conditions.exposure, 'first'); assert.deepEqual(stored.trainingSnapshot.attempts, snapshot.attempts); assert.equal(stored.scope.admittedSequence, record.sequence);
  assert.deepEqual(await f.repository.saveListeningSession(permit, snapshot, conditions, 0), stored);
  const forged = structuredClone(conditions); forged.boundaries[0] = { ...forged.boundaries[0], assistance: 'unknown', exposureOrdinals: [] }; await assert.rejects(f.repository.saveListeningSession(permit, snapshot, forged, 1));
});
test('missing boundary and prior evidence omission fail closed, without partial event writes', async t => {
  const f = fixture(t), { permit } = await f.repository.beginListeningSessionScope(f.engine.getSnapshot(), options), before = await rows(f);
  f.input('typed'); f.engine.submit(); await assert.rejects(f.repository.saveListeningSession(permit, f.engine.getSnapshot(), f.conditions.snapshot(), 0), /Every post-scope/); assert.deepEqual(await rows(f), before);
});
test('scope admission and later save roll back when latest pointer or session puts fail', async t => {
  const f = fixture(t); await f.repository.saveSession(f.engine.getSnapshot()); const before = await rows(f), original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(...args) { if (this.name === 'meta' && (args[0] as { key: string }).key === 'latest') throw new Error('injected latest failure'); return original.apply(this, args); };
  try { await assert.rejects(f.repository.beginListeningSessionScope(f.engine.getSnapshot(), options), /injected/); } finally { IDBObjectStore.prototype.put = original; }
  assert.deepEqual(await rows(f), before);
  const { permit } = await f.repository.beginListeningSessionScope(f.engine.getSnapshot(), options), scoped = await rows(f); f.input('later');
  IDBObjectStore.prototype.put = function(...args) { if (this.name === 'sessions') throw new Error('injected session failure'); return original.apply(this, args); };
  try { await assert.rejects(f.repository.saveListeningSession(permit, f.engine.getSnapshot(), f.conditions.snapshot(), 0), /injected/); } finally { IDBObjectStore.prototype.put = original; }
  assert.deepEqual(await rows(f), scoped);
});
test('OFF cancels queued B writes; partial scope saves only unknown metadata without private text', async t => {
  const f = fixture(t), { permit } = await f.repository.beginListeningSessionScope(f.engine.getSnapshot(), options);
  f.input('not retained tail'); const pending = f.repository.saveListeningSession(permit, f.engine.getSnapshot(), f.conditions.snapshot(), 0), off = f.repository.disableAutomaticHistory(0);
  await assert.rejects(pending); await off; f.input('PRIVATE_OFF_TEXT');
  const on = await f.repository.enableAutomaticHistory(1); await assert.rejects(f.repository.beginListeningSessionScope(f.engine.getSnapshot(), { ...options, scopeId: 'not-allowed' }));
  const projector = new TrainingHistorySegmentProjector(f.engine.getSnapshot(), { generation: on.generation, segmentId: 'partial-one', writerInstanceId: 'page', startedAt: options.startedAt });
  await f.repository.beginTrainingHistorySegment(projector.getSegment(), on.generation);
  const partial = await f.repository.beginPartialListeningScope('partial-one', { ...options, scopeId: 'partial-scope' }); assert.equal(partial.coverage, 'unavailable');
  const all = await rows(f); assert.equal(JSON.stringify(all).includes('PRIVATE_OFF_TEXT'), false); assert.equal(JSON.stringify(all).includes('not retained tail'), false);
  assert.deepEqual(await f.repository.loadPartialListeningScope('partial-one'), partial);
});
test('readonly B list/export preserve wrapper and require exact latest identity for delivery', async t => {
  const f = fixture(t), { permit, record } = await f.repository.beginListeningSessionScope(f.engine.getSnapshot(), options), before = await rows(f);
  assert.deepEqual(await f.repository.listListeningSessions(), [record]); let delivered = 0;
  await f.repository.deliverListeningSession(record.sessionId, record, () => { delivered++; }); assert.equal(delivered, 1); assert.deepEqual(await rows(f), before);
  assert.deepEqual(readListeningSession(JSON.parse(JSON.stringify(record))), record);
  await f.repository.saveListeningSession(permit, f.engine.getSnapshot(), f.conditions.snapshot(), 0);
  await assert.rejects(f.repository.deliverListeningSession(record.sessionId, record, () => { delivered++; })); assert.equal(delivered, 1);
});
test('resume requires full unchanged envelope, preserves pre-B receipt and stale permit remains fenced', async t => {
  const f = fixture(t), { record } = await f.repository.beginListeningSessionScope(f.engine.getSnapshot(), options);
  const resumed = await f.repository.resumeListeningSessionScope(record); assert.deepEqual(resumed.record, record);
  f.repository.revokeListeningSessionScope(resumed.permit); await assert.rejects(f.repository.saveListeningSession(resumed.permit, f.engine.getSnapshot(), f.conditions.snapshot(), 0));
  const malformed = { ...record, conditions: undefined } as unknown as ListeningSessionRecord; await assert.rejects(f.repository.resumeListeningSessionScope(malformed));
});
test('B JSON and versioned CSV export roundtrip the complete wrapper and receipt', async t => {
  const { listeningSessionExport, readListeningSessionExport, projectListeningSessionHistory } = await import('./listening-session-export.ts');
  const f = fixture(t); f.input('old attempt'); f.engine.submit(); await f.repository.saveSession(f.engine.getSnapshot());
  const { record } = await f.repository.beginListeningSessionScope(f.engine.getSnapshot(), options);
  const projected = projectListeningSessionHistory(record); assert.equal(projected.attempts.length, 1); assert.equal(projected.attempts[0].assistance, 'unknown'); assert.equal(projected.attempts[0].coverage, 'unavailable');
  assert.deepEqual(readListeningSessionExport(JSON.parse(listeningSessionExport(record, 'json').text)), record);
  const csv = listeningSessionExport(record, 'csv').text;
  const cells: string[][] = []; let row: string[] = [], value = '', quoted = false;
  for (let i = 0; i < csv.length; i++) { const c = csv[i]; if (quoted) { if (c === '"') { if (csv[i + 1] === '"') { value += '"'; i++; } else quoted = false; } else value += c; } else if (c === '"') quoted = true; else if (c === ',') { row.push(value); value = ''; } else if (c === '\r' && csv[i + 1] === '\n') { row.push(value); cells.push(row); row = []; value = ''; i++; } else value += c; }
  assert.equal(cells[1][0], 'listening-session-export-v1'); assert.deepEqual(readListeningSessionExport(JSON.parse(cells[1][3])), record);
  assert.throws(() => readListeningSessionExport(record));
});
