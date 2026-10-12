import type {TrainingSnapshot} from '../core/training';

/** Display-only selection from an admission-validated snapshot, not source validation. */
export function materialStageTitle(snapshot: Pick<TrainingSnapshot, 'schemaVersion' | 'material'> | null | undefined): string {
  return snapshot?.schemaVersion === 'lingotrace-session-builtin-v1'
    && snapshot.material.id === 'nps-connie-lau-education-ranger-7fe78a9f'
    ? 'NPS · CONNIE LAU'
    : 'CAFE CONVERSATION';
}
