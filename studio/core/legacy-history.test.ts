import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBDatabase, IDBObjectStore } from 'fake-indexeddb';
import { IndexedDBTrainingRepository } from './repository.ts';
import { TrainingEngine, replay, type TrainingSnapshot, type Material } from './training.ts';
import { exportStudioSession } from './session-export.ts';
import { LEGACY_HISTORY_SOURCE, LegacyHistoryError, readLegacyHistoryRecord, type LegacyHistoryCursor, type LegacyHistoryEntry, type LegacyHistoryList } from './legacy-history.ts';

const material: Material = { id: 'history-material', version: 'retained-v1', title: 'Original retained material', rights: 'Original', cues: [
  { id: 'one', text: 'one two three', start: 0, end: 6 }, { id: 'two', text: 'four five', start: 6, end: 12 },
] };
function exercise(sessionId: string, selectedMaterial = material) {
  let id = 0, now = 0;
  const engine = new TrainingEngine({ sessionId, material: selectedMaterial, clock: { now: () => now, wallTime: () => new Date(Date.UTC(2026, 9, 8) + now).toISOString(), id: () => `${sessionId}-event-${++id}` } });
  engine.input('one two'); now += 340; engine.submit(); engine.input('one two three'); now += 200; engine.submit();
  return engine;
}
function open(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => { const request = factory.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error); });
}
async function databaseFacts(factory: IDBFactory, name: string) {
  const db = await open(factory, name);
  try {
    const transaction = db.transaction(['sessions', 'events', 'meta'], 'readonly'), result: Record<string, unknown> = {};
    for (const name of ['sessions', 'events', 'meta']) { const request = transaction.objectStore(name).getAll(); request.onsuccess = () => { result[name] = request.result; }; }
    await done(transaction); return result;
  } finally { db.close(); }
}
function stored(snapshot: TrainingSnapshot, updatedAt = '2026-10-08T12:00:00.000Z') { return { sessionId: snapshot.sessionId, sequence: snapshot.sequence, snapshot, updatedAt }; }
async function putRecord(factory: IDBFactory, name: string, value: unknown) {
  const db = await open(factory, name); try { const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put(value); await done(tx); } finally { db.close(); }
}
async function deleteRecord(factory: IDBFactory, name: string, id: IDBValidKey) {
  const db = await open(factory, name); try { const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').delete(id); await done(tx); } finally { db.close(); }
}
const code = (expected: string) => (error: unknown) => error instanceof LegacyHistoryError && error.code === expected;

test('history lists multiple stored sessions with actual facts and exact metadata, and changes no store or save status', async () => {
  const factory = new IDBFactory(), dbName = 'legacy-readonly', repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  const a = exercise('first').getSnapshot(), b = exercise('second').getSnapshot();
  await repository.saveSession(a); await repository.saveSession(b);
  await putRecord(factory, dbName, stored(a, '2026-10-08T10:00:00.000Z')); await putRecord(factory, dbName, stored(b));
  const before = await databaseFacts(factory, dbName), status = repository.getStatus(); let notifications = 0;
  const unsubscribe = repository.subscribe(() => { notifications++; });
  const original = IDBDatabase.prototype.transaction, transactions: { stores: string[]; mode: string | undefined }[] = [];
  IDBDatabase.prototype.transaction = function (stores, mode, options) {
    transactions.push({ stores: typeof stores === 'string' ? [stores] : [...stores], mode }); return original.call(this, stores, mode, options);
  };
  try {
    const list = await repository.listHistory(); assert.equal(list.source, LEGACY_HISTORY_SOURCE); assert.equal(list.hasMore, false);
    assert.equal(list.entries.length, 2); const entry = list.entries[0]; assert.equal(entry.status, 'ready'); if (entry.status !== 'ready') return;
    assert.deepEqual(entry.summary, { source: LEGACY_HISTORY_SOURCE, sessionId: b.sessionId, sequence: b.sequence, createdAt: b.createdAt, updatedAt: '2026-10-08T12:00:00.000Z', schemaVersion: b.schemaVersion,
      materialId: b.material.id, materialVersion: b.material.version, materialTitle: b.material.title, materialSource: 'embedded-snapshot', ruleVersions: ['word-alignment-v3'], paceRuleVersions: ['grapheme-exp-3s-v1'],
      earnedWords: b.earnedWords, completedCount: b.completedCueIds.length, attemptCount: b.attempts.length, activeMs: b.activeMs });
    const detail = await repository.loadHistorySession(a.sessionId); assert.deepEqual(detail?.snapshot, a); assert.notEqual(detail?.snapshot, a);
    assert.ok(Object.isFrozen(detail)); assert.ok(Object.isFrozen(detail?.snapshot.attempts[0].conditions));
    assert.ok(Object.isFrozen(list.entries)); assert.equal(repository.getStatus(), status); assert.equal(notifications, 0);
    assert.ok(transactions.every(t => t.mode === 'readonly' && t.stores.length === 1 && t.stores[0] === 'sessions'));
  } finally { IDBDatabase.prototype.transaction = original; unsubscribe(); }
  assert.deepEqual(await databaseFacts(factory, dbName), before); assert.equal((await repository.loadLatest())?.sessionId, b.sessionId); await repository.close();
});

test('history waits for already queued saves without changing their persistence notifications', async () => {
  const factory = new IDBFactory(), repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName: 'legacy-queue' });
  const a = exercise('queue-a').getSnapshot(), b = exercise('queue-b').getSnapshot();
  const first = repository.saveSession(a), second = repository.saveSession(b); assert.equal(repository.getStatus().pendingWrites, 2);
  let historyNotifications = 0; const unsubscribe = repository.subscribe(() => { historyNotifications++; });
  const listPromise = repository.listHistory(), detailPromise = repository.loadHistorySession(b.sessionId);
  await Promise.all([first, second]); const status = repository.getStatus(), notificationsAfterWrites = historyNotifications;
  const [list, detail] = await Promise.all([listPromise, detailPromise]); assert.equal(list.entries.length, 2); assert.deepEqual(detail?.snapshot, b);
  assert.equal(repository.getStatus(), status); assert.equal(historyNotifications, notificationsAfterWrites); unsubscribe(); await repository.close();
});

test('a failed save stays failed after successful history list, detail and guarded delivery', async () => {
  const factory = new IDBFactory(), dbName = 'legacy-write-error', repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  const engine = exercise('saved'), snapshot = engine.getSnapshot(); await repository.saveSession(snapshot); engine.input('later');
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) { if (this.name === 'meta') throw new Error('test metadata failure'); return original.call(this, value, key); };
  try { await assert.rejects(repository.saveSession(engine.getSnapshot()), /test metadata failure/); }
  finally { IDBObjectStore.prototype.put = original; }
  const status = repository.getStatus(), before = await databaseFacts(factory, dbName); assert.equal(status.state, 'error');
  assert.equal((await repository.listHistory()).entries.length, 1); const detail = await repository.loadHistorySession(snapshot.sessionId); assert.ok(detail);
  let delivered = 0; await repository.deliverHistorySession(snapshot.sessionId, detail.snapshot, () => { delivered++; }); assert.equal(delivered, 1);
  assert.equal(repository.getStatus(), status); assert.deepEqual(await databaseFacts(factory, dbName), before); await repository.close();
});

test('malformed records are isolated, never zero-filled or repaired, and schema/material errors are explicit', async () => {
  const factory = new IDBFactory(), dbName = 'legacy-corrupt', repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  const valid = exercise('valid').getSnapshot(); await repository.saveSession(valid);
  const broken = structuredClone(stored(exercise('missing-score').getSnapshot())) as unknown as { snapshot: Record<string, unknown> };
  delete broken.snapshot.earnedWords; await putRecord(factory, dbName, broken);
  const schema = structuredClone(stored(exercise('unknown-schema').getSnapshot())) as unknown as { snapshot: Record<string, unknown> }; schema.snapshot.schemaVersion = 'future-v99'; await putRecord(factory, dbName, schema);
  const materialRecord = structuredClone(stored(exercise('unknown-material').getSnapshot())) as unknown as { snapshot: { material: Record<string, unknown> } }; delete materialRecord.snapshot.material.version; await putRecord(factory, dbName, materialRecord);
  const before = await databaseFacts(factory, dbName), status = repository.getStatus(), list = await repository.listHistory();
  assert.equal(list.entries.length, 4); assert.equal(list.entries.filter(e => e.status === 'ready').length, 1);
  assert.deepEqual(list.entries.filter(e => e.status === 'error').map(e => e.error.code).sort(), ['invalid-material', 'invalid-record', 'unsupported-schema']);
  await assert.rejects(repository.loadHistorySession('missing-score'), code('invalid-record'));
  await assert.rejects(repository.loadHistorySession('unknown-schema'), code('unsupported-schema'));
  await assert.rejects(repository.loadHistorySession('unknown-material'), code('invalid-material'));
  assert.equal(repository.getStatus(), status); assert.deepEqual(await databaseFacts(factory, dbName), before); await repository.close();
});

test('stored historical scores and safe text remain verbatim through selection and both existing exports', async () => {
  const factory = new IDBFactory(), dbName = 'legacy-retained-scores', repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  const safeText = '=SUM(1,2)\n<img src=x onerror="bad()"> 你好';
  const engine = exercise('retained', { ...material, title: safeText }); engine.input(safeText, 'paste'); engine.submit();
  await repository.saveSession(engine.getSnapshot());
  const original = structuredClone(engine.getSnapshot()) as unknown as { earnedWords: number; activeMs: number; attempts: { accuracy: number; gain: number }[] };
  original.earnedWords = 42; original.activeMs = 1234.5; original.attempts[0].accuracy = 17; original.attempts[0].gain = 11;
  const historical = original as unknown as TrainingSnapshot; await putRecord(factory, dbName, stored(historical));
  assert.notEqual(replay(historical.events, historical.material).earnedWords, historical.earnedWords);
  const detail = await repository.loadHistorySession(historical.sessionId); assert.ok(detail);
  assert.deepEqual(detail.snapshot, historical); assert.equal(detail.summary.earnedWords, 42); assert.equal(detail.summary.activeMs, 1234.5); assert.equal(detail.summary.materialTitle, safeText);
  const output = exportStudioSession(detail.snapshot, '2026-10-09T00:00:00.000Z');
  assert.deepEqual(JSON.parse(output.json).session, historical); assert.deepEqual(JSON.parse(output.json).attempts, historical.attempts);
  assert.match(output.csv, /"17"/); assert.ok(output.csv.includes("'=SUM(1,2)"));
  assert.throws(() => { (detail.snapshot as { earnedWords: number }).earnedWords = 0; }, TypeError);
  assert.deepEqual((await repository.loadHistorySession(historical.sessionId))?.snapshot, historical); await repository.close();
});

test('retained version labels are explicit and self-contained material does not require today’s catalog', () => {
  const raw = structuredClone(stored(exercise('older-version', { ...material, id: 'no-longer-in-current-catalog', version: 'original-2019' }).getSnapshot())) as unknown as { snapshot: { events: { ruleVersion: string; paceRuleVersion: string }[]; attempts: { ruleVersion: string }[] } };
  for (const event of raw.snapshot.events) { event.ruleVersion = 'historical-score-rule'; event.paceRuleVersion = 'historical-pace-rule'; }
  raw.snapshot.attempts[0].ruleVersion = 'historical-score-rule';
  const detail = readLegacyHistoryRecord(raw); assert.equal(detail.summary.materialVersion, 'original-2019'); assert.equal(detail.summary.materialSource, 'embedded-snapshot');
  assert.deepEqual(detail.summary.ruleVersions, ['historical-score-rule', 'word-alignment-v3']); assert.deepEqual(detail.summary.paceRuleVersions, ['historical-pace-rule']);
  assert.deepEqual(detail.snapshot, raw.snapshot);
});

test('the latest 100 summary entries are bounded with hasMore and no unbounded getAll read', async () => {
  const factory = new IDBFactory(), dbName = 'legacy-bounded', repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  await repository.saveSession(exercise('record-000').getSnapshot());
  for (let i = 0; i < 103; i++) await putRecord(factory, dbName, stored(exercise(`record-${String(i).padStart(3, '0')}`).getSnapshot(), new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString()));
  const original = IDBObjectStore.prototype.getAll; IDBObjectStore.prototype.getAll = function () { throw new Error('unbounded history read'); };
  try {
    const list = await repository.listHistory(); assert.equal(list.entries.length, 100); assert.equal(list.hasMore, true);
    assert.equal(list.entries[0].status === 'ready' && list.entries[0].summary.sessionId, 'record-102');
    assert.equal(list.entries[99].status === 'ready' && list.entries[99].summary.sessionId, 'record-003');
    assert.deepEqual(list.nextCursor, { version: 1, updatedAtMs: Date.UTC(2026, 9, 1) + 3000, key: 'record-003' });
    const older = await repository.listHistory({ after: list.nextCursor });
    assert.deepEqual(older.entries.map(entry => entry.status === 'ready' && entry.summary.sessionId), ['record-002', 'record-001', 'record-000']);
    assert.equal(older.hasMore, false); assert.equal(older.nextCursor, null);
    const short = await repository.listHistory({ limit: 2 }); assert.equal(short.entries.length, 2); assert.equal(short.hasMore, true);
  } finally { IDBObjectStore.prototype.getAll = original; }
  for (const limit of [0, 101, NaN, Infinity, 1.5]) await assert.rejects(repository.listHistory({ limit }), code('invalid-query'));
  await repository.close();
});

test('keyset pages reach every one of 222 tied and malformed records without changing storage or save status', async () => {
  const factory = new IDBFactory(), dbName = 'legacy-many-pages', repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  await repository.saveSession(exercise('record-000').getSnapshot());
  const expected: { key: IDBValidKey; updatedAtMs: number | null; status: 'ready' | 'error' }[] = [], records: unknown[] = [];
  for (let i = 0; i < 211; i++) {
    const key = `record-${String(i).padStart(3, '0')}`, updatedAtMs = Date.UTC(2026, 9, 8) + Math.floor(i / 80) * 1000;
    records.push(stored(exercise(key).getSnapshot(), new Date(updatedAtMs).toISOString())); expected.push({ key, updatedAtMs, status: 'ready' });
  }
  const keys: IDBValidKey[] = [-Infinity, 7, Infinity, new Date(0), new Uint8Array([0, 255]).buffer, [], ['a'], ['b', 3]];
  for (const key of keys) {
    const updatedAtMs = Date.UTC(2026, 9, 8) + 2000;
    records.push({ sessionId: key, updatedAt: new Date(updatedAtMs).toISOString() }); expected.push({ key, updatedAtMs, status: 'error' });
  }
  records.push({ sessionId: 'missing-date' }, { sessionId: 'invalid-date', updatedAt: 'yesterday-ish' }, { sessionId: 'unknown-schema', updatedAt: '2026-10-08T00:00:01.000Z', snapshot: { schemaVersion: 'future-v99' } });
  expected.push({ key: 'missing-date', updatedAtMs: null, status: 'error' }, { key: 'invalid-date', updatedAtMs: null, status: 'error' }, { key: 'unknown-schema', updatedAtMs: Date.UTC(2026, 9, 8) + 1000, status: 'error' });
  const db = await open(factory, dbName), write = db.transaction('sessions', 'readwrite'); for (const record of records) write.objectStore('sessions').put(record); await done(write); db.close();
  expected.sort((a, b) => a.updatedAtMs === b.updatedAtMs ? factory.cmp(a.key, b.key) : a.updatedAtMs === null ? 1 : b.updatedAtMs === null ? -1 : b.updatedAtMs - a.updatedAtMs);
  const before = await databaseFacts(factory, dbName), status = repository.getStatus(); let notifications = 0;
  const unsubscribe = repository.subscribe(() => { notifications++; });
  const originalGetAll = IDBObjectStore.prototype.getAll, originalTransaction = IDBDatabase.prototype.transaction;
  const transactions: { stores: string[]; mode: string | undefined }[] = [];
  IDBObjectStore.prototype.getAll = function () { throw new Error('unbounded history read'); };
  IDBDatabase.prototype.transaction = function (stores, mode, options) {
    transactions.push({ stores: typeof stores === 'string' ? [stores] : [...stores], mode }); return originalTransaction.call(this, stores, mode, options);
  };
  try {
    const entries: LegacyHistoryEntry[] = [], sizes: number[] = []; let after: LegacyHistoryCursor | null = null;
    do {
      const page: LegacyHistoryList = await repository.listHistory({ after }); sizes.push(page.entries.length); entries.push(...page.entries);
      assert.ok(page.entries.length <= 100); assert.equal(page.hasMore, page.nextCursor !== null);
      if (page.nextCursor) {
        const boundary = expected[entries.length - 1]; assert.equal(page.nextCursor.updatedAtMs, boundary.updatedAtMs); assert.equal(factory.cmp(page.nextCursor.key, boundary.key), 0);
        assert.deepEqual(Object.keys(page.nextCursor).sort(), ['key', 'updatedAtMs', 'version']); assert.ok(Object.isFrozen(page.nextCursor));
      }
      after = page.nextCursor;
    } while (after);
    assert.deepEqual(sizes, [100, 100, 22]);
    assert.deepEqual(entries.map(entry => ({ status: entry.status, key: entry.status === 'ready' ? entry.summary.sessionId : entry.sessionId, updatedAtMs: entry.status === 'ready' ? Date.parse(entry.summary.updatedAt) : entry.updatedAt === null ? null : Date.parse(entry.updatedAt) })),
      expected.map(entry => ({ status: entry.status, key: typeof entry.key === 'string' ? entry.key : null, updatedAtMs: entry.updatedAtMs })));
    const ready = entries.filter(entry => entry.status === 'ready'); assert.equal(new Set(ready.map(entry => entry.summary.sessionId)).size, 211);
    const unknown = entries.find(entry => entry.status === 'error' && entry.sessionId === 'unknown-schema'); assert.ok(unknown?.status === 'error'); assert.equal(unknown.error.code, 'unsupported-schema');
    assert.ok(transactions.every(tx => tx.mode === 'readonly' && tx.stores.length === 1 && tx.stores[0] === 'sessions'));
    assert.equal(repository.getStatus(), status); assert.equal(notifications, 0);
  } finally { IDBObjectStore.prototype.getAll = originalGetAll; IDBDatabase.prototype.transaction = originalTransaction; unsubscribe(); }
  assert.deepEqual(await databaseFacts(factory, dbName), before); await repository.close();
});

test('equal-time cursors use IndexedDB primary-key ordering across string, numeric, Date, binary and array keys', async () => {
  const factory = new IDBFactory(), dbName = 'legacy-key-order', repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  await repository.saveSession(exercise('older-final-record').getSnapshot());
  await putRecord(factory, dbName, stored(exercise('older-final-record').getSnapshot(), '2026-10-07T00:00:00.000Z'));
  const keys: IDBValidKey[] = [['z'], 'z', new Uint8Array([2]).buffer, 7, 'Z', new Date(0), [], 'ä', new Uint8Array([1]).buffer, -8, ['a', ['b']]];
  for (const key of keys) await putRecord(factory, dbName, { sessionId: key, updatedAt: '2026-10-08T00:00:00.000Z' });
  keys.sort((a, b) => factory.cmp(a, b));
  const originalCmp = factory.cmp; let comparisons = 0;
  factory.cmp = function (a, b) { comparisons++; return originalCmp.call(this, a, b); };
  let after: LegacyHistoryCursor | null = null;
  for (const key of keys) {
    const page = await repository.listHistory({ limit: 1, after }); assert.equal(page.entries.length, 1); assert.equal(page.entries[0].status, 'error');
    assert.ok(page.nextCursor); assert.equal(factory.cmp(page.nextCursor.key, key), 0); after = page.nextCursor;
  }
  const end = await repository.listHistory({ limit: 1, after }); assert.equal(end.entries[0].status === 'ready' && end.entries[0].summary.sessionId, 'older-final-record');
  assert.equal(end.hasMore, false); assert.equal(end.nextCursor, null); assert.ok(comparisons > keys.length); await repository.close();
});

test('invalid cursors fail before any database read and preserve the repository status', async () => {
  const factory = new IDBFactory(), dbName = 'legacy-invalid-cursor', repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  const circular: unknown[] = []; circular.push(circular);
  const valid = { version: 1, updatedAtMs: 0, key: 'record' }, invalid: unknown[] = [
    false, '', [], {}, { ...valid, version: 2 }, { ...valid, updatedAtMs: undefined }, { ...valid, updatedAtMs: NaN },
    { ...valid, updatedAtMs: Infinity }, { ...valid, updatedAtMs: 0.5 }, { ...valid, updatedAtMs: 8.64e15 + 1 },
    { ...valid, key: undefined }, { ...valid, key: null }, { ...valid, key: NaN }, { ...valid, key: {} },
    { ...valid, key: new Date(NaN) }, { ...valid, key: [null] }, { ...valid, key: circular }, { ...valid, snapshot: {} },
  ];
  const originalOpen = factory.open; let opened = 0;
  factory.open = function (...args) { opened++; return originalOpen.apply(this, args); };
  const status = repository.getStatus();
  for (const after of invalid) await assert.rejects(repository.listHistory({ after: after as LegacyHistoryCursor }), code('invalid-query'));
  assert.equal(opened, 0); assert.equal(repository.getStatus(), status); assert.deepEqual(await factory.databases(), []);
  const empty = await repository.listHistory({ after: valid as LegacyHistoryCursor }); assert.deepEqual(empty.entries, []); assert.equal(empty.nextCursor, null);
  assert.deepEqual(await factory.databases(), []); await repository.close();
});

test('cursor and options are detached before awaiting queued writes, including nested mutable key types', async () => {
  const factory = new IDBFactory(), dbName = 'legacy-cursor-capture', repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  await repository.saveSession(exercise('older-final').getSnapshot()); await putRecord(factory, dbName, stored(exercise('older-final').getSnapshot(), '2026-10-07T00:00:00.000Z'));
  const time = Date.UTC(2026, 9, 8), key: IDBValidKey[] = [new Date(0), new Uint8Array([1]).buffer, ['b']];
  await putRecord(factory, dbName, { sessionId: key, updatedAt: new Date(time).toISOString() });
  await putRecord(factory, dbName, { sessionId: [new Date(0), new Uint8Array([1]).buffer, ['c']], updatedAt: new Date(time).toISOString() });
  const queuedWrite = repository.saveSession(exercise('queued-latest').getSnapshot()); assert.equal(repository.getStatus().pendingWrites, 1);
  const options = { limit: 1, after: { version: 1 as const, updatedAtMs: time, key } }, pending = repository.listHistory(options);
  options.limit = 100; options.after.updatedAtMs = null as unknown as number; (key[0] as Date).setTime(999999); new Uint8Array(key[1] as ArrayBuffer)[0] = 255; (key[2] as string[])[0] = 'z';
  await queuedWrite;
  const page = await pending; assert.equal(page.limit, 1); assert.equal(page.entries.length, 1); assert.ok(page.nextCursor);
  assert.equal(factory.cmp(page.nextCursor.key, [new Date(0), new Uint8Array([1]).buffer, ['c']]), 0);
  const finalPromise = repository.listHistory({ limit: 1, after: page.nextCursor });
  (page.nextCursor.key as IDBValidKey[]).splice(0); // Returned keys cannot mutate an in-flight query either.
  const finalPage = await finalPromise; assert.equal(finalPage.entries[0].status === 'ready' && finalPage.entries[0].summary.sessionId, 'older-final');
  assert.equal(finalPage.nextCursor, null); await repository.close();
});

test('deleted boundaries still continue and refresh reveals new or updated records before an old boundary', async () => {
  const factory = new IDBFactory(), dbName = 'legacy-moving-pages', repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  await repository.saveSession(exercise('a').getSnapshot());
  for (const [id, seconds] of [['a', 4], ['b', 3], ['c', 2], ['d', 1]] as const) await putRecord(factory, dbName, stored(exercise(id).getSnapshot(), new Date(Date.UTC(2026, 9, 8) + seconds * 1000).toISOString()));
  const ids = (page: LegacyHistoryList) => page.entries.map(entry => entry.status === 'ready' && entry.summary.sessionId);
  const first = await repository.listHistory({ limit: 2 }); assert.deepEqual(ids(first), ['a', 'b']); assert.ok(first.nextCursor);
  await deleteRecord(factory, dbName, 'b'); assert.deepEqual(ids(await repository.listHistory({ after: first.nextCursor })), ['c', 'd']);
  await putRecord(factory, dbName, stored(exercise('c').getSnapshot(), '2026-10-08T00:00:06.000Z'));
  await putRecord(factory, dbName, stored(exercise('new').getSnapshot(), '2026-10-08T00:00:05.000Z'));
  assert.deepEqual(ids(await repository.listHistory({ after: first.nextCursor })), ['d']);
  assert.deepEqual(ids(await repository.listHistory({ after: null })), ['c', 'new', 'a', 'd']);
  await deleteRecord(factory, dbName, 'd'); const empty = await repository.listHistory({ after: first.nextCursor });
  assert.deepEqual(empty.entries, []); assert.equal(empty.hasMore, false); assert.equal(empty.nextCursor, null); await repository.close();
});

test('history never creates an absent database or recreates a deleted record', async () => {
  const factory = new IDBFactory(), dbName = 'legacy-absent', repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  const status = repository.getStatus(); assert.deepEqual((await repository.listHistory()).entries, []); assert.equal(await repository.loadHistorySession('missing'), null);
  assert.deepEqual(await factory.databases(), []); assert.equal(repository.getStatus(), status);
  const snapshot = exercise('deleted').getSnapshot(); await repository.saveSession(snapshot); await deleteRecord(factory, dbName, snapshot.sessionId);
  const before = await databaseFacts(factory, dbName); assert.equal(await repository.loadHistorySession(snapshot.sessionId), null); assert.deepEqual((await repository.listHistory()).entries, []);
  assert.deepEqual(await databaseFacts(factory, dbName), before); await repository.close();
});

test('read failures and unsupported database versions are explicit and never replace a save error', async () => {
  const unavailable = new IndexedDBTrainingRepository(); const snapshot = exercise('unavailable').getSnapshot();
  await assert.rejects(unavailable.saveSession(snapshot)); const status = unavailable.getStatus();
  await assert.rejects(unavailable.listHistory(), code('read-failed')); await assert.rejects(unavailable.loadHistorySession(snapshot.sessionId), code('read-failed')); assert.equal(unavailable.getStatus(), status);
  const factory = new IDBFactory(), dbName = 'legacy-future-db';
  await new Promise<void>((resolve, reject) => { const request = factory.open(dbName, 2); request.onupgradeneeded = () => request.result.createObjectStore('sessions', { keyPath: 'sessionId' }); request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error); });
  const repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName }), original = repository.getStatus();
  await assert.rejects(repository.listHistory(), code('unsupported-schema')); assert.equal(repository.getStatus(), original); assert.deepEqual(await factory.databases(), [{ name: dbName, version: 2 }]);
});

test('actual readonly request failures leave an existing save error and every store untouched', async () => {
  const factory = new IDBFactory(), dbName = 'legacy-request-failure', repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  const snapshot = exercise('request-failed').getSnapshot(); await repository.saveSession(snapshot);
  await assert.rejects(repository.saveSession({ ...snapshot, events: [] }));
  const status = repository.getStatus(), before = await databaseFacts(factory, dbName), originalGet = IDBObjectStore.prototype.get, originalCursor = IDBObjectStore.prototype.openCursor;
  IDBObjectStore.prototype.get = function (query) {
    if (this.name === 'sessions' && this.transaction.mode === 'readonly') { this.transaction.abort(); throw new Error('test read request failure'); }
    return originalGet.call(this, query);
  };
  IDBObjectStore.prototype.openCursor = function (query, direction) {
    if (this.name === 'sessions' && this.transaction.mode === 'readonly') { this.transaction.abort(); throw new Error('test cursor failure'); }
    return originalCursor.call(this, query, direction);
  };
  try {
    await assert.rejects(repository.listHistory(), code('read-failed'));
    await assert.rejects(repository.loadHistorySession(snapshot.sessionId), code('read-failed'));
    let calls = 0; await assert.rejects(repository.deliverHistorySession(snapshot.sessionId, snapshot, () => { calls++; }), code('read-failed')); assert.equal(calls, 0);
  } finally { IDBObjectStore.prototype.get = originalGet; IDBObjectStore.prototype.openCursor = originalCursor; }
  assert.equal(repository.getStatus(), status); assert.deepEqual(await databaseFacts(factory, dbName), before); await repository.close();
});

test('deleting the database after selection prevents delivery without recreating storage', async () => {
  const factory = new IDBFactory(), dbName = 'legacy-database-deleted', repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  const snapshot = exercise('database-deleted').getSnapshot(); await repository.saveSession(snapshot); const selected = await repository.loadHistorySession(snapshot.sessionId); assert.ok(selected); await repository.close();
  await new Promise<void>((resolve, reject) => { const request = factory.deleteDatabase(dbName); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
  let calls = 0; await assert.rejects(repository.deliverHistorySession(snapshot.sessionId, selected.snapshot, () => { calls++; }), code('stale-record')); assert.equal(calls, 0);
  assert.equal(await repository.loadHistorySession(snapshot.sessionId), null); assert.deepEqual((await repository.listHistory()).entries, []); assert.deepEqual(await factory.databases(), []);
});

test('final delivery rejects changed/deleted records without invoking the sink', async () => {
  const factory = new IDBFactory(), dbName = 'legacy-delivery-stale', repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  const snapshot = exercise('selection').getSnapshot(); await repository.saveSession(snapshot); const selected = await repository.loadHistorySession(snapshot.sessionId); assert.ok(selected);
  let delivered = 0; const sink = () => { delivered++; };
  await repository.deliverHistorySession(snapshot.sessionId, selected.snapshot, sink); assert.equal(delivered, 1);
  const changed = structuredClone(snapshot) as { earnedWords: number }; changed.earnedWords++;
  await putRecord(factory, dbName, stored(changed as TrainingSnapshot)); await assert.rejects(repository.deliverHistorySession(snapshot.sessionId, selected.snapshot, sink), code('stale-record')); assert.equal(delivered, 1);
  await deleteRecord(factory, dbName, snapshot.sessionId); const before = await databaseFacts(factory, dbName);
  await assert.rejects(repository.deliverHistorySession(snapshot.sessionId, selected.snapshot, sink), code('stale-record')); assert.equal(delivered, 1);
  assert.deepEqual(await databaseFacts(factory, dbName), before); await repository.close();
});

test('delivery handoff holds a readonly lock until the synchronous sink has finished', async () => {
  const factory = new IDBFactory(), dbName = 'legacy-delivery-lock', repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  const snapshot = exercise('locked').getSnapshot(); await repository.saveSession(snapshot); const db = await open(factory, dbName), order: string[] = [];
  let deletion: Promise<void> | undefined;
  await repository.deliverHistorySession(snapshot.sessionId, snapshot, () => {
    order.push('sink-start'); const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').delete(snapshot.sessionId);
    deletion = done(tx).then(() => { order.push('deletion-committed'); }); order.push('sink-finished');
  });
  await deletion; assert.deepEqual(order, ['sink-start', 'sink-finished', 'deletion-committed']); assert.equal(await repository.loadHistorySession(snapshot.sessionId), null); db.close(); await repository.close();
});

test('sink throws and async sinks fail without changing records or status', async () => {
  const factory = new IDBFactory(), dbName = 'legacy-sink-errors', repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  const snapshot = exercise('sink').getSnapshot(); await repository.saveSession(snapshot); const status = repository.getStatus(), before = await databaseFacts(factory, dbName);
  await assert.rejects(repository.deliverHistorySession(snapshot.sessionId, snapshot, () => { throw new Error('download failed'); }), code('read-failed'));
  let calls = 0;
  await assert.rejects(repository.deliverHistorySession(snapshot.sessionId, snapshot, async () => { calls++; }), code('invalid-sink')); assert.equal(calls, 0);
  await assert.rejects(repository.deliverHistorySession(snapshot.sessionId, snapshot, () => Promise.reject(new Error('wrapped async'))), code('invalid-sink'));
  assert.equal(repository.getStatus(), status); assert.deepEqual(await databaseFacts(factory, dbName), before); await repository.close();
});
