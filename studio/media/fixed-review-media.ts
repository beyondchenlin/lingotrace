import { builtinCourseForMaterial } from '../core/builtin-material.ts';
import { reviewSame, type ReviewTarget } from '../core/review-tasks.ts';
import type { OriginalCourseMediaLease } from './context-bookmark-media.ts';

/** Caller-owned, temporary reservation. A lesson takes it once, otherwise its
 * preparing operation releases it in finally. Never cached or persisted. */
export type PreparedReviewMedia = { lease: OriginalCourseMediaLease | null };

/** Byte/source verification remains mandatory in the caller. Only the exact
 * registered NPS identity permits the existing 1 ms decoder precision margin.
 * Actual cue bounds are never rounded or extended. Coffee stays exact. */
export function fixedReviewDurationMatches(target: ReviewTarget, actual: number): boolean {
  if (!Number.isFinite(actual) || actual <= 0) return false;
  let builtin: ReturnType<typeof builtinCourseForMaterial>;
  try { builtin = builtinCourseForMaterial(target.material); } catch { return false; }
  if (!builtin) return actual === target.media.durationSeconds;
  return target.media.id === builtin.mediaId && target.media.sha256 === builtin.mediaSha256 &&
    Number.isFinite(target.media.durationSeconds) && target.media.durationSeconds > 0 &&
    Math.abs(target.media.durationSeconds - builtin.durationSeconds) <= .001 &&
    Math.abs(actual - builtin.durationSeconds) <= .001 &&
    Math.abs(actual - target.media.durationSeconds) <= .001 &&
    target.material.cues.every(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) &&
      cue.start >= 0 && cue.end > cue.start && cue.end <= actual);
}

/** Compare a fresh, byte-verified measurement to an immutable saved target.
 * Only transient comparison uses its saved duration; never rewrite that target. */
export function fixedReviewTargetMatches(measured: ReviewTarget, expected: ReviewTarget): boolean {
  try { if (!builtinCourseForMaterial(measured.material)) return reviewSame(measured, expected); } catch { return false; }
  return fixedReviewDurationMatches(expected, measured.media.durationSeconds) &&
    reviewSame({ ...measured, media: { ...measured.media, durationSeconds: expected.media.durationSeconds } }, expected);
}

export { reviewMediaDiagnostic, reviewDurationDiagnostic, reviewRangeDiagnostic } from './media-load-diagnostic.ts';
