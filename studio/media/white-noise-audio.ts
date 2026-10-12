export type WhiteNoiseDisableReason =
  | 'user' | 'hidden' | 'pagehide' | 'interrupted' | 'reduced_motion' | 'disposed' | 'error';

export type WhiteNoiseErrorCode = 'unavailable' | 'enable_failed' | 'canceled' | 'disposed' | 'background';

export interface WhiteNoiseAudioSnapshot {
  /** A running local audio graph, not proof that the output device is audible. */
  readonly enabled: boolean;
  readonly enabling: boolean;
  readonly volume: number;
  readonly error: Readonly<{ code: WhiteNoiseErrorCode; message: string }> | null;
  readonly disableReason: WhiteNoiseDisableReason | null;
}

export interface WhiteNoiseAudioOptions {
  /** Tests may inject an isolated context. Never supply a recording/mix context. */
  contextFactory?: () => AudioContext;
  visibilityTarget?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> | null;
  lifecycleTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
  /** Optional deterministic uniform [0, 1) sample generator for tests. */
  random?: () => number;
  volume?: number;
}

const MESSAGES: Record<WhiteNoiseErrorCode, string> = {
  unavailable: '此浏览器不支持白噪音。',
  enable_failed: '未能开启白噪音，请点击开关重试。',
  canceled: '白噪音开启已取消。',
  disposed: '白噪音已关闭，请重新打开页面后重试。',
  background: '页面不在前台，白噪音保持关闭。',
};

export class WhiteNoiseAudioError extends Error {
  readonly code: WhiteNoiseErrorCode;
  constructor(code: WhiteNoiseErrorCode, cause?: unknown) {
    super(MESSAGES[code], { cause });
    this.name = 'WhiteNoiseAudioError';
    this.code = code;
  }
}

interface Session {
  context: AudioContext;
  master: GainNode | null;
  source: AudioBufferSourceNode | null;
  started: boolean;
  released: boolean;
  onStateChange: () => void;
  onEnded: () => void;
}

// A conservative digital ceiling; physical loudness also depends on the user's
// device and system volume. There is no speed, pitch, animation or media input.
const MAX_GAIN = 0.04;
const DEFAULT_VOLUME = 0.3;
const BUFFER_SECONDS = 2;
const SMOOTHING_SECONDS = 0.015;

export const INITIAL_WHITE_NOISE_SNAPSHOT: WhiteNoiseAudioSnapshot = Object.freeze({
  enabled: false, enabling: false, volume: DEFAULT_VOLUME, error: null, disableReason: null,
});

function normalizedVolume(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function createContext(): AudioContext {
  const Context = globalThis.AudioContext ??
    (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) throw new WhiteNoiseAudioError('unavailable');
  return new Context({ latencyHint: 'interactive' });
}

function setParameter(parameter: AudioParam, value: number, now: number): void {
  parameter.cancelScheduledValues(now);
  parameter.setValueAtTime(value, now);
}

function asEnableError(error: unknown): WhiteNoiseAudioError {
  return error instanceof WhiteNoiseAudioError ? error : new WhiteNoiseAudioError('enable_failed', error);
}

/**
 * Explicitly opt-in white noise, isolated from all other application audio.
 * Call enable() directly from a click/key handler; it calls resume() before
 * returning, without any awaited work or automatic retry. A fresh gesture is
 * required after every disable, hidden/pagehide event or context interruption.
 * The only graph is a stereo random buffer -> gain -> this context's destination.
 */
export class WhiteNoiseAudio {
  private readonly contextFactory: () => AudioContext;
  private readonly visibilityTarget: WhiteNoiseAudioOptions['visibilityTarget'];
  private readonly lifecycleTarget: WhiteNoiseAudioOptions['lifecycleTarget'];
  private readonly random: () => number;
  private readonly listeners = new Set<() => void>();
  private snapshot: WhiteNoiseAudioSnapshot;
  private session: Session | null = null;
  private enabling: Promise<void> | null = null;
  private generation = 0;
  private disposed = false;
  private monitorMuted = false;

  constructor(options: WhiteNoiseAudioOptions = {}) {
    this.contextFactory = options.contextFactory ?? createContext;
    this.visibilityTarget = options.visibilityTarget === undefined
      ? (typeof document === 'undefined' ? null : document) : options.visibilityTarget;
    this.lifecycleTarget = options.lifecycleTarget === undefined
      ? (typeof window === 'undefined' ? null : window) : options.lifecycleTarget;
    this.random = options.random ?? Math.random;
    this.snapshot = Object.freeze({
      ...INITIAL_WHITE_NOISE_SNAPSHOT,
      volume: normalizedVolume(options.volume ?? DEFAULT_VOLUME),
    });
    this.visibilityTarget?.addEventListener('visibilitychange', this.onVisibilityChange);
    this.lifecycleTarget?.addEventListener('pagehide', this.onPageHide);
  }

  /** Stable function references suitable for useSyncExternalStore. */
  readonly getSnapshot = (): WhiteNoiseAudioSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  enable(): Promise<void> {
    if (this.disposed) return Promise.reject(new WhiteNoiseAudioError('disposed'));
    if (this.visibilityTarget?.hidden) {
      this.disable('hidden');
      return Promise.reject(new WhiteNoiseAudioError('background'));
    }
    if (this.enabling) return this.enabling;
    if (this.snapshot.enabled) return Promise.resolve();

    const generation = ++this.generation;
    let session: Session | null = null;
    let resumed: Promise<void>;
    try {
      const context = this.contextFactory();
      const owned: Session = {
        context, master: null, source: null, started: false, released: false,
        onStateChange: () => {
          if (this.session === owned && this.snapshot.enabled && context.state !== 'running') {
            this.disable('interrupted');
          }
        },
        onEnded: () => {
          if (this.session === owned && !owned.released) this.disable('interrupted');
        },
      };
      session = owned;
      this.session = owned;
      context.addEventListener('statechange', owned.onStateChange);
      owned.master = context.createGain();
      setParameter(owned.master.gain, 0, context.currentTime);
      owned.master.connect(context.destination);
      owned.source = context.createBufferSource();
      owned.source.addEventListener('ended', owned.onEnded);
      const buffer = context.createBuffer(2, Math.round(context.sampleRate * BUFFER_SECONDS), context.sampleRate);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        // Independent, zero-centered, uniformly distributed samples produce
        // broadband white noise. Do not filter, envelope or tune these samples.
        for (let i = 0; i < samples.length; i++) samples[i] = this.random() * 2 - 1;
      }
      owned.source.buffer = buffer;
      owned.source.loop = true;
      // playbackRate is fixed at its default of 1; no speed-dependent input.
      owned.source.connect(owned.master);
      owned.source.start();
      owned.started = true;
      // Must run synchronously in the original user gesture.
      resumed = context.resume();
    } catch (error) {
      if (session) this.release(session);
      this.session = null;
      const failure = asEnableError(error);
      this.publishFailure(failure);
      return Promise.reject(failure);
    }

    const owned = session;
    const pending = resumed.then(() => {
      if (generation !== this.generation || this.disposed || this.session !== owned) {
        throw new WhiteNoiseAudioError('canceled');
      }
      if (this.visibilityTarget?.hidden) {
        this.disable('hidden');
        throw new WhiteNoiseAudioError('canceled');
      }
      if (owned.context.state !== 'running') throw new WhiteNoiseAudioError('enable_failed');
      this.applyVolume(owned, this.snapshot.volume);
      this.publish({ enabled: true, enabling: false, error: null, disableReason: null });
    }).catch((error: unknown) => {
      this.release(owned);
      // A stale completion must not replace the state of a newer user action.
      if (generation !== this.generation || this.disposed || this.session !== owned) {
        throw new WhiteNoiseAudioError('canceled');
      }
      this.session = null;
      const failure = asEnableError(error);
      this.publishFailure(failure);
      throw failure;
    }).finally(() => {
      if (this.enabling === pending) this.enabling = null;
    });
    this.enabling = pending;
    this.publish({ enabled: false, enabling: true, error: null, disableReason: null });
    return pending;
  }

  setMonitorMuted(muted: boolean): void {
    this.monitorMuted = muted;
    if (this.session && this.snapshot.enabled) {
      try { this.applyVolume(this.session, this.snapshot.volume); } catch { this.disable('interrupted'); }
    }
  }

  setVolume(value: number): void {
    if (this.disposed) return;
    const volume = normalizedVolume(value);
    if (volume === this.snapshot.volume) return;
    const session = this.session;
    if (session && this.snapshot.enabled) {
      if (session.context.state !== 'running') this.disable('interrupted');
      else {
        try { this.applyVolume(session, volume); }
        catch { this.disable('interrupted'); }
      }
    }
    this.publish({ volume });
  }

  disable(reason: WhiteNoiseDisableReason = 'user'): void {
    if (this.disposed && reason !== 'disposed') return;
    ++this.generation;
    this.enabling = null;
    const session = this.session;
    this.session = null;
    if (session) this.release(session);
    this.publish({ enabled: false, enabling: false, error: null, disableReason: reason });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.visibilityTarget?.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.lifecycleTarget?.removeEventListener('pagehide', this.onPageHide);
    this.disable('disposed');
    this.listeners.clear();
  }

  private readonly onVisibilityChange = (): void => {
    if (this.visibilityTarget?.hidden) this.disable('hidden');
  };

  private readonly onPageHide = (): void => { this.disable('pagehide'); };

  private publish(update: Partial<WhiteNoiseAudioSnapshot>): void {
    const next = { ...this.snapshot, ...update };
    if (Object.keys(next).every(key =>
      next[key as keyof WhiteNoiseAudioSnapshot] === this.snapshot[key as keyof WhiteNoiseAudioSnapshot])) return;
    this.snapshot = Object.freeze(next);
    for (const listener of [...this.listeners]) {
      // A UI subscriber must not prevent the audio graph's lifecycle cleanup.
      try { listener(); } catch { /* The remaining subscribers still need the state. */ }
    }
  }

  private publishFailure(error: WhiteNoiseAudioError): void {
    this.publish({
      enabled: false, enabling: false, disableReason: 'error',
      error: Object.freeze({ code: error.code, message: error.message }),
    });
  }

  private applyVolume(session: Session, volume: number): void {
    if (!session.master || session.released) return;
    const now = session.context.currentTime;
    session.master.gain.cancelScheduledValues(now);
    session.master.gain.setTargetAtTime((this.monitorMuted ? 0 : volume) * MAX_GAIN, now, SMOOTHING_SECONDS);
  }

  private release(session: Session): void {
    if (!session.released) {
      session.released = true;
      try { session.context.removeEventListener('statechange', session.onStateChange); } catch { /* Continue cleanup. */ }
      if (session.master) {
        try { setParameter(session.master.gain, 0, session.context.currentTime); }
        catch { try { session.master.gain.value = 0; } catch { /* Disconnect below. */ } }
      }
      if (session.source) {
        try { session.source.removeEventListener('ended', session.onEnded); } catch { /* Continue cleanup. */ }
        try { if (session.started) session.source.stop(); } catch { /* Already stopped. */ }
        try { session.source.disconnect(); } catch { /* Already disconnected. */ }
        try { session.source.buffer = null; } catch { /* Disconnect already silenced it. */ }
      }
      try { session.master?.disconnect(); } catch { /* Already disconnected. */ }
    }
    // A stale resume can settle after disable. Re-closing then keeps even a
    // browser with delayed lifecycle promises from retaining a running context.
    // Muting/stopping/disconnecting do not wait for either lifecycle promise.
    if (session.context.state !== 'closed') {
      try { void session.context.suspend().catch(() => {}); } catch { /* Still close it. */ }
      try { void session.context.close().catch(() => {}); } catch { /* Graph is already disconnected. */ }
    }
  }
}
