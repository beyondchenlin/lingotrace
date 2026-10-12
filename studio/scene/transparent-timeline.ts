import { sampleStandbyEnergy, STANDBY_ENERGY_FLOOR } from './standby-energy';

/** Timings are media seconds, supplied by the bound material, never inferred. */
export interface TimelineCue {
  readonly id: string;
  readonly start?: number | null;
  readonly end?: number | null;
}

export interface CueMarker {
  readonly cueIndex: number;
  readonly id: string;
  readonly start: number;
  readonly ratio: number;
}

// Allow sub-millisecond media metadata rounding, not approximate cue placement.
const END_TOLERANCE_SECONDS = 0.001;

/** Unknown durations and unbound material must not acquire artificial markers. */
export function knownCueMarkers(
  cues: readonly TimelineCue[],
  durationSeconds: number | null | undefined,
  materialBound: boolean,
): CueMarker[] {
  if (!materialBound || typeof durationSeconds !== 'number' ||
    !Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const markers: CueMarker[] = [];
  cues.forEach((cue, cueIndex) => {
    const { start, end } = cue;
    if (typeof start !== 'number' || typeof end !== 'number' ||
      !Number.isFinite(start) || !Number.isFinite(end) || start < 0 ||
      start > durationSeconds || end <= start ||
      end - durationSeconds > END_TOLERANCE_SECONDS) return;
    markers.push({ cueIndex, id: cue.id, start, ratio: start / durationSeconds });
  });
  return markers;
}

/**
 * Resolve a pointer click already delivered to a cue hit box. All cue hit boxes
 * have equal width, so the closest center also belongs to a box under the
 * pointer when boxes overlap. This changes selection, never marker placement.
 * Exact-distance ties choose the lower original cue index, not DOM stacking.
 */
export function nearestCueMarker(
  markers: readonly CueMarker[],
  pointerRatio: number,
): CueMarker | null {
  if (!Number.isFinite(pointerRatio)) return null;
  let nearest: CueMarker | null = null;
  let distance = Infinity;
  for (const marker of markers) {
    const nextDistance = Math.abs(marker.ratio - pointerRatio);
    if (nextDistance < distance ||
      (nextDistance === distance && nearest && marker.cueIndex < nearest.cueIndex)) {
      nearest = marker;
      distance = nextDistance;
    }
  }
  return nearest;
}

export interface TimelineMotion {
  /** Decorative travel along at most 2.8% of the rail; never playback progress. */
  readonly progressFraction: number;
  /** Decorative play-icon translation in design pixels. */
  readonly playOffsetPx: number;
}

/**
 * A small standby impulse follows the shared energy envelope by 190 ms. All
 * state is provided by the caller; it cannot seek or change media timestamps.
 * Once playback has been touched, its real position owns the rail for the page.
 */
export function timelineMotion(
  nowMs: number,
  enteredAtMs: number,
  reducedMotion: boolean,
  standby: boolean,
  mediaInteracted: boolean,
): TimelineMotion {
  if (reducedMotion || !standby || mediaInteracted ||
    !Number.isFinite(nowMs) || !Number.isFinite(enteredAtMs) ||
    nowMs < 0 || enteredAtMs < 0) return { progressFraction: 0, playOffsetPx: 0 };
  const { energy } = sampleStandbyEnergy(nowMs, enteredAtMs, { lagMs: 190 });
  const activity = Math.max(0, (energy - STANDBY_ENERGY_FLOOR) / (1 - STANDBY_ENERGY_FLOOR));
  return {
    progressFraction: 0.028 * activity,
    playOffsetPx: 2.5 * activity,
  };
}

export interface MediaShortcutContext {
  readonly editing: boolean;
  readonly composing: boolean;
  readonly blocked: boolean;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

/** Classify a shortcut only; preventDefault and media actions belong to the UI. */
export function mediaShortcut(
  key: string,
  context: MediaShortcutContext,
): 'play' | 'previous' | 'next' | null {
  if (context.editing || context.composing || context.blocked ||
    context.altKey || context.ctrlKey || context.metaKey || context.shiftKey) return null;
  switch (key) {
    case ' ':
    case 'Space': return 'play';
    case 'ArrowLeft': return 'previous';
    case 'ArrowRight': return 'next';
    default: return null;
  }
}
