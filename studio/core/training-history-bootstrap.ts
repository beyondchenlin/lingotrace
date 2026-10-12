import type { AutomaticHistoryControl } from './automatic-history-control.ts';
import type { TrainingSnapshot } from './training.ts';

/** A retained prefix is not a recoverable current session after a privacy gap.
 * Never replay partial history, or silently present the last prefix as complete. */
export async function readTrainingHistoryBootstrap(repository: {
  readAutomaticHistoryControl(): Promise<AutomaticHistoryControl>;
  loadLatest(): Promise<TrainingSnapshot | null>;
}): Promise<{ control: AutomaticHistoryControl; saved: TrainingSnapshot | null; temporary: boolean }> {
  let control = await repository.readAutomaticHistoryControl();
  if (control.state !== 'legacy-default') return { control, saved: null, temporary: true };
  const saved = await repository.loadLatest();
  // A peer's OFF may commit while the saved prefix is being loaded.
  control = await repository.readAutomaticHistoryControl();
  return { control, saved: control.state === 'legacy-default' ? saved : null, temporary: control.state !== 'legacy-default' };
}
