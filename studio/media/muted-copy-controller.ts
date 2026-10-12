import { createMutedWebmCopy, MAX_MUTED_WEBM_BYTES } from './webm-muted-copy.ts';

/** The workflow knows an ID and eligibility only; it never imports a recording store. */
export type MutedCopyRecord = Readonly<{
  id: string;
  mimeType?: string;
  status?: string;
  complete?: boolean;
}>;
export type DecodedVideoInfo = Readonly<{
  width: number;
  height: number;
  durationSeconds: number;
  decodedFrame: true;
}>;
export type MutedCopyInfo = Readonly<{
  sourceDurationSeconds: number;
  width: number;
  height: number;
  durationSeconds: number;
  removedAudioTracks: number;
  removedAudioBlocks: number;
  sourceBytes: number;
  outputBytes: number;
}>;
export type MutedCopyState = Readonly<{
  phase: 'empty' | 'selected' | 'generating' | 'ready' | 'error';
  record: MutedCopyRecord | null;
  consent: boolean;
  previewUrl: string | null;
  previewed: boolean;
  info: MutedCopyInfo | null;
  error: string | null;
}>;

type TransformResult = Awaited<ReturnType<typeof createMutedWebmCopy>>;
export type MutedCopyDependencies = {
  /** Read-only, called only following explicit consent and generate. */
  load: (id: string) => Promise<Blob>;
  transform?: (source: Blob, options: { signal: AbortSignal }) => Promise<TransformResult>;
  verify?: (blob: Blob, options: { signal: AbortSignal }) => Promise<DecodedVideoInfo>;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  /** Must only start a user-requested download. No persistence or automatic downloads. */
  download?: (url: string, filename: string) => void;
};

const EMPTY_STATE: MutedCopyState = Object.freeze({
  phase: 'empty', record: null, consent: false, previewUrl: null, previewed: false,
  info: null, error: null,
});
const abortError = () => new DOMException('已取消静音副本。', 'AbortError');
const finitePositive = (value: number) => Number.isFinite(value) && value > 0;
function readableError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'WEBM_TOO_LARGE') return '录像超过 256 MiB 的静音副本上限，未处理原录像。';
  if (code === 'WEBM_TOO_COMPLEX') return '此录像结构超过安全处理范围，无法生成静音副本。原录像未改动。';
  if (code === 'UNSUPPORTED_WEBM') return '此 WebM 的编码或结构暂不支持无损去音，无法生成静音副本。原录像未改动。';
  if (code === 'INVALID_WEBM') return '未能验证此 WebM 的完整视频结构，无法安全生成静音副本。原录像未改动。';
  return error instanceof Error ? error.message : '静音副本未通过验证，原录像未改动。';
}

/** Settle immediately on abort even when an injected loader ignores cancellation. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { promise.catch(() => {}); reject(abortError()); return; }
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(abortError()); };
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(value => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) reject(abortError()); else resolve(value);
    }, error => { signal.removeEventListener('abort', cancel); reject(error); });
  });
}

function validDecoded(info: DecodedVideoInfo): boolean {
  return info?.decodedFrame === true && Number.isInteger(info.width) && info.width > 0 &&
    Number.isInteger(info.height) && info.height > 0 && finitePositive(info.durationSeconds);
}

function browserDownload(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  try { anchor.click(); } finally { anchor.remove(); }
}

/**
 * Memory-only select -> consent -> generate -> user preview -> manual download.
 * Call background on visibility/pagehide and dispose on unmount. Nothing here touches
 * the lesson video, MediaRecorder, IndexedDB, retention, training, or source bytes.
 */
export function createMutedCopyController(dependencies: MutedCopyDependencies) {
  const transform = dependencies.transform ?? createMutedWebmCopy;
  const verify = dependencies.verify ?? verifyDecodedVideo;
  const createURL = dependencies.createObjectURL ?? (blob => URL.createObjectURL(blob));
  const revokeURL = dependencies.revokeObjectURL ?? (url => URL.revokeObjectURL(url));
  const startDownload = dependencies.download ?? browserDownload;
  const listeners = new Set<() => void>();
  let state = EMPTY_STATE;
  let epoch = 0;
  let disposed = false;
  let abort: AbortController | null = null;
  let pending: Promise<void> | null = null;
  let output: Blob | null = null;
  let outputURL: string | null = null;

  const publish = (next: MutedCopyState) => {
    state = Object.freeze(next);
    for (const listener of [...listeners]) listener();
  };
  const release = () => {
    epoch++;
    abort?.abort();
    abort = null;
    pending = null;
    output = null;
    if (outputURL !== null) {
      const previous = outputURL;
      outputURL = null;
      revokeURL(previous);
    }
  };
  const reset = (record: MutedCopyRecord | null) => {
    release();
    publish({ ...EMPTY_STATE, record, phase: record ? 'selected' : 'empty' });
  };
  const failure = (message: string) => {
    const record = state.record;
    release();
    publish({ ...EMPTY_STATE, record, phase: 'error', error: message });
  };
  const eligible = (record: MutedCopyRecord): string | null => {
    if (!record.id) return '请先选择一段已完成的录像。';
    if (record.complete === false || (record.status !== undefined && record.status !== 'complete')) {
      return '仅可为已完成的录像生成静音副本。请先完成录像保存。';
    }
    if (record.mimeType && !/^video\/webm(?:\s*;|$)/i.test(record.mimeType)) {
      return '此工具仅支持 WebM 录像，暂不支持 MP4。原录像未改动。';
    }
    return null;
  };

  const controller = {
    getState: (): MutedCopyState => state,
    subscribe(listener: () => void) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    select(record: MutedCopyRecord | null) {
      if (disposed) return;
      // Keep only workflow metadata, never unrelated training text or user content.
      const selected = record ? Object.freeze({ id: record.id, mimeType: record.mimeType,
        status: record.status, complete: record.complete }) : null;
      reset(selected);
    },
    setConsent(consent: boolean) {
      if (disposed || !state.record || consent === state.consent) return;
      if (!consent) { reset(state.record); return; }
      if (state.phase === 'generating' || state.phase === 'ready') return;
      publish({ ...state, consent: true, error: null, phase: 'selected' });
    },
    generate(): Promise<void> {
      if (disposed) return Promise.resolve();
      if (pending) return pending;
      if (!state.record || !state.consent || state.phase === 'ready' || state.phase === 'generating') return Promise.resolve();
      const invalid = eligible(state.record);
      if (invalid) { failure(invalid); return Promise.resolve(); }
      const record = state.record;
      release();
      const generation = epoch;
      const taskAbort = new AbortController();
      abort = taskAbort;
      const signal = taskAbort.signal;
      const current = () => !disposed && generation === epoch && !signal.aborted;
      publish({ ...EMPTY_STATE, record, consent: true, phase: 'generating' });
      // A subscriber can synchronously close/change selection during publication.
      if (!current()) return Promise.resolve();
      const task = Promise.resolve().then(async () => {
        try {
          if (!current()) return;
          const source = await abortable(dependencies.load(record.id), signal);
          if (!current()) return;
          if (!(source instanceof Blob) || source.size === 0) throw new Error('原录像没有可读取的视频数据。');
          if (source.size > MAX_MUTED_WEBM_BYTES) throw new Error('录像超过 256 MiB 的静音副本上限，未处理原录像。');
          if (source.type && !/^video\/webm(?:\s*;|$)/i.test(source.type)) {
            throw new Error('此工具仅支持 WebM 录像，暂不支持 MP4。原录像未改动。');
          }
          const before = await abortable(verify(source, { signal }), signal);
          if (!current()) return;
          if (!validDecoded(before)) throw new Error('未能确认原录像的画面和有限时长，无法安全生成副本。');
          const result = await abortable(transform(source, { signal }), signal);
          if (!current()) return;
          if (!(result.blob instanceof Blob) || result.blob.size === 0) throw new Error('未能生成有效的静音视频。');
          const after = await abortable(verify(result.blob, { signal }), signal);
          if (!current()) return;
          if (!validDecoded(after)) throw new Error('静音副本未通过画面和时长验证，无法下载。');
          const finalVideoTimestamp = result.after.lastVideoTimestampSeconds;
          if (before.width !== after.width || before.height !== after.height ||
              after.durationSeconds > before.durationSeconds + 0.1 ||
              !Number.isFinite(finalVideoTimestamp) || finalVideoTimestamp < 0 ||
              after.durationSeconds + 0.1 < finalVideoTimestamp) {
            throw new Error('副本的画面尺寸或视频时间范围未通过验证，已放弃副本。');
          }
          // Removing an audio-only tail may shorten overall duration. The transform
          // separately proves exact video-payload/timestamp preservation; do not pad it
          // or invent a last-frame duration to match the original audio track.
          if (!result.before.dimensions.some(size => size.width === before.width && size.height === before.height) ||
              !result.after.dimensions.some(size => size.width === after.width && size.height === after.height)) {
            throw new Error('视频容器与浏览器解码的画面尺寸不一致，已放弃副本。');
          }
          const info = Object.freeze({ width: after.width, height: after.height,
            durationSeconds: after.durationSeconds, sourceDurationSeconds: before.durationSeconds, removedAudioTracks: result.removedAudioTracks,
            removedAudioBlocks: result.removedAudioBlocks, sourceBytes: source.size, outputBytes: result.blob.size });
          const readyURL = createURL(result.blob);
          if (!current()) { revokeURL(readyURL); return; }
          output = result.blob;
          outputURL = readyURL;
          publish({ ...EMPTY_STATE, phase: 'ready', record, consent: true,
            previewUrl: outputURL, previewed: false, info });
        } catch (error) {
          if (current()) failure(readableError(error));
        } finally {
          if (generation === epoch) { abort = null; pending = null; }
        }
      });
      pending = task;
      return task;
    },
    /** UI calls this only on the visible muted video playing, never on metadata. */
    markPreviewed(url: string) {
      if (disposed || state.phase !== 'ready' || !state.consent || !state.info ||
          url !== outputURL || url !== state.previewUrl || state.previewed) return;
      publish({ ...state, previewed: true });
    },
    previewFailed(url: string) {
      if (!disposed && state.phase === 'ready' && url === outputURL && url === state.previewUrl) {
        failure('此浏览器未能播放静音副本，副本已丢弃。原录像未改动。');
      }
    },
    download(): boolean {
      if (disposed || state.phase !== 'ready' || !state.consent || !state.previewed ||
          !state.info || !output || !outputURL || state.previewUrl !== outputURL) return false;
      try { startDownload(outputURL, 'lingotrace-muted-copy.webm'); return true; }
      catch { failure('下载未能启动，请重新生成并预览副本。原录像未改动。'); return false; }
    },
    cancel() { if (!disposed) reset(state.record); },
    close() { if (!disposed) reset(null); },
    background() { if (!disposed) reset(state.record); },
    dispose() {
      if (disposed) return;
      disposed = true;
      release();
      listeners.clear();
      state = EMPTY_STATE;
    },
  };
  return controller;
}

export type MutedCopyController = ReturnType<typeof createMutedCopyController>;

export type DecodeVideoOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxSeekSeconds?: number;
  createVideo?: () => HTMLVideoElement;
  createCanvas?: () => HTMLCanvasElement;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
};

/**
 * Independently decode a frame and discover a finite native duration. A new, muted,
 * detached element owns a private URL. It never calls play(). Streaming WebM often
 * initially reports Infinity; a bounded EOF seek lets its demuxer discover duration.
 * Neither currentTime nor container/frame timestamps are substituted for duration.
 */
export function verifyDecodedVideo(blob: Blob, options: DecodeVideoOptions = {}): Promise<DecodedVideoInfo> {
  return new Promise((resolve, reject) => {
    const signal = options.signal;
    if (signal?.aborted) { reject(abortError()); return; }
    const timeoutMs = options.timeoutMs ?? 15000;
    const maxSeekSeconds = options.maxSeekSeconds ?? 24 * 60 * 60;
    if (!finitePositive(timeoutMs) || !finitePositive(maxSeekSeconds)) {
      reject(new Error('视频验证参数无效。')); return;
    }
    let video: HTMLVideoElement | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let url: string | null = null;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    let settled = false;
    let decodedFrame = false;
    let attemptedSeek = false;
    let width = 0;
    let height = 0;
    const createURL = options.createObjectURL ?? (value => URL.createObjectURL(value));
    const revokeURL = options.revokeObjectURL ?? (value => URL.revokeObjectURL(value));
    const setTimer = options.setTimeout ?? globalThis.setTimeout;
    const clearTimer = options.clearTimeout ?? globalThis.clearTimeout;
    const names = ['loadedmetadata', 'loadeddata', 'canplay', 'durationchange', 'seeked', 'error'] as const;
    const cleanup = () => {
      if (timer !== undefined) clearTimer(timer);
      signal?.removeEventListener('abort', onAbort);
      if (video) {
        for (const name of names) video.removeEventListener(name, onMedia);
        try { video.pause(); } catch {}
        try { video.removeAttribute('src'); video.load(); } catch {}
        video.remove();
      }
      if (canvas) { canvas.width = 0; canvas.height = 0; canvas.remove(); }
      if (url !== null) { revokeURL(url); url = null; }
      video = null;
      canvas = null;
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      const durationSeconds = video?.duration ?? NaN;
      cleanup();
      if (error) reject(error);
      else resolve(Object.freeze({ width, height, durationSeconds, decodedFrame: true }));
    };
    const onAbort = () => finish(abortError());
    const onMedia = (event?: Event) => {
      if (settled || !video) return;
      if (signal?.aborted) { onAbort(); return; }
      if (event?.type === 'error' || video.error) { finish(new Error('此浏览器无法解码录像，未生成可下载副本。')); return; }
      try {
        if (!decodedFrame && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          width = video.videoWidth;
          height = video.videoHeight;
          canvas = (options.createCanvas ?? (() => document.createElement('canvas')))();
          canvas.width = 2; canvas.height = 2;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('此浏览器无法验证视频画面。');
          context.drawImage(video, 0, 0, 2, 2);
          // A read confirms a native decoded, drawable frame, rather than metadata only.
          context.getImageData(0, 0, 1, 1);
          decodedFrame = true;
        }
        if (!decodedFrame) return;
        if (finitePositive(video.duration)) {
          if (video.duration > maxSeekSeconds) throw new Error('录像时长超出安全验证范围，未生成副本。');
          finish();
        } else if (!attemptedSeek) {
          attemptedSeek = true;
          video.currentTime = maxSeekSeconds;
        }
      } catch (error) { finish(error instanceof Error ? error : new Error('无法验证视频画面。')); }
    };
    try {
      video = (options.createVideo ?? (() => document.createElement('video')))();
      video.muted = true;
      video.defaultMuted = true;
      video.volume = 0;
      video.autoplay = false;
      video.controls = false;
      video.preload = 'auto';
      video.playsInline = true;
      for (const name of names) video.addEventListener(name, onMedia);
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimer(() => finish(new Error(decodedFrame
        ? '浏览器仍未提供有限录像时长，无法确认副本完整性。原录像未改动。'
        : '未能解码录像画面，未生成可下载副本。')), timeoutMs);
      url = createURL(blob);
      video.src = url;
      video.load();
      onMedia();
    } catch (error) { finish(error instanceof Error ? error : new Error('视频验证失败。')); }
  });
}
