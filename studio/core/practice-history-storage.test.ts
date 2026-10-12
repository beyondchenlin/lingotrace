import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {IDBDatabase, IDBFactory, IDBObjectStore} from 'fake-indexeddb';
import {PracticeEngine, ORIGINAL_PRACTICE_MATERIAL} from './practice';
import {FencedPracticeRepository, PracticeWriteFenceError} from './practice-fenced-repository';
import type {PracticeHistoryProjection, PracticeHistoryQuery} from './practice-history';

const query: PracticeHistoryQuery = Object.freeze({
  fromInclusive: '2026-10-08T00:00:00.000Z',
  toExclusive: '2026-10-09T00:00:00.000Z',
  timeZone: 'UTC',
});

function fresh(sessionId: string) {
  let serial = 0, now = 0;
  let nextId: string | undefined;
  const clock = {
    now: () => now,
    wallTime: () => new Date(Date.UTC(2026, 9, 8) + now).toISOString(),
    id: () => { const id = nextId ?? `${sessionId}-event-${++serial}`; nextId = undefined; return id; },
  };
  return {
    engine: new PracticeEngine({sessionId, catalog: [ORIGINAL_PRACTICE_MATERIAL], clock}),
    tick: (ms: number) => { now += ms; },
    nextId: (id: string) => { nextId = id; },
  };
}

async function setup(t: TestContext, name: string) {
  const factory = new IDBFactory();
  const config = {databaseName: `lingotrace-dev-fenced-history-${name}`, indexedDB: factory, initialRecordingEnabled: true};
  const repository = new FencedPracticeRepository(config);
  t.after(() => repository.close());
  await repository.prepare();
  const fixture = fresh(`history-${name}`);
  const permit = await repository.beginRecordedSession(fixture.engine.getSnapshot());
  fixture.engine.startRound({materialId: ORIGINAL_PRACTICE_MATERIAL.materialId, practiceRoundId: 'r1'});
  fixture.engine.startAttempt({unitId: 'cafe-order', mode: 'dictation', attemptId: 'a1'});
  fixture.engine.input('HISTORY_A1_PRIVATE_CANARY', 'paste');
  fixture.tick(13007);
  fixture.engine.submit();
  fixture.nextId('a2');
  fixture.engine.retryAttempt();
  fixture.engine.input('Could I have a coffee, please?');
  fixture.tick(5000);
  fixture.engine.submit();
  await repository.save(fixture.engine.getSnapshot(), permit);
  return {...fixture, factory, config, repository, permit};
}

async function projection(repository: FencedPracticeRepository) {
  let delivered: PracticeHistoryProjection | undefined, calls = 0;
  const result = await repository.readHistoryProjection(query, value => { delivered = value; calls++; });
  assert.equal(result, undefined, 'history is delivered only through the synchronous sink');
  assert.equal(calls, 1);
  assert.ok(delivered);
  return delivered;
}

async function withDatabase<T>(factory: IDBFactory, name: string, work: (db: IDBDatabase) => Promise<T>) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try { return await work(db); } finally { db.close(); }
}

async function stores(factory: IDBFactory, name: string) {
  return withDatabase(factory, name, db => new Promise<Record<string, unknown[]>>((resolve, reject) => {
    const names = Array.from(db.objectStoreNames), rows: Record<string, unknown[]> = {};
    const tx = db.transaction(names, 'readonly');
    for (const name of names) {
      const read = tx.objectStore(name).getAll();
      read.onsuccess = () => { rows[name] = read.result; };
    }
    tx.oncomplete = () => resolve(rows);
    tx.onabort = tx.onerror = () => reject(tx.error);
  }));
}

type Erasure = 'attempt' | 'session' | 'clear';
function erase(repository: FencedPracticeRepository, sessionId: string, kind: Erasure) {
  if (kind === 'attempt') return repository.deleteAttempt({sessionId, attemptId: 'a1', redactionId: 'erase-a1'});
  if (kind === 'session') return repository.deleteSession(sessionId);
  return repository.clearPracticeData();
}

function assertErased(value: PracticeHistoryProjection, kind: Erasure, sessionId: string) {
  assert.equal(value.history.some(row => row.sessionId === sessionId && row.attemptId === 'a1'), false);
  if (kind === 'attempt') {
    assert.deepEqual(value.history.map(row => row.attemptId), ['a2']);
    assert.equal(value.totals.firstSubmissions.value, 1);
    assert.equal(value.totals.recordedActiveMs.value, 5000);
    assert.ok(value.coverage.reasons.includes('retained-history-has-redactions'));
  } else {
    assert.deepEqual(value.history, []);
    assert.deepEqual(value.sourceRevisions, []);
    assert.equal(value.totals.firstSubmissions.value, null, 'empty coverage is unknown, not a measured zero');
    assert.equal(value.totals.firstSubmissions.observedValue, 0);
  }
}

test('history storage reads real saved facts, waits for a queued save, and survives close/reopen', async t => {
  const {repository, engine, permit, config} = await setup(t, 'round-trip');
  engine.input('Could I have a coffee, please? Thanks.');
  engine.submit();
  const saving = repository.save(engine.getSnapshot(), permit);
  const saved = await projection(repository);
  await saving;
  assert.deepEqual(saved.history.map(row => row.attemptId), ['a2', 'a1']);
  assert.equal(saved.totals.attemptsStarted.value, 2);
  assert.equal(saved.totals.firstSubmissions.value, 2);
  assert.equal(saved.totals.revisions.value, 1);
  assert.equal(saved.totals.inputCommits.value, 3);
  assert.equal(saved.totals.recordedActiveMs.value, 18007);
  assert.deepEqual(saved.sourceRevisions, [{sessionId: engine.getSnapshot().sessionId, sequence: engine.getSnapshot().sequence}]);
  assert.ok(Object.isFrozen(saved) && Object.isFrozen(saved.history));
  await repository.close();
  let called = false;
  await assert.rejects(repository.readHistoryProjection(query, () => { called = true; }), PracticeWriteFenceError);
  assert.equal(called, false);
  const reopened = new FencedPracticeRepository(config);
  t.after(() => reopened.close());
  await reopened.prepare();
  assert.deepEqual(await projection(reopened), saved);
});

test('history storage remains readable while OFF without saving or backfilling OFF input', async t => {
  const {repository, engine, permit, factory, config} = await setup(t, 'off');
  const saved = await projection(repository);
  await repository.setRecordingEnabled(false);
  engine.input('OFF_HISTORY_PRIVATE_CANARY');
  engine.submit();
  await assert.rejects(repository.save(engine.getSnapshot(), permit), PracticeWriteFenceError);
  assert.deepEqual(await projection(repository), saved);
  await repository.close();
  const reopened = new FencedPracticeRepository(config);
  t.after(() => reopened.close());
  await reopened.prepare();
  assert.equal(reopened.getStatus().recordingEnabled, false);
  assert.deepEqual(await projection(reopened), saved);
  await reopened.setRecordingEnabled(true);
  await assert.rejects(reopened.beginRecordedSession(engine.getSnapshot()), PracticeWriteFenceError);
  assert.deepEqual(await projection(reopened), saved);
  assert.equal(JSON.stringify(await stores(factory, config.databaseName)).includes('OFF_HISTORY_PRIVATE_CANARY'), false);
});

for (const kind of ['attempt', 'session', 'clear'] as const) {
  test(`history storage excludes committed ${kind} erasure on this instance and after reopen`, async t => {
    const {repository, engine, config} = await setup(t, `erased-${kind}`);
    const sessionId = engine.getSnapshot().sessionId;
    const erasedEventIds = engine.getSnapshot().events.filter(event =>
      'attemptId' in event.payload && event.payload.attemptId === 'a1'
    ).map(event => JSON.stringify([sessionId, event.eventId]));
    await erase(repository, sessionId, kind);
    const current = await projection(repository);
    assertErased(current, kind, sessionId);
    for (const metric of Object.values(current.totals)) {
      assert.equal(metric.sourceEventIds.some((id: string) => erasedEventIds.includes(id)), false);
    }
    await repository.close();
    const reopened = new FencedPracticeRepository(config);
    t.after(() => reopened.close());
    await reopened.prepare();
    assert.deepEqual(await projection(reopened), current);
  });

  test(`history storage suppresses a pending sink as soon as local ${kind} erasure is requested`, async t => {
    const {repository, engine} = await setup(t, `pending-${kind}`);
    let called = false;
    const pending = repository.readHistoryProjection(query, () => { called = true; });
    const rejected = assert.rejects(pending, PracticeWriteFenceError);
    const deletion = erase(repository, engine.getSnapshot().sessionId, kind);
    await rejected;
    await deletion;
    assert.equal(called, false);
    assertErased(await projection(repository), kind, engine.getSnapshot().sessionId);
  });

  test(`history storage fences local ${kind} erasure injected at the final getAll callback`, async t => {
    const {repository, engine} = await setup(t, `final-${kind}`);
    const original = IDBObjectStore.prototype.getAll;
    let triggered = false, called = false, deletion: Promise<unknown> | undefined;
    IDBObjectStore.prototype.getAll = function (...args: Parameters<IDBObjectStore['getAll']>) {
      const request = original.apply(this, args);
      // This listener precedes the repository's final success handler. It leaves
      // all reads completed, but requests erasure before the payload handoff.
      if (this.name === 'attemptTombstones' && !triggered) {
        triggered = true;
        request.addEventListener('success', () => {
          deletion = erase(repository, engine.getSnapshot().sessionId, kind);
          void deletion.catch(() => {});
        });
      }
      return request;
    };
    try {
      await assert.rejects(repository.readHistoryProjection(query, () => { called = true; }), PracticeWriteFenceError);
      await deletion;
    } finally { IDBObjectStore.prototype.getAll = original; }
    assert.equal(triggered, true);
    assert.ok(deletion);
    assert.equal(called, false);
    assertErased(await projection(repository), kind, engine.getSnapshot().sessionId);
  });

  test(`history storage excludes remote ${kind} erasure committed before its query`, async t => {
    const {repository, engine, config} = await setup(t, `remote-${kind}`);
    const peer = new FencedPracticeRepository(config);
    t.after(() => peer.close());
    await peer.prepare();
    await erase(peer, engine.getSnapshot().sessionId, kind);
    assertErased(await projection(repository), kind, engine.getSnapshot().sessionId);
  });
}

test('history storage holds a queued remote deletion behind its final check and synchronous sink', async t => {
  const {repository, engine, config} = await setup(t, 'remote-queued');
  const peer = new FencedPracticeRepository(config);
  t.after(() => peer.close());
  await peer.prepare();
  const originalGetAll = IDBObjectStore.prototype.getAll;
  const originalTransaction = IDBDatabase.prototype.transaction;
  const order: string[] = [];
  let triggered = false, deletion: Promise<unknown> | undefined;
  IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
    const tx = originalTransaction.apply(this, args);
    if (args[1] === 'readwrite') {
      order.push('writer-queued');
      tx.addEventListener('complete', () => { order.push('writer-committed'); });
    }
    return tx;
  };
  IDBObjectStore.prototype.getAll = function (...args: Parameters<IDBObjectStore['getAll']>) {
    const request = originalGetAll.apply(this, args);
    if (this.name === 'heads' && !triggered) {
      triggered = true;
      request.addEventListener('success', () => {
        order.push('delete-requested');
        deletion = erase(peer, engine.getSnapshot().sessionId, 'attempt');
        void deletion.catch(() => {});
      });
    }
    return request;
  };
  try {
    await repository.readHistoryProjection(query, value => {
      assert.equal(value.history.length, 2);
      assert.deepEqual(order, ['delete-requested', 'writer-queued'], 'the foreign writer is already queued, but cannot commit');
      order.push('sink');
    });
    await deletion;
  } finally {
    IDBObjectStore.prototype.getAll = originalGetAll;
    IDBDatabase.prototype.transaction = originalTransaction;
  }
  assert.ok(deletion);
  assert.deepEqual(order, ['delete-requested', 'writer-queued', 'sink', 'writer-committed']);
  assertErased(await projection(repository), 'attempt', engine.getSnapshot().sessionId);
});

test('history storage rejects async sinks before invocation and Promise-returning wrappers as misuse', async t => {
  const {repository} = await setup(t, 'async-sink');
  let calls = 0;
  await assert.rejects(repository.readHistoryProjection(query, async () => { calls++; }), /synchronous sink/);
  assert.equal(calls, 0);
  await assert.rejects(repository.readHistoryProjection(query, () => {
    calls++;
    return Promise.reject(new Error('Sink promise must be observed'));
  }), /sink returned a Promise/);
  assert.equal(calls, 1, 'a concealed Promise is detected after invocation, not claimed to be revocable');
});

test('history storage is read-only and preserves an existing failed-write status', async t => {
  const {repository, engine, permit, factory, config} = await setup(t, 'read-only');
  const before = await stores(factory, config.databaseName);
  engine.input('UNSAVED_QUOTA_FAILURE_CANARY');
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
    if (this.name === 'heads') throw new DOMException('Injected history write quota', 'QuotaExceededError');
    return originalPut.apply(this, args);
  };
  try { await assert.rejects(repository.save(engine.getSnapshot(), permit), {name: 'QuotaExceededError'}); }
  finally { IDBObjectStore.prototype.put = originalPut; }
  const status = repository.getStatus();
  assert.equal(status.state, 'error');
  assert.match(status.error!, /Injected history write quota/);
  let notifications = 0;
  const unsubscribe = repository.subscribe(() => { notifications++; });
  const originalTransaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
    assert.equal(args[1], 'readonly', 'projection queries must never start a mutating transaction');
    return originalTransaction.apply(this, args);
  };
  try {
    const saved = await projection(repository);
    assert.equal(saved.totals.inputCommits.value, 2);
    assert.strictEqual(repository.getStatus(), status);
    assert.equal(notifications, 0);
  } finally {
    IDBDatabase.prototype.transaction = originalTransaction;
    unsubscribe();
  }
  assert.deepEqual(await stores(factory, config.databaseName), before);
});

for (const corruption of ['orphan-events', 'orphan-attempt-lineage', 'deleted-session-facts'] as const) {
  test(`history storage fails closed on ${corruption} without handing out a partial view`, async t => {
    const {repository, engine, factory, config} = await setup(t, corruption);
    await withDatabase(factory, config.databaseName, db => new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['heads', 'tombstones', 'attemptTombstones'], 'readwrite');
      if (corruption === 'orphan-events') tx.objectStore('heads').delete(engine.getSnapshot().sessionId);
      if (corruption === 'orphan-attempt-lineage') tx.objectStore('attemptTombstones').add({sessionId: 'missing-session', attemptId: 'a1', sessionGeneration: 1, deletionWatermark: 1});
      if (corruption === 'deleted-session-facts') tx.objectStore('tombstones').add({sessionId: engine.getSnapshot().sessionId, sessionGeneration: 1, deletionWatermark: 1});
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    }));
    const before = await stores(factory, config.databaseName);
    let called = false;
    await assert.rejects(repository.readHistoryProjection(query, () => { called = true; }), PracticeWriteFenceError);
    assert.equal(called, false);
    assert.deepEqual(await stores(factory, config.databaseName), before, 'a failed read cannot repair, clear, or rewrite facts');
  });
}

test('history storage requires preparation and remains guarded in production', async t => {
  const {repository, config} = await setup(t, 'guard');
  const unprepared = new FencedPracticeRepository(config);
  t.after(() => unprepared.close());
  let calls = 0;
  await assert.rejects(unprepared.readHistoryProjection(query, () => { calls++; }), /prepare/);
  assert.throws(() => new FencedPracticeRepository({databaseName: 'lingotrace-live', indexedDB: config.indexedDB}), /isolated/);
  const env = process.env as Record<string, string | undefined>, previous = env.NODE_ENV;
  env.NODE_ENV = 'production';
  try {
    assert.throws(() => new FencedPracticeRepository(config), /disabled in production/);
    await assert.rejects(repository.readHistoryProjection(query, () => { calls++; }), /disabled in production/);
  } finally {
    if (previous === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previous;
  }
  assert.equal(calls, 0);
});
