export interface StandbyAudioTick {
  /** The shared animation's current energy, from 0 to 1. */
  energy: number;
  active: boolean;
  mediaAudible: boolean;
}

export interface StandbyAudioOptions {
  /** Tests can supply an isolated context. Never pass a recording/mix context. */
  contextFactory?: () => AudioContext;
  visibilityTarget?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> | null;
}

type ErrorCode = 'unavailable' | 'enable_failed' | 'canceled' | 'disposed';
const MESSAGES: Record<ErrorCode, string> = {
  unavailable: '此浏览器不支持待机声音。',
  enable_failed: '未能开启待机声音，请点击开关重试。',
  canceled: '待机声音开启已取消。',
  disposed: '待机声音已关闭，请重新打开页面后重试。',
};

export class StandbyAudioError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, cause?: unknown) {
    super(MESSAGES[code], { cause });
    this.name = 'StandbyAudioError';
    this.code = code;
  }
}

interface Voice {
  oscillator: OscillatorNode;
  gain: GainNode;
  started: boolean;
}

interface Session {
  context: AudioContext;
  master: GainNode | null;
  voices: Voice[];
  released: boolean;
}

// Two normalized sine voices keep their summed peak below this conservative
// digital amplitude. Actual listening volume still depends on the output device.
const MAX_GAIN = 0.014;
const MEDIA_DUCK = 0.18;
const SMOOTHING_SECONDS = 0.01;

function createContext(): AudioContext {
  const Context = globalThis.AudioContext ??
    (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) throw new StandbyAudioError('unavailable');
  return new Context({ latencyHint: 'interactive' });
}

function setParameter(parameter: AudioParam, value: number, now: number): void {
  parameter.cancelScheduledValues(now);
  parameter.setValueAtTime(value, now);
}

function smoothParameter(parameter: AudioParam, value: number, now: number): void {
  parameter.cancelScheduledValues(now);
  // A short de-zipper follows the supplied target, without generating a swell.
  parameter.setTargetAtTime(value, now, SMOOTHING_SECONDS);
}

/**
 * Opt-in, destination-only feedback driven by the caller's existing frame loop.
 * Call enable() directly in a user gesture, before awaiting anything else.
 * There are no timers, autonomous modulation, recording nodes or media inputs.
 */
export class StandbyAudio {
  private readonly contextFactory: () => AudioContext;
  private readonly visibilityTarget: StandbyAudioOptions['visibilityTarget'];
  private session: Session | null = null;
  private enabling: Promise<void> | null = null;
  private enabled = false;
  private disposed = false;
  private generation = 0;

  constructor(options: StandbyAudioOptions = {}) {
    this.contextFactory = options.contextFactory ?? createContext;
    this.visibilityTarget = options.visibilityTarget === undefined
      ? (typeof document === 'undefined' ? null : document)
      : options.visibilityTarget;
    this.visibilityTarget?.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  enable(): Promise<void> {
    if (this.disposed) return Promise.reject(new StandbyAudioError('disposed'));
    if (this.enabling) return this.enabling;
    if (this.enabled) return Promise.resolve();

    const generation = ++this.generation;
    let session: Session;
    let resumed: Promise<void>;
    try {
      session = { context: this.contextFactory(), master: null, voices: [], released: false };
      this.session = session;
      const { context } = session;
      session.master = context.createGain();
      setParameter(session.master.gain, 0, context.currentTime);
      session.master.connect(context.destination);
      for (const weight of [0.8, 0.2]) {
        const oscillator = context.createOscillator();
        const voice = { oscillator, gain: context.createGain(), started: false };
        session.voices.push(voice);
        oscillator.type = 'sine';
        setParameter(oscillator.frequency, 55, context.currentTime);
        setParameter(voice.gain.gain, weight, context.currentTime);
        oscillator.connect(voice.gain);
        voice.gain.connect(session.master);
        oscillator.start();
        voice.started = true;
      }
      // This must execute synchronously inside the caller's click/key handler.
      resumed = context.resume();
    } catch (error) {
      this.disable();
      return Promise.reject(error instanceof StandbyAudioError
        ? error : new StandbyAudioError('enable_failed', error));
    }

    const pending = resumed.then(() => {
      if (generation !== this.generation || this.disposed || this.session !== session) {
        this.release(session);
        throw new StandbyAudioError('canceled');
      }
      if (session.context.state !== 'running') throw new StandbyAudioError('enable_failed');
      // Only a fresh caller update may introduce sound after unlocking.
      this.enabled = true;
    }).catch((error: unknown) => {
      this.release(session);
      if (this.session === session) {
        this.session = null;
        this.enabled = false;
      }
      if (generation !== this.generation || this.disposed) throw new StandbyAudioError('canceled');
      throw error instanceof StandbyAudioError ? error : new StandbyAudioError('enable_failed', error);
    }).finally(() => {
      if (this.enabling === pending) this.enabling = null;
    });
    this.enabling = pending;
    return pending;
  }

  update({ energy, active, mediaAudible }: StandbyAudioTick): void {
    const session = this.session;
    if (!this.enabled || !session?.master || session.released) return;
    if (!active || this.visibilityTarget?.hidden || session.context.state !== 'running') {
      this.mute(session);
      return;
    }
    const level = Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0;
    const now = session.context.currentTime;
    // The caller supplies the complete swell envelope. Low energy falls almost
    // silent; no baseline hum, queued animation or private clock is introduced.
    const gain = MAX_GAIN * level * level * (mediaAudible ? MEDIA_DUCK : 1);
    const pitch = 55 + 85 * level;
    smoothParameter(session.voices[0].oscillator.frequency, pitch, now);
    smoothParameter(session.voices[1].oscillator.frequency, pitch * 2, now);
    smoothParameter(session.master.gain, gain, now);
  }

  disable(): void {
    ++this.generation;
    this.enabled = false;
    this.enabling = null;
    const session = this.session;
    this.session = null;
    if (session) this.release(session);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.visibilityTarget?.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.disable();
  }

  private readonly onVisibilityChange = (): void => {
    if (this.visibilityTarget?.hidden && this.session) this.mute(this.session);
  };

  private mute(session: Session): void {
    if (!session.master) return;
    try { setParameter(session.master.gain, 0, session.context.currentTime); }
    catch {
      try { session.master.gain.value = 0; } catch { /* Release still disconnects the graph. */ }
    }
  }

  private release(session: Session): void {
    if (!session.released) {
      session.released = true;
      this.mute(session);
      for (const voice of session.voices) {
        try { voice.oscillator.frequency.cancelScheduledValues(session.context.currentTime); } catch { /* Continue cleanup. */ }
        try { setParameter(voice.gain.gain, 0, session.context.currentTime); } catch { /* Disconnect below. */ }
        try { if (voice.started) voice.oscillator.stop(); } catch { /* Already stopped. */ }
        try { voice.oscillator.disconnect(); } catch { /* Already disconnected. */ }
        try { voice.gain.disconnect(); } catch { /* Already disconnected. */ }
      }
      try { session.master?.disconnect(); } catch { /* Already disconnected. */ }
    }
    // Cleanup is immediate, and failed/pending browser lifecycle promises never
    // block muting. Revisit a late resume as well so it cannot leak a live context.
    if (session.context.state !== 'closed') {
      try { void session.context.suspend().catch(() => {}); } catch { /* Still close it. */ }
      try { void session.context.close().catch(() => {}); } catch { /* Nodes are silent and disconnected. */ }
    }
  }
}
