/** Local-only browser capture. No permission request happens in the constructor. */
const DAY = 24 * 60 * 60 * 1000;
const MiB = 1024 * 1024;
const DEFAULTS = Object.freeze({
  dbName: 'lingotrace-recordings-v1', retentionMs: 7 * DAY, timesliceMs: 1000,
  maxPendingBytes: 16 * MiB, maxDurationMs: 30 * 60 * 1000,
  maxExportBytes: 512 * MiB, lowRemainingRatio: 0.1, lowRemainingSeconds: 120,
  estimateIntervalMs: 10000, cleanupIntervalMs: 60000, finalizeTimeoutMs: 10000,
  videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000,
});

export class CaptureError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CaptureError';
    this.code = code;
  }
}

function failure(error, stage) {
  const names = {
    NotAllowedError: '权限被拒绝、选择已取消或当前页面策略不允许采集。请检查浏览器提示后重试。',
    NotFoundError: '未找到所需的摄像头或麦克风。',
    NotReadableError: '设备或捕获来源暂时不可读，可能正被其他程序占用。',
    OverconstrainedError: '所选设备或采集参数不可用，请重新选择。',
    InvalidStateError: '当前页面状态无法开始采集，请回到页面并再次点击开始。',
    AbortError: '采集已取消或被浏览器中断。',
    SecurityError: '浏览器或页面安全策略阻止了采集。',
    QuotaExceededError: '本机存储空间不足，已停止采集；已提交的数据会保留为未完成录像。',
  };
  return { code: error?.code || error?.name || 'UNKNOWN', name: error?.name || 'Error',
    message: names[error?.name] || error?.message || '操作失败，请重试。', stage };
}

function stopTracks(stream) {
  for (const track of stream?.getTracks?.() || []) {
    try { track.stop(); } catch { /* Continue releasing the other tracks. */ }
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

export function recordingExtension(mimeType) {
  const base = String(mimeType).split(';')[0].trim().toLowerCase();
  if (base === 'video/mp4') return 'mp4';
  if (base === 'video/webm') return 'webm';
  if (base === 'video/ogg') return 'ogv';
  throw new CaptureError('UNSUPPORTED_MIME', `无法识别实际录像格式：${base || '未知格式'}`);
}

export function selectRecordingMime(Recorder, withAudio) {
  const candidates = withAudio
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4', 'video/webm'];
  const match = candidates.find(type => {
    try { return Recorder?.isTypeSupported?.(type); } catch { return false; }
  });
  if (!match) throw new CaptureError('ENCODER_UNAVAILABLE', '此浏览器没有可用的录像编码格式，请使用支持录屏的桌面浏览器。');
  return match;
}

/** Atomic chunks + index updates. Only readChunks() materializes blob parts. */
export class IndexedDBRecordingStore {
  constructor({ indexedDB = globalThis.indexedDB, IDBKeyRange = globalThis.IDBKeyRange,
    dbName = DEFAULTS.dbName } = {}) {
    this.indexedDB = indexedDB;
    this.keyRange = IDBKeyRange;
    this.dbName = dbName;
    this.db = null;
    this.openPromise = null;
  }

  open() {
    if (this.db) return Promise.resolve();
    if (this.openPromise) return this.openPromise;
    if (!this.indexedDB || !this.keyRange) {
      return Promise.reject(new CaptureError('STORAGE_UNAVAILABLE', '此环境无法使用 IndexedDB，七天本机暂存不可用，不能开始录屏。'));
    }
    this.openPromise = new Promise((resolve, reject) => {
      let request;
      let settled = false;
      const rejectOnce = error => { if (!settled) { settled = true; reject(error); } };
      try { request = this.indexedDB.open(this.dbName, 1); } catch (error) { rejectOnce(error); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) {
          const chunks = db.createObjectStore('chunks', { keyPath: ['recordingId', 'sequence'] });
          chunks.createIndex('recordingId', 'recordingId', { unique: false });
        }
        if (!db.objectStoreNames.contains('control')) db.createObjectStore('control', { keyPath: 'key' });
      };
      request.onerror = () => rejectOnce(request.error || new CaptureError('STORAGE_OPEN_FAILED', '无法打开本机录像存储。'));
      request.onblocked = () => rejectOnce(new CaptureError('STORAGE_BLOCKED', '其他页面阻止了录像存储升级，请关闭其他训练页面后重试。'));
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true;
        this.db = request.result;
        this.db.onversionchange = () => this.close();
        resolve();
      };
    }).catch(error => { this.openPromise = null; throw error; });
    return this.openPromise;
  }

  _transaction(names, mode, operation) {
    return new Promise((resolve, reject) => {
      let tx;
      let result;
      let operationError;
      try {
        if (!this.db) throw new CaptureError('STORAGE_CLOSED', '本机录像存储已关闭，请重新准备后重试。');
        tx = this.db.transaction(names, mode);
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(operationError || tx.error || new CaptureError('STORAGE_ABORTED', '录像写入被中断。'));
        tx.onerror = () => { /* The abort event carries the transaction result. */ };
        operation(tx, value => { result = value; }, error => {
          operationError = error;
          try { tx.abort(); } catch { reject(error); }
        });
      } catch (error) {
        if (tx) { try { tx.abort(); } catch { /* Already completed. */ } }
        reject(error);
      }
    });
  }

  async probe() {
    const key = `probe-${Math.random().toString(36).slice(2)}`;
    const expected = new Uint8Array([0, 1, 127, 128, 255, 42]);
    let written = false;
    let probeError = null;
    try {
      await this._transaction(['control'], 'readwrite', tx => {
        tx.objectStore('control').put({ key, value: expected.buffer, encoding: 'arraybuffer' });
      });
      written = true;
      const stored = await this._transaction(['control'], 'readonly', (tx, result) => {
        tx.objectStore('control').get(key).onsuccess = event => result(event.target.result);
      });
      const actual = stored?.value instanceof ArrayBuffer ? new Uint8Array(stored.value) : null;
      if (!actual || actual.length !== expected.length || actual.some((byte, index) => byte !== expected[index])) {
        throw new CaptureError('STORAGE_PROBE_MISMATCH', '本机存储写入校验未通过，暂时不能开始录屏。');
      }
    } catch (error) { probeError = error; }
    if (written) {
      try { await this._transaction(['control'], 'readwrite', tx => tx.objectStore('control').delete(key)); }
      catch (error) { probeError ||= error; }
    }
    if (probeError) throw probeError;
  }

  list() {
    return this._transaction(['recordings'], 'readonly', (tx, result) => {
      tx.objectStore('recordings').getAll().onsuccess = event => result(event.target.result);
    });
  }

  get(id) {
    return this._transaction(['recordings'], 'readonly', (tx, result) => {
      tx.objectStore('recordings').get(id).onsuccess = event => result(event.target.result || null);
    });
  }

  create(metadata) {
    return this._transaction(['recordings'], 'readwrite', (tx, result) => {
      tx.objectStore('recordings').add(metadata);
      result(metadata);
    });
  }

  update(id, mutate) {
    return this._transaction(['recordings'], 'readwrite', (tx, result, abort) => {
      const store = tx.objectStore('recordings');
      store.get(id).onsuccess = event => {
        try {
          const old = event.target.result;
          if (!old) throw new CaptureError('NOT_FOUND', '这段录像已不存在，可能已被清理。');
          const next = mutate(old);
          store.put(next);
          result(next);
        } catch (error) { abort(error); }
      };
    });
  }

  async append(id, sequence, blob, committedAt) {
    // Some WebKit storage backends reject Blob/File preparation even when
    // ordinary IndexedDB binary records work. Convert only this queued chunk,
    // before starting a transaction; an await inside it could auto-commit it.
    const data = await blob.arrayBuffer();
    if (!(data instanceof ArrayBuffer) || data.byteLength !== blob.size) {
      throw new CaptureError('CHUNK_CONVERSION_FAILED', '录像数据块转换未通过校验，已停止采集。');
    }
    return this._transaction(['recordings', 'chunks'], 'readwrite', (tx, result, abort) => {
      const metadata = tx.objectStore('recordings');
      metadata.get(id).onsuccess = event => {
        try {
          const old = event.target.result;
          if (!old || old.status !== 'recording' || old.chunkCount !== sequence) {
            throw new CaptureError('CHUNK_CONFLICT', '录像顺序或状态发生冲突，已停止采集。');
          }
          tx.objectStore('chunks').add({ recordingId: id, sequence, data,
            encoding: 'arraybuffer', size: data.byteLength, committedAt });
          const next = { ...old, chunkCount: sequence + 1, bytes: old.bytes + data.byteLength, lastCommittedAt: committedAt };
          metadata.put(next);
          result(next);
        } catch (error) { abort(error); }
      };
    });
  }

  async remove(id, { expiredAt } = {}) {
    const marked = await this._transaction(['recordings'], 'readwrite', (tx, result) => {
      const store = tx.objectStore('recordings');
      store.get(id).onsuccess = event => {
        const old = event.target.result;
        // Recheck inside the write transaction: a concurrent pin must beat an
        // expiry sweep which previously read an unpinned list snapshot.
        if (!old || (expiredAt != null && old.status !== 'deleting' &&
          (old.retained || old.status === 'recording' || old.expiresAt == null || old.expiresAt > expiredAt))) {
          result(false);
          return;
        }
        store.put({ ...old, status: 'deleting' });
        result(true);
      };
    });
    if (!marked) return false;
    await this._transaction(['recordings', 'chunks'], 'readwrite', (tx, result) => {
      const chunks = tx.objectStore('chunks');
      chunks.index('recordingId').openKeyCursor(this.keyRange.only(id)).onsuccess = event => {
        const cursor = event.target.result;
        if (cursor) { chunks.delete(cursor.primaryKey); cursor.continue(); }
        else { tx.objectStore('recordings').delete(id); result(true); }
      };
    });
    return true;
  }

  readChunks(id, maxBytes) {
    return this._transaction(['chunks'], 'readonly', (tx, result, abort) => {
      const parts = [];
      let bytes = 0;
      tx.objectStore('chunks').index('recordingId').openCursor(this.keyRange.only(id)).onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) { result(parts); return; }
        try {
          const chunk = cursor.value;
          // Read pre-existing Blob rows without a database migration. New rows
          // use raw buffers; Blob reconstruction remains an explicit export.
          const part = chunk.encoding === 'arraybuffer' && chunk.data instanceof ArrayBuffer
            ? chunk.data : chunk.encoding == null && chunk.blob instanceof Blob ? chunk.blob : null;
          const size = part instanceof ArrayBuffer ? part.byteLength : part?.size;
          if (!part || !Number.isSafeInteger(chunk.size) || chunk.size < 0 || size !== chunk.size) {
            throw new CaptureError('CHUNK_INVALID', '录像数据块类型或大小不正确，无法安全导出。');
          }
          bytes += size;
          if (bytes > maxBytes) throw new CaptureError('EXPORT_TOO_LARGE', '录像超过此版本的导出内存上限，已取消导出。');
          if (chunk.sequence !== parts.length) throw new CaptureError('CHUNKS_MISSING', '录像数据块缺失，不能生成完整文件。');
          parts.push(part);
          cursor.continue();
        } catch (error) { abort(error); }
      };
    });
  }

  close() {
    this.db?.close();
    this.db = null;
    this.openPromise = null;
  }
}

export class CaptureController extends EventTarget {
  constructor(config = {}, platform = {}) {
    super();
    this.config = { ...DEFAULTS, ...config };
    for (const key of Object.keys(DEFAULTS).filter(key => key !== 'dbName')) {
      if (!Number.isFinite(this.config[key]) || this.config[key] <= 0) throw new TypeError(`Invalid ${key}`);
    }
    if (this.config.lowRemainingRatio >= 1) throw new TypeError('lowRemainingRatio must be less than 1');
    const nav = platform.navigator || globalThis.navigator || {};
    this._media = platform.mediaDevices || nav.mediaDevices;
    this._storage = platform.storage || nav.storage;
    this._locks = platform.locks === null ? null : (platform.locks || nav.locks);
    this._Recorder = platform.MediaRecorder || globalThis.MediaRecorder;
    this._MediaStream = platform.MediaStream || globalThis.MediaStream;
    this._AudioContext = platform.AudioContext || globalThis.AudioContext || globalThis.webkitAudioContext;
    this._secure = platform.isSecureContext ?? globalThis.isSecureContext ?? true;
    this._now = platform.now || Date.now;
    this._uuid = platform.uuid || (() => globalThis.crypto?.randomUUID?.() || `r-${this._now()}-${Math.random().toString(36).slice(2)}`);
    this._timers = platform.timers || globalThis;
    this._visibilityTarget = platform.visibilityTarget || globalThis.document;
    this._store = platform.store || new IndexedDBRecordingStore({
      dbName: this.config.dbName, indexedDB: platform.indexedDB ?? globalThis.indexedDB,
      IDBKeyRange: platform.IDBKeyRange ?? globalThis.IDBKeyRange,
    });
    this._state = { cameraState: 'closed', cameraStream: null, recordingState: 'idle',
      recordingId: null, startedAt: null, bytes: 0, error: null, warning: null,
      audioLabel: '无音频', captureSource: null, prepared: false };
    this._disposed = false;
    this._cameraToken = 0;
    this._active = null;
    this._preparing = null;
    this._cleaning = null;
    this._unlock = null;
    this._lockTask = null;
    this._cleanupTimer = null;
    this._onVisible = () => {
      if (this._visibilityTarget?.visibilityState === 'visible' && this._state.prepared) {
        this.cleanupExpired().catch(error => this._patch({ warning: `到期清理失败，稍后会重试：${error.message}` }));
      }
    };
  }

  get snapshot() { return { ...this._state, error: this._state.error ? { ...this._state.error } : null }; }

  _patch(next) {
    Object.assign(this._state, next);
    const event = new Event('change');
    Object.defineProperty(event, 'detail', { value: this.snapshot });
    this.dispatchEvent(event);
  }

  _assertLive() {
    if (this._disposed) throw new CaptureError('DISPOSED', '采集服务已关闭。');
  }

  _assertPrepared() {
    this._assertLive();
    if (!this._state.prepared) throw new CaptureError('NOT_PREPARED', '本机暂存尚未准备好，请稍后再次点击录屏。');
  }

  async _acquireLock() {
    if (!this._locks?.request) return;
    const acquired = deferred();
    const hold = deferred();
    this._lockTask = this._locks.request(`${this.config.dbName}:capture-controller`, { ifAvailable: true }, async lock => {
      if (!lock) { acquired.resolve(false); return; }
      this._unlock = hold.resolve;
      acquired.resolve(true);
      await hold.promise;
    });
    this._lockTask.catch(() => acquired.resolve(false));
    if (!await acquired.promise) throw new CaptureError('ANOTHER_TAB', '另一个训练页面正在使用录像存储，请关闭那个页面后重试。');
  }

  /** Call on page setup, then enable the record button. Does not ask for media permission. */
  prepare() {
    this._assertLive();
    if (this._state.prepared) return Promise.resolve(this.snapshot);
    if (this._preparing) return this._preparing;
    this._preparing = (async () => {
      try {
        await this._acquireLock();
        await this._store.open();
        await this._store.probe();
        this._assertLive();
        const records = await this._store.list();
        for (const record of records) {
          if (record.status === 'recording') {
            const endedAt = record.lastCommittedAt ?? record.startedAt;
            await this._store.update(record.id, old => ({ ...old, status: 'interrupted', complete: false,
              endedAt, expiresAt: endedAt + this.config.retentionMs,
              stopReason: '页面关闭或录制中断；只保留已提交的数据，不保证可播放。' }));
          }
        }
        this._patch({ prepared: true, error: null,
          warning: this._locks?.request ? null : '此浏览器无法锁定多个页面；请只在一个训练页面使用录像存储。' });
        await this.cleanupExpired();
        await this._checkEstimate();
        this._assertLive();
        this._cleanupTimer = this._timers.setInterval(() => {
          this.cleanupExpired().catch(error => this._patch({ warning: `到期清理失败，稍后会重试：${error.message}` }));
        }, this.config.cleanupIntervalMs);
        this._visibilityTarget?.addEventListener?.('visibilitychange', this._onVisible);
        return this.snapshot;
      } catch (error) {
        this._patch({ prepared: false, error: failure(error, 'storage') });
        this._store.close();
        this._unlock?.();
        this._unlock = null;
        throw error;
      } finally { this._preparing = null; }
    })();
    return this._preparing;
  }

  async openCamera(deviceId) {
    this._assertLive();
    this.closeCamera();
    const token = ++this._cameraToken;
    this._patch({ cameraState: 'requesting', error: null });
    try {
      if (!this._secure || !this._media?.getUserMedia) throw new CaptureError('CAMERA_UNAVAILABLE', '此页面无法使用摄像头，请使用安全连接和支持的浏览器。');
      const stream = await this._media.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true, audio: false });
      if (token !== this._cameraToken || this._disposed) { stopTracks(stream); return null; }
      if (!stream.getVideoTracks().some(track => track.readyState === 'live')) {
        stopTracks(stream);
        throw new CaptureError('CAMERA_ENDED', '摄像头已停止，请重新连接设备。');
      }
      for (const track of stream.getAudioTracks()) track.stop();
      for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => {
        if (this._state.cameraStream === stream) {
          this.closeCamera();
          this._patch({ warning: '摄像头已断开；录屏状态不受影响。' });
        }
      }, { once: true });
      this._patch({ cameraStream: stream, cameraState: 'open' });
      return stream;
    } catch (error) {
      if (token !== this._cameraToken || this._disposed) return null;
      this._patch({ cameraState: 'error', error: failure(error, 'camera') });
      throw error;
    }
  }

  closeCamera() {
    ++this._cameraToken;
    stopTracks(this._state.cameraStream);
    this._patch({ cameraState: 'closed', cameraStream: null });
  }

  async listCameras() {
    this._assertLive();
    if (!this._media?.enumerateDevices) return [];
    const devices = await this._media.enumerateDevices();
    return devices.filter(device => device.kind === 'videoinput').map((device, index) => ({
      deviceId: device.deviceId, label: device.label || `摄像头 ${index + 1}`, groupId: device.groupId,
    }));
  }

  /** Invoke directly from a click handler, without awaiting another operation first. */
  startRecording({ systemAudio = false, microphone = false } = {}) {
    this._assertPrepared();
    if (this._active) return Promise.reject(new CaptureError('ALREADY_RECORDING', '录屏已开始或正在收尾。'));
    if (!this._secure || !this._media?.getDisplayMedia || !this._Recorder || !this._MediaStream) {
      const error = new CaptureError('SCREEN_UNAVAILABLE', '此环境不支持网页录屏，请使用桌面浏览器或设备自带录屏。');
      this._patch({ recordingState: 'error', error: failure(error, 'screen') });
      return Promise.reject(error);
    }
    let selectedMime;
    try { selectedMime = selectRecordingMime(this._Recorder, systemAudio || microphone); }
    catch (error) { this._patch({ recordingState: 'error', error: failure(error, 'encoder') }); return Promise.reject(error); }
    const session = {
      completion: deferred(), cancelled: false, failure: null, writeFailed: false,
      writeTail: Promise.resolve(), pendingBytes: 0, queuedChunks: 0, receivedBytes: 0,
      display: null, mic: null, output: null, audioContext: null, nodes: [], recorder: null,
      metadata: null, finished: false, finishing: false, requestedStop: false,
      selectedMime, options: { systemAudio: Boolean(systemAudio), microphone: Boolean(microphone) },
    };
    this._active = session;
    this._patch({ recordingState: 'requesting', recordingId: null, startedAt: null,
      bytes: 0, error: null, warning: null, audioLabel: '无音频', captureSource: null });
    // This call deliberately precedes every await: preserve transient user activation.
    let displayPromise;
    try { displayPromise = this._media.getDisplayMedia({ video: true, audio: Boolean(systemAudio) }); }
    catch (error) { displayPromise = Promise.reject(error); }
    return this._begin(session, displayPromise);
  }

  async _begin(session, displayPromise) {
    try {
      session.display = await displayPromise;
      if (session.cancelled || this._disposed) { this._release(session); await this._finish(session); return null; }
      const video = session.display.getVideoTracks();
      if (!video.length || video.some(track => track.readyState !== 'live')) throw new CaptureError('SCREEN_ENDED', '所选共享画面已经结束。');
      for (const track of video) track.addEventListener('ended', () => this._requestStop(session, '共享已结束'), { once: true });
      if (!session.options.systemAudio) for (const track of session.display.getAudioTracks()) track.stop();
      if (session.options.microphone) {
        if (!this._media.getUserMedia) throw new CaptureError('MIC_UNAVAILABLE', '此浏览器无法获取麦克风，请关闭麦克风选项后重试。');
        session.mic = await this._media.getUserMedia({ video: false, audio: true });
        if (session.cancelled || this._disposed) { this._release(session); await this._finish(session); return null; }
        if (!session.mic.getAudioTracks().some(track => track.readyState === 'live')) throw new CaptureError('MIC_ENDED', '麦克风没有可用音轨。');
      }
      const systemTracks = session.display.getAudioTracks().filter(track => track.readyState === 'live' && session.options.systemAudio);
      const micTracks = session.mic?.getAudioTracks().filter(track => track.readyState === 'live') || [];
      let audioTracks = [...systemTracks, ...micTracks];
      if (systemTracks.length && micTracks.length) {
        if (!this._AudioContext) throw new CaptureError('MIX_UNAVAILABLE', '此环境无法混合共享音频与麦克风，请只选择一种音频后重试。');
        session.audioContext = new this._AudioContext();
        const destination = session.audioContext.createMediaStreamDestination();
        session.nodes.push(destination);
        for (const tracks of [systemTracks, micTracks]) {
          const node = session.audioContext.createMediaStreamSource(new this._MediaStream(tracks));
          node.connect(destination);
          session.nodes.push(node);
        }
        await session.audioContext.resume();
        if (session.cancelled || this._disposed) { this._release(session); await this._finish(session); return null; }
        if (session.audioContext.state !== 'running') throw new CaptureError('MIX_SUSPENDED', '音频混合尚未启动，请重新点击录屏或只选择一种音频。');
        audioTracks = destination.stream.getAudioTracks();
      }
      const captureSource = video[0].getSettings?.().displaySurface || 'unknown';
      const audioLabel = this._audioLabel(session);
      for (const track of [...systemTracks, ...micTracks]) track.addEventListener('ended', () => {
        if (this._active === session && !session.requestedStop) this._patch({
          audioLabel: this._audioLabel(session), warning: '一条录音音轨已结束，请检查音频状态。',
        });
      }, { once: true });
      session.output = new this._MediaStream([...video, ...audioTracks]);
      const mimeType = selectRecordingMime(this._Recorder, audioTracks.length > 0);
      session.recorder = new this._Recorder(session.output, {
        mimeType, videoBitsPerSecond: this.config.videoBitsPerSecond,
        ...(audioTracks.length ? { audioBitsPerSecond: this.config.audioBitsPerSecond } : {}),
      });
      const actualMime = session.recorder.mimeType || mimeType;
      const startedAt = this._now();
      const id = this._uuid();
      session.metadata = await this._store.create({
        id, status: 'recording', complete: false, retained: false, startedAt, endedAt: null,
        lastCommittedAt: null, expiresAt: null, bytes: 0, chunkCount: 0,
        mimeType: actualMime, extension: recordingExtension(actualMime), captureSource, audioLabel,
        requestedAudio: { ...session.options }, stopReason: null,
        limits: { maxDurationMs: this.config.maxDurationMs, maxExportBytes: this.config.maxExportBytes,
          maxPendingBytes: this.config.maxPendingBytes, retentionMs: this.config.retentionMs },
      });
      if (session.cancelled || this._disposed || video.some(track => track.readyState !== 'live')) {
        session.failure ||= new CaptureError('START_INTERRUPTED', '录制开始前共享已结束，未保存完整录像。');
        this._release(session);
        await this._finish(session);
        return null;
      }
      session.recorder.addEventListener('dataavailable', event => this._onData(session, event.data));
      session.recorder.addEventListener('stop', () => { void this._finish(session); }, { once: true });
      session.recorder.addEventListener('error', event => this._failSession(session,
        event.error || new CaptureError('ENCODER_ERROR', '浏览器编码失败，已停止录屏。')));
      session.recorder.start(this.config.timesliceMs);
      session.recorderStarted = true;
      this._patch({ recordingState: 'recording', recordingId: id, startedAt, captureSource, audioLabel,
        warning: session.options.systemAudio && !systemTracks.length ? '浏览器未提供共享音频，本次只录制实际显示的音轨。' : null });
      session.durationTimer = this._timers.setTimeout(() => {
        this._patch({ warning: '已达到本次录屏的时长上限，正在停止并保存。' });
        this._requestStop(session, '达到时长上限');
      }, this.config.maxDurationMs);
      session.estimateTimer = this._timers.setInterval(() => { void this._checkEstimate(session); }, this.config.estimateIntervalMs);
      void this._checkEstimate(session);
      return { ...session.metadata };
    } catch (error) {
      session.failure ||= error;
      this._release(session);
      await this._finish(session);
      throw error;
    }
  }

  _audioLabel(session) {
    const system = session.options.systemAudio && session.display?.getAudioTracks().some(track => track.readyState === 'live');
    const microphone = session.mic?.getAudioTracks().some(track => track.readyState === 'live');
    const source = session.display?.getVideoTracks()[0]?.getSettings?.().displaySurface;
    const systemLabel = source === 'browser' ? '标签页音频' : '共享音频';
    return system && microphone ? `含${systemLabel}与麦克风` : system ? `含${systemLabel}` : microphone ? '含麦克风' : '无音频';
  }

  _onData(session, blob) {
    if (!blob?.size || session.finished || session.failure) return;
    if (session.pendingBytes + blob.size > this.config.maxPendingBytes) {
      this._failSession(session, new CaptureError('WRITE_BACKLOG', '写入积压超过安全上限，已停止采集；已提交的数据保留为未完成录像。'));
      return;
    }
    if (session.receivedBytes + blob.size > this.config.maxExportBytes) {
      this._failSession(session, new CaptureError('SIZE_LIMIT', '录像达到此版本的导出大小上限，已停止采集；最后一个超限数据块未保存。'));
      return;
    }
    session.receivedBytes += blob.size;
    session.pendingBytes += blob.size;
    const sequence = session.queuedChunks++;
    session.writeTail = session.writeTail.then(async () => {
      if (session.writeFailed) return;
      try {
        session.metadata = await this._store.append(session.metadata.id, sequence, blob, this._now());
        if (this._active === session) this._patch({ bytes: session.metadata.bytes });
      } catch (error) {
        session.writeFailed = true;
        this._failSession(session, error);
      }
    }).finally(() => { session.pendingBytes -= blob.size; });
  }

  _failSession(session, error) {
    if (session.finished) return;
    session.failure ||= error;
    this._patch({ error: failure(session.failure, 'recording') });
    this._requestStop(session, '录制失败');
  }

  _requestStop(session, reason = '用户停止') {
    if (session.finished || session.requestedStop) return;
    session.requestedStop = true;
    session.cancelled = true;
    session.stoppedAt = this._now();
    session.stopReason = reason;
    this._clearRecordingTimers(session);
    if (this._active === session) this._patch({ recordingState: 'stopping' });
    const recorder = session.recorder;
    if (recorder && session.recorderStarted) {
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); }
        catch (error) { session.failure ||= error; }
      }
      session.finalizeTimer = this._timers.setTimeout(() => {
        session.failure ||= new CaptureError('FINALIZE_TIMEOUT', '浏览器没有完成录像收尾，已提交的数据标记为未完成。');
        void this._finish(session);
      }, this.config.finalizeTimeoutMs);
    }
    this._release(session);
    // While the picker, microphone prompt or initial metadata write is pending,
    // _begin() owns completion and stops any stream that arrives afterwards.
    if (session.metadata && !session.recorderStarted && !session.finalizeTimer) void this._finish(session);
  }

  stopRecording() {
    const session = this._active;
    if (!session) return Promise.resolve(null);
    this._requestStop(session);
    return session.completion.promise;
  }

  _clearRecordingTimers(session) {
    this._timers.clearTimeout(session.durationTimer);
    this._timers.clearInterval(session.estimateTimer);
  }

  _release(session) {
    stopTracks(session.display);
    stopTracks(session.mic);
    stopTracks(session.output);
    for (const node of session.nodes.splice(0)) { try { node.disconnect(); } catch { /* Already disconnected. */ } }
    if (session.audioContext) {
      const context = session.audioContext;
      session.audioContext = null;
      try { Promise.resolve(context.close()).catch(() => {}); } catch { /* Already closed. */ }
    }
  }

  async _finish(session) {
    if (session.finishing || session.finished) return session.completion.promise;
    session.finishing = true;
    this._clearRecordingTimers(session);
    this._timers.clearTimeout(session.finalizeTimer);
    this._release(session);
    await session.writeTail;
    let saved = session.metadata;
    if (saved) {
      if (!saved.bytes) session.failure ||= new CaptureError('EMPTY_RECORDING', '没有已保存的视频数据，录像未完成。');
      const endedAt = session.stoppedAt ?? this._now();
      const complete = !session.failure;
      const expiryBase = complete ? endedAt : (saved.lastCommittedAt ?? saved.startedAt);
      try {
        saved = await this._store.update(saved.id, old => ({ ...old, status: complete ? 'complete' : 'incomplete', complete,
          endedAt, expiresAt: expiryBase + this.config.retentionMs,
          stopReason: session.failure ? failure(session.failure, 'recording').message : (session.stopReason || '共享已结束'),
        }));
      } catch (error) {
        session.failure ||= error;
        saved = { ...saved, status: 'incomplete', complete: false, metadataFinalizationFailed: true };
      }
    }
    session.finished = true;
    if (this._active === session) {
      this._active = null;
      this._patch({ recordingState: session.failure ? (saved ? 'incomplete' : 'error') : (saved ? 'saved' : 'idle'),
        bytes: saved?.bytes || 0, error: session.failure ? failure(session.failure, 'recording') : null });
    }
    session.completion.resolve(saved ? { ...saved } : null);
    return saved;
  }

  async _checkEstimate(session) {
    if (!this._storage?.estimate) return null;
    try {
      const estimate = await this._storage.estimate();
      if (this._disposed || (session && (this._active !== session || session.requestedStop))) return estimate;
      const quota = Number(estimate.quota);
      const usage = Number(estimate.usage);
      if (!(quota > 0) || !(usage >= 0)) return estimate;
      const remaining = Math.max(0, quota - usage);
      const elapsedSeconds = session?.metadata ? Math.max(1, (this._now() - session.metadata.startedAt) / 1000) : 0;
      const measuredRate = elapsedSeconds ? session.receivedBytes / elapsedSeconds : 0;
      const estimatedRate = measuredRate || (this.config.videoBitsPerSecond + this.config.audioBitsPerSecond) / 8;
      if (remaining / quota < this.config.lowRemainingRatio || remaining / estimatedRate < this.config.lowRemainingSeconds) {
        const ratio = Math.round(this.config.lowRemainingRatio * 100);
        const seconds = Math.round(this.config.lowRemainingSeconds);
        this._patch({ warning: `本机剩余空间较少（低于 ${ratio}% 或预计不足 ${seconds} 秒）。建议停止录屏并下载重要录像；估计值不是保证。` });
      }
      return estimate;
    } catch {
      if (!this._disposed && (!session || this._active === session)) this._patch({ warning: '浏览器未提供可用的容量估计；实际写入失败时会立即停止录屏。' });
      return null;
    }
  }

  async listRecordings() {
    this._assertPrepared();
    return (await this._store.list()).sort((a, b) => b.startedAt - a.startedAt);
  }

  async getRecordingBlob(id) {
    this._assertPrepared();
    if (this._active?.metadata?.id === id) throw new CaptureError('RECORDING_ACTIVE', '请先停止录屏并等待收尾。');
    const record = await this._store.get(id);
    if (!record || record.status === 'deleting') throw new CaptureError('NOT_FOUND', '这段录像已不存在或正在清理。');
    if (record.status === 'recording') throw new CaptureError('RECORDING_UNFINALIZED', '这段录像还没有收尾，请重新打开页面恢复后再试。');
    if (!record.bytes) throw new CaptureError('EMPTY_RECORDING', '这段录像没有可导出的数据。');
    if (record.bytes > this.config.maxExportBytes) throw new CaptureError('EXPORT_TOO_LARGE', '录像超过此版本的导出大小上限。');
    const parts = await this._store.readChunks(id, this.config.maxExportBytes);
    const blob = new Blob(parts, { type: record.mimeType });
    if (parts.length !== record.chunkCount || blob.size !== record.bytes) throw new CaptureError('CHUNKS_MISSING', '录像索引与实际数据不一致，无法导出完整文件。');
    return blob;
  }

  async setRetained(id, retained) {
    this._assertPrepared();
    if (this._active?.metadata?.id === id) throw new CaptureError('RECORDING_ACTIVE', '请先停止录屏并等待收尾。');
    const result = await this._store.update(id, old => {
      if (old.status === 'deleting') throw new CaptureError('DELETION_PENDING', '这段录像正在删除，无法保留。');
      return { ...old, retained: Boolean(retained) };
    });
    this._patch({});
    return result;
  }

  async deleteRecording(id) {
    this._assertPrepared();
    if (this._active?.metadata?.id === id) throw new CaptureError('RECORDING_ACTIVE', '请先停止录屏并等待收尾。');
    const removed = await this._store.remove(id);
    this._patch({});
    return removed;
  }

  cleanupExpired() {
    this._assertPrepared();
    if (this._cleaning) return this._cleaning;
    this._cleaning = (async () => {
      const removed = [];
      for (const record of await this._store.list()) {
        if (record.id === this._active?.metadata?.id || record.status === 'recording') continue;
        const expired = !record.retained && record.expiresAt != null && record.expiresAt <= this._now();
        if (record.status === 'deleting' || expired) {
          if (await this._store.remove(record.id, { expiredAt: this._now() })) removed.push(record.id);
        }
      }
      if (removed.length) this._patch({});
      return removed;
    })().finally(() => { this._cleaning = null; });
    return this._cleaning;
  }

  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.closeCamera();
    await this.stopRecording();
    if (this._preparing) { try { await this._preparing; } catch { /* Preparation observes disposed. */ } }
    this._timers.clearInterval(this._cleanupTimer);
    this._visibilityTarget?.removeEventListener?.('visibilitychange', this._onVisible);
    if (this._cleaning) { try { await this._cleaning; } catch { /* The deletion marker can be retried next visit. */ } }
    this._store.close();
    this._unlock?.();
    this._unlock = null;
    this._patch({ prepared: false });
  }
}

export const CAPTURE_DEFAULTS = DEFAULTS;
