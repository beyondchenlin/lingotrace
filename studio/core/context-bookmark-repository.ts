import {
  ContextBookmarkError, CONTEXT_BOOKMARK_SCHEMA_VERSION, createContextBookmark, validateContextBookmark,
  type ContextBookmark, type ContextBookmarkReference,
} from './context-bookmark';

export const CONTEXT_BOOKMARK_DATABASE_NAME = 'lingotrace-context-bookmarks-v1' as const;
export const CONTEXT_BOOKMARK_STORE_NAME = 'bookmarks' as const;
export interface ContextBookmarkList { readonly entries: readonly ContextBookmark[]; readonly unreadableCount: number }
export interface ContextBookmarkSaveResult { readonly bookmark: ContextBookmark; readonly disposition: 'saved' | 'already-present' }
/** Payload-free invalidation only. Receiving a notification never writes data. */
export interface ContextBookmarkBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(value: unknown): void;
  close(): void;
}
export interface ContextBookmarkRepositoryOptions {
  readonly indexedDB?: IDBFactory;
  readonly now?: () => string;
  readonly createId?: () => string;
  readonly broadcastChannel?: (name: string) => ContextBookmarkBroadcastChannel | null;
}
function storageError(message: string): ContextBookmarkError { return new ContextBookmarkError('storage-unavailable', message); }
function validKey(key: string): void {
  if (typeof key !== 'string' || !key.length || key.length > 2048) throw new ContextBookmarkError('invalid-record', '收藏标识无法读取。');
}
function equalRecord(a: ContextBookmark, b: ContextBookmark): boolean {
  // Validation returns narrow objects in canonical order; no answers or drafts.
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Independent user-created saves only. No Training database, migration, history
 * setting, automatic observation, answer, score or review schedule dependency. */
export class IndexedDBContextBookmarkRepository {
  private readonly factory: IDBFactory | undefined;
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly channelFactory: ((name: string) => ContextBookmarkBroadcastChannel | null) | undefined;
  private database: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase | null> | null = null;
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private channel: ContextBookmarkBroadcastChannel | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(options: ContextBookmarkRepositoryOptions = {}) {
    try { this.factory = options.indexedDB ?? globalThis.indexedDB; } catch { this.factory = undefined; }
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? (() => globalThis.crypto.randomUUID());
    this.channelFactory = options.broadcastChannel;
    // Deliberately no open, data writes or browser channel during SSR/render.
  }
  private assertOpen(): void {
    if (this.closed) throw new ContextBookmarkError('closed', '收藏库已关闭，请重新打开。');
  }
  private ensureChannel(): void {
    if (this.channel || this.closed) return;
    try {
      const channel = this.channelFactory ? this.channelFactory(CONTEXT_BOOKMARK_DATABASE_NAME)
        : typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CONTEXT_BOOKMARK_DATABASE_NAME) : null;
      if (!channel) return;
      channel.onmessage = event => {
        if (!this.closed && event.data?.type === 'context-bookmarks-changed' && event.data?.schemaVersion === CONTEXT_BOOKMARK_SCHEMA_VERSION) this.notify(false);
      };
      this.channel = channel;
    } catch { /* Focus/visibility refresh remains available when channels are blocked. */ }
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
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* A view cannot invalidate a committed transaction. */ } }
    if (broadcast) {
      this.ensureChannel();
      try { this.channel?.postMessage({ type: 'context-bookmarks-changed', schemaVersion: CONTEXT_BOOKMARK_SCHEMA_VERSION }); } catch { /* Notification is not the persistence receipt. */ }
      if (!this.listeners.size && this.channel) { this.channel.close(); this.channel = null; }
    }
  }
  private async open(create: boolean): Promise<IDBDatabase | null> {
    this.assertOpen();
    if (this.database) return this.database;
    if (this.opening) {
      const existing = await this.opening;
      this.assertOpen();
      return existing || !create ? existing : this.open(true);
    }
    const opening = new Promise<IDBDatabase | null>((resolve, reject) => {
      if (!this.factory) { reject(storageError('此浏览器无法使用 IndexedDB，收藏尚未保存。')); return; }
      let request: IDBOpenDBRequest;
      try { request = this.factory.open(CONTEXT_BOOKMARK_DATABASE_NAME, 1); } catch (error) { reject(error); return; }
      let rejected = false, absent = false;
      request.onupgradeneeded = event => {
        // A read never creates a database. Aborting its initial upgrade also
        // removes the empty database; it never initializes records on the side.
        if (rejected || this.closed || !create || event.oldVersion !== 0) {
          absent = !create && event.oldVersion === 0 && !rejected && !this.closed;
          request.transaction!.abort(); return;
        }
        request.result.createObjectStore(CONTEXT_BOOKMARK_STORE_NAME, { keyPath: 'key' });
      };
      request.onblocked = () => { rejected = true; reject(storageError('收藏库正被其他页面占用，请关闭旧页面后重试。')); };
      request.onerror = () => {
        if (absent && !this.closed) resolve(null);
        else reject(request.error ?? storageError('无法打开收藏库，未宣称保存成功。'));
      };
      request.onsuccess = () => {
        const database = request.result;
        if (rejected || this.closed) { database.close(); reject(storageError('收藏库打开过程已取消。')); return; }
        try {
          if (database.version !== 1 || database.objectStoreNames.length !== 1 || !database.objectStoreNames.contains(CONTEXT_BOOKMARK_STORE_NAME)
            || database.transaction(CONTEXT_BOOKMARK_STORE_NAME, 'readonly').objectStore(CONTEXT_BOOKMARK_STORE_NAME).keyPath !== 'key') {
            throw storageError('此收藏库版本或结构不受支持，未迁移或修改。');
          }
        } catch (error) { database.close(); reject(error); return; }
        const disconnected = () => { if (this.database === database) this.database = null; this.notify(false); };
        database.onversionchange = () => { database.close(); disconnected(); };
        database.onclose = disconnected;
        this.database = database; resolve(database);
      };
    });
    this.opening = opening;
    try { return await opening; } finally { if (this.opening === opening) this.opening = null; }
  }
  private async readRecord(database: IDBDatabase, key: string): Promise<ContextBookmark | null> {
    const raw = await new Promise<unknown>((resolve, reject) => {
      const tx = database.transaction(CONTEXT_BOOKMARK_STORE_NAME, 'readonly'), request = tx.objectStore(CONTEXT_BOOKMARK_STORE_NAME).get(key);
      let result: unknown;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? storageError('收藏读取未完成，请重试。'));
    });
    if (raw === undefined) return null;
    const bookmark = validateContextBookmark(raw);
    if (bookmark.key !== key) throw new ContextBookmarkError('invalid-record', '收藏标识与保存内容不一致。');
    return bookmark;
  }
  async list(): Promise<ContextBookmarkList> {
    this.assertOpen(); await this.tail;
    const database = await this.open(false);
    if (!database) return Object.freeze({ entries: Object.freeze([]), unreadableCount: 0 });
    return new Promise<ContextBookmarkList>((resolve, reject) => {
      const tx = database.transaction(CONTEXT_BOOKMARK_STORE_NAME, 'readonly'), request = tx.objectStore(CONTEXT_BOOKMARK_STORE_NAME).openCursor();
      const entries: ContextBookmark[] = []; let unreadableCount = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        try {
          const bookmark = validateContextBookmark(cursor.value);
          if (cursor.primaryKey !== bookmark.key) throw new ContextBookmarkError('invalid-record', '收藏标识不一致。');
          entries.push(bookmark);
        } catch { unreadableCount++; }
        cursor.continue();
      };
      tx.oncomplete = () => resolve(Object.freeze({ entries: Object.freeze(entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.key.localeCompare(b.key))), unreadableCount }));
      tx.onerror = tx.onabort = () => reject(tx.error ?? storageError('收藏列表读取失败，不能据此显示为空。'));
    });
  }
  async load(key: string): Promise<ContextBookmark | null> {
    this.assertOpen(); validKey(key); await this.tail;
    const database = await this.open(false);
    return database ? this.readRecord(database, key) : null;
  }
  save(reference: ContextBookmarkReference, start: number, end: number): Promise<ContextBookmarkSaveResult> {
    let captured: ContextBookmark;
    try { this.assertOpen(); captured = createContextBookmark(reference, start, end, this.now(), this.createId()); } catch (error) { return Promise.reject(error); }
    const write = this.tail.then(async () => {
      const database = (await this.open(true))!;
      const receipt = await new Promise<ContextBookmarkSaveResult>((resolve, reject) => {
        const tx = database.transaction(CONTEXT_BOOKMARK_STORE_NAME, 'readwrite'), store = tx.objectStore(CONTEXT_BOOKMARK_STORE_NAME);
        let result: ContextBookmarkSaveResult | null = null, failure: unknown;
        const request = store.get(captured.key);
        request.onsuccess = () => {
          try {
            if (request.result !== undefined) {
              let existing: ContextBookmark;
              try { existing = validateContextBookmark(request.result); } catch { throw new ContextBookmarkError('storage-conflict', '相同标识已有不可读取的收藏，未覆盖原数据。'); }
              if (existing.key !== captured.key) throw new ContextBookmarkError('storage-conflict', '收藏标识冲突，未覆盖原数据。');
              result = { bookmark: existing, disposition: 'already-present' };
            } else {
              // The read and add share one serialized IDB transaction, making
              // simultaneous same-key saves in different tabs idempotent.
              store.add(captured);
              result = { bookmark: captured, disposition: 'saved' };
            }
          } catch (error) { failure = error; tx.abort(); }
        };
        tx.oncomplete = () => result ? resolve(Object.freeze(result)) : reject(storageError('收藏事务未返回可核验结果。'));
        tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? storageError('收藏事务未提交，尚未保存。'));
      });
      if (receipt.disposition === 'saved') this.notify(true);
      // A request success is insufficient: first wait for commit, then read the
      // actual stored value. Concurrent removal/corruption is an explicit error.
      const stored = await this.readRecord(database, captured.key);
      if (!stored || !equalRecord(stored, receipt.bookmark)) throw new ContextBookmarkError('storage-conflict', '收藏在提交后发生变化，请重新读取列表确认。');
      return Object.freeze({ bookmark: stored, disposition: receipt.disposition });
    });
    this.tail = write.then(() => {}, () => {});
    return write;
  }
  remove(key: string, expectedSaveId: string): Promise<boolean> {
    try {
      this.assertOpen(); validKey(key);
      if (typeof expectedSaveId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(expectedSaveId))
        throw new ContextBookmarkError('invalid-record', '取消收藏需要当前保存身份，请刷新后重试。');
    } catch (error) { return Promise.reject(error); }
    const write = this.tail.then(async () => {
      const database = await this.open(false);
      if (!database) return false;
      const removed = await new Promise<boolean>((resolve, reject) => {
        const tx = database.transaction(CONTEXT_BOOKMARK_STORE_NAME, 'readwrite'), store = tx.objectStore(CONTEXT_BOOKMARK_STORE_NAME);
        let existed = false, failure: unknown;
        const request = store.get(key);
        request.onsuccess = () => {
          try {
            if (request.result !== undefined) {
              let current: ContextBookmark;
              try { current = validateContextBookmark(request.result); } catch { throw new ContextBookmarkError('storage-conflict', '收藏内容已变化或不可读取，未删除，请刷新后核对。'); }
              // Compare and delete in this same serialized transaction. A stale
              // tab cannot remove another tab's freshly re-created incarnation.
              if (current.key !== key || current.saveId !== expectedSaveId) throw new ContextBookmarkError('storage-conflict', '收藏已被另一页面重新保存，未删除新记录，请刷新后核对。');
              existed = true; store.delete(key);
            }
          } catch (error) { failure = error; tx.abort(); }
        };
        tx.oncomplete = () => resolve(existed);
        tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? storageError('移除收藏未提交，请重新读取确认。'));
      });
      if (removed) this.notify(true);
      // Another tab may already have explicitly saved it again. Never report
      // that the current record is gone when a readback proves otherwise.
      if (await this.readRecord(database, key)) throw new ContextBookmarkError('storage-conflict', '另一页面已重新保存此收藏，请重新读取列表。');
      return removed;
    });
    this.tail = write.then(() => {}, () => {});
    return write;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.channel?.close(); this.channel = null; this.listeners.clear();
    await this.tail;
    if (this.opening) { try { await this.opening; } catch { /* The opening error remains with its operation. */ } }
    this.database?.close(); this.database = null;
  }
}
