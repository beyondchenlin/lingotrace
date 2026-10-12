import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { TrainingEngine, CAFE_MATERIAL, type Material } from './training';
import { NPS_MATERIAL } from './builtin-material';
import { IndexedDBTrainingRepository } from './repository';
import { readDefaultCourseBootstrap } from './default-course-bootstrap';
import { readListeningSession } from './listening-session';
import type { LegacyHistoryCursor } from './legacy-history';

function fixture(t: TestContext) {
  const factory = new IDBFactory(), dbName = `partition-${crypto.randomUUID()}`;
  const repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  t.after(() => repository.close());
  async function database<T>(work: (db: IDBDatabase) => Promise<T>): Promise<T> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(dbName); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try { return await work(db); } finally { db.close(); }
  }
  const rows = () => database(db => new Promise<Record<string, unknown[]>>((resolve, reject) => {
    const tx = db.transaction(['sessions', 'events', 'meta'], 'readonly'), result: Record<string, unknown[]> = {};
    for (const name of ['sessions', 'events', 'meta']) { const request = tx.objectStore(name).getAll(); request.onsuccess = () => { result[name] = request.result; }; }
    tx.oncomplete = () => resolve(result); tx.onabort = tx.onerror = () => reject(tx.error);
  }));
  const put = (value: unknown) => database(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put(value);
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
  }));
  async function training(id: string, material: Material = CAFE_MATERIAL) {
    const engine = new TrainingEngine({ sessionId: id, material }); engine.input(`real input ${id}`);
    const snapshot = engine.getSnapshot(); await repository.saveSession(snapshot); return snapshot;
  }
  async function listening(id: string, material: Material = NPS_MATERIAL) {
    const snapshot = await training(id, material);
    const { record } = await repository.beginListeningSessionScope(snapshot, { scopeId: `scope-${id}`, startedAt: new Date().toISOString(), referenceVersion: `reference-${id}` });
    return record;
  }
  return { repository, rows, put, training, listening };
}

test('valid listening envelope then newer Cafe is partitioned without blocking ordinary bootstrap or changing any stored bytes', async t => {
  const f = fixture(t), older = await f.training('earlier-cafe'), wrapped = await f.listening('listening-nps'), newer = await f.training('newer-cafe');
  const before = await f.rows(), list = await f.repository.listHistory();
  assert.equal(list.entries.length, 2); assert.ok(list.entries.every(entry => entry.status === 'ready'));
  assert.deepEqual(new Set(list.entries.map(entry => entry.status === 'ready' && entry.summary.sessionId)), new Set([older.sessionId, newer.sessionId]));
  const boot = await readDefaultCourseBootstrap(f.repository); assert.equal(boot.saved, null); assert.equal(boot.preview, true);
  assert.deepEqual(await f.repository.loadListeningSession(wrapped.sessionId), wrapped);
  await assert.rejects(f.repository.loadHistorySession(wrapped.sessionId));
  assert.deepEqual(await f.rows(), before);
});

test('latest valid listening envelope still restores with its full assistance record', async t => {
  const f = fixture(t); await f.training('older-cafe'); const wrapped = await f.listening('latest-listening'), before = await f.rows();
  const boot = await readDefaultCourseBootstrap(f.repository);
  assert.deepEqual(boot.listeningSession, wrapped); assert.deepEqual(boot.saved, wrapped.trainingSnapshot);
  assert.equal(boot.preview, false); assert.deepEqual(await f.rows(), before);
});

test('older ordinary NPS restores exactly across valid listening and newer Cafe rows', async t => {
  const f = fixture(t), nps = await f.training('older-nps', NPS_MATERIAL); await f.listening('middle-listening'); await f.training('latest-cafe');
  const before = await f.rows(), boot = await readDefaultCourseBootstrap(f.repository);
  assert.deepEqual(boot.saved, nps); assert.equal(boot.listeningSession, undefined); assert.deepEqual(await f.rows(), before);
});

test('Training pagination counts only its partition and never emits empty pages for valid listening rows', async t => {
  const f = fixture(t); await f.listening('a-listening'); await f.training('a-cafe'); await f.listening('b-listening'); await f.training('b-cafe'); await f.training('c-nps', NPS_MATERIAL);
  const before = await f.rows(), ids: string[] = []; let after: LegacyHistoryCursor | null = null;
  do {
    const page = await f.repository.listHistory({ limit: 1, after }); assert.equal(page.entries.length, 1);
    const entry = page.entries[0]; assert.equal(entry.status, 'ready'); if (entry.status === 'ready') ids.push(entry.summary.sessionId);
    if (!page.hasMore) { assert.equal(page.nextCursor, null); break; }
    assert.ok(page.nextCursor); after = page.nextCursor;
  } while (ids.length < 5);
  assert.deepEqual(new Set(ids), new Set(['a-cafe', 'b-cafe', 'c-nps'])); assert.equal(ids.length, 3); assert.deepEqual(await f.rows(), before);
});

test('a full page worth of listening rows cannot hide a later valid NPS Training row', async t => {
  const f = fixture(t), nps = await f.training('oldest-nps', NPS_MATERIAL);
  await f.put({ sessionId: nps.sessionId, sequence: nps.sequence, snapshot: nps, updatedAt: '2026-10-01T00:00:00.000Z' });
  for (let index = 0; index < 101; index++) await f.listening(`newer-listening-${index}`);
  const cafe = await f.training('latest-cafe'), before = await f.rows();
  const first = await f.repository.listHistory({ limit: 1 });
  assert.equal(first.entries.length, 1); assert.equal(first.entries[0].status === 'ready' && first.entries[0].summary.sessionId, cafe.sessionId);
  assert.equal(first.hasMore, true); assert.ok(first.nextCursor);
  const second = await f.repository.listHistory({ limit: 1, after: first.nextCursor });
  assert.equal(second.entries.length, 1); assert.equal(second.entries[0].status === 'ready' && second.entries[0].summary.sessionId, nps.sessionId);
  assert.equal(second.hasMore, false); assert.equal(second.nextCursor, null);
  assert.deepEqual((await readDefaultCourseBootstrap(f.repository)).saved, nps); assert.deepEqual(await f.rows(), before);
});

test('a store containing only valid listening records has an empty terminal Training partition', async t => {
  const f = fixture(t), wrapped = await f.listening('only-listening'), before = await f.rows();
  const page = await f.repository.listHistory({ limit: 1 });
  assert.deepEqual(page.entries, []); assert.equal(page.hasMore, false); assert.equal(page.nextCursor, null);
  assert.deepEqual(await f.repository.listListeningSessions(), [wrapped]); assert.deepEqual(await f.rows(), before);
});

for (const key of ['different-primary-key', 42]) test(`listening partition validates the actual primary key: ${key}`, async t => {
  const f = fixture(t), wrapped = await f.listening('valid-envelope');
  const factory = new IDBFactory(), dbName = `key-${crypto.randomUUID()}`;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(dbName, 1);
    request.onupgradeneeded = () => { for (const name of ['sessions', 'events', 'meta']) request.result.createObjectStore(name); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put(wrapped, key);
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
  });
  db.close();
  const repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName }); t.after(() => repository.close());
  const list = await repository.listHistory(); assert.equal(list.entries.length, 1);
  const entry = list.entries[0]; assert.equal(entry.status, 'error');
  if (entry.status === 'error') { assert.equal(entry.sessionId, typeof key === 'string' ? key : null); assert.equal(entry.error.code, 'invalid-record'); }
});

for (const fault of ['invalid conditions', 'Training-shaped sentinel', 'unknown envelope version', 'wrong embedded identity'] as const) test(`${fault} stays an unreadable preserved row and blocks default bootstrap`, async t => {
  const f = fixture(t), wrapped = await f.listening('invalid-listening'), invalid: any = structuredClone(wrapped);
  if (fault === 'invalid conditions') invalid.conditions = null;
  if (fault === 'Training-shaped sentinel') invalid.snapshot = structuredClone(wrapped.trainingSnapshot);
  if (fault === 'unknown envelope version') invalid.version = 'listening-session-v999';
  if (fault === 'wrong embedded identity') invalid.trainingSnapshot.sessionId = 'not-the-record-key';
  await f.put(invalid); await f.training('latest-cafe'); const before = await f.rows();
  assert.throws(() => readListeningSession(invalid));
  const list = await f.repository.listHistory(), entry = list.entries.find(entry => entry.status === 'error');
  assert.ok(entry); assert.equal(entry.sessionId, wrapped.sessionId);
  await assert.rejects(readDefaultCourseBootstrap(f.repository), /已保存历史包含无法核验的记录/);
  assert.deepEqual(await f.rows(), before);
});
