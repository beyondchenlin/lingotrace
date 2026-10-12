import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBDatabase, IDBFactory } from 'fake-indexeddb';
import { LegacyHistoryReader, type LegacyHistoryAccess } from './legacy-history-reader';
import { LegacyHistoryError, readLegacyHistoryRecord, type LegacyHistoryCursor, type LegacyHistoryList, type LegacyHistorySession } from './legacy-history';
import { IndexedDBTrainingRepository } from './repository';
import { exportStudioSession } from './session-export';
import { TrainingEngine, type TrainingSnapshot } from './training';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function engine(id: string, text = 'Retained original input') {
  let serial = 0;
  const value = new TrainingEngine({ sessionId: id, clock: { now: () => 0, wallTime: () => '2026-10-09T10:00:00.000Z', id: () => `${id}-${++serial}` } });
  value.input(text); return value;
}
function entry(id: string, text?: string): LegacyHistorySession {
  const snapshot = engine(id, text).getSnapshot();
  return readLegacyHistoryRecord({ sessionId: id, sequence: snapshot.sequence, snapshot, updatedAt: snapshot.createdAt });
}
const empty: LegacyHistoryList = { source: 'legacy-training-v1', entries: [], hasMore: false, nextCursor: null, limit: 100 };
const boundary = (key: IDBValidKey): LegacyHistoryCursor => ({ version: 1, updatedAtMs: 123, key });
const page = (id: string, nextCursor: LegacyHistoryCursor | null = null): LegacyHistoryList => ({ ...empty, entries: [{ status: 'ready', summary: entry(id).summary }], hasMore: nextCursor !== null, nextCursor });
const access = (overrides: Partial<LegacyHistoryAccess> = {}): LegacyHistoryAccess => ({
  listHistory: async () => empty,
  loadHistorySession: async id => entry(id),
  deliverHistorySession: async (_id, _expected, sink) => { sink(); },
  ...overrides,
});

test('initial list retry is explicit, clears its target while busy and does not repeat after success', async () => {
  const gate = deferred<LegacyHistoryList>(); let reads = 0;
  const reader = new LegacyHistoryReader(access({ listHistory: () => ++reads === 1 ? Promise.reject(Error('temporary')) : gate.promise }));
  assert.equal(reader.getSnapshot().canRetry, false);
  await reader.refresh();
  assert.equal(reads, 1); assert.equal(reader.getSnapshot().list, null); assert.equal(reader.getSnapshot().canRetry, true);
  const retry = reader.retry(); await reader.retry(); await reader.retry();
  assert.equal(reads, 2); assert.equal(reader.getSnapshot().loading, true); assert.equal(reader.getSnapshot().canRetry, false);
  const result = page('current'); gate.resolve(result); await retry;
  assert.equal(reader.getSnapshot().list, result); assert.equal(reader.getSnapshot().error, null); assert.equal(reader.getSnapshot().canRetry, false);
  await reader.retry(); assert.equal(reads, 2);
});

test('failed and missing details repeatedly retry exactly the same ID without a global list refresh', async t => {
  for (const failure of ['throw', 'missing'] as const) await t.test(failure, async () => {
    let lists = 0, details = 0; const ids: string[] = [], saved = entry('original');
    const reader = new LegacyHistoryReader(access({
      listHistory: async options => { lists++; return options?.after ? page('older') : page('recent', boundary('recent')); },
      loadHistorySession: async id => {
        ids.push(id); details++;
        if (details < 3) { if (failure === 'throw') throw Error('temporary'); return null; }
        return saved;
      },
    }));
    await reader.refresh(); await reader.changePage('next'); const retainedList = reader.getSnapshot().list;
    await reader.select('original'); assert.equal(reader.getSnapshot().selected, null); assert.equal(reader.getSnapshot().canRetry, true);
    await reader.retry(); assert.equal(reader.getSnapshot().selected, null); assert.equal(reader.getSnapshot().canRetry, true);
    await reader.retry(); assert.equal(reader.getSnapshot().selected, saved); assert.equal(reader.getSnapshot().canRetry, false);
    assert.equal(reader.getSnapshot().list, retainedList); assert.equal(reader.getSnapshot().page, 2);
    assert.equal(lists, 2); assert.deepEqual(ids, ['original', 'original', 'original']);
  });
});

test('next-page retry captures the original cursor including mutable Date, binary and nested array keys', async t => {
  const cases: { name: string; key: IDBValidKey; mutate: (key: IDBValidKey) => void }[] = [
    { name: 'Date', key: new Date(42), mutate: key => { (key as Date).setTime(99); } },
    { name: 'binary', key: new Uint8Array([1, 2]).buffer, mutate: key => { new Uint8Array(key as ArrayBuffer)[0] = 9; } },
    { name: 'nested array', key: ['first', [new Date(42), new Uint8Array([1, 2]).buffer]], mutate: key => {
      const nested = (key as IDBValidKey[])[1] as IDBValidKey[];
      (nested[0] as Date).setTime(99); new Uint8Array(nested[1] as ArrayBuffer)[0] = 9;
      (key as IDBValidKey[])[0] = 'changed';
    } },
  ];
  for (const value of cases) await t.test(value.name, async () => {
    const cursor = boundary(value.key), original = structuredClone(cursor), first = page('recent', cursor);
    const requests: (LegacyHistoryCursor | null)[] = []; let reads = 0;
    const gate = deferred<LegacyHistoryList>();
    const reader = new LegacyHistoryReader(access({ listHistory: async options => {
      requests.push(structuredClone(options?.after ?? null)); reads++;
      if (reads === 1) return first;
      if (reads === 2) { value.mutate(options!.after!.key); throw Error('temporary page failure'); }
      return gate.promise;
    } }));
    await reader.refresh(); await reader.changePage('next');
    assert.equal(reader.getSnapshot().list, first); assert.equal(reader.getSnapshot().page, 1); assert.equal(reader.getSnapshot().canRetry, true);
    value.mutate(cursor.key);
    const retry = reader.retry(); await reader.retry();
    assert.equal(reads, 3); assert.equal(reader.getSnapshot().paging, true); assert.equal(reader.getSnapshot().canRetry, false);
    gate.resolve(page('older')); await retry;
    assert.deepEqual(requests, [null, original, original]); assert.equal(reader.getSnapshot().page, 2); assert.equal(reader.getSnapshot().canRetry, false);
  });
});

test('previous-page retries retain direction, original boundary and target page, including the null first-page boundary', async () => {
  const a = boundary(new Date(10)), b = boundary('b'), originalA = structuredClone(a);
  const requests: (LegacyHistoryCursor | null)[] = []; let reads = 0;
  const reader = new LegacyHistoryReader(access({ listHistory: async options => {
    requests.push(structuredClone(options?.after ?? null)); reads++;
    if (reads === 4 || reads === 6) throw Error('temporary previous page failure');
    if (reads === 1 || reads === 7) return page('first', a);
    return reads === 3 ? page('third') : page('second', b);
  } }));
  await reader.refresh(); await reader.changePage('next'); await reader.changePage('next');
  const third = reader.getSnapshot().list;
  await reader.changePage('previous');
  assert.equal(reader.getSnapshot().page, 3); assert.equal(reader.getSnapshot().list, third);
  (a.key as Date).setTime(99); await reader.retry();
  assert.equal(reader.getSnapshot().page, 2); assert.deepEqual(requests[3], originalA); assert.deepEqual(requests[4], originalA);
  await reader.changePage('previous'); assert.equal(reader.getSnapshot().page, 2);
  await reader.retry(); assert.equal(reader.getSnapshot().page, 1);
  assert.equal(requests[5], null); assert.equal(requests[6], null); assert.equal(reader.getSnapshot().canRetry, false);
});

test('stale or failed download retry only rereads its ID; reviewed data still needs a new explicit format click', async t => {
  for (const failure of [new LegacyHistoryError('stale-record', 'changed'), new LegacyHistoryError('read-failed', 'read'), Error('temporary')]) {
    await t.test(failure.message, async () => {
      const original = entry('saved'), updated = entry('saved', 'Updated durable input');
      let deliveries = 0, exports = 0; const reads: string[] = [], output: { name: string; blob: Blob }[] = [];
      const reader = new LegacyHistoryReader(access({
        loadHistorySession: async id => { reads.push(id); return reads.length === 1 ? original : updated; },
        deliverHistorySession: async (_id, _expected, sink) => { if (++deliveries === 1) throw failure; sink(); },
      }), snapshot => { exports++; return exportStudioSession(snapshot, '2026-10-09T11:00:00.000Z'); });
      await reader.select('saved'); await reader.download('json', (name, blob) => output.push({ name, blob }));
      assert.equal(reader.getSnapshot().canRetry, true); assert.equal(output.length, 0); assert.equal(exports, 1);
      await reader.retry(); await reader.retry();
      assert.deepEqual(reads, ['saved', 'saved']); assert.equal(reader.getSnapshot().selected, updated);
      assert.equal(deliveries, 1); assert.equal(output.length, 0); assert.equal(exports, 1); assert.equal(reader.getSnapshot().canRetry, false);
      await reader.download('json', (name, blob) => output.push({ name, blob }));
      assert.equal(deliveries, 2); assert.equal(exports, 2); assert.equal(output.length, 1);
      assert.equal(output[0].name, 'lingotrace-training-v1-history.json'); assert.deepEqual(JSON.parse(await output[0].blob.text()).session, updated.snapshot);
      await reader.download('csv', (name, blob) => output.push({ name, blob }));
      assert.equal(exports, 2); assert.equal(output[1].name, 'lingotrace-training-v1-history.csv');
      assert.deepEqual(new Uint8Array(await output[1].blob.arrayBuffer()), new TextEncoder().encode(exportStudioSession(updated.snapshot, '2026-10-09T11:00:00.000Z').csv));
    });
  }
});

test('retry cannot bypass unsupported historical rules, including a changed rule discovered by rereading', async t => {
  for (const rule of ['ruleVersions', 'paceRuleVersions'] as const) await t.test(rule, async () => {
    const original = entry('saved'), oldRule = { ...original, summary: { ...original.summary, [rule]: ['unsupported-old-rule'] } };
    let reads = 0, deliveries = 0, exports = 0;
    const reader = new LegacyHistoryReader(access({
      loadHistorySession: async () => ++reads === 1 ? original : oldRule,
      deliverHistorySession: async () => { deliveries++; throw new LegacyHistoryError('stale-record', 'changed'); },
    }), snapshot => { exports++; return exportStudioSession(snapshot); });
    await reader.select('saved'); await reader.download('json', () => assert.fail('stale download')); await reader.retry();
    assert.equal(reader.getSnapshot().selected, oldRule); assert.equal(reader.getSnapshot().canRetry, false);
    await reader.download('json', () => assert.fail('unsupported rule')); await reader.retry();
    assert.match(reader.getSnapshot().error!, /旧规则/); assert.equal(reader.getSnapshot().canRetry, false);
    assert.equal(reads, 2); assert.equal(deliveries, 1); assert.equal(exports, 1);
  });
});

test('validation and direct permission refusals never offer or execute retry for any read operation', async t => {
  const refusals: Error[] = [
    ...(['invalid-record', 'invalid-material', 'unsupported-schema', 'invalid-query', 'invalid-sink'] as const).map(code => new LegacyHistoryError(code, code)),
    ...['SecurityError', 'NotAllowedError', 'PermissionDeniedError'].map(name => new DOMException('permission refused', name)),
  ];
  for (const error of refusals) for (const operation of ['list', 'page', 'detail', 'download'] as const) {
    await t.test(`${error instanceof LegacyHistoryError ? error.code : error.name}: ${operation}`, async () => {
      let failing = false, reads = 0;
      const reader = new LegacyHistoryReader(access({
        listHistory: async () => { reads++; if (failing) throw error; return page('recent', boundary('recent')); },
        loadHistorySession: async id => { reads++; if (failing) throw error; return entry(id); },
        deliverHistorySession: async () => { reads++; throw error; },
      }));
      if (operation === 'page') await reader.refresh();
      if (operation === 'download') await reader.select('saved');
      failing = true;
      if (operation === 'list') await reader.refresh();
      else if (operation === 'page') await reader.changePage('next');
      else if (operation === 'detail') await reader.select('saved');
      else await reader.download('json', () => assert.fail('refused download'));
      assert.ok(reader.getSnapshot().error); assert.equal(reader.getSnapshot().canRetry, false);
      const before = reads; await reader.retry(); assert.equal(reads, before);
    });
  }
});

test('a repository detail with mismatched identity is rejected rather than switching the retry target', async t => {
  for (const source of ['snapshot', 'summary'] as const) await t.test(source, async () => {
    let reads = 0; const valid = entry('original'), other = entry('other');
    const reader = new LegacyHistoryReader(access({ loadHistorySession: async () => { reads++; return { ...valid, [source]: other[source] }; } }));
    await reader.select('original'); assert.equal(reader.getSnapshot().selected, null); assert.equal(reader.getSnapshot().canRetry, false);
    await reader.retry(); assert.equal(reads, 1);
  });
});

test('busy detail and download actions ignore repeated retry clicks', async () => {
  const detail = deferred<LegacyHistorySession | null>(), delivery = deferred<void>(); let reads = 0, deliveries = 0, files = 0;
  const reader = new LegacyHistoryReader(access({
    loadHistorySession: () => ++reads === 1 ? Promise.reject(Error('temporary')) : detail.promise,
    deliverHistorySession: async (_id, _expected, sink) => { deliveries++; await delivery.promise; sink(); },
  }));
  await reader.select('saved'); const retry = reader.retry(); await reader.retry(); await reader.retry();
  assert.equal(reads, 2); assert.equal(reader.getSnapshot().canRetry, false);
  detail.resolve(entry('saved')); await retry;
  const downloading = reader.download('json', () => files++); await reader.retry(); await reader.retry(); await reader.download('csv', () => files++);
  assert.equal(reads, 2); assert.equal(deliveries, 1); delivery.resolve(); await downloading; assert.equal(files, 1);
});

test('new actions, back, close and reactivation clear failed retry targets immediately', async t => {
  for (const next of ['back', 'close', 'activate', 'refresh', 'select', 'page', 'download'] as const) await t.test(next, async () => {
    let failing = false, reads = 0;
    const reader = new LegacyHistoryReader(access({
      listHistory: async () => { reads++; if (failing) throw Error('temporary'); return page('recent', boundary('recent')); },
      loadHistorySession: async id => { reads++; if (failing) throw Error('temporary'); return entry(id); },
      deliverHistorySession: async () => { reads++; if (failing) throw Error('temporary'); },
    }));
    await reader.refresh();
    if (next === 'download') await reader.select('saved');
    failing = true;
    if (next === 'download') await reader.download('json', () => {}); else await reader.select('failed');
    assert.equal(reader.getSnapshot().canRetry, true); failing = false;
    if (next === 'back') reader.back();
    else if (next === 'close') reader.dispose();
    else if (next === 'activate') reader.activate();
    else if (next === 'refresh') await reader.refresh();
    else if (next === 'select') await reader.select('different');
    else if (next === 'page') await reader.changePage('next');
    else await reader.download('csv', () => {});
    assert.equal(reader.getSnapshot().canRetry, false);
    const before = reads; await reader.retry(); assert.equal(reads, before);
  });
});

test('late successful and failed retry reads cannot restore errors, targets or downloads after navigation', async t => {
  for (const operation of ['list', 'page', 'detail', 'download'] as const) {
    for (const outcome of ['resolve', 'reject'] as const) for (const next of ['back', 'refresh', 'select', 'close', 'reconnect'] as const) {
      await t.test(`${operation} ${outcome} after ${next}`, async () => {
        const gate = deferred<LegacyHistoryList | LegacyHistorySession | null | void>(); let phase: 'ready' | 'fail' | 'pending' = 'ready', reads = 0, files = 0;
        const reader = new LegacyHistoryReader(access({
          listHistory: async () => {
            reads++;
            if ((operation === 'list' || operation === 'page') && phase !== 'ready') {
              if (phase === 'fail') throw Error('temporary'); return await gate.promise as LegacyHistoryList;
            }
            return page('recent', boundary('recent'));
          },
          loadHistorySession: async id => {
            reads++;
            if ((operation === 'detail' || operation === 'download') && phase !== 'ready') {
              if (phase === 'fail') throw Error('temporary'); return await gate.promise as LegacyHistorySession | null;
            }
            return entry(id);
          },
          deliverHistorySession: async () => { reads++; throw Error('stale'); },
        }));
        await reader.refresh();
        if (operation === 'download') await reader.select('old');
        phase = 'fail';
        if (operation === 'list') await reader.refresh();
        else if (operation === 'page') await reader.changePage('next');
        else if (operation === 'detail') await reader.select('old');
        else await reader.download('json', () => files++);
        phase = 'pending'; const pending = reader.retry(); phase = 'ready';
        if (next === 'back') reader.back();
        else if (next === 'refresh') await reader.refresh();
        else if (next === 'select') await reader.select('new');
        else if (next === 'close') reader.dispose();
        else { reader.dispose(); reader.activate(); await reader.refresh(); }
        const before = reader.getSnapshot(), previousReads = reads;
        if (outcome === 'reject') gate.reject(Error('late failure'));
        else gate.resolve(operation === 'list' || operation === 'page' ? page('old') : entry('old'));
        await pending; assert.equal(reader.getSnapshot(), before); assert.equal(reader.getSnapshot().canRetry, false);
        await reader.retry(); assert.equal(reads, previousReads); assert.equal(files, 0);
      });
    }
  }
});

test('late download failures never install their former selection as a retry target', async t => {
  for (const next of ['back', 'refresh', 'select', 'close'] as const) await t.test(next, async () => {
    const gate = deferred<void>(), ids: string[] = []; let failedNewSelection = false;
    const reader = new LegacyHistoryReader(access({
      loadHistorySession: async id => { ids.push(id); if (failedNewSelection) throw Error('new target failed'); return entry(id); },
      deliverHistorySession: () => gate.promise,
    }));
    await reader.select('old'); const downloading = reader.download('json', () => assert.fail('old download'));
    if (next === 'back') reader.back(); else if (next === 'refresh') await reader.refresh();
    else if (next === 'close') reader.dispose(); else { failedNewSelection = true; await reader.select('new'); }
    const before = reader.getSnapshot(); gate.reject(Error('late download failure')); await downloading;
    assert.equal(reader.getSnapshot(), before); failedNewSelection = false; await reader.retry();
    assert.deepEqual(ids, next === 'select' ? ['old', 'new', 'new'] : ['old']);
  });
});

test('reentrant listeners can cancel a retry before its repository read starts', async t => {
  for (const operation of ['list', 'page', 'detail', 'download'] as const) await t.test(operation, async () => {
    let failing = false, reads = 0;
    const reader = new LegacyHistoryReader(access({
      listHistory: async () => { reads++; if (failing) throw Error('temporary'); return page('recent', boundary('recent')); },
      loadHistorySession: async id => { reads++; if (failing) throw Error('temporary'); return entry(id); },
      deliverHistorySession: async () => { reads++; throw Error('stale'); },
    }));
    await reader.refresh(); if (operation === 'download') await reader.select('saved'); failing = true;
    if (operation === 'list') await reader.refresh(); else if (operation === 'page') await reader.changePage('next');
    else if (operation === 'detail') await reader.select('saved'); else await reader.download('json', () => {});
    assert.equal(reader.getSnapshot().canRetry, true); const before = reads;
    reader.subscribe(() => {
      const value = reader.getSnapshot();
      if (value.loading || value.paging || value.downloading) { assert.equal(value.canRetry, false); reader.back(); }
    });
    await reader.retry(); assert.equal(reads, before); assert.equal(reader.getSnapshot().canRetry, false); assert.equal(reader.getSnapshot().error, null);
  });
});

test('error and success notifications cannot overwrite reentrant newer actions or their retry targets', async () => {
  const ids: string[] = []; let listenerAction: Promise<void> | undefined, once = true, failNew = true;
  const reader = new LegacyHistoryReader(access({ loadHistorySession: async id => {
    ids.push(id); if (id === 'old' || (id === 'new' && failNew)) throw Error('temporary'); return entry(id);
  } }));
  reader.subscribe(() => {
    if (once && reader.getSnapshot().canRetry) { once = false; listenerAction = reader.select('new'); }
  });
  await reader.select('old'); await listenerAction;
  failNew = false; await reader.retry(); assert.deepEqual(ids, ['old', 'new', 'new']); assert.equal(reader.getSnapshot().selected?.snapshot.sessionId, 'new');
  once = true; failNew = true;
  reader.subscribe(() => {
    if (once && reader.getSnapshot().selected?.snapshot.sessionId === 'success') { once = false; listenerAction = reader.select('new'); }
  });
  await reader.select('success'); await listenerAction;
  assert.equal(reader.getSnapshot().canRetry, true); failNew = false; await reader.retry();
  assert.equal(reader.getSnapshot().selected?.snapshot.sessionId, 'new'); assert.deepEqual(ids.slice(-3), ['success', 'new', 'new']);
});

test('a reentrant retry clears availability synchronously so another listener cannot duplicate the request', async () => {
  const gate = deferred<LegacyHistorySession | null>(); let reads = 0, retried: Promise<void> | undefined;
  const reader = new LegacyHistoryReader(access({ loadHistorySession: () => ++reads === 1 ? Promise.reject(Error('temporary')) : gate.promise }));
  reader.subscribe(() => { if (reader.getSnapshot().canRetry) retried = reader.retry(); });
  reader.subscribe(() => { if (reader.getSnapshot().canRetry) void reader.retry(); });
  await reader.select('saved'); assert.equal(reads, 2); assert.equal(reader.getSnapshot().canRetry, false);
  gate.resolve(entry('saved')); await retried; assert.equal(reader.getSnapshot().selected?.snapshot.sessionId, 'saved');
});

async function databaseFacts(factory: IDBFactory, name: string): Promise<Record<string, unknown[]>> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = factory.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(['sessions', 'events', 'meta'], 'readonly'), rows: Record<string, unknown[]> = {};
      for (const store of ['sessions', 'events', 'meta']) { const request = tx.objectStore(store).getAll(); request.onsuccess = () => { rows[store] = request.result; }; }
      tx.oncomplete = () => resolve(rows); tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

test('retry flows preserve real stored records, save status and live input; stale guard still requires a new download click', async t => {
  const factory = new IDBFactory(), dbName = 'legacy-retry-readonly', repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  t.after(() => repository.close());
  const storedEngine = engine('saved'), liveEngine = engine('live', 'Never replace this current input');
  await repository.saveSession(storedEngine.getSnapshot());
  let failList = true, failDetail = true, files = 0, notifications = 0;
  const reader = new LegacyHistoryReader(access({
    listHistory: options => { if (failList) { failList = false; return Promise.reject(new LegacyHistoryError('read-failed', 'temporary')); } return repository.listHistory(options); },
    loadHistorySession: id => { if (failDetail) { failDetail = false; return Promise.reject(new LegacyHistoryError('read-failed', 'temporary')); } return repository.loadHistorySession(id); },
    deliverHistorySession: (id, snapshot, sink) => repository.deliverHistorySession(id, snapshot, sink),
  }));
  await reader.refresh(); await reader.retry(); await reader.select('saved'); await reader.retry();
  const firstSelected = reader.getSnapshot().selected!, firstBytes = JSON.stringify(firstSelected);
  storedEngine.input('Newly saved historical input'); await repository.saveSession(storedEngine.getSnapshot());
  const before = await databaseFacts(factory, dbName), status = repository.getStatus(), liveSnapshot = liveEngine.getSnapshot(), liveBytes = JSON.stringify(liveSnapshot);
  const unsubscribe = repository.subscribe(() => { notifications++; }); t.after(unsubscribe);
  const originalTransaction = IDBDatabase.prototype.transaction, modes: string[] = [];
  IDBDatabase.prototype.transaction = function (stores, mode, options) { modes.push(mode ?? 'readonly'); return originalTransaction.call(this, stores, mode, options); };
  try {
    await reader.download('json', () => files++); assert.equal(files, 0); assert.equal(reader.getSnapshot().canRetry, true);
    await reader.retry(); assert.equal(files, 0); assert.equal(reader.getSnapshot().canRetry, false);
    assert.deepEqual(reader.getSnapshot().selected?.snapshot, storedEngine.getSnapshot());
    let exported: TrainingSnapshot | undefined;
    await reader.download('json', (_name, blob) => { files++; void blob.text().then(text => { exported = JSON.parse(text).session; }); });
    await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(files, 1); assert.deepEqual(exported, storedEngine.getSnapshot());
    assert.ok(modes.length >= 3); assert.ok(modes.every(mode => mode === 'readonly'));
  } finally { IDBDatabase.prototype.transaction = originalTransaction; }
  assert.deepEqual(await databaseFacts(factory, dbName), before); assert.equal(repository.getStatus(), status); assert.equal(notifications, 0);
  assert.equal(JSON.stringify(firstSelected), firstBytes); assert.equal(liveEngine.getSnapshot(), liveSnapshot); assert.equal(JSON.stringify(liveEngine.getSnapshot()), liveBytes);
});
