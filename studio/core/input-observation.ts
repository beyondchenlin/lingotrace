export const INPUT_OBSERVATION_VERSION = 'input-observation-v1';
export const MAX_OBSERVATION_GAP_MS = 2500;

export type InputObservationRestartReason = 'start' | 'resume' | 'unobserved' | 'clock-reset' | 'explicit' | null;

/** Timing evidence only: no draft, composition candidate, score, or elapsed practice time. */
export interface InputObservationEvidence {
  readonly version: typeof INPUT_OBSERVATION_VERSION;
  readonly runId: string;
  readonly segment: number;
  /** The caller's monotonic source timestamp, such as performance.now(), never wall time. */
  readonly atMs: number;
  readonly state: 'observing' | 'suspended';
  readonly reasons: readonly string[];
  readonly restartReason: InputObservationRestartReason;
}

export interface InputObservationStep {
  /** Current blockers after applying the actual event. Composition is never a blocker. */
  readonly blockedReasons: readonly string[];
  /** True only for actual trusted input activity, never for a composition candidate or heartbeat. */
  readonly activity: boolean;
  readonly forceBoundary?: boolean;
}

const restartReasons: readonly InputObservationRestartReason[] = ['start', 'resume', 'unobserved', 'clock-reset', 'explicit', null];
const nonemptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Validate additive evidence without inventing evidence for legacy events. */
export function isInputObservationEvidence(value: unknown): value is InputObservationEvidence {
  if (!value || typeof value !== 'object') return false;
  const evidence = value as Partial<InputObservationEvidence>;
  if (evidence.version !== INPUT_OBSERVATION_VERSION || !nonemptyString(evidence.runId) ||
    !Number.isSafeInteger(evidence.segment) || (evidence.segment ?? 0) < 1 ||
    typeof evidence.atMs !== 'number' || !Number.isFinite(evidence.atMs) ||
    !Array.isArray(evidence.reasons) || !evidence.reasons.every(nonemptyString) ||
    evidence.reasons.includes('composition') || new Set(evidence.reasons).size !== evidence.reasons.length ||
    !restartReasons.includes(evidence.restartReason as InputObservationRestartReason)) return false;
  if (evidence.state === 'observing') return evidence.reasons.length === 0;
  return evidence.state === 'suspended' && evidence.reasons.length > 0 &&
    evidence.restartReason !== 'start' && evidence.restartReason !== 'resume';
}

/**
 * Independent foreground observation for input-rate projections. A new instance
 * is a new run; reconstructing this clock from saved events is not supported.
 * Call on each actual event and on foreground heartbeats while needsHeartbeat().
 * The projection, not this clock, owns five-second coverage and committed counts.
 */
export class InputObservationClock {
  private previous: InputObservationEvidence | null = null;

  private readonly runId: string;
  constructor(runId: string) {
    this.runId=runId;
    if (!nonemptyString(runId)) throw new Error('Input observation requires a nonempty run ID.');
  }

  get isObserving(): boolean { return this.previous?.state === 'observing'; }

  needsHeartbeat(): boolean { return this.isObserving; }

  step(nowMs: number, options: InputObservationStep): InputObservationEvidence | null {
    if (!Number.isFinite(nowMs)) throw new Error('Input observation requires a finite monotonic timestamp.');
    if (!Array.isArray(options.blockedReasons) || !options.blockedReasons.every(nonemptyString) ||
      typeof options.activity !== 'boolean' ||
      (options.forceBoundary !== undefined && typeof options.forceBoundary !== 'boolean')) {
      throw new Error('Invalid input observation step.');
    }
    // Copy and canonicalize caller-owned reasons. This defensive filter also
    // keeps older callers from freezing observation during an IME composition.
    const reasons = Object.freeze([...new Set(options.blockedReasons.filter(reason => reason !== 'composition'))].sort());
    const state = reasons.length ? 'suspended' : 'observing';
    const previous = this.previous;
    if (!previous && (!options.activity || state === 'suspended')) return null;

    let segment = previous?.segment ?? 1;
    let restartReason: InputObservationRestartReason = previous ? null : 'start';
    if (previous) {
      if (previous.state === 'suspended' && state === 'observing') restartReason = 'resume';
      else if (nowMs < previous.atMs) restartReason = 'clock-reset';
      else if (options.forceBoundary) restartReason = 'explicit';
      else if (previous.state === 'observing' && nowMs - previous.atMs > MAX_OBSERVATION_GAP_MS) restartReason = 'unobserved';
      if (restartReason) segment += 1;
    }
    const evidence: InputObservationEvidence = Object.freeze({
      version: INPUT_OBSERVATION_VERSION, runId: this.runId, segment, atMs: nowMs, state, reasons, restartReason,
    });
    this.previous = evidence;
    return evidence;
  }
}
