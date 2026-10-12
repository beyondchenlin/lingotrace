/** Render geometry only. Callers own measurement, missing-data gaps, and clocks. */
export interface TracePoint {
  readonly x: number;
  readonly y: number;
}

export interface CubicTraceSegment {
  readonly from: TracePoint;
  readonly c1: TracePoint;
  readonly c2: TracePoint;
  readonly to: TracePoint;
}

function finitePoint(point: TracePoint | null | undefined): point is TracePoint {
  return point != null && Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** A stable harmonic mean; changing direction and plateaus have zero slope. */
function tangent(left: number, right: number): number {
  if (left === 0 || right === 0 || Math.sign(left) !== Math.sign(right)) return 0;
  const small = Math.min(Math.abs(left), Math.abs(right));
  const large = Math.max(Math.abs(left), Math.abs(right));
  return Math.sign(left) * small * (2 / (1 + small / large));
}

function blend(from: number, to: number, fraction: number): number {
  // Convex interpolation avoids overflow when coordinates are near the limits.
  const value = from * (1 - fraction) + to * fraction;
  return Math.max(Math.min(from, to), Math.min(Math.max(from, to), value));
}

function appendCurve(run: readonly TracePoint[], result: CubicTraceSegment[]): void {
  if (run.length < 2) return;
  const slopes = run.slice(1).map((point, index) =>
    (point.y - run[index].y) / (point.x - run[index].x));
  const tangents = run.map((_, index) => index === 0 ? slopes[0]
    : index === run.length - 1 ? slopes[index - 1]
    : tangent(slopes[index - 1], slopes[index]));

  for (let index = 0; index < slopes.length; index++) {
    const from = run[index];
    const to = run[index + 1];
    const slope = slopes[index];
    // Each nonzero tangent is at most twice either neighboring secant.
    // Thus alpha² + beta² <= 8 < 9: the Fritsch–Carlson monotonicity bound.
    const first = slope === 0 ? 0 : tangents[index] / slope / 3;
    const second = slope === 0 ? 0 : tangents[index + 1] / slope / 3;
    result.push({
      from: { ...from },
      c1: { x: blend(from.x, to.x, 1 / 3), y: blend(from.y, to.y, first) },
      c2: { x: blend(from.x, to.x, 2 / 3), y: blend(from.y, to.y, 1 - second) },
      to: { ...to },
    });
  }
}

/**
 * C1-smooth, shape-preserving cubic Hermite geometry through known observations.
 * No resampling, inferred observations, endpoint extension, or clock is involved.
 * The caller must split time gaps before mapping observations to x/y. Null and
 * invalid points also break a run; duplicate/decreasing x starts a new run.
 * Every returned segment carries its own exact endpoints, including after gaps.
 */
export function monotoneCurve(
  points: readonly (TracePoint | null | undefined)[],
): CubicTraceSegment[] {
  const result: CubicTraceSegment[] = [];
  let run: TracePoint[] = [];
  for (const point of points) {
    if (!finitePoint(point)) {
      appendCurve(run, result);
      run = [];
      continue;
    }
    const previous = run.at(-1);
    if (previous) {
      const dx = point.x - previous.x;
      const dy = point.y - previous.y;
      // Overflowed intervals cannot produce dependable finite render geometry.
      if (dx <= 0 || !Number.isFinite(dx) || !Number.isFinite(dy)
        || !Number.isFinite(dy / dx)) {
        appendCurve(run, result);
        run = [];
      }
    }
    run.push(point);
  }
  appendCurve(run, result);
  return result;
}

export interface TraceInputEvent {
  readonly eventId: string;
  readonly atMs: number;
  readonly added: number;
  /** Only committed typed or IME additions produce bars. */
  readonly source: string;
}

export interface InputEventBar {
  readonly id: string;
  /** Left edge = 0, current time = 1. Kept at subpixel precision. */
  readonly position: number;
  /** Bounded visual height from the actual added count, independent of age. */
  readonly amplitude: number;
  readonly ageMs: number;
}

export const MAX_EVENT_BARS = 256;

/**
 * One bar per retained real event, oldest first with stable ordering for ties.
 * Positions move continuously from fixed timestamps; there is no synthetic
 * carrier, oscillation, or resampling. The newest 256 in-window events survive
 * an overflow, even when input is unordered; temporary storage is also bounded.
 */
export function eventBars(
  events: readonly (TraceInputEvent | null | undefined)[],
  nowMs: number,
  windowMs = 10000,
): InputEventBar[] {
  if (!Number.isFinite(nowMs) || nowMs < 0
    || !Number.isFinite(windowMs) || windowMs <= 0) return [];

  const bars: InputEventBar[] = [];
  for (const event of events) {
    if (!event || (event.source !== 'typed' && event.source !== 'ime')
      || typeof event.eventId !== 'string' || event.eventId.length === 0
      || !Number.isFinite(event.atMs) || event.atMs < 0
      || !Number.isSafeInteger(event.added) || event.added <= 0) continue;
    const ageMs = nowMs - event.atMs;
    if (ageMs < 0 || ageMs > windowMs) continue;

    // Insertion into a capped array avoids copying or sorting the full history.
    let low = 0;
    let high = bars.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (bars[middle].ageMs >= ageMs) low = middle + 1;
      else high = middle;
    }
    if (bars.length === MAX_EVENT_BARS && low === 0) continue;
    bars.splice(low, 0, {
      id: event.eventId,
      position: 1 - ageMs / windowMs,
      amplitude: -Math.expm1(-event.added / 4),
      ageMs,
    });
    if (bars.length > MAX_EVENT_BARS) bars.shift();
  }
  return bars;
}
