/** Opt-in local data contract. No UI, storage, media, network, or legacy migration. */
import { addedGraphemes, align, tokens, RULE_VERSION, type AlignmentResult, type EngineClock, type InputSource } from './training.ts';

export const PRACTICE_SCHEMA_VERSION = 'lingotrace-practice-v1' as const;
/** A v2 container explicitly permits ordinary v1 facts and timestamp-free redaction records. */
export const PRACTICE_SCHEMA_VERSION_V2 = 'lingotrace-practice-v2' as const;
// This schema's replay semantics are bound to the existing alignment algorithm.
const PRACTICE_ALIGNMENT_RULE_VERSION = 'word-alignment-v3';
export type PracticeMode = 'dictation' | 'recording-comparison';
export type ReferenceExposureKind = 'hint' | 'reveal' | 'reference' | 'translation' | 'correction' | 'shadowing';
export interface PracticeReference { readonly referenceVersion: string; readonly text: string; readonly startSeconds: number; readonly endSeconds: number }
export interface PracticeUnit { readonly unitId: string; readonly references: readonly PracticeReference[] }
export interface PracticeMaterial { readonly materialId: string; readonly title: string; readonly rights: string; readonly durationSeconds: number | null; readonly units: readonly PracticeUnit[] }
export interface ReferenceSnapshot extends PracticeReference { readonly materialId: string; readonly unitId: string; readonly materialDurationSeconds: number | null; readonly rangeVerification: 'verified' | 'duration-unknown' }
/** Explicit developer fixture only; constructing an engine does not install it. */
export const ORIGINAL_PRACTICE_MATERIAL: PracticeMaterial = freeze({
  materialId: 'original-cafe-data-v1', title: 'Three original café exchanges', rights: 'Original practice text; no source recording or audio assessment.', durationSeconds: 18,
  units: [
    { unitId: 'cafe-order', references: [{ referenceVersion: 'v1', text: 'Could I have a coffee, please?', startSeconds: 0, endSeconds: 6 }] },
    { unitId: 'cafe-choice', references: [{ referenceVersion: 'v1', text: 'I would like a small hot coffee.', startSeconds: 6, endSeconds: 12 }] },
    { unitId: 'cafe-thanks', references: [{ referenceVersion: 'v1', text: 'Thank you for your help today.', startSeconds: 12, endSeconds: 18 }] },
  ],
});
export interface UnredactedReferenceExposure {
  readonly eventId: string; readonly sequence: number; readonly occurredAt: string;
  readonly unitId: string; readonly attemptId: string | null; readonly kind: ReferenceExposureKind;
}
export interface RedactedReferenceExposure { readonly redacted: true; readonly unitId: string; readonly kind: ReferenceExposureKind; readonly attemptId?: never }
export type ReferenceExposure = UnredactedReferenceExposure | RedactedReferenceExposure;
export interface UnitExposure {
  readonly firstSubmissionSequence: number | null;
  readonly beforeFirstSubmission: readonly ReferenceExposure[];
  readonly afterFirstSubmission: readonly ReferenceExposure[];
}
export interface PracticeDraft {
  readonly text: string; readonly version: number; readonly source: InputSource;
  readonly sources: readonly InputSource[]; readonly pasted: boolean; readonly addedTypedGraphemes: number;
}
export interface PracticeSubmission {
  readonly submissionId: string; readonly eventId: string; readonly sequence: number; readonly occurredAt: string;
  readonly answer: string; readonly draftVersion: number; readonly inputSource: InputSource;
  readonly inputSources: readonly InputSource[]; readonly pasted: boolean;
  readonly exposureAtSubmission: readonly ReferenceExposure[];
  readonly activeMs: number;
  /** Word alignment only, never an audio/AI/translation-quality score. */
  readonly alignment: AlignmentResult | null; readonly ruleVersion: typeof RULE_VERSION | null;
  readonly practiceComplete: boolean; readonly evaluationComplete: boolean; readonly targetMet: boolean | null;
}
export interface AttemptRelation { readonly kind: 'retry' | 'mode-switch'; readonly attemptId: string }
export interface PracticeAttempt {
  readonly attemptId: string; readonly practiceRoundId: string; readonly mode: PracticeMode;
  readonly reference: ReferenceSnapshot; readonly relation: AttemptRelation | null;
  readonly startedAt: string; readonly startedSequence: number; readonly activeMs: number;
  readonly draft: PracticeDraft; readonly firstSubmission: PracticeSubmission | null;
  readonly revisions: readonly PracticeSubmission[];
  readonly practiceComplete: boolean; readonly evaluationComplete: boolean; readonly targetMet: boolean | null;
}
export interface PracticeRound {
  readonly practiceRoundId: string; readonly materialId: string; readonly startedAt: string;
  readonly endedAt: string | null; readonly activeMs: number;
  readonly attemptIds: readonly string[]; readonly unitExposure: Readonly<Record<string, UnitExposure>>;
}
export interface PracticeProjections {
  readonly catalog: readonly PracticeMaterial[];
  readonly rounds: Readonly<Record<string, PracticeRound>>;
  readonly attempts: Readonly<Record<string, PracticeAttempt>>;
  readonly currentRoundId: string | null; readonly currentAttemptId: string | null;
  readonly manualPaused: boolean; readonly videoPaused: boolean; readonly activeMs: number;
  /** v2 only; these are structural boundaries, never attempts or answer-bearing records. */
  readonly redaction?: PracticeRedactionContext;
}
export interface PracticeRedactionLineage { readonly unitId: string; readonly mode: PracticeMode; readonly referenceVersion: string }
export interface PracticeRedactionAnchor { readonly practiceRoundId: string; readonly lineage: PracticeRedactionLineage | null }
export interface PracticeRedactionContext {
  readonly targets: readonly { readonly attemptId: string; readonly redactionId: string }[];
  readonly anchors: Readonly<Record<string, PracticeRedactionAnchor>>;
  readonly currentAnchorId: string | null;
}
export type PracticeEventPayload =
  | { readonly type: 'sessionStarted'; readonly catalog: readonly PracticeMaterial[] }
  | { readonly type: 'materialRegistered'; readonly material: PracticeMaterial }
  | { readonly type: 'roundStarted'; readonly practiceRoundId: string; readonly materialId: string }
  | { readonly type: 'roundEnded'; readonly practiceRoundId: string }
  | { readonly type: 'attemptStarted'; readonly attemptId: string; readonly unitId: string; readonly mode: PracticeMode; readonly referenceVersion: string; readonly relation: AttemptRelation | null }
  | { readonly type: 'inputCommitted'; readonly attemptId: string; readonly text: string; readonly source: InputSource }
  | { readonly type: 'submissionCommitted'; readonly attemptId: string; readonly submissionId: string; readonly draftVersion: number }
  | { readonly type: 'referenceExposed'; readonly unitId: string; readonly attemptId: string | null; readonly kind: ReferenceExposureKind }
  | { readonly type: 'practicePauseChanged'; readonly paused: boolean }
  | { readonly type: 'videoPauseChanged'; readonly paused: boolean }
  | { readonly type: 'timeAdvanced'; readonly deltaMs: number };
export interface PracticeV1Event {
  readonly schemaVersion: typeof PRACTICE_SCHEMA_VERSION; readonly eventId: string; readonly sequence: number;
  readonly sessionId: string; readonly occurredAt: string; readonly recordedAt: string; readonly payload: PracticeEventPayload;
}
export type PracticeRedactionPayload =
  | { readonly type: 'erasedSlot' }
  | { readonly type: 'redactedAttemptBoundary'; readonly attemptId: string; readonly lineage: PracticeRedactionLineage | null }
  | { readonly type: 'redactedFirstSubmissionBoundary'; readonly attemptId: string; readonly unitId: string }
  | { readonly type: 'redactedExposureBoundary'; readonly attemptId: string; readonly unitId: string; readonly kind: ReferenceExposureKind }
  | { readonly type: 'redactedControlBoundary'; readonly manualPaused: boolean; readonly videoPaused: boolean }
  | { readonly type: 'attemptRedactionCommitted'; readonly attemptId: string; readonly redactionId: string };
export interface PracticeRedactionEvent {
  readonly schemaVersion: typeof PRACTICE_SCHEMA_VERSION_V2; readonly eventId: string; readonly sequence: number;
  readonly sessionId: string; readonly payload: PracticeRedactionPayload;
}
export type PracticeEvent = PracticeV1Event | PracticeRedactionEvent;
export interface PracticeSnapshot {
  readonly schemaVersion: typeof PRACTICE_SCHEMA_VERSION | typeof PRACTICE_SCHEMA_VERSION_V2; readonly sessionId: string; readonly sequence: number;
  readonly events: readonly PracticeEvent[]; readonly projections: PracticeProjections;
}
export interface PracticeEngineOptions { readonly clock?: EngineClock; readonly sessionId?: string; readonly catalog?: readonly PracticeMaterial[]; readonly snapshot?: PracticeSnapshot }
export interface StartPracticeAttempt { readonly unitId: string; readonly mode: PracticeMode; readonly referenceVersion?: string; readonly attemptId?: string }
const trustedSnapshots = new WeakSet<object>();
const modes: readonly PracticeMode[] = ['dictation', 'recording-comparison'];
const sources: readonly InputSource[] = ['typed', 'paste', 'ime'];
const exposureKinds: readonly ReferenceExposureKind[] = ['hint', 'reveal', 'reference', 'translation', 'correction', 'shadowing'];
const emptyDraft: PracticeDraft = freeze({ text: '', version: 0, source: 'typed', sources: [], pasted: false, addedTypedGraphemes: 0 });
const emptyExposure: UnitExposure = freeze({ firstSubmissionSequence: null, beforeFirstSubmission: [], afterFirstSubmission: [] });

function requireThat(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function requireGraphemeSupport(): void {
  requireThat(typeof Intl === 'object' && typeof Intl.Segmenter === 'function', 'Unsupported practice environment: Intl.Segmenter is required; code-point fallback cannot replay this schema.');
}
function object(value: unknown): asserts value is Record<string, unknown> {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected a JSON object.');
}
function keys(value: object, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  requireThat(actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]), 'Unexpected or missing JSON fields.');
}
function id(value: unknown) { requireThat(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value), 'Invalid stable ID.'); }
function timestamp(value: unknown) { requireThat(typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'Invalid ISO timestamp.'); }
function integer(value: unknown) { requireThat(Number.isSafeInteger(value) && (value as number) >= 0, 'Expected a nonnegative safe integer.'); }
function plainJSON(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { requireThat(Number.isFinite(value), 'Nonfinite JSON number.'); return; }
  requireThat(typeof value === 'object' && value !== null && !ancestors.has(value), 'Expected acyclic JSON data.');
  requireThat(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'Expected plain JSON data.');
  const next = new Set(ancestors); next.add(value);
  if (Array.isArray(value)) {
    requireThat(Object.keys(value).length === value.length, 'Sparse or extended JSON arrays are unsupported.');
    value.forEach(item => plainJSON(item, next));
  } else Object.values(value).forEach(item => plainJSON(item, next));
}
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}
function verified(snapshot: PracticeSnapshot): PracticeSnapshot { freeze(snapshot); trustedSnapshots.add(snapshot); return snapshot; }
function validateMaterial(value: unknown): asserts value is PracticeMaterial {
  object(value); keys(value, ['materialId', 'title', 'rights', 'durationSeconds', 'units']); id(value.materialId);
  requireThat(typeof value.title === 'string' && value.title.trim() && typeof value.rights === 'string' && value.rights.trim(), 'Material title and rights are required.');
  requireThat(value.durationSeconds === null || (typeof value.durationSeconds === 'number' && Number.isFinite(value.durationSeconds) && value.durationSeconds > 0), 'Duration must be positive finite seconds or explicitly null.');
  requireThat(Array.isArray(value.units) && value.units.length > 0, 'Material requires units.');
  const unitIds = new Set<string>();
  for (const unit of value.units) {
    object(unit); keys(unit, ['unitId', 'references']); id(unit.unitId);
    requireThat(!unitIds.has(unit.unitId as string), 'Duplicate unit ID.'); unitIds.add(unit.unitId as string);
    requireThat(Array.isArray(unit.references) && unit.references.length > 0, 'Unit requires reference versions.');
    const versions = new Set<string>();
    for (const reference of unit.references) {
      object(reference); keys(reference, ['referenceVersion', 'text', 'startSeconds', 'endSeconds']); id(reference.referenceVersion);
      requireThat(typeof reference.text === 'string' && reference.text.trim().length > 0, 'Reference text is required.');
      requireThat(typeof reference.startSeconds === 'number' && Number.isFinite(reference.startSeconds) && reference.startSeconds >= 0 && typeof reference.endSeconds === 'number' && Number.isFinite(reference.endSeconds) && reference.endSeconds > reference.startSeconds, 'Reference range must satisfy 0 <= start < end.');
      requireThat(value.durationSeconds === null || reference.endSeconds <= (value.durationSeconds as number), 'Reference end exceeds known material duration.');
      requireThat(!versions.has(reference.referenceVersion as string), 'Duplicate reference version.'); versions.add(reference.referenceVersion as string);
    }
  }
}
function mergeMaterial(catalog: readonly PracticeMaterial[], material: PracticeMaterial): readonly PracticeMaterial[] {
  validateMaterial(material);
  const prior = catalog.find(item => item.materialId === material.materialId);
  if (!prior) return [...catalog, material];
  requireThat(prior.title === material.title && prior.rights === material.rights && prior.durationSeconds === material.durationSeconds, 'Stable material metadata cannot be replaced.');
  const units = [...prior.units];
  for (const unit of material.units) {
    const index = units.findIndex(item => item.unitId === unit.unitId);
    if (index === -1) { units.push(unit); continue; }
    const references = [...units[index].references];
    for (const reference of unit.references) {
      const existing = references.find(item => item.referenceVersion === reference.referenceVersion);
      requireThat(!existing || (existing.text === reference.text && existing.startSeconds === reference.startSeconds && existing.endSeconds === reference.endSeconds), 'Reference version content conflict; create a new version.');
      if (!existing) references.push(reference);
    }
    units[index] = { ...units[index], references };
  }
  return catalog.map(item => item === prior ? { ...prior, units } : item);
}
function validateEvent(value: unknown): asserts value is PracticeEvent {
  plainJSON(value); object(value);
  if (value.schemaVersion === PRACTICE_SCHEMA_VERSION_V2) {
    keys(value, ['schemaVersion', 'eventId', 'sequence', 'sessionId', 'payload']);
    id(value.eventId); id(value.sessionId); integer(value.sequence); requireThat((value.sequence as number) > 0, 'Event sequence starts at one.');
    object(value.payload); const p = value.payload;
    switch (p.type) {
      case 'erasedSlot': keys(p, ['type']); break;
      case 'redactedAttemptBoundary':
        keys(p, ['type', 'attemptId', 'lineage']); id(p.attemptId);
        if (p.lineage !== null) {
          object(p.lineage); keys(p.lineage, ['unitId', 'mode', 'referenceVersion']); id(p.lineage.unitId); id(p.lineage.referenceVersion);
          requireThat(modes.includes(p.lineage.mode as PracticeMode), 'Unsupported redaction lineage mode.');
        }
        break;
      case 'redactedFirstSubmissionBoundary': keys(p, ['type', 'attemptId', 'unitId']); id(p.attemptId); id(p.unitId); break;
      case 'redactedExposureBoundary':
        keys(p, ['type', 'attemptId', 'unitId', 'kind']); id(p.attemptId); id(p.unitId);
        requireThat(exposureKinds.includes(p.kind as ReferenceExposureKind), 'Invalid redacted exposure kind.'); break;
      case 'redactedControlBoundary':
        keys(p, ['type', 'manualPaused', 'videoPaused']);
        requireThat(typeof p.manualPaused === 'boolean' && typeof p.videoPaused === 'boolean', 'Redacted control flags must be boolean.'); break;
      case 'attemptRedactionCommitted': keys(p, ['type', 'attemptId', 'redactionId']); id(p.attemptId); id(p.redactionId); break;
      default: throw new Error('Unsupported redaction event type.');
    }
    return;
  }
  keys(value, ['schemaVersion', 'eventId', 'sequence', 'sessionId', 'occurredAt', 'recordedAt', 'payload']);
  requireThat(value.schemaVersion === PRACTICE_SCHEMA_VERSION, 'Unsupported practice event schema.');
  id(value.eventId); id(value.sessionId); integer(value.sequence); requireThat((value.sequence as number) > 0, 'Event sequence starts at one.');
  timestamp(value.occurredAt); timestamp(value.recordedAt); object(value.payload);
  const p = value.payload;
  switch (p.type) {
    case 'sessionStarted': keys(p, ['type', 'catalog']); requireThat(Array.isArray(p.catalog), 'Catalog must be an array.'); p.catalog.forEach(validateMaterial); break;
    case 'materialRegistered': keys(p, ['type', 'material']); validateMaterial(p.material); break;
    case 'roundStarted': keys(p, ['type', 'practiceRoundId', 'materialId']); id(p.practiceRoundId); id(p.materialId); break;
    case 'roundEnded': keys(p, ['type', 'practiceRoundId']); id(p.practiceRoundId); break;
    case 'attemptStarted':
      keys(p, ['type', 'attemptId', 'unitId', 'mode', 'referenceVersion', 'relation']); id(p.attemptId); id(p.unitId); id(p.referenceVersion);
      requireThat(modes.includes(p.mode as PracticeMode), 'Unsupported practice mode.');
      if (p.relation !== null) { object(p.relation); keys(p.relation, ['kind', 'attemptId']); id(p.relation.attemptId); requireThat(['retry', 'mode-switch'].includes(p.relation.kind as string), 'Invalid attempt relation.'); }
      break;
    case 'inputCommitted': keys(p, ['type', 'attemptId', 'text', 'source']); id(p.attemptId); requireThat(typeof p.text === 'string' && sources.includes(p.source as InputSource), 'Invalid committed input or source.'); break;
    case 'submissionCommitted': keys(p, ['type', 'attemptId', 'submissionId', 'draftVersion']); id(p.attemptId); id(p.submissionId); integer(p.draftVersion); break;
    case 'referenceExposed': keys(p, ['type', 'unitId', 'attemptId', 'kind']); id(p.unitId); if (p.attemptId !== null) id(p.attemptId); requireThat(exposureKinds.includes(p.kind as ReferenceExposureKind), 'Invalid exposure kind.'); break;
    case 'practicePauseChanged': case 'videoPauseChanged': keys(p, ['type', 'paused']); requireThat(typeof p.paused === 'boolean', 'Pause flag must be boolean.'); break;
    case 'timeAdvanced': keys(p, ['type', 'deltaMs']); requireThat(typeof p.deltaMs === 'number' && Number.isFinite(p.deltaMs) && p.deltaMs > 0, 'Elapsed time must be positive and finite.'); break;
    default: throw new Error('Unsupported practice event type.');
  }
}
// JSON dictionaries inherit Object.prototype after parse; only own keys are facts.
function ownValue<T>(map: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}
function currentRound(p: PracticeProjections): PracticeRound {
  const round = p.currentRoundId ? ownValue(p.rounds, p.currentRoundId) : undefined;
  requireThat(round && round.endedAt === null, 'An open practice round is required.'); return round;
}
function currentAttempt(p: PracticeProjections, expectedId?: string): PracticeAttempt {
  currentRound(p);
  const attempt = p.currentAttemptId ? ownValue(p.attempts, p.currentAttemptId) : undefined;
  requireThat(attempt && (!expectedId || attempt.attemptId === expectedId), 'The current attempt is required.'); return attempt;
}
function editable(p: PracticeProjections) { requireThat(!p.manualPaused, 'Practice is manually paused; input and submission are blocked.'); }
function active(p: PracticeProjections) { return !p.manualPaused && p.currentRoundId !== null && ownValue(p.rounds, p.currentRoundId)?.endedAt === null && p.currentAttemptId !== null; }
interface RedactionFacts {
  readonly commits: ReadonlyMap<string, { readonly sequence: number; readonly redactionId: string }>;
  readonly lineageTargets: ReadonlySet<string>;
  readonly units: ReadonlyMap<string, string>;
}
/** Only structural facts from the sanitized stream; never an original-event ledger. */
function redactionFacts(events: readonly PracticeEvent[]): RedactionFacts | undefined {
  if (!events.some(event => event.schemaVersion === PRACTICE_SCHEMA_VERSION_V2)) return undefined;
  const commits = new Map<string, { sequence: number; redactionId: string }>(), redactionIds = new Set<string>();
  const lineageTargets = new Set<string>(), units = new Map<string, string>(), boundaries = new Set<string>();
  for (const event of events) if (event.payload.type === 'attemptRedactionCommitted') {
    const { attemptId, redactionId } = event.payload;
    requireThat(!commits.has(attemptId) && !redactionIds.has(redactionId), 'Duplicate redaction target or redaction ID.');
    commits.set(attemptId, { sequence: event.sequence, redactionId }); redactionIds.add(redactionId);
  }
  requireThat(commits.size > 0, 'Synthetic events require a committed redaction.');
  for (const event of events) {
    if (event.schemaVersion === PRACTICE_SCHEMA_VERSION) {
      const p = event.payload;
      if ('attemptId' in p && p.attemptId !== null) requireThat(!commits.has(p.attemptId), 'Ordinary facts for a deleted attempt are forbidden.');
      if (p.type === 'attemptStarted' && p.relation && commits.has(p.relation.attemptId)) lineageTargets.add(p.relation.attemptId);
    } else {
      const p = event.payload;
      if (!('attemptId' in p) || p.type === 'attemptRedactionCommitted') continue;
      const commit = commits.get(p.attemptId);
      requireThat(commit && event.sequence < commit.sequence, 'Redaction boundary requires a later matching commit.');
      if (p.type === 'redactedAttemptBoundary') {
        requireThat(!boundaries.has(p.attemptId), 'Duplicate redacted attempt boundary.'); boundaries.add(p.attemptId);
      }
      const unitId = 'unitId' in p ? p.unitId : p.type === 'redactedAttemptBoundary' ? p.lineage?.unitId : undefined;
      if (unitId !== undefined) {
        requireThat(!units.has(p.attemptId) || units.get(p.attemptId) === unitId, 'Conflicting redacted unit boundaries.'); units.set(p.attemptId, unitId);
      }
    }
  }
  for (const attemptId of commits.keys()) requireThat(boundaries.has(attemptId), 'Redaction commit has no attempt boundary.');
  for (const event of events) if (event.payload.type === 'redactedAttemptBoundary') {
    requireThat((event.payload.lineage !== null) === lineageTargets.has(event.payload.attemptId), 'Retain lineage only for a surviving direct relation.');
  }
  return { commits, lineageTargets, units };
}
function closeRedactedCursor(p: PracticeProjections): PracticeProjections {
  return p.redaction ? { ...p, redaction: { ...p.redaction, currentAnchorId: null } } : p;
}
function applyRedaction(p: PracticeProjections, event: PracticeRedactionEvent, facts: RedactionFacts): PracticeProjections {
  const context = p.redaction!; const payload = event.payload;
  requireThat(context, 'Redaction records require an explicit v2 container.');
  if (payload.type === 'redactedAttemptBoundary') {
    const round = currentRound(p); editable(p);
    requireThat(!ownValue(context.anchors, payload.attemptId) && !ownValue(p.attempts, payload.attemptId), 'Redacted attempt ID already exists.');
    if (payload.lineage) {
      const unit = p.catalog.find(material => material.materialId === round.materialId)?.units.find(unit => unit.unitId === payload.lineage!.unitId);
      requireThat(unit?.references.some(reference => reference.referenceVersion === payload.lineage!.referenceVersion), 'Unknown redacted lineage reference.');
    }
    return { ...p, currentAttemptId: null, redaction: { ...context, currentAnchorId: payload.attemptId,
      anchors: { ...context.anchors, [payload.attemptId]: { practiceRoundId: round.practiceRoundId, lineage: payload.lineage } } } };
  }
  if (payload.type === 'attemptRedactionCommitted') {
    requireThat(ownValue(context.anchors, payload.attemptId) && !context.targets.some(target => target.attemptId === payload.attemptId), 'Orphan or duplicate redaction commit.');
    return { ...p, redaction: { ...context, targets: [...context.targets, { attemptId: payload.attemptId, redactionId: payload.redactionId }],
      currentAnchorId: context.currentAnchorId === payload.attemptId ? null : context.currentAnchorId } };
  }
  requireThat(context.currentAnchorId !== null && p.currentAttemptId === null, 'Redaction marker requires the current redacted interval.');
  currentRound(p);
  requireThat(facts.commits.get(context.currentAnchorId)!.sequence > event.sequence, 'Redacted interval has already committed.');
  if (payload.type === 'erasedSlot') return p;
  if (payload.type === 'redactedControlBoundary') return { ...p, manualPaused: payload.manualPaused, videoPaused: payload.videoPaused };
  requireThat(payload.attemptId === context.currentAnchorId, 'Redaction marker does not belong to the current anchor.');
  const round = currentRound(p), material = p.catalog.find(item => item.materialId === round.materialId)!;
  requireThat(material.units.some(unit => unit.unitId === payload.unitId), 'Unknown redacted exposure unit.');
  const prior = ownValue(round.unitExposure, payload.unitId) ?? emptyExposure;
  let updated: UnitExposure;
  if (payload.type === 'redactedFirstSubmissionBoundary') {
    requireThat(ownValue(context.anchors, payload.attemptId)?.lineage?.mode !== 'recording-comparison', 'Recording comparison cannot supply a submission boundary.');
    requireThat(prior.firstSubmissionSequence === null, 'Only the first unit submission boundary may be retained.');
    updated = { ...prior, firstSubmissionSequence: event.sequence };
  } else {
    const exposure: RedactedReferenceExposure = { redacted: true, unitId: payload.unitId, kind: payload.kind };
    updated = prior.firstSubmissionSequence === null ? { ...prior, beforeFirstSubmission: [...prior.beforeFirstSubmission, exposure] } : { ...prior, afterFirstSubmission: [...prior.afterFirstSubmission, exposure] };
  }
  return { ...p, rounds: { ...p.rounds, [round.practiceRoundId]: { ...round, unitExposure: { ...round.unitExposure, [payload.unitId]: updated } } } };
}
function initial(sessionId: string, schemaVersion: PracticeSnapshot['schemaVersion'] = PRACTICE_SCHEMA_VERSION): PracticeSnapshot {
  return { schemaVersion, sessionId, sequence: 0, events: [], projections: {
    catalog: [], rounds: {}, attempts: {}, currentRoundId: null, currentAttemptId: null, manualPaused: false, videoPaused: false, activeMs: 0,
    ...(schemaVersion === PRACTICE_SCHEMA_VERSION_V2 ? { redaction: { targets: [], anchors: {}, currentAnchorId: null } } : {}),
  } };
}
function apply(state: PracticeSnapshot, event: PracticeEvent, facts?: RedactionFacts): PracticeSnapshot {
  requireThat(event.sessionId === state.sessionId && event.sequence === state.sequence + 1, 'Session mismatch or noncontiguous event sequence.');
  let p = state.projections;
  requireThat(state.sequence > 0 || event.payload.type === 'sessionStarted', 'Session start must be the first event.');
  if (event.schemaVersion === PRACTICE_SCHEMA_VERSION_V2) {
    requireThat(facts, 'Synthetic records may only be applied by validated replay.'); p = applyRedaction(p, event, facts);
  } else {
  const payload = event.payload;
  if (p.redaction?.currentAnchorId) {
    requireThat(!['timeAdvanced', 'practicePauseChanged', 'videoPauseChanged'].includes(payload.type), 'Deleted attempt timing and controls must be redacted.');
    if (payload.type === 'referenceExposed' && payload.attemptId === null) {
      requireThat(facts?.units.get(p.redaction.currentAnchorId) !== payload.unitId, 'Target-unit exposure inside a redacted interval requires a minimal boundary.');
    }
  }
  switch (payload.type) {
    case 'sessionStarted': {
      requireThat(state.sequence === 0, 'Session already started.');
      let catalog: readonly PracticeMaterial[] = [];
      payload.catalog.forEach(material => { catalog = mergeMaterial(catalog, material); });
      p = { ...p, catalog }; break;
    }
    case 'materialRegistered': p = { ...p, catalog: mergeMaterial(p.catalog, payload.material) }; break;
    case 'roundStarted': {
      requireThat(!p.currentRoundId || ownValue(p.rounds, p.currentRoundId)?.endedAt !== null, 'Explicitly end the current round before starting another.');
      requireThat(!ownValue(p.rounds, payload.practiceRoundId), 'Practice round ID already exists.');
      requireThat(p.catalog.some(material => material.materialId === payload.materialId), 'Unknown material.');
      const round: PracticeRound = { practiceRoundId: payload.practiceRoundId, materialId: payload.materialId, startedAt: event.occurredAt, endedAt: null, activeMs: 0, attemptIds: [], unitExposure: {} };
      p = closeRedactedCursor({ ...p, rounds: { ...p.rounds, [round.practiceRoundId]: round }, currentRoundId: round.practiceRoundId, currentAttemptId: null, manualPaused: false }); break;
    }
    case 'roundEnded': {
      const round = currentRound(p); requireThat(round.practiceRoundId === payload.practiceRoundId, 'Round mismatch.');
      p = closeRedactedCursor({ ...p, rounds: { ...p.rounds, [round.practiceRoundId]: { ...round, endedAt: event.occurredAt } }, currentAttemptId: null, manualPaused: false }); break;
    }
    case 'attemptStarted': {
      const round = currentRound(p); editable(p);
      requireThat(!ownValue(p.attempts, payload.attemptId) && !(p.redaction && ownValue(p.redaction.anchors, payload.attemptId)), 'Attempt ID already exists or was deleted.');
      const material = p.catalog.find(item => item.materialId === round.materialId)!;
      const unit = material.units.find(item => item.unitId === payload.unitId);
      const reference = unit?.references.find(item => item.referenceVersion === payload.referenceVersion);
      requireThat(reference, 'Unknown unit or reference version.');
      if (payload.relation) {
        const anchor = p.redaction && ownValue(p.redaction.anchors, payload.relation.attemptId);
        if (anchor) {
          requireThat(p.currentAttemptId === null && p.redaction!.currentAnchorId === payload.relation.attemptId && anchor.lineage, 'Related redacted attempt must be the current lineage anchor.');
          requireThat(anchor.practiceRoundId === round.practiceRoundId && anchor.lineage.unitId === payload.unitId && anchor.lineage.referenceVersion === payload.referenceVersion, 'Related attempts retain the original unit and reference.');
          requireThat(payload.relation.kind === 'retry' ? anchor.lineage.mode === payload.mode : anchor.lineage.mode !== payload.mode, 'Retry keeps the mode; a mode switch changes it.');
        } else {
          const prior = currentAttempt(p, payload.relation.attemptId);
          requireThat(prior.practiceRoundId === round.practiceRoundId && prior.reference.unitId === payload.unitId && prior.reference.referenceVersion === payload.referenceVersion, 'Related attempts retain the original unit and reference.');
          requireThat(payload.relation.kind === 'retry' ? prior.mode === payload.mode : prior.mode !== payload.mode, 'Retry keeps the mode; a mode switch changes it.');
        }
      } else {
        requireThat(!round.attemptIds.some(attemptId => ownValue(p.attempts, attemptId)?.reference.unitId === payload.unitId), 'Use an explicit retry or mode switch for this unit in this round.');
        requireThat(!p.redaction?.currentAnchorId || facts?.units.get(p.redaction.currentAnchorId) !== payload.unitId, 'Use an explicit relation to the current redacted unit.');
      }
      const attempt: PracticeAttempt = { attemptId: payload.attemptId, practiceRoundId: round.practiceRoundId, mode: payload.mode,
        reference: { materialId: round.materialId, unitId: payload.unitId, ...reference, materialDurationSeconds: material.durationSeconds, rangeVerification: material.durationSeconds === null ? 'duration-unknown' : 'verified' }, relation: payload.relation,
        startedAt: event.occurredAt, startedSequence: event.sequence, activeMs: 0, draft: emptyDraft, firstSubmission: null, revisions: [],
        practiceComplete: false, evaluationComplete: false, targetMet: null };
      p = closeRedactedCursor({ ...p, currentAttemptId: attempt.attemptId, attempts: { ...p.attempts, [attempt.attemptId]: attempt }, rounds: { ...p.rounds, [round.practiceRoundId]: { ...round, attemptIds: [...round.attemptIds, attempt.attemptId] } } }); break;
    }
    case 'inputCommitted': {
      requireGraphemeSupport(); editable(p); const attempt = currentAttempt(p, payload.attemptId); const draft = attempt.draft;
      requireThat(payload.text !== draft.text, 'Input event must change the committed draft.');
      const nextDraft: PracticeDraft = { text: payload.text, version: draft.version + 1, source: payload.source,
        sources: [...new Set([...draft.sources, payload.source])], pasted: draft.pasted || payload.source === 'paste',
        addedTypedGraphemes: draft.addedTypedGraphemes + (payload.source === 'paste' ? 0 : addedGraphemes(draft.text, payload.text)) };
      p = { ...p, attempts: { ...p.attempts, [attempt.attemptId]: { ...attempt, draft: nextDraft, evaluationComplete: false, targetMet: null } } }; break;
    }
    case 'submissionCommitted': {
      editable(p); const attempt = currentAttempt(p, payload.attemptId); const round = currentRound(p);
      requireThat(attempt.mode !== 'recording-comparison', 'Recording comparison requires real media evidence; submission is not implemented.');
      requireThat(attempt.draft.version === payload.draftVersion && attempt.draft.text.trim(), 'Submission requires the exact nonempty committed draft.');
      const latest = attempt.revisions.at(-1) ?? attempt.firstSubmission;
      requireThat(latest?.draftVersion !== payload.draftVersion, 'This draft version is already submitted.');
      requireThat(!Object.values(p.attempts).some(item => [item.firstSubmission, ...item.revisions].some(submission => submission?.submissionId === payload.submissionId)), 'Submission ID already exists.');
      const exposure = ownValue(round.unitExposure, attempt.reference.unitId) ?? emptyExposure;
      requireThat(RULE_VERSION === PRACTICE_ALIGNMENT_RULE_VERSION, 'Practice v1 requires its original alignment rule; use a new schema for changed grading.');
      const result = tokens(attempt.reference.text).length ? align(attempt.reference.text, attempt.draft.text) : null;
      const evaluationComplete = result !== null;
      const submission: PracticeSubmission = { submissionId: payload.submissionId, eventId: event.eventId, sequence: event.sequence, occurredAt: event.occurredAt,
        answer: attempt.draft.text, draftVersion: attempt.draft.version, inputSource: attempt.draft.source, inputSources: attempt.draft.sources, pasted: attempt.draft.pasted,
        exposureAtSubmission: [...exposure.beforeFirstSubmission, ...exposure.afterFirstSubmission], activeMs: attempt.activeMs,
        alignment: evaluationComplete ? result : null, ruleVersion: evaluationComplete ? RULE_VERSION : null,
        practiceComplete: true, evaluationComplete, targetMet: evaluationComplete ? result!.errors === 0 : null };
      const updated: PracticeAttempt = { ...attempt, firstSubmission: attempt.firstSubmission ?? submission,
        revisions: attempt.firstSubmission ? [...attempt.revisions, submission] : [], practiceComplete: submission.practiceComplete, evaluationComplete, targetMet: submission.targetMet };
      p = { ...p, attempts: { ...p.attempts, [attempt.attemptId]: updated }, rounds: { ...p.rounds, [round.practiceRoundId]: { ...round, unitExposure: { ...round.unitExposure, [attempt.reference.unitId]: { ...exposure, firstSubmissionSequence: exposure.firstSubmissionSequence ?? event.sequence } } } } }; break;
    }
    case 'referenceExposed': {
      editable(p); const round = currentRound(p);
      const material = p.catalog.find(item => item.materialId === round.materialId)!;
      requireThat(material.units.some(unit => unit.unitId === payload.unitId), 'Unknown exposure unit.');
      if (payload.attemptId !== null) requireThat(currentAttempt(p, payload.attemptId).reference.unitId === payload.unitId, 'Exposure unit does not match the current attempt.');
      const prior = ownValue(round.unitExposure, payload.unitId) ?? emptyExposure;
      const exposure: ReferenceExposure = { eventId: event.eventId, sequence: event.sequence, occurredAt: event.occurredAt, unitId: payload.unitId, attemptId: payload.attemptId, kind: payload.kind };
      const updated = prior.firstSubmissionSequence === null ? { ...prior, beforeFirstSubmission: [...prior.beforeFirstSubmission, exposure] } : { ...prior, afterFirstSubmission: [...prior.afterFirstSubmission, exposure] };
      p = { ...p, rounds: { ...p.rounds, [round.practiceRoundId]: { ...round, unitExposure: { ...round.unitExposure, [payload.unitId]: updated } } } }; break;
    }
    case 'practicePauseChanged': currentRound(p); requireThat(p.manualPaused !== payload.paused, 'Practice pause already has this value.'); p = { ...p, manualPaused: payload.paused }; break;
    case 'videoPauseChanged': requireThat(p.videoPaused !== payload.paused, 'Video pause already has this value.'); p = { ...p, videoPaused: payload.paused }; break;
    case 'timeAdvanced': {
      requireThat(active(p), 'Elapsed practice time cannot advance while paused or without an active attempt.');
      const round = currentRound(p), attempt = currentAttempt(p);
      requireThat(Number.isFinite(p.activeMs + payload.deltaMs), 'Elapsed time overflow.');
      p = { ...p, activeMs: p.activeMs + payload.deltaMs,
        rounds: { ...p.rounds, [round.practiceRoundId]: { ...round, activeMs: round.activeMs + payload.deltaMs } },
        attempts: { ...p.attempts, [attempt.attemptId]: { ...attempt, activeMs: attempt.activeMs + payload.deltaMs } } }; break;
    }
  }
  }
  return verified({ schemaVersion: state.schemaVersion, sessionId: state.sessionId, sequence: event.sequence, events: [...state.events, event], projections: p });
}
/** Exact repeated event IDs are idempotent; conflicting content under an ID is rejected. */
export function replayPracticeEvents(events: readonly PracticeEvent[]): PracticeSnapshot {
  requireGraphemeSupport();
  requireThat(Array.isArray(events) && events.length > 0, 'Replay requires a sessionStarted event.');
  const unique: PracticeEvent[] = [];
  const seen = new Map<string, PracticeEvent>();
  for (const incoming of events) {
    validateEvent(incoming);
    const duplicate = seen.get(incoming.eventId);
    if (duplicate) { requireThat(stable(duplicate) === stable(incoming), 'Conflicting duplicate event ID.'); continue; }
    const event = structuredClone(incoming); unique.push(event); seen.set(event.eventId, event);
  }
  const facts = redactionFacts(unique);
  let state = initial(unique[0].sessionId, facts ? PRACTICE_SCHEMA_VERSION_V2 : PRACTICE_SCHEMA_VERSION);
  for (const event of unique) state = apply(state, event, facts);
  return state;
}
/** Restore solely by replay. Imported projections must match; they are never a second fact source. */
export function validatePracticeSnapshot(snapshot: PracticeSnapshot): PracticeSnapshot {
  requireGraphemeSupport();
  if (snapshot.schemaVersion === PRACTICE_SCHEMA_VERSION && trustedSnapshots.has(snapshot)) return snapshot;
  plainJSON(snapshot); object(snapshot); keys(snapshot, ['schemaVersion', 'sessionId', 'sequence', 'events', 'projections']);
  requireThat(snapshot.schemaVersion === PRACTICE_SCHEMA_VERSION || snapshot.schemaVersion === PRACTICE_SCHEMA_VERSION_V2, 'Unsupported practice snapshot schema.');
  const canonical = replayPracticeEvents(snapshot.events);
  requireThat(stable(canonical) === stable(snapshot), 'Snapshot does not match its canonical event replay.');
  return canonical;
}
/**
 * Permanently replace target-owned facts in their original slots. The result contains
 * only surviving facts and minimal replay boundaries, with no recovery ledger.
 */
export function redactPracticeAttempt(snapshot: PracticeSnapshot, options: { attemptId: string; redactionId: string; eventId: () => string }): PracticeSnapshot {
  const canonical = validatePracticeSnapshot(snapshot);
  id(options.attemptId); id(options.redactionId); requireThat(typeof options.eventId === 'function', 'A fresh event ID factory is required.');
  const context = canonical.projections.redaction;
  if (context?.targets.some(target => target.attemptId === options.attemptId)) return canonical;
  const target = ownValue(canonical.projections.attempts, options.attemptId);
  requireThat(target, 'Unknown attempt to redact.');
  requireThat(!context?.targets.some(item => item.redactionId === options.redactionId), 'Redaction ID already exists.');
  requireThat(!canonical.events.some(event => event.eventId === options.redactionId), 'Redaction ID must not retain an existing event ID.');
  const survivingRelations = new Set(canonical.events.flatMap(event => event.payload.type === 'attemptStarted' && event.payload.attemptId !== target.attemptId && event.payload.relation ? [event.payload.relation.attemptId] : []));
  const facts = redactionFacts(canonical.events);
  let state = initial(canonical.sessionId, canonical.schemaVersion);
  const replacements = new Map<number, PracticeRedactionPayload>();
  let finalControl: { index: number; manualPaused: boolean; videoPaused: boolean } | null = null;
  for (let index = 0; index < canonical.events.length; index++) {
    const event = canonical.events[index], payload = event.payload;
    const targetCurrent = state.projections.currentAttemptId === target.attemptId;
    if (payload.type === 'attemptStarted' && payload.attemptId === target.attemptId) {
      replacements.set(index, { type: 'redactedAttemptBoundary', attemptId: target.attemptId,
        lineage: survivingRelations.has(target.attemptId) ? { unitId: target.reference.unitId, mode: target.mode, referenceVersion: target.reference.referenceVersion } : null });
    } else if (payload.type === 'inputCommitted' && payload.attemptId === target.attemptId) {
      replacements.set(index, { type: 'erasedSlot' });
    } else if (payload.type === 'submissionCommitted' && payload.attemptId === target.attemptId) {
      const exposure = ownValue(currentRound(state.projections).unitExposure, target.reference.unitId) ?? emptyExposure;
      replacements.set(index, exposure.firstSubmissionSequence === null
        ? { type: 'redactedFirstSubmissionBoundary', attemptId: target.attemptId, unitId: target.reference.unitId }
        : { type: 'erasedSlot' });
    } else if (payload.type === 'referenceExposed' && (payload.attemptId === target.attemptId || (payload.attemptId === null && targetCurrent && payload.unitId === target.reference.unitId))) {
      replacements.set(index, { type: 'redactedExposureBoundary', attemptId: target.attemptId, unitId: payload.unitId, kind: payload.kind });
    } else if (targetCurrent && ['timeAdvanced', 'practicePauseChanged', 'videoPauseChanged'].includes(payload.type)) {
      replacements.set(index, { type: 'erasedSlot' });
    } else if (payload.type === 'redactedAttemptBoundary' && payload.lineage && !survivingRelations.has(payload.attemptId)) {
      // A subsequent deletion may remove the last surviving user of older lineage.
      replacements.set(index, { type: 'redactedAttemptBoundary', attemptId: payload.attemptId, lineage: null });
    }
    state = apply(state, event, facts);
    if (targetCurrent && (payload.type === 'practicePauseChanged' || payload.type === 'videoPauseChanged')) {
      finalControl = { index, manualPaused: state.projections.manualPaused, videoPaused: state.projections.videoPaused };
    }
  }
  if (finalControl) replacements.set(finalControl.index, { type: 'redactedControlBoundary', manualPaused: finalControl.manualPaused, videoPaused: finalControl.videoPaused });
  const usedIds = new Set(canonical.events.map(event => event.eventId));
  const freshId = () => {
    const next = options.eventId(); id(next); requireThat(!usedIds.has(next), 'Redaction event IDs must be fresh and unique.'); usedIds.add(next); return next;
  };
  const events: PracticeEvent[] = canonical.events.map((event, index) => {
    const payload = replacements.get(index);
    return payload ? { schemaVersion: PRACTICE_SCHEMA_VERSION_V2, eventId: freshId(), sequence: event.sequence, sessionId: canonical.sessionId, payload } : event;
  });
  events.push({ schemaVersion: PRACTICE_SCHEMA_VERSION_V2, eventId: freshId(), sequence: canonical.sequence + 1, sessionId: canonical.sessionId,
    payload: { type: 'attemptRedactionCommitted', attemptId: target.attemptId, redactionId: options.redactionId } });
  return replayPracticeEvents(events);
}
const defaultClock: EngineClock = { now: () => performance.now(), wallTime: () => new Date().toISOString(), id: () => globalThis.crypto.randomUUID() };
/** Call from the existing controller. This engine installs no DOM or keyboard listeners. */
export class PracticeEngine {
  private snapshot: PracticeSnapshot;
  private readonly clock: EngineClock;
  private anchor: number;
  private listeners = new Set<() => void>();
  constructor(options: PracticeEngineOptions = {}) {
    requireGraphemeSupport();
    this.clock = options.clock ?? defaultClock; this.anchor = this.clock.now(); requireThat(Number.isFinite(this.anchor), 'Clock must be finite.');
    if (options.snapshot) {
      requireThat(options.catalog === undefined, 'Restore does not accept an overriding catalog; register new versions explicitly.');
      this.snapshot = validatePracticeSnapshot(options.snapshot);
      requireThat(options.sessionId === undefined || options.sessionId === this.snapshot.sessionId, 'Restored session ID mismatch.');
    } else {
      const sessionId = options.sessionId ?? this.clock.id(); id(sessionId); this.snapshot = initial(sessionId);
      this.emit({ type: 'sessionStarted', catalog: options.catalog ?? [] });
    }
  }
  getSnapshot = (): PracticeSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private emit(payload: PracticeEventPayload): PracticeSnapshot {
    const at = this.clock.wallTime();
    return this.dispatch({ schemaVersion: PRACTICE_SCHEMA_VERSION, eventId: this.clock.id(), sequence: this.snapshot.sequence + 1,
      sessionId: this.snapshot.sessionId, occurredAt: at, recordedAt: at, payload });
  }
  dispatch(event: PracticeEvent): PracticeSnapshot {
    validateEvent(event);
    requireThat(event.schemaVersion === PRACTICE_SCHEMA_VERSION, 'Synthetic redaction records cannot be dispatched by a live engine.');
    const duplicate = this.snapshot.events.find(item => item.eventId === event.eventId);
    if (duplicate) { requireThat(stable(duplicate) === stable(event), 'Conflicting duplicate event ID.'); return this.snapshot; }
    this.snapshot = apply(this.snapshot, structuredClone(event)); this.listeners.forEach(listener => listener()); return this.snapshot;
  }
  sampleClock = (): PracticeSnapshot => {
    const now = this.clock.now(); requireThat(Number.isFinite(now) && now >= this.anchor, 'Monotonic clock must not move backwards.');
    const elapsed = now - this.anchor; this.anchor = now;
    if (elapsed > 0 && active(this.snapshot.projections)) this.emit({ type: 'timeAdvanced', deltaMs: elapsed });
    return this.snapshot;
  };
  registerMaterial(material: PracticeMaterial): PracticeSnapshot {
    plainJSON(material); mergeMaterial(this.snapshot.projections.catalog, material); this.sampleClock(); return this.emit({ type: 'materialRegistered', material });
  }
  startRound(options: { materialId: string; practiceRoundId?: string }): PracticeSnapshot {
    const p = this.snapshot.projections;
    requireThat(!p.currentRoundId || ownValue(p.rounds, p.currentRoundId)?.endedAt !== null, 'Explicitly end the current round before starting another.');
    this.sampleClock(); return this.emit({ type: 'roundStarted', materialId: options.materialId, practiceRoundId: options.practiceRoundId ?? this.clock.id() });
  }
  endRound(): PracticeSnapshot { const round = currentRound(this.snapshot.projections); this.sampleClock(); return this.emit({ type: 'roundEnded', practiceRoundId: round.practiceRoundId }); }
  startAttempt(options: StartPracticeAttempt): PracticeAttempt { return this.beginAttempt(options, null); }
  private beginAttempt(options: StartPracticeAttempt, relation: AttemptRelation | null): PracticeAttempt {
    const p = this.snapshot.projections; editable(p); const round = currentRound(p);
    const unit = p.catalog.find(item => item.materialId === round.materialId)?.units.find(item => item.unitId === options.unitId);
    requireThat(unit, 'Unknown unit.');
    const referenceVersion = options.referenceVersion ?? unit.references.at(-1)!.referenceVersion;
    this.sampleClock(); const attemptId = options.attemptId ?? this.clock.id();
    this.emit({ type: 'attemptStarted', attemptId, unitId: options.unitId, mode: options.mode, referenceVersion, relation }); return ownValue(this.snapshot.projections.attempts, attemptId)!;
  }
  retryAttempt(): PracticeAttempt {
    const attempt = currentAttempt(this.snapshot.projections);
    return this.beginAttempt({ unitId: attempt.reference.unitId, referenceVersion: attempt.reference.referenceVersion, mode: attempt.mode }, { kind: 'retry', attemptId: attempt.attemptId });
  }
  switchMode(mode: PracticeMode): PracticeAttempt {
    const attempt = currentAttempt(this.snapshot.projections);
    requireThat(mode !== attempt.mode, 'A mode switch must change mode.');
    return this.beginAttempt({ unitId: attempt.reference.unitId, referenceVersion: attempt.reference.referenceVersion, mode }, { kind: 'mode-switch', attemptId: attempt.attemptId });
  }
  input(text: string, source: InputSource = 'typed'): PracticeSnapshot {
    requireGraphemeSupport();
    const p = this.snapshot.projections; editable(p); const attempt = currentAttempt(p);
    requireThat(typeof text === 'string' && sources.includes(source), 'Invalid committed input or source.');
    if (attempt.draft.text === text) return this.snapshot;
    this.sampleClock(); return this.emit({ type: 'inputCommitted', attemptId: attempt.attemptId, text, source });
  }
  submit(): PracticeSubmission {
    const p = this.snapshot.projections; editable(p); const attempt = currentAttempt(p);
    requireThat(attempt.mode !== 'recording-comparison', 'Recording comparison requires real media evidence; submission is not implemented.');
    requireThat(attempt.draft.text.trim(), 'Submission requires a nonempty committed draft.');
    const latest = attempt.revisions.at(-1) ?? attempt.firstSubmission;
    if (latest?.draftVersion === attempt.draft.version) return latest;
    this.sampleClock(); this.emit({ type: 'submissionCommitted', attemptId: attempt.attemptId, submissionId: this.clock.id(), draftVersion: attempt.draft.version });
    const updated = ownValue(this.snapshot.projections.attempts, attempt.attemptId)!; return updated.revisions.at(-1) ?? updated.firstSubmission!;
  }
  exposeReference(kind: ReferenceExposureKind): PracticeSnapshot {
    const p = this.snapshot.projections; editable(p); const attempt = currentAttempt(p);
    this.sampleClock(); return this.emit({ type: 'referenceExposed', unitId: attempt.reference.unitId, attemptId: attempt.attemptId, kind });
  }
  exposeUnitReference(unitId: string, kind: ReferenceExposureKind): PracticeSnapshot {
    editable(this.snapshot.projections); currentRound(this.snapshot.projections);
    this.sampleClock(); return this.emit({ type: 'referenceExposed', unitId, attemptId: null, kind });
  }
  pausePractice(): PracticeSnapshot {
    currentRound(this.snapshot.projections); if (this.snapshot.projections.manualPaused) return this.snapshot;
    this.sampleClock(); return this.emit({ type: 'practicePauseChanged', paused: true });
  }
  resumePractice(): PracticeSnapshot {
    currentRound(this.snapshot.projections); if (!this.snapshot.projections.manualPaused) return this.snapshot;
    this.sampleClock(); return this.emit({ type: 'practicePauseChanged', paused: false });
  }
  setVideoPaused(paused: boolean): PracticeSnapshot {
    requireThat(typeof paused === 'boolean', 'Pause flag must be boolean.');
    if (this.snapshot.projections.videoPaused === paused) return this.snapshot;
    this.sampleClock(); return this.emit({ type: 'videoPauseChanged', paused });
  }
}
