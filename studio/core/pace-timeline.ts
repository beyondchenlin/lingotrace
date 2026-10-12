import {
  createInitialSnapshot, reduceTraining,
  type FreezeReason, type TrainingEvent, type TrainingSnapshot,
} from './training.ts';

/** Presentation only. The reducer owns pace decay, boosts and all earned credit. */
export function formatPace(rawPace: number): number {
  return rawPace < 1 ? 0 : Math.round(rawPace);
}

/** Small Date.now()/performance.now() sampling skew is not an offline interval. */
export const TIMELINE_CLOCK_TOLERANCE_MS = 50;
export const PACE_TIMELINE_VERSION = 'recorded-wall-events-v1';

export interface PaceTrace {
  readonly eventId: string;
  readonly sequence: number;
  readonly eventType: TrainingEvent['type'];
  readonly sessionId: string;
  readonly roundId: string;
  readonly materialId: string;
  readonly materialVersion: string;
  readonly cueId: string;
  /** The event's input version, immediately before it is reduced. */
  readonly inputVersion: number;
  readonly attemptId: string | null;
  readonly schemaVersion: string;
  readonly ruleVersion: string;
  readonly paceRuleVersion: string;
  readonly wallTime: string;
  readonly wallTimeMs: number;
  /** Raw offset from the first event; can be negative after a wall-clock change. */
  readonly elapsedWallMs: number;
  readonly activeMsBefore: number;
  readonly activeMs: number;
}

export interface PaceTimelinePoint extends PaceTrace {
  readonly kind: 'input' | 'sample' | 'boundary';
  readonly rawPace: number;
  /** Exactly the integer that the HUD should display; below one displays zero. */
  readonly pace: number;
}

export interface PaceTimelineSegment {
  readonly id: string;
  /** Connect only within one segment, never across different segments. */
  readonly points: readonly PaceTimelinePoint[];
}

export interface PaceTimelineGap {
  readonly id: string;
  readonly kind: 'frozen' | 'unobserved' | 'clock-discontinuity';
  readonly from: PaceTrace;
  /** Last observed boundary, never Date.now() or a fabricated future endpoint. */
  readonly to: PaceTrace;
  readonly reasons: readonly FreezeReason[];
  /** Wall-clock duration only. Null when the clock ran backwards. */
  readonly observedWallMs: number | null;
  /** True means the final event remains frozen; its future duration is unknown. */
  readonly open: boolean;
}

export interface PaceTimelineMarker {
  readonly at: PaceTrace;
  readonly before: readonly FreezeReason[];
  readonly after: readonly FreezeReason[];
}

export interface PaceTimelineIssue {
  readonly code: 'wall-clock-reversed' | 'wall-active-mismatch';
  readonly from: PaceTrace;
  readonly to: PaceTrace;
  readonly wallDeltaMs: number;
  readonly activeDeltaMs: number;
}

export interface PaceTimeline {
  readonly version: typeof PACE_TIMELINE_VERSION;
  readonly axis: 'recorded-wall-time';
  readonly sessionId: string;
  readonly roundId: string;
  readonly lastSequence: number;
  readonly originWallTime: string | null;
  readonly domain: Readonly<{ minWallTimeMs: number; maxWallTimeMs: number }> | null;
  readonly points: readonly PaceTimelinePoint[];
  readonly segments: readonly PaceTimelineSegment[];
  readonly gaps: readonly PaceTimelineGap[];
  readonly markers: readonly PaceTimelineMarker[];
  readonly issues: readonly PaceTimelineIssue[];
  readonly sampleCount: number;
  readonly clockToleranceMs: number;
  readonly limitations: readonly string[];
}

const LIMITATIONS = Object.freeze([
  'The time axis uses recorded absolute wall timestamps, not a persisted all-state monotonic clock.',
  'Frozen clocks are not sampled. Open frozen spans stop at the last event and have no inferred duration beyond it.',
  'Reload/offline boundaries are not logged. Unaccounted wall-time intervals are gaps, with no inferred cause or pace.',
]);

type MutableSegment = { id: string; points: PaceTimelinePoint[] };
type MutableGap = { -readonly [Key in keyof PaceTimelineGap]: PaceTimelineGap[Key] };

function sameReasons(a: readonly FreezeReason[], b: readonly FreezeReason[]): boolean {
  return a.length === b.length && a.every(reason => b.includes(reason));
}

function trace(event: TrainingEvent, after: TrainingSnapshot, originMs: number): PaceTrace {
  const wallTimeMs = Date.parse(event.wallTime);
  return {
    eventId: event.eventId, sequence: event.sequence, eventType: event.type,
    sessionId: event.sessionId, roundId: after.roundId,
    materialId: event.materialId, materialVersion: event.materialVersion,
    cueId: event.cueId, inputVersion: event.inputVersion,
    attemptId: 'attemptId' in event ? event.attemptId : null,
    schemaVersion: event.schemaVersion, ruleVersion: event.ruleVersion,
    paceRuleVersion: event.paceRuleVersion,
    wallTime: event.wallTime, wallTimeMs, elapsedWallMs: wallTimeMs - originMs,
    activeMsBefore: event.activeMs, activeMs: after.activeMs,
  };
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Project the actual event log through the same reducer used by the HUD.
 * No score formula, interpolated sample, timer, random point or DOM dependency.
 * Intended for an expanded panel/review snapshot, not animation-frame calls.
 */
export function derivePaceTimeline(snapshot: TrainingSnapshot): PaceTimeline {
  const points: PaceTimelinePoint[] = [];
  const segments: MutableSegment[] = [];
  const gaps: MutableGap[] = [];
  const markers: PaceTimelineMarker[] = [];
  const issues: PaceTimelineIssue[] = [];
  let state = createInitialSnapshot(snapshot.sessionId, snapshot.material);
  let previous: PaceTrace | null = null;
  let segment: MutableSegment | null = null;
  let sampleCount = 0;
  let minWallTimeMs = Infinity, maxWallTimeMs = -Infinity;
  const origin = snapshot.events[0];
  const originMs = origin ? Date.parse(origin.wallTime) : 0;

  function addGap(kind: PaceTimelineGap['kind'], from: PaceTrace, to: PaceTrace,
    reasons: readonly FreezeReason[] = [], open = false) {
    const last = gaps[gaps.length - 1];
    // Preserve changes to overlapping freeze reasons as separate adjacent spans.
    if (kind === 'frozen' && last?.kind === kind && last.to.eventId === from.eventId &&
      sameReasons(last.reasons, reasons) && to.wallTimeMs >= last.to.wallTimeMs && last.observedWallMs !== null) {
      last.to = to;
      last.observedWallMs = to.wallTimeMs - last.from.wallTimeMs;
      last.open = open;
      return;
    }
    gaps.push({ id: `${kind}:${from.eventId}:${to.eventId}:${gaps.length}`, kind, from, to,
      reasons: [...reasons], observedWallMs: to.wallTimeMs >= from.wallTimeMs ? to.wallTimeMs - from.wallTimeMs : null, open });
  }

  for (const event of snapshot.events) {
    const before = state;
    state = reduceTraining(before, event);
    // The shared reducer ignores duplicate event IDs; the chart does too.
    if (state === before) continue;
    const at = trace(event, state, originMs);
    minWallTimeMs = Math.min(minWallTimeMs, at.wallTimeMs);
    maxWallTimeMs = Math.max(maxWallTimeMs, at.wallTimeMs);

    if (previous) {
      const wallDeltaMs = at.wallTimeMs - previous.wallTimeMs;
      const activeDeltaMs = state.activeMs - before.activeMs;
      const reversed = wallDeltaMs < 0;
      const mismatch = !before.frozenReasons.length &&
        Math.abs(wallDeltaMs - activeDeltaMs) > TIMELINE_CLOCK_TOLERANCE_MS;
      if (before.frozenReasons.length) {
        addGap('frozen', previous, at, before.frozenReasons);
        segment = null;
      }
      if (reversed || mismatch) {
        issues.push({ code: reversed ? 'wall-clock-reversed' : 'wall-active-mismatch',
          from: previous, to: at, wallDeltaMs, activeDeltaMs });
        if (!before.frozenReasons.length || reversed) {
          addGap(reversed || activeDeltaMs > wallDeltaMs ? 'clock-discontinuity' : 'unobserved', previous, at);
        }
        segment = null;
      }
    }

    if (!sameReasons(before.frozenReasons, state.frozenReasons)) {
      markers.push({ at, before: [...before.frozenReasons], after: [...state.frozenReasons] });
    }

    const wasFrozen = before.frozenReasons.length > 0;
    const isFrozen = state.frozenReasons.length > 0;
    const observedInput = event.type === 'inputCommitted' && !isFrozen &&
      state.drafts[event.cueId]?.version !== before.drafts[event.cueId]?.version;
    const observedSample = event.type === 'timeAdvanced' && !wasFrozen && event.deltaMs > 0;
    const observedBoundary = sampleCount > 0 && wasFrozen !== isFrozen;
    const kind = observedInput ? 'input' : observedSample ? 'sample' : observedBoundary ? 'boundary' : null;

    if (kind) {
      const point: PaceTimelinePoint = { ...at, kind, rawPace: state.pace, pace: formatPace(state.pace) };
      points.push(point);
      if (!segment) { segment = { id: `segment:${event.eventId}`, points: [] }; segments.push(segment); }
      segment.points.push(point);
      if (kind !== 'boundary') sampleCount++;
    }
    if (isFrozen) segment = null;
    previous = at;
  }

  if (state.sessionId !== snapshot.sessionId || state.sequence !== snapshot.sequence) {
    throw new Error('Snapshot metadata does not match its event log.');
  }
  if (previous && state.frozenReasons.length) addGap('frozen', previous, previous, state.frozenReasons, true);

  return freeze({ version: PACE_TIMELINE_VERSION, axis: 'recorded-wall-time',
    sessionId: state.sessionId, roundId: state.roundId, lastSequence: state.sequence,
    originWallTime: origin?.wallTime ?? null,
    domain: previous ? { minWallTimeMs, maxWallTimeMs } : null,
    points, segments, gaps, markers, issues, sampleCount,
    clockToleranceMs: TIMELINE_CLOCK_TOLERANCE_MS, limitations: LIMITATIONS });
}
