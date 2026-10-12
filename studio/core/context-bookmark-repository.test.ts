import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore, forceCloseDatabase } from 'fake-indexeddb';
import { TrainingEngine, CAFE_MATERIAL } from './training';
import { getBookmarkReference, contextBookmarkKey } from './context-bookmark';
import {
  IndexedDBContextBookmarkRepository, CONTEXT_BOOKMARK_DATABASE_NAME, CONTEXT_BOOKMARK_STORE_NAME,
  type ContextBookmarkBroadcastChannel,
} from './context-bookmark-repository';

const missingSaveId = '00000000-0000-4000-8000-000000000000';
const time = '2026-10-10T06:00:00.000Z';
function reference() {
  let id = 0; const engine = new TrainingEngine({ clock: { now: () => 0, wallTime: () => time, id: () => `bookmark-${++id}` } });
  engine.input('private answer'); engine.submit();
  return getBookmarkReference(engine.getSnapshot(), CAFE_MATERIAL.cues[0].id)!;
}
function rawOpen(factory: IDBFactory, name = CONTEXT_BOOKMARK_DATABASE_NAME as string, version = 1, keyPath = 'key'): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    request.onupgradeneeded = () => request.result.createObjectStore(CONTEXT_BOOKMARK_STORE_NAME, { keyPath });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function putRaw(factory: IDBFactory, record: unknown): Promise<void> {
  const db = await rawOpen(factory);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CONTEXT_BOOKMARK_STORE_NAME, 'readwrite'); tx.objectStore(CONTEXT_BOOKMARK_STORE_NAME).put(record);
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
  }); db.close();
}
async function rawRows(factory: IDBFactory): Promise<unknown[]> {
  const db = await rawOpen(factory);
  const rows = await new Promise<unknown[]>((resolve, reject) => {
    const tx = db.transaction(CONTEXT_BOOKMARK_STORE_NAME, 'readonly'), request = tx.objectStore(CONTEXT_BOOKMARK_STORE_NAME).getAll();
    tx.oncomplete = () => resolve(request.result); tx.onerror = tx.onabort = () => reject(tx.error);
  }); db.close(); return rows;
}

test('constructor, subscribe, empty list/load/remove never create or populate a database', async () => {
  const factory = new IDBFactory(); let channelStarts = 0;
  const repo = new IndexedDBContextBookmarkRepository({ indexedDB: factory, broadcastChannel: () => { channelStarts++; return null; } });
  assert.equal(channelStarts, 0); assert.deepEqual(await factory.databases(), []);
  const unsubscribe = repo.subscribe(() => {}); assert.equal(channelStarts, 1);
  assert.deepEqual(await repo.list(), { entries: [], unreadableCount: 0 });
  assert.equal(await repo.load('missing'), null); assert.equal(await repo.remove('missing', missingSaveId), false);
  assert.deepEqual(await factory.databases(), []); unsubscribe(); await repo.close();
});

test('explicit save survives close/reload, exact readback, original-only data and removal', async () => {
  const factory = new IDBFactory(), repo = new IndexedDBContextBookmarkRepository({ indexedDB: factory, now: () => time });
  const saved = await repo.save(reference(), 0, 7); assert.equal(saved.disposition, 'saved');
  assert.deepEqual(await repo.load(saved.bookmark.key), saved.bookmark); await repo.close();
  const reopened = new IndexedDBContextBookmarkRepository({ indexedDB: factory });
  assert.deepEqual(await reopened.list(), { entries: [saved.bookmark], unreadableCount: 0 });
  const serialized = JSON.stringify(await rawRows(factory));
  assert.doesNotMatch(serialized, /private answer|answer|draft|accuracy|score|errors|attemptId|sessionId/);
  assert.equal(await reopened.remove(saved.bookmark.key, saved.bookmark.saveId), true); assert.equal(await reopened.load(saved.bookmark.key), null);
  assert.equal(await reopened.remove(saved.bookmark.key, saved.bookmark.saveId), false); await reopened.close();
  const third = new IndexedDBContextBookmarkRepository({ indexedDB: factory }); assert.deepEqual(await third.list(), { entries: [], unreadableCount: 0 }); await third.close();
});

test('simultaneous independent-instance same-key saves preserve one original creation and timestamp', async () => {
  const factory = new IDBFactory(), a = new IndexedDBContextBookmarkRepository({ indexedDB: factory, now: () => time }), b = new IndexedDBContextBookmarkRepository({ indexedDB: factory, now: () => '2026-10-10T07:00:00.000Z' });
  const saved = await Promise.all([a.save(reference(), 0, 5), b.save(reference(), 0, 5), a.save(reference(), 0, 5), b.save(reference(), 0, 5)]);
  assert.equal(saved.filter(row => row.disposition === 'saved').length, 1);
  assert.equal(new Set(saved.map(row => row.bookmark.saveId)).size, 1);
  assert.equal(new Set(saved.map(row => row.bookmark.createdAt)).size, 1);
  assert.equal((await a.list()).entries.length, 1); assert.equal((await rawRows(factory)).length, 1);
  await a.close(); await b.close();
});

test('remove and readd use a new creation identity even with exactly the same millisecond', async () => {
  const factory = new IDBFactory(), a = new IndexedDBContextBookmarkRepository({ indexedDB: factory, now: () => time });
  const old = (await a.save(reference(), 0, 5)).bookmark; await a.remove(old.key, old.saveId); await a.close();
  const b = new IndexedDBContextBookmarkRepository({ indexedDB: factory, now: () => time }), current = (await b.save(reference(), 0, 5)).bookmark;
  assert.equal(current.key, old.key); assert.equal(current.createdAt, old.createdAt); assert.notEqual(current.saveId, old.saveId);
  assert.deepEqual(await b.load(old.key), current); await b.close();
});

test('different phrases stay separate, return immutable copies and sort newest first', async () => {
  const factory = new IDBFactory(); let tick = 0;
  const repo = new IndexedDBContextBookmarkRepository({ indexedDB: factory, now: () => new Date(Date.parse(time) + tick++).toISOString() });
  const first = (await repo.save(reference(), 0, 5)).bookmark, second = (await repo.save(reference(), 6, 7)).bookmark;
  const list = await repo.list(); assert.deepEqual(list.entries.map(row => row.key), [second.key, first.key]);
  assert.ok(Object.isFrozen(list) && Object.isFrozen(list.entries) && Object.isFrozen(list.entries[0]));
  assert.notEqual(await repo.load(first.key), first); await repo.close();
});

test('stale source and invalid selection fail before creating storage', async () => {
  const factory = new IDBFactory(), repo = new IndexedDBContextBookmarkRepository({ indexedDB: factory });
  await assert.rejects(repo.save({ ...reference(), mediaSha256: '0'.repeat(64) }, 0, 5), { code: 'stale-reference' });
  await assert.rejects(repo.save(reference(), 1, 5), { code: 'invalid-selection' });
  assert.deepEqual(await factory.databases(), []); await repo.close();
});

test('corrupt and future rows count as unreadable, are not repaired, and cannot be overwritten by same-key saves', async () => {
  const factory = new IDBFactory(), repo = new IndexedDBContextBookmarkRepository({ indexedDB: factory });
  const saved = (await repo.save(reference(), 0, 5)).bookmark;
  await putRaw(factory, { ...saved, reference: { ...saved.reference, mediaSha256: 'changed' } });
  await putRaw(factory, { key: 'future', schemaVersion: 'future-v2', answer: 'not exposed' });
  const before = await rawRows(factory);
  assert.deepEqual(await repo.list(), { entries: [], unreadableCount: 2 });
  await assert.rejects(repo.load(saved.key), { code: 'stale-reference' });
  await assert.rejects(repo.save(reference(), 0, 5), { code: 'storage-conflict' });
  assert.deepEqual(await rawRows(factory), before, 'reads and conflicting saves never repair unknown records');
  await repo.close();
});

test('synchronous quota failure rolls back and a later explicit retry can succeed', async () => {
  const factory = new IDBFactory(), repo = new IndexedDBContextBookmarkRepository({ indexedDB: factory });
  const original = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
    if (this.name === CONTEXT_BOOKMARK_STORE_NAME) throw new DOMException('Injected quota failure', 'QuotaExceededError');
    return original.apply(this, args);
  };
  try { await assert.rejects(repo.save(reference(), 0, 5), { name: 'QuotaExceededError' }); } finally { IDBObjectStore.prototype.add = original; }
  assert.deepEqual(await repo.list(), { entries: [], unreadableCount: 0 });
  assert.equal((await repo.save(reference(), 0, 5)).disposition, 'saved'); await repo.close();
});

test('successful add request followed by transaction abort is never reported as saved', async () => {
  const factory = new IDBFactory(), repo = new IndexedDBContextBookmarkRepository({ indexedDB: factory });
  const original = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
    const request = original.apply(this, args);
    if (this.name === CONTEXT_BOOKMARK_STORE_NAME) request.addEventListener('success', () => this.transaction.abort());
    return request;
  };
  try { await assert.rejects(repo.save(reference(), 0, 5), /abort|提交/i); } finally { IDBObjectStore.prototype.add = original; }
  assert.equal(await repo.load(contextBookmarkKey(reference(), 0, 5)), null); await repo.close();
});

test('failed delete transaction retains saved row and does not notify success', async () => {
  const factory = new IDBFactory(), repo = new IndexedDBContextBookmarkRepository({ indexedDB: factory });
  const saved = (await repo.save(reference(), 0, 5)).bookmark; let notifications = 0; repo.subscribe(() => { notifications++; });
  const original = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete = function (...args: Parameters<IDBObjectStore['delete']>) {
    const request = original.apply(this, args); request.addEventListener('success', () => this.transaction.abort()); return request;
  };
  try { await assert.rejects(repo.remove(saved.key, saved.saveId)); } finally { IDBObjectStore.prototype.delete = original; }
  assert.deepEqual(await repo.load(saved.key), saved); assert.equal(notifications, 0); await repo.close();
});

test('a read transaction failure rejects instead of inventing an empty library or missing record', async () => {
  const factory = new IDBFactory(), repo = new IndexedDBContextBookmarkRepository({ indexedDB: factory });
  const saved = (await repo.save(reference(), 0, 5)).bookmark, original = IDBObjectStore.prototype.openCursor;
  IDBObjectStore.prototype.openCursor = function (...args: Parameters<IDBObjectStore['openCursor']>) {
    const request = original.apply(this, args); request.addEventListener('success', () => this.transaction.abort(), { once: true }); return request;
  };
  try { await assert.rejects(repo.list()); } finally { IDBObjectStore.prototype.openCursor = original; }
  assert.deepEqual(await repo.load(saved.key), saved); await repo.close();
});

test('save verifies actual post-commit readback instead of returning the submitted object', async () => {
  const factory = new IDBFactory(), repo = new IndexedDBContextBookmarkRepository({ indexedDB: factory });
  const original = IDBObjectStore.prototype.get; let gets = 0;
  IDBObjectStore.prototype.get = function (...args: Parameters<IDBObjectStore['get']>) {
    const request = original.apply(this, args);
    if (this.name === CONTEXT_BOOKMARK_STORE_NAME && ++gets === 2) Object.defineProperty(request, 'result', { get: () => undefined, set: () => {} });
    return request;
  };
  try { await assert.rejects(repo.save(reference(), 0, 5), { code: 'storage-conflict' }); } finally { IDBObjectStore.prototype.get = original; }
  assert.equal((await repo.list()).entries.length, 1, 'a readback failure does not claim or erase a committed row'); await repo.close();
});

test('unknown database versions and malformed schemas fail without upgrading or clearing', async () => {
  for (const [version, keyPath] of [[2, 'key'], [1, 'otherKey']] as const) {
    const factory = new IDBFactory(), raw = await rawOpen(factory, CONTEXT_BOOKMARK_DATABASE_NAME, version, keyPath); raw.close();
    const repo = new IndexedDBContextBookmarkRepository({ indexedDB: factory });
    await assert.rejects(repo.list()); await assert.rejects(repo.load('unknown')); await assert.rejects(repo.save(reference(), 0, 5));
    assert.equal((await factory.databases())[0].version, version); await repo.close();
  }
});

test('Training database is neither opened nor upgraded by any bookmark operation', async () => {
  const factory = new IDBFactory(), training = await rawOpen(factory, 'lingotrace-studio-v1'); training.close();
  const original = factory.open.bind(factory), calls: string[] = [];
  factory.open = (...args: Parameters<IDBFactory['open']>) => { calls.push(args[0]); return original(...args); };
  const repo = new IndexedDBContextBookmarkRepository({ indexedDB: factory }), saved = await repo.save(reference(), 0, 5);
  await repo.list(); await repo.load(saved.bookmark.key); await repo.remove(saved.bookmark.key, saved.bookmark.saveId); await repo.close();
  assert.ok(calls.every(name => name === CONTEXT_BOOKMARK_DATABASE_NAME));
  assert.equal((await factory.databases()).find(db => db.name === 'lingotrace-studio-v1')?.version, 1);
});

test('broadcast invalidations contain no record content and never trigger writes', async () => {
  const factory = new IDBFactory(), channels = new Set<ContextBookmarkBroadcastChannel>(), messages: unknown[] = [];
  const channelFactory = (): ContextBookmarkBroadcastChannel => {
    const channel: ContextBookmarkBroadcastChannel = { onmessage: null, postMessage(value) {
      messages.push(value); for (const other of channels) if (other !== channel) other.onmessage?.({ data: value } as MessageEvent);
    }, close() { channels.delete(channel); } }; channels.add(channel); return channel;
  };
  const a = new IndexedDBContextBookmarkRepository({ indexedDB: factory, broadcastChannel: channelFactory }), b = new IndexedDBContextBookmarkRepository({ indexedDB: factory, broadcastChannel: channelFactory });
  let signals = 0; b.subscribe(() => { signals++; });
  const saved = await a.save(reference(), 0, 5); assert.equal(signals, 1); assert.deepEqual((await b.list()).entries, [saved.bookmark]);
  await a.save(reference(), 0, 5); assert.equal(signals, 1, 'same-key no-op has no invented change');
  await a.remove(saved.bookmark.key, saved.bookmark.saveId); assert.equal(signals, 2); assert.deepEqual((await b.list()).entries, []);
  assert.ok(messages.every(value => JSON.stringify(value) === '{"type":"context-bookmarks-changed","schemaVersion":"context-bookmark-v1"}'));
  await a.close(); await b.close(); assert.equal(channels.size, 0);
});

test('closed repositories reject subsequent work, missing IDB never returns fake success', async () => {
  const repo = new IndexedDBContextBookmarkRepository({ indexedDB: new IDBFactory() }); await repo.close();
  await assert.rejects(repo.list(), { code: 'closed' }); await assert.rejects(repo.load('key'), { code: 'closed' });
  await assert.rejects(repo.save(reference(), 0, 5), { code: 'closed' }); await assert.rejects(repo.remove('key', missingSaveId), { code: 'closed' });
  assert.throws(() => repo.subscribe(() => {}), { code: 'closed' });
  const unavailable = new IndexedDBContextBookmarkRepository();
  await assert.rejects(unavailable.list(), { code: 'storage-unavailable' }); await assert.rejects(unavailable.save(reference(), 0, 5), { code: 'storage-unavailable' }); await unavailable.close();
});


test('close cancels a pending initial open without a late background database creation', async () => {
  const factory = new IDBFactory(), original = factory.open.bind(factory); let started!: () => void;
  const opening = new Promise<void>(resolve => { started = resolve; });
  factory.open = (...args: Parameters<IDBFactory['open']>) => { const request = original(...args); started(); return request; };
  const repo = new IndexedDBContextBookmarkRepository({ indexedDB: factory });
  const save = repo.save(reference(), 0, 5), failure = assert.rejects(save);
  await opening; await repo.close(); await failure;
  assert.deepEqual(await factory.databases(), []);
  await assert.rejects(repo.list(), { code: 'closed' });
});

test('close during an admitted write drains its real commit and readback before closing', async () => {
  const factory = new IDBFactory(), repo = new IndexedDBContextBookmarkRepository({ indexedDB: factory });
  const original = IDBObjectStore.prototype.add; let closing: Promise<void> | null = null;
  IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
    const request = original.apply(this, args);
    if (this.name === CONTEXT_BOOKMARK_STORE_NAME) closing = repo.close();
    return request;
  };
  try {
    const saved = await repo.save(reference(), 0, 5); await closing;
    assert.equal(saved.disposition, 'saved');
    const reopened = new IndexedDBContextBookmarkRepository({ indexedDB: factory });
    assert.deepEqual(await reopened.load(saved.bookmark.key), saved.bookmark); await reopened.close();
  } finally { IDBObjectStore.prototype.add = original; }
  await assert.rejects(repo.save(reference(), 0, 5), { code: 'closed' });
});

test('concurrent empty read and explicit save do not lose the first save or reopen a closed repo', async () => {
  const factory = new IDBFactory(), repo = new IndexedDBContextBookmarkRepository({ indexedDB: factory });
  const [initial, receipt] = await Promise.all([repo.list(), repo.save(reference(), 0, 5)]);
  assert.equal(initial.unreadableCount, 0);
  assert.deepEqual(await repo.load(receipt.bookmark.key), receipt.bookmark);
  assert.deepEqual(await factory.databases(), [{ name: CONTEXT_BOOKMARK_DATABASE_NAME, version: 1 }]);
  await repo.close();
});

test('an unexpected database close invalidates the connection and a later read reopens it', async () => {
  const factory = new IDBFactory(), original = factory.open.bind(factory); let connection: IDBDatabase | null = null;
  factory.open = (...args: Parameters<IDBFactory['open']>) => {
    const request = original(...args); request.addEventListener('success', () => { connection = request.result; }); return request;
  };
  const repo = new IndexedDBContextBookmarkRepository({ indexedDB: factory }), saved = (await repo.save(reference(), 0, 5)).bookmark;
  assert.ok(connection); forceCloseDatabase(connection);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await repo.load(saved.key), saved); await repo.close();
});

for (const delivery of ['unavailable', 'delayed'] as const) {
 test(`stale-tab removal cannot delete a same-key fresh save when notifications are ${delivery}`, async () => {
  const factory = new IDBFactory(), channels = new Set<ContextBookmarkBroadcastChannel>(), pending: (() => void)[] = [];
  const channelFactory = (): ContextBookmarkBroadcastChannel | null => {
   if (delivery === 'unavailable') return null;
   const channel: ContextBookmarkBroadcastChannel = { onmessage:null, postMessage(value) {
    for (const other of channels) if (other !== channel) pending.push(() => other.onmessage?.({data:value} as MessageEvent));
   }, close() { channels.delete(channel); } }; channels.add(channel); return channel;
  };
  const a = new IndexedDBContextBookmarkRepository({indexedDB:factory,now:()=>time,broadcastChannel:channelFactory});
  const b = new IndexedDBContextBookmarkRepository({indexedDB:factory,now:()=>time,broadcastChannel:channelFactory});
  let notices=0; a.subscribe(()=>{notices++}); b.subscribe(()=>{});
  const stale=(await a.save(reference(),0,5)).bookmark, initialNotices=notices;
  assert.equal(await b.remove(stale.key,stale.saveId),true);
  const fresh=(await b.save(reference(),0,5)).bookmark;
  assert.equal(fresh.key,stale.key);assert.equal(fresh.createdAt,stale.createdAt);assert.notEqual(fresh.saveId,stale.saveId);
  assert.equal(notices,initialNotices,'old tab has not received invalidation');
  await assert.rejects(a.remove(stale.key,stale.saveId),{code:'storage-conflict'});
  assert.deepEqual(await a.load(fresh.key),fresh);assert.deepEqual((await b.list()).entries,[fresh]);
  for(const deliver of pending)deliver();
  assert.deepEqual(await a.load(fresh.key),fresh,'late notifications do not write or erase');
  assert.equal(await a.remove(fresh.key,fresh.saveId),true,'explicit action on refreshed incarnation succeeds');
  await a.close();await b.close();
 });
}
test('removal rejects missing or malformed expected save identity before any storage operation',async()=>{
 const factory=new IDBFactory(),repo=new IndexedDBContextBookmarkRepository({indexedDB:factory});
 for(const id of [undefined,null,'', 'old'] as unknown as string[])await assert.rejects(repo.remove('key',id),{code:'invalid-record'});
 assert.deepEqual(await factory.databases(),[]);await repo.close();
});
test('removal commit followed by readback abort is a failure receipt, without inventing rollback',async()=>{
 const factory=new IDBFactory(),repo=new IndexedDBContextBookmarkRepository({indexedDB:factory});
 const saved=(await repo.save(reference(),0,5)).bookmark,original=IDBObjectStore.prototype.get;let calls=0;
 IDBObjectStore.prototype.get=function(...args:Parameters<IDBObjectStore['get']>){const request=original.apply(this,args);if(++calls===2)request.addEventListener('success',()=>this.transaction.abort());return request};
 try{await assert.rejects(repo.remove(saved.key,saved.saveId))}finally{IDBObjectStore.prototype.get=original}
 assert.equal(await repo.load(saved.key),null,'committed removal is honestly absent despite failed receipt');await repo.close();
});
