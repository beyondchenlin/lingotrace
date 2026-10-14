import { IndexedDBRecordingStore, recordingExtension, selectRecordingMime } from './recording-storage.js';
import{CapacityMonitor,INITIAL_CAPACITY,type CapacityAssessment,type EstimateReader}from'./storage-capacity.ts';
import{RECORD_STOP_REASON,RECORD_STOP_FAILURE_MESSAGE,type RecordStopReason}from'../core/record-stop-reason.ts';

const MiB = 1024 * 1024;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SINGLE_TAB_WARNING = '此浏览器不支持 Web Locks，请只在一个训练页面使用录像存储。';

export type RecordStatus = 'recording' | 'complete' | 'incomplete' | 'interrupted' | 'deleting';
export interface RecordMeta {
  id: string;
  status: RecordStatus;
  complete: boolean;
  retained: boolean;
  startedAt: number;
  endedAt: number | null;
  lastCommittedAt: number | null;
  expiresAt: number | null;
  bytes: number;
  chunkCount: number;
  mimeType: string;
  extension: string;
  captureSource: string;
  /** New scene recordings always use canvas-composite; older store rows may omit this. */
  source?: string;
  audioLabel: string;
  stopReason: string | null;
  metadataFinalizationFailed?: boolean;
  limits?: { maxDurationMs: number; maxExportBytes: number; maxPendingBytes: number; retentionMs: number };
}

/** Matches the existing recording-storage.js adapter exactly. */
export interface SceneRecordingStore {
  open(): Promise<void>;
  probe(): Promise<void>;
  list(): Promise<RecordMeta[]>;
  get(id: string): Promise<RecordMeta | null>;
  create(meta: RecordMeta): Promise<RecordMeta>;
  update(id: string, mutate: (old: RecordMeta) => RecordMeta): Promise<RecordMeta>;
  append(id: string, sequence: number, chunk: Blob, committedAt: number): Promise<RecordMeta>;
  remove(id: string, options?: { expiredAt?: number }): Promise<boolean>;
  readChunks(id: string, maxBytes: number): Promise<BlobPart[]>;
  close(): void;
}

export interface SceneRecorderFailure { readonly code: string; readonly message: string }
export interface SceneRecorderSnapshot {
  readonly state: 'idle' | 'recording' | 'stopping' | 'saved' | 'error';
  readonly recordingId: string | null;
  readonly startedAt: number | null;
  /** Committed bytes only, never the pending queue. */
  readonly bytes: number;
  readonly error: SceneRecorderFailure | null;
  readonly warning: string | null;
  readonly audioLabel: string;
  readonly capacity: CapacityAssessment;
}

export function isNewRecordingTerminal(previous:SceneRecorderSnapshot,next:SceneRecorderSnapshot):boolean{return(next.state==='saved'||next.state==='error')&&(previous.state!==next.state||previous.recordingId!==next.recordingId)}

export interface SceneRecorderConfig {
  dbName?: string;
  store?: SceneRecordingStore;
  recorderClass?: typeof MediaRecorder;
  /** null explicitly disables Web Locks, primarily for isolated synthetic tests. */
  locks?: LockManager | null;
  maxPendingBytes?: number;
  maxExportBytes?: number;
  maxDurationMs?: number;
  finalizeTimeoutMs?: number;
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
  capacityEstimate?: EstimateReader | null;
  capacityLowRatio?: number;
  capacityLowSeconds?: number;
  capacityCheckIntervalMs?: number;
  capacityEstimateTimeoutMs?: number;
  now?: () => number;
  uuid?: () => string;
}

export class SceneRecorderError extends Error {
  readonly code: string;
  constructor(code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SceneRecorderError';
    this.code = code;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function asFailure(error: unknown): SceneRecorderFailure {
  const candidate = error as { code?: string; name?: string; message?: string } | null;
  const code = typeof candidate?.code === 'string' ? candidate.code : candidate?.name || 'UNKNOWN';
  const message = candidate?.name === 'QuotaExceededError'
    ? '本机存储空间不足；已提交的数据保留为未完成录像，可能无法播放。'
    : candidate?.message || '录像失败；已提交的数据会在本机保留为未完成录像。';
  return Object.freeze({ code, message });
}

function positive(value: number | undefined, fallback: number, name: string, cap = Infinity): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0 || result > cap) throw new TypeError(`Invalid ${name}`);
  return result;
}

interface Session {
  stream: MediaStream;
  recorder: MediaRecorder | null;
  recorderStarted: boolean;
  metadata: RecordMeta | null;
  completion: ReturnType<typeof deferred<RecordMeta>>;
  writeTail: Promise<void>;
  pendingBytes: number;
  queuedChunks: number;
  receivedBytes: number;
  writeFailed: boolean;
  failure: unknown;
  requestedStop: boolean;
  stoppedAt: number | null;
  stopReason: string;
  finishing: boolean;
  finished: boolean;
  durationTimer?: ReturnType<typeof setTimeout>;
  estimateTimer?: ReturnType<typeof setInterval>;
  finalizeTimer?: ReturnType<typeof setTimeout>;
  unlisten: Array<() => void>;
}

/**
 * Records a caller-created Canvas composite, with caller-selected audio only.
 * This module never calls captureStream(), getUserMedia(), or getDisplayMedia().
 * Keep one prepared instance per page and await dispose() before replacing it.
 */
export class SceneRecorder {
  private readonly store: SceneRecordingStore;
  private readonly Recorder: typeof MediaRecorder | undefined;
  private readonly locks: LockManager | null;
  private readonly dbName: string;
  private readonly now: () => number;
  private readonly uuid: () => string;
  private readonly maxPendingBytes: number;
  private readonly maxExportBytes: number;
  private readonly maxDurationMs: number;
  private readonly finalizeTimeoutMs: number;
  private readonly videoBitsPerSecond: number;
  private readonly audioBitsPerSecond: number;
  private readonly capacityMonitor: CapacityMonitor;
  private readonly capacityCheckIntervalMs: number;
  private snapshot: SceneRecorderSnapshot;
  private readonly listeners = new Set<() => void>();
  private active: Session | null = null;
  private lastSaved: RecordMeta | null = null;
  private prepared = false;
  private disposed = false;
  private preparing: Promise<void> | null = null;
  private cleaning: Promise<void> | null = null;
  private disposing: Promise<void> | null = null;
  private unlock: (() => void) | null = null;
  private lockTask: Promise<unknown> | null = null;

  constructor(config: SceneRecorderConfig = {}) {
    this.dbName = config.dbName ?? 'lingotrace-recordings-v1';
    if (!this.dbName.trim()) throw new TypeError('dbName must be nonempty');
    this.store = config.store ?? new IndexedDBRecordingStore({ dbName: this.dbName });
    this.Recorder = config.recorderClass ?? globalThis.MediaRecorder;
    this.locks = config.locks === undefined ? globalThis.navigator?.locks ?? null : config.locks;
    this.now = config.now ?? Date.now;
    this.uuid = config.uuid ?? (() => globalThis.crypto.randomUUID());
    this.maxPendingBytes = positive(config.maxPendingBytes, 16 * MiB, 'maxPendingBytes', 16 * MiB);
    this.maxExportBytes = positive(config.maxExportBytes, 512 * MiB, 'maxExportBytes', 512 * MiB);
    this.maxDurationMs = positive(config.maxDurationMs, 30 * 60 * 1000, 'maxDurationMs', 30 * 60 * 1000);
    this.finalizeTimeoutMs = positive(config.finalizeTimeoutMs, 10000, 'finalizeTimeoutMs');
    this.videoBitsPerSecond = positive(config.videoBitsPerSecond, 2500000, 'videoBitsPerSecond');
    this.audioBitsPerSecond = positive(config.audioBitsPerSecond, 128000, 'audioBitsPerSecond');
    this.capacityCheckIntervalMs=positive(config.capacityCheckIntervalMs,10000,'capacityCheckIntervalMs');
    this.capacityMonitor=new CapacityMonitor({reader:config.capacityEstimate,lowRatio:config.capacityLowRatio,lowSeconds:config.capacityLowSeconds,timeoutMs:config.capacityEstimateTimeoutMs,now:this.now,onChange:capacity=>this.patch({capacity})});
    this.snapshot = Object.freeze({ state: 'idle', recordingId: null, startedAt: null,
      bytes: 0, error: null, warning: this.locks ? null : SINGLE_TAB_WARNING, audioLabel: '无音频',capacity:INITIAL_CAPACITY });
  }

  /** Stable immutable snapshot suitable for React useSyncExternalStore. */
  getSnapshot = (): SceneRecorderSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private patch(next: Partial<SceneRecorderSnapshot>): void {
    if ('warning' in next && !this.locks) {
      const extra = next.warning?.replace(SINGLE_TAB_WARNING, '').trim();
      next = { ...next, warning: extra ? `${SINGLE_TAB_WARNING} ${extra}` : SINGLE_TAB_WARNING };
    }
    this.snapshot = Object.freeze({ ...this.snapshot, ...next });
    for (const listener of this.listeners) {
      try { listener(); } catch { /* Subscribers cannot interrupt storage or stream cleanup. */ }
    }
  }

  /** Advisory only: no permission, deletion, start/stop or retention mutation. */
  refreshStorageEstimate():Promise<CapacityAssessment>{const session=this.active;const fallback=(this.videoBitsPerSecond+(!session||session.stream.getAudioTracks().length?this.audioBitsPerSecond:0))/8;const elapsed=session?.metadata?Math.max(0,(this.now()-session.metadata.startedAt)/1000):0;const measured=elapsed>0?(session?.metadata?.bytes??0)/elapsed:0;return this.capacityMonitor.refresh(Math.max(fallback,measured))}

  private assertLive(): void {
    if (this.disposed) throw new SceneRecorderError('DISPOSED', '录像服务已关闭。');
  }

  private assertPrepared(): void {
    this.assertLive();
    if (!this.prepared) throw new SceneRecorderError('NOT_PREPARED', '本机录像暂存尚未准备好。');
  }

  private async acquireLock(): Promise<void> {
    if (!this.locks) return;
    const acquired = deferred<boolean>();
    const hold = deferred<void>();
    // Share the existing adapter controller's namespace, so legacy pages cannot race recovery.
    this.lockTask = this.locks.request(`${this.dbName}:capture-controller`, { ifAvailable: true }, async lock => {
      if (!lock) { acquired.resolve(false); return; }
      this.unlock = () => { hold.resolve(); };
      acquired.resolve(true);
      await hold.promise;
    });
    void this.lockTask.catch(() => { acquired.resolve(false); });
    if (!await acquired.promise) throw new SceneRecorderError('ANOTHER_TAB', '另一个训练页面正在使用录像存储，请关闭该页面后重试。');
  }

  /** Opens/probes storage and recovers unfinished rows. No media permissions. */
  prepare(): Promise<void> {
    this.assertLive();
    if (this.prepared) return Promise.resolve();
    if (this.preparing) return this.preparing;
    this.preparing = (async () => {
      try {
        await this.acquireLock();
        this.assertLive();
        await this.store.open();
        await this.store.probe();
        this.assertLive();
        for (const record of await this.store.list()) {
          if (record.status !== 'recording') continue;
          await this.store.update(record.id, old => {
            if (old.status !== 'recording') return old;
            const endedAt = old.lastCommittedAt ?? old.startedAt;
            return { ...old, status: 'interrupted', complete: false, endedAt,
              expiresAt: endedAt + RETENTION_MS,
              stopReason: '页面关闭或录制中断；只保留已提交的数据，不保证可播放。' };
          });
        }
        await this.cleanupExpired();
        this.assertLive();
        this.prepared = true;
        this.patch({ state: 'idle', error: null, warning: null });
        void this.refreshStorageEstimate();
      } catch (error) {
        this.prepared = false;
        this.patch({ state: 'error', error: asFailure(error) });
        this.store.close();
        this.unlock?.();
        this.unlock = null;
        throw error;
      } finally { this.preparing = null; }
    })();
    return this.preparing;
  }

  /**
   * Transfers ownership of this composite stream, including all attached audio tracks.
   * Caller must clone shared mic/lesson audio tracks before attaching them.
   * Failed preconditions (unprepared/disposed/already active) leave ownership with caller.
   */
  async start(stream: MediaStream, options: { audioLabel: string; source: 'canvas-composite'; sourceTracks?: readonly MediaStreamTrack[] }): Promise<void> {
    this.assertPrepared();
    if (this.active) throw new SceneRecorderError('ALREADY_RECORDING', '录像已经开始或正在收尾。');
    const completion = deferred<RecordMeta>();
    // Completion may fail before a caller has obtained stop(); start() reports the same failure.
    void completion.promise.catch(() => {});
    const session: Session = { stream, recorder: null, recorderStarted: false, metadata: null,
      completion, writeTail: Promise.resolve(), pendingBytes: 0, queuedChunks: 0, receivedBytes: 0,
      writeFailed: false, failure: null, requestedStop: false, stoppedAt: null, stopReason: RECORD_STOP_REASON.userStop,
      finishing: false, finished: false, unlisten: [] };
    this.active = session;
    this.lastSaved = null;
    this.patch({ state: 'idle', recordingId: null, startedAt: null, bytes: 0, error: null, warning: null });
    this.capacityMonitor.invalidate();
    void this.refreshStorageEstimate();
    try {
      if (options.source !== 'canvas-composite') throw new SceneRecorderError('INVALID_SOURCE', '此控制器只接受 Canvas 合成画面。');
      if (!this.Recorder) throw new SceneRecorderError('ENCODER_UNAVAILABLE', '浏览器不支持 MediaRecorder 录像。');
      if (typeof options.audioLabel !== 'string' || !options.audioLabel.trim()) throw new SceneRecorderError('AUDIO_LABEL_REQUIRED', '请明确标注本次录像的音频来源。');
      const video = stream.getVideoTracks();
      if (!video.length || video.some(track => track.readyState !== 'live')) throw new SceneRecorderError('SOURCE_ENDED', 'Canvas 合成画面没有可用的视频轨道。');
      const audio = stream.getAudioTracks();
      if (audio.some(track => track.readyState !== 'live')) throw new SceneRecorderError('AUDIO_ENDED', '选定的音频轨道已结束。');
      // A mixed output can stay live after its microphone input disconnects.
      // Observe caller-owned raw inputs too, without taking ownership of them.
      const watchedTracks = [...new Set([...stream.getTracks(), ...(options.sourceTracks ?? [])])];
      if (watchedTracks.some(track => track.readyState !== 'live')) throw new SceneRecorderError('SOURCE_INTERRUPTED', '选定的画面或音频来源已结束。');
      const audioLabel = audio.length ? options.audioLabel.trim() : '无音频';
      const selectedMime = selectRecordingMime(this.Recorder, audio.length > 0);
      const recorder = new this.Recorder(stream, { mimeType: selectedMime,
        videoBitsPerSecond: this.videoBitsPerSecond,
        ...(audio.length ? { audioBitsPerSecond: this.audioBitsPerSecond } : {}) });
      session.recorder = recorder;
      const mimeType = recorder.mimeType || selectedMime;
      const id = this.uuid();
      const startedAt = this.now();
      session.metadata = await this.store.create({ id, status: 'recording', complete: false,
        retained: false, startedAt, endedAt: null, lastCommittedAt: null, expiresAt: null,
        bytes: 0, chunkCount: 0, mimeType, extension: recordingExtension(mimeType),
        captureSource: 'canvas-composite', source: 'canvas-composite', audioLabel, stopReason: null,
        limits: { maxDurationMs: this.maxDurationMs, maxExportBytes: this.maxExportBytes,
          maxPendingBytes: this.maxPendingBytes, retentionMs: RETENTION_MS } });
      this.patch({ recordingId: id, startedAt, audioLabel });
      if (session.requestedStop || this.disposed || watchedTracks.some(track => track.readyState !== 'live')) {
        throw new SceneRecorderError('START_INTERRUPTED', '录像开始前已停止；没有完整录像。');
      }
      const onData = (event: BlobEvent) => { this.onData(session, event.data); };
      const onStop = () => { void this.finish(session); };
      const onError = (event: Event) => {
        this.fail(session, (event as Event & { error?: DOMException }).error ?? new SceneRecorderError('ENCODER_ERROR', '浏览器编码失败。'));
      };
      recorder.addEventListener('dataavailable', onData);
      recorder.addEventListener('stop', onStop);
      recorder.addEventListener('error', onError);
      session.unlisten.push(() => {
        recorder.removeEventListener('dataavailable', onData);
        recorder.removeEventListener('stop', onStop);
        recorder.removeEventListener('error', onError);
      });
      for (const track of watchedTracks) {
        const ended = () => {
          if (!session.requestedStop) this.fail(session, new SceneRecorderError('SOURCE_INTERRUPTED', '选定的画面或音频轨道意外结束。'));
        };
        track.addEventListener('ended', ended);
        session.unlisten.push(() => { track.removeEventListener('ended', ended); });
      }
      recorder.start(1000);
      session.recorderStarted = true;
      this.patch({ state: 'recording' });
      session.estimateTimer=setInterval(()=>{if(this.active===session&&!session.requestedStop)void this.refreshStorageEstimate()},this.capacityCheckIntervalMs);
      session.durationTimer = setTimeout(() => {
        this.patch({ warning: '已达到本次录像的时长上限，正在停止并保存。' });
        this.requestStop(session, '达到时长上限');
      }, this.maxDurationMs);
    } catch (error) {
      session.failure ||= error;
      await this.finish(session);
      throw error;
    }
  }

  private onData(session: Session, chunk: Blob): void {
    if (!chunk?.size || session.finished || session.finishing || session.failure) return;
    if (session.pendingBytes + chunk.size > this.maxPendingBytes) {
      this.fail(session, new SceneRecorderError('WRITE_BACKLOG', '写入积压超过安全上限；已提交的数据保留为未完成录像。'));
      return;
    }
    if (session.receivedBytes + chunk.size > this.maxExportBytes) {
      this.fail(session, new SceneRecorderError('SIZE_LIMIT', '录像已达到大小上限；超限数据块未保存，已提交的数据保留为未完成录像。'));
      return;
    }
    session.receivedBytes += chunk.size;
    session.pendingBytes += chunk.size;
    const sequence = session.queuedChunks++;
    session.writeTail = session.writeTail.then(async () => {
      if (session.writeFailed || !session.metadata) return;
      try {
        session.metadata = await this.store.append(session.metadata.id, sequence, chunk, this.now());
        if (this.active === session) this.patch({ bytes: session.metadata.bytes });
      } catch (error) {
        session.writeFailed = true;
        this.fail(session, error);
      }
    }).finally(() => { session.pendingBytes -= chunk.size; });
    if (session.receivedBytes === this.maxExportBytes) {
      this.patch({ warning: '已达到本次录像的大小上限，正在停止并保存。' });
      this.requestStop(session, '达到大小上限');
    }
  }

  private fail(session: Session, error: unknown): void {
    if (session.finished) return;
    session.failure ||= error;
    this.patch({ error: asFailure(session.failure) });
    this.requestStop(session, '录制失败');
  }

  private requestStop(session: Session, reason: RecordStopReason | string = RECORD_STOP_REASON.userStop): void {
    if (session.finished || session.requestedStop) return;
    session.requestedStop = true;
    session.stoppedAt = this.now();
    session.stopReason = reason;
    clearTimeout(session.durationTimer);
    clearInterval(session.estimateTimer);
    if(this.active===session)this.capacityMonitor.invalidate();
    this.patch({ state: 'stopping' });
    // If create() is pending, start() will observe requestedStop and own finalization.
    if (!session.recorderStarted) return;
    session.finalizeTimer = setTimeout(() => {
      session.failure ||= new SceneRecorderError('FINALIZE_TIMEOUT', '浏览器未完成录像收尾；已提交的数据标记为未完成。');
      void this.finish(session);
    }, this.finalizeTimeoutMs);
    if (session.recorder?.state !== 'inactive') {
      try { session.recorder?.stop(); }
      catch (error) { session.failure ||= error; void this.finish(session); }
    }
    // Normal stops retain tracks until writes drain. A whole-practice pause may
    // release recording-owned inputs after this request to cut off new content;
    // encoder listeners and final data/write draining must remain intact.
  }

  stop(reason: RecordStopReason = RECORD_STOP_REASON.userStop): Promise<RecordMeta> {
    const session = this.active;
    if (!session) {
      if (this.lastSaved) return Promise.resolve({ ...this.lastSaved });
      return Promise.reject(new SceneRecorderError('NO_ACTIVE_RECORDING', '没有正在录制的录像。'));
    }
    this.requestStop(session, reason);
    return session.completion.promise;
  }

  private async finish(session: Session): Promise<void> {
    if (session.finishing || session.finished) return;
    session.finishing = true;
    clearTimeout(session.durationTimer);
    clearInterval(session.estimateTimer);
    if(this.active===session)this.capacityMonitor.invalidate();
    clearTimeout(session.finalizeTimer);
    if (this.active === session) this.patch({ state: 'stopping' });
    await session.writeTail;
    // Classify lifecycle interruption only after accepted final encoder chunks drain.
    // Setting failure at cutoff would make onData discard those salvageable bytes.
    if(session.stopReason===RECORD_STOP_REASON.renderInterrupted)session.failure ||= new SceneRecorderError('SCENE_RENDER_INTERRUPTED',RECORD_STOP_FAILURE_MESSAGE[RECORD_STOP_REASON.renderInterrupted]);
    if(session.stopReason===RECORD_STOP_REASON.mixInterrupted)session.failure ||= new SceneRecorderError('AUDIO_MIX_INTERRUPTED',RECORD_STOP_FAILURE_MESSAGE[RECORD_STOP_REASON.mixInterrupted]);
    if(session.stopReason===RECORD_STOP_REASON.backgrounded)session.failure ||= new SceneRecorderError('PAGE_BACKGROUND_INTERRUPTED',RECORD_STOP_FAILURE_MESSAGE[RECORD_STOP_REASON.backgrounded]);
    for (const unlisten of session.unlisten.splice(0)) unlisten();
    for (const track of session.stream.getTracks()) {
      try { if (track.readyState !== 'ended') track.stop(); } catch { /* Release remaining owned tracks. */ }
    }
    let saved = session.metadata;
    if (saved) {
      if (!saved.bytes) session.failure ||= new SceneRecorderError('EMPTY_RECORDING', '没有已提交的视频数据，录像未完成。');
      const endedAt = session.stoppedAt ?? this.now();
      const complete = !session.failure;
      const expiryBase = complete ? endedAt : saved.lastCommittedAt ?? saved.startedAt;
      try {
        saved = await this.store.update(saved.id, old => ({ ...old,
          status: complete ? 'complete' : 'incomplete', complete, endedAt,
          expiresAt: expiryBase + RETENTION_MS,
          stopReason: session.failure ? asFailure(session.failure).message : session.stopReason }));
      } catch (error) {
        session.failure ||= error;
        // Persisted row remains recoverable on next prepare(); never invent a committed update.
        saved = { ...saved, status: 'incomplete', complete: false, endedAt,
          expiresAt: expiryBase + RETENTION_MS, metadataFinalizationFailed: true,
          stopReason: asFailure(session.failure).message };
      }
    }
    session.finished = true;
    if (this.active === session) {
      this.active = null;
      this.lastSaved = saved ? { ...saved } : null;
      this.patch({ state: session.failure ? 'error' : 'saved', bytes: saved?.bytes ?? 0,
        error: session.failure ? asFailure(session.failure) : null });
    }
    if (saved) session.completion.resolve({ ...saved });
    else session.completion.reject(session.failure ?? new SceneRecorderError('EMPTY_RECORDING', '没有可保存的录像。'));
  }

  private cleanupExpired(): Promise<void> {
    if (this.cleaning) return this.cleaning;
    this.cleaning = (async () => {
      const expiredAt = this.now();
      for (const record of await this.store.list()) {
        if (record.id === this.active?.metadata?.id || record.status === 'recording') continue;
        if (record.status === 'deleting' || (!record.retained && record.expiresAt != null && record.expiresAt <= expiredAt)) {
          // Adapter rechecks pin/expiry inside the transaction, avoiding list-snapshot deletion races.
          await this.store.remove(record.id, { expiredAt });
        }
      }
    })().finally(() => { this.cleaning = null; });
    return this.cleaning;
  }

  async list(): Promise<RecordMeta[]> {
    this.assertPrepared();
    await this.cleanupExpired();
    return (await this.store.list()).sort((a, b) => b.startedAt - a.startedAt);
  }

  private assertInactive(id: string): void {
    this.assertPrepared();
    if (this.active?.metadata?.id === id) throw new SceneRecorderError('RECORDING_ACTIVE', '请先停止录像并等待收尾。');
  }

  async blob(id: string): Promise<Blob> {
    this.assertInactive(id);
    const record = await this.store.get(id);
    if (!record || record.status === 'deleting') throw new SceneRecorderError('NOT_FOUND', '录像已不存在或正在清理。');
    if (record.status === 'recording') throw new SceneRecorderError('RECORDING_UNFINALIZED', '录像尚未收尾，请重新打开页面恢复后再试。');
    if (!record.bytes) throw new SceneRecorderError('EMPTY_RECORDING', '录像没有可导出的数据。');
    if (record.bytes > this.maxExportBytes) throw new SceneRecorderError('EXPORT_TOO_LARGE', '录像超过导出内存上限。');
    const parts = await this.store.readChunks(id, this.maxExportBytes);
    const output = new Blob(parts, { type: record.mimeType });
    if (parts.length !== record.chunkCount || output.size !== record.bytes) throw new SceneRecorderError('CHUNKS_MISSING', '录像索引与实际数据不一致，无法导出。');
    return output;
  }

  async retain(id: string, retained: boolean): Promise<RecordMeta> {
    this.assertInactive(id);
    const result = await this.store.update(id, old => {
      if (old.status === 'recording' || old.status === 'deleting') throw new SceneRecorderError('RECORDING_UNAVAILABLE', '录像正在录制或删除，无法修改保留状态。');
      return { ...old, retained: Boolean(retained) };
    });
    this.patch({});
    return result;
  }

  async remove(id: string): Promise<boolean> {
    this.assertInactive(id);
    const record = await this.store.get(id);
    if (record?.status === 'recording') throw new SceneRecorderError('RECORDING_ACTIVE', '请先停止录像并等待收尾。');
    const removed = await this.store.remove(id);
    if (removed && this.lastSaved?.id === id) this.lastSaved = null;
    this.patch({});
    return removed;
  }

  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.disposed = true;
    this.capacityMonitor.dispose();
    this.disposing = (async () => {
      const session = this.active;
      if (session) {
        this.requestStop(session, '页面关闭');
        try { await session.completion.promise; } catch { /* start() and snapshot carry failure. */ }
      }
      if (this.preparing) { try { await this.preparing; } catch { /* Preparation observes disposed. */ } }
      if (this.cleaning) { try { await this.cleaning; } catch { /* Retry deleting rows next startup. */ } }
      this.prepared = false;
      this.store.close();
      this.unlock?.();
      this.unlock = null;
      if (this.lockTask) { try { await this.lockTask; } catch { /* Already reported by prepare(). */ } }
      this.listeners.clear();
    })();
    return this.disposing;
  }
}
