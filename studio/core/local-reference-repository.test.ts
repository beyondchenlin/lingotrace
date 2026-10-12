import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { CAFE_MATERIAL } from './training';
import {
  LOCAL_REFERENCE_MEDIA_ID, LOCAL_REFERENCE_MEDIA_SHA256, buildLocalReferenceProposal, canonicalLocalReferenceJSON,
  type BuildLocalReferenceOptions, type LocalReferenceDigest, type LocalReferenceReceipt,
} from './local-reference';
import {
  IndexedDBLocalReferenceRepository, LOCAL_REFERENCE_DATABASE_NAME, LOCAL_REFERENCE_STORE_NAME,
  type LocalReferenceBroadcastChannel,
} from './local-reference-repository';
const time = '2026-10-10T08:00:00.000Z';
const media = { id: LOCAL_REFERENCE_MEDIA_ID, sha256: LOCAL_REFERENCE_MEDIA_SHA256, durationSeconds: 72 };
const digest: LocalReferenceDigest = async value => createHash('sha256').update(value).digest('hex');
function proposal(saveRequestId = 'request-1', patch: Partial<BuildLocalReferenceOptions> = {}) {
  return buildLocalReferenceProposal({ original: CAFE_MATERIAL, parent: CAFE_MATERIAL, editedCueId: CAFE_MATERIAL.cues[1].id,
    text: 'Would you like that coffee hot or iced?', start: 6.15, end: 11.85, media, saveRequestId, createdAt: time, ...patch }, digest);
}
function repository(indexedDB: IDBFactory, extra: { digest?: LocalReferenceDigest; broadcastChannel?: (name: string) => LocalReferenceBroadcastChannel | null } = {}) {
  return new IndexedDBLocalReferenceRepository({ original: CAFE_MATERIAL, indexedDB, digest, ...extra });
}
function rawOpen(factory: IDBFactory, version = 1, index = true): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(LOCAL_REFERENCE_DATABASE_NAME, version);
    request.onupgradeneeded = () => { const store = request.result.createObjectStore(LOCAL_REFERENCE_STORE_NAME, { keyPath: 'key' }); if (index) store.createIndex('saveRequestId', 'saveRequestId', { unique: true }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function rawWrite(factory: IDBFactory, value: unknown, removeKey?: string): Promise<void> {
  const db = await rawOpen(factory);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LOCAL_REFERENCE_STORE_NAME, 'readwrite'), store = tx.objectStore(LOCAL_REFERENCE_STORE_NAME);
    if (removeKey) store.delete(removeKey); else store.put(value);
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
  }); db.close();
}
async function rawRows(factory: IDBFactory): Promise<unknown[]> {
  const db = await rawOpen(factory);
  const result = await new Promise<unknown[]>((resolve, reject) => {
    const tx = db.transaction(LOCAL_REFERENCE_STORE_NAME, 'readonly'), req = tx.objectStore(LOCAL_REFERENCE_STORE_NAME).getAll();
    tx.oncomplete = () => resolve(req.result); tx.onerror = tx.onabort = () => reject(tx.error);
  }); db.close(); return result;
}
async function resign(row: LocalReferenceReceipt): Promise<LocalReferenceReceipt> {
  const { receiptDigest: _, ...unsigned } = row;
  return { ...row, receiptDigest: await digest(canonicalLocalReferenceJSON(unsigned)) };
}

test('constructor/empty reads/subscribe do not create databases or select a version', async () => {
  const factory = new IDBFactory(); let channels = 0;
  const repo = repository(factory, { broadcastChannel: () => { channels++; return null; } });
  assert.equal(channels, 0); assert.deepEqual(await factory.databases(), []);
  const unsubscribe = repo.subscribe(() => {}); assert.equal(channels, 1);
  assert.deepEqual(await repo.list(), { entries: [], unreadableCount: 0 });
  assert.equal(await repo.load(CAFE_MATERIAL.id, 'missing'), null);
  assert.equal(await repo.isExactSavedMaterial(CAFE_MATERIAL), false);
  assert.deepEqual(await factory.databases(), []);
  assert.equal('remove' in repo, false); assert.equal('latest' in repo, false);
  unsubscribe(); await repo.close();
});

test('explicit save validates readback, survives reload and never creates Training database or data', async () => {
  const factory = new IDBFactory(), repo = repository(factory), request = await proposal();
  const saved = await repo.save(request); assert.equal(saved.disposition, 'saved'); assert.deepEqual(saved.entry, request);
  assert.deepEqual(await repo.load(request.material.id, request.material.version), request);
  assert.equal(await repo.isExactSavedMaterial(request.material), true);
  assert.equal(await repo.isExactSavedMaterial({ ...request.material, title: 'different' }), false);
  assert.ok(Object.isFrozen(saved.entry.material.cues[0])); await repo.close();
  const reopened = repository(factory);
  assert.deepEqual(await reopened.list(), { entries: [request], unreadableCount: 0 });
  assert.deepEqual((await factory.databases()).map(db => db.name), [LOCAL_REFERENCE_DATABASE_NAME]);
  assert.doesNotMatch(JSON.stringify(await rawRows(factory)), /attemptId|sessionId|accuracy|draft|earnedWords|inputCommitted/);
  await reopened.close();
});

test('same fixed request is idempotent after reload and preserves original receipt creation time', async () => {
  const factory = new IDBFactory(), first = repository(factory), request = await proposal();
  const receipt = (await first.save(request)).entry; await first.close();
  const second = repository(factory), retried = await proposal('request-1', { createdAt: '2026-10-11T08:00:00.000Z' });
  const saved = await second.save(retried);
  assert.equal(saved.disposition, 'already-present'); assert.deepEqual(saved.entry, receipt);
  assert.equal((await rawRows(factory)).length, 1); await second.close();
});

test('two tabs and duplicate clicks serialize one request without channels', async () => {
  const factory = new IDBFactory(), a = repository(factory, { broadcastChannel: () => null }), b = repository(factory, { broadcastChannel: () => null });
  const request = await proposal(), retry = await proposal('request-1', { createdAt: '2026-10-11T08:00:00.000Z' });
  const receipts = await Promise.all([a.save(request), b.save(retry), a.save(request), b.save(request)]);
  assert.equal(receipts.filter(row => row.disposition === 'saved').length, 1);
  assert.equal(new Set(receipts.map(row => row.entry.receiptDigest)).size, 1);
  assert.equal((await rawRows(factory)).length, 1); await a.close(); await b.close();
});

test('siblings remain separate explicit versions and can independently parent descendants', async () => {
  const factory = new IDBFactory(), a = repository(factory), b = repository(factory);
  const left = await proposal('left'), right = await proposal('right', { text: 'Do you prefer hot coffee or iced coffee?' });
  await Promise.all([a.save(left), b.save(right)]);
  const grandchild = await proposal('left-child', { parent: left.material, text: 'Hot coffee or iced coffee?' });
  await b.save(grandchild);
  const list = await a.list(); assert.equal(list.entries.length, 3); assert.equal(list.unreadableCount, 0);
  assert.deepEqual((await a.load(left.material.id, left.material.version))!.material, left.material);
  assert.deepEqual((await a.load(right.material.id, right.material.version))!.material, right.material);
  assert.deepEqual((await a.load(grandchild.material.id, grandchild.material.version))!.parent.digest, left.materialDigest);
  await a.close(); await b.close();
});

test('same version/different content, changed request, or same request/different version reject without overwrite', async () => {
  const factory = new IDBFactory(), repo = repository(factory), request = await proposal(); await repo.save(request);
  const before = await rawRows(factory);
  const candidates = [
    await proposal('request-1', { text: 'Different reference.' }),
    await proposal('other-request', { version: request.material.version }),
    await proposal('request-1', { version: 'explicit-other-version' }),
  ];
  for (const candidate of candidates) await assert.rejects(repo.save(candidate), { code: 'storage-conflict' });
  assert.deepEqual(await rawRows(factory), before); await repo.close();
});

test('a valid-looking proposal cannot save under an absent or merely embedded parent', async () => {
  const factory = new IDBFactory(), repo = repository(factory), parent = await proposal('parent');
  const child = await proposal('child', { parent: parent.material, text: 'A new child reference.' });
  await assert.rejects(repo.save(child), { code: 'stale-reference' });
  assert.deepEqual(await factory.databases(), []); await repo.close();
});

test('unknown rows and material/receipt corruption stay unreadable without repair or overwrite', async () => {
  const factory = new IDBFactory(), repo = repository(factory), request = await proposal(); await repo.save(request);
  await rawWrite(factory, { ...request, material: { ...request.material, title: 'tampered' } });
  await rawWrite(factory, { key: 'future', saveRequestId: 'future-request', schemaVersion: 'future-v2', secret: 'retain unmodified' });
  const before = await rawRows(factory);
  assert.deepEqual(await repo.list(), { entries: [], unreadableCount: 2 });
  await assert.rejects(repo.load(request.material.id, request.material.version));
  assert.equal(await repo.isExactSavedMaterial(request.material), false);
  await assert.rejects(repo.save(request), { code: 'storage-conflict' });
  assert.deepEqual(await rawRows(factory), before); await repo.close();
});

test('every read revalidates complete ancestry; missing/corrupt ancestor invalidates children', async () => {
  const factory = new IDBFactory(), repo = repository(factory), parent = await proposal('parent'); await repo.save(parent);
  const child = await proposal('child', { parent: parent.material, text: 'New text.' }); await repo.save(child);
  assert.equal(await repo.isExactSavedMaterial(child.material), true);
  await rawWrite(factory, { ...parent, parent: { ...parent.parent, digest: '0'.repeat(64) } });
  assert.deepEqual(await repo.list(), { entries: [], unreadableCount: 2 });
  assert.equal(await repo.isExactSavedMaterial(child.material), false);
  await rawWrite(factory, null, parent.key);
  assert.deepEqual(await repo.list(), { entries: [], unreadableCount: 1 });
  await assert.rejects(repo.load(child.material.id, child.material.version), { code: 'stale-reference' }); await repo.close();
});

test('unknown parent roots and cyclic raw lineage fail closed without hanging', async () => {
  const factory = new IDBFactory(), repo = repository(factory), a = await proposal('a'), b = await proposal('b');
  const mutateParent = async (row: LocalReferenceReceipt, parent: LocalReferenceReceipt) => resign({ ...row,
    parent: { materialId: parent.material.id, version: parent.material.version, digest: parent.materialDigest },
    material: { ...row.material, localReference: { ...row.material.localReference!, parentVersion: parent.material.version } } });
  await rawWrite(factory, await mutateParent(a, b)); await rawWrite(factory, await mutateParent(b, a));
  const listed = await repo.list(); assert.equal(listed.entries.length, 0); assert.equal(listed.unreadableCount, 2);
  await assert.rejects(repo.load(a.material.id, a.material.version), { code: 'invalid-record' }); await repo.close();
});

test('parent proof is compared in the write transaction after async digest validation', async () => {
  const factory = new IDBFactory(), setup = repository(factory), parent = await proposal('parent'); await setup.save(parent); await setup.close();
  const child = await proposal('child', { parent: parent.material, text: 'Child reference.' }); let tamper = true;
  const repo = repository(factory, { digest: async value => {
    if (tamper && value.includes('"saveRequestId":"child"')) { tamper = false; await rawWrite(factory, { ...parent, createdAt: '2026-10-11T08:00:00.000Z' }); }
    return digest(value);
  } });
  await assert.rejects(repo.save(child), { code: 'storage-conflict' });
  assert.equal((await rawRows(factory)).length, 1); await repo.close();
});

test('synchronous add/quota failure aborts and the same request can retry', async () => {
  const factory = new IDBFactory(), repo = repository(factory), request = await proposal(), add = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) { if (this.name === LOCAL_REFERENCE_STORE_NAME) throw new DOMException('Injected quota', 'QuotaExceededError'); return add.apply(this, args); };
  try { await assert.rejects(repo.save(request), { name: 'QuotaExceededError' }); } finally { IDBObjectStore.prototype.add = add; }
  assert.deepEqual(await repo.list(), { entries: [], unreadableCount: 0 });
  assert.equal((await repo.save(request)).disposition, 'saved'); await repo.close();
});

test('request success followed by transaction abort never reports saved', async () => {
  const factory = new IDBFactory(), repo = repository(factory), request = await proposal(), add = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
    const req = add.apply(this, args); if (this.name === LOCAL_REFERENCE_STORE_NAME) req.addEventListener('success', () => this.transaction.abort()); return req;
  };
  try { await assert.rejects(repo.save(request)); } finally { IDBObjectStore.prototype.add = add; }
  assert.deepEqual(await rawRows(factory), []);
  assert.equal((await repo.save(request)).disposition, 'saved'); await repo.close();
});

test('commit with failed digest readback does not report success; fixed request recovers original receipt', async () => {
  const factory = new IDBFactory(); let added = false, failReadback = true, notifications = 0;
  const repo = repository(factory, { digest: async value => { if (added && failReadback) throw new Error('Injected readback hash failure'); return digest(value); } });
  const unsubscribe = repo.subscribe(() => { notifications++; });
  const request = await proposal(), add = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) { const result = add.apply(this, args); if (this.name === LOCAL_REFERENCE_STORE_NAME) added = true; return result; };
  try { await assert.rejects(repo.save(request), /Injected readback/); } finally { IDBObjectStore.prototype.add = add; }
  assert.equal(notifications, 0); assert.equal((await rawRows(factory)).length, 1);
  failReadback = false;
  const retry = await repo.save(request); assert.equal(retry.disposition, 'already-present'); assert.deepEqual(retry.entry, request);
  unsubscribe(); await repo.close();
});

test('IDB read failures remain failures rather than an empty list or missing version', async () => {
  const factory = new IDBFactory(), repo = repository(factory), request = await proposal(); await repo.save(request);
  const cursor = IDBObjectStore.prototype.openCursor;
  IDBObjectStore.prototype.openCursor = function (...args: Parameters<IDBObjectStore['openCursor']>) { if (this.name === LOCAL_REFERENCE_STORE_NAME) throw new DOMException('Injected read', 'UnknownError'); return cursor.apply(this, args); };
  try {
    await assert.rejects(repo.list(), { name: 'UnknownError' });
    await assert.rejects(repo.load(request.material.id, request.material.version), { name: 'UnknownError' });
    assert.equal(await repo.isExactSavedMaterial(request.material), false);
  } finally { IDBObjectStore.prototype.openCursor = cursor; }
  assert.equal((await repo.list()).entries.length, 1); await repo.close();
});

test('delayed or broken BroadcastChannel never controls persistence, listings or adoption', async () => {
  const factory = new IDBFactory(), channels: LocalReferenceBroadcastChannel[] = [], messages: unknown[] = [];
  const make = () => { const channel: LocalReferenceBroadcastChannel = { onmessage: null, postMessage: value => { messages.push(value); }, close() {} }; channels.push(channel); return channel; };
  const a = repository(factory, { broadcastChannel: make }), b = repository(factory, { broadcastChannel: make });
  let changes = 0; const unA = a.subscribe(() => {}), unB = b.subscribe(() => { changes++; });
  const request = await proposal(); await a.save(request);
  assert.equal(changes, 0, 'notification remains delayed'); assert.equal((await b.list()).entries.length, 1);
  assert.equal(await b.isExactSavedMaterial(request.material), true);
  assert.deepEqual(messages, [{ type: 'local-references-changed', schemaVersion: 'local-reference-library-v1' }]);
  channels[1].onmessage!({ data: messages[0] } as MessageEvent); assert.equal(changes, 1);
  assert.deepEqual(await rawRows(factory), [request]); unA(); unB(); await a.close(); await b.close();
  const unavailable = repository(factory, { broadcastChannel: () => { throw new Error('blocked'); } });
  const un = unavailable.subscribe(() => {}); assert.equal((await unavailable.list()).entries.length, 1);
  un(); await unavailable.close();
});

test('unavailable/unsupported database structure fails without migration', async () => {
  for (const [version, index] of [[2, true], [1, false]] as const) {
    const factory = new IDBFactory(), db = await rawOpen(factory, version, index); db.close();
    const repo = repository(factory); await assert.rejects(repo.list()); await assert.rejects(repo.save(await proposal()));
    const names = await factory.databases(); assert.equal(names[0].version, version); await repo.close();
  }
  const absent = new IndexedDBLocalReferenceRepository({ original: CAFE_MATERIAL, indexedDB: undefined });
  await assert.rejects(absent.list(), { code: 'storage-unavailable' }); await absent.close();
});

test('closed repository refuses operations and emits no late notifications', async () => {
  const factory = new IDBFactory(), repo = repository(factory); await repo.close();
  await assert.rejects(repo.save(await proposal()), { code: 'closed' });
  await assert.rejects(repo.list(), { code: 'closed' });
  await assert.rejects(repo.load(CAFE_MATERIAL.id, 'anything'), { code: 'closed' });
  assert.deepEqual(await factory.databases(), []);
});
