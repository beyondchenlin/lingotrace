import { addedGraphemes, type FreezeReason, type InputSource, type TrainingEvent, type TrainingSnapshot } from '../core/training';

export interface TransparentInputPoint {
  /** End of a complete one-second observation bin, or the location of a gap. */
  readonly atMs: number;
  /** Added typed/IME graphemes per second. Null means unmeasured, never zero. */
  readonly value: number | null;
}
export interface TransparentInputPulse {
  readonly eventId: string;
  readonly atMs: number;
  readonly ageMs: number;
  readonly added: number;
  readonly source: 'typed' | 'ime';
  readonly strength: number;
}
export interface TransparentInputFrame {
  readonly commits10s: number;
  /** Temporary input animation energy, not accuracy, proficiency, or reward. */
  readonly energy: number;
  readonly latestRate: number | null;
  /** Continuously observed, unfrozen elapsed time since attach / clock reset. */
  readonly observedMs: number;
  readonly frozen: boolean;
  readonly points: readonly TransparentInputPoint[];
  readonly pulses: readonly TransparentInputPulse[];
}

const BIN_MS = 1000;
const MAX_GAP_MS = 2000;
const HISTORY_MS = 30000;
// Keep waveform evidence for the same window as commits10s. Animation strength
// still decays with the independent 700 ms time constant in frame().
const PULSE_MS = 10000;
type Pulse = Omit<TransparentInputPulse, 'ageMs' | 'strength'>;

/**
 * A transient view of the existing TrainingEngine's committed events. No event
 * replay, persisted metrics, timers, or independent input engine live here.
 *
 * Use one shared monotonic clock for attach, subscription/RAF observe, and frame.
 * Read performance.now() in both subscription and render paths; do not mix it
 * with RAF's older frame-start timestamp. Repeated calls at the same time are safe.
 * Explicitly attach whenever replacing/restoring an engine, even if its restored
 * log is identical. Render-only observation is supported, but event timestamps
 * then mean first observed time, not reconstructed keystroke time.
 */
export class TransparentInputProjector {
  private sessionKey: string | null = null;
  private cursor = 0;
  private sequence = 0;
  private tailId: string | null = null;
  private drafts = new Map<string, string>();
  private reasons = new Set<FreezeReason>();
  private nowMs = 0;
  private binStartMs = 0;
  private binAdded = 0;
  private observed = 0;
  private awaitingSnapshot = false;
  private commits: { atMs: number; count: number }[] = [];
  private recentPulses: Pulse[] = [];
  private history: TransparentInputPoint[] = [];

  /** Prime the cursor and draft baselines; historical input never animates. */
  attach(snapshot: TrainingSnapshot, nowMs: number): void {
    checkTime(nowMs);
    this.sessionKey = key(snapshot);
    this.nowMs = this.binStartMs = nowMs;
    this.binAdded = this.observed = 0;
    this.commits = [];
    this.recentPulses = [];
    this.history = [];
    this.prime(snapshot);
  }

  observe(snapshot: TrainingSnapshot, nowMs: number): void {
    checkTime(nowMs);
    const anchor = snapshot.events[this.cursor - 1];
    if (this.sessionKey !== key(snapshot) || snapshot.sequence < this.sequence ||
      snapshot.events.length < this.cursor ||
      (this.cursor > 0 && (anchor?.eventId !== this.tailId || anchor.sequence !== this.sequence))) {
      this.attach(snapshot, nowMs);
      return;
    }
    const elapsed = nowMs - this.nowMs;
    // In render-only sampling, a whole freeze/resume cycle can arrive at once.
    // Its exact position within the elapsed interval is unknown: do not label
    // that interval as a fully measured second using only the final state.
    const crossedTransition = elapsed > 0 && elapsed <= MAX_GAP_MS &&
      snapshot.events.slice(this.cursor, -1).some(event => changesObservationState(event));
    if (crossedTransition) {
      this.point(nowMs, null);
      this.binStartMs = this.nowMs = nowMs;
      this.binAdded = 0;
    }
    this.advance(nowMs);
    if (this.awaitingSnapshot) {
      // Input somewhere in an unobserved interval cannot be assigned to now.
      this.prime(snapshot);
      this.binStartMs = nowMs;
      this.binAdded = 0;
      return;
    }
    for (let index = this.cursor; index < snapshot.events.length; index++) {
      const event = snapshot.events[index];
      if (event.sequence <= this.sequence) continue;
      if (event.sequence !== this.sequence + 1 || event.sessionId !== snapshot.sessionId) {
        this.attach(snapshot, nowMs);
        return;
      }
      this.consume(event, nowMs, index === snapshot.events.length - 1 ? snapshot.frozenReasons : undefined);
      this.sequence = event.sequence;
      this.tailId = event.eventId;
    }
    this.cursor = snapshot.events.length;
    // The authoritative endpoint also covers no-op submissions / stale judgments.
    this.setReasons(new Set(snapshot.frozenReasons), nowMs);
  }

  frame(nowMs: number): TransparentInputFrame {
    checkTime(nowMs);
    if (this.sessionKey === null) return { commits10s: 0, energy: 0, latestRate: null, observedMs: 0, frozen: true, points: [], pulses: [] };
    this.advance(nowMs);
    const frozen = this.isFrozen();
    const pulses = this.recentPulses.map(pulse => {
      const ageMs = nowMs - pulse.atMs;
      return { ...pulse, ageMs, strength: (1 - Math.exp(-pulse.added / 4)) * Math.exp(-ageMs / 700) };
    });
    const energy = frozen ? 0 : 1 - Math.exp(-pulses.reduce((sum, pulse) => sum + pulse.strength, 0));
    return {
      commits10s: this.commits.reduce((sum, bin) => sum + bin.count, 0),
      energy,
      latestRate: frozen ? null : (this.history.at(-1)?.value ?? null),
      observedMs: this.observed,
      frozen,
      // Return independent values so callers cannot mutate subsequent frames.
      points: this.history.map(point => ({ ...point })),
      pulses,
    };
  }

  private prime(snapshot: TrainingSnapshot): void {
    this.cursor = snapshot.events.length;
    this.sequence = snapshot.sequence;
    this.tailId = snapshot.events.at(-1)?.eventId ?? null;
    this.drafts = new Map(Object.entries(snapshot.drafts).map(([id, draft]) => [id, draft.text]));
    this.reasons = new Set(snapshot.frozenReasons);
    this.awaitingSnapshot = false;
  }

  private isFrozen(): boolean { return this.awaitingSnapshot || this.reasons.size > 0; }

  private consume(event: TrainingEvent, nowMs: number, finalReasons?: readonly FreezeReason[]): void {
    // The current event's real endpoint is authoritative, including metadata
    // events which the engine accepted into its log but applied as a no-op.
    if (finalReasons && event.type !== 'inputCommitted') {
      this.setReasons(new Set(finalReasons), nowMs);
      return;
    }
    const reasons = new Set(finalReasons ?? this.reasons);
    switch (event.type) {
      case 'freezeChanged': event.on ? reasons.add(event.reason) : reasons.delete(event.reason); break;
      case 'compositionStarted': reasons.add('composition'); break;
      case 'compositionEnded': reasons.delete('composition'); break;
      case 'cueChanged': reasons.delete('review'); reasons.delete('composition'); reasons.add('idle'); break;
      case 'submitRequested': reasons.add('checking'); break;
      case 'judgmentApplied': reasons.delete('checking'); reasons.add('review'); break;
      case 'inputCommitted': {
        const before = this.drafts.get(event.cueId) ?? '';
        if (before === event.text) return;
        this.drafts.set(event.cueId, event.text);
        reasons.delete('idle');
        reasons.delete('review');
        this.setReasons(reasons, nowMs);
        const last = this.commits.at(-1);
        if (last?.atMs === nowMs) last.count++;
        else this.commits.push({ atMs: nowMs, count: 1 });
        this.addPositiveInput(event.eventId, event.source, before, event.text, nowMs);
        return;
      }
      default: return; // Clock, hint and session metadata are not input commits.
    }
    this.setReasons(reasons, nowMs);
  }

  private addPositiveInput(eventId: string, source: InputSource, before: string, after: string, nowMs: number): void {
    if (source === 'paste' || this.isFrozen()) return;
    const added = addedGraphemes(before, after);
    if (added === 0) return;
    this.binAdded += added;
    this.recentPulses.push({ eventId, atMs: nowMs, added, source });
    this.recentPulses = this.recentPulses.slice(-256);
  }

  private setReasons(reasons: Set<FreezeReason>, nowMs: number): void {
    const wasFrozen = this.isFrozen();
    this.reasons = reasons;
    if (wasFrozen === this.isFrozen()) return;
    // Neither side of a freeze transition inherits a partly observed rate bin.
    if (nowMs > this.binStartMs || this.history.length) this.point(nowMs, null);
    this.binStartMs = nowMs;
    this.binAdded = 0;
    // Freezing stops live energy, not the evidence of earlier input. Renderers
    // can display these existing pulses as static history while frozen.
  }

  private advance(nowMs: number): void {
    const elapsed = nowMs - this.nowMs;
    if (elapsed < 0 || elapsed > MAX_GAP_MS) {
      if (elapsed < 0) {
        this.history = [];
        this.commits = [];
        this.observed = 0;
      }
      this.point(nowMs, null);
      this.recentPulses = [];
      this.binStartMs = nowMs;
      this.binAdded = 0;
      this.awaitingSnapshot = true;
    } else {
      if (!this.isFrozen()) this.observed += elapsed;
      while (this.binStartMs + BIN_MS <= nowMs) {
        this.binStartMs += BIN_MS;
        this.point(this.binStartMs, this.isFrozen() ? null : this.binAdded);
        this.binAdded = 0;
      }
    }
    this.nowMs = nowMs;
    this.commits = this.commits.filter(commit => nowMs - commit.atMs < 10000);
    this.recentPulses = this.recentPulses.filter(pulse => nowMs - pulse.atMs < PULSE_MS);
    this.history = this.history.filter(point => nowMs - point.atMs <= HISTORY_MS).slice(-64);
  }

  private point(atMs: number, value: number | null): void {
    // A transition at a bin boundary must not turn a measured bin into a gap.
    const last = this.history.at(-1);
    if (last?.atMs === atMs) {
      if (last.value === null || value !== null) this.history[this.history.length - 1] = { atMs, value };
      else this.history.push({ atMs, value });
    } else this.history.push({ atMs, value });
  }
}

function key(snapshot: TrainingSnapshot): string {
  return JSON.stringify([snapshot.sessionId, snapshot.roundId, snapshot.material.id, snapshot.material.version]);
}
function changesObservationState(event: TrainingEvent): boolean {
  return event.type === 'freezeChanged' || event.type === 'compositionStarted' || event.type === 'compositionEnded' ||
    event.type === 'cueChanged' || event.type === 'submitRequested' || event.type === 'judgmentApplied';
}
function checkTime(nowMs: number): void {
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new RangeError('Scene clock must be finite and nonnegative.');
}
