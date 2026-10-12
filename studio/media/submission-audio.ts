export type SubmissionCueKind = 'correction' | 'correct' | 'firstCompletion';
export type SubmissionAudioDisableReason = 'user' | 'hidden' | 'pagehide' | 'interrupted' | 'disposed' | 'error';
export type SubmissionAudioErrorCode = 'unavailable' | 'enable_failed' | 'recording_failed' | 'dedupe_limit' | 'canceled' | 'disposed' | 'background';

export interface SubmissionAudioSnapshot {
  /** An unlocked local graph, not proof of an audible output device. */
  readonly enabled: boolean;
  readonly enabling: boolean;
  readonly volume: number;
  readonly monitorMuted: boolean;
  readonly error: Readonly<{ code: SubmissionAudioErrorCode; message: string }> | null;
  readonly disableReason: SubmissionAudioDisableReason | null;
}

export interface SubmissionAudioOptions {
  /** Supply an isolated context, never the recorder's shared mix context. */
  contextFactory?: () => AudioContext;
  visibilityTarget?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> | null;
  lifecycleTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
  now?: () => number;
  volume?: number;
}

const MESSAGES: Record<SubmissionAudioErrorCode, string> = {
  unavailable: '此浏览器不支持提交提示音。',
  enable_failed: '未能开启提交提示音，请点击开关重试。',
  recording_failed: '未能将提交提示音接入录制，请重新开始录制。',
  dedupe_limit: '本页提交提示音次数已达上限，已暂停提示音。训练和评分不受影响；重新打开页面后可再次开启。',
  canceled: '提交提示音开启已取消。',
  disposed: '提交提示音已关闭，请重新打开页面后重试。',
  background: '页面不在前台，提交提示音保持关闭。',
};

export class SubmissionAudioError extends Error {
  readonly code: SubmissionAudioErrorCode;
  constructor(code: SubmissionAudioErrorCode, cause?: unknown) {
    super(MESSAGES[code], { cause });
    this.name = 'SubmissionAudioError';
    this.code = code;
  }
}

interface Cue {
  source: AudioBufferSourceNode;
  started: boolean;
  ended: boolean;
  released: boolean;
  onEnded: () => void;
}

interface RecordingTarget {
  context: AudioContext;
  destination: AudioNode;
  onStateChange: () => void;
}

interface RecordingBridge {
  output: MediaStreamAudioDestinationNode;
  input: MediaStreamAudioSourceNode | null;
  released: boolean;
}

interface Session {
  context: AudioContext;
  master: GainNode | null;
  monitor: GainNode | null;
  cue: Cue | null;
  inputGain: GainNode | null;
  inputCue: Cue | null;
  bridge: RecordingBridge | null;
  released: boolean;
  onStateChange: () => void;
}

const DEFAULT_VOLUME = 0.4;
// A conservative digital ceiling. Physical loudness also depends on the device.
const MAX_GAIN = 0.055;
const MIN_INTERVAL_MS = 320;
const INPUT_ERROR_MIN_INTERVAL_MS = 320;
const SMOOTHING_SECONDS = 0.01;
/** Hard bounds: never evict old IDs and accidentally make them replayable. */
export const SUBMISSION_AUDIO_DEDUPE_LIMIT = 8192;
export const SUBMISSION_AUDIO_MAX_ID_LENGTH = 256;
const DEDUPE_LIMIT_FAILURE = Object.freeze({ code: 'dedupe_limit' as const, message: MESSAGES.dedupe_limit });

export const INITIAL_SUBMISSION_AUDIO_SNAPSHOT: SubmissionAudioSnapshot = Object.freeze({
  enabled: false, enabling: false, volume: DEFAULT_VOLUME, monitorMuted: false,
  error: null, disableReason: null,
});

/** Call once for an explicit, successfully saved live submission. */
export function selectSubmissionCue(result: { correct: boolean; firstCompletion: boolean }): SubmissionCueKind {
  return result.firstCompletion ? 'firstCompletion' : result.correct ? 'correct' : 'correction';
}

function normalizedVolume(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function createContext(): AudioContext {
  const Context = globalThis.AudioContext ??
    (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) throw new SubmissionAudioError('unavailable');
  return new Context({ latencyHint: 'interactive' });
}

function setParameter(parameter: AudioParam, value: number, now: number): void {
  parameter.cancelScheduledValues(now);
  parameter.setValueAtTime(value, now);
}

function silence(node: GainNode | null, now: number): void {
  if (!node) return;
  try { setParameter(node.gain, 0, now); }
  catch { try { node.gain.value = 0; } catch { /* Disconnect still silences it. */ } }
}

function asEnableError(error: unknown): SubmissionAudioError {
  return error instanceof SubmissionAudioError ? error : new SubmissionAudioError('enable_failed', error);
}

/** Short local sine notes with smooth, zero-ended envelopes; no files or URLs. */
function cueBuffer(context: AudioContext, kind: SubmissionCueKind): AudioBuffer {
  const notes = kind === 'firstCompletion' ? [523.25, 659.25, 783.99]
    : kind === 'correct' ? [523.25, 659.25] : [329.63];
  const noteSeconds = kind === 'correction' ? 0.16 : 0.13;
  const length = Math.round(notes.length * noteSeconds * context.sampleRate);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let note = 0; note < notes.length; note++) {
    const first = Math.round(note * noteSeconds * context.sampleRate);
    const end = Math.round((note + 1) * noteSeconds * context.sampleRate);
    for (let i = first; i < Math.min(end, length); i++) {
      const progress = (i - first) / Math.max(1, end - first - 1);
      const envelope = Math.sin(Math.PI * progress) ** 2;
      samples[i] = Math.sin(2 * Math.PI * notes[note] * (i - first) / context.sampleRate) * envelope;
    }
  }
  return buffer;
}

/** A restrained, 90 ms descending sine; no assets and no scheduled replay. */
function inputErrorBuffer(context: AudioContext): AudioBuffer {
  const duration = 0.09;
  const length = Math.round(duration * context.sampleRate);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const progress = i / Math.max(1, length - 1);
    const seconds = i / context.sampleRate;
    const envelope = Math.sin(Math.PI * progress) ** 2;
    // Integrate the 260 -> 210 Hz glide to keep phase continuous.
    const phase = 2 * Math.PI * (260 * seconds - 25 * seconds * seconds / duration);
    samples[i] = Math.sin(phase) * envelope * 0.5;
  }
  return buffer;
}

/**
 * A cue-only opt-in graph. enable() must be called directly from a user gesture;
 * it calls resume() synchronously and never plays a sound by itself. play() is
 * synchronous and never resumes, queues, retries, or replays a submission.
 * playInputError() shares that unlock but only reaches the speaker monitor;
 * real submissions always take priority and have an independent limiter.
 *
 * The caller owns eligibility: invoke play exactly once after an explicit live
 * attempt is saved, selecting completion before correct/correction. Never call
 * it from rendering, effects, restored history, selection, or replay paths.
 * cancel() stops the current tail (pause/close/navigation) without changing the
 * enabled choice. Backgrounding or interruption disables the graph entirely.
 */
export class SubmissionAudio {
  private readonly contextFactory: () => AudioContext;
  private readonly visibilityTarget: SubmissionAudioOptions['visibilityTarget'];
  private readonly lifecycleTarget: SubmissionAudioOptions['lifecycleTarget'];
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();
  // Memory-only, bounded by both ID count and length. At capacity fail closed
  // until disposal/reload, never evict. Keep IDs across disable/re-enable so
  // skipped attempts and restored attempts cannot acquire a delayed cue.
  private readonly consumedIds = new Set<string>();
  private dedupeExhausted = false;
  private snapshot: SubmissionAudioSnapshot;
  private session: Session | null = null;
  private recordingTarget: RecordingTarget | null = null;
  private enabling: Promise<void> | null = null;
  private lastPlayedAt = -Infinity;
  private lastInputErrorAt = -Infinity;
  private generation = 0;
  private disposed = false;

  constructor(options: SubmissionAudioOptions = {}) {
    this.contextFactory = options.contextFactory ?? createContext;
    this.visibilityTarget = options.visibilityTarget === undefined
      ? (typeof document === 'undefined' ? null : document) : options.visibilityTarget;
    this.lifecycleTarget = options.lifecycleTarget === undefined
      ? (typeof window === 'undefined' ? null : window) : options.lifecycleTarget;
    this.now = options.now ?? (() => performance.now());
    this.snapshot = Object.freeze({
      ...INITIAL_SUBMISSION_AUDIO_SNAPSHOT, volume: normalizedVolume(options.volume ?? DEFAULT_VOLUME),
    });
    this.visibilityTarget?.addEventListener('visibilitychange', this.onVisibilityChange);
    this.lifecycleTarget?.addEventListener('pagehide', this.onPageHide);
  }

  readonly getSnapshot = (): SubmissionAudioSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  enable(): Promise<void> {
    if (this.disposed) return Promise.reject(new SubmissionAudioError('disposed'));
    if (this.dedupeExhausted) return Promise.reject(new SubmissionAudioError('dedupe_limit'));
    if (this.visibilityTarget?.hidden) {
      this.disable('hidden');
      return Promise.reject(new SubmissionAudioError('background'));
    }
    if (this.enabling) return this.enabling;
    if (this.snapshot.enabled) {
      if (this.session?.context.state === 'running') return Promise.resolve();
      this.disable('interrupted');
    }

    const generation = ++this.generation;
    let session: Session | null = null;
    let resumed: Promise<void>;
    try {
      const context = this.contextFactory();
      const owned: Session = {
        context, master: null, monitor: null, cue: null, inputGain: null, inputCue: null,
        bridge: null, released: false,
        onStateChange: () => {
          if (this.session === owned && this.snapshot.enabled && context.state !== 'running') {
            this.disable('interrupted');
          }
        },
      };
      session = owned;
      this.session = owned;
      context.addEventListener('statechange', owned.onStateChange);
      owned.master = context.createGain();
      setParameter(owned.master.gain, 0, context.currentTime);
      owned.monitor = context.createGain();
      setParameter(owned.monitor.gain, 0, context.currentTime);
      owned.master.connect(owned.monitor);
      owned.monitor.connect(context.destination);
      if (this.recordingTarget) this.connectRecording(owned, this.recordingTarget);
      // Synchronous in the original click/key gesture, before any await.
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
        throw new SubmissionAudioError('canceled');
      }
      if (this.visibilityTarget?.hidden) {
        this.disable('hidden');
        throw new SubmissionAudioError('canceled');
      }
      if (owned.context.state !== 'running') throw new SubmissionAudioError('enable_failed');
      this.applyVolume(owned, this.snapshot.volume);
      this.applyMonitor(owned, this.snapshot.monitorMuted);
      this.publish({ enabled: true, enabling: false, error: null, disableReason: null });
    }).catch((error: unknown) => {
      this.release(owned);
      if (generation !== this.generation || this.disposed || this.session !== owned) {
        throw new SubmissionAudioError('canceled');
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

  /** True means a new cue was started, never a claim of physical audibility. */
  play(kind: SubmissionCueKind, attemptId: string): boolean {
    if (this.disposed || this.dedupeExhausted || typeof attemptId !== 'string' ||
      attemptId.length > SUBMISSION_AUDIO_MAX_ID_LENGTH || !attemptId.trim() ||
      !['correction', 'correct', 'firstCompletion'].includes(kind) || this.consumedIds.has(attemptId)) return false;
    if (this.consumedIds.size >= SUBMISSION_AUDIO_DEDUPE_LIMIT) {
      this.dedupeExhausted = true;
      this.disable('error');
      return false;
    }
    this.consumedIds.add(attemptId);
    const session = this.session;
    if (this.visibilityTarget?.hidden) { this.disable('hidden'); return false; }
    if (!this.snapshot.enabled || !session?.master || session.released) return false;
    if (session.context.state !== 'running') { this.disable('interrupted'); return false; }
    const now = this.now();
    if (!Number.isFinite(now) || now - this.lastPlayedAt < MIN_INTERVAL_MS) return false;

    this.cancel();
    let cue: Cue | null = null;
    try {
      const source = session.context.createBufferSource();
      const owned: Cue = {
        source, started: false, ended: false, released: false,
        onEnded: () => {
          owned.ended = true;
          this.releaseCue(owned);
          if (session.cue === owned) session.cue = null;
        },
      };
      cue = owned;
      session.cue = owned;
      source.addEventListener('ended', owned.onEnded);
      source.buffer = cueBuffer(session.context, kind);
      source.loop = false;
      source.connect(session.master);
      source.start();
      owned.started = true;
      this.lastPlayedAt = now;
      return true;
    } catch (error) {
      if (cue) this.releaseCue(cue);
      this.disable('error');
      this.publishFailure(asEnableError(error));
      return false;
    }
  }

  /**
   * Call synchronously for an eligible live typing error. Never unlocks, queues,
   * consumes attempt IDs, or reaches the opt-in submission recording tap.
   * False means dropped; a later enable/unmute cannot replay this event.
   */
  playInputError(): boolean {
    if (this.disposed) return false;
    const session = this.session;
    if (this.visibilityTarget?.hidden) { this.disable('hidden'); return false; }
    if (!this.snapshot.enabled || !session?.monitor || session.released) return false;
    if (session.context.state !== 'running') { this.disable('interrupted'); return false; }
    if (this.snapshot.monitorMuted || this.snapshot.volume === 0) return false;
    const now = this.now();
    if (!Number.isFinite(now) || session.cue || now - this.lastPlayedAt < MIN_INTERVAL_MS ||
      now - this.lastInputErrorAt < INPUT_ERROR_MIN_INTERVAL_MS) return false;

    this.cancelInputError();
    let cue: Cue | null = null;
    try {
      if (!session.inputGain) {
        session.inputGain = session.context.createGain();
        setParameter(session.inputGain.gain, this.snapshot.volume * MAX_GAIN, session.context.currentTime);
        // Downstream of master/recording tap, so recording opt-in cannot capture it.
        session.inputGain.connect(session.monitor);
      }
      const source = session.context.createBufferSource();
      const owned: Cue = {
        source, started: false, ended: false, released: false,
        onEnded: () => {
          owned.ended = true;
          this.releaseCue(owned);
          if (session.inputCue === owned) session.inputCue = null;
        },
      };
      cue = owned;
      session.inputCue = owned;
      source.addEventListener('ended', owned.onEnded);
      source.buffer = inputErrorBuffer(session.context);
      source.loop = false;
      source.connect(session.inputGain);
      source.start();
      owned.started = true;
      this.lastInputErrorAt = now;
      return true;
    } catch (error) {
      if (cue) this.releaseCue(cue);
      this.disable('error');
      this.publishFailure(asEnableError(error));
      return false;
    }
  }

  cancel(): void {
    this.cancelInputError();
    const session = this.session;
    if (!session?.cue) return;
    const cue = session.cue;
    session.cue = null;
    this.releaseCue(cue);
  }

  /** Stops only the transient typing tail; submitted-result feedback is intact. */
  cancelInputError(): void {
    const session = this.session;
    if (!session?.inputCue) return;
    const cue = session.inputCue;
    session.inputCue = null;
    this.releaseCue(cue);
  }

  setVolume(value: number): void {
    if (this.disposed) return;
    const volume = normalizedVolume(value);
    if (volume === this.snapshot.volume) return;
    if (volume === 0) this.cancelInputError();
    if (this.session && this.snapshot.enabled) {
      if (this.session.context.state !== 'running') this.disable('interrupted');
      else { try { this.applyVolume(this.session, volume); } catch { this.disable('interrupted'); } }
    }
    this.publish({ volume });
  }

  /** Speaker monitor only. The opt-in recording tap is before this gain. */
  setMonitorMuted(monitorMuted: boolean): void {
    if (this.disposed || monitorMuted === this.snapshot.monitorMuted) return;
    if (monitorMuted) this.cancelInputError();
    if (this.session && this.snapshot.enabled) {
      if (this.session.context.state !== 'running') this.disable('interrupted');
      else { try { this.applyMonitor(this.session, monitorMuted); } catch { this.disable('interrupted'); } }
    }
    this.publish({ monitorMuted });
  }

  /**
   * Explicit per-recording opt-in. A cross-context MediaStream bridge contains
   * ONLY submitted-result cues, including when the speaker monitor is muted.
   * Immediate typing-error cues are monitor-only even with this opt-in.
   * Does not enable audio, resume the recording context, or request a microphone.
   * Return cleanup belongs to the recording request; stale cleanup is harmless.
   */
  attachRecordingTarget(context: AudioContext, destination: AudioNode): () => void {
    if (this.disposed) throw new SubmissionAudioError('disposed');
    if (destination.context !== context || context.state === 'closed') {
      throw new SubmissionAudioError('recording_failed');
    }
    this.detachRecordingTarget();
    const target: RecordingTarget = {
      context, destination,
      onStateChange: () => {
        if (this.recordingTarget === target && context.state === 'closed') this.detachRecordingTarget();
      },
    };
    this.recordingTarget = target;
    try {
      context.addEventListener('statechange', target.onStateChange);
      if (this.session && !this.session.released) this.connectRecording(this.session, target);
    } catch (error) {
      this.detachRecordingTarget();
      throw new SubmissionAudioError('recording_failed', error);
    }
    return () => { if (this.recordingTarget === target) this.detachRecordingTarget(); };
  }

  detachRecordingTarget(): void {
    const target = this.recordingTarget;
    this.recordingTarget = null;
    if (target) {
      try { target.context.removeEventListener('statechange', target.onStateChange); } catch { /* Continue cleanup. */ }
    }
    if (this.session?.bridge) this.releaseBridge(this.session);
  }

  disable(reason: SubmissionAudioDisableReason = 'user'): void {
    if (this.disposed && reason !== 'disposed') return;
    ++this.generation;
    this.enabling = null;
    const session = this.session;
    this.session = null;
    if (session) this.release(session);
    const limited = this.dedupeExhausted && reason !== 'disposed';
    this.publish({
      enabled: false, enabling: false,
      error: limited ? DEDUPE_LIMIT_FAILURE : null, disableReason: limited ? 'error' : reason,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.visibilityTarget?.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.lifecycleTarget?.removeEventListener('pagehide', this.onPageHide);
    this.detachRecordingTarget();
    this.disable('disposed');
    this.consumedIds.clear();
    this.listeners.clear();
  }

  private readonly onVisibilityChange = (): void => {
    if (this.visibilityTarget?.hidden) this.disable('hidden');
  };

  private readonly onPageHide = (): void => { this.disable('pagehide'); };

  private publish(update: Partial<SubmissionAudioSnapshot>): void {
    const next = { ...this.snapshot, ...update };
    if (Object.keys(next).every(key =>
      next[key as keyof SubmissionAudioSnapshot] === this.snapshot[key as keyof SubmissionAudioSnapshot])) return;
    this.snapshot = Object.freeze(next);
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* UI failures cannot prevent cleanup or other listeners. */ }
    }
  }

  private publishFailure(error: SubmissionAudioError): void {
    this.publish({
      enabled: false, enabling: false, disableReason: 'error',
      error: Object.freeze({ code: error.code, message: error.message }),
    });
  }

  private applyVolume(session: Session, volume: number): void {
    if (session.released) return;
    for (const node of [session.master, session.inputGain]) {
      if (!node) continue;
      node.gain.cancelScheduledValues(session.context.currentTime);
      node.gain.setTargetAtTime(volume * MAX_GAIN, session.context.currentTime, SMOOTHING_SECONDS);
    }
  }

  private applyMonitor(session: Session, muted: boolean): void {
    if (!session.monitor || session.released) return;
    // Immediate mute avoids a speaker tail while the recording tap stays live.
    setParameter(session.monitor.gain, muted ? 0 : 1, session.context.currentTime);
  }

  private connectRecording(session: Session, target: RecordingTarget): void {
    if (!session.master || session.released) return;
    const bridge: RecordingBridge = {
      output: session.context.createMediaStreamDestination(), input: null, released: false,
    };
    session.bridge = bridge;
    try {
      bridge.input = target.context.createMediaStreamSource(bridge.output.stream);
      bridge.input.connect(target.destination);
      session.master.connect(bridge.output);
    } catch (error) {
      this.releaseBridge(session);
      throw new SubmissionAudioError('recording_failed', error);
    }
  }

  private releaseBridge(session: Session): void {
    const bridge = session.bridge;
    session.bridge = null;
    if (!bridge || bridge.released) return;
    bridge.released = true;
    try { session.master?.disconnect(bridge.output); } catch { /* Never disconnect the monitor as a fallback. */ }
    try { bridge.input?.disconnect(); } catch { /* Continue cleanup. */ }
    try { bridge.output.disconnect(); } catch { /* Continue cleanup. */ }
    for (const track of bridge.output.stream.getTracks()) {
      try { track.stop(); } catch { /* Stop every owned track. */ }
    }
  }

  private releaseCue(cue: Cue): void {
    if (cue.released) return;
    cue.released = true;
    try { cue.source.removeEventListener('ended', cue.onEnded); } catch { /* Continue cleanup. */ }
    try { if (cue.started && !cue.ended) cue.source.stop(); } catch { /* Already stopped. */ }
    try { cue.source.disconnect(); } catch { /* Already disconnected. */ }
    try { cue.source.buffer = null; } catch { /* Disconnection already silenced it. */ }
  }

  private release(session: Session): void {
    if (!session.released) {
      session.released = true;
      try { session.context.removeEventListener('statechange', session.onStateChange); } catch { /* Continue cleanup. */ }
      silence(session.master, session.context.currentTime);
      silence(session.monitor, session.context.currentTime);
      silence(session.inputGain, session.context.currentTime);
      if (session.cue) this.releaseCue(session.cue);
      session.cue = null;
      if (session.inputCue) this.releaseCue(session.inputCue);
      session.inputCue = null;
      this.releaseBridge(session);
      try { session.master?.disconnect(); } catch { /* Already disconnected. */ }
      try { session.monitor?.disconnect(); } catch { /* Already disconnected. */ }
      try { session.inputGain?.disconnect(); } catch { /* Already disconnected. */ }
    }
    // A late resume may settle after disable; close that stale context again.
    // Never suspend/close the caller-owned recording context.
    if (session.context.state !== 'closed') {
      try { void session.context.suspend().catch(() => {}); } catch { /* Still close it. */ }
      try { void session.context.close().catch(() => {}); } catch { /* Graph is disconnected. */ }
    }
  }
}
