import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { IndexedDBTrainingRepository } from './repository.ts';
import { LISTENING_HISTORY_PREFIX, readListeningHistory, type ListeningHistoryRecord, type ListeningHistorySpan } from './listening-history.ts';
const span: ListeningHistorySpan = { ordinal: 1, kind: 'listening', startMs: 0, endMs: 1000, mediaStartMs: 0, mediaEndMs: 2000, rate: 2, hidden: false };
function initial(generation = 0, observationId = 'run-one'): ListeningHistoryRecord {
  return { schemaVersion: 'listening-history-v1', observationId, writerInstanceId: 'page-one', materialId: 'lesson', materialVersion: '1', mediaId: 'audio', mediaSha256: 'a'.repeat(64), startedAt: '2026-10-10T20:00:00.000Z', generation, revision: 0, sealed: false, facts: [] };
}
function fixture(t: TestContext) {
  const factory = new IDBFactory(), dbName = t.name, options = { indexedDB: factory, dbName };
  const repository = new IndexedDBTrainingRepository(options); t.after(() => repository.close());
  return { factory, dbName, repository, peer() { const peer = new IndexedDBTrainingRepository(options); t.after(() => peer.close()); return peer; } };
}
async function database(f: ReturnType<typeof fixture>) {
  return await new Promise<IDBDatabase>((resolve, reject) => { const r = f.factory.open(f.dbName); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
async function mutate(f: ReturnType<typeof fixture>, fn: (store: IDBObjectStore) => void) {
  const db = await database(f);
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('meta', 'readwrite'); fn(tx.objectStore('meta') as IDBObjectStore); tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error); }); } finally { db.close(); }
}

test('listening reads do not create storage or mint permits', async t => {
  const f = fixture(t); assert.deepEqual(await f.repository.listListeningHistory(), []); assert.equal(await f.repository.loadListeningHistory('missing'), null);
  assert.deepEqual(await f.factory.databases(), []);
});
test('standalone listening admission and append touch only meta with no DB3', async t => {
  const f = fixture(t), { permit, record } = await f.repository.beginListeningHistory(initial(), 0);
  const next = { ...record, revision: 1, facts: [span] };
  assert.deepEqual(await f.repository.saveListeningHistory(permit, next, 0), next);
  assert.deepEqual(await f.repository.listListeningHistory(), [next]);
  assert.deepEqual((await f.repository.listHistory()).entries, []);
  assert.deepEqual((await f.repository.listTrainingHistorySegments()).entries, []);
  const db = await database(f); assert.equal(db.version, 1);
  const tx = db.transaction(['sessions', 'events'], 'readonly');
  await Promise.all(['sessions', 'events'].map(name => new Promise<void>((resolve, reject) => { const r = tx.objectStore(name).count(); r.onsuccess = () => { assert.equal(r.result, 0); resolve(); }; r.onerror = () => reject(r.error); }))); db.close();
});
test('exact retry is no-op; stale revision, changed prefix and sealed extension fail', async t => {
  const f = fixture(t), { permit, record } = await f.repository.beginListeningHistory(initial(), 0);
  const next = { ...record, revision: 1, facts: [span] }; await f.repository.saveListeningHistory(permit, next, 0);
  let puts = 0; const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(...args) { puts++; return put.apply(this, args); };
  try { assert.deepEqual(await f.repository.saveListeningHistory(permit, next, 0), next); assert.equal(puts, 0); } finally { IDBObjectStore.prototype.put = put; }
  await assert.rejects(f.repository.saveListeningHistory(permit, { ...next, revision: 2, facts: [{ ...span, endMs: 999 }] }, 1), /prefix/);
  const sealed = { ...next, revision: 2, sealed: true }; await f.repository.saveListeningHistory(permit, sealed, 1);
  await assert.rejects(f.repository.saveListeningHistory(permit, next, 0), /revision/);
  await assert.rejects(f.repository.saveListeningHistory(permit, { ...sealed, revision: 3 }, 2), /sealed/);
  assert.deepEqual(await f.repository.loadListeningHistory(record.observationId), sealed);
});
test('missing head cannot be resurrected and identity cannot be rebound', async t => {
  const f = fixture(t), { permit, record } = await f.repository.beginListeningHistory(initial(), 0);
  await assert.rejects(f.repository.saveListeningHistory(permit, { ...record, revision: 1, mediaId: 'another' }, 0), /admitted/);
  await mutate(f, store => store.delete(LISTENING_HISTORY_PREFIX + record.observationId));
  await assert.rejects(f.repository.saveListeningHistory(permit, { ...record, revision: 1, facts: [span] }, 0), /missing/);
  await assert.rejects(f.repository.saveListeningHistory(permit, { ...record, revision: 1, facts: [span] }, 0), /admitted/);
  assert.deepEqual(await f.repository.listListeningHistory(), []);
});
test('OFF synchronously cancels queued writes and ON admits only a fresh empty run', async t => {
  const f = fixture(t), { permit, record } = await f.repository.beginListeningHistory(initial(), 0);
  const pending = f.repository.saveListeningHistory(permit, { ...record, revision: 1, facts: [span] }, 0);
  const stopped = f.repository.disableAutomaticHistory(0);
  await assert.rejects(pending); await stopped;
  const on = await f.repository.enableAutomaticHistory(1);
  assert.equal(on.generation, 2);
  await assert.rejects(f.repository.saveListeningHistory(permit, { ...record, revision: 1, facts: [span] }, 0));
  await assert.rejects(f.repository.beginListeningHistory({ ...initial(2, 'private-tail'), facts: [span] }, 2));
  const fresh = await f.repository.beginListeningHistory(initial(2, 'fresh'), 2);
  await f.repository.saveListeningHistory(fresh.permit, { ...fresh.record, revision: 1, facts: [span] }, 0);
  assert.equal((await f.repository.loadListeningHistory('run-one'))!.facts.length, 0);
});
test('refresh reading segment ON grants no capability; explicit page enable does', async t => {
  const f = fixture(t); const on = await f.repository.enableAutomaticHistory(0);
  const peer = f.peer(); assert.equal((await peer.readAutomaticHistoryControl()).state, 'segment-on');
  await assert.rejects(peer.beginListeningHistory(initial(on.generation), on.generation));
  await peer.enableAutomaticHistory(on.generation);
  await peer.beginListeningHistory(initial(on.generation), on.generation);
});
test('peer OFF fences active old-generation listening permit inside next write transaction', async t => {
  const f = fixture(t), { permit, record } = await f.repository.beginListeningHistory(initial(), 0);
  await f.peer().disableAutomaticHistory(0);
  await assert.rejects(f.repository.saveListeningHistory(permit, { ...record, revision: 1, facts: [span] }, 0));
  assert.equal((await f.repository.loadListeningHistory(record.observationId))!.facts.length, 0);
});
test('detached permit and forged permit fail; records are captured before await', async t => {
  const f = fixture(t), admission = await f.repository.beginListeningHistory(initial(), 0);
  const facts = [{ ...span }], next = { ...admission.record, revision: 1, facts };
  const pending = f.repository.saveListeningHistory(admission.permit, next, 0); facts[0].endMs = 999;
  assert.equal((await pending).facts[0].endMs, 1000);
  f.repository.revokeListeningHistory(admission.permit);
  await assert.rejects(f.repository.saveListeningHistory(admission.permit, { ...next, revision: 2 }, 1));
  await assert.rejects(f.repository.saveListeningHistory({} as typeof admission.permit, { ...next, revision: 2 }, 1));
});
test('strict metric schema rejects text, unknown fields, invalid values and ordinal holes', () => {
  for (const value of [{ ...initial(), answer: 'PRIVATE' }, { ...initial(), facts: [{ ...span, reference: 'PRIVATE' }] }, { ...initial(), facts: [{ ...span, ordinal: 2 }] }, { ...initial(), facts: [{ ...span, endMs: Infinity }] }, { ...initial(), facts: [{ ...span, kind: 'typing' }] }]) assert.throws(() => readListeningHistory(value));
});
test('OFF inside put aborts transaction before listening batch is visible', async t => {
  const f = fixture(t), { permit, record } = await f.repository.beginListeningHistory(initial(), 0);
  const put = IDBObjectStore.prototype.put; let off: Promise<unknown> | undefined;
  IDBObjectStore.prototype.put = function(...args) { const result = put.apply(this, args); if ((args[0] as { key: string }).key.startsWith(LISTENING_HISTORY_PREFIX)) off = f.repository.disableAutomaticHistory(0); return result; };
  try { await assert.rejects(f.repository.saveListeningHistory(permit, { ...record, revision: 1, facts: [span] }, 0)); await off; } finally { IDBObjectStore.prototype.put = put; }
  assert.equal((await f.repository.loadListeningHistory(record.observationId))!.facts.length, 0);
});

test('snapshot conversion appends immutable tails and projects L/T union and media coverage', async t => {
  const { ListeningObservation } = await import('./listening-flow.ts');
  const { appendListeningSnapshot, projectListeningHistory } = await import('./listening-history.ts');
  const record = initial(), observer = new ListeningObservation({ runId: record.observationId, sessionId: 'training-unchanged', roundId: 'round-unchanged', materialId: record.materialId, materialVersion: record.materialVersion, referenceVersion: 'reference-1', mediaId: record.mediaId, mediaSha256: record.mediaSha256 });
  const sample = (monoMs: number, mediaSeconds: number, playing = true) => observer.sample({ monoMs, mediaSeconds, rate: 2, playing, seeking: false, waiting: false, audible: true, verified: true, hidden: false, mode: 'type', typingStarted: true, blocked: false, boundary: 0, permissionSegment: 'admitted' });
  sample(0, 0); sample(1000, 2);
  const first = appendListeningSnapshot(record, observer.snapshot(), { spans: 0, gaps: 0 });
  assert.equal(first.record.facts.length, 2);
  const totals = projectListeningHistory(first.record);
  assert.deepEqual({ l: totals.listeningMs, t: totals.typingMs, overlap: totals.overlapMs, total: totals.effectiveMs, coverage: totals.mediaCoverageSeconds }, { l: 1000, t: 1000, overlap: 1000, total: 1000, coverage: 2 });
  sample(5000, 10); // Observation gap, never credited to L or T.
  const second = appendListeningSnapshot(first.record, observer.snapshot(), first.cursor);
  assert.equal(second.record.facts.at(-1)!.kind, 'gap');
  sample(6000, 12);
  const third = appendListeningSnapshot(second.record, observer.snapshot(), second.cursor, true);
  assert.deepEqual(third.record.facts.slice(0, second.record.facts.length), second.record.facts);
  const end = projectListeningHistory(third.record); assert.equal(end.listeningMs, 2000); assert.equal(end.effectiveMs, 2000); assert.equal(end.unknownMs, 4000);
  assert.throws(() => appendListeningSnapshot({ ...record, observationId: 'another' }, observer.snapshot(), { spans: 0, gaps: 0 }));
  const f = fixture(t), admitted = await f.repository.beginListeningHistory(record, 0);
  await f.repository.saveListeningHistory(admitted.permit, first.record, 0); await f.repository.saveListeningHistory(admitted.permit, second.record, 1); await f.repository.saveListeningHistory(admitted.permit, third.record, 2);
  assert.deepEqual(projectListeningHistory((await f.repository.loadListeningHistory(record.observationId))!), end);
});
test('metric save status stays separate from Training status and readonly calls do not alter it', async t => {
  const f = fixture(t), prior = f.repository.getStatus();
  const { permit, record } = await f.repository.beginListeningHistory(initial(), 0);
  assert.equal(f.repository.getListeningHistoryStatus().state, 'persisted');
  assert.equal(f.repository.getListeningHistoryStatus().revision, 0); assert.deepEqual(f.repository.getStatus(), prior);
  await f.repository.saveListeningHistory(permit, { ...record, revision: 1, facts: [span] }, 0);
  const saved = f.repository.getListeningHistoryStatus(); await f.repository.listListeningHistory(); assert.strictEqual(f.repository.getListeningHistoryStatus(), saved); assert.deepEqual(f.repository.getStatus(), prior);
});
test('write failure rolls back and explicit same-generation retry can succeed', async t => {
  const f = fixture(t), { permit, record } = await f.repository.beginListeningHistory(initial(), 0), next = { ...record, revision: 1, facts: [span] };
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(...args) { if ((args[0] as { key: string }).key.startsWith(LISTENING_HISTORY_PREFIX)) throw new Error('injected write failure'); return put.apply(this, args); };
  try { await assert.rejects(f.repository.saveListeningHistory(permit, next, 0), /injected/); } finally { IDBObjectStore.prototype.put = put; }
  assert.equal(f.repository.getListeningHistoryStatus().state, 'error'); assert.equal((await f.repository.loadListeningHistory(record.observationId))!.revision, 0);
  await f.repository.saveListeningHistory(permit, next, 0); assert.equal(f.repository.getListeningHistoryStatus().state, 'persisted');
});
test('malformed stored metric rows fail closed without changing data', async t => {
  const f = fixture(t), record = initial(); await f.repository.beginListeningHistory(record, 0);
  await mutate(f, store => store.put({ key: LISTENING_HISTORY_PREFIX + record.observationId, version: 1, record: { ...record, referenceText: 'NEVER_SUPPORTED' } }));
  await assert.rejects(f.repository.listListeningHistory(), /Invalid/);
});
test('metric delivery is readonly and rejects stale or missing heads before sink', async t => {
  const f = fixture(t), { permit, record } = await f.repository.beginListeningHistory(initial(), 0); let delivered = 0;
  const status = f.repository.getListeningHistoryStatus(); await f.repository.deliverListeningHistory(record.observationId, record, () => { delivered++; }); assert.equal(delivered, 1); assert.strictEqual(f.repository.getListeningHistoryStatus(), status);
  const next = await f.repository.saveListeningHistory(permit, { ...record, revision: 1, facts: [span] }, 0);
  await assert.rejects(f.repository.deliverListeningHistory(record.observationId, record, () => { delivered++; })); assert.equal(delivered, 1);
  await mutate(f, store => store.delete(LISTENING_HISTORY_PREFIX + record.observationId));
  await assert.rejects(f.repository.deliverListeningHistory(next.observationId, next, () => { delivered++; })); assert.equal(delivered, 1);
});
