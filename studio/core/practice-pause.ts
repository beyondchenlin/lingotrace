import type { TrainingEngine } from './training';

/** Read the synchronous engine state, not a possibly stale React render. */
export const isPracticePaused = (engine: TrainingEngine | null): boolean =>
  !!engine?.getSnapshot().frozenReasons.includes('paused');

/** Whole-practice command. Resume only changes practice state; it never starts media. */
export function setWholePracticePaused(engine: TrainingEngine, paused: boolean, media: {
  pauseLesson(): void;
  interruptRecording(): void;
}): boolean {
  if (isPracticePaused(engine) === paused) return false;
  engine.setFrozen('paused', paused);
  if (paused) {
    try { media.pauseLesson(); }
    finally { media.interruptRecording(); }
  }
  return true;
}
