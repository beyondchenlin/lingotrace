import type { Attempt, TrainingSnapshot } from './training.ts';

/** Positive provenance only. Omission says nothing about prior reference exposure. */
export interface ReferenceExposure {
  readonly version: 'reference-exposure-v1';
  readonly surface: 'correction-editor' | 'corrected-version-confirmation';
}
export type ReferenceExposureSurface = ReferenceExposure['surface'];

export function isReferenceExposure(value: unknown): value is ReferenceExposure {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !Object.hasOwn(value, 'version') || !Object.hasOwn(value, 'surface')) return false;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate.version === 'reference-exposure-v1' &&
    (candidate.surface === 'correction-editor' || candidate.surface === 'corrected-version-confirmation');
}

/** Validate only the additive field; do not tighten the legacy event contract. */
export function validateOptionalReferenceExposure(event: { readonly type?: unknown; readonly kind?: unknown; readonly referenceExposure?: unknown }): void {
  const descriptor = Object.getOwnPropertyDescriptor(event, 'referenceExposure');
  if (!descriptor) return;
  if (!descriptor.enumerable || !('value' in descriptor) || event.type !== 'hintExposed' || event.kind !== 'reveal' || !isReferenceExposure(descriptor.value)) {
    throw new Error('Unsupported or invalid reference exposure. Provenance requires a reveal event.');
  }
}

export type AttemptReferenceExposure =
  | { readonly status: 'recorded'; readonly surfaces: readonly ReferenceExposureSurface[]; readonly eventIds: readonly string[]; readonly submitSequence: number }
  | { readonly status: 'unknown' };
const UNKNOWN: AttemptReferenceExposure = Object.freeze({ status: 'unknown' });

/** Read-only cause label for a retained attempt. Never changes its conditions or score.
 * Only a matching full-session submit boundary can establish positive provenance.
 * Partial facts deliberately do not contain this field and cannot establish absence. */
export function projectAttemptReferenceExposure(snapshot: TrainingSnapshot, attempt: Attempt): AttemptReferenceExposure {
  if (attempt.sessionId !== snapshot.sessionId || attempt.roundId !== snapshot.roundId ||
      attempt.materialId !== snapshot.material.id || attempt.materialVersion !== snapshot.material.version) return UNKNOWN;
  const retained = snapshot.attempts.find(candidate => candidate.attemptId === attempt.attemptId);
  if (!retained || retained.sessionId !== attempt.sessionId || retained.roundId !== attempt.roundId ||
      retained.materialId !== attempt.materialId || retained.materialVersion !== attempt.materialVersion ||
      retained.cueId !== attempt.cueId || retained.inputVersion !== attempt.inputVersion ||
      retained.answer !== attempt.answer || retained.reference !== attempt.reference) return UNKNOWN;
  const sameIdentity = (event: TrainingSnapshot['events'][number]) =>
    event.sessionId === attempt.sessionId && event.materialId === attempt.materialId &&
    event.materialVersion === attempt.materialVersion && event.cueId === attempt.cueId;
  const submit = snapshot.events.find(event => event.type === 'submitRequested' &&
    event.attemptId === attempt.attemptId && sameIdentity(event) && event.inputVersion === attempt.inputVersion &&
    event.draftVersion === attempt.inputVersion && event.answer === attempt.answer);
  if (!submit) return UNKNOWN;
  const surfaces = new Set<ReferenceExposureSurface>(), eventIds: string[] = [];
  for (const event of snapshot.events) {
    if (event.sequence >= submit.sequence || !sameIdentity(event)) continue;
    validateOptionalReferenceExposure(event);
    if (event.type !== 'hintExposed' || event.kind !== 'reveal' || !event.referenceExposure) continue;
    surfaces.add(event.referenceExposure.surface); eventIds.push(event.eventId);
  }
  return eventIds.length ? Object.freeze({ status: 'recorded', surfaces: Object.freeze([...surfaces]),
    eventIds: Object.freeze(eventIds), submitSequence: submit.sequence }) : UNKNOWN;
}
