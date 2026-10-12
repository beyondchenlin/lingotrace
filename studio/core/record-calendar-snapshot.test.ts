import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { IDBDatabase, IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { IndexedDBTrainingRepository } from './repository';
import { TrainingEngine } from './training';
import { ListeningConditions } from './listening-flow';
import { readListeningSession, type ListeningSessionRecord } from './listening-session';
import { listeningSessionExport, readListeningSessionExport } from './listening-session-export';
import { RecordCalendarReader } from './record-calendar-reader';
import { RecordCalendarMetrics, projectRecordCalendarMetricFacts } from './record-calendar-metrics';

const fast = { yieldControl: async () => {} };
async function fixture(t: TestContext, count: number) {
  const factory = new IDBFactory(), dbName = t.name;
  const repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  t.after(() => repository.close());
  const records = new Map<string, ListeningSessionRecord>(), expected = new RecordCalendarMetrics('UTC');
  for (let index = 0; index < count; index++) {
    const sessionId = `synthetic-${String(index).padStart(3, '0')}`;
    let serial = 0, now = 0;
    const start = Date.parse(`2026-10-${String(1 + index % 10).padStart(2, '0')}T12:00:00.000Z`);
    const engine = new TrainingEngine({ sessionId, clock: { now: () => now, wallTime: () => new Date(start + now).toISOString(), id: () => `${sessionId}-event-${++serial}` } });
    const input = (text: string) => { now += 250; engine.input(text, 'typed', { version: 'dom-edit-v1', kind: 'input', inputType: 'insertText', data: text.at(-1) ?? null }); };
    const target = engine.cue.text;
    for (let i = 1; i <= 5; i++) input(target.slice(0, i));
    await repository.saveSession(engine.getSnapshot());
    const options = { scopeId: `${sessionId}-scope`, startedAt: new Date(start + now).toISOString(), referenceVersion: 'synthetic-reference-1' };
    const admission = await repository.beginListeningSessionScope(engine.getSnapshot(), options), snapshot = engine.getSnapshot();
    const conditions = new ListeningConditions({ sessionId, roundId: snapshot.roundId, materialId: snapshot.material.id, materialVersion: snapshot.material.version, referenceVersion: options.referenceVersion }, 'complete-to-submit');
    conditions.present(engine.cue.id, 'automatic-text', true, options.referenceVersion);
    for (let i = 6; i <= target.length; i++) input(target.slice(0, i));
    now += 250; const boundary = conditions.capture(engine.getSnapshot()); engine.submit(); conditions.complete(boundary, engine.getSnapshot());
    const record = await repository.saveListeningSession(admission.permit, engine.getSnapshot(), conditions.snapshot(), 0);
    records.set(sessionId, record); expected.add(await projectRecordCalendarMetricFacts(record, `listening-session:${sessionId}`, 'UTC'));
  }
  await repository.disableAutomaticHistory(0);
  async function database<T>(work: (db: globalThis.IDBDatabase) => Promise<T>) {
    const db = await new Promise<globalThis.IDBDatabase>((resolve, reject) => { const r = factory.open(dbName); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await work(db); } finally { db.close(); }
  }
  const capture = () => database(db => new Promise<string>((resolve, reject) => {
    const data: Record<string, unknown> = { version: db.version, stores: [...db.objectStoreNames] }, tx = db.transaction([...db.objectStoreNames], 'readonly');
    for (const name of db.objectStoreNames) {
      const values = tx.objectStore(name).getAll(), keys = tx.objectStore(name).getAllKeys();
      values.onsuccess = () => { data[`${name}Values`] = values.result; }; keys.onsuccess = () => { data[`${name}Keys`] = keys.result; };
    }
    tx.oncomplete = () => resolve(JSON.stringify(data)); tx.onabort = tx.onerror = () => reject(tx.error);
  }));
  const put = (row: unknown) => database(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put(row);
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
  }));
  return { repository, records, expected: expected.getSnapshot(), capture, put };
}
function observe(t: TestContext, repository: IndexedDBTrainingRepository) {
  const counts = { lists: 0, returned: 0, loads: 0, sessionScans: 0, sessionVisits: 0, writeTransactions: 0, writes: 0 };
  const list = repository.listListeningSessions.bind(repository), load = repository.loadListeningSession.bind(repository);
  t.mock.method(repository, 'listListeningSessions', async () => { counts.lists++; const records = await list(); counts.returned += records.length; return records; });
  t.mock.method(repository, 'loadListeningSession', async (id: string) => { counts.loads++; return load(id); });
  const cursor = IDBObjectStore.prototype.openCursor, transaction = IDBDatabase.prototype.transaction;
  t.mock.method(IDBObjectStore.prototype, 'openCursor', function(this: IDBObjectStore, ...args: Parameters<typeof cursor>) {
    const request = cursor.apply(this, args);
    if (this.name === 'sessions') { counts.sessionScans++; request.addEventListener('success', () => { if (request.result) counts.sessionVisits++; }); }
    return request;
  });
  t.mock.method(IDBDatabase.prototype, 'transaction', function(this: IDBDatabase, ...args: Parameters<typeof transaction>) { if (args[1] && args[1] !== 'readonly') counts.writeTransactions++; return transaction.apply(this, args); });
  for (const name of ['add', 'put', 'delete', 'clear'] as const) {
    const original = IDBObjectStore.prototype[name] as (...args: unknown[]) => unknown;
    t.mock.method(IDBObjectStore.prototype, name, function(this: IDBObjectStore, ...args: unknown[]) { counts.writes++; return original.apply(this, args); });
  }
  return counts;
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

for (const count of [1, 4, 100]) test(`real ${count}-wrapper refresh uses bounded complete-family scans and exact immutable metrics`, async t => {
  const f = await fixture(t, count), before = await f.capture(), status = JSON.stringify([f.repository.getStatus(), f.repository.getAutomaticHistoryStatus()]);
  const counts = observe(t, f.repository), reader = new RecordCalendarReader(f.repository, fast); t.after(() => reader.dispose());
  await reader.refresh('UTC'); const view = reader.getSnapshot();
  assert.equal(view.status, 'loaded'); assert.equal(view.records.length, count); assert.equal(view.unreadableCount, 0);
  assert.deepEqual(view.metrics, f.expected);
  assert.equal(view.metrics.days.reduce((sum, day) => sum + (day.submissions.value ?? 0), 0), count);
  assert.equal(view.metrics.days.reduce((sum, day) => sum + (day.firstCompletions.value ?? 0), 0), count);
  assert.ok(view.metrics.days.every(day => day.matchedTerms.value === 6));
  assert.equal(counts.lists, 2, 'one initial listing and one fresh whole-family verification');
  assert.equal(counts.loads, 0, 'no per-wrapper repository reload during refresh');
  assert.equal(counts.returned, 2 * count);
  assert.equal(counts.sessionScans, 3, 'one legacy partition scan plus two listening scans');
  assert.equal(counts.sessionVisits, 3 * count);
  assert.equal(counts.writeTransactions, 0); assert.equal(counts.writes, 0);
  assert.equal(JSON.stringify([f.repository.getStatus(), f.repository.getAutomaticHistoryStatus()]), status);
  assert.equal(await f.capture(), before);
  for (const record of view.records) {
    assert.equal(record.source, 'listening-session');
    assert.deepEqual(record.days, [`2026-10-${String(1 + Number(record.sessionId.slice(-3)) % 10).padStart(2, '0')}`]);
  }
  assert.doesNotMatch(JSON.stringify(view), /trainingSnapshot|preBRecord|presentations|alignment/);
  await reader.select(view.records[0].key); const selected = reader.getSnapshot().selected;
  assert.equal(counts.loads, 1, 'detail selection still rereads the current durable family');
  assert.equal(selected?.source, 'listening-session');
  if (selected?.source === 'listening-session') {
    assert.deepEqual(selected.listeningSession, f.records.get(selected.record.sessionId));
    assert.deepEqual(readListeningSessionExport(JSON.parse(listeningSessionExport(selected.listeningSession, 'json').text)), selected.listeningSession);
    const original = f.records.get(selected.record.sessionId)!;
    assert.equal(listeningSessionExport(selected.listeningSession, 'csv').text, listeningSessionExport(original, 'csv').text);
  }
  assert.equal(await f.capture(), before); assert.equal(counts.writeTransactions, 0); assert.equal(counts.writes, 0);
  // Reuse the same 6,300-event database for both cancellation tails; separate
  // 100-row factories retain redundant transaction graphs in fake-indexeddb.
  if (count === 100) for (const late of ['success', 'failure'] as const) await assertSnapshotCancellation(t, f, counts, late);
});

test('snapshot adapters reject every malformed, duplicate, missing or changed member atomically, including extras', async t => {
  const f = await fixture(t, 2), originals = [...f.records.values()], first = originals[0], second = originals[1];
  const newer = readListeningSession({ ...second, scope: { ...second.scope, revision: second.scope.revision + 1 } });
  const cases: unknown[] = [null, {}, [], [first], [second], [first, second, first], [first, newer],
    [first, second, { ...first, sessionId: 'unlisted-corrupt', conditions: undefined }],
    [first, second, { version: 'future-unknown', sessionId: 'unlisted-unknown' }],
    [first, { ...second, conditions: undefined }]];
  const before = await f.capture();
  for (const values of cases) {
    f.repository.readListeningSessionSnapshot = async () => values as readonly ListeningSessionRecord[];
    const reader = new RecordCalendarReader(f.repository, { ...fast, yieldEvery: 1 });
    let published = false; reader.subscribe(() => { published ||= reader.getSnapshot().records.some(record => record.source === 'listening-session'); });
    await reader.refresh('UTC'); assert.equal(reader.getSnapshot().status, 'failed'); assert.equal(reader.getSnapshot().unreadableCount, 1);
    assert.equal(published, false); assert.deepEqual(reader.getSnapshot().metrics.days, []); reader.dispose();
  }
  assert.equal(await f.capture(), before);
});

test('failed or nonfunction snapshot capability never silently falls back to per-ID reads', async t => {
  const f = await fixture(t, 1); let loads = 0;
  t.mock.method(f.repository, 'loadListeningSession', async () => { loads++; return [...f.records.values()][0]; });
  for (const snapshot of [null, true, async () => { throw Error('snapshot unavailable'); }]) {
    Object.assign(f.repository, { readListeningSessionSnapshot: snapshot });
    const reader = new RecordCalendarReader(f.repository, fast); await reader.refresh('UTC');
    assert.equal(reader.getSnapshot().status, 'failed'); assert.equal(loads, 0); reader.dispose();
  }
});

test('snapshot capability does not bypass missing mandatory legacy read capabilities', async t => {
  const f = await fixture(t, 1);
  for (const absent of ['listListeningSessions', 'loadListeningSession'] as const) {
    const saved = f.repository[absent]; Object.assign(f.repository, { [absent]: undefined });
    const reader = new RecordCalendarReader(f.repository, fast); await reader.refresh('UTC');
    assert.equal(reader.getSnapshot().status, 'failed'); reader.dispose(); Object.assign(f.repository, { [absent]: saved });
  }
});

test('fresh snapshot rejects a newly added corrupt unrelated wrapper and never reuses a previous refresh', async t => {
  const f = await fixture(t, 1), original = [...f.records.values()][0], actual = f.repository.readListeningSessionSnapshot.bind(f.repository);
  const reader = new RecordCalendarReader(f.repository, fast); t.after(() => reader.dispose());
  await reader.refresh('UTC'); assert.equal(reader.getSnapshot().status, 'loaded');
  let before = '';
  t.mock.method(f.repository, 'readListeningSessionSnapshot', async () => {
    await f.put({ ...original, sessionId: 'new-unrelated-corrupt', conditions: undefined }); before = await f.capture();
    return actual();
  });
  await reader.refresh('UTC'); assert.equal(reader.getSnapshot().status, 'failed'); assert.equal(reader.getSnapshot().records.length, 0);
  assert.deepEqual(reader.getSnapshot().metrics.days, []); assert.equal(await f.capture(), before);
  await assert.rejects(f.repository.loadListeningSession(original.sessionId));
});

test('unknown stored ownership remains unreadable in legacy partition and never becomes a listening record', async t => {
  const f = await fixture(t, 1), original = [...f.records.values()][0];
  await f.put({ version: 'future-listening-v2', sessionId: 'unknown-owner', updatedAt: original.updatedAt, snapshot: original.snapshot });
  const before = await f.capture(), reader = new RecordCalendarReader(f.repository, fast); t.after(() => reader.dispose());
  await reader.refresh('UTC'); const view = reader.getSnapshot();
  assert.equal(view.status, 'partial'); assert.equal(view.unreadableCount, 1); assert.equal(view.records.length, 1);
  assert.equal(view.records[0].key, `listening-session:${original.sessionId}`); assert.deepEqual(view.metrics, f.expected);
  assert.equal(await f.capture(), before);
});

test('snapshot captures all mutable adapter wrappers before yielding and ignores only valid unlisted extras', async t => {
  const f = await fixture(t, 3), originals = [...f.records.values()], mutable = structuredClone(originals);
  const list = f.repository.listListeningSessions.bind(f.repository); let snapshotReady = false, mutated = false;
  t.mock.method(f.repository, 'listListeningSessions', async () => (await list()).filter(row => row.sessionId !== originals[2].sessionId));
  t.mock.method(f.repository, 'readListeningSessionSnapshot', async () => { snapshotReady = true; return mutable; });
  const reader = new RecordCalendarReader(f.repository, { yieldEvery: 1, yieldControl: async () => {
    if (snapshotReady && !mutated) { mutated = true; Object.assign(mutable[1], { conditions: undefined }); mutable.splice(0); }
  } }); t.after(() => reader.dispose());
  await reader.refresh('UTC'); assert.equal(mutated, true); assert.equal(reader.getSnapshot().status, 'loaded');
  assert.deepEqual(reader.getSnapshot().records.map(row => row.sessionId).sort(), originals.slice(0, 2).map(row => row.sessionId).sort());
});

async function assertSnapshotCancellation(t: TestContext, f: Awaited<ReturnType<typeof fixture>>, counts: ReturnType<typeof observe>, late: 'success' | 'failure') {
  const before = await f.capture(), previousCounts = { ...counts };
  const actual = f.repository.readListeningSessionSnapshot.bind(f.repository), started = deferred<void>(), gate = deferred<readonly ListeningSessionRecord[]>();
  let finished!: readonly ListeningSessionRecord[];
  const snapshotMock = t.mock.method(f.repository, 'readListeningSessionSnapshot', async () => { finished = await actual(); started.resolve(); return gate.promise; });
  const reader = new RecordCalendarReader(f.repository, fast); t.after(() => reader.dispose());
  let publications = 0; reader.subscribe(() => { publications++; });
  const reading = reader.refresh('UTC'); await started.promise; reader.cancel(); await reading;
  const cancelled = reader.getSnapshot(), seen = publications;
  assert.equal(cancelled.status, 'cancelled'); assert.deepEqual(cancelled.records, []); assert.deepEqual(cancelled.metrics.days, []);
  if (late === 'success') gate.resolve(finished); else gate.reject(Error('late snapshot read failure'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(reader.getSnapshot(), cancelled); assert.equal(publications, seen);
  assert.equal(counts.lists - previousCounts.lists, 2); assert.equal(counts.loads - previousCounts.loads, 0); assert.equal(counts.sessionScans - previousCounts.sessionScans, 3);
  assert.equal(counts.writes, 0); assert.equal(counts.writeTransactions, 0); assert.equal(await f.capture(), before);
  reader.dispose(); snapshotMock.mock.restore();
}

test('new refresh epoch fences an old snapshot and takes a new read rather than cached data', async t => {
  const f = await fixture(t, 1), gate = deferred<readonly ListeningSessionRecord[]>(), started = deferred<void>();
  const actual = f.repository.readListeningSessionSnapshot.bind(f.repository); let calls = 0;
  t.mock.method(f.repository, 'readListeningSessionSnapshot', async () => { const values = await actual(); if (++calls === 1) { started.resolve(); return gate.promise; } return values; });
  const reader = new RecordCalendarReader(f.repository, fast); t.after(() => reader.dispose());
  const old = reader.refresh('UTC'); await started.promise;
  await reader.refresh('Asia/Shanghai'); await old; const fresh = reader.getSnapshot();
  assert.equal(calls, 2); assert.equal(fresh.status, 'loaded'); assert.equal(fresh.timeZone, 'Asia/Shanghai');
  gate.resolve([...f.records.values()]); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(reader.getSnapshot(), fresh);
});

test('fresh selection after snapshot refresh rejects condition-only changes and unrelated corruption', async t => {
  const f = await fixture(t, 1), original = [...f.records.values()][0], reader = new RecordCalendarReader(f.repository, fast); t.after(() => reader.dispose());
  await reader.refresh('UTC');
  const changed = readListeningSession({ ...original, conditions: { ...original.conditions,
    presentations: [...original.conditions.presentations, { ...original.conditions.presentations[0], ordinal: 3, surface: 'subtitle' }] } });
  await f.put(changed); const afterEdit = await f.capture();
  await reader.select(`listening-session:${original.sessionId}`); assert.equal(reader.getSnapshot().selected, null); assert.ok(reader.getSnapshot().error);
  let delivered = false; await assert.rejects(f.repository.deliverListeningSession(original.sessionId, original, () => { delivered = true; })); assert.equal(delivered, false);
  assert.equal(await f.capture(), afterEdit);
  await reader.refresh('UTC'); assert.equal(reader.getSnapshot().status, 'loaded');
  await f.put({ ...original, sessionId: 'unrelated-corrupt', conditions: undefined }); const afterCorruption = await f.capture();
  await reader.select(`listening-session:${original.sessionId}`); assert.equal(reader.getSnapshot().selected, null); assert.ok(reader.getSnapshot().error);
  assert.equal(await f.capture(), afterCorruption);
});

for (const change of ['unlisted corruption', 'same-sequence edit'] as const) test(`final snapshot fence detects ${change} introduced during projection`, async t => {
  const f = await fixture(t, 1), original = [...f.records.values()][0], digest = crypto.subtle.digest.bind(crypto.subtle);
  let changed = false, afterEdit = '';
  t.mock.method(crypto.subtle, 'digest', async (...args: Parameters<typeof digest>) => {
    if (!changed) {
      changed = true;
      await f.put(change === 'unlisted corruption' ? { ...original, sessionId: 'unlisted-corrupt', conditions: undefined }
        : readListeningSession({ ...original, scope: { ...original.scope, revision: original.scope.revision + 1 } }));
      afterEdit = await f.capture();
    }
    return digest(...args);
  });
  const reader = new RecordCalendarReader(f.repository, fast); t.after(() => reader.dispose());
  let published = false; reader.subscribe(() => { published ||= reader.getSnapshot().records.length > 0; });
  await reader.refresh('UTC'); assert.equal(changed, true); assert.equal(reader.getSnapshot().status, 'failed');
  assert.equal(published, false); assert.deepEqual(reader.getSnapshot().metrics.days, []); assert.equal(await f.capture(), afterEdit);
});
