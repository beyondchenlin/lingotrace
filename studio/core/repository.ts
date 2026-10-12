import { replay, validateSnapshot, type TrainingSnapshot } from './training.ts';

export interface PersistenceStatus {
  readonly state: 'in-memory' | 'pending' | 'persisted' | 'error';
  readonly pendingWrites: number;
  readonly lastPersistedSessionId: string | null;
  readonly lastPersistedSequence: number | null;
  readonly error: string | null;
}
interface StoredSession { sessionId: string; sequence: number; snapshot: TrainingSnapshot; updatedAt: string }
interface RepositoryOptions { dbName?: string; indexedDB?: IDBFactory }
/** IndexedDB only. Failure leaves the engine usable and exportable, never falsely "saved". */
export class IndexedDBTrainingRepository {
  private factory: IDBFactory | undefined;
  private dbName: string;
  private database: Promise<IDBDatabase> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private status: PersistenceStatus = Object.freeze({ state: 'in-memory', pendingWrites: 0, lastPersistedSessionId: null, lastPersistedSequence: null, error: null });
  constructor(options: RepositoryOptions = {}) {
    this.dbName = options.dbName ?? 'lingotrace-studio-v1';
    try { this.factory = options.indexedDB ?? globalThis.indexedDB; } catch { this.factory = undefined; }
  }
  getStatus = (): PersistenceStatus => this.status;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<PersistenceStatus>): void {
    this.status = Object.freeze({ ...this.status, ...patch });
    for (const listener of this.listeners) listener();
  }
  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise<IDBDatabase>((resolve, reject) => {
      if (!this.factory) { reject(new Error('IndexedDB is unavailable. This session remains in memory; export JSON/CSV to keep it.')); return; }
      const request = this.factory.open(this.dbName, 1);
      let rejected = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'sessionId' });
        if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: ['sessionId', 'eventId'] });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onerror = () => { rejected = true; reject(request.error ?? new Error('Could not open IndexedDB.')); };
      request.onblocked = () => { rejected = true; reject(new Error('Database upgrade is blocked by another tab. Close older tabs and retry saving, or export this session.')); };
      request.onsuccess = () => {
        if (rejected) { request.result.close(); return; }
        const db = request.result;
        db.onversionchange = () => { db.close(); this.database = null; };
        resolve(db);
      };
    }).catch(error => { this.database = null; throw error; });
    return this.database;
  }
  async loadLatest(): Promise<TrainingSnapshot | null> {
    // A refresh restore must not race an earlier queued save in this repository.
    await this.queue;
    try {
      const db = await this.open();
      const record = await new Promise<StoredSession | null>((resolve, reject) => {
        const transaction = db.transaction(['sessions', 'meta'], 'readonly');
        let value: StoredSession | null = null;
        const latest = transaction.objectStore('meta').get('latest');
        latest.onsuccess = () => {
          if (!latest.result?.sessionId) return;
          const session = transaction.objectStore('sessions').get(latest.result.sessionId);
          session.onsuccess = () => { value = session.result ?? null; };
        };
        transaction.oncomplete = () => resolve(value);
        transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('Could not restore the saved session.'));
      });
      if (!record) return null;
      const snapshot = replay(record.snapshot.events, record.snapshot.material);
      if (snapshot.sessionId !== record.sessionId || snapshot.sequence !== record.sequence) throw new Error('Saved session metadata does not match its event log.');
      this.update({ state: this.status.pendingWrites ? 'pending' : 'persisted', lastPersistedSessionId: snapshot.sessionId, lastPersistedSequence: snapshot.sequence, error: null });
      return snapshot;
    } catch (error) {
      this.update({ state: 'error', error: errorText(error) });
      throw error;
    }
  }
  /** Serial writes; a single transaction stores the event log, snapshot, and latest pointer. */
  saveSession(snapshot: TrainingSnapshot): Promise<void> {
    let captured: TrainingSnapshot;
    try { captured = validateSnapshot(snapshot); }
    catch (error) { this.update({ state: 'error', error: errorText(error) }); return Promise.reject(error); }
    this.update({ state: 'pending', pendingWrites: this.status.pendingWrites + 1, error: null });
    const write = this.queue.then(async () => {
      const db = await this.open();
      const stored = await new Promise<StoredSession>((resolve, reject) => {
        const transaction = db.transaction(['sessions', 'events', 'meta'], 'readwrite');
        const sessions = transaction.objectStore('sessions');
        let result: StoredSession;
        let failure: Error | null = null;
        const existing = sessions.get(captured.sessionId);
        existing.onsuccess = () => {
          try {
            const previous: StoredSession | undefined = existing.result;
            if (previous) {
              const shared = Math.min(previous.snapshot.events.length, captured.events.length);
              for (let i = 0; i < shared; i++) {
                if (JSON.stringify(previous.snapshot.events[i]) !== JSON.stringify(captured.events[i])) throw new Error('This session was changed in another tab. Export this in-memory session before starting a new round.');
              }
              if (previous.sequence >= captured.sequence) { result = previous; return; }
            }
            result = { sessionId: captured.sessionId, sequence: captured.sequence, snapshot: captured, updatedAt: new Date().toISOString() };
            const events = transaction.objectStore('events');
            // The reducer deduplicates IDs; the composite key also enforces one record per session/event.
            for (const event of captured.events.slice(previous?.snapshot.events.length ?? 0)) events.add(event);
            sessions.put(result);
            transaction.objectStore('meta').put({ key: 'latest', sessionId: captured.sessionId });
          } catch (error) { failure = error instanceof Error ? error : new Error(String(error)); transaction.abort(); }
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Session save failed; the in-memory session can still be exported.'));
      });
      this.update({ pendingWrites: this.status.pendingWrites - 1, state: this.status.pendingWrites > 1 ? 'pending' : 'persisted',
        lastPersistedSessionId: stored.sessionId, lastPersistedSequence: stored.sequence, error: null });
    }).catch(error => {
      this.update({ pendingWrites: Math.max(0, this.status.pendingWrites - 1), state: 'error', error: errorText(error) });
      throw error;
    });
    // A failed write does not poison later retries. The caller's promise still rejects.
    this.queue = write.catch(() => {});
    return write;
  }
  async close(): Promise<void> { await this.queue; if (this.database) (await this.database).close(); this.database = null; }
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
