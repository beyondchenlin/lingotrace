import { LISTENING_PARTIAL_SCOPE_PREFIX, readPartialListeningScope, type PartialListeningScope, LISTENING_SESSION_VERSION, isListeningSessionRecord, readListeningSession, captureListeningScopeOptions, captureListeningConditions, assertTrainingPrefix, assertListeningSessionAppend, type ListeningSessionRecord, type ListeningSessionScopeOptions, type ListeningSessionPermit, type ListeningSessionAdmission, type ListeningConditionsRecord } from './listening-session.ts';
import type { ListeningConditions } from './listening-flow.ts';
import { LISTENING_HISTORY_PREFIX, readListeningHistory, listeningHistoryIdentity, type ListeningHistoryRecord, type ListeningHistoryPermit, type ListeningHistoryAdmission, type ListeningHistoryPersistenceStatus } from './listening-history.ts';
import * as reviewStorage from './review-task-storage.ts';
import type { ReviewStorageHost, ReviewWriteGuard } from './review-task-storage.ts';
import { ReviewTaskError, captureReviewSession, type ReviewSessionBinding, type ReviewSessionLocator, type CreateReviewTaskOptions, type ChangeReviewTaskOptions, type PrepareReviewRetestOptions, type BindReviewSessionOptions, type CommitReviewResultOptions } from './review-tasks.ts';
import { replay, validateSnapshot, validateTrainingProfile, type TrainingSnapshot } from './training.ts';
import { assertWritableTrainingHistorySegment, TRAINING_HISTORY_SEGMENT_VERSION, type TrainingHistorySegment } from './training-history-segment.ts';
import {
  LEGACY_HISTORY_SOURCE, LEGACY_HISTORY_LIMIT, LegacyHistoryError, readLegacyHistoryRecord,
  legacyHistoryEntry, freezeLegacyHistory, legacyHistoryIdentity,
  type LegacyHistoryList, type LegacyHistoryEntry, type LegacyHistorySession, type LegacyHistoryCursor,
} from './legacy-history.ts';
import {
  AUTOMATIC_HISTORY_CONTROL_KEY, AUTOMATIC_HISTORY_UNSAVED_MESSAGE, AutomaticHistoryWriteFenceError, HistoryWriterBarrierBlockedError,
  readAutomaticHistoryControl, automaticHistoryOffRecord, automaticHistorySegmentRecord,
  type AutomaticHistoryControl, type AutomaticHistoryStatus,
} from './automatic-history-control.ts';

export interface PersistenceStatus {
  readonly state: 'in-memory' | 'pending' | 'persisted' | 'error';
  readonly pendingWrites: number;
  readonly lastPersistedSessionId: string | null;
  readonly lastPersistedSequence: number | null;
  readonly error: string | null;
}
interface StoredSession { sessionId: string; sequence: number; snapshot: TrainingSnapshot; updatedAt: string }
/** The shared store also contains fenced listening envelopes. Only a fully
 * validated envelope belongs outside the Training-only history partition. */
function trainingHistoryEntry(value: unknown, key: IDBValidKey): LegacyHistoryEntry | null {
  if (!isListeningSessionRecord(value)) return legacyHistoryEntry(value, key);
  try {
    if (typeof key !== 'string') throw new Error('Invalid listening session key.');
    readListeningSession(value, key);
    return null;
  } catch {
    const row = value as { updatedAt?: unknown };
    const updatedAt = typeof row.updatedAt === 'string' && Number.isFinite(Date.parse(row.updatedAt)) ? row.updatedAt : null;
    return freezeLegacyHistory({ status: 'error', source: LEGACY_HISTORY_SOURCE,
      sessionId: typeof key === 'string' ? key : null, updatedAt,
      error: { code: 'invalid-record', message: 'Saved listening history could not be validated. The record was not changed.' } });
  }
}
interface RepositoryOptions { dbName?: string; indexedDB?: IDBFactory }
export const TRAINING_HISTORY_SEGMENT_KEY_PREFIX = 'training-history-segment:';
declare const segmentPermitBrand: unique symbol;
/** Only this repository instance's WeakMap can authenticate a permit. */
export type TrainingHistorySegmentPermit = Readonly<{ [segmentPermitBrand]: true }>;
export interface TrainingHistorySegmentAdmission { readonly permit: TrainingHistorySegmentPermit; readonly segment: TrainingHistorySegment }
interface SegmentPermitState {
  epoch: number; generation: number; segmentId: string; metadataIdentity: string; admitted: boolean; revoked: boolean;
}
interface StoredTrainingHistorySegment { key: string; version: 1; segment: TrainingHistorySegment; updatedAt: string }
export interface TrainingHistorySegmentSummary {
  readonly segmentId: string; readonly sessionId: string; readonly generation: number;
  readonly startedAt: string; readonly endedAt: string | null; readonly updatedAt: string;
  readonly factCount: number; readonly coverage: 'partial'; readonly replayable: false;
}
export interface TrainingHistorySegmentCursor { readonly version: 1; readonly startedAtMs: number; readonly segmentId: string }
export interface TrainingHistorySegmentList {
  readonly entries: readonly TrainingHistorySegmentSummary[]; readonly limit: number; readonly hasMore: boolean;
  readonly nextCursor: TrainingHistorySegmentCursor | null;
}

/** IndexedDB only. Failure leaves the engine usable and exportable, never falsely "saved". */
export class IndexedDBTrainingRepository {
  private factory: IDBFactory | undefined;
  private dbName: string;
  private database: Promise<IDBDatabase> | null = null;
  private versionBarrierBlocked = false;
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private automaticHistoryEpoch = 0;
  private closed = false;
  private segmentGeneration: number | null = null;
  private legacySnapshotWritesAllowed = true;
  private settingOperation = 0;
  private lastOffExpectedGeneration: number | undefined;
  private hasOffRequest = false;
  private automaticHistoryStatus: AutomaticHistoryStatus = Object.freeze({ locallyStopped: false, settingsState: 'not-requested', persistedGeneration: null, error: null, message: null });
  private disablingAutomaticHistory: Promise<AutomaticHistoryControl> | null = null;
  private activeAutomaticWrites = new Map<IDBTransaction, () => void>();
  private segmentPermits = new WeakMap<TrainingHistorySegmentPermit, SegmentPermitState>();
  private activeSegmentWrites = new Map<IDBTransaction, TrainingHistorySegmentPermit>();
  private segmentAdmissions = new Map<string, { identity: string; permit: TrainingHistorySegmentPermit; promise: Promise<TrainingHistorySegmentAdmission> }>();
  private listeningHistoryStatus: ListeningHistoryPersistenceStatus = Object.freeze({ state: 'in-memory', pendingWrites: 0, observationId: null, revision: null, error: null });
  getListeningHistoryStatus = (): ListeningHistoryPersistenceStatus => this.listeningHistoryStatus;
  private updateListeningHistory(patch: Partial<ListeningHistoryPersistenceStatus>): void { this.listeningHistoryStatus = Object.freeze({ ...this.listeningHistoryStatus, ...patch }); this.notify(); }
  private listeningSessionPermits = new WeakMap<ListeningSessionPermit, { epoch: number; sessionId: string; scopeId: string; admitted: boolean; revoked: boolean }>();
  private activeListeningSessionWrites = new Map<IDBTransaction, ListeningSessionPermit>();
  private listeningPermits = new WeakMap<ListeningHistoryPermit, { epoch: number; generation: number; identity: string; admitted: boolean; revoked: boolean }>();
  private activeListeningWrites = new Map<IDBTransaction, ListeningHistoryPermit>();
  private reviewSessionEpoch = 0;
  private reviewBindingAuthority = new WeakMap<ReviewSessionBinding, { epoch: number; reviewEpoch: number }>();
  private activeReviewWrites = new Set<IDBTransaction>();
  private status: PersistenceStatus = Object.freeze({ state: 'in-memory', pendingWrites: 0, lastPersistedSessionId: null, lastPersistedSequence: null, error: null });
  constructor(options: RepositoryOptions = {}) {
    this.dbName = options.dbName ?? 'lingotrace-studio-v1';
    try { this.factory = options.indexedDB ?? globalThis.indexedDB; } catch { this.factory = undefined; }
  }
  getStatus = (): PersistenceStatus => this.status;
  /** Local request status only. A future UI must read persisted control to show
   * another instance's OFF; every save checks it regardless of this status. */
  getAutomaticHistoryStatus = (): AutomaticHistoryStatus => this.automaticHistoryStatus;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<PersistenceStatus>): void {
    this.status = Object.freeze({ ...this.status, ...patch });
    this.notify();
  }
  private updateAutomaticHistory(patch: Partial<AutomaticHistoryStatus>): void {
    this.automaticHistoryStatus = Object.freeze({ ...this.automaticHistoryStatus, ...patch });
    this.notify();
  }
  private notify(): void {
    // Observers cannot cancel a reserved persistence operation or the OFF fence.
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* Keep the persistence boundary independent of observers. */ } }
  }
  private checkAutomaticHistoryEpoch(epoch: number): void {
    if (this.closed) throw new AutomaticHistoryWriteFenceError('closed');
    if (this.automaticHistoryStatus.locallyStopped || epoch !== this.automaticHistoryEpoch) throw new AutomaticHistoryWriteFenceError('local-off');
  }
  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise<IDBDatabase>((resolve, reject) => {
      if (!this.factory) { reject(new Error('IndexedDB is unavailable. This session remains in memory; export JSON/CSV to keep it.')); return; }
      const request = this.factory.open(this.dbName);
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
        if (![1, 2].includes(db.version) || !['sessions', 'events', 'meta'].every(name => db.objectStoreNames.contains(name))) {
          db.close(); reject(new Error('The saved practice database version is not supported.')); return;
        }
        db.onversionchange = () => { db.close(); this.database = null; };
        resolve(db);
      };
    }).catch(error => { this.database = null; throw error; });
    return this.database;
  }
  /** Connection fence only: no store, index or retained value is transformed.
   * v41 and earlier explicitly open version 1. Once this upgrade commits their
   * old connections are closed and reopen attempts cannot write at version 1. */
  private async ensureHistoryWriterBarrier(): Promise<void> {
    if (this.versionBarrierBlocked) throw new HistoryWriterBarrierBlockedError();
    if (this.closed) throw new AutomaticHistoryWriteFenceError('closed');
    if (this.database) {
      const connection = await this.database;
      if (connection.version === 2) return;
      connection.close(); this.database = null;
    }
    if (!this.factory) throw new Error('IndexedDB is unavailable.');
    await new Promise<void>((resolve, reject) => {
      const request = this.factory!.open(this.dbName, 2);
      let rejected = false;
      request.onblocked = () => {
        rejected = true; this.versionBarrierBlocked = true;
        reject(new HistoryWriterBarrierBlockedError());
      };
      request.onupgradeneeded = event => {
        // A rejected open request cannot be canceled. It may reach this callback
        // later; it must not silently install a version barrier after failure.
        if (rejected || this.closed) { request.transaction!.abort(); return; }
        const db = request.result;
        if (event.oldVersion === 0) {
          db.createObjectStore('sessions', { keyPath: 'sessionId' });
          db.createObjectStore('events', { keyPath: ['sessionId', 'eventId'] });
          db.createObjectStore('meta', { keyPath: 'key' });
        } else if (event.oldVersion !== 1 || !['sessions', 'events', 'meta'].every(name => db.objectStoreNames.contains(name))) request.transaction!.abort();
      };
      request.onerror = () => {
        this.versionBarrierBlocked = false;
        if (!rejected) reject(request.error ?? new Error('History connection protection could not be installed.'));
      };
      request.onsuccess = () => {
        this.versionBarrierBlocked = false;
        const db = request.result;
        const valid = db.version === 2 && ['sessions', 'events', 'meta'].every(name => db.objectStoreNames.contains(name));
        db.close();
        if (rejected) return;
        if (this.closed || !valid) { reject(new Error('History connection protection could not be verified.')); return; }
        resolve();
      };
    });
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
      // Replay derives its profile from the material. Admit the stored profile
      // first so corrupt/mixed records cannot be silently normalized on restore.
      validateTrainingProfile(record.snapshot);
      const first = record.snapshot.events[0];
      if (!first || first.type !== 'sessionStarted' || first.schemaVersion !== record.snapshot.schemaVersion) throw new Error('Saved snapshot profile does not match its first event.');
      validateTrainingProfile(first);
      const snapshot = replay(record.snapshot.events, record.snapshot.material);
      if (snapshot.sessionId !== record.sessionId || snapshot.sequence !== record.sequence) throw new Error('Saved session metadata does not match its event log.');
      this.update({ state: this.status.pendingWrites ? 'pending' : 'persisted', lastPersistedSessionId: snapshot.sessionId, lastPersistedSequence: snapshot.sequence, error: null });
      return snapshot;
    } catch (error) {
      this.update({ state: 'error', error: errorText(error) });
      throw error;
    }
  }
  /** A separate, short-lived connection prevents a history read from creating or
   * upgrading storage. In particular, do not reuse open()'s schema initializer. */
  private openHistory(): Promise<IDBDatabase | null> {
    return new Promise((resolve, reject) => {
      if (this.versionBarrierBlocked) { reject(new LegacyHistoryError('read-failed', 'Close the older blocking practice tabs before reading saved history.')); return; }
      if (!this.factory) { reject(new LegacyHistoryError('read-failed', 'IndexedDB is unavailable; saved history cannot be read.')); return; }
      let absent = false, rejected = false;
      const request = this.factory.open(this.dbName);
      request.onupgradeneeded = () => { absent = true; request.transaction!.abort(); };
      request.onerror = () => {
        if (absent) resolve(null);
        else reject(new LegacyHistoryError('read-failed', 'The saved history database could not be opened.'));
      };
      request.onblocked = () => { rejected = true; reject(new LegacyHistoryError('read-failed', 'Saved history is blocked by another database connection.')); };
      request.onsuccess = () => {
        const db = request.result;
        if (rejected) { db.close(); return; }
        if (![1, 2].includes(db.version) || !['sessions', 'events', 'meta'].every(name => db.objectStoreNames.contains(name))) {
          db.close(); reject(new LegacyHistoryError('unsupported-schema', 'The saved history database schema is not supported.')); return;
        }
        db.onversionchange = () => db.close(); resolve(db);
      };
    });
  }
  /** Pages ordered by stored updatedAt descending, then actual primary key ascending.
   * v1 has no date index: scan readonly, retaining at most limit summaries.
   * A boundary survives deletion of its record. Pages are not a shared snapshot:
   * newly saved/updated records moving before the boundary require a refresh.
   * Missing/invalid dates sort last; malformed records remain separate entries. */
  async listHistory(options: { limit?: number; after?: LegacyHistoryCursor | null } = {}): Promise<LegacyHistoryList> {
    const limit = options.limit ?? LEGACY_HISTORY_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > LEGACY_HISTORY_LIMIT) throw new LegacyHistoryError('invalid-query', 'History limit must be an integer from 1 to 100.');
    // Capture and validate even mutable Date/binary/array keys before any await.
    const after = captureHistoryCursor(options.after, this.factory);
    await this.queue;
    let db: IDBDatabase | null = null;
    try {
      db = await this.openHistory();
      if (!db) return freezeLegacyHistory({ source: LEGACY_HISTORY_SOURCE, entries: [], limit, hasMore: false, nextCursor: null });
      return await new Promise<LegacyHistoryList>((resolve, reject) => {
        const transaction = db!.transaction('sessions', 'readonly');
        const retained: { position: LegacyHistoryCursor; entry: LegacyHistoryEntry }[] = [];
        const compare = (a: LegacyHistoryCursor, b: LegacyHistoryCursor) => compareHistoryPositions(a, b, this.factory!);
        let count = 0, failure: unknown;
        const request = transaction.objectStore('sessions').openCursor();
        request.onsuccess = () => {
          try {
            const cursor = request.result; if (!cursor) return;
            const value: unknown = cursor.value, position = historyPosition(value, cursor.primaryKey);
            if (!after || compare(position, after) > 0) {
              const entry = isListeningSessionRecord(value) ? trainingHistoryEntry(value, cursor.primaryKey) : undefined;
              if (entry === null) { cursor.continue(); return; }
              count++;
              const insertion = retained.findIndex(item => compare(position, item.position) < 0);
              if (retained.length < limit || insertion !== -1) {
                if (retained.length === limit) retained.pop();
                retained.splice(insertion === -1 ? retained.length : insertion, 0, { position, entry: entry ?? legacyHistoryEntry(value, position.key) });
              }
            }
            cursor.continue();
          } catch (error) { failure = error; transaction.abort(); }
        };
        transaction.oncomplete = () => {
          const hasMore = count > limit;
          // Freeze the envelope separately: valid IDB keys include mutable Dates
          // and binary buffers, which cannot all be deeply frozen. Each use clones.
          const nextCursor = hasMore ? Object.freeze(structuredClone(retained[retained.length - 1].position)) : null;
          resolve(freezeLegacyHistory({ source: LEGACY_HISTORY_SOURCE, entries: retained.map(item => item.entry), limit, hasMore, nextCursor }));
        };
        transaction.onerror = transaction.onabort = () => reject(failure ?? new LegacyHistoryError('read-failed', 'Saved history could not be listed.'));
      });
    } catch (error) { throw historyReadError(error); }
    finally { db?.close(); }
  }
  /** Read the stored snapshot verbatim, never restore it into the live engine. */
  async loadHistorySession(sessionId: string): Promise<LegacyHistorySession | null> {
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw new LegacyHistoryError('invalid-query', 'A saved session ID is required.');
    await this.queue;
    let db: IDBDatabase | null = null;
    try {
      db = await this.openHistory(); if (!db) return null;
      return await new Promise<LegacyHistorySession | null>((resolve, reject) => {
        const transaction = db!.transaction('sessions', 'readonly');
        let result: LegacyHistorySession | null = null, failure: unknown;
        const request = transaction.objectStore('sessions').get(sessionId);
        request.onsuccess = () => {
          try { if (request.result !== undefined) result = readLegacyHistoryRecord(request.result, sessionId); }
          catch (error) { failure = error; transaction.abort(); }
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = transaction.onabort = () => reject(failure ?? new LegacyHistoryError('read-failed', 'The selected saved session could not be read.'));
      });
    } catch (error) { throw historyReadError(error); }
    finally { db?.close(); }
  }
  /** Final export handoff under a readonly sessions transaction. A concurrent
   * writer cannot commit deletion/change between the recheck and synchronous sink.
   * The caller formats before this call and keeps its own selection/close gate.
   * This is only a stale-record guard, not integrated Practice privacy controls. */
  async deliverHistorySession(sessionId: string, expectedSnapshot: TrainingSnapshot, synchronousSink: () => void): Promise<void> {
    if (typeof sessionId !== 'string' || !sessionId.trim() || expectedSnapshot?.sessionId !== sessionId) throw new LegacyHistoryError('invalid-query', 'The selected saved session ID must match the export snapshot.');
    if (typeof synchronousSink !== 'function' || Object.prototype.toString.call(synchronousSink) === '[object AsyncFunction]') throw new LegacyHistoryError('invalid-sink', 'History export requires a synchronous sink.');
    // Capture before awaiting, so caller mutation cannot change the expected boundary.
    const expected = readLegacyHistoryRecord({ sessionId, sequence: expectedSnapshot.sequence, snapshot: expectedSnapshot, updatedAt: expectedSnapshot.createdAt }, sessionId);
    const identity = legacyHistoryIdentity(expected.snapshot);
    await this.queue;
    let db: IDBDatabase | null = null;
    try {
      db = await this.openHistory();
      if (!db) throw new LegacyHistoryError('stale-record', 'The selected saved session no longer exists. Reload history before exporting.');
      await new Promise<void>((resolve, reject) => {
        const transaction = db!.transaction('sessions', 'readonly'); let failure: unknown;
        const request = transaction.objectStore('sessions').get(sessionId);
        request.onsuccess = () => {
          try {
            if (request.result === undefined) throw new LegacyHistoryError('stale-record', 'The selected saved session no longer exists. Reload history before exporting.');
            const current = readLegacyHistoryRecord(request.result, sessionId);
            if (legacyHistoryIdentity(current.snapshot) !== identity) throw new LegacyHistoryError('stale-record', 'The selected saved session changed. Reload history before exporting.');
            const returned = synchronousSink() as unknown;
            if (returned !== null && (typeof returned === 'object' || typeof returned === 'function') && typeof (returned as { then?: unknown }).then === 'function') {
              void Promise.resolve(returned).catch(() => {});
              throw new LegacyHistoryError('invalid-sink', 'History export sink returned a Promise; it must finish synchronously.');
            }
          } catch (error) { failure = error; transaction.abort(); }
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(failure ?? new LegacyHistoryError('read-failed', 'The selected saved session could not be checked before export.'));
      });
    } catch (error) { throw historyReadError(error); }
    finally { db?.close(); }
  }
  /** Candidate inspection only: no schema creation, restoration, permission
   * change, notification, or clearing of save/configuration errors. */
  async readAutomaticHistoryControl(): Promise<AutomaticHistoryControl> {
    await this.queue;
    let db: IDBDatabase | null = null;
    try {
      db = await this.openHistory();
      if (!db) return readAutomaticHistoryControl(undefined);
      return await new Promise<AutomaticHistoryControl>((resolve, reject) => {
        const transaction = db!.transaction('meta', 'readonly');
        let result: AutomaticHistoryControl, failure: unknown;
        const request = transaction.objectStore('meta').get(AUTOMATIC_HISTORY_CONTROL_KEY);
        request.onsuccess = () => {
          try { result = readAutomaticHistoryControl(request.result); }
          catch (error) { failure = error; transaction.abort(); }
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Automatic history settings could not be read.'));
      });
    } finally { db?.close(); }
  }
  /** Local permission is revoked synchronously. Updated peer tabs are fenced
   * after the meta transaction commits. The preceding version barrier separately
   * fences published pre-feature writers that ignore the metadata control. */
  private revokeAutomaticHistory(): void {
    this.automaticHistoryEpoch++;
    this.segmentGeneration = null;
    this.legacySnapshotWritesAllowed = false;
    this.automaticHistoryStatus = Object.freeze({ ...this.automaticHistoryStatus, locallyStopped: true });
    for (const abort of [...this.activeAutomaticWrites.values()]) abort();
  }
  disableAutomaticHistory(): Promise<void>;
  disableAutomaticHistory(expectedGeneration: number): Promise<AutomaticHistoryControl>;
  disableAutomaticHistory(expectedGeneration?: number): Promise<void | AutomaticHistoryControl> {
    // Preserve the original OFF-only caller's idempotent in-flight promise.
    if (this.disablingAutomaticHistory && expectedGeneration === this.lastOffExpectedGeneration) return this.disablingAutomaticHistory;
    this.revokeAutomaticHistory();
    this.lastOffExpectedGeneration = expectedGeneration;
    this.hasOffRequest = true;
    const operation = ++this.settingOperation;
    const disabling = this.queue.then(async () => {
      if (this.closed) throw new AutomaticHistoryWriteFenceError('closed');
      const control = await this.writeAutomaticHistorySetting(false, expectedGeneration);
      if (operation === this.settingOperation) {
        this.disablingAutomaticHistory = null;
        this.updateAutomaticHistory({ settingsState: 'persisted', persistedGeneration: control.generation, error: null, message: '本页已停止，关闭设置已保存' });
      }
      return control;
    }).catch(error => {
      if (operation === this.settingOperation) {
        this.disablingAutomaticHistory = null;
        this.updateAutomaticHistory({ settingsState: 'not-persisted', error: errorText(error), message: AUTOMATIC_HISTORY_UNSAVED_MESSAGE });
      }
      throw error;
    });
    // Reserve before any listener can reenter with another toggle, read or save.
    this.disablingAutomaticHistory = disabling;
    this.queue = disabling.then(() => {}, () => {});
    this.updateAutomaticHistory({ settingsState: 'pending', error: null, message: '本页已停止，正在保存关闭设置' });
    return disabling;
  }
  retryDisableAutomaticHistory(): Promise<void> {
    if (!this.hasOffRequest || !this.automaticHistoryStatus.locallyStopped) return Promise.reject(new Error('No automatic history OFF request is available to retry.'));
    return this.lastOffExpectedGeneration === undefined ? this.disableAutomaticHistory() : this.disableAutomaticHistory(this.lastOffExpectedGeneration).then(() => {});
  }
  /** Explicit page intent, never called by a configuration read or refresh. A
   * successful enable still needs separate beginTrainingHistorySegment admission. */
  enableAutomaticHistory(expectedGeneration: number): Promise<AutomaticHistoryControl> {
    this.revokeAutomaticHistory();
    this.disablingAutomaticHistory = null;
    this.hasOffRequest = false;
    const epoch = this.automaticHistoryEpoch, operation = ++this.settingOperation;
    const enabling = this.queue.then(async () => {
      if (this.closed) throw new AutomaticHistoryWriteFenceError('closed');
      if (epoch !== this.automaticHistoryEpoch) throw new AutomaticHistoryWriteFenceError('local-off');
      const control = await this.writeAutomaticHistorySetting(true, expectedGeneration, epoch);
      if (epoch !== this.automaticHistoryEpoch || this.closed) throw new AutomaticHistoryWriteFenceError('local-off');
      this.segmentGeneration = control.generation;
      this.updateAutomaticHistory({ locallyStopped: false, settingsState: 'persisted', persistedGeneration: control.generation, error: null, message: '已开启，只记录此后新片段' });
      return control;
    }).catch(error => {
      if (operation === this.settingOperation) this.updateAutomaticHistory({ locallyStopped: true, settingsState: 'not-persisted', error: errorText(error), message: AUTOMATIC_HISTORY_UNSAVED_MESSAGE });
      throw error;
    });
    this.queue = enabling.then(() => {}, () => {});
    this.updateAutomaticHistory({ settingsState: 'pending', error: null, message: '本页已停止，正在保存开启设置' });
    return enabling;
  }
  private async writeAutomaticHistorySetting(enabled: boolean, expectedGeneration?: number, enableEpoch?: number): Promise<AutomaticHistoryControl> {
    await this.ensureHistoryWriterBarrier();
    const db = await this.open();
    if (this.closed) throw new AutomaticHistoryWriteFenceError('closed');
    if (enabled && enableEpoch !== this.automaticHistoryEpoch) throw new AutomaticHistoryWriteFenceError('local-off');
    return new Promise<AutomaticHistoryControl>((resolve, reject) => {
      const transaction = db.transaction('meta', 'readwrite');
      let result: AutomaticHistoryControl, failure: unknown;
      if (enabled) this.activeAutomaticWrites.set(transaction, () => {
        failure = new AutomaticHistoryWriteFenceError('local-off');
        try { transaction.abort(); } catch { /* Already committed before revocation. */ }
      });
      const meta = transaction.objectStore('meta'), request = meta.get(AUTOMATIC_HISTORY_CONTROL_KEY);
      request.onsuccess = () => {
        try {
          if (enabled && (enableEpoch !== this.automaticHistoryEpoch || this.closed)) throw new AutomaticHistoryWriteFenceError('local-off');
          const control = readAutomaticHistoryControl(request.result);
          const record = !enabled && expectedGeneration === undefined
            ? automaticHistoryOffRecord(control)
            : automaticHistorySegmentRecord(control, enabled, expectedGeneration!);
          result = readAutomaticHistoryControl(record);
          if (legacyHistoryIdentity(request.result) !== legacyHistoryIdentity(record)) meta.put(record);
        } catch (error) { failure = error; try { transaction.abort(); } catch { /* Already aborted by revocation. */ } }
      };
      transaction.oncomplete = () => { this.activeAutomaticWrites.delete(transaction); resolve(result); };
      transaction.onerror = transaction.onabort = () => {
        this.activeAutomaticWrites.delete(transaction);
        reject(failure ?? transaction.error ?? new Error('Automatic history setting was not saved.'));
      };
    });
  }
  /** The initial projection must be empty. There is no API for importing facts or
   * extending a pre-gap raw snapshot. Admission and control check share one lock. */
  beginTrainingHistorySegment(snapshot: TrainingHistorySegment, expectedGeneration: number): Promise<TrainingHistorySegmentAdmission> {
    let captured: TrainingHistorySegment;
    try {
      assertWritableTrainingHistorySegment(snapshot);
      captured = readTrainingHistorySegment(snapshot); // Authenticate before cloning; never retain caller objects across await.
      this.checkSegmentGeneration(expectedGeneration);
      if (captured.generation !== expectedGeneration || captured.facts.length || captured.endedAt !== null) throw new AutomaticHistoryWriteFenceError('invalid-permit');
      const prior = this.segmentAdmissions.get(captured.segmentId);
      if (prior) {
        const state = this.checkSegmentPermit(prior.permit, false);
        if (prior.identity !== legacyHistoryIdentity(captured)) throw new AutomaticHistoryWriteFenceError('invalid-permit');
        if (!state.admitted) return prior.promise;
        // Repeated completed admission rechecks durable generation and head; an
        // old receipt must not masquerade as a new admission after remote removal.
        return this.saveTrainingHistorySegment(prior.permit, snapshot).then(segment => {
          this.checkSegmentPermit(prior.permit);
          return Object.freeze({ permit: prior.permit, segment });
        });
      }
    } catch (error) { this.update({ state: 'error', error: errorText(error) }); return Promise.reject(error); }
    const permit = Object.freeze(Object.create(null)) as TrainingHistorySegmentPermit;
    const state: SegmentPermitState = { epoch: this.automaticHistoryEpoch, generation: expectedGeneration, segmentId: captured.segmentId,
      metadataIdentity: segmentMetadataIdentity(captured), admitted: false, revoked: false };
    this.segmentPermits.set(permit, state);
    // The queued function starts in a microtask; reserve the admission map before
    // notifications, so even a subscriber cannot admit the same ID twice.
    let pending = true;
    const promise = this.queue.then(async () => {
      this.checkSegmentPermit(permit, false);
      const db = await this.open();
      this.checkSegmentPermit(permit, false);
      const stored = await this.writeTrainingHistorySegment(db, permit, captured, true);
      this.checkSegmentPermit(permit, false);
      state.admitted = true;
      return stored;
    }).then(segment => {
      pending = false;
      this.segmentSaved(segment);
      // A status observer can request OFF synchronously while being notified.
      this.checkSegmentPermit(permit);
      return Object.freeze({ permit, segment });
    }).catch(error => {
      state.revoked = true;
      if (pending) this.segmentWriteFailed(error); else this.update({ state: 'error', error: errorText(error) });
      throw error;
    });
    this.segmentAdmissions.set(captured.segmentId, { identity: legacyHistoryIdentity(captured), permit, promise });
    this.queue = promise.then(() => {}, () => {});
    this.update({ state: 'pending', pendingWrites: this.status.pendingWrites + 1, error: null });
    return promise;
  }
  /** Every batch retains the generation and writer of its original admission.
   * A stale/revoked permit cannot recreate a missing segment head. */
  saveTrainingHistorySegment(permit: TrainingHistorySegmentPermit, snapshot: TrainingHistorySegment): Promise<TrainingHistorySegment> {
    let captured: TrainingHistorySegment;
    try {
      this.checkSegmentPermit(permit);
      assertWritableTrainingHistorySegment(snapshot);
      captured = readTrainingHistorySegment(snapshot);
      this.checkSegmentPermit(permit, true, captured);
    } catch (error) { this.update({ state: 'error', error: errorText(error) }); return Promise.reject(error); }
    const write = this.queue.then(async () => {
      this.checkSegmentPermit(permit, true, captured);
      const db = await this.open();
      this.checkSegmentPermit(permit, true, captured);
      return this.writeTrainingHistorySegment(db, permit, captured, false);
    }).then(segment => { this.segmentSaved(segment); return segment; }).catch(error => { this.segmentWriteFailed(error); throw error; });
    this.queue = write.then(() => {}, () => {});
    this.update({ state: 'pending', pendingWrites: this.status.pendingWrites + 1, error: null });
    return write;
  }
  /** Used immediately on detach/OFF. This changes no durable history or setting. */
  revokeTrainingHistorySegment(permit: TrainingHistorySegmentPermit): void {
    const state = this.segmentPermits.get(permit);
    if (!state || state.revoked) return;
    state.revoked = true;
    for (const [transaction, active] of this.activeSegmentWrites) if (active === permit) this.activeAutomaticWrites.get(transaction)?.();
  }
  private checkSegmentGeneration(generation: number): void {
    this.checkAutomaticHistoryEpoch(this.automaticHistoryEpoch);
    if (!Number.isSafeInteger(generation) || generation < 1 || generation !== this.segmentGeneration) throw new AutomaticHistoryWriteFenceError('stale-generation');
  }
  private checkSegmentPermit(permit: TrainingHistorySegmentPermit, admitted = true, segment?: TrainingHistorySegment): SegmentPermitState {
    const state = this.segmentPermits.get(permit);
    if (!state || state.revoked || (admitted && !state.admitted)) throw new AutomaticHistoryWriteFenceError('invalid-permit');
    this.checkAutomaticHistoryEpoch(state.epoch);
    this.checkSegmentGeneration(state.generation);
    if (segment && (segment.segmentId !== state.segmentId || segment.generation !== state.generation || segmentMetadataIdentity(segment) !== state.metadataIdentity)) throw new AutomaticHistoryWriteFenceError('invalid-permit');
    return state;
  }
  private segmentSaved(segment: TrainingHistorySegment): void {
    this.update({ pendingWrites: Math.max(0, this.status.pendingWrites - 1), state: this.status.pendingWrites > 1 ? 'pending' : 'persisted',
      lastPersistedSessionId: segment.sessionId, lastPersistedSequence: segment.facts.length, error: null });
  }
  private segmentWriteFailed(error: unknown): void {
    this.update({ pendingWrites: Math.max(0, this.status.pendingWrites - 1), state: 'error', error: errorText(error) });
  }
  private writeTrainingHistorySegment(db: IDBDatabase, permit: TrainingHistorySegmentPermit, captured: TrainingHistorySegment, initial: boolean): Promise<TrainingHistorySegment> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('meta', 'readwrite'), meta = transaction.objectStore('meta');
      let failure: unknown, result: TrainingHistorySegment;
      const abort = (error: unknown) => { failure = error; try { transaction.abort(); } catch { /* Revocation may already have aborted it. */ } };
      this.activeAutomaticWrites.set(transaction, () => abort(new AutomaticHistoryWriteFenceError('local-off')));
      this.activeSegmentWrites.set(transaction, permit);
      const cleanup = () => { this.activeAutomaticWrites.delete(transaction); this.activeSegmentWrites.delete(transaction); };
      transaction.oncomplete = () => { cleanup(); resolve(result); };
      transaction.onerror = transaction.onabort = () => { cleanup(); reject(failure ?? transaction.error ?? new Error('History segment was not saved.')); };
      try {
        this.checkSegmentPermit(permit, !initial, captured);
        const permission = meta.get(AUTOMATIC_HISTORY_CONTROL_KEY);
        permission.onsuccess = () => {
          try {
            this.checkSegmentPermit(permit, !initial, captured);
            assertSegmentControl(readAutomaticHistoryControl(permission.result), captured.generation);
            const existing = meta.get(segmentKey(captured.segmentId));
            existing.onsuccess = () => {
              try {
                this.checkSegmentPermit(permit, !initial, captured);
                if (initial) {
                  if (existing.result !== undefined) throw new AutomaticHistoryWriteFenceError('invalid-permit');
                  result = captured;
                  meta.add({ key: segmentKey(captured.segmentId), version: 1, segment: captured, updatedAt: new Date().toISOString() } satisfies StoredTrainingHistorySegment);
                } else {
                  if (existing.result === undefined) {
                    this.segmentPermits.get(permit)!.revoked = true;
                    throw new AutomaticHistoryWriteFenceError('invalid-permit');
                  }
                  const previous = readStoredSegment(existing.result, captured.segmentId).segment;
                  if (segmentMetadataIdentity(previous) !== segmentMetadataIdentity(captured)) throw new AutomaticHistoryWriteFenceError('invalid-permit');
                  const shared = Math.min(previous.facts.length, captured.facts.length);
                  for (let i = 0; i < shared; i++) if (legacyHistoryIdentity(previous.facts[i]) !== legacyHistoryIdentity(captured.facts[i])) throw new Error('The saved history segment changed. Its existing facts were preserved.');
                  // Older batches and exact retries never rewrite the stored row.
                  if (captured.facts.length < previous.facts.length || legacyHistoryIdentity(previous) === legacyHistoryIdentity(captured)) { result = previous; return; }
                  if (previous.endedAt !== null) {
                    if (captured.endedAt === null && captured.facts.length === previous.facts.length) { result = previous; return; }
                    throw new Error('A closed history segment cannot be extended or changed.');
                  }
                  result = captured;
                  meta.put({ key: segmentKey(captured.segmentId), version: 1, segment: captured, updatedAt: new Date().toISOString() } satisfies StoredTrainingHistorySegment);
                }
              } catch (error) { abort(error); }
            };
          } catch (error) { abort(error); }
        };
      } catch (error) { abort(error); }
    });
  }
  /** New partial history is read separately from v1 sessions. No replay, restore,
   * raw snapshot merge, schema upgrade, or persistence-status mutation occurs. */
  async listTrainingHistorySegments(options: { limit?: number; after?: TrainingHistorySegmentCursor | null } = {}): Promise<TrainingHistorySegmentList> {
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new LegacyHistoryError('invalid-query', 'Segment history limit must be an integer from 1 to 100.');
    const after = captureSegmentCursor(options.after);
    await this.queue;
    let db: IDBDatabase | null = null;
    try {
      db = await this.openHistory();
      if (!db) return freezeLegacyHistory({ entries: [], limit, hasMore: false, nextCursor: null });
      return await new Promise((resolve, reject) => {
        const transaction = db!.transaction('meta', 'readonly');
        const retained: TrainingHistorySegmentSummary[] = []; let count = 0, failure: unknown;
        const request = transaction.objectStore('meta').openCursor();
        request.onsuccess = () => {
          try {
            const cursor = request.result; if (!cursor) return;
            if (typeof cursor.primaryKey === 'string' && cursor.primaryKey.startsWith(TRAINING_HISTORY_SEGMENT_KEY_PREFIX)) {
              const row = readStoredSegment(cursor.value, cursor.primaryKey.slice(TRAINING_HISTORY_SEGMENT_KEY_PREFIX.length));
              const segment = row.segment;
              const summary: TrainingHistorySegmentSummary = { segmentId: segment.segmentId, sessionId: segment.sessionId, generation: segment.generation,
                startedAt: segment.startedAt, endedAt: segment.endedAt, updatedAt: row.updatedAt, factCount: segment.facts.length, coverage: 'partial', replayable: false };
              if (!after || compareSegmentPositions(segmentPosition(summary), after) > 0) {
                count++;
                const index = retained.findIndex(item => compareSegmentPositions(segmentPosition(summary), segmentPosition(item)) < 0);
                if (retained.length < limit || index !== -1) {
                  if (retained.length === limit) retained.pop();
                  retained.splice(index === -1 ? retained.length : index, 0, summary);
                }
              }
            }
            cursor.continue();
          } catch (error) { failure = error; transaction.abort(); }
        };
        transaction.oncomplete = () => resolve(freezeLegacyHistory({ entries: retained, limit, hasMore: count > limit, nextCursor: count > limit ? segmentPosition(retained[retained.length - 1]) : null }));
        transaction.onerror = transaction.onabort = () => reject(failure ?? new LegacyHistoryError('read-failed', 'History segments could not be listed.'));
      });
    } finally { db?.close(); }
  }
  async loadTrainingHistorySegment(segmentId: string): Promise<TrainingHistorySegment | null> {
    assertSegmentId(segmentId);
    await this.queue;
    let db: IDBDatabase | null = null;
    try {
      db = await this.openHistory(); if (!db) return null;
      return await new Promise((resolve, reject) => {
        const transaction = db!.transaction('meta', 'readonly'); let result: TrainingHistorySegment | null = null, failure: unknown;
        const request = transaction.objectStore('meta').get(segmentKey(segmentId));
        request.onsuccess = () => { try { if (request.result !== undefined) result = readStoredSegment(request.result, segmentId).segment; } catch (error) { failure = error; transaction.abort(); } };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = transaction.onabort = () => reject(failure ?? new LegacyHistoryError('read-failed', 'The selected history segment could not be read.'));
      });
    } finally { db?.close(); }
  }
  /** Final export rechecks exact segment identity/generation/existence under the
   * same readonly meta lock as the synchronous handoff. OFF does not hide history. */
  async deliverTrainingHistorySegment(segmentId: string, expectedSegment: TrainingHistorySegment, synchronousSink: () => void, expectedListeningScope: PartialListeningScope | null = null): Promise<void> {
    assertSegmentId(segmentId);
    const captured = readTrainingHistorySegment(expectedSegment), identity = legacyHistoryIdentity(captured);
    const capturedScope = expectedListeningScope === null ? null : readPartialListeningScope(expectedListeningScope);
    if (capturedScope && (capturedScope.segmentId !== segmentId || capturedScope.sessionId !== captured.sessionId || capturedScope.generation !== captured.generation)) throw new LegacyHistoryError('invalid-query', 'Listening scope does not match the selected segment.');
    if (captured.segmentId !== segmentId) throw new LegacyHistoryError('invalid-query', 'The segment ID must match the selected export.');
    if (typeof synchronousSink !== 'function' || Object.prototype.toString.call(synchronousSink) === '[object AsyncFunction]') throw new LegacyHistoryError('invalid-sink', 'History export requires a synchronous sink.');
    await this.queue;
    let db: IDBDatabase | null = null;
    try {
      db = await this.openHistory();
      if (!db) throw new LegacyHistoryError('stale-record', 'The selected history segment no longer exists.');
      await new Promise<void>((resolve, reject) => {
        const transaction = db!.transaction('meta', 'readonly'); let failure: unknown;
        const request = transaction.objectStore('meta').get(segmentKey(segmentId));
        request.onsuccess = () => {
          try {
            if (request.result === undefined) throw new LegacyHistoryError('stale-record', 'The selected history segment no longer exists.');
            const current = readStoredSegment(request.result, segmentId).segment;
            if (current.generation !== captured.generation || legacyHistoryIdentity(current) !== identity) throw new LegacyHistoryError('stale-record', 'The selected history segment changed. Reload history before exporting.');
            const scopeRequest = transaction.objectStore('meta').get(LISTENING_PARTIAL_SCOPE_PREFIX + segmentId);
            scopeRequest.onsuccess = () => {
              try {
                const currentScope = scopeRequest.result === undefined ? null : readStoredPartialListeningScope(scopeRequest.result, segmentId);
                if (legacyHistoryIdentity(currentScope) !== legacyHistoryIdentity(capturedScope)) throw new LegacyHistoryError('stale-record', 'Listening conditions changed or were omitted. Reload the complete segment before exporting.');
                const returned = synchronousSink() as unknown;
                if (returned !== null && (typeof returned === 'object' || typeof returned === 'function') && typeof (returned as { then?: unknown }).then === 'function') {
                  void Promise.resolve(returned).catch(() => {});
                  throw new LegacyHistoryError('invalid-sink', 'History export sink returned a Promise; it must finish synchronously.');
                }
              } catch (error) { failure = error; transaction.abort(); }
            };
          } catch (error) { failure = error; transaction.abort(); }
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(failure ?? new LegacyHistoryError('read-failed', 'The selected history segment could not be checked before export.'));
      });
    } finally { db?.close(); }
  }
  /** Serial writes; a single transaction stores the event log, snapshot, and latest pointer. */
  saveSession(snapshot: TrainingSnapshot): Promise<void> {
    const epoch = this.automaticHistoryEpoch;
    let captured: TrainingSnapshot;
    try {
      this.checkAutomaticHistoryEpoch(epoch);
      // A disappeared/corrupt setting can never restore raw-write permission on
      // a page that has already crossed a recording boundary.
      if (!this.legacySnapshotWritesAllowed) throw new AutomaticHistoryWriteFenceError('segment-mode');
      captured = validateSnapshot(snapshot);
    }
    catch (error) { this.update({ state: 'error', error: errorText(error) }); return Promise.reject(error); }
    const write = this.queue.then(async () => {
      this.checkAutomaticHistoryEpoch(epoch);
      const db = await this.open();
      this.checkAutomaticHistoryEpoch(epoch);
      const stored = await new Promise<StoredSession>((resolve, reject) => {
        const transaction = db.transaction(['sessions', 'events', 'meta'], 'readwrite');
        const sessions = transaction.objectStore('sessions');
        let result: StoredSession;
        let failure: Error | null = null;
        this.activeAutomaticWrites.set(transaction, () => {
          failure = new AutomaticHistoryWriteFenceError('local-off');
          try { transaction.abort(); } catch { /* A completed transaction has already committed before this OFF request. */ }
        });
        transaction.oncomplete = () => { this.activeAutomaticWrites.delete(transaction); resolve(result); };
        transaction.onerror = transaction.onabort = () => {
          this.activeAutomaticWrites.delete(transaction);
          reject(failure ?? transaction.error ?? new Error('Session save failed; the in-memory session can still be exported.'));
        };
        const abort = (error: unknown) => {
          failure = this.automaticHistoryStatus.locallyStopped || epoch !== this.automaticHistoryEpoch
            ? new AutomaticHistoryWriteFenceError('local-off')
            : error instanceof Error ? error : new Error(String(error));
          try { transaction.abort(); } catch { /* Preserve the original failure if OFF already aborted this transaction. */ }
        };
        try {
          this.checkAutomaticHistoryEpoch(epoch);
          // Read permission in the SAME transaction as all answer/event puts.
          // IDB's overlapping readwrite scopes serialize remote OFF commits.
          const permission = transaction.objectStore('meta').get(AUTOMATIC_HISTORY_CONTROL_KEY);
          permission.onsuccess = () => {
            try {
              this.checkAutomaticHistoryEpoch(epoch);
              const control = readAutomaticHistoryControl(permission.result);
              if (control.state === 'off') throw new AutomaticHistoryWriteFenceError('persisted-off');
              if (control.state !== 'legacy-default') throw new AutomaticHistoryWriteFenceError('segment-mode');
              const existing = sessions.get(captured.sessionId);
              existing.onsuccess = () => {
                try {
                  // No await between this generation recheck and the writes.
                  this.checkAutomaticHistoryEpoch(epoch);
                  if (isListeningSessionRecord(existing.result)) throw new Error('This session requires an atomic listening assistance save.');
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
                } catch (error) { abort(error); }
              };
            } catch (error) { abort(error); }
          };
        } catch (error) { abort(error); }
      });
      this.update({ pendingWrites: this.status.pendingWrites - 1, state: this.status.pendingWrites > 1 ? 'pending' : 'persisted',
        lastPersistedSessionId: stored.sessionId, lastPersistedSequence: stored.sequence, error: null });
    }).catch(error => {
      this.update({ pendingWrites: Math.max(0, this.status.pendingWrites - 1), state: 'error', error: errorText(error) });
      throw error;
    });
    // A failed write does not poison later retries. The caller's promise still rejects.
    this.queue = write.catch(() => {});
    this.update({ state: 'pending', pendingWrites: this.status.pendingWrites + 1, error: null });
    return write;
  }
  /** A partial marker carries no full snapshot, answer, pre-OFF evidence or complete-coverage claim. */
  beginPartialListeningScope(segmentId: string, options: ListeningSessionScopeOptions): Promise<PartialListeningScope> {
    let scope: ListeningSessionScopeOptions, permit: TrainingHistorySegmentPermit;
    try {
      scope = captureListeningScopeOptions(options); const admission = this.segmentAdmissions.get(segmentId);
      if (!admission) throw new AutomaticHistoryWriteFenceError('invalid-permit'); permit = admission.permit; this.checkSegmentPermit(permit);
    } catch (error) { return Promise.reject(error); }
    const operation = this.queue.then(async () => {
      this.checkSegmentPermit(permit); const db = await this.open(); this.checkSegmentPermit(permit);
      return new Promise<PartialListeningScope>((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite'), meta = tx.objectStore('meta'); let failure: unknown, result: PartialListeningScope;
        const abort = (error: unknown) => { failure = error; try { tx.abort(); } catch { /* Already terminal. */ } };
        this.activeAutomaticWrites.set(tx, () => abort(new AutomaticHistoryWriteFenceError('local-off'))); this.activeSegmentWrites.set(tx, permit);
        const cleanup = () => { this.activeAutomaticWrites.delete(tx); this.activeSegmentWrites.delete(tx); };
        tx.oncomplete = () => { cleanup(); resolve(result); }; tx.onerror = tx.onabort = () => { cleanup(); reject(failure ?? tx.error); };
        const control = meta.get(AUTOMATIC_HISTORY_CONTROL_KEY); control.onsuccess = () => {
          try {
            const authority = this.checkSegmentPermit(permit); assertSegmentControl(readAutomaticHistoryControl(control.result), authority.generation);
            const head = meta.get(segmentKey(segmentId)); head.onsuccess = () => {
              try {
                this.checkSegmentPermit(permit); const segment = readStoredSegment(head.result, segmentId).segment;
                if (segment.endedAt !== null || segmentMetadataIdentity(segment) !== authority.metadataIdentity) throw new Error('Partial listening scope requires a live segment.');
                const key = LISTENING_PARTIAL_SCOPE_PREFIX + segmentId, prior = meta.get(key); prior.onsuccess = () => {
                  try {
                    this.checkSegmentPermit(permit);
                    if (prior.result !== undefined) {
                      result = readStoredPartialListeningScope(prior.result, segmentId);
                      if (result.scopeId !== scope.scopeId || result.referenceVersion !== scope.referenceVersion) throw new Error('Partial listening scope already exists.'); return;
                    }
                    result = readPartialListeningScope({ version: 'listening-partial-scope-v1', ...scope, segmentId, sessionId: segment.sessionId, generation: segment.generation, materialId: segment.material.id, materialVersion: segment.material.version, admittedFactCount: segment.facts.length, coverage: 'unavailable' });
                    meta.add({ key, scope: result });
                  } catch (error) { abort(error); }
                };
              } catch (error) { abort(error); }
            };
          } catch (error) { abort(error); }
        };
      });
    });
    this.queue = operation.then(() => {}, () => {}); return operation;
  }
  async loadPartialListeningScope(segmentId: string): Promise<PartialListeningScope | null> {
    assertSegmentId(segmentId); await this.queue; const db = await this.openHistory(); if (!db) return null;
    try {
      return await new Promise<PartialListeningScope | null>((resolve, reject) => {
        const tx = db.transaction('meta', 'readonly'); let result: PartialListeningScope | null = null, failure: unknown;
        const head = tx.objectStore('meta').get(LISTENING_PARTIAL_SCOPE_PREFIX + segmentId); head.onsuccess = () => { try { if (head.result !== undefined) result = readStoredPartialListeningScope(head.result, segmentId); } catch (error) { failure = error; tx.abort(); } };
        tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(failure ?? tx.error);
      });
    } finally { db.close(); }
  }
  /** Persist the per-record compatibility fence before the first answer-bearing B layer. */
  beginListeningSessionScope(snapshot: TrainingSnapshot, options: ListeningSessionScopeOptions): Promise<ListeningSessionAdmission> {
    let captured: TrainingSnapshot, scope: ListeningSessionScopeOptions;
    try { this.checkListeningGeneration(0); captured = validateSnapshot(snapshot); scope = captureListeningScopeOptions(options); }
    catch (error) { return Promise.reject(error); }
    const permit = Object.freeze(Object.create(null)) as ListeningSessionPermit;
    const authority = { epoch: this.automaticHistoryEpoch, sessionId: captured.sessionId, scopeId: scope.scopeId, admitted: false, revoked: false };
    this.listeningSessionPermits.set(permit, authority);
    return this.runListeningSessionWrite(permit, false, (tx, previous) => {
      if (isListeningSessionRecord(previous)) throw new Error('Listening scope already exists; restore the complete envelope instead.');
      const old = previous === undefined ? null : readLegacyHistoryRecord(previous, captured.sessionId);
      if (old) assertTrainingPrefix(old.snapshot, captured);
      const conditions: ListeningConditionsRecord = { schemaVersion: 'listening-conditions-v1', identity: { sessionId: captured.sessionId, roundId: captured.roundId, materialId: captured.material.id, materialVersion: captured.material.version, referenceVersion: scope.referenceVersion }, presentations: [], boundaries: [] };
      const record = readListeningSession({ version: LISTENING_SESSION_VERSION, sessionId: captured.sessionId, sequence: captured.sequence, updatedAt: new Date().toISOString(), snapshot: { schemaVersion: LISTENING_SESSION_VERSION, events: null }, trainingSnapshot: captured, preBRecord: previous ?? null, scope: { ...scope, admittedSequence: captured.sequence, generation: 0, revision: 0 }, conditions });
      this.putListeningSession(tx, record, old?.snapshot.events.length ?? 0); return record;
    }).then(record => { this.checkListeningSessionPermit(permit, false); authority.admitted = true; return Object.freeze({ permit, record }); }).catch(error => { authority.revoked = true; throw error; });
  }
  /** Explicit page resume rechecks the entire envelope. A read alone grants no permit. */
  resumeListeningSessionScope(value: ListeningSessionRecord): Promise<ListeningSessionAdmission> {
    let record: ListeningSessionRecord;
    try { this.checkListeningGeneration(0); record = readListeningSession(value); } catch (error) { return Promise.reject(error); }
    const permit = Object.freeze(Object.create(null)) as ListeningSessionPermit;
    const authority = { epoch: this.automaticHistoryEpoch, sessionId: record.sessionId, scopeId: record.scope.scopeId, admitted: false, revoked: false };
    this.listeningSessionPermits.set(permit, authority);
    return this.runListeningSessionWrite(permit, false, (_tx, previous) => {
      const durable = readListeningSession(previous, record.sessionId);
      if (legacyHistoryIdentity(durable) !== legacyHistoryIdentity(record)) throw new Error('Listening scope changed before resume.');
      return durable;
    }).then(record => { this.checkListeningSessionPermit(permit, false); authority.admitted = true; return Object.freeze({ permit, record }); }).catch(error => { authority.revoked = true; throw error; });
  }
  saveListeningSession(permit: ListeningSessionPermit, snapshot: TrainingSnapshot, evidence: ReturnType<ListeningConditions['snapshot']> | ListeningConditionsRecord, expectedRevision: number): Promise<ListeningSessionRecord> {
    let captured: TrainingSnapshot, conditions: ListeningConditionsRecord;
    try {
      this.checkListeningSessionPermit(permit); captured = validateSnapshot(snapshot); conditions = captureListeningConditions(evidence);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Invalid listening session revision.');
    } catch (error) { return Promise.reject(error); }
    return this.runListeningSessionWrite(permit, true, (tx, value) => {
      const previous = readListeningSession(value, captured.sessionId);
      const next = readListeningSession({ ...previous, sequence: captured.sequence, trainingSnapshot: captured, conditions, scope: { ...previous.scope, revision: expectedRevision + 1 } });
      if (previous.scope.scopeId !== this.listeningSessionPermits.get(permit)!.scopeId) throw new Error('Listening scope identity changed.');
      if (legacyHistoryIdentity(previous) === legacyHistoryIdentity(next)) return previous;
      if (previous.scope.revision !== expectedRevision) throw new Error('Listening session revision conflict.');
      assertListeningSessionAppend(previous, next);
      const record = readListeningSession({ ...next, updatedAt: new Date().toISOString() });
      this.putListeningSession(tx, record, previous.trainingSnapshot.events.length); return record;
    });
  }
  revokeListeningSessionScope(permit: ListeningSessionPermit): void {
    const authority = this.listeningSessionPermits.get(permit); if (!authority) return; authority.revoked = true;
    for (const [tx, current] of this.activeListeningSessionWrites) if (current === permit) this.activeAutomaticWrites.get(tx)?.();
  }
  private checkListeningSessionPermit(permit: ListeningSessionPermit, admitted = true): void {
    const authority = this.listeningSessionPermits.get(permit);
    if (!authority || authority.revoked || (admitted && !authority.admitted)) throw new AutomaticHistoryWriteFenceError('invalid-permit');
    this.checkAutomaticHistoryEpoch(authority.epoch); this.checkListeningGeneration(0);
  }
  private putListeningSession(tx: IDBTransaction, record: ListeningSessionRecord, previousEventCount: number): void {
    for (const event of record.trainingSnapshot.events.slice(previousEventCount)) tx.objectStore('events').add(event);
    tx.objectStore('sessions').put(record); tx.objectStore('meta').put({ key: 'latest', sessionId: record.sessionId });
  }
  private runListeningSessionWrite(permit: ListeningSessionPermit, admitted: boolean, work: (tx: IDBTransaction, previous: unknown) => ListeningSessionRecord): Promise<ListeningSessionRecord> {
    const operation = this.queue.then(async () => {
      this.checkListeningSessionPermit(permit, admitted); const db = await this.open(); this.checkListeningSessionPermit(permit, admitted);
      return new Promise<ListeningSessionRecord>((resolve, reject) => {
        const tx = db.transaction(['sessions', 'events', 'meta'], 'readwrite'); let failure: unknown, result: ListeningSessionRecord;
        const abort = (error: unknown) => { failure = error; try { tx.abort(); } catch { /* Already terminal. */ } };
        this.activeAutomaticWrites.set(tx, () => abort(new AutomaticHistoryWriteFenceError('local-off'))); this.activeListeningSessionWrites.set(tx, permit);
        const cleanup = () => { this.activeAutomaticWrites.delete(tx); this.activeListeningSessionWrites.delete(tx); };
        tx.oncomplete = () => { cleanup(); resolve(result); };
        tx.onerror = tx.onabort = () => { cleanup(); reject(failure ?? tx.error ?? new Error('Listening session was not saved.')); };
        const control = tx.objectStore('meta').get(AUTOMATIC_HISTORY_CONTROL_KEY);
        control.onsuccess = () => {
          try {
            this.checkListeningSessionPermit(permit, admitted);
            if (readAutomaticHistoryControl(control.result).state !== 'legacy-default') throw new AutomaticHistoryWriteFenceError('persisted-off');
            const head = tx.objectStore('sessions').get(this.listeningSessionPermits.get(permit)!.sessionId);
            head.onsuccess = () => { try { this.checkListeningSessionPermit(permit, admitted); if (admitted && head.result === undefined) { this.listeningSessionPermits.get(permit)!.revoked = true; throw new Error('Listening session head is missing.'); } result = work(tx, head.result); } catch (error) { abort(error); } };
          } catch (error) { abort(error); }
        };
      });
    });
    const result = operation.then(record => {
      this.update({ pendingWrites: Math.max(0, this.status.pendingWrites - 1), state: this.status.pendingWrites > 1 ? 'pending' : 'persisted', lastPersistedSessionId: record.sessionId, lastPersistedSequence: record.sequence, error: null }); return record;
    }).catch(error => { this.update({ pendingWrites: Math.max(0, this.status.pendingWrites - 1), state: 'error', error: errorText(error) }); throw error; });
    this.queue = result.then(() => {}, () => {}); this.update({ state: 'pending', pendingWrites: this.status.pendingWrites + 1, error: null }); return result;
  }
  async listListeningSessions(): Promise<readonly ListeningSessionRecord[]> {
    await this.queue; const db = await this.openHistory(); if (!db) return Object.freeze([]);
    try {
      return await new Promise<readonly ListeningSessionRecord[]>((resolve, reject) => {
        const tx = db.transaction('sessions', 'readonly'), results: ListeningSessionRecord[] = []; let failure: unknown;
        const cursor = tx.objectStore('sessions').openCursor(); cursor.onsuccess = () => {
          try { const item = cursor.result; if (!item) return; if (isListeningSessionRecord(item.value)) results.push(readListeningSession(item.value, String(item.key))); item.continue(); } catch (error) { failure = error; tx.abort(); }
        };
        tx.oncomplete = () => resolve(Object.freeze(results.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)))); tx.onerror = tx.onabort = () => reject(failure ?? tx.error);
      });
    } finally { db.close(); }
  }
  async loadListeningSession(sessionId: string): Promise<ListeningSessionRecord | null> {
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw new Error('A listening session ID is required.');
    return (await this.listListeningSessions()).find(record => record.sessionId === sessionId) ?? null;
  }
  /** Fresh, detached whole-family snapshot from one readonly transaction. A bad
   * recognized wrapper rejects the entire read, including unrelated records.
   * Callers may index this result for one read; it is never a persistent cache. */
  readListeningSessionSnapshot(): Promise<readonly ListeningSessionRecord[]> {
    return this.listListeningSessions();
  }
  async loadLatestListeningSession(): Promise<ListeningSessionRecord | null> {
    await this.queue; const db = await this.openHistory(); if (!db) return null;
    try {
      return await new Promise<ListeningSessionRecord | null>((resolve, reject) => {
        const tx = db.transaction(['sessions', 'meta'], 'readonly'); let result: ListeningSessionRecord | null = null, failure: unknown;
        const latest = tx.objectStore('meta').get('latest'); latest.onsuccess = () => {
          if (!latest.result?.sessionId) return;
          const head = tx.objectStore('sessions').get(latest.result.sessionId); head.onsuccess = () => { try { if (isListeningSessionRecord(head.result)) result = readListeningSession(head.result, latest.result.sessionId); } catch (error) { failure = error; tx.abort(); } };
        };
        tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(failure ?? tx.error);
      });
    } finally { db.close(); }
  }
  async deliverListeningSession(sessionId: string, value: ListeningSessionRecord, synchronousSink: () => void): Promise<void> {
    const expected = readListeningSession(value, sessionId);
    if (typeof synchronousSink !== 'function' || Object.prototype.toString.call(synchronousSink) === '[object AsyncFunction]') throw new Error('Listening export requires a synchronous sink.');
    await this.queue; const db = await this.openHistory(); if (!db) throw new Error('Listening session is missing.');
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('sessions', 'readonly'); let failure: unknown;
        const head = tx.objectStore('sessions').get(sessionId); head.onsuccess = () => {
          try {
            if (legacyHistoryIdentity(readListeningSession(head.result, sessionId)) !== legacyHistoryIdentity(expected)) throw new Error('Listening session changed before export.');
            const result = synchronousSink() as unknown; if (result && typeof (result as PromiseLike<unknown>).then === 'function') { void Promise.resolve(result).catch(() => {}); throw new Error('Listening export sink must be synchronous.'); }
          } catch (error) { failure = error; tx.abort(); }
        };
        tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(failure ?? tx.error);
      });
    } finally { db.close(); }
  }
  /** Explicit page-local admission. Reading a saved ON setting never grants this capability. */
  beginListeningHistory(value: ListeningHistoryRecord, expectedGeneration: number): Promise<ListeningHistoryAdmission> {
    let record: ListeningHistoryRecord;
    try {
      record = readListeningHistory(value);
      this.checkListeningGeneration(expectedGeneration);
      if (record.generation !== expectedGeneration || record.revision !== 0 || record.facts.length || record.sealed) throw new AutomaticHistoryWriteFenceError('invalid-permit');
    } catch (error) { return Promise.reject(error); }
    const permit = Object.freeze(Object.create(null)) as ListeningHistoryPermit;
    const state = { epoch: this.automaticHistoryEpoch, generation: expectedGeneration, identity: listeningHistoryIdentity(record), admitted: false, revoked: false };
    this.listeningPermits.set(permit, state);
    return this.queueListeningWrite(permit, record, null).then(saved => {
      this.checkListeningPermit(permit, false); state.admitted = true;
      return Object.freeze({ permit, record: saved });
    }).catch(error => { state.revoked = true; throw error; });
  }
  saveListeningHistory(permit: ListeningHistoryPermit, value: ListeningHistoryRecord, expectedRevision: number): Promise<ListeningHistoryRecord> {
    let record: ListeningHistoryRecord;
    try {
      record = readListeningHistory(value); this.checkListeningPermit(permit);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || record.revision !== expectedRevision + 1) throw new Error('Invalid listening history revision.');
    } catch (error) { return Promise.reject(error); }
    return this.queueListeningWrite(permit, record, expectedRevision);
  }
  /** No flush: pending batches are canceled immediately on detach or OFF. */
  revokeListeningHistory(permit: ListeningHistoryPermit): void {
    const state = this.listeningPermits.get(permit); if (!state) return;
    state.revoked = true;
    for (const [tx, active] of this.activeListeningWrites) if (active === permit) this.activeAutomaticWrites.get(tx)?.();
  }
  private checkListeningGeneration(generation: number): void {
    this.checkAutomaticHistoryEpoch(this.automaticHistoryEpoch);
    if (generation === 0 && this.legacySnapshotWritesAllowed) return;
    this.checkSegmentGeneration(generation);
  }
  private checkListeningPermit(permit: ListeningHistoryPermit, admitted = true): void {
    const state = this.listeningPermits.get(permit);
    if (!state || state.revoked || (admitted && !state.admitted)) throw new AutomaticHistoryWriteFenceError('invalid-permit');
    this.checkAutomaticHistoryEpoch(state.epoch); this.checkListeningGeneration(state.generation);
  }
  private queueListeningWrite(permit: ListeningHistoryPermit, record: ListeningHistoryRecord, expectedRevision: number | null): Promise<ListeningHistoryRecord> {
    const initial = expectedRevision === null;
    const operation = this.queue.then(async () => {
      this.checkListeningPermit(permit, !initial);
      const db = await this.open(); this.checkListeningPermit(permit, !initial);
      return new Promise<ListeningHistoryRecord>((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite'), meta = tx.objectStore('meta');
        let failure: unknown, result: ListeningHistoryRecord;
        const abort = (error: unknown) => { failure = error; try { tx.abort(); } catch { /* Already terminal. */ } };
        const check = () => {
          this.checkListeningPermit(permit, !initial);
          if (this.listeningPermits.get(permit)!.identity !== listeningHistoryIdentity(record)) throw new AutomaticHistoryWriteFenceError('invalid-permit');
        };
        this.activeAutomaticWrites.set(tx, () => abort(new AutomaticHistoryWriteFenceError('local-off')));
        this.activeListeningWrites.set(tx, permit);
        const cleanup = () => { this.activeAutomaticWrites.delete(tx); this.activeListeningWrites.delete(tx); };
        tx.oncomplete = () => { cleanup(); resolve(result); };
        tx.onerror = tx.onabort = () => { cleanup(); reject(failure ?? tx.error ?? new Error('Listening history was not saved.')); };
        const permission = meta.get(AUTOMATIC_HISTORY_CONTROL_KEY);
        permission.onsuccess = () => {
          try {
            check(); const control = readAutomaticHistoryControl(permission.result);
            if (record.generation === 0) {
              if (control.state !== 'legacy-default') throw new AutomaticHistoryWriteFenceError('persisted-off');
            } else assertSegmentControl(control, record.generation);
            const key = LISTENING_HISTORY_PREFIX + record.observationId, head = meta.get(key);
            head.onsuccess = () => {
              try {
                check();
                if (initial) {
                  if (head.result !== undefined) throw new Error('Listening history already exists.');
                  result = record; meta.add({ key, version: 1, record }); return;
                }
                if (head.result === undefined) { this.listeningPermits.get(permit)!.revoked = true; throw new Error('Listening history head is missing.'); }
                const previous = readStoredListeningHistory(head.result, record.observationId);
                if (listeningHistoryIdentity(previous) !== listeningHistoryIdentity(record)) throw new Error('Listening history identity changed.');
                const shared = Math.min(previous.facts.length, record.facts.length);
                for (let i = 0; i < shared; i++) if (JSON.stringify(previous.facts[i]) !== JSON.stringify(record.facts[i])) throw new Error('Listening history prefix conflict.');
                if (JSON.stringify(previous) === JSON.stringify(record)) { result = previous; return; }
                // Stale submissions cannot advance or regress the durable head.
                if (previous.revision !== expectedRevision) throw new Error('Listening history revision conflict.');
                if (previous.sealed) throw new Error('Listening history is sealed.');
                if (record.facts.length < previous.facts.length) throw new Error('Listening history cannot truncate facts.');
                result = record; meta.put({ key, version: 1, record });
              } catch (error) { abort(error); }
            };
          } catch (error) { abort(error); }
        };
      });
    });
    const result = operation.then(record => {
      const pendingWrites = Math.max(0, this.listeningHistoryStatus.pendingWrites - 1);
      this.updateListeningHistory({ state: pendingWrites ? 'pending' : 'persisted', pendingWrites, observationId: record.observationId, revision: record.revision, error: null });
      return record;
    }).catch(error => {
      this.updateListeningHistory({ state: 'error', pendingWrites: Math.max(0, this.listeningHistoryStatus.pendingWrites - 1), error: errorText(error) }); throw error;
    });
    this.queue = result.then(() => {}, () => {});
    this.updateListeningHistory({ state: 'pending', pendingWrites: this.listeningHistoryStatus.pendingWrites + 1, error: null });
    return result;
  }
  /** Standalone observations never enter sessions/events or restore Training state. Reads never initialize storage. */
  async listListeningHistory(): Promise<readonly ListeningHistoryRecord[]> {
    await this.queue;
    const db = await this.openHistory(); if (!db) return Object.freeze([]);
    try {
      return await new Promise<readonly ListeningHistoryRecord[]>((resolve, reject) => {
        const tx = db.transaction('meta', 'readonly'), records: ListeningHistoryRecord[] = [];
        let failure: unknown;
        const cursor = tx.objectStore('meta').openCursor();
        cursor.onsuccess = () => {
          try {
            const item = cursor.result; if (!item) return;
            if (typeof item.key === 'string' && item.key.startsWith(LISTENING_HISTORY_PREFIX)) records.push(readStoredListeningHistory(item.value, item.key.slice(LISTENING_HISTORY_PREFIX.length)));
            item.continue();
          } catch (error) { failure = error; tx.abort(); }
        };
        tx.oncomplete = () => resolve(Object.freeze(records.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || a.observationId.localeCompare(b.observationId))));
        tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error('Listening history could not be read.'));
      });
    } finally { db.close(); }
  }
  /** Final metric export compares the whole observation under the same readonly lock as delivery. */
  async deliverListeningHistory(observationId: string, value: ListeningHistoryRecord, synchronousSink: () => void): Promise<void> {
    const expected = readListeningHistory(value);
    if (typeof observationId !== 'string' || !observationId.trim() || expected.observationId !== observationId) throw new Error('Listening export identity mismatch.');
    if (typeof synchronousSink !== 'function' || Object.prototype.toString.call(synchronousSink) === '[object AsyncFunction]') throw new Error('Listening export requires a synchronous sink.');
    await this.queue; const db = await this.openHistory(); if (!db) throw new Error('Listening observation is missing.');
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('meta', 'readonly'); let failure: unknown;
        const head = tx.objectStore('meta').get(LISTENING_HISTORY_PREFIX + observationId);
        head.onsuccess = () => {
          try {
            if (head.result === undefined || legacyHistoryIdentity(readStoredListeningHistory(head.result, observationId)) !== legacyHistoryIdentity(expected)) throw new Error('Listening observation changed or is missing. Reload before exporting.');
            const result = synchronousSink() as unknown;
            if (result && (typeof result === 'object' || typeof result === 'function') && typeof (result as PromiseLike<unknown>).then === 'function') { void Promise.resolve(result).catch(() => {}); throw new Error('Listening export sink must be synchronous.'); }
          } catch (error) { failure = error; tx.abort(); }
        };
        tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error('Listening history export failed.'));
      });
    } finally { db.close(); }
  }
  async loadListeningHistory(observationId: string): Promise<ListeningHistoryRecord | null> {
    if (typeof observationId !== 'string' || !observationId.trim()) throw new Error('A listening observation ID is required.');
    const records = await this.listListeningHistory(); return records.find(record => record.observationId === observationId) ?? null;
  }
  /** Explicit review metadata has its own error surface and never changes the
   * already-saved Training persistence status. No review method scores or replays. */
  createReviewTask(options: CreateReviewTaskOptions) { return reviewStorage.createReviewTask(this.reviewHost(), options); }
  listReviewTasks() { return reviewStorage.listReviewTasks(this.reviewHost()); }
  loadReviewTask(taskId: string) { return reviewStorage.loadReviewTask(this.reviewHost(), taskId); }
  loadReviewInstance(instanceId: string) { return reviewStorage.loadReviewInstance(this.reviewHost(), instanceId); }
  changeReviewTask(options: ChangeReviewTaskOptions) { return reviewStorage.changeReviewTask(this.reviewHost(), options); }
  prepareReviewRetest(options: PrepareReviewRetestOptions) { return reviewStorage.prepareReviewRetest(this.reviewHost(), options); }
  bindReviewSession(options: BindReviewSessionOptions) { return reviewStorage.bindReviewSession(this.reviewHost(), options); }
  commitReviewResult(options: CommitReviewResultOptions) { return reviewStorage.commitReviewResult(this.reviewHost(), options); }
  restoreReviewSessionBinding(sessionId: string) { return reviewStorage.restoreReviewSessionBinding(this.reviewHost(), sessionId); }
  exportReviewTask(taskId: string) { return reviewStorage.exportReviewTask(this.reviewHost(), taskId); }
  /** Suspend/pagehide/dispose revokes only local review capabilities. There is no
   * retained candidate queue and nothing to scan into a later privacy generation. */
  revokeReviewSessionBindings(): void {
    this.reviewSessionEpoch++;
    for (const transaction of this.activeReviewWrites) this.activeAutomaticWrites.get(transaction)?.();
  }
  private reviewGuard(sessionValue: ReviewSessionLocator, binding?: ReviewSessionBinding): ReviewWriteGuard {
    const session = captureReviewSession(sessionValue), epoch = this.automaticHistoryEpoch, reviewEpoch = this.reviewSessionEpoch;
    const authority = binding ? this.reviewBindingAuthority.get(binding) : null;
    if (binding && (!authority || authority.epoch !== epoch || authority.reviewEpoch !== reviewEpoch)) throw new ReviewTaskError('invalid-binding', '复测的本页许可已失效，请明确重新开始。');
    const permit = session.kind === 'partial' ? this.segmentAdmissions.get(session.segmentId)?.permit : null;
    const check = () => {
      this.checkAutomaticHistoryEpoch(epoch);
      if (reviewEpoch !== this.reviewSessionEpoch) throw new ReviewTaskError('invalid-binding', '本页复测已停止。');
      if (session.kind === 'full') {
        if (!this.legacySnapshotWritesAllowed) throw new AutomaticHistoryWriteFenceError('segment-mode');
      } else {
        if (!permit) throw new AutomaticHistoryWriteFenceError('invalid-permit');
        const state = this.checkSegmentPermit(permit);
        if (state.segmentId !== session.segmentId || state.generation !== session.generation) throw new AutomaticHistoryWriteFenceError('invalid-permit');
      }
    };
    check(); return { session, check };
  }
  private reviewHost(): ReviewStorageHost {
    return {
      run: <T>(mode: IDBTransactionMode, work: (transaction: IDBTransaction) => Promise<T>, guard?: ReviewWriteGuard) => this.runReviewTransaction(mode, work, guard),
      guard: (session, binding) => this.reviewGuard(session, binding),
      authorize: (binding, guard) => {
        guard.check(); this.reviewBindingAuthority.set(binding, { epoch: this.automaticHistoryEpoch, reviewEpoch: this.reviewSessionEpoch }); return binding;
      },
      readSegment: (value, segmentId) => readStoredSegment(value, segmentId).segment,
    };
  }
  private runReviewTransaction<T>(mode: IDBTransactionMode, work: (transaction: IDBTransaction) => Promise<T>, guard?: ReviewWriteGuard): Promise<T | null> {
    // Reserve the normal repository queue without entering its save-status state.
    const operation = this.queue.then(async () => {
      if (this.closed) throw new AutomaticHistoryWriteFenceError('closed');
      guard?.check();
      const db = await this.openHistory(); if (!db) return null;
      try {
        guard?.check();
        return await new Promise<T>((resolve, reject) => {
          const tx = db.transaction(['sessions', 'events', 'meta'], mode);
          let result: T, failure: unknown, ready = false;
          const abort = (error: unknown) => { failure = error; try { tx.abort(); } catch { /* Already committed or aborted. */ } };
          if (guard) {
            this.activeAutomaticWrites.set(tx, () => abort(new AutomaticHistoryWriteFenceError('local-off')));
            this.activeReviewWrites.add(tx);
            if (guard.session.kind === 'partial') {
              const permit = this.segmentAdmissions.get(guard.session.segmentId)?.permit;
              if (permit) this.activeSegmentWrites.set(tx, permit);
            }
          }
          const cleanup = () => { this.activeAutomaticWrites.delete(tx); this.activeReviewWrites.delete(tx); this.activeSegmentWrites.delete(tx); };
          tx.oncomplete = () => { cleanup(); ready ? resolve(result) : reject(new ReviewTaskError('storage-failed', '复习事务没有完成所有核验。')); };
          tx.onerror = tx.onabort = () => { cleanup(); reject(failure ?? tx.error ?? new ReviewTaskError('storage-failed', '复习关系或日期未保存，原作答记录未改变。')); };
          try {
            guard?.check();
            void work(tx).then(value => { guard?.check(); result = value; ready = true; }).catch(abort);
          } catch (error) { abort(error); }
        });
      } finally { db.close(); }
    });
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.revokeAutomaticHistory();
    await this.queue;
    if (this.database) (await this.database).close();
    this.database = null;
  }
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function historyReadError(error: unknown): LegacyHistoryError {
  return error instanceof LegacyHistoryError ? error : new LegacyHistoryError('read-failed', 'Saved history could not be read or delivered. The stored records were not changed.');
}
function historyPosition(value: unknown, key: IDBValidKey): LegacyHistoryCursor {
  const updatedAt = value && typeof value === 'object' ? (value as { updatedAt?: unknown }).updatedAt : undefined;
  const parsed = typeof updatedAt === 'string' ? Date.parse(updatedAt) : NaN;
  return { version: 1, updatedAtMs: Number.isFinite(parsed) ? parsed : null, key };
}
function compareHistoryPositions(a: LegacyHistoryCursor, b: LegacyHistoryCursor, factory: IDBFactory): number {
  if (a.updatedAtMs !== b.updatedAtMs) {
    if (a.updatedAtMs === null) return 1;
    if (b.updatedAtMs === null) return -1;
    return b.updatedAtMs - a.updatedAtMs;
  }
  return factory.cmp(a.key, b.key);
}
function captureHistoryCursor(value: unknown, factory: IDBFactory | undefined): LegacyHistoryCursor | null {
  if (value === undefined || value === null) return null;
  try {
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const cursor = value as Partial<LegacyHistoryCursor>;
    const version = cursor.version, updatedAtMs = cursor.updatedAtMs;
    if (version !== 1 || (updatedAtMs !== null && (!Number.isSafeInteger(updatedAtMs) || Math.abs(updatedAtMs!) > 8.64e15))) throw new Error();
    if (Reflect.ownKeys(value).length !== 3 || !['version', 'updatedAtMs', 'key'].every(key => Object.hasOwn(value, key))) throw new Error();
    const key = structuredClone(cursor.key);
    if (!factory) throw new LegacyHistoryError('read-failed', 'IndexedDB is unavailable; saved history cannot be read.');
    factory.cmp(key!, key!); // Delegate all key types, including nested arrays, to IndexedDB.
    return Object.freeze({ version, updatedAtMs: updatedAtMs!, key: key! });
  } catch (error) {
    if (error instanceof LegacyHistoryError) throw error;
    throw new LegacyHistoryError('invalid-query', 'History cursor must contain a supported version, saved time and valid IndexedDB key.');
  }
}

function segmentKey(segmentId: string): string { return `${TRAINING_HISTORY_SEGMENT_KEY_PREFIX}${segmentId}`; }
function assertSegmentId(segmentId: string): void {
  if (typeof segmentId !== 'string' || !segmentId.trim()) throw new LegacyHistoryError('invalid-query', 'A history segment ID is required.');
}
function segmentMetadataIdentity(segment: TrainingHistorySegment): string {
  const { facts: _facts, endedAt: _endedAt, ...metadata } = segment;
  return legacyHistoryIdentity(metadata);
}
function assertSegmentControl(control: AutomaticHistoryControl, generation: number): void {
  if (control.state !== 'segment-on') throw new AutomaticHistoryWriteFenceError('persisted-off');
  if (control.generation !== generation) throw new AutomaticHistoryWriteFenceError('stale-generation');
}
function readStoredSegment(value: unknown, segmentId: string): StoredTrainingHistorySegment {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new LegacyHistoryError('invalid-record', 'Invalid history segment record.');
  const row = value as Partial<StoredTrainingHistorySegment>;
  if (Reflect.ownKeys(row).length !== 4 || row.key !== segmentKey(segmentId) || row.version !== 1 || typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) throw new LegacyHistoryError('invalid-record', 'Invalid history segment record.');
  const segment = readTrainingHistorySegment(row.segment);
  if (segment.segmentId !== segmentId) throw new LegacyHistoryError('invalid-record', 'History segment identity does not match its key.');
  return freezeLegacyHistory({ key: row.key, version: 1, segment, updatedAt: row.updatedAt });
}
function segmentPosition(segment: TrainingHistorySegmentSummary): TrainingHistorySegmentCursor {
  return { version: 1, startedAtMs: Date.parse(segment.startedAt), segmentId: segment.segmentId };
}
function compareSegmentPositions(a: TrainingHistorySegmentCursor, b: TrainingHistorySegmentCursor): number {
  return b.startedAtMs - a.startedAtMs || (a.segmentId < b.segmentId ? -1 : a.segmentId > b.segmentId ? 1 : 0);
}
function captureSegmentCursor(value: TrainingHistorySegmentCursor | null | undefined): TrainingHistorySegmentCursor | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).length !== 3 || value.version !== 1 || !Number.isSafeInteger(value.startedAtMs) || Math.abs(value.startedAtMs) > 8.64e15 || typeof value.segmentId !== 'string' || !value.segmentId.trim()) throw new LegacyHistoryError('invalid-query', 'Invalid segment history cursor.');
  return Object.freeze({ version: 1, startedAtMs: value.startedAtMs, segmentId: value.segmentId });
}


/** A strict read boundary for untrusted IndexedDB rows. It never authenticates
 * deserialized data for writing or replays a segment as a training snapshot. */
export function readTrainingHistorySegment(value: unknown): TrainingHistorySegment {
  const fail = (): never => { throw new LegacyHistoryError('invalid-record', 'Unsupported or invalid history segment. The stored record was not changed.'); };
  const object = (input: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return fail();
    const own = Reflect.ownKeys(input);
    if (own.length !== keys.length || !keys.every(key => Object.hasOwn(input, key))) return fail();
    for (const key of own) if (typeof key !== 'string' || !Object.getOwnPropertyDescriptor(input, key)?.enumerable || !('value' in Object.getOwnPropertyDescriptor(input, key)!)) return fail();
    return input as Record<string, unknown>;
  };
  const text = (input: unknown, nonempty = true): string => {
    if (typeof input !== 'string' || (nonempty && !input.trim())) return fail(); return input;
  };
  const date = (input: unknown): string => { const result = text(input); if (!Number.isFinite(Date.parse(result))) return fail(); return result; };
  const number = (input: unknown, integer = false): number => {
    if (typeof input !== 'number' || !Number.isFinite(input) || input < 0 || (integer && !Number.isSafeInteger(input))) return fail(); return input;
  };
  const oneOf = (input: unknown, allowed: readonly unknown[]): void => { if (!allowed.includes(input)) fail(); };
  const array = (input: unknown): readonly unknown[] => { if (!Array.isArray(input) || Reflect.ownKeys(input).length !== input.length + 1) return fail(); return input; };
  const raw = object(value, ['schemaVersion', 'sessionId', 'segmentId', 'writerInstanceId', 'generation', 'material', 'rules', 'startedAt', 'endedAt', 'coverage', 'replayable', 'facts']);
  if (raw.schemaVersion !== TRAINING_HISTORY_SEGMENT_VERSION || raw.coverage !== 'partial' || raw.replayable !== false || number(raw.generation, true) < 1) fail();
  for (const key of ['sessionId', 'segmentId', 'writerInstanceId']) text(raw[key]);
  const startedAt = date(raw.startedAt);
  if (raw.endedAt !== null && Date.parse(date(raw.endedAt)) < Date.parse(startedAt)) fail();
  const material = object(raw.material, ['id', 'version']); text(material.id); text(material.version);
  const rules = object(raw.rules, ['trainingSchemaVersion', 'ruleVersion', 'paceRuleVersion']);
  // Read stored provenance as historical facts, without changing it to today's rules.
  for (const rule of Object.values(rules)) text(rule);
  const reasons = ['draft-predates-segment', 'composition-crossed-boundary', 'unknown-edit', 'undo-redo', 'request-outside-segment', 'answer-provenance-unknown'];
  const origin = ['sourceEventId', 'ordinal', 'wallTime', 'cueId', 'type'];
  const seen = new Set<string>();
  array(raw.facts).forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail();
    const fact = item as Record<string, unknown>;
    const id = text(fact.sourceEventId); if (seen.has(id) || fact.ordinal !== index + 1) fail(); seen.add(id);
    date(fact.wallTime); text(fact.cueId);
    const keys = (...additional: string[]) => object(fact, [...origin, ...additional]);
    const retained = (field: 'text' | 'answer', additional: string[]) => {
      if (fact.retention === 'recorded') { keys(...additional, 'retention', field); text(fact[field], false); }
      else { keys(...additional, 'retention', 'redactionReason'); if (fact.retention !== 'redacted') fail(); oneOf(fact.redactionReason, reasons); }
    };
    switch (fact.type) {
      case 'timeAdvanced':
        keys('deltaMs', 'durationCoverage'); oneOf(fact.durationCoverage, ['observed', 'boundary-unknown', 'frozen']);
        if (fact.durationCoverage === 'observed') number(fact.deltaMs); else if (fact.deltaMs !== null) fail();
        break;
      case 'inputObservationSampled': case 'compositionStarted': case 'compositionEnded': keys(); break;
      case 'inputCommitted': oneOf(fact.source, ['typed', 'paste', 'ime']); retained('text', ['source']); break;
      case 'freezeChanged':
        keys('reason', 'on'); oneOf(fact.reason, ['idle', 'paused', 'listening', 'composition', 'background', 'modal', 'checking', 'review']);
        if (typeof fact.on !== 'boolean') fail(); break;
      case 'cueChanged': keys('index'); number(fact.index, true); break;
      case 'hintExposed': keys('kind'); oneOf(fact.kind, ['hint', 'reveal']); break;
      case 'submitRequested': text(fact.attemptId); retained('answer', ['attemptId']); break;
      case 'judgmentApplied': {
        text(fact.attemptId);
        if (fact.retention === 'redacted') { keys('attemptId', 'retention', 'redactionReason'); oneOf(fact.redactionReason, reasons); }
        else if (fact.retention === 'unavailable') { keys('attemptId', 'retention', 'reason'); if (fact.reason !== 'judgment-not-applied') fail(); }
        else {
          keys('attemptId', 'retention', 'result'); if (fact.retention !== 'recorded') fail();
          const result = object(fact.result, ['answer', 'words', 'errors', 'accuracy', 'alignment']);
          text(result.answer, false); number(result.words, true); number(result.errors, true); if (number(result.accuracy) > 100) fail();
          for (const item of array(result.alignment)) {
            const token = object(item, ['kind', 'position', 'expected', 'actual']);
            oneOf(token.kind, ['match', 'replace', 'missing', 'extra']);
            if (token.position !== null) number(token.position, true);
            text(token.expected, false); text(token.actual, false);
          }
        }
        break;
      }
      default: fail();
    }
  });
  return freezeLegacyHistory(structuredClone(value)) as TrainingHistorySegment;
}

function readStoredListeningHistory(value: unknown, observationId: string): ListeningHistoryRecord {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== 3) throw new Error('Invalid listening history envelope.');
  const row = value as { key?: unknown; version?: unknown; record?: unknown };
  if (row.key !== LISTENING_HISTORY_PREFIX + observationId || row.version !== 1) throw new Error('Invalid listening history envelope.');
  const record = readListeningHistory(row.record);
  if (record.observationId !== observationId) throw new Error('Listening history key mismatch.');
  return record;
}

function readStoredPartialListeningScope(value: unknown, segmentId: string): PartialListeningScope {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== 2) throw new Error('Invalid partial listening scope.');
  const row = value as { key: unknown; scope: unknown }; if (row.key !== LISTENING_PARTIAL_SCOPE_PREFIX + segmentId) throw new Error('Invalid partial listening scope key.');
  const scope = readPartialListeningScope(row.scope); if (scope.segmentId !== segmentId) throw new Error('Partial listening scope identity changed.'); return scope;
}
