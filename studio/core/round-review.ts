import type {Attempt, TrainingSnapshot} from './training';

/** Read-only current-round navigation. No new score, event, saved record or task. */
export type RoundReviewStatus = 'unsubmitted' | 'needs-correction' | 'matched' | 'unavailable';
export interface RoundReviewRow {
  readonly cueId: string;
  readonly cueIndex: number;
  readonly status: RoundReviewStatus;
  readonly submissions: number;
  readonly first: Attempt | null;
  readonly latest: Attempt | null;
}
export interface RoundReview {
  readonly rows: readonly RoundReviewRow[];
  readonly needsCorrection: number;
  readonly matched: number;
  readonly unsubmitted: number;
}
export function projectRoundReview(snapshot: TrainingSnapshot): RoundReview {
  const grouped = new Map<string, Attempt[]>();
  for (const attempt of snapshot.attempts) {
    const group = grouped.get(attempt.cueId);
    if (group) group.push(attempt); else grouped.set(attempt.cueId, [attempt]);
  }
  const ids = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const attempt of snapshot.attempts) {
    if (ids.has(attempt.attemptId)) duplicateIds.add(attempt.attemptId);
    ids.add(attempt.attemptId);
  }
  const rows = snapshot.material.cues.map((cue, cueIndex): RoundReviewRow => {
    const attempts = grouped.get(cue.id) ?? [];
    if (!attempts.length) return {cueId: cue.id, cueIndex, status: 'unsubmitted', submissions: 0, first: null, latest: null};
    // Trusted live/restored Training v1 snapshots are already validated by the
    // engine. Still refuse mixed references/rules instead of comparing them.
    const valid = attempts.every(a => !duplicateIds.has(a.attemptId) && a.sessionId === snapshot.sessionId && a.roundId === snapshot.roundId
      && a.materialId === snapshot.material.id && a.materialVersion === snapshot.material.version && a.reference === cue.text
      && a.ruleVersion === attempts[0].ruleVersion && a.words > 0 && Number.isFinite(a.accuracy) && a.accuracy >= 0 && a.accuracy <= 100
      && Number.isSafeInteger(a.errors) && a.errors >= 0);
    if (!valid) return {cueId: cue.id, cueIndex, status: 'unavailable', submissions: attempts.length, first: null, latest: null};
    const first = attempts[0], latest = attempts[attempts.length - 1];
    return {cueId: cue.id, cueIndex, submissions: attempts.length, first, latest, status: latest.errors ? 'needs-correction' : 'matched'};
  });
  return {rows, needsCorrection: rows.filter(r => r.status === 'needs-correction').length,
    matched: rows.filter(r => r.status === 'matched').length, unsubmitted: rows.filter(r => r.status === 'unsubmitted').length};
}

/** Revalidate the captured panel target before navigation; never apply a stale
 * panel to another round/reference. A newer draft is fine: navigation preserves it. */
export function roundReviewCueIndex(current: TrainingSnapshot, viewed: TrainingSnapshot, cueId: string): number | null {
  if (current.sessionId !== viewed.sessionId || current.roundId !== viewed.roundId || current.material.id !== viewed.material.id
    || current.material.version !== viewed.material.version || current.attempts.length !== viewed.attempts.length
    || current.attempts.some((a, i) => a !== viewed.attempts[i])) return null;
  const index = current.material.cues.findIndex(cue => cue.id === cueId);
  if (index < 0 || current.material.cues.filter(cue => cue.id === cueId).length !== 1) return null;
  const before = viewed.material.cues[index], after = current.material.cues[index];
  return before?.id === after.id && before.text === after.text && before.start === after.start && before.end === after.end ? index : null;
}
