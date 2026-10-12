export interface CourseAudioRoutingOptions {
  /** Borrow the recording/mix context. This helper never suspends or closes it. */
  context: AudioContext;
  element: HTMLMediaElement;
  volume?: number;
  courseMuted?: boolean;
  allMonitorMuted?: boolean;
}

export interface CourseAudioRoutingState {
  volume: number;
  courseMuted: boolean;
  allMonitorMuted: boolean;
  effectiveVolume: number;
  enabled: boolean;
}

type ErrorCode = 'disposed' | 'canceled' | 'closed' | 'source_in_use' |
  'context_mismatch' | 'enable_failed' | 'not_enabled' | 'recording_failed';
const MESSAGES: Record<ErrorCode, string> = {
  disposed: '课程音频路由已关闭，请重新打开页面后重试。',
  canceled: '课程音频开启已取消。',
  closed: '课程音频上下文已关闭，请重新打开页面后重试。',
  source_in_use: '课程音频正在由另一条监听路由使用。',
  context_mismatch: '课程音频必须使用同一个音频上下文，请重新打开页面后重试。',
  enable_failed: '未能开启课程音频，请点击播放或录制按钮重试。',
  not_enabled: '请先通过播放或录制按钮开启课程音频。',
  recording_failed: '未能接入课程录音音源，本次录制未能开始。',
};

export class CourseAudioRoutingError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, cause?: unknown) {
    super(MESSAGES[code], { cause });
    this.name = 'CourseAudioRoutingError';
    this.code = code;
  }
}

interface ElementSource {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  owner: CourseAudioRouting | null;
}

// A media element can acquire a MediaElementAudioSource only once, including
// after disconnect/dispose. Retain that association across same-context remounts.
const elementSources = new WeakMap<HTMLMediaElement, ElementSource>();

function normalizedVolume(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/**
 * Course source -> monitor Gain -> speakers
 *               -> explicitly connected recording destination (pre-monitor)
 *
 * Construction and setters do not allocate audio nodes or unlock playback.
 * Call enableFromGesture() directly from a click/key handler, before any await.
 * Once enabled, use these setters, not element.volume/element.muted: the media
 * element stays at unity/unmuted so listening controls never alter recording.
 * Dispose disconnects this graph only; the caller owns media playback/context.
 */
export class CourseAudioRouting {
  private readonly context: AudioContext;
  private readonly element: HTMLMediaElement;
  private volume: number;
  private courseMuted: boolean;
  private allMonitorMuted: boolean;
  private entry: ElementSource | null = null;
  private monitor: GainNode | null = null;
  private recordings = new Map<AudioNode, { count: number }>();
  private enabling: Promise<void> | null = null;
  private enabled = false;
  private disposed = false;

  constructor(options: CourseAudioRoutingOptions) {
    this.context = options.context;
    this.element = options.element;
    this.volume = normalizedVolume(options.volume ?? options.element.volume);
    this.courseMuted = options.courseMuted ?? options.element.muted;
    this.allMonitorMuted = options.allMonitorMuted ?? false;
  }

  getState(): Readonly<CourseAudioRoutingState> {
    return Object.freeze({ volume: this.volume, courseMuted: this.courseMuted,
      allMonitorMuted: this.allMonitorMuted,
      effectiveVolume: this.courseMuted || this.allMonitorMuted ? 0 : this.volume,
      enabled: this.enabled && !this.disposed && this.context.state === 'running' });
  }

  setVolume(volume: number): void {
    if (this.disposed) return;
    this.volume = normalizedVolume(volume);
    this.updateMonitor();
  }

  setCourseMuted(muted: boolean): void {
    if (this.disposed) return;
    this.courseMuted = muted;
    this.updateMonitor();
  }

  setAllMonitorMuted(muted: boolean): void {
    if (this.disposed) return;
    this.allMonitorMuted = muted;
    this.updateMonitor();
  }

  enableFromGesture(): Promise<void> {
    if (this.disposed) return Promise.reject(new CourseAudioRoutingError('disposed'));
    if (this.context.state === 'closed') return Promise.reject(new CourseAudioRoutingError('closed'));
    if (this.enabling) return this.enabling;
    if (this.enabled && this.context.state === 'running') return Promise.resolve();

    let resumed: Promise<void>;
    try {
      this.ensureGraph();
      // Keep the source independent of listening volume/mute in every browser.
      // The monitor is connected and silent before removing native attenuation.
      this.element.volume = 1;
      this.element.muted = false;
      // Must run synchronously within the caller's explicit user gesture.
      resumed = this.context.resume();
    } catch (error) {
      this.enabled = false;
      this.silenceMonitor();
      return Promise.reject(this.asEnableError(error));
    }

    const pending = resumed.then(() => {
      if (this.disposed) throw new CourseAudioRoutingError('canceled');
      if (this.context.state !== 'running') throw new CourseAudioRoutingError('enable_failed');
      this.enabled = true;
      this.updateMonitor();
    }).catch((error: unknown) => {
      this.enabled = false;
      this.silenceMonitor();
      if (this.disposed) throw new CourseAudioRoutingError('canceled');
      // Retain the element's permanent source association so a fresh gesture can
      // retry resume without creating another MediaElementAudioSource.
      throw this.asEnableError(error);
    }).finally(() => {
      if (this.enabling === pending) this.enabling = null;
    });
    this.enabling = pending;
    return pending;
  }

  /** Call only for a checked recording source. Merely enabling never records. */
  connectRecording(destination: AudioNode): () => void {
    if (this.disposed) throw new CourseAudioRoutingError('disposed');
    if (!this.enabled || !this.entry || this.context.state !== 'running') {
      throw new CourseAudioRoutingError('not_enabled');
    }
    if (destination.context !== this.context || destination === this.context.destination || destination === this.monitor) {
      throw new CourseAudioRoutingError('recording_failed');
    }
    let connection = this.recordings.get(destination);
    if (!connection) {
      try { this.entry.source.connect(destination); }
      catch (error) { throw new CourseAudioRoutingError('recording_failed', error); }
      connection = { count: 0 };
      this.recordings.set(destination, connection);
    }
    connection.count++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.recordings.get(destination) !== connection) return;
      if (--connection.count > 0) return;
      this.recordings.delete(destination);
      try { this.entry?.source.disconnect(destination); } catch { /* Already disconnected. */ }
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.silenceMonitor();
    for (const destination of this.recordings.keys()) {
      try { this.entry?.source.disconnect(destination); } catch { /* Continue other cleanup. */ }
    }
    this.recordings.clear();
    if (this.monitor) {
      try { this.entry?.source.disconnect(this.monitor); } catch { /* Already disconnected. */ }
      try { this.monitor.disconnect(); } catch { /* Already disconnected. */ }
      this.monitor = null;
    }
    if (this.entry?.owner === this) this.entry.owner = null;
    this.entry = null;
  }

  private ensureGraph(): void {
    if (this.monitor) return;
    let entry = elementSources.get(this.element);
    if (entry && entry.context !== this.context) throw new CourseAudioRoutingError('context_mismatch');
    if (entry?.owner && entry.owner !== this) throw new CourseAudioRoutingError('source_in_use');
    if (!entry) {
      entry = { context: this.context, source: this.context.createMediaElementSource(this.element), owner: null };
      elementSources.set(this.element, entry);
    }
    entry.owner = this;
    this.entry = entry;
    const monitor = this.context.createGain();
    try {
      monitor.gain.setValueAtTime(0, this.context.currentTime);
      monitor.connect(this.context.destination);
      entry.source.connect(monitor);
      this.monitor = monitor;
    } catch (error) {
      try { entry.source.disconnect(monitor); } catch { /* May not have connected. */ }
      try { monitor.disconnect(); } catch { /* May not have connected. */ }
      throw error;
    }
  }

  private updateMonitor(): void {
    if (!this.monitor) return;
    const volume = this.enabled && !this.disposed && !this.courseMuted && !this.allMonitorMuted ? this.volume : 0;
    const { gain } = this.monitor;
    gain.cancelScheduledValues(this.context.currentTime);
    // Exact zero immediately honors either mute, without changing the source.
    gain.setValueAtTime(volume, this.context.currentTime);
  }

  private silenceMonitor(): void {
    try { this.updateMonitor(); }
    catch { try { if (this.monitor) this.monitor.gain.value = 0; } catch { /* Dispose disconnects nodes. */ } }
  }

  private asEnableError(error: unknown): CourseAudioRoutingError {
    return error instanceof CourseAudioRoutingError ? error : new CourseAudioRoutingError('enable_failed', error);
  }
}
