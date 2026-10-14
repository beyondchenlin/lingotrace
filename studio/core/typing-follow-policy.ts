import { NPS_MATERIAL } from './builtin-material.ts';
import { graphemes } from './training.ts';

/** Candidate sentence-average tuning, NOT word timing or a durable learning metric. */
export const TYPING_FOLLOW_TUNING = Object.freeze({
  minRate: 0.5, maxRate: 1.5, warmupRate: 0.8, tickMs: 200,
  windowMs: 3000, minimumCoverageMs: 1000, minimumCommitSeparationMs: 250,
  idleMs: 1500, maxRateDeltaPerSecond: 0.25, rateDeadband: 0.02,
  maxObservationGapMs: 1000, maxSmoothingMs: 200, maxSamples: 256,
  playTimeoutMs: 1500, durationToleranceSeconds: 0.001,
});
export const TYPING_FOLLOW_FIXED_RATES: readonly number[] = Object.freeze([0.5, 0.8, 1, 1.25, 1.5]);
export type TypingFollowPacingStrategy = 'adaptive' | 'fixed';

export interface TypingFollowIdentity {
  readonly courseId: string;
  readonly courseVersion: string;
  readonly mediaId: string;
  readonly mediaSha256: string;
  readonly sentenceMapVersion: string;
  readonly sentenceMapSha256: string;
  readonly cueId: string;
  readonly cueStartSeconds: number;
  readonly cueEndSeconds: number;
}
export interface TypingFollowScope {
  readonly epoch: number;
  /** The host's unique current playback lease, changed before another owner acts. */
  readonly ownerId: string;
  readonly identity: TypingFollowIdentity;
}
export interface TypingFollowEnvironment {
  readonly nowMs: number;
  readonly identity: TypingFollowIdentity;
  readonly playbackOwnerId: string;
  readonly referenceShown: boolean;
  readonly mode: 'legacy-typing' | 'dictation' | 'listening' | 'history' | 'review' | 'replay';
  readonly listeningPlayerActive: boolean;
  readonly recording: 'idle' | 'preparing' | 'recording' | 'stopping';
  readonly composing: boolean;
  readonly focused: boolean;
  readonly visible: boolean;
  readonly practiceActive: boolean;
  readonly blocked: boolean;
  /** Existing transport/hash/lease validation is authoritative; this policy cannot verify bytes. */
  readonly sourceVerified: boolean;
  readonly inputProvenanceAvailable: boolean;
  readonly mediaReady: boolean;
  /** Native host observed buffering under the same successfully playing scope.
   * This can relax only current-data readiness, never source or entry admission. */
  readonly mediaBuffering?: boolean;
  /** Host's already-admitted initial seek, scoped to its original pending command.
   * Metadata-only decoding never authorizes entry, resume or successful settlement. */
  readonly mediaInitialSeekCommandId?: number | null;
  readonly mediaDurationSeconds: number;
  readonly mediaPositionSeconds: number;
  /** Native readback, never an unapplied requested target. */
  readonly mediaRate: number;
  /** Legacy controllers remain adaptive unless the host explicitly selects fixed pacing. */
  readonly pacingStrategy?: TypingFollowPacingStrategy;
  /** Fixed pacing defaults to 1x; only an exact supported selection is admitted. */
  readonly fixedRate?: number;
  readonly rateWriteOwner: { readonly ownerId: string; readonly epoch: number; readonly commandId: number } | null;
  /** Monotonic version of committed draft edits only, excluding composition preedit. */
  readonly draftRevision: number;
}
export interface TypingFollowAppend {
  readonly before: string;
  readonly after: string;
  readonly beforeRevision: number;
  readonly afterRevision: number;
  /** Capture BEFORE the native operation, in DOM UTF-16 offsets. Missing selection is unknown. */
  readonly selectionBefore: { readonly start: number; readonly end: number } | null;
  readonly source: 'typed' | 'ime' | 'paste' | 'programmatic' | 'unknown';
  readonly kind: 'input' | 'compositionend';
  readonly inputType: string | null;
  readonly data: string | null;
  readonly isTrusted: boolean;
  readonly isComposing: boolean;
  readonly compositionId?: number;
}
export type TypingFollowInterrupt =
  | 'manual-pause' | 'manual-play' | 'manual-seek' | 'manual-replay' | 'manual-rate'
  | 'hide-reference' | 'show-reference' | 'background' | 'blur' | 'course-change' | 'cue-change' | 'version-change'
  | 'recording' | 'check' | 'next' | 'review' | 'replay' | 'unmount' | 'media-error'
  | 'unattributed-native-event';
export type TypingFollowEvent =
  | { readonly type: 'enable'; readonly enabled: boolean }
  | { readonly type: 'start'; readonly explicitUserGesture: boolean; readonly initialEdit?: TypingFollowAppend }
  | { readonly type: 'tick'; readonly epoch: number }
  | { readonly type: 'input'; readonly epoch: number; readonly edit: TypingFollowAppend }
  | { readonly type: 'composition-start'; readonly epoch: number; readonly compositionId: number }
  | { readonly type: 'composition-cancel'; readonly epoch: number; readonly compositionId: number }
  | { readonly type: 'play-result'; readonly epoch: number; readonly commandId: number; readonly ok: boolean }
  | { readonly type: 'rate-applied'; readonly epoch: number; readonly commandId: number }
  | { readonly type: 'interrupt'; readonly epoch: number; readonly reason: TypingFollowInterrupt };

type IntentBase = { readonly scope: TypingFollowScope; readonly commandId: number };
/** Descriptions only. No native media, timer, persistence, scoring, or recording capability. */
export type TypingFollowIntent = IntentBase & (
  | { readonly type: 'start-cue'; readonly atSeconds: number; readonly rate: number }
  | { readonly type: 'resume' }
  | { readonly type: 'pause'; readonly reason: string }
  | { readonly type: 'set-rate'; readonly rate: number; readonly onlyIfRateCommandId: number; readonly onlyIfRateEquals: number }
  | { readonly type: 'restore-base-rate'; readonly rate: number; readonly onlyIfRateCommandId: number; readonly onlyIfRateEquals: number }
);
interface Sample { readonly atMs: number; readonly count: number }
interface Active {
  readonly scope: TypingFollowScope;
  readonly baseRate: number;
  readonly pacingStrategy: TypingFollowPacingStrategy;
  readonly fixedRate: number;
  readonly nominalGraphemesPerSecond: number;
  readonly actualRate: number | null;
  readonly rateWrite: { readonly commandId: number; readonly rate: number };
  readonly pendingPlay: { readonly commandId: number; readonly issuedMs: number; readonly initial: boolean } | null;
  readonly waitingReason: 'idle' | 'composition' | null;
  readonly compositionId: number | null;
  readonly draftRevision: number;
  readonly lastObservedMs: number;
  readonly lastInputMs: number;
  readonly segmentStartedMs: number;
  readonly lastControlMs: number;
  readonly samples: readonly Sample[];
}
export interface TypingFollowState {
  readonly enabled: boolean;
  readonly phase: 'off' | 'starting' | 'following' | 'waiting' | 'ended';
  readonly reason: string | null;
  readonly epoch: number;
  readonly commandSequence: number;
  readonly active: Active | null;
}
export interface TypingFollowDecision {
  readonly state: TypingFollowState;
  readonly intents: readonly TypingFollowIntent[];
}
const T = TYPING_FOLLOW_TUNING;
const identityKeys: readonly (keyof TypingFollowIdentity)[] = [
  'courseId', 'courseVersion', 'mediaId', 'mediaSha256', 'sentenceMapVersion',
  'sentenceMapSha256', 'cueId', 'cueStartSeconds', 'cueEndSeconds',
];
const finitePositive = (n: number) => Number.isFinite(n) && n > 0;
const revision = (n: number) => Number.isSafeInteger(n) && n >= 0;
const pacingStrategy = (env: TypingFollowEnvironment) => env.pacingStrategy === undefined ? 'adaptive' : env.pacingStrategy;
const fixedRate = (env: TypingFollowEnvironment) => env.fixedRate === undefined ? 1 : env.fixedRate;
const pacingChanged = (a: Active, env: TypingFollowEnvironment) => a.pacingStrategy !== pacingStrategy(env) || a.fixedRate !== fixedRate(env);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function createTypingFollowState(): TypingFollowState {
  return freeze({ enabled: false, phase: 'off', reason: null, epoch: 0, commandSequence: 0, active: null });
}
function result(state: TypingFollowState, intents: readonly TypingFollowIntent[] = []): TypingFollowDecision {
  return freeze({ state, intents });
}
export function sameTypingFollowIdentity(a: TypingFollowIdentity, b: TypingFollowIdentity): boolean {
  return identityKeys.every(key => a[key] === b[key]);
}
function owns(a: Active, env: TypingFollowEnvironment): boolean {
  return a.scope.ownerId === env.playbackOwnerId && sameTypingFollowIdentity(a.scope.identity, env.identity);
}
function holdsRateToken(a: Active, env: TypingFollowEnvironment): boolean {
  const owner = env.rateWriteOwner;
  return owns(a, env) && owner?.ownerId === a.scope.ownerId && owner.epoch === a.scope.epoch && owner.commandId === a.rateWrite.commandId;
}
function ownsRate(a: Active, env: TypingFollowEnvironment): boolean {
  return holdsRateToken(a, env) && Number.isFinite(env.mediaRate) && Math.abs(env.mediaRate - a.rateWrite.rate) <= 1e-6;
}
function registeredCue(identity: TypingFollowIdentity) {
  const source = NPS_MATERIAL.builtinReference;
  if (identity.courseId !== NPS_MATERIAL.id || identity.courseVersion !== NPS_MATERIAL.version ||
    identity.mediaId !== source.media.id || identity.mediaSha256 !== source.media.sha256 ||
    identity.sentenceMapVersion !== source.sentenceMapVersion || identity.sentenceMapSha256 !== source.sentenceMapSha256) return null;
  return NPS_MATERIAL.cues.find(cue => cue.id === identity.cueId && cue.start === identity.cueStartSeconds && cue.end === identity.cueEndSeconds) ?? null;
}
/** Fixed primary may run assisted (reference shown) or intentional dictation (reference hidden).
 * Adaptive assist still requires a shown reference and ordinary typing. */
export function typingFollowAdmission(env: Pick<TypingFollowEnvironment, 'mode' | 'referenceShown' | 'pacingStrategy'>): string | null {
  const strategy = env.pacingStrategy === undefined ? 'adaptive' : env.pacingStrategy;
  if (strategy === 'fixed') {
    if (env.mode === 'dictation') return env.referenceShown ? 'dictation-reference-leaked' : null;
    if (env.mode === 'legacy-typing') return env.referenceShown ? null : 'reference-hidden';
    return 'not-ordinary-typing';
  }
  if (!env.referenceShown) return 'reference-hidden';
  if (env.mode !== 'legacy-typing') return 'not-ordinary-typing';
  return null;
}
/** Check privacy before looking up a cue or deriving a target-dependent value. */
function unavailable(env: TypingFollowEnvironment, allowComposition = false, allowBuffering = false, allowInitialSeek = false): string | null {
  const admission = typingFollowAdmission(env);
  if (admission) return admission;
  if (env.listeningPlayerActive) return 'listening-owner';
  if (env.recording !== 'idle') return 'recording';
  if (env.composing && !allowComposition) return 'composing';
  if (!env.focused) return 'blur';
  if (!env.visible) return 'background';
  if (!env.practiceActive || env.blocked) return 'practice-blocked';
  if (!env.inputProvenanceAvailable) return 'input-provenance-unavailable';
  if (typeof Intl.Segmenter !== 'function') return 'grapheme-segmentation-unavailable';
  if (!env.sourceVerified || (!env.mediaReady && !((allowBuffering && env.mediaBuffering === true) || allowInitialSeek)) || typeof env.playbackOwnerId !== 'string' || !env.playbackOwnerId || !registeredCue(env.identity)) return 'source-unqualified';
  if (!finitePositive(env.mediaDurationSeconds) || Math.abs(env.mediaDurationSeconds - NPS_MATERIAL.builtinReference.media.durationSeconds) > T.durationToleranceSeconds ||
    env.identity.cueStartSeconds < 0 || env.identity.cueEndSeconds <= env.identity.cueStartSeconds || env.identity.cueEndSeconds > env.mediaDurationSeconds) return 'invalid-range';
  if (!finitePositive(env.mediaRate)) return 'invalid-rate';
  if (pacingStrategy(env) !== 'adaptive' && pacingStrategy(env) !== 'fixed') return 'invalid-pacing-strategy';
  if (!Number.isFinite(fixedRate(env)) || !TYPING_FOLLOW_FIXED_RATES.includes(fixedRate(env))) return 'invalid-fixed-rate';
  if (!revision(env.draftRevision)) return 'invalid-draft-revision';
  return null;
}
/** Count a committed append only; prefix equality alone cannot prove insertion. No text is retained. */
export function qualifyingTypingFollowAppend(edit: TypingFollowAppend): number | null {
  if (!edit.isTrusted || edit.isComposing || typeof Intl.Segmenter !== 'function') return null;
  const native = edit.source === 'typed' && edit.kind === 'input' && edit.inputType === 'insertText';
  const ime = edit.source === 'ime' && edit.kind === 'compositionend' && edit.inputType === null;
  if ((!native && !ime) || !edit.data || !edit.selectionBefore ||
    edit.selectionBefore.start !== edit.before.length || edit.selectionBefore.end !== edit.before.length ||
    !edit.after.startsWith(edit.before) || edit.after.slice(edit.before.length) !== edit.data ||
    !revision(edit.beforeRevision) || !revision(edit.afterRevision) || edit.afterRevision !== edit.beforeRevision + 1) return null;
  // An appended combining mark/ZWJ may alter the previous grapheme rather than add one.
  const before = graphemes(edit.before), after = graphemes(edit.after);
  if (before.some((part, index) => after[index] !== part)) return null;
  const count = after.length - before.length;
  return count > 0 ? count : null;
}
/** Authored arithmetic fixtures can use this without pretending to be registered source material. */
export function estimatedTypingFollowRate(insertedGraphemes: number, observedMs: number, nominalGraphemesPerSecond: number): number | null {
  if (!finitePositive(insertedGraphemes) || !finitePositive(observedMs) || !finitePositive(nominalGraphemesPerSecond)) return null;
  const target = insertedGraphemes * 1000 / observedMs / nominalGraphemesPerSecond;
  return Number.isFinite(target) ? Math.min(T.maxRate, Math.max(T.minRate, target)) : null;
}
function finish(state: TypingFollowState, env: TypingFollowEnvironment, reason: string, phase: 'off' | 'ended' = 'off', preserveManualRate = false): TypingFollowDecision {
  const a = state.active, intents: TypingFollowIntent[] = [];
  let commandSequence = state.commandSequence;
  if (a && owns(a, env) && !preserveManualRate) {
    intents.push({ type: 'pause', reason, scope: a.scope, commandId: ++commandSequence });
    if (ownsRate(a, env)) intents.push({ type: 'restore-base-rate', rate: a.baseRate, onlyIfRateCommandId: a.rateWrite.commandId, onlyIfRateEquals: a.rateWrite.rate, scope: a.scope, commandId: ++commandSequence });
  }
  return result({ ...state, phase, reason, active: null, commandSequence }, intents);
}
function waitForTyping(state: TypingFollowState, env: TypingFollowEnvironment, reason: 'idle' | 'composition', compositionId: number | null = null): TypingFollowDecision {
  const a = state.active!;
  const commandId = state.commandSequence + 1;
  return result({ ...state, phase: 'waiting', reason, commandSequence: commandId,
    active: { ...a, pendingPlay: null, waitingReason: reason, compositionId, samples: [], segmentStartedMs: env.nowMs, lastObservedMs: env.nowMs, lastControlMs: env.nowMs } },
  [{ type: 'pause', reason, scope: a.scope, commandId }]);
}

/**
 * Pure reducer: no native media, persistence, scoring, renderer or recording effects.
 * The host must serialize reductions and execute intents only while their immutable scope/lease
 * is current. Invalidate pending native play before pause/cleanup, guard it before AND after
 * settlement, and enforce the endpoint with a native boundary checker (200 ms is NOT precision).
 * start-cue means pause ordinary playback, cancel its boundary/repeat owner, seek ONCE, set
 * selected fixed rate or adaptive warm-up rate, and request guarded play. It is the ONLY
 * repositioning intent. Every rate write is conditional on its prior token AND native value;
 * it must never overwrite a newer manual rate. Native events without current command attribution
 * become interrupts. All source/visibility/focus/recording checks must be fresh, not captured.
 */
export function reduceTypingFollow(state: TypingFollowState, event: TypingFollowEvent, env: TypingFollowEnvironment): TypingFollowDecision {
  if (event.type === 'enable') {
    const stopped = state.active && (!event.enabled || pacingChanged(state.active, env))
      ? finish(state, env, event.enabled ? 'pacing-changed' : 'disabled') : result(state);
    return result({ ...stopped.state, enabled: event.enabled }, stopped.intents);
  }
  if (event.type === 'start') {
    if (!event.explicitUserGesture) return result(state);
    const initialCount = event.initialEdit ? qualifyingTypingFollowAppend(event.initialEdit) : null;
    if (event.initialEdit && (initialCount === null || event.initialEdit.afterRevision !== env.draftRevision)) return result(state);
    const blocked = unavailable(env);
    if (blocked || !Number.isFinite(env.nowMs) || env.nowMs < 0) {
      return state.active ? finish(state, env, blocked ?? 'invalid-clock') : result({ ...state, phase: 'off', reason: blocked ?? 'invalid-clock' });
    }
    const cue = registeredCue(env.identity)!;
    const nominal = graphemes(cue.text).length / (cue.end - cue.start);
    if (!finitePositive(nominal)) return finish(state, env, 'invalid-nominal-pace');
    const previous = state.active;
    const baseRate = previous && ownsRate(previous, env) ? previous.baseRate : env.mediaRate;
    const scope: TypingFollowScope = { epoch: state.epoch + 1, ownerId: env.playbackOwnerId, identity: Object.fromEntries(identityKeys.map(key => [key, env.identity[key]])) as unknown as TypingFollowIdentity };
    const commandId = state.commandSequence + 1;
    const strategy = pacingStrategy(env), selectedRate = fixedRate(env);
    const startRate = strategy === 'fixed' ? selectedRate : T.warmupRate;
    return result({ enabled: true, phase: 'starting', reason: null, epoch: scope.epoch, commandSequence: commandId,
      active: { scope, baseRate, pacingStrategy: strategy, fixedRate: selectedRate, nominalGraphemesPerSecond: nominal, actualRate: null,
        rateWrite: { commandId, rate: startRate }, pendingPlay: { commandId, issuedMs: env.nowMs, initial: true },
        waitingReason: null, compositionId: null, draftRevision: env.draftRevision,
        lastObservedMs: env.nowMs, lastInputMs: env.nowMs, segmentStartedMs: env.nowMs, lastControlMs: env.nowMs, samples: strategy === 'fixed' || initialCount === null ? [] : [{ atMs: env.nowMs, count: initialCount }] } },
    [{ type: 'start-cue', atSeconds: cue.start, rate: startRate, scope, commandId }]);
  }
  const a = state.active;
  if (!a) return result(state);
  // Identity/lease revocation cannot pause or retune a newer playback owner.
  if (!owns(a, env)) return finish(state, env, 'ownership-changed');
  const compositionWait = state.phase === 'waiting' && a.waitingReason === 'composition';
  const initialDecode = state.phase === 'starting' && a.pendingPlay?.initial === true &&
    env.mediaInitialSeekCommandId === a.pendingPlay.commandId && event.type !== 'play-result';
  const blocked = unavailable(env, event.type === 'composition-start' || compositionWait, state.phase === 'following' && !a.pendingPlay, initialDecode);
  if (blocked) return finish(state, env, blocked);
  const currentDraftEdit = event.type === 'input' && event.epoch === a.scope.epoch &&
    event.edit.beforeRevision === a.draftRevision && event.edit.afterRevision === env.draftRevision &&
    event.edit.afterRevision === event.edit.beforeRevision + 1;
  if (env.draftRevision !== a.draftRevision && !currentDraftEdit) return finish(state, env, 'draft-revision-gap');
  // Configuration revocation is current environment evidence, even when an old
  // callback arrives first. It cannot authorize another write or resume.
  if (pacingChanged(a, env)) return finish(state, env, 'pacing-changed', 'off', event.type === 'interrupt' && event.reason === 'manual-rate');
  if (event.epoch !== a.scope.epoch) return result(state);
  if (event.type === 'interrupt') return finish(state, env, event.reason, 'off', event.reason === 'manual-rate');
  if (!Number.isFinite(env.nowMs) || env.nowMs < a.lastObservedMs) return finish(state, env, 'invalid-clock');
  if (env.nowMs - a.lastObservedMs > T.maxObservationGapMs) return finish(state, env, 'observation-gap');
  const initialSeekPending = state.phase === 'starting' && a.pendingPlay?.initial;
  if (!initialSeekPending || event.type === 'play-result') {
    if (!Number.isFinite(env.mediaPositionSeconds) || env.mediaPositionSeconds < a.scope.identity.cueStartSeconds) return finish(state, env, 'outside-cue');
    if (env.mediaPositionSeconds >= a.scope.identity.cueEndSeconds) return finish(state, env, 'sentence-ended', 'ended');
  }
  if (a.pendingPlay && env.nowMs - a.pendingPlay.issuedMs >= T.playTimeoutMs) return finish(state, env, 'play-timeout');
  if (!initialSeekPending && !holdsRateToken(a, env)) return finish(state, env, 'rate-ownership-changed', 'off', true);
  if (holdsRateToken(a, env) && !ownsRate(a, env)) {
    const currentAcknowledgement = (event.type === 'rate-applied' && event.commandId === a.rateWrite.commandId) ||
      (event.type === 'play-result' && event.commandId === a.pendingPlay?.commandId);
    return finish(state, env, currentAcknowledgement ? 'rate-not-applied' : 'rate-ownership-changed', 'off', !currentAcknowledgement);
  }
  let current: TypingFollowState = { ...state, active: { ...a, lastObservedMs: env.nowMs, actualRate: ownsRate(a, env) ? env.mediaRate : null } };
  if (event.type === 'rate-applied') {
    if (event.commandId !== a.rateWrite.commandId) return result(current);
    if (!ownsRate(a, env) || Math.abs(env.mediaRate - a.rateWrite.rate) > 1e-6) return finish(current, env, 'rate-not-applied');
    return result(current);
  }
  if (event.type === 'play-result') {
    if (event.commandId !== a.pendingPlay?.commandId) return result(current);
    if (!event.ok) return finish(current, env, 'play-rejected');
    if (!ownsRate(a, env) || Math.abs(env.mediaRate - a.rateWrite.rate) > 1e-6) return finish(current, env, 'rate-not-applied');
    return result({ ...current, phase: 'following', active: { ...current.active!, pendingPlay: null } });
  }
  if (event.type === 'composition-start') {
    if (!revision(event.compositionId)) return finish(current, env, 'unknown-composition');
    // Fixed playback never waits for input or resumes after composition. End this
    // scope so the host can mark the interrupted measurement unknown.
    if (a.pacingStrategy === 'fixed') return finish(current, env, 'fixed-composition-interrupted');
    if (compositionWait && a.compositionId === event.compositionId) return result(current);
    return waitForTyping(current, env, 'composition', event.compositionId);
  }
  if (event.type === 'composition-cancel') {
    if (!compositionWait || event.compositionId !== a.compositionId) return result(current);
    return result({ ...current, reason: 'idle', active: { ...current.active!, waitingReason: 'idle', compositionId: null } });
  }
  if (event.type === 'input') {
    const edit = event.edit;
    // Same commit revision deduplicates compositionend followed by an input notification.
    if (edit.afterRevision <= a.draftRevision) return result(current);
    if (edit.beforeRevision !== a.draftRevision || edit.afterRevision !== env.draftRevision) return finish(current, env, 'draft-revision-gap');
    const count = qualifyingTypingFollowAppend(edit);
    if (count === null) return finish(current, env, 'non-append-input');
    if (env.composing || (compositionWait && (edit.kind !== 'compositionend' || edit.compositionId !== a.compositionId))) return finish(current, env, 'uncommitted-composition');
    if (edit.kind === 'compositionend' && (!compositionWait || edit.compositionId !== a.compositionId)) return finish(current, env, 'unknown-composition');
    if (a.pacingStrategy === 'fixed') return result({ ...current, reason: null,
      active: { ...current.active!, draftRevision: edit.afterRevision, lastInputMs: env.nowMs } });
    const expired = env.nowMs - a.lastInputMs >= T.idleMs;
    const reset = state.phase === 'waiting' || expired;
    const samples = (reset ? [] : a.samples).filter(sample => env.nowMs - sample.atMs < T.windowMs);
    samples.push({ atMs: env.nowMs, count });
    if (samples.length > T.maxSamples) return finish(current, env, 'input-overflow');
    current = { ...current, reason: null, active: { ...current.active!, draftRevision: edit.afterRevision, lastInputMs: env.nowMs,
      samples, segmentStartedMs: reset ? env.nowMs : a.segmentStartedMs, waitingReason: null, compositionId: null } };
    if (state.phase === 'waiting') {
      let id = current.commandSequence;
      const rateCommand = ++id, playCommand = ++id;
      return result({ ...current, phase: 'starting', commandSequence: id, active: { ...current.active!, lastControlMs: env.nowMs,
        rateWrite: { commandId: rateCommand, rate: T.warmupRate }, pendingPlay: { commandId: playCommand, issuedMs: env.nowMs, initial: false } } },
      [{ type: 'set-rate', rate: T.warmupRate, onlyIfRateCommandId: a.rateWrite.commandId, onlyIfRateEquals: a.rateWrite.rate, scope: a.scope, commandId: rateCommand }, { type: 'resume', scope: a.scope, commandId: playCommand }]);
    }
    return result(current);
  }
  // Fixed audio is the authority: input and idle time cannot retune playback.
  if (a.pacingStrategy === 'fixed') return result(current);
  // A typing pause is not a known acoustic word boundary. Coast continuously to
  // the registered sentence endpoint instead of cutting speech mid-word. Safety,
  // explicit user and composition interruptions still pause immediately above.
  // A timer never resumes, seeks, checks an answer, or advances a cue.
  const idle = state.phase === 'following' && env.nowMs - a.lastInputMs >= T.idleMs;
  const samples = idle ? [] : a.samples.filter(sample => env.nowMs - sample.atMs < T.windowMs);
  current = { ...current, reason: idle ? 'idle-coasting' : current.reason, active: { ...current.active!, samples } };
  if (state.phase !== 'following' || env.nowMs - a.lastControlMs < T.tickMs) return result(current);
  const elapsedMs = Math.min(T.maxSmoothingMs, env.nowMs - a.lastControlMs);
  current = { ...current, active: { ...current.active!, lastControlMs: env.nowMs } };
  const observedMs = Math.min(T.windowMs, env.nowMs - a.segmentStartedMs);
  const qualified = observedMs >= T.minimumCoverageMs && samples.length >= 2 &&
    samples.at(-1)!.atMs - samples[0].atMs >= T.minimumCommitSeparationMs;
  const target = idle ? T.minRate : qualified ? estimatedTypingFollowRate(samples.reduce((sum, sample) => sum + sample.count, 0), observedMs, a.nominalGraphemesPerSecond) : T.warmupRate;
  if (target === null) return finish(current, env, 'invalid-estimate');
  const step = T.maxRateDeltaPerSecond * elapsedMs / 1000;
  const rate = Math.min(T.maxRate, Math.max(T.minRate, env.mediaRate + Math.max(-step, Math.min(step, target - env.mediaRate))));
  if (Math.abs(rate - env.mediaRate) + Number.EPSILON < T.rateDeadband) return result(current);
  const commandId = current.commandSequence + 1;
  return result({ ...current, commandSequence: commandId, active: { ...current.active!, rateWrite: { commandId, rate } } },
    [{ type: 'set-rate', rate, onlyIfRateCommandId: a.rateWrite.commandId, onlyIfRateEquals: a.rateWrite.rate, scope: a.scope, commandId }]);
}
