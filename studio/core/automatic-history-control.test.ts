import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBDatabase, IDBObjectStore } from 'fake-indexeddb';
import { IndexedDBTrainingRepository } from './repository.ts';
import { TrainingEngine } from './training.ts';
import {
  AUTOMATIC_HISTORY_CONTROL_KEY, AUTOMATIC_HISTORY_UNSAVED_MESSAGE, AutomaticHistoryWriteFenceError,
  readAutomaticHistoryControl,
} from './automatic-history-control.ts';

function fixture(t: TestContext) {
  const factory = new IDBFactory(), dbName = `automatic-history-${t.name}`;
  const options = { indexedDB: factory, dbName }, repository = new IndexedDBTrainingRepository(options);
  let serial = 0;
  const engine = new TrainingEngine({ sessionId: 'original-session', clock: {
    now: () => 0, wallTime: () => '2026-10-09T09:00:00.000Z', id: () => `event-${++serial}`,
  } });
  engine.input('Original saved answer');
  t.after(() => repository.close());
  return { factory, dbName, options, repository, engine };
}
function open(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}
interface Facts { sessions: unknown[]; events: unknown[]; meta: { key: string; [key: string]: unknown }[] }
async function facts(factory: IDBFactory, name: string): Promise<Facts> {
  const db = await open(factory, name);
  try {
    const tx = db.transaction(['sessions', 'events', 'meta'], 'readonly'), result = {} as Facts;
    for (const name of ['sessions', 'events', 'meta'] as const) {
      const request = tx.objectStore(name).getAll(); request.onsuccess = () => { result[name] = request.result; };
    }
    await done(tx); return result;
  } finally { db.close(); }
}
function savedFacts(value: Facts): Facts { return { ...value, meta: value.meta.filter(row => row.key !== AUTOMATIC_HISTORY_CONTROL_KEY) }; }
async function putControl(factory: IDBFactory, name: string, value: unknown): Promise<void> {
  const db = await open(factory, name);
  try { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put(value); await done(tx); }
  finally { db.close(); }
}
function fence(reason?: AutomaticHistoryWriteFenceError['reason']) {
  return (error: unknown) => error instanceof AutomaticHistoryWriteFenceError && (reason === undefined || error.reason === reason);
}

test('absent control preserves normal save, append, idempotence and latest pointer without a migration', async t => {
  const { factory, dbName, repository, engine } = fixture(t);
  assert.deepEqual(await repository.readAutomaticHistoryControl(), { state: 'legacy-default', generation: 0 });
  assert.deepEqual(await factory.databases(), [], 'reading configuration never creates a database');
  await repository.saveSession(engine.getSnapshot());
  engine.input('Later saved answer'); const snapshot = engine.getSnapshot();
  await repository.saveSession(snapshot); const before = await facts(factory, dbName);
  await repository.saveSession(snapshot);
  assert.deepEqual(await facts(factory, dbName), before);
  assert.equal(before.sessions.length, 1); assert.equal(before.events.length, snapshot.events.length);
  assert.deepEqual(before.meta, [{ key: 'latest', sessionId: snapshot.sessionId }]);
  assert.deepEqual(await repository.loadLatest(), snapshot);
  assert.deepEqual(await factory.databases(), [{ name: dbName, version: 1 }]);
  assert.equal(repository.getStatus().state, 'persisted');
  assert.equal(repository.getStatus().pendingWrites, 0);
});

test('OFF synchronously fences already queued snapshots and all future automatic saves', async t => {
  const { factory, dbName, repository, engine } = fixture(t);
  await repository.saveSession(engine.getSnapshot()); const before = await facts(factory, dbName);
  engine.input('QUEUED_PRIVATE_ONE'); const a = repository.saveSession(engine.getSnapshot());
  engine.input('QUEUED_PRIVATE_TWO'); const b = repository.saveSession(engine.getSnapshot());
  const rejected = [assert.rejects(a, fence('local-off')), assert.rejects(b, fence('local-off'))];
  const off = repository.disableAutomaticHistory();
  assert.equal(repository.getAutomaticHistoryStatus().locallyStopped, true);
  assert.equal(repository.getAutomaticHistoryStatus().settingsState, 'pending');
  await assert.rejects(repository.saveSession(engine.getSnapshot()), fence('local-off'));
  await Promise.all([...rejected, off]);
  assert.deepEqual(savedFacts(await facts(factory, dbName)), before);
  assert.equal(repository.getStatus().pendingWrites, 0);
  assert.equal(repository.getAutomaticHistoryStatus().settingsState, 'persisted');
});

for (const at of ['session-put', 'last-put-success'] as const) {
  test(`OFF aborts the active transaction at ${at} and preserves every old saved fact`, async t => {
    const { factory, dbName, repository, engine } = fixture(t);
    await repository.saveSession(engine.getSnapshot()); const before = await facts(factory, dbName);
    engine.input(`IN_FLIGHT_PRIVATE_${at}`);
    const original = IDBObjectStore.prototype.put;
    let off: Promise<void> | undefined, triggered = false;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = original.call(this, value, key);
      if (!triggered && ((at === 'session-put' && this.name === 'sessions') ||
        (at === 'last-put-success' && this.name === 'meta' && value.key === 'latest'))) {
        triggered = true;
        const stop = () => { off = repository.disableAutomaticHistory(); };
        if (at === 'session-put') stop(); else request.addEventListener('success', stop);
      }
      return request;
    };
    try { await assert.rejects(repository.saveSession(engine.getSnapshot()), fence('local-off')); await off; }
    finally { IDBObjectStore.prototype.put = original; }
    assert.equal(triggered, true); assert.ok(off);
    assert.deepEqual(savedFacts(await facts(factory, dbName)), before);
    assert.equal(repository.getAutomaticHistoryStatus().settingsState, 'persisted');
  });
}

test('OFF while database open is pending prevents the first save transaction from starting', async t => {
  const { factory, dbName, repository, engine } = fixture(t);
  const originalOpen = factory.open.bind(factory), originalTransaction = IDBDatabase.prototype.transaction;
  let off: Promise<void> | undefined, saveTransactions = 0, triggered = false;
  factory.open = (...args: Parameters<IDBFactory['open']>) => {
    const request = originalOpen(...args);
    if (!triggered) { triggered = true; request.addEventListener('success', () => { off = repository.disableAutomaticHistory(); }); }
    return request;
  };
  IDBDatabase.prototype.transaction = function (stores, mode, options) {
    if (mode === 'readwrite' && [...(typeof stores === 'string' ? [stores] : stores)].includes('sessions')) saveTransactions++;
    return originalTransaction.call(this, stores, mode, options);
  };
  try { await assert.rejects(repository.saveSession(engine.getSnapshot()), fence('local-off')); await off; }
  finally { IDBDatabase.prototype.transaction = originalTransaction; factory.open = originalOpen; }
  assert.ok(off); assert.equal(saveTransactions, 0);
  const data = await facts(factory, dbName); assert.deepEqual(data.sessions, []); assert.deepEqual(data.events, []);
});

test('an asynchronous producer finishing after OFF cannot backfill a snapshot', async t => {
  const { factory, dbName, repository, engine } = fixture(t);
  await repository.saveSession(engine.getSnapshot()); const before = await facts(factory, dbName);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const late = (async () => { await gate; engine.input('LATE_ASYNC_PRIVATE'); await repository.saveSession(engine.getSnapshot()); })();
  const rejected = assert.rejects(late, fence('local-off'));
  await repository.disableAutomaticHistory(); release(); await rejected;
  assert.deepEqual(savedFacts(await facts(factory, dbName)), before);
});

test('aborted OFF configuration retains the local fence, exact unsaved status and old durable facts; retry saves only settings', async t => {
  const { factory, dbName, repository, engine, options } = fixture(t);
  await repository.saveSession(engine.getSnapshot()); const before = await facts(factory, dbName);
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    const request = original.call(this, value, key);
    if (this.name === 'meta' && value.key === AUTOMATIC_HISTORY_CONTROL_KEY) {
      const tx = this.transaction; request.addEventListener('success', () => tx.abort());
    }
    return request;
  };
  try { await assert.rejects(repository.disableAutomaticHistory()); }
  finally { IDBObjectStore.prototype.put = original; }
  assert.deepEqual(await facts(factory, dbName), before);
  assert.equal(repository.getAutomaticHistoryStatus().locallyStopped, true);
  assert.equal(repository.getAutomaticHistoryStatus().settingsState, 'not-persisted');
  assert.equal(repository.getAutomaticHistoryStatus().persistedGeneration, null);
  assert.equal(repository.getAutomaticHistoryStatus().message, AUTOMATIC_HISTORY_UNSAVED_MESSAGE);
  assert.ok(repository.getAutomaticHistoryStatus().error);
  engine.input('UNSAVED_SETTING_PRIVATE');
  await assert.rejects(repository.saveSession(engine.getSnapshot()), fence('local-off'));
  const peer = new IndexedDBTrainingRepository(options); t.after(() => peer.close());
  assert.deepEqual(await peer.readAutomaticHistoryControl(), { state: 'legacy-default', generation: 0 }, 'failed setting makes no claim for another page');
  await repository.retryDisableAutomaticHistory();
  assert.equal(repository.getAutomaticHistoryStatus().settingsState, 'persisted');
  assert.equal(repository.getAutomaticHistoryStatus().message, '本页已停止，关闭设置已保存');
  assert.deepEqual(savedFacts(await facts(factory, dbName)), before);
});

test('committed OFF is rechecked inside a peer save transaction including peers opened before OFF', async t => {
  const { factory, dbName, repository, engine, options } = fixture(t);
  await repository.saveSession(engine.getSnapshot());
  const peer = new IndexedDBTrainingRepository(options); t.after(() => peer.close());
  await peer.saveSession(engine.getSnapshot()); const before = await facts(factory, dbName);
  await repository.disableAutomaticHistory();
  engine.input('REMOTE_PRIVATE_AFTER_OFF');
  await assert.rejects(peer.saveSession(engine.getSnapshot()), fence('persisted-off'));
  const another = new IndexedDBTrainingRepository(options); t.after(() => another.close());
  await assert.rejects(another.saveSession(engine.getSnapshot()), fence('persisted-off'));
  assert.deepEqual(await another.readAutomaticHistoryControl(), { state: 'off', generation: 1 });
  assert.deepEqual(savedFacts(await facts(factory, dbName)), before);
});

test('a peer transaction already holding the meta lock may commit before durable OFF; later writes are fenced', async t => {
  const { repository, engine, options } = fixture(t);
  await repository.saveSession(engine.getSnapshot());
  const peer = new IndexedDBTrainingRepository(options); t.after(() => peer.close());
  await peer.saveSession(engine.getSnapshot());
  engine.input('Answer committed before durable OFF');
  const beforeOff = engine.getSnapshot(), original = IDBObjectStore.prototype.put;
  let off: Promise<void> | undefined, triggered = false;
  const order: string[] = [];
  IDBObjectStore.prototype.put = function (value, key) {
    const request = original.call(this, value, key);
    if (!triggered && this.name === 'meta' && value.key === 'latest') {
      triggered = true;
      this.transaction.addEventListener('complete', () => { order.push('save-committed'); });
      request.addEventListener('success', () => {
        order.push('off-requested'); off = repository.disableAutomaticHistory().then(() => { order.push('off-committed'); });
      });
    }
    return request;
  };
  try { await peer.saveSession(beforeOff); await off; }
  finally { IDBObjectStore.prototype.put = original; }
  assert.deepEqual(order, ['off-requested', 'save-committed', 'off-committed']);
  assert.deepEqual((await repository.loadHistorySession(beforeOff.sessionId))?.snapshot, beforeOff);
  engine.input('Answer after durable OFF'); await assert.rejects(peer.saveSession(engine.getSnapshot()), fence('persisted-off'));
});

test('history list/detail/export and configuration reads preserve save and unsaved-setting errors with readonly transactions', async t => {
  const { factory, dbName, repository, engine } = fixture(t);
  const snapshot = engine.getSnapshot(); await repository.saveSession(snapshot);
  engine.input('WRITE_FAILURE_PRIVATE');
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    if (this.name === 'meta') throw new DOMException('Injected config quota', 'QuotaExceededError');
    return originalPut.call(this, value, key);
  };
  try {
    await assert.rejects(repository.saveSession(engine.getSnapshot()), { name: 'QuotaExceededError' });
    await assert.rejects(repository.disableAutomaticHistory(), { name: 'QuotaExceededError' });
  } finally { IDBObjectStore.prototype.put = originalPut; }
  const status = repository.getStatus(), settings = repository.getAutomaticHistoryStatus(), before = await facts(factory, dbName);
  let notifications = 0, delivered = 0; repository.subscribe(() => { notifications++; });
  const originalTransaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (stores, mode, options) {
    assert.equal(mode, 'readonly'); return originalTransaction.call(this, stores, mode, options);
  };
  try {
    assert.equal((await repository.listHistory()).entries.length, 1);
    assert.deepEqual((await repository.loadHistorySession(snapshot.sessionId))?.snapshot, snapshot);
    await repository.deliverHistorySession(snapshot.sessionId, snapshot, () => { delivered++; });
    assert.deepEqual(await repository.readAutomaticHistoryControl(), { state: 'legacy-default', generation: 0 });
  } finally { IDBDatabase.prototype.transaction = originalTransaction; }
  assert.equal(delivered, 1); assert.equal(notifications, 0);
  assert.strictEqual(repository.getStatus(), status); assert.strictEqual(repository.getAutomaticHistoryStatus(), settings);
  assert.deepEqual(await facts(factory, dbName), before);
});

test('OFF creates only an answer-free v1 meta configuration and repeated OFF is idempotent', async t => {
  const { factory, dbName, repository, engine } = fixture(t);
  engine.input('NEVER_SAVED_PRIVATE');
  const first = repository.disableAutomaticHistory(), second = repository.disableAutomaticHistory();
  assert.strictEqual(second, first); await first;
  const before = await facts(factory, dbName);
  assert.deepEqual(before, { sessions: [], events: [], meta: [{
    key: AUTOMATIC_HISTORY_CONTROL_KEY, version: 1, automaticHistoryEnabled: false, generation: 1,
  }] });
  await repository.disableAutomaticHistory(); await repository.retryDisableAutomaticHistory();
  assert.deepEqual(await facts(factory, dbName), before);
  assert.deepEqual(await factory.databases(), [{ name: dbName, version: 2 }]);
  assert.equal(repository.getAutomaticHistoryStatus().persistedGeneration, 1);
});

test('save-pending notification may request OFF without reversing the reserved queue order', async t => {
  const { factory, dbName, repository, engine } = fixture(t);
  await repository.saveSession(engine.getSnapshot()); const before = await facts(factory, dbName);
  let off: Promise<void> | undefined, triggered = false;
  repository.subscribe(() => {
    if (!triggered && repository.getStatus().state === 'pending') { triggered = true; off = repository.disableAutomaticHistory(); }
  });
  engine.input('REENTRANT_SAVE_PRIVATE');
  await assert.rejects(repository.saveSession(engine.getSnapshot()), fence('local-off')); await off;
  assert.ok(off); assert.deepEqual(savedFacts(await facts(factory, dbName)), before);
  assert.equal(repository.getStatus().pendingWrites, 0);
});

test('OFF-pending notification cannot save an old snapshot or start a second OFF operation', async t => {
  const { factory, dbName, repository, engine } = fixture(t);
  const snapshot = engine.getSnapshot(); await repository.saveSession(snapshot); const before = await facts(factory, dbName);
  let repeated: Promise<void> | undefined, rejected: Promise<void> | undefined, triggered = false;
  repository.subscribe(() => {
    if (!triggered && repository.getAutomaticHistoryStatus().settingsState === 'pending') {
      triggered = true; repeated = repository.disableAutomaticHistory();
      rejected = assert.rejects(repository.saveSession(snapshot), fence('local-off'));
    }
  });
  const first = repository.disableAutomaticHistory(); assert.strictEqual(repeated, first);
  await Promise.all([first, rejected]); assert.ok(rejected);
  assert.deepEqual(savedFacts(await facts(factory, dbName)), before);
});

test('a second save started by a pending listener retains normal serial order', async t => {
  const { repository, engine } = fixture(t);
  await repository.saveSession(engine.getSnapshot());
  engine.input('First queued answer'); const firstSnapshot = engine.getSnapshot();
  engine.input('Second queued answer'); const secondSnapshot = engine.getSnapshot();
  let second: Promise<void> | undefined, triggered = false;
  const sequences: number[] = [], original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    if (this.name === 'sessions') sequences.push(value.sequence);
    return original.call(this, value, key);
  };
  repository.subscribe(() => {
    if (!triggered && repository.getStatus().state === 'pending') { triggered = true; second = repository.saveSession(secondSnapshot); }
  });
  try { await repository.saveSession(firstSnapshot); await second; }
  finally { IDBObjectStore.prototype.put = original; }
  assert.ok(second); assert.deepEqual(sequences, [firstSnapshot.sequence, secondSnapshot.sequence]);
  assert.deepEqual((await repository.loadHistorySession(secondSnapshot.sessionId))?.snapshot, secondSnapshot);
  assert.equal(repository.getStatus().pendingWrites, 0);
});

test('throwing observers cannot cancel the synchronous OFF barrier or strand queued writes', async t => {
  const { factory, dbName, repository, engine } = fixture(t);
  await repository.saveSession(engine.getSnapshot()); const before = await facts(factory, dbName);
  repository.subscribe(() => { throw new Error('Observer failure'); });
  let notified = 0; repository.subscribe(() => { notified++; });
  engine.input('THROWING_OBSERVER_PRIVATE');
  const write = repository.saveSession(engine.getSnapshot()), rejected = assert.rejects(write, fence('local-off'));
  const off = repository.disableAutomaticHistory();
  assert.equal(repository.getAutomaticHistoryStatus().locallyStopped, true);
  await Promise.all([rejected, off]);
  assert.ok(notified >= 3); assert.equal(repository.getStatus().pendingWrites, 0);
  assert.deepEqual(savedFacts(await facts(factory, dbName)), before);
});

test('unknown, corrupt and future ON controls fail closed without repairing or overwriting storage', async t => {
  const { factory, dbName, repository, engine } = fixture(t);
  await repository.saveSession(engine.getSnapshot()); engine.input('CORRUPT_CONTROL_PRIVATE');
  const base = { key: AUTOMATIC_HISTORY_CONTROL_KEY, version: 1, automaticHistoryEnabled: false, generation: 1 };
  for (const raw of [
    { key: AUTOMATIC_HISTORY_CONTROL_KEY }, { ...base, version: 2 }, { ...base, automaticHistoryEnabled: true },
    { ...base, generation: 0 }, { ...base, generation: -1 }, { ...base, generation: 1.1 },
    { ...base, generation: Number.MAX_SAFE_INTEGER + 1 }, { ...base, generation: '1' }, { ...base, unknown: true },
  ]) {
    await putControl(factory, dbName, raw); const before = await facts(factory, dbName);
    await assert.rejects(repository.saveSession(engine.getSnapshot()), fence('invalid-control'));
    await assert.rejects(repository.readAutomaticHistoryControl(), fence('invalid-control'));
    assert.deepEqual(await facts(factory, dbName), before);
  }
  const before = await facts(factory, dbName);
  await assert.rejects(repository.disableAutomaticHistory(), fence('invalid-control'));
  assert.equal(repository.getAutomaticHistoryStatus().locallyStopped, true);
  assert.equal(repository.getAutomaticHistoryStatus().message, AUTOMATIC_HISTORY_UNSAVED_MESSAGE);
  assert.deepEqual(await facts(factory, dbName), before);
  for (const raw of [null, false, [], 'off']) assert.throws(() => readAutomaticHistoryControl(raw), fence('invalid-control'));
});

test('a valid existing OFF generation is retained and retry cannot become an enable operation', async t => {
  const { factory, dbName, repository, engine } = fixture(t);
  await assert.rejects(repository.retryDisableAutomaticHistory(), /No automatic history OFF request/);
  await repository.saveSession(engine.getSnapshot());
  await putControl(factory, dbName, { key: AUTOMATIC_HISTORY_CONTROL_KEY, version: 1, automaticHistoryEnabled: false, generation: 37 });
  const before = await facts(factory, dbName);
  await repository.disableAutomaticHistory(); await repository.retryDisableAutomaticHistory();
  assert.equal(repository.getAutomaticHistoryStatus().persistedGeneration, 37);
  assert.deepEqual(await facts(factory, dbName), before);
  await assert.rejects(repository.saveSession(engine.getSnapshot()), fence('local-off'));
});

test('v2 settings distinguish segment mode from legacy default and use explicit monotonic comparisons', async t => {
  const { repository, factory, dbName, engine } = fixture(t);
  assert.deepEqual(await repository.enableAutomaticHistory(0), { state: 'segment-on', generation: 1 });
  const before = await facts(factory, dbName);
  assert.deepEqual(await repository.enableAutomaticHistory(1), { state: 'segment-on', generation: 1 });
  assert.deepEqual(await facts(factory, dbName), before);
  await assert.rejects(repository.disableAutomaticHistory(), fence('stale-generation'), 'legacy helper cannot silently overwrite v2 settings');
  assert.equal(repository.getAutomaticHistoryStatus().locallyStopped, true);
  assert.deepEqual(await repository.disableAutomaticHistory(1), { state: 'segment-off', generation: 2 });
  const off = await facts(factory, dbName);
  assert.deepEqual(await repository.disableAutomaticHistory(2), { state: 'segment-off', generation: 2 });
  assert.deepEqual(await facts(factory, dbName), off);
  assert.deepEqual(await repository.enableAutomaticHistory(2), { state: 'segment-on', generation: 3 });
  await assert.rejects(repository.saveSession(engine.getSnapshot()), fence('segment-mode'));
});

test('v2 generation overflow and unknown fields cannot alter settings or grant local write permission', async t => {
  const { repository, factory, dbName } = fixture(t);
  await repository.enableAutomaticHistory(0);
  await putControl(factory, dbName, { key: AUTOMATIC_HISTORY_CONTROL_KEY, version: 2, mode: 'segments', automaticHistoryEnabled: false, generation: Number.MAX_SAFE_INTEGER });
  const before = await facts(factory, dbName);
  await assert.rejects(repository.enableAutomaticHistory(Number.MAX_SAFE_INTEGER), fence('invalid-control'));
  assert.deepEqual(await facts(factory, dbName), before);
  assert.equal(repository.getAutomaticHistoryStatus().locallyStopped, true);
  for (const record of [
    { key: AUTOMATIC_HISTORY_CONTROL_KEY, version: 2, mode: 'segments', automaticHistoryEnabled: true, generation: 1, answer: 'private' },
    { key: AUTOMATIC_HISTORY_CONTROL_KEY, version: 2, automaticHistoryEnabled: true, generation: 1 },
    { key: AUTOMATIC_HISTORY_CONTROL_KEY, version: 2, mode: 'segments', automaticHistoryEnabled: true, generation: 0 },
  ]) assert.throws(() => readAutomaticHistoryControl(record), fence('invalid-control'));
});
