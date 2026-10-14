import type { Attempt } from './training.ts';
import { qualifyingTypingFollowAppend, sameTypingFollowIdentity, type TypingFollowAppend, type TypingFollowIdentity } from './typing-follow-policy.ts';

/** Observation tolerances, not a success threshold or an acoustic-accuracy claim. */
export const FIXED_PACE_FINISH_TUNING = Object.freeze({
  maxMediaGapMs: 1000, maxPlayStartMs: 1500, mediaQuantizationSeconds: 0.12,
  maxEndpointOvershootSeconds: 0.25, rateTolerance: 1e-6,
});

export interface FixedPaceFinishIdentity extends TypingFollowIdentity {
  /** Page-local engine identity; never serialized or frozen by this observer. */
  readonly engine: object;
  readonly sessionId: string;
  readonly roundId: string;
  readonly ownerId: string;
  readonly sourceUrl: string;
}
export interface FixedPaceFinishFrame {
  readonly identity: FixedPaceFinishIdentity;
  /** A single page's monotonic clock, normally performance.now(). */
  readonly nowMs: number;
  /** Fresh source, mode, foreground, focus, recording and interruption admission. */
  readonly eligible: boolean;
  readonly referenceShown: boolean;
}
export interface FixedPaceFinishBegin extends FixedPaceFinishFrame {
  readonly rate: number;
  readonly draft: string;
  readonly draftRevision: number;
  readonly inputVersion: number;
  readonly initialEdit?: TypingFollowAppend;
}
export interface FixedPaceFinishMedia extends FixedPaceFinishFrame {
  readonly rate: number;
  /** Direct native readback BEFORE any boundary pause, seek, clamp or rate restoration. */
  readonly positionSeconds: number;
  readonly paused: boolean;
  /** Actual native media-ended readback; never the controller's sentence-ended state. */
  readonly ended?: boolean;
  readonly seeking: boolean;
  readonly ready: boolean;
  /** Guarded native play has succeeded for this exact owner and source. */
  readonly successfullyPlaying: boolean;
}
export interface FixedPaceFinishAppend extends FixedPaceFinishFrame {
  readonly inputVersion: number;
  readonly edit: TypingFollowAppend;
}
export interface FixedPaceFinishCheck extends FixedPaceFinishFrame {
  readonly explicit: boolean;
  readonly currentAnswer: string;
  readonly draftRevision: number;
  readonly inputVersion: number;
  /** The existing engine's returned Check attempt, never a second judgment. */
  readonly attempt: Attempt | null;
}
export interface FixedPaceFinishResult {
  /** Final trusted committed input minus the observed native registered cue boundary. */
  readonly deltaMs: number | null;
  readonly reason: string | null;
  readonly rate: number;
  readonly referenceAssisted: boolean;
  readonly attemptId: string;
  readonly accuracy: number;
  readonly errors: number;
}
export interface FixedPaceFinishSnapshot {
  readonly phase: 'idle' | 'observing' | 'ended' | 'checked' | 'unknown';
  readonly reason: string | null;
  readonly result: FixedPaceFinishResult | null;
}
interface MediaSample { readonly nowMs: number; readonly positionSeconds: number }
interface Cycle {
  readonly identity: FixedPaceFinishIdentity;
  readonly rate: number;
  /** Locked at begin: assisted = reference shown for the whole run; dictation = reference stayed hidden. */
  readonly referenceAssisted: boolean;
  readonly beganMs: number;
  lastMs: number;
  draftRevision: number;
  inputVersion: number;
  draftLength: number;
  finalInputMs: number | null;
  firstMedia: MediaSample | null;
  lastMedia: MediaSample | null;
  cueEndMs: number | null;
}
const T = FIXED_PACE_FINISH_TUNING;
const revision = (n: number) => Number.isSafeInteger(n) && n >= 0;
const text = (s: unknown) => typeof s === 'string' && s.trim().length > 0;
const clock = (n: number) => Number.isFinite(n) && n >= 0;
const positive = (n: number) => Number.isFinite(n) && n > 0;
function identityValid(id: FixedPaceFinishIdentity): boolean {
  return !!id.engine && typeof id.engine === 'object' &&
    [id.sessionId, id.roundId, id.ownerId, id.sourceUrl, id.courseId, id.courseVersion,
      id.mediaId, id.mediaSha256, id.sentenceMapVersion, id.sentenceMapSha256, id.cueId].every(text) &&
    clock(id.cueStartSeconds) && Number.isFinite(id.cueEndSeconds) && id.cueEndSeconds > id.cueStartSeconds;
}
function sameIdentity(a: FixedPaceFinishIdentity, b: FixedPaceFinishIdentity): boolean {
  return a.engine === b.engine && a.sessionId === b.sessionId && a.roundId === b.roundId &&
    a.ownerId === b.ownerId && a.sourceUrl === b.sourceUrl && sameTypingFollowIdentity(a, b);
}

/**
 * Pure page-local observer. It cannot play, seek, score, save, award or advance.
 * Start only from a new empty draft (or its first trusted append). Keep a separate
 * native-input adapter alive after the playback controller releases its owner.
 * Call invalidate for every manual/lifecycle/native interruption, even if playback
 * already reached its endpoint; only an explicit begin creates another cycle.
 * Native samples must precede controller boundary effects. A timer's predicted end,
 * an interpolated position, duration arithmetic or a clamped seek is not evidence.
 * Public state contains no answer/reference text, keystroke log or durable metric.
 */
export class FixedPaceFinishObserver {
  private cycle: Cycle | null = null;
  private state: FixedPaceFinishSnapshot = Object.freeze({ phase: 'idle', reason: null, result: null });
  get snapshot(): FixedPaceFinishSnapshot { return this.state; }
  clear(): void { this.cycle = null; this.set('idle', null); }
  private set(phase: FixedPaceFinishSnapshot['phase'], reason: string | null, result: FixedPaceFinishResult | null = null): void {
    this.state = Object.freeze({ phase, reason, result: result ? Object.freeze(result) : null });
  }
  invalidate(reason: string): void {
    if (!this.cycle) return;
    // Check's transport cleanup is not an interruption of an already observed end.
    if (reason === 'check' && (this.state.phase === 'ended' || this.state.phase === 'checked')) return;
    this.set('unknown', this.state.reason ?? (reason === 'check' ? 'checked-before-cue-end' : reason || 'interrupted'));
  }
  private frame(frame: FixedPaceFinishFrame): boolean {
    const c = this.cycle;
    if (!c) return false;
    if (!sameIdentity(c.identity, frame.identity)) { this.invalidate('identity-changed'); return false; }
    if (frame.referenceShown !== c.referenceAssisted) {
      this.invalidate(frame.referenceShown ? 'reference-revealed' : 'reference-hidden'); return false;
    }
    if (!frame.eligible) { this.invalidate('ineligible'); return false; }
    if (!clock(frame.nowMs) || frame.nowMs < c.lastMs) { this.invalidate('clock-discontinuity'); return false; }
    c.lastMs = frame.nowMs;
    return true;
  }
  begin(frame: FixedPaceFinishBegin): void {
    this.clear();
    // Store only identity, revisions, length and final timestamps, never draft text.
    this.cycle = { identity: Object.freeze({ ...frame.identity }), rate: frame.rate, referenceAssisted: frame.referenceShown, beganMs: frame.nowMs,
      lastMs: frame.nowMs, draftRevision: frame.draftRevision, inputVersion: frame.inputVersion,
      draftLength: frame.draft.length, finalInputMs: null, firstMedia: null, lastMedia: null, cueEndMs: null };
    this.set('observing', null);
    if (!identityValid(frame.identity)) { this.invalidate('invalid-identity'); return; }
    if (!positive(frame.rate)) { this.invalidate('invalid-rate'); return; }
    if (!this.frame(frame)) return;
    const edit = frame.initialEdit;
    if (edit) {
      if (edit.before !== '' || edit.beforeRevision !== 0 || edit.afterRevision !== 1 ||
        frame.draft !== edit.after || frame.draftRevision !== 1 || frame.inputVersion !== 1 ||
        qualifyingTypingFollowAppend(edit) === null) { this.invalidate('nonempty-or-untrusted-start'); return; }
      this.cycle.finalInputMs = frame.nowMs;
    } else if (frame.draft !== '' || frame.draftRevision !== 0 || frame.inputVersion !== 0) {
      this.invalidate('nonempty-or-untrusted-start');
    }
  }
  append(frame: FixedPaceFinishAppend): void {
    if (!this.cycle) return;
    if (this.state.phase === 'checked') { this.invalidate('edited-after-check'); return; }
    if (!this.frame(frame) || this.state.phase === 'unknown') return;
    const c = this.cycle, edit = frame.edit;
    if (qualifyingTypingFollowAppend(edit) === null) { this.invalidate('untrusted-or-nonappend-input'); return; }
    if (edit.beforeRevision !== c.draftRevision || edit.afterRevision !== c.draftRevision + 1 ||
      edit.before.length !== c.draftLength || !revision(frame.inputVersion) || frame.inputVersion !== c.inputVersion + 1) {
      this.invalidate('input-revision-gap'); return;
    }
    c.draftRevision = edit.afterRevision; c.inputVersion = frame.inputVersion;
    c.draftLength = edit.after.length; c.finalInputMs = frame.nowMs;
  }
  observeMedia(frame: FixedPaceFinishMedia): void {
    if (!this.cycle || this.state.phase === 'unknown' || this.state.phase === 'checked') return;
    if (!this.frame(frame)) return;
    // End is latched once; expected controller pause/rate restoration cannot move it.
    if (this.state.phase === 'ended') return;
    const c = this.cycle, id = c.identity;
    const nativeEnd = frame.ended === true && !!c.firstMedia && frame.positionSeconds >= id.cueEndSeconds;
    if ((!frame.successfullyPlaying && !nativeEnd) || (frame.paused && !nativeEnd) || frame.seeking || !frame.ready) { this.invalidate('playback-unobserved'); return; }
    if (!positive(frame.rate) || Math.abs(frame.rate - c.rate) > T.rateTolerance) { this.invalidate('rate-changed'); return; }
    if (!Number.isFinite(frame.positionSeconds) || frame.positionSeconds < id.cueStartSeconds ||
      frame.positionSeconds > id.cueEndSeconds + T.maxEndpointOvershootSeconds) { this.invalidate('position-outside-cue'); return; }
    const sample = { nowMs: frame.nowMs, positionSeconds: frame.positionSeconds };
    if (!c.firstMedia || !c.lastMedia) {
      if (frame.nowMs - c.beganMs > T.maxPlayStartMs || frame.positionSeconds >= id.cueEndSeconds ||
        frame.positionSeconds - id.cueStartSeconds > T.mediaQuantizationSeconds) { this.invalidate('play-start-unobserved'); return; }
      c.firstMedia = sample; c.lastMedia = sample; return;
    }
    const previous = c.lastMedia, elapsedMs = frame.nowMs - previous.nowMs;
    const movement = frame.positionSeconds - previous.positionSeconds;
    const totalElapsedMs = frame.nowMs - c.firstMedia.nowMs;
    const totalMovement = frame.positionSeconds - c.firstMedia.positionSeconds;
    if (elapsedMs > T.maxMediaGapMs) { this.invalidate('media-observation-gap'); return; }
    if (movement < 0 || (elapsedMs === 0 && movement > 0) ||
      Math.abs(movement - elapsedMs * c.rate / 1000) > T.mediaQuantizationSeconds ||
      Math.abs(totalMovement - totalElapsedMs * c.rate / 1000) > T.mediaQuantizationSeconds) {
      this.invalidate('media-clock-discontinuity'); return;
    }
    c.lastMedia = sample;
    if (frame.positionSeconds >= id.cueEndSeconds) {
      if (elapsedMs <= 0 || movement <= 0 || previous.positionSeconds >= id.cueEndSeconds) { this.invalidate('cue-end-unobserved'); return; }
      c.cueEndMs = frame.nowMs; this.set('ended', null);
    }
  }
  check(frame: FixedPaceFinishCheck): FixedPaceFinishResult | null {
    if (!this.cycle || !frame.explicit) return null;
    if (!this.frame(frame)) return null;
    const c = this.cycle, attempt = frame.attempt;
    if (!attempt || !text(attempt.attemptId) || attempt.sessionId !== c.identity.sessionId ||
      attempt.roundId !== c.identity.roundId || attempt.materialId !== c.identity.courseId ||
      attempt.materialVersion !== c.identity.courseVersion || attempt.cueId !== c.identity.cueId ||
      attempt.answer !== frame.currentAnswer || attempt.inputVersion !== frame.inputVersion ||
      !revision(frame.inputVersion) || !revision(frame.draftRevision) || !positive(c.rate) || !frame.currentAnswer.trim() ||
      !Number.isFinite(attempt.accuracy) || attempt.accuracy < 0 || attempt.accuracy > 100 ||
      !revision(attempt.errors) || !positive(attempt.words)) {
      this.invalidate('checked-attempt-mismatch'); return null;
    }
    if (frame.inputVersion !== c.inputVersion || frame.draftRevision !== c.draftRevision || frame.currentAnswer.length !== c.draftLength) {
      this.invalidate('input-revision-gap');
    }
    if (this.state.phase === 'checked') {
      if (this.state.result?.attemptId === attempt.attemptId) return this.state.result;
      this.invalidate('checked-attempt-changed'); return null;
    }
    const reason = this.state.reason ?? (attempt.accuracy !== 100 || attempt.errors !== 0 ? 'answer-incomplete' :
      c.finalInputMs === null ? 'trusted-input-unobserved' : c.cueEndMs === null ? 'cue-end-unobserved' : null);
    const result: FixedPaceFinishResult = { deltaMs: reason ? null : c.finalInputMs! - c.cueEndMs!, reason,
      rate: c.rate, referenceAssisted: c.referenceAssisted, attemptId: attempt.attemptId, accuracy: attempt.accuracy, errors: attempt.errors };
    this.set('checked', reason, result); return this.state.result;
  }
}
