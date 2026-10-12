import {
  LOCAL_REFERENCE_SCHEMA_VERSION, LocalReferenceError, canonicalLocalReferenceJSON, captureLocalReferenceReceipt,
  captureOriginalReference, defaultLocalReferenceDigest, localReferenceKey, sameLocalReferenceSaveIntent,
  validateLocalReferenceReceipt, type LocalReferenceDigest, type LocalReferenceMaterial, type LocalReferenceProposal, type LocalReferenceReceipt,
} from './local-reference';

export const LOCAL_REFERENCE_DATABASE_NAME = 'lingotrace-local-references-v1' as const;
export const LOCAL_REFERENCE_STORE_NAME = 'versions' as const;
const REQUEST_INDEX = 'saveRequestId';
export interface LocalReferenceList { readonly entries: readonly LocalReferenceReceipt[]; readonly unreadableCount: number }
export interface LocalReferenceSaveResult { readonly entry: LocalReferenceReceipt; readonly disposition: 'saved' | 'already-present' }
export interface LocalReferenceBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null; postMessage(value: unknown): void; close(): void;
}
export interface LocalReferenceRepositoryOptions {
  /** The host supplies its exact canonical CAFE_MATERIAL, never an embedded historical snapshot. */
  readonly original: LocalReferenceMaterial; readonly indexedDB?: IDBFactory; readonly digest?: LocalReferenceDigest;
  readonly broadcastChannel?: (name: string) => LocalReferenceBroadcastChannel | null;
}
interface RawRow { readonly key: IDBValidKey; readonly value: unknown }
const unavailable = (message: string) => new LocalReferenceError('storage-unavailable', message);
const conflict = (message = '版本或保存请求标识已有不同内容，未覆盖任何参考。') => new LocalReferenceError('storage-conflict', message);

/** Explicit insert-only library, entirely separate from Training's database/permission.
 * Reads never create a database. There is no delete, mutable latest pointer or adoption. */
export class IndexedDBLocalReferenceRepository {
  private readonly original: LocalReferenceMaterial;
  private readonly factory: IDBFactory | undefined;
  private readonly digest: LocalReferenceDigest;
  private readonly channelFactory: LocalReferenceRepositoryOptions['broadcastChannel'];
  private database: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase | null> | null = null;
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private channel: LocalReferenceBroadcastChannel | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(options: LocalReferenceRepositoryOptions) {
    this.original = captureOriginalReference(options.original);
    try { this.factory = options.indexedDB ?? globalThis.indexedDB; } catch { this.factory = undefined; }
    this.digest = options.digest ?? defaultLocalReferenceDigest; this.channelFactory = options.broadcastChannel;
    // No database, channel, writes or active material change during construction/render.
  }
  private assertOpen(): void { if (this.closed) throw new LocalReferenceError('closed', '本地参考库已关闭。'); }
  private ensureChannel(): void {
    if (this.channel || this.closed) return;
    try {
      const channel = this.channelFactory ? this.channelFactory(LOCAL_REFERENCE_DATABASE_NAME)
        : typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(LOCAL_REFERENCE_DATABASE_NAME) : null;
      if (!channel) return;
      channel.onmessage = event => {
        if (!this.closed && event.data?.type === 'local-references-changed' && event.data?.schemaVersion === LOCAL_REFERENCE_SCHEMA_VERSION) this.notify(false);
      };
      this.channel = channel;
    } catch { /* Lists/load always read IDB afresh; focus/visibility refresh does not need a channel. */ }
  }
  subscribe = (listener: () => void): (() => void) => {
    this.assertOpen(); this.listeners.add(listener); this.ensureChannel();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.channel) { this.channel.close(); this.channel = null; }
    };
  };
  private notify(broadcast: boolean): void {
    if (this.closed) return;
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* View failures cannot change receipts. */ } }
    if (broadcast) {
      this.ensureChannel();
      try { this.channel?.postMessage({ type: 'local-references-changed', schemaVersion: LOCAL_REFERENCE_SCHEMA_VERSION }); } catch { /* Advisory invalidation only. */ }
      if (!this.listeners.size && this.channel) { this.channel.close(); this.channel = null; }
    }
  }
  private async open(create: boolean): Promise<IDBDatabase | null> {
    this.assertOpen(); if (this.database) return this.database;
    if (this.opening) { const db = await this.opening; this.assertOpen(); return db || !create ? db : this.open(true); }
    const opening = new Promise<IDBDatabase | null>((resolve, reject) => {
      if (!this.factory) { reject(unavailable('此浏览器无法使用 IndexedDB，校正参考尚未保存。')); return; }
      let request: IDBOpenDBRequest;
      try { request = this.factory.open(LOCAL_REFERENCE_DATABASE_NAME, 1); } catch (error) { reject(error); return; }
      let rejected = false, absent = false;
      request.onupgradeneeded = event => {
        if (rejected || this.closed || !create || event.oldVersion !== 0) {
          absent = !create && event.oldVersion === 0 && !rejected && !this.closed; request.transaction!.abort(); return;
        }
        const store = request.result.createObjectStore(LOCAL_REFERENCE_STORE_NAME, { keyPath: 'key' });
        store.createIndex(REQUEST_INDEX, 'saveRequestId', { unique: true });
      };
      request.onblocked = () => { rejected = true; reject(unavailable('本地参考库被其他页面占用，请关闭旧页面后重试。')); };
      request.onerror = () => absent && !this.closed ? resolve(null) : reject(request.error ?? unavailable('无法打开本地参考库。'));
      request.onsuccess = () => {
        const db = request.result;
        if (rejected || this.closed) { db.close(); reject(unavailable('参考库打开过程已取消。')); return; }
        try {
          if (db.version !== 1 || db.objectStoreNames.length !== 1 || !db.objectStoreNames.contains(LOCAL_REFERENCE_STORE_NAME)) throw unavailable('不支持此参考库结构，未迁移或修改。');
          const store = db.transaction(LOCAL_REFERENCE_STORE_NAME, 'readonly').objectStore(LOCAL_REFERENCE_STORE_NAME);
          if (store.keyPath !== 'key' || store.autoIncrement || store.indexNames.length !== 1 || !store.indexNames.contains(REQUEST_INDEX)
            || store.index(REQUEST_INDEX).keyPath !== 'saveRequestId' || !store.index(REQUEST_INDEX).unique || store.index(REQUEST_INDEX).multiEntry) throw unavailable('不支持此参考库索引，未迁移或修改。');
        } catch (error) { db.close(); reject(error); return; }
        const disconnected = () => { if (this.database === db) this.database = null; this.notify(false); };
        db.onversionchange = () => { db.close(); disconnected(); }; db.onclose = disconnected;
        this.database = db; resolve(db);
      };
    });
    this.opening = opening;
    try { return await opening; } finally { if (this.opening === opening) this.opening = null; }
  }
  private async readRows(database: IDBDatabase): Promise<readonly RawRow[]> {
    this.assertOpen();
    return new Promise((resolve, reject) => {
      const rows: RawRow[] = [], tx = database.transaction(LOCAL_REFERENCE_STORE_NAME, 'readonly');
      const request = tx.objectStore(LOCAL_REFERENCE_STORE_NAME).openCursor();
      request.onsuccess = () => { const cursor = request.result; if (cursor) { rows.push({ key: cursor.primaryKey, value: cursor.value }); cursor.continue(); } };
      tx.oncomplete = () => resolve(rows);
      tx.onerror = tx.onabort = () => reject(tx.error ?? unavailable('参考库读取未完成，不能据此判断为空。'));
    });
  }
  /** One readonly snapshot, validated recursively all the way to the exact original.
   * Nothing returned from the row's IDs alone can authorize playback/adoption. */
  private snapshot(rows: readonly RawRow[]) {
    const raw = new Map<string, unknown>();
    for (const row of rows) if (typeof row.key === 'string') raw.set(row.key, row.value);
    const checked = new Map<string, Promise<LocalReferenceReceipt>>();
    const validate = (key: string, ancestors = new Set<string>()): Promise<LocalReferenceReceipt> => {
      if (ancestors.has(key)) return Promise.reject(new LocalReferenceError('invalid-record', '参考父版本链出现循环。'));
      const cached = checked.get(key); if (cached) return cached;
      const work = (async () => {
        if (!raw.has(key)) throw new LocalReferenceError('stale-reference', '参考的父版本记录缺失，不能核验此版本。');
        const entry = captureLocalReferenceReceipt(raw.get(key));
        if (entry.key !== key) throw new LocalReferenceError('invalid-record', '参考主键与内容不一致。');
        let parent = this.original;
        if (entry.parent.version !== this.original.version) {
          const next = new Set(ancestors); next.add(key);
          parent = (await validate(localReferenceKey(entry.parent.materialId, entry.parent.version), next)).material;
        }
        return validateLocalReferenceReceipt(entry, parent, this.original, this.digest);
      })();
      checked.set(key, work); return work;
    };
    return { raw, validate };
  }
  async list(): Promise<LocalReferenceList> {
    this.assertOpen(); await this.tail;
    const db = await this.open(false); if (!db) return Object.freeze({ entries: Object.freeze([]), unreadableCount: 0 });
    const rows = await this.readRows(db), snapshot = this.snapshot(rows), entries: LocalReferenceReceipt[] = []; let unreadableCount = 0;
    // Sequential roots avoid mutual-promise deadlocks for corrupt cyclic graphs.
    for (const row of rows) {
      try { if (typeof row.key !== 'string') throw conflict(); entries.push(await snapshot.validate(row.key)); } catch { unreadableCount++; }
    }
    this.assertOpen();
    return Object.freeze({ entries: Object.freeze(entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.key.localeCompare(b.key))), unreadableCount });
  }
  async load(materialId: string, version: string): Promise<LocalReferenceReceipt | null> {
    this.assertOpen(); const key = localReferenceKey(materialId, version); await this.tail;
    const db = await this.open(false); if (!db) return null;
    const snapshot = this.snapshot(await this.readRows(db));
    if (!snapshot.raw.has(key)) return null;
    const entry = await snapshot.validate(key); this.assertOpen(); return entry;
  }
  async isExactSavedMaterial(material: LocalReferenceMaterial): Promise<boolean> {
    try {
      const expected = canonicalLocalReferenceJSON(material), row = await this.load(material.id, material.version);
      return !!row && canonicalLocalReferenceJSON(row.material) === expected;
    } catch { return false; }
  }
  save(proposal: LocalReferenceProposal): Promise<LocalReferenceSaveResult> {
    let captured: LocalReferenceReceipt;
    try { this.assertOpen(); captured = captureLocalReferenceReceipt(proposal); } catch (error) { return Promise.reject(error); }
    const operation = this.tail.then(async () => {
      this.assertOpen();
      const previousDb = await this.open(false), rows = previousDb ? await this.readRows(previousDb) : [];
      const snapshot = this.snapshot(rows), proofs = new Map<string, string>();
      let parent = this.original;
      if (captured.parent.version !== this.original.version) {
        const parentKey = localReferenceKey(captured.parent.materialId, captured.parent.version);
        parent = (await snapshot.validate(parentKey)).material;
        // Capture every ancestor that made this admission valid. The serialized
        // write transaction verifies the same bytes before it inserts a child.
        let key = parentKey;
        while (true) {
          const ancestor = await snapshot.validate(key); proofs.set(key, canonicalLocalReferenceJSON(ancestor));
          if (ancestor.parent.version === this.original.version) break;
          key = localReferenceKey(ancestor.parent.materialId, ancestor.parent.version);
        }
      }
      const candidate = await validateLocalReferenceReceipt(captured, parent, this.original, this.digest);
      if (snapshot.raw.has(candidate.key)) {
        let existing: LocalReferenceReceipt;
        try { existing = await snapshot.validate(candidate.key); } catch { throw conflict('相同标识已有损坏或未知版本，未覆盖原记录。'); }
        if (!sameLocalReferenceSaveIntent(existing, candidate)) throw conflict();
      }
      this.assertOpen(); const db = (await this.open(true))!;
      const receipt = await new Promise<LocalReferenceSaveResult>((resolve, reject) => {
        const tx = db.transaction(LOCAL_REFERENCE_STORE_NAME, 'readwrite'), store = tx.objectStore(LOCAL_REFERENCE_STORE_NAME);
        let result: LocalReferenceSaveResult | null = null, failure: unknown;
        const request = store.getAll();
        request.onsuccess = () => {
          try {
            const current = new Map<string, unknown>();
            for (const raw of request.result) {
              if (raw && typeof raw === 'object' && typeof raw.key === 'string') current.set(raw.key, raw);
              if (raw && typeof raw === 'object' && raw.saveRequestId === candidate.saveRequestId && raw.key !== candidate.key) throw conflict();
            }
            for (const [key, value] of proofs) {
              if (!current.has(key) || canonicalLocalReferenceJSON(current.get(key)) !== value) throw conflict('父版本在保存期间变化或丢失，未保存此校正。');
            }
            if (current.has(candidate.key)) {
              let existing: LocalReferenceReceipt;
              try { existing = captureLocalReferenceReceipt(current.get(candidate.key)); } catch { throw conflict(); }
              if (!sameLocalReferenceSaveIntent(existing, candidate)) throw conflict();
              result = { entry: existing, disposition: 'already-present' };
            } else {
              // Atomic get/add and unique save-request index serialize all tabs.
              // Crypto ran before this transaction; no await can auto-close it.
              store.add(candidate); result = { entry: candidate, disposition: 'saved' };
            }
          } catch (error) { failure = error; tx.abort(); }
        };
        tx.oncomplete = () => result ? resolve(result) : reject(unavailable('参考保存事务没有可核验回执。'));
        tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? unavailable('参考版本尚未提交保存。'));
      });
      // Commit is not success until full receipt, digests and ancestry read back.
      const readback = this.snapshot(await this.readRows(db));
      if (!readback.raw.has(candidate.key)) throw conflict('提交后未读回参考版本，请重试同一保存请求。');
      const stored = await readback.validate(candidate.key);
      if (canonicalLocalReferenceJSON(stored) !== canonicalLocalReferenceJSON(receipt.entry)) throw conflict('提交后参考回执发生变化，不能宣称保存成功。');
      this.assertOpen(); if (receipt.disposition === 'saved') this.notify(true);
      return Object.freeze({ entry: stored, disposition: receipt.disposition });
    });
    this.tail = operation.then(() => {}, () => {}); return operation;
  }
  async close(): Promise<void> {
    this.closed = true; this.channel?.close(); this.channel = null; this.listeners.clear();
    await this.tail;
    if (this.opening) { try { await this.opening; } catch { /* Opening error stays with operation. */ } }
    this.database?.close(); this.database = null;
  }
}
