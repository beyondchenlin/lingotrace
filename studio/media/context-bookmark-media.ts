import { captureBodyReadDiagnostic, reviewBodyReadDiagnostic, reviewMediaDiagnostic, reviewRangeDiagnostic, type BodyReadDiagnostic } from './media-load-diagnostic.ts';
/** Verified course media only. No recording streams, audio graph, or persisted cache. */
type CourseMediaAssetDescriptor = Readonly<{ url: string; mediaId: string; mediaSha256: string }>;
export type CourseMediaDescriptor = CourseMediaAssetDescriptor & Readonly<{
  /** Explicitly audited playback bytes; the original source identity remains unchanged. */
  playbackVariant?: CourseMediaAssetDescriptor;
  /** Narrow native AAC recovery for this immutable, full-hash playback variant. */
  allowVerifiedDirect?: true;
}>;
export const ORIGINAL_COURSE_MEDIA = Object.freeze({
  url: '/studio-assets/06-cafe.mp4',
  mediaId: 'cafe-original-video-v1',
  mediaSha256: '22fc25ade368f351cda21951916e559ff359cf1ac8419fbfa5444e050cdbf740',
});

/** Capture a canonical same-origin asset identity, never a caller-mutable binding. */
function captureMediaAssetDescriptor(descriptor: CourseMediaAssetDescriptor): CourseMediaAssetDescriptor {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new TypeError('课程片段媒体描述无效。');
  }
  const { url, mediaId, mediaSha256 } = descriptor;
  if (typeof url !== 'string' || !/^\/studio-assets\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(url) ||
      url.slice(1).split('/').some(segment => !segment || segment === '.' || segment === '..') ||
      typeof mediaId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(mediaId) ||
      typeof mediaSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(mediaSha256)) {
    throw new TypeError('课程片段媒体描述必须包含同源资源路径、媒体标识和完整 SHA-256 校验值。');
  }
  return Object.freeze({ url, mediaId, mediaSha256 });
}

function captureMediaDescriptor(descriptor: CourseMediaDescriptor): CourseMediaDescriptor {
  const source = captureMediaAssetDescriptor(descriptor);
  const variant = descriptor.playbackVariant === undefined ? undefined : captureMediaAssetDescriptor(descriptor.playbackVariant);
  if (descriptor.allowVerifiedDirect !== undefined && (descriptor.allowVerifiedDirect !== true ||
      !variant || !variant.url.endsWith(`${variant.mediaSha256}.mp4`))) {
    throw new TypeError('直接播放许可必须绑定含完整 SHA-256 文件名的明确播放版本。');
  }
  return variant === undefined ? source : Object.freeze({ ...source, playbackVariant: variant,
    ...(descriptor.allowVerifiedDirect ? { allowVerifiedDirect: true as const } : {}) });
}

export type CourseMediaTransport = 'blob' | 'verified-direct';
export type OriginalCourseMediaLease = Readonly<{
  url: string;
  mediaId: string;
  mediaSha256: string;
  /** Captured playback identity, present only when explicitly configured. */
  playbackVariant?: CourseMediaAssetDescriptor;
  /** SHA-256 of the bytes actually fetched, including when they are a variant. */
  actualSha256: string | null;
  verified: boolean;
  verificationError: string | null;
  /** Omitted for legacy pools; omitted transport always means Blob. */
  transport?: CourseMediaTransport;
  /** Set only after this pool verifies response identity and the actual fetched bytes. */
  verifiedResourceUrl?: string;
  /** Pool-owned, live-holder capability; both immutable views share one release.
   * Native URL loading may make its own request; this is not browser-enforced SRI. */
  toVerifiedDirect?: () => OriginalCourseMediaLease;
  release: () => void;
}>;
export type OriginalCourseMediaPool = {
  acquire: (options?: { signal?: AbortSignal; retry?: boolean }) => Promise<OriginalCourseMediaLease>;
};
export type OriginalCourseMediaDependencies = {
  fetch?: (url: string, options: { signal: AbortSignal; redirect?: 'error' }) => Promise<Pick<Response, 'ok' | 'blob'> & Partial<Pick<Response, 'status' | 'type' | 'url' | 'redirected' | 'headers' | 'bodyUsed' | 'body'>>>;
  /** Defaults to the browser's current origin; injected only for deterministic tests. */
  origin?: string;
  digest?: (bytes: ArrayBuffer) => Promise<ArrayBuffer>;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
};

function directResourceUrl(media: CourseMediaDescriptor, explicitOrigin?: string): string {
  const origin = explicitOrigin ?? (typeof location === 'undefined' ? '' : location.origin);
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new TypeError('直接播放需要可验证的 HTTPS 同源资源。'); }
  if (parsed.protocol !== 'https:' || parsed.origin !== origin || !media.allowVerifiedDirect || !media.playbackVariant) {
    throw new TypeError('直接播放需要可验证的 HTTPS 同源资源。');
  }
  return new URL(media.playbackVariant.url, origin).href;
}

type DirectHolderAuthority = { resourceUrl: string; live: () => boolean };
// Capability provenance is private. Copying public lease fields cannot copy ownership.
const directHolders = new WeakMap<OriginalCourseMediaLease, DirectHolderAuthority>();

/** Raw native signature only; sanitized display diagnostics never authorize recovery. */
export function isExactNativeAACError(error: { code?: number; message?: string } | null | undefined): boolean {
  try { return error?.code === 4 && error.message === 'PipelineStatus::DEMUXER_ERROR_DETECTED_AAC'; }
  catch { return false; }
}

/** Verify both the original source binding and the exact authorized playback bytes. */
export function isVerifiedCourseMediaLease(
  candidate: OriginalCourseMediaLease | null | undefined,
  descriptor: CourseMediaDescriptor,
  origin?: string,
): boolean {
  let media: CourseMediaDescriptor;
  try { media = captureMediaDescriptor(descriptor); }
  catch { return false; }
  if (!candidate || candidate.verified !== true || candidate.mediaId !== media.mediaId ||
      candidate.mediaSha256 !== media.mediaSha256) return false;
  const expected = media.playbackVariant;
  const actual = candidate.playbackVariant;
  if (expected) {
    if (!actual || actual.url !== expected.url || actual.mediaId !== expected.mediaId ||
        actual.mediaSha256 !== expected.mediaSha256) return false;
  } else if (actual !== undefined) return false;
  if (candidate.actualSha256 !== (expected ?? media).mediaSha256) return false;
  if (candidate.transport !== undefined && candidate.transport !== 'blob' && candidate.transport !== 'verified-direct') return false;
  const authority = directHolders.get(candidate);
  if (authority || candidate.verifiedResourceUrl !== undefined || candidate.toVerifiedDirect !== undefined || candidate.transport === 'verified-direct') {
    let expectedUrl: string;
    try { expectedUrl = directResourceUrl(media, origin); } catch { return false; }
    if (!authority || !authority.live() || authority.resourceUrl !== expectedUrl || candidate.verifiedResourceUrl !== expectedUrl) return false;
    if (candidate.transport === 'verified-direct' && candidate.url !== expectedUrl) return false;
  }
  return true;
}

const aborted = () => new DOMException('原片预览已取消。', 'AbortError');
const HASH_FAILURE = '原片字节校验不匹配，不能播放当前片段。请重新加载原片后重试。 [hash; SHA256_MISMATCH]';
const DIGEST_FAILURE = '无法完成原片 SHA-256 字节校验，不能播放当前片段。请重新加载后重试。';
const RECORDING_BLOCKED = '录制准备、录制或收尾期间不能播放语境书签。结束后请手动播放。';

/** An abort settles a caller even if an injected/native operation ignores its signal. */
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(aborted()); };
    if (signal.aborted) { operation.catch(() => {}); reject(aborted()); return; }
    signal.addEventListener('abort', cancel, { once: true });
    operation.then(value => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) reject(aborted()); else resolve(value);
    }, error => { signal.removeEventListener('abort', cancel); reject(error); });
  });
}

/**
 * One fetch, one temporary digest buffer and one Blob URL per retained generation.
 * Each acquisition reserves a reference before awaiting. Last release aborts pending
 * work or revokes the URL. A late abandoned result cannot create a resident URL.
 * Invalid bytes may still serve the ordinary lesson; bookmark playback fails closed.
 * retry:true explicitly replaces an invalid generation without breaking old leases.
 */
export function createOriginalCourseMediaPool(
  dependencies: OriginalCourseMediaDependencies = {},
  descriptor: CourseMediaDescriptor = ORIGINAL_COURSE_MEDIA,
): OriginalCourseMediaPool {
  const media = captureMediaDescriptor(descriptor);
  const playback = media.playbackVariant ?? media;
  const origin = dependencies.origin;
  // React may construct a pool during server rendering. Resolve an implicit
  // browser origin only when acquiring; no authority exists before fetching.
  if (media.allowVerifiedDirect && origin !== undefined) directResourceUrl(media, origin);
  const fetchMedia = dependencies.fetch ?? ((url, options) => fetch(url, options));
  const digest = dependencies.digest ?? (bytes => crypto.subtle.digest('SHA-256', bytes));
  const createURL = dependencies.createObjectURL ?? (blob => URL.createObjectURL(blob));
  const revokeURL = dependencies.revokeObjectURL ?? (url => URL.revokeObjectURL(url));
  type Result = Omit<OriginalCourseMediaLease, 'release' | 'toVerifiedDirect'>;
  type Generation = { refs: number; abandoned: boolean; abort: AbortController; url: string | null;
    result: Result | null; work: Promise<Result> };
  let current: Generation | null = null;
  const discard = (generation: Generation) => {
    if (generation.abandoned) return;
    generation.abandoned = true;
    generation.abort.abort();
    if (current === generation) current = null;
    if (generation.url) { const url = generation.url; generation.url = null; revokeURL(url); }
    generation.result = null;
  };
  const begin = (): Generation => {
    const generation: Generation = { refs: 0, abandoned: false, abort: new AbortController(), url: null,
      result: null, work: null as unknown as Promise<Result> };
    generation.work = Promise.resolve().then(async () => {
      if (generation.abandoned) throw aborted();
      const resourceUrl = media.allowVerifiedDirect ? directResourceUrl(media, origin) : null;
      let blob: Blob;
      let failureCode = 'NETWORK';
      let bodyDiagnostic: BodyReadDiagnostic | undefined;
      try {
        const response = await fetchMedia(resourceUrl ?? playback.url, { signal: generation.abort.signal,
          ...(resourceUrl ? { redirect: 'error' as const } : {}) });
        if (generation.abandoned) throw aborted();
        if (!response.ok) { failureCode = Number.isInteger(response.status) ? `HTTP_${response.status}` : 'HTTP_ERROR'; throw new Error('原片请求失败。'); }
        if (resourceUrl) {
          failureCode = 'RESOURCE_IDENTITY';
          if (response.type !== 'basic' || response.redirected !== false || response.url !== resourceUrl) throw new Error('播放资源地址、同源响应或重定向验证失败。');
          failureCode = 'MIME';
          if (response.headers?.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'video/mp4') throw new Error('播放资源类型不是 video/mp4。');
        }
        failureCode = 'BODY';
        bodyDiagnostic = captureBodyReadDiagnostic(response);
        blob = await response.blob();
        if (generation.abandoned) throw aborted();
        if (!(blob instanceof Blob) || blob.size === 0) { failureCode = 'EMPTY_BODY'; throw new Error('原片没有可读取的视频字节。'); }
      } catch (error) {
        if (generation.abandoned) throw aborted();
        const detail = failureCode === 'BODY' && bodyDiagnostic ?
          ` ${reviewBodyReadDiagnostic(error, generation.abort.signal.aborted, bodyDiagnostic)}` : '';
        throw new Error(`原片未能加载，请手动重试。 [fetch; ${failureCode}]${detail}`, { cause: error });
      }
      let actualSha256: string | null = null;
      let verificationError: string | null = null;
      try {
        // Do not retain this large buffer in the generation or in a lease.
        const bytes = await blob.arrayBuffer();
        if (generation.abandoned) throw aborted();
        const result = await digest(bytes);
        if (generation.abandoned) throw aborted();
        if (result.byteLength !== 32) throw new Error('Invalid SHA-256 output.');
        actualSha256 = Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
        if (actualSha256 !== playback.mediaSha256) verificationError = HASH_FAILURE;
      } catch (error) {
        if (generation.abandoned) throw aborted();
        verificationError = `${DIGEST_FAILURE} [hash; SHA256_UNAVAILABLE]`;
      }
      if (generation.abandoned) throw aborted();
      const url = createURL(blob);
      if (generation.abandoned) { revokeURL(url); throw aborted(); }
      generation.url = url;
      generation.result = Object.freeze({ url, mediaId: media.mediaId,
        mediaSha256: media.mediaSha256, actualSha256,
        ...(media.playbackVariant ? { playbackVariant: media.playbackVariant } : {}),
        ...(resourceUrl ? { transport: 'blob' as const,
          ...(actualSha256 === playback.mediaSha256 ? { verifiedResourceUrl: resourceUrl } : {}) } : {}),
        verified: actualSha256 === playback.mediaSha256, verificationError });
      return generation.result;
    });
    // Callers have their own rejection handlers; keep abandoned work observed too.
    generation.work.catch(() => {});
    return generation;
  };
  return {
    acquire(options = {}) {
      if (options.signal?.aborted) return Promise.reject(aborted());
      if (!current || current.abandoned || (options.retry && current.result && !current.result.verified)) {
        current = begin();
      }
      const generation = current;
      generation.refs++;
      let released = false;
      const signal = options.signal;
      const release = () => {
        if (released) return;
        released = true;
        signal?.removeEventListener('abort', release);
        if (--generation.refs === 0) discard(generation);
      };
      signal?.addEventListener('abort', release, { once: true });
      return (signal ? abortable(generation.work, signal) : generation.work).then(result => {
        if (released || signal?.aborted) throw aborted();
        if (!result.verifiedResourceUrl) return Object.freeze({ ...result, release });
        const authority: DirectHolderAuthority = { resourceUrl: result.verifiedResourceUrl,
          live: () => !released && !signal?.aborted && !generation.abandoned };
        let direct: OriginalCourseMediaLease | null = null;
        const toVerifiedDirect = (): OriginalCourseMediaLease => {
          if (!authority.live()) throw aborted();
          // The origin can change independently of an injected holder's lifetime.
          if (directResourceUrl(media, origin) !== authority.resourceUrl) throw new TypeError('原片同源资源绑定已失效。');
          if (!direct) {
            direct = Object.freeze({ ...result, url: authority.resourceUrl, transport: 'verified-direct', toVerifiedDirect, release });
            directHolders.set(direct, authority);
          }
          return direct;
        };
        const holder = Object.freeze({ ...result, toVerifiedDirect, release });
        directHolders.set(holder, authority);
        return holder;
      }).catch(error => { release(); throw error; });
    },
  };
}

export type ContextBookmarkMediaReference = Readonly<{
  materialId: string; materialVersion: string; cueId: string; text: string;
  startSeconds: number; endSeconds: number; mediaId: string; mediaSha256: string;
}>;
export type ContextBookmarkMonitor = Readonly<{ volume: number; courseMuted: boolean; allMuted: boolean }>;
export type ContextBookmarkPreviewState = Readonly<{
  phase: 'empty' | 'selected' | 'loading' | 'ready' | 'playing' | 'error';
  reference: ContextBookmarkMediaReference | null;
  duration: number | null; currentTime: number | null; error: string | null; recordingBlocked: boolean;
}>;
export type ContextBookmarkPreviewDependencies = {
  /** A dedicated preview element. Never pass the lesson or a recording element. */
  video: HTMLVideoElement;
  pool: OriginalCourseMediaPool;
  /** Explicit authority for this controller; omitting it preserves the cafe source. */
  media?: CourseMediaDescriptor;
  /** Must check against the current material, version, cue text and cue boundaries. */
  validateReference: (reference: ContextBookmarkMediaReference) => string | null;
  monitor?: ContextBookmarkMonitor;
  /** Synchronous guard, in addition to setRecordingBlocked before starting capture. */
  isRecordingBlocked?: () => boolean;
  lifecycle?: { documentTarget?: EventTarget; windowTarget?: EventTarget; isHidden?: () => boolean };
  metadataTimeoutMs?: number;
  /** Same current-origin check as the source pool; defaults to location.origin. */
  origin?: string;
};
const EMPTY: ContextBookmarkPreviewState = Object.freeze({ phase: 'empty', reference: null,
  duration: null, currentTime: null, error: null, recordingBlocked: false });
const volume = (value: number) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
const message = (error: unknown) => error instanceof Error ? error.message : '原片片段无法播放，请手动重试。';

/**
 * Selection/loading never plays. Invoke play() from the user's explicit button.
 * Native playback remains confined to the verified cue and actual finite duration.
 * This controller never creates audio nodes, capture streams, or recording tracks.
 */
export function createContextBookmarkPreviewController(dependencies: ContextBookmarkPreviewDependencies) {
  const media = captureMediaDescriptor(dependencies.media === undefined ? ORIGINAL_COURSE_MEDIA : dependencies.media);
  const video = dependencies.video;
  const documentTarget = dependencies.lifecycle?.documentTarget ?? (typeof document === 'undefined' ? undefined : document);
  const windowTarget = dependencies.lifecycle?.windowTarget ?? (typeof window === 'undefined' ? undefined : window);
  const isHidden = dependencies.lifecycle?.isHidden ?? (() => typeof document !== 'undefined' && document.hidden);
  const listeners = new Set<() => void>();
  let state = EMPTY;
  let monitor = dependencies.monitor ?? { volume: 0.8, courseMuted: false, allMuted: false };
  let disposed = false, epoch = 0, playEpoch = 0, explicitPlay = false, pageHidden = false;
  let recordingBlocked = false;
  let lease: OriginalCourseMediaLease | null = null;
  let loadAbort: AbortController | null = null, playAbort: AbortController | null = null;
  let loading: Promise<void> | null = null, playing: Promise<void> | null = null;
  let boundaryTimer: ReturnType<typeof setTimeout> | null = null;
  const blocked = () => recordingBlocked || !!dependencies.isRecordingBlocked?.();
  const hidden = () => pageHidden || isHidden();
  const publish = (next: ContextBookmarkPreviewState) => {
    if (disposed) return;
    state = Object.freeze({ ...next, recordingBlocked: blocked() });
    for (const listener of [...listeners]) listener();
  };
  const clearBoundary = () => { if (boundaryTimer !== null) clearTimeout(boundaryTimer); boundaryTimer = null; };
  const applyMonitor = () => {
    video.volume = volume(monitor.volume);
    // Keep interrupted and unloaded elements silent even if an old play resolves.
    video.muted = monitor.courseMuted || monitor.allMuted || blocked() || hidden() || !explicitPlay;
  };
  const halt = () => {
    playEpoch++; explicitPlay = false; clearBoundary();
    playAbort?.abort(); playAbort = null; playing = null;
    video.muted = true; video.pause();
  };
  const clearSource = () => {
    epoch++; loadAbort?.abort(); loadAbort = null; loading = null;
    const previous = lease; lease = null;
    halt();
    video.removeAttribute('src'); video.load();
    previous?.release();
  };
  const fail = (error: string) => {
    const reference = state.reference;
    clearSource();
    publish({ ...EMPTY, reference, phase: 'error', error });
  };
  const invalid = (reference: ContextBookmarkMediaReference | null): string | null => {
    if (!reference || !reference.materialId || !reference.materialVersion || !reference.cueId || !reference.text) {
      return '这条书签没有完整的原片出处，不能播放。';
    }
    if (reference.mediaId !== media.mediaId || reference.mediaSha256 !== media.mediaSha256) {
      return '书签的媒体标识或校验值与当前原片不一致，不能播放。';
    }
    if (!Number.isFinite(reference.startSeconds) || !Number.isFinite(reference.endSeconds) ||
        reference.startSeconds < 0 || reference.endSeconds <= reference.startSeconds) {
      return '书签的片段时间范围无效，不能播放。';
    }
    try { return dependencies.validateReference(reference); }
    catch { return '无法核对书签与当前原片版本，不能播放。'; }
  };
  const validDuration = () => Number.isFinite(video.duration) && video.duration > 0 &&
    !!state.reference && state.reference.startSeconds >= 0 && state.reference.endSeconds <= video.duration;
  const rangeDiagnostic = () => reviewRangeDiagnostic(video.duration, state.reference?.startSeconds ?? NaN,
    state.reference?.endSeconds ?? NaN, lease?.transport ?? 'blob', video.readyState);
  const rangeFailure = () => `片段时间范围超过原片实际有限时长，不能播放。 ${rangeDiagnostic()}`;
  const authorizedLease = (candidate: OriginalCourseMediaLease | null) => isVerifiedCourseMediaLease(candidate, media, dependencies.origin) &&
    state.reference?.mediaId === media.mediaId &&
    state.reference.mediaSha256 === media.mediaSha256;
  const authorizedSource = () => authorizedLease(lease) && !!lease &&
    video.src === lease.url && (lease.transport === 'verified-direct'
      ? video.currentSrc === lease.url : !video.currentSrc || video.currentSrc === lease.url);
  const canContinue = () => !disposed && !blocked() && !hidden() && video.readyState >= 1 && !video.error && authorizedSource() &&
    !invalid(state.reference) && validDuration();
  const pauseReady = (error: string | null = null) => {
    halt();
    if (lease && state.reference) publish({ ...state, phase: 'ready', currentTime: video.currentTime, error });
  };
  const stopAtEnd = () => {
    const end = state.reference?.endSeconds;
    halt();
    if (end !== undefined && validDuration() && video.currentTime !== end) video.currentTime = end;
    if (lease) publish({ ...state, phase: 'ready', currentTime: end ?? video.currentTime, error: null });
  };
  const scheduleBoundary = () => {
    clearBoundary();
    if (!explicitPlay || video.paused || !state.reference) return;
    const seconds = (state.reference.endSeconds - video.currentTime) / Math.max(0.01, video.playbackRate || 1);
    boundaryTimer = setTimeout(() => { boundaryTimer = null; inspectPlayback(); }, Math.max(10, Math.min(100, seconds * 1000)));
  };
  const inspectPlayback = () => {
    if (disposed || !lease || state.phase === 'loading') return;
    if (!authorizedSource()) { fail('预览媒体来源发生变化，已停止原片片段。'); return; }
    const problem = invalid(state.reference);
    if (problem) { fail(problem); return; }
    if (!validDuration()) { fail(rangeFailure()); return; }
    if (blocked() || hidden()) { pauseReady(blocked() ? RECORDING_BLOCKED : null); return; }
    const reference = state.reference!;
    if (video.currentTime >= reference.endSeconds) { stopAtEnd(); return; }
    if (video.currentTime < reference.startSeconds) video.currentTime = reference.startSeconds;
    if (!explicitPlay && !video.paused) { pauseReady(); return; }
    if (explicitPlay) {
      publish({ ...state, phase: video.paused ? 'ready' : 'playing', duration: video.duration, currentTime: video.currentTime, error: null });
      scheduleBoundary();
    }
  };
  const onPlay = () => {
    if (!explicitPlay || !canContinue()) {
      halt();
      if (lease && state.phase !== 'loading') publish({ ...state, phase: 'ready', error: blocked() ? RECORDING_BLOCKED : state.error });
      return;
    }
    inspectPlayback();
  };
  const onPause = () => {
    // A queued pause event from a previous request must not silence a newer
    // native playback that is already running on this same element.
    if (!video.paused) return;
    clearBoundary();
    if (explicitPlay && lease && state.phase !== 'loading') {
      explicitPlay = false; playEpoch++; playAbort?.abort(); playAbort = null; playing = null;
      applyMonitor(); publish({ ...state, phase: 'ready', currentTime: video.currentTime });
    }
  };
  const transportDiagnostic = () => `[transport=${lease?.transport ?? 'blob'}]`;
  const metadataTimeoutFailure = () => new Error(`原片元数据加载超时，请手动重试。 ${reviewMediaDiagnostic('metadata', video)} ${transportDiagnostic()} ${rangeDiagnostic()}`);
  const exactAACMetadataErrors = new WeakSet<Error>();
  // Read the native error while its failed source still owns the element.
  const onError = () => {
    if (!lease || state.phase === 'loading') return;
    const exactAAC = isExactNativeAACError(video.error);
    const error = `浏览器无法解码这段原片，不能播放。 ${reviewMediaDiagnostic('playback', video)} ${transportDiagnostic()} ${rangeDiagnostic()}`;
    if (exactAAC && startDirectRecovery()) return;
    fail(error);
  };
  const onEnded = () => { if (lease && state.phase !== 'loading') stopAtEnd(); };
  const waitForMetadata = (signal: AbortSignal, current: () => boolean,
    expected: OriginalCourseMediaLease, deadline: number) => new Promise<void>((resolve, reject) => {
    const reference = state.reference;
    const progressEvents = ['loadedmetadata', 'durationchange', 'loadeddata', 'canplay'];
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clean = () => {
      settled = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      for (const event of progressEvents) video.removeEventListener(event, ready);
      video.removeEventListener('error', error);
      signal.removeEventListener('abort', cancel);
    };
    const rejectWith = (failure: Error) => { if (!settled) { clean(); reject(failure); } };
    const cancel = () => rejectWith(aborted());
    // Every event remains bound to this live request, reference and holder.
    // An unknown duration never relaxes provenance, lifecycle or recording gates.
    const active = () => {
      if (settled) return false;
      if (signal.aborted || !current() || lease !== expected || state.reference !== reference) { cancel(); return false; }
      if (blocked() || hidden()) { controller.background(); cancel(); return false; }
      if (!authorizedSource()) { rejectWith(new Error('预览媒体来源与已验证原片不一致，不能播放。')); return false; }
      const problem = invalid(reference);
      if (problem) { rejectWith(new Error(problem)); return false; }
      return true;
    };
    const nativeFailure = () => {
      if (Date.now() >= deadline) { timeout(); return; }
      const exactAAC = isExactNativeAACError(video.error);
      const failure = new Error(`浏览器无法读取原片元数据，不能播放。 ${reviewMediaDiagnostic('metadata', video)} ${transportDiagnostic()} ${rangeDiagnostic()}`);
      if (exactAAC) exactAACMetadataErrors.add(failure);
      rejectWith(failure);
    };
    const timeout = () => rejectWith(metadataTimeoutFailure());
    const ready = () => {
      if (!active()) return;
      if (Date.now() >= deadline) { timeout(); return; }
      if (video.error) { nativeFailure(); return; }
      // Some native decoders emit loadedmetadata before their finite duration.
      // Keep the same deadline; the first usable measurement is still exact.
      if (video.readyState < 1 || !Number.isFinite(video.duration) || video.duration <= 0) return;
      if (!validDuration()) { rejectWith(new Error(rangeFailure())); return; }
      clean(); resolve();
    };
    const error = () => { if (active()) nativeFailure(); };
    for (const event of progressEvents) video.addEventListener(event, ready);
    video.addEventListener('error', error);
    signal.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      if (!active()) return;
      timeout();
    }, Math.max(0, deadline - Date.now()));
    if (signal.aborted) cancel();
  });

  const convertToDirect = (current: () => boolean): boolean => {
    const previous = lease, reference = state.reference;
    if (!current() || blocked() || hidden() || !previous || previous.transport !== 'blob' ||
        !previous.toVerifiedDirect || !authorizedSource() || invalid(reference)) return false;
    let direct: OriginalCourseMediaLease;
    try { if (!current()) return false; direct = previous.toVerifiedDirect(); } catch { return false; }
    if (!current() || lease !== previous || state.reference !== reference || blocked() || hidden() ||
        !authorizedSource() || !authorizedLease(direct) || direct.transport !== 'verified-direct') return false;
    halt();
    // halt/pause listeners may synchronously switch material or start recording.
    if (!current() || lease !== previous || state.reference !== reference || blocked() || hidden() ||
        !authorizedSource() || !authorizedLease(direct)) return false;
    // This is a view of the same holder, never a second acquisition or release.
    lease = direct;
    return true;
  };
  const loadMetadata = async (current: () => boolean, signal: AbortSignal) => {
    // One bounded metadata operation, including the sole authorized AAC retry.
    const deadline = Date.now() + (dependencies.metadataTimeoutMs ?? 15000);
    for (;;) {
      if (!current()) throw aborted();
      if (blocked() || hidden()) { controller.background(); throw aborted(); }
      if (Date.now() >= deadline) throw metadataTimeoutFailure();
      const expected = lease;
      if (!expected || !authorizedLease(expected)) throw new Error(HASH_FAILURE);
      video.autoplay = false; video.loop = false; video.preload = 'metadata'; video.crossOrigin = 'anonymous'; applyMonitor();
      const metadata = waitForMetadata(signal, current, expected, deadline);
      metadata.catch(() => {});
      try {
        if (Date.now() >= deadline) throw metadataTimeoutFailure();
        video.src = expected.url;
        if (!current() || lease !== expected) throw aborted();
        if (blocked() || hidden()) { controller.background(); throw aborted(); }
        if (Date.now() >= deadline) throw metadataTimeoutFailure();
        video.load();
        await metadata;
        if (Date.now() >= deadline) throw metadataTimeoutFailure();
        return;
      } catch (error) {
        if (!current()) throw aborted();
        if (Date.now() >= deadline) throw metadataTimeoutFailure();
        if (!(error instanceof Error) || !exactAACMetadataErrors.has(error) ||
            !convertToDirect(() => current() && Date.now() < deadline)) {
          if (Date.now() >= deadline) throw metadataTimeoutFailure();
          throw error;
        }
        // Conversion changes the holder view to direct, so another native error
        // can never satisfy the Blob-only retry guard.
      }
    }
  };
  const acceptMetadata = (reference: ContextBookmarkMediaReference) => {
    const changed = invalid(reference);
    if (changed) throw new Error(changed);
    if (!authorizedSource()) throw new Error('预览媒体来源与已验证原片不一致，不能播放。');
    // A native error may land after the ready event resolves but before this
    // awaited acceptance. Reject it here without reopening metadata recovery.
    if (video.error) throw new Error(`浏览器无法读取原片元数据，不能播放。 ${reviewMediaDiagnostic('metadata', video)} ${transportDiagnostic()} ${rangeDiagnostic()}`);
    if (video.readyState < 1 || !validDuration()) throw new Error(rangeFailure());
    if (blocked() || hidden()) { controller.background(); return; }
    video.currentTime = reference.startSeconds;
    publish({ ...state, phase: 'ready', duration: video.duration, currentTime: reference.startSeconds, error: null });
  };
  const startDirectRecovery = (): boolean => {
    const generation = epoch, reference = state.reference;
    const current = () => !disposed && generation === epoch;
    if (!reference || !convertToDirect(current)) return false;
    const abort = new AbortController(); loadAbort = abort;
    const active = () => current() && !abort.signal.aborted;
    publish({ ...state, phase: 'loading', duration: null, currentTime: null, error: null });
    const task = Promise.resolve().then(async () => {
      try {
        if (!active()) return;
        await loadMetadata(active, abort.signal);
        if (active()) acceptMetadata(reference);
      } catch (error) { if (active()) fail(message(error)); }
      finally { if (loading === task) loading = null; }
    });
    loading = task;
    return true;
  };

  const controller = {
    getState: (): ContextBookmarkPreviewState => state,
    getPlaybackTransport: (): CourseMediaTransport | null =>
      (state.phase === 'ready' || state.phase === 'playing') && canContinue() ? lease?.transport ?? 'blob' : null,
    subscribe(listener: () => void) { if (disposed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    select(reference: ContextBookmarkMediaReference | null) {
      if (disposed) return;
      clearSource();
      const selected = reference ? Object.freeze({ materialId: reference.materialId, materialVersion: reference.materialVersion,
        cueId: reference.cueId, text: reference.text, startSeconds: reference.startSeconds, endSeconds: reference.endSeconds,
        mediaId: reference.mediaId, mediaSha256: reference.mediaSha256 }) : null;
      publish({ ...EMPTY, reference: selected, phase: selected ? 'selected' : 'empty' });
    },
    load(options: { retry?: boolean } = {}): Promise<void> {
      if (disposed || !state.reference) return Promise.resolve();
      if (loading) return loading;
      if (lease && (state.phase === 'ready' || state.phase === 'playing')) return Promise.resolve();
      const problem = invalid(state.reference);
      if (problem) { fail(problem); return Promise.resolve(); }
      if (blocked() || hidden()) { publish({ ...state, error: blocked() ? RECORDING_BLOCKED : '页面恢复后请手动加载原片。' }); return Promise.resolve(); }
      const reference = state.reference;
      clearSource();
      const generation = epoch;
      const abort = new AbortController(); loadAbort = abort;
      const current = () => !disposed && generation === epoch && !abort.signal.aborted;
      publish({ ...EMPTY, reference, phase: 'loading' });
      if (!current()) return Promise.resolve();
      const task = Promise.resolve().then(async () => {
        try {
          if (!current()) return;
          const acquired = await dependencies.pool.acquire({ signal: abort.signal, retry: options.retry });
          if (!current()) { acquired.release(); return; }
          lease = acquired;
          if (!authorizedLease(acquired)) {
            throw new Error(acquired.verificationError ?? HASH_FAILURE);
          }
          if (blocked() || hidden()) { controller.background(); return; }
          await loadMetadata(current, abort.signal);
          if (current()) acceptMetadata(reference);
        } catch (error) { if (current()) fail(message(error)); }
        finally { if (loading === task) loading = null; }
      });
      loading = task; return task;
    },
    /** Only call following a user gesture. Loading is a separate, nonplaying step. */
    play(): Promise<void> {
      if (disposed || !lease || (state.phase !== 'ready' && state.phase !== 'playing')) return Promise.resolve();
      if (playing) return playing;
      if (blocked() || hidden()) { pauseReady(blocked() ? RECORDING_BLOCKED : null); return Promise.resolve(); }
      const problem = invalid(state.reference);
      if (problem) { fail(problem); return Promise.resolve(); }
      if (!authorizedSource() || !validDuration()) { fail(`原片来源或实际时长验证失效，不能播放。 ${rangeDiagnostic()}`); return Promise.resolve(); }
      const reference = state.reference!;
      if (video.currentTime < reference.startSeconds || video.currentTime >= reference.endSeconds) video.currentTime = reference.startSeconds;
      const generation = epoch, request = ++playEpoch;
      const abort = new AbortController(); playAbort = abort;
      explicitPlay = true; applyMonitor();
      let native: Promise<void>;
      try { native = Promise.resolve(video.play()); }
      catch (error) { pauseReady(message(error)); return Promise.resolve(); }
      // Recheck a native promise even after our abortable wrapper has settled.
      native.then(() => {
        const ownsPlayback = generation === epoch && request === playEpoch;
        // Old native promises can settle after a new explicit play. Only stop
        // the element if this request still owns it, or no newer authorized
        // playback owns it. Canceled/hidden/recording/disposed paths stay silent.
        if (ownsPlayback ? !canContinue() : !explicitPlay || !canContinue()) {
          video.muted = true; video.pause();
        }
      }, () => {});
      const task = abortable(native, abort.signal).then(() => {
        if (generation === epoch && request === playEpoch && canContinue()) inspectPlayback();
      }).catch(error => {
        if (!disposed && generation === epoch && request === playEpoch) pauseReady(message(error));
      }).finally(() => { if (playing === task) playing = null; });
      playing = task; return task;
    },
    pause() { if (!disposed) pauseReady(); },
    seek(seconds: number) {
      if (disposed || !lease || !Number.isFinite(seconds) || !state.reference || state.phase === 'loading') return;
      if (!authorizedSource() || !validDuration() || invalid(state.reference)) { fail(`原片来源或范围验证失效，不能跳转。 ${rangeDiagnostic()}`); return; }
      video.currentTime = Math.max(state.reference.startSeconds, Math.min(state.reference.endSeconds, seconds));
      inspectPlayback();
      if (lease) publish({ ...state, currentTime: video.currentTime });
    },
    setMonitor(preferences: ContextBookmarkMonitor) {
      if (disposed) return;
      monitor = Object.freeze({ volume: volume(preferences.volume), courseMuted: !!preferences.courseMuted, allMuted: !!preferences.allMuted });
      applyMonitor();
    },
    setRecordingBlocked(value: boolean) {
      if (disposed) return;
      recordingBlocked = value;
      if (blocked()) {
        if (state.phase === 'loading') { const reference = state.reference; clearSource(); publish({ ...EMPTY, reference, phase: reference ? 'selected' : 'empty', error: RECORDING_BLOCKED }); }
        else { halt(); publish({ ...state, phase: lease ? 'ready' : state.phase, error: state.reference ? RECORDING_BLOCKED : state.error }); }
      } else { applyMonitor(); publish({ ...state, error: state.error === RECORDING_BLOCKED ? null : state.error }); }
    },
    background() {
      if (disposed) return;
      const reference = state.reference; clearSource();
      publish({ ...EMPTY, reference, phase: reference ? 'selected' : 'empty' });
    },
    close() { if (!disposed) { clearSource(); publish(EMPTY); } },
    dispose() {
      if (disposed) return;
      disposed = true; listeners.clear(); clearSource(); state = EMPTY;
      for (const [name, handler] of mediaListeners) video.removeEventListener(name, handler);
      documentTarget?.removeEventListener('visibilitychange', visibility);
      windowTarget?.removeEventListener('pagehide', pageHide);
      windowTarget?.removeEventListener('pageshow', pageShow);
    },
  };
  const visibility = () => { if (isHidden()) controller.background(); };
  const pageHide = () => { pageHidden = true; controller.background(); };
  const pageShow = () => { pageHidden = false; }; // Never load or play on return.
  const mediaListeners: [string, EventListener][] = [
    ['play', onPlay], ['playing', onPlay], ['pause', onPause], ['error', onError], ['ended', onEnded],
    ['timeupdate', inspectPlayback], ['seeking', inspectPlayback], ['seeked', inspectPlayback],
    ['durationchange', inspectPlayback], ['ratechange', inspectPlayback],
  ];
  video.autoplay = false; video.loop = false; video.muted = true; video.pause();
  for (const [name, handler] of mediaListeners) video.addEventListener(name, handler);
  documentTarget?.addEventListener('visibilitychange', visibility);
  windowTarget?.addEventListener('pagehide', pageHide);
  windowTarget?.addEventListener('pageshow', pageShow);
  return controller;
}
