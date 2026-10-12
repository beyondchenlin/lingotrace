import {
  INITIAL_VIDEO_PALETTE_STATE, analyzeVideoPalette, createVideoPalette, smoothVideoPaletteTone,
  type PaletteMode, type VideoPalette, type VideoPaletteState, type VideoPaletteTone,
} from '../scene/video-palette.ts';
export { INITIAL_VIDEO_PALETTE_STATE } from '../scene/video-palette.ts';
export type { PaletteMode, VideoPalette, VideoPaletteState, VideoPaletteStatus } from '../scene/video-palette.ts';

const WIDTH = 96, HEIGHT = 54, INTERVAL_MS = 125;
type VideoSource = Pick<HTMLVideoElement, 'videoWidth' | 'videoHeight' | 'readyState' | 'paused' | 'ended' | 'seeking' | 'addEventListener' | 'removeEventListener'>;
type LifecycleTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
type PaletteContext = Pick<CanvasRenderingContext2D, 'drawImage' | 'getImageData' | 'clearRect'>;
type PaletteCanvas = { width: number; height: number; getContext: (type: '2d', options?: { willReadFrequently?: boolean }) => PaletteContext | null };
export type VideoPaletteOptions = {
  onPalette: (palette: VideoPalette | null) => void;
  onState: (state: VideoPaletteState) => void;
  /** A dedicated sampler only. Never supply the scene/recording canvas. */
  createCanvas?: () => PaletteCanvas;
  setTimeout?: (callback: () => void, milliseconds: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  now?: () => number;
  document?: LifecycleTarget & { readonly hidden: boolean };
  window?: LifecycleTarget;
};
export type VideoPaletteDiagnostics = Readonly<{
  sampleAttempts: number; analyzedFrames: number; acceptedFrames: number;
  totalAnalysisMs: number; maxAnalysisMs: number;
  sampleWidth: number; sampleHeight: number; intervalMs: number;
}>;

/**
 * Read-only, memory-only observer of the existing lesson video. No autoplay, seek,
 * audio, camera, network, storage or main-canvas access. OFF always clears both
 * derived colour and manual lock; a subsequent enable starts a fresh capture.
 * sourceChanged() is called when assigning a new source, BEFORE its loadeddata.
 */
export class VideoPaletteController {
  private readonly video: VideoSource;
  private readonly options: VideoPaletteOptions;
  private readonly document: VideoPaletteOptions['document'];
  private readonly window: LifecycleTarget | undefined;
  private readonly now: () => number;
  private readonly startTimer: NonNullable<VideoPaletteOptions['setTimeout']>;
  private readonly clearTimer: NonNullable<VideoPaletteOptions['clearTimeout']>;
  private state: VideoPaletteState = INITIAL_VIDEO_PALETTE_STATE;
  private mode: PaletteMode = 'off';
  private kind: 'demo' | 'video' | 'image' = 'demo';
  private reducedMotion = false;
  private locked = false;
  private lockedSourceChanged = false;
  private disposed = false;
  private pageHidden = false;
  private awaitingSource = false;
  private failure: string | null = null;
  private mediaFailure = false;
  private palette: VideoPalette | null = null;
  private tone: VideoPaletteTone | null = null;
  private resetSmoothing = false;
  private canvas: PaletteCanvas | null = null;
  private context: PaletteContext | null = null;
  private timer: unknown = null;
  private timerEpoch = 0;
  private generation = 0;
  private lastSampleAt = -Infinity;
  private sampleAttempts = 0;
  private analyzedFrames = 0;
  private acceptedFrames = 0;
  private totalAnalysisMs = 0;
  private maxAnalysisMs = 0;
  private readonly removers: (() => void)[] = [];

  constructor(video: VideoSource, options: VideoPaletteOptions) {
    this.video = video;
    this.options = options;
    this.document = options.document ?? (typeof document !== 'undefined' ? document : undefined);
    this.window = options.window ?? (typeof window !== 'undefined' ? window : undefined);
    this.now = options.now ?? (() => performance.now());
    this.startTimer = options.setTimeout ?? ((callback, ms) => globalThis.setTimeout(callback, ms));
    this.clearTimer = options.clearTimeout ?? (handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.listen(video, 'loadeddata', () => {
      this.awaitingSource = false;
      // A newly decoded frame can recover a playback failure. A pixel-read
      // failure (including CORS) instead requires source reset/new sampler.
      if (this.mediaFailure && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        this.mediaFailure = false;
        this.failure = null;
      }
      this.wake();
    });
    this.listen(video, 'canplay', () => this.wake());
    this.listen(video, 'playing', () => this.wake());
    this.listen(video, 'pause', () => { this.cancelTimer(); this.publishState(); });
    this.listen(video, 'ended', () => { this.cancelTimer(); this.publishState(); });
    this.listen(video, 'seeking', () => {
      this.generation++;
      this.cancelTimer();
      if (!this.locked && !this.staticMode()) this.resetSmoothing = true;
    });
    this.listen(video, 'seeked', () => {
      if (!this.locked && !this.staticMode()) this.resetSmoothing = true;
      this.wake(true);
    });
    this.listen(video, 'emptied', () => this.resetSource(this.kind));
    this.listen(video, 'loadstart', () => this.resetSource(this.kind));
    this.listen(video, 'error', () => {
      // Pixel-read/security failure is a stronger, source-scoped capability
      // failure. A later playback error must not make loadeddata clear it.
      if (this.failure && !this.mediaFailure) return;
      const message = '当前视频画面不可用，已恢复默认配色；播放状态未更改。';
      // OFF does no sampling and stays visually unchanged, but source capability
      // failures must survive until an explicit enable or a genuinely new source.
      if (this.mode === 'off') { this.failure = message; this.mediaFailure = true; return; }
      // A manual lock protects its selected colour, not the failed source's
      // capability. Retain that failure so unlocking cannot revive stale colour.
      if (this.locked) {
        this.failure = message;
        this.mediaFailure = true;
        this.cancelTimer();
        this.publishState();
      } else this.fail(message, true);
    });
    this.listen(this.document, 'visibilitychange', () => {
      if (!this.document?.hidden) this.pageHidden = false;
      this.wake();
    });
    this.listen(this.window, 'pagehide', () => { this.pageHidden = true; this.cancelTimer(); this.publishState(); });
    this.listen(this.window, 'pageshow', () => { this.pageHidden = false; this.wake(); });
    options.onPalette(null);
    options.onState(this.state);
  }

  getSnapshot(): VideoPaletteState { return this.state; }
  getDiagnostics(): VideoPaletteDiagnostics {
    return Object.freeze({ sampleAttempts: this.sampleAttempts, analyzedFrames: this.analyzedFrames,
      acceptedFrames: this.acceptedFrames, totalAnalysisMs: this.totalAnalysisMs, maxAnalysisMs: this.maxAnalysisMs,
      sampleWidth: WIDTH, sampleHeight: HEIGHT, intervalMs: INTERVAL_MS });
  }
  setMode(mode: PaletteMode): void {
    if (this.disposed || !['off', 'frame', 'follow'].includes(mode) || mode === this.mode) return;
    this.mode = mode;
    this.cancelTimer();
    if (mode === 'off') {
      this.generation++;
      this.locked = false;
      this.lockedSourceChanged = false;
      this.clearPalette();
      this.canvas = this.context = null;
      this.publishState();
    } else this.wake(true);
  }
  setReducedMotion(value: boolean): void {
    if (this.disposed || this.reducedMotion === value) return;
    this.reducedMotion = value;
    this.wake();
  }
  lock(): void {
    if (this.disposed || this.mode === 'off' || !this.palette || this.locked) return;
    this.locked = true;
    this.cancelTimer();
    this.publishState();
  }
  unlock(): void {
    if (this.disposed || !this.locked) return;
    this.locked = false;
    if (this.lockedSourceChanged || this.failure) {
      this.lockedSourceChanged = false;
      this.clearPalette();
    }
    this.wake(true);
  }
  sourceChanged(kind: 'demo' | 'video' | 'image'): void {
    if (!this.disposed) this.resetSource(kind);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.cancelTimer();
    for (const remove of this.removers) remove();
    this.removers.length = 0;
    this.canvas = this.context = null;
    this.palette = this.tone = null;
  }
  private listen(target: LifecycleTarget | undefined, type: string, callback: () => void): void {
    if (!target) return;
    target.addEventListener(type, callback);
    this.removers.push(() => target.removeEventListener(type, callback));
  }
  private hidden(): boolean { return this.pageHidden || !!this.document?.hidden; }
  private staticMode(): boolean { return this.mode === 'frame' || this.reducedMotion; }
  private canSample(): boolean {
    return !this.disposed && this.mode !== 'off' && !this.locked && this.kind !== 'image' &&
      !this.failure && !this.hidden() && !this.awaitingSource && !this.video.seeking &&
      !(this.staticMode() && this.palette);
  }
  private resetSource(kind: 'demo' | 'video' | 'image'): void {
    this.generation++;
    this.cancelTimer();
    this.kind = kind;
    this.awaitingSource = kind !== 'image';
    this.failure = null;
    this.mediaFailure = false;
    this.canvas = this.context = null;
    if (this.locked && this.palette) {
      this.lockedSourceChanged = true;
      this.tone = null;
      this.lastSampleAt = -Infinity;
    } else this.clearPalette();
    this.publishState();
  }
  private clearPalette(): void {
    this.tone = null;
    this.resetSmoothing = false;
    this.lastSampleAt = -Infinity;
    if (this.palette) { this.palette = null; this.options.onPalette(null); }
  }
  private fail(message: string, mediaFailure = false): void {
    if (this.disposed || this.failure) return;
    this.failure = message;
    this.mediaFailure = mediaFailure;
    this.generation++;
    this.cancelTimer();
    this.locked = false;
    this.lockedSourceChanged = false;
    this.canvas = this.context = null;
    this.clearPalette();
    this.publishState();
  }
  private wake(force = false): void {
    if (this.disposed) return;
    this.cancelTimer();
    this.sample(force);
    this.publishState();
    this.schedule();
  }
  private sample(force = false): void {
    if (!this.canSample() || this.video.readyState < 2 || this.video.videoWidth <= 0 || this.video.videoHeight <= 0) return;
    const sampledAt = this.now();
    if (!force && sampledAt - this.lastSampleAt < INTERVAL_MS) return;
    const generation = this.generation;
    try {
      if (!this.canvas) {
        const canvas = this.options.createCanvas?.() ?? globalThis.document?.createElement('canvas');
        if (!canvas) { this.fail('此环境不支持视频画面取色，已使用默认配色。'); return; }
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        this.canvas = canvas;
        this.context = canvas.getContext('2d', { willReadFrequently: true });
        if (!this.context) { this.fail('此环境不支持视频画面取色，已使用默认配色。'); return; }
      }
      const context = this.context!;
      this.sampleAttempts++;
      this.lastSampleAt = sampledAt;
      context.clearRect(0, 0, WIDTH, HEIGHT);
      context.drawImage(this.video as HTMLVideoElement, 0, 0, WIDTH, HEIGHT);
      if (generation !== this.generation || !this.canSample()) return;
      const pixels = context.getImageData(0, 0, WIDTH, HEIGHT).data;
      if (generation !== this.generation || !this.canSample()) return;
      const start = this.now();
      const result = analyzeVideoPalette(pixels, WIDTH, HEIGHT, this.tone?.hue);
      const duration = Math.max(0, this.now() - start);
      this.totalAnalysisMs += duration;
      this.maxAnalysisMs = Math.max(this.maxAnalysisMs, duration);
      this.analyzedFrames++;
      if (!result.tone || generation !== this.generation || !this.canSample()) return;
      this.tone = smoothVideoPaletteTone(this.resetSmoothing ? null : this.tone, result.tone, INTERVAL_MS);
      this.resetSmoothing = false;
      const palette = createVideoPalette(this.tone);
      this.acceptedFrames++;
      if (!this.palette || (Object.keys(palette) as (keyof VideoPalette)[]).some(key => palette[key] !== this.palette![key])) {
        this.palette = palette;
        this.options.onPalette(palette);
      }
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      const security = !!error && typeof error === 'object' && 'name' in error && error.name === 'SecurityError';
      this.fail(security
        ? '当前视频不允许读取画面，已恢复默认配色；播放不受影响。'
        : '无法读取当前视频画面，已恢复默认配色；播放不受影响。');
    }
  }
  private cancelTimer(): void {
    this.timerEpoch++;
    if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null; }
  }
  private schedule(): void {
    if (!this.canSample() || this.video.paused || this.video.ended || this.timer !== null) return;
    const generation = this.generation, epoch = this.timerEpoch;
    this.timer = this.startTimer(() => {
      if (this.disposed || generation !== this.generation || epoch !== this.timerEpoch) return;
      this.timer = null;
      this.sample();
      this.publishState();
      this.schedule();
    }, INTERVAL_MS);
  }
  private publishState(): void {
    if (this.disposed) return;
    let status: VideoPaletteState['status'], message: string;
    if (this.mode === 'off') { status = 'off'; message = INITIAL_VIDEO_PALETTE_STATE.message; }
    else if (this.locked) { status = 'locked'; message = '已锁定当前配色。'; }
    else if (this.kind === 'image') { status = 'unavailable'; message = '图片背景不参与视频取色，使用默认配色。'; }
    else if (this.failure) { status = 'unavailable'; message = this.failure; }
    else if (!this.palette) { status = 'waiting'; message = '等待可读取的有效视频画面，暂用默认配色；不会自动播放。'; }
    else if (this.staticMode()) { status = 'active'; message = this.reducedMotion && this.mode === 'follow' ? '减少动态效果已启用，保持静态取色。' : '已捕获首帧配色。'; }
    else if (this.hidden() || this.video.paused || this.video.ended) { status = 'paused'; message = '跟随已暂停，保持当前配色。'; }
    else { status = 'active'; message = '正在缓慢跟随视频配色。'; }
    const next = { mode: this.mode, status, locked: this.locked, hasPalette: !!this.palette, message };
    if ((Object.keys(next) as (keyof VideoPaletteState)[]).every(key => next[key] === this.state[key])) return;
    this.state = Object.freeze(next);
    this.options.onState(this.state);
  }
}
