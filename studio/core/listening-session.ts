import type { TrainingSnapshot } from './training.ts';
import type { ListeningConditions, ListeningSubmitBoundary, ReferencePresentation } from './listening-flow.ts';
import { freezeLegacyHistory, legacyHistoryIdentity, readLegacyHistoryRecord } from './legacy-history.ts';
export const LISTENING_SESSION_VERSION = 'listening-session-v1' as const;
export interface ListeningConditionsRecord {
  readonly schemaVersion: 'listening-conditions-v1';
  readonly identity: { readonly sessionId: string; readonly roundId: string; readonly materialId: string; readonly materialVersion: string; readonly referenceVersion: string };
  readonly presentations: readonly ReferencePresentation[]; readonly boundaries: readonly ListeningSubmitBoundary[];
}
export interface ListeningSessionScopeOptions { readonly scopeId: string; readonly startedAt: string; readonly referenceVersion: string }
export interface ListeningSessionRecord {
  readonly version: typeof LISTENING_SESSION_VERSION; readonly sessionId: string; readonly sequence: number; readonly updatedAt: string;
  readonly snapshot: { readonly schemaVersion: typeof LISTENING_SESSION_VERSION; readonly events: null };
  readonly trainingSnapshot: TrainingSnapshot;
  readonly preBRecord: { readonly sessionId: string; readonly sequence: number; readonly snapshot: TrainingSnapshot; readonly updatedAt: string } | null;
  readonly scope: ListeningSessionScopeOptions & { readonly admittedSequence: number; readonly generation: 0; readonly revision: number };
  readonly conditions: ListeningConditionsRecord;
}
declare const scopePermitBrand: unique symbol;
export type ListeningSessionPermit = Readonly<{ [scopePermitBrand]: true }>;
export interface ListeningSessionAdmission { readonly permit: ListeningSessionPermit; readonly record: ListeningSessionRecord }
function fail(message = 'Invalid listening session envelope.'): never { throw new Error(message); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== keys.length) fail();
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(value, key); if (!d?.enumerable || !('value' in d)) fail(); }
  return value as Record<string, unknown>;
}
function text(value: unknown): asserts value is string { if (typeof value !== 'string' || !value.trim() || value.length > 4096) fail(); }
function integer(value: unknown, minimum = 0): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < minimum) fail(); }
function array(value: unknown): unknown[] { if (!Array.isArray(value) || value.length > 100000 || Reflect.ownKeys(value).length !== value.length + 1) fail(); return value; }
export function isListeningSessionRecord(value: unknown): boolean { return !!value && typeof value === 'object' && (value as { version?: unknown }).version === LISTENING_SESSION_VERSION; }
export function captureListeningScopeOptions(value: ListeningSessionScopeOptions): ListeningSessionScopeOptions {
  const row = object(value, ['scopeId', 'startedAt', 'referenceVersion']); text(row.scopeId); text(row.referenceVersion); text(row.startedAt);
  if (!Number.isFinite(Date.parse(row.startedAt))) fail(); return Object.freeze({ scopeId: row.scopeId, startedAt: row.startedAt, referenceVersion: row.referenceVersion });
}
/** The temporary label is input provenance, never a persistence capability. */
export function captureListeningConditions(value: ReturnType<ListeningConditions['snapshot']> | ListeningConditionsRecord): ListeningConditionsRecord {
  const keys = ['schemaVersion', 'identity', 'presentations', 'boundaries'];
  const hasStorage = !!value && Object.hasOwn(value, 'storage');
  const row = object(value, hasStorage ? [...keys, 'storage'] : keys);
  if (row.schemaVersion !== 'listening-conditions-v1' || (hasStorage && row.storage !== 'temporary-not-persisted')) fail();
  const identity = object(row.identity, ['sessionId', 'roundId', 'materialId', 'materialVersion', 'referenceVersion']); for (const value of Object.values(identity)) text(value);
  const ordinals = new Set<number>(); let lastPresentation = 0, lastBoundary = 0;
  for (const item of array(row.presentations)) {
    const p = object(item, ['ordinal', 'cueId', 'surface', 'referenceVersion']); integer(p.ordinal, 1); text(p.cueId); text(p.referenceVersion);
    if (!['automatic-text', 'target-key', 'subtitle', 'explanation'].includes(p.surface as string) || p.referenceVersion !== identity.referenceVersion || p.ordinal <= lastPresentation || ordinals.has(p.ordinal)) fail();
    lastPresentation = p.ordinal; ordinals.add(p.ordinal);
  }
  const requests = new Set<string>(), attempts = new Set<string>();
  for (const item of array(row.boundaries)) {
    const b = object(item, ['eventId', 'attemptId', 'inputVersion', 'cueId', 'ordinal', 'assistance', 'coverage', 'exposureOrdinals', 'disposition']);
    integer(b.ordinal, 1); integer(b.inputVersion); text(b.eventId); text(b.attemptId); text(b.cueId);
    if (requests.has(b.eventId) || attempts.has(b.attemptId) || ordinals.has(b.ordinal) || b.ordinal <= lastBoundary) fail();
    requests.add(b.eventId); attempts.add(b.attemptId); ordinals.add(b.ordinal); lastBoundary = b.ordinal;
    if (!['known-assisted', 'no-observed-assistance', 'unknown'].includes(b.assistance as string) || !['complete-to-submit', 'partial', 'unavailable'].includes(b.coverage as string) || !['pending', 'retained', 'discarded'].includes(b.disposition as string)) fail();
    const exposure = array(b.exposureOrdinals); if (new Set(exposure).size !== exposure.length) fail();
    for (const ordinal of exposure) { integer(ordinal, 1); if (ordinal >= b.ordinal || !(row.presentations as ReferencePresentation[]).some(p => p.ordinal === ordinal && p.cueId === b.cueId)) fail(); }
    if (b.assistance === 'no-observed-assistance' && b.coverage !== 'complete-to-submit') fail();
    if (exposure.length && b.assistance !== 'known-assisted') fail();
    const allExposures = (row.presentations as ReferencePresentation[]).filter(p => p.cueId === b.cueId && p.ordinal < (b.ordinal as number)).map(p => p.ordinal);
    if (legacyHistoryIdentity(exposure) !== legacyHistoryIdentity(allExposures)) fail('Listening submit omitted prior reference evidence.');
  }
  return freezeLegacyHistory(structuredClone({ schemaVersion: row.schemaVersion, identity, presentations: row.presentations, boundaries: row.boundaries })) as ListeningConditionsRecord;
}
export function readListeningSession(value: unknown, expectedSessionId?: string): ListeningSessionRecord {
  const row = object(value, ['version', 'sessionId', 'sequence', 'updatedAt', 'snapshot', 'trainingSnapshot', 'preBRecord', 'scope', 'conditions']);
  if (row.version !== LISTENING_SESSION_VERSION) fail(); text(row.sessionId); integer(row.sequence, 1); text(row.updatedAt);
  const sentinel = object(row.snapshot, ['schemaVersion', 'events']); if (sentinel.schemaVersion !== LISTENING_SESSION_VERSION || sentinel.events !== null) fail();
  const current = readLegacyHistoryRecord({ sessionId: row.sessionId, sequence: row.sequence, updatedAt: row.updatedAt, snapshot: row.trainingSnapshot }, expectedSessionId).snapshot;
  const scope = object(row.scope, ['scopeId', 'startedAt', 'referenceVersion', 'admittedSequence', 'generation', 'revision']);
  captureListeningScopeOptions({ scopeId: scope.scopeId as string, startedAt: scope.startedAt as string, referenceVersion: scope.referenceVersion as string });
  integer(scope.admittedSequence, 1); integer(scope.revision); if (scope.generation !== 0 || scope.admittedSequence > current.sequence) fail();
  if (row.preBRecord !== null) {
    object(row.preBRecord, ['sessionId', 'sequence', 'snapshot', 'updatedAt']); const before = readLegacyHistoryRecord(row.preBRecord, current.sessionId).snapshot;
    if (before.sequence > scope.admittedSequence || before.roundId !== current.roundId) fail(); assertTrainingPrefix(before, current);
  }
  const conditions = captureListeningConditions(row.conditions as ListeningConditionsRecord), id = conditions.identity;
  if (id.sessionId !== current.sessionId || id.roundId !== current.roundId || id.materialId !== current.material.id || id.materialVersion !== current.material.version || id.referenceVersion !== scope.referenceVersion) fail();
  const cueIds = new Set(current.material.cues.map(c => c.id)); for (const p of conditions.presentations) if (!cueIds.has(p.cueId)) fail();
  const submits = current.events.filter(e => e.type === 'submitRequested' && e.sequence > (scope.admittedSequence as number));
  if (submits.length !== conditions.boundaries.length) fail('Every post-scope submission requires its atomic assistance boundary.');
  for (const boundary of conditions.boundaries) {
    const request = submits.find(e => e.eventId === boundary.eventId);
    if (!request || request.type !== 'submitRequested' || request.attemptId !== boundary.attemptId || request.cueId !== boundary.cueId || request.draftVersion !== boundary.inputVersion || request.inputVersion !== boundary.inputVersion) fail();
    const attempt = current.attempts.find(a => a.attemptId === boundary.attemptId);
    const disposition = attempt ? 'retained' : current.discardedJudgmentIds.includes(boundary.attemptId) ? 'discarded' : 'pending';
    const positive = attempt?.conditions ?? current.pendingAttempts[boundary.attemptId]?.conditions;
    const priorHint = current.events.some(event => event.type === 'hintExposed' && event.cueId === boundary.cueId && event.sequence < request.sequence);
    if (boundary.disposition !== disposition || ((priorHint || (positive && (positive.hinted || positive.revealed))) && boundary.assistance !== 'known-assisted')) fail();
  }
  if (JSON.stringify(value).length > 32 * 1024 * 1024) fail('Listening history envelope exceeds the supported size.');
  return freezeLegacyHistory(structuredClone(value)) as ListeningSessionRecord;
}
export function assertTrainingPrefix(previous: TrainingSnapshot, next: TrainingSnapshot): void {
  if (previous.sessionId !== next.sessionId || previous.roundId !== next.roundId || previous.material.id !== next.material.id || previous.material.version !== next.material.version || legacyHistoryIdentity(previous.material) !== legacyHistoryIdentity(next.material) || next.events.length < previous.events.length) fail('Training identity or immutable prefix changed.');
  for (let i = 0; i < previous.events.length; i++) if (legacyHistoryIdentity(previous.events[i]) !== legacyHistoryIdentity(next.events[i])) fail('Training event prefix changed.');
  for (const attempt of previous.attempts) if (legacyHistoryIdentity(attempt) !== legacyHistoryIdentity(next.attempts.find(a => a.attemptId === attempt.attemptId))) fail('Saved Training attempt changed.');
}
export function assertListeningSessionAppend(previous: ListeningSessionRecord, next: ListeningSessionRecord): void {
  const { revision: _a, ...oldScope } = previous.scope, { revision: _b, ...newScope } = next.scope;
  if (legacyHistoryIdentity(oldScope) !== legacyHistoryIdentity(newScope) || legacyHistoryIdentity(previous.preBRecord) !== legacyHistoryIdentity(next.preBRecord) || legacyHistoryIdentity(previous.conditions.identity) !== legacyHistoryIdentity(next.conditions.identity)) fail('Listening scope identity changed.');
  assertTrainingPrefix(previous.trainingSnapshot, next.trainingSnapshot);
  const a = previous.conditions, b = next.conditions;
  if (a.presentations.length > b.presentations.length || a.boundaries.length > b.boundaries.length) fail('Listening evidence cannot be truncated.');
  for (let i = 0; i < a.presentations.length; i++) if (legacyHistoryIdentity(a.presentations[i]) !== legacyHistoryIdentity(b.presentations[i])) fail('Listening presentation changed.');
  for (let i = 0; i < a.boundaries.length; i++) {
    const { disposition: before, ...oldBoundary } = a.boundaries[i], { disposition: after, ...newBoundary } = b.boundaries[i];
    if (legacyHistoryIdentity(oldBoundary) !== legacyHistoryIdentity(newBoundary) || (before !== after && before !== 'pending')) fail('Frozen listening submission changed.');
  }
  // A later batch cannot insert reference evidence before an already-frozen submit.
  const oldHead = Math.max(0, ...a.presentations.map(p => p.ordinal), ...a.boundaries.map(b => b.ordinal));
  for (const p of b.presentations.slice(a.presentations.length)) if (p.ordinal <= oldHead) fail('Listening ordinal cannot be backdated.');
  for (const p of b.boundaries.slice(a.boundaries.length)) if (p.ordinal <= oldHead) fail('Listening ordinal cannot be backdated.');
}

export const LISTENING_PARTIAL_SCOPE_PREFIX = 'listening-partial-scope-v1:';
export interface PartialListeningScope {
  readonly version: 'listening-partial-scope-v1'; readonly scopeId: string; readonly segmentId: string; readonly sessionId: string;
  readonly generation: number; readonly materialId: string; readonly materialVersion: string; readonly referenceVersion: string;
  readonly startedAt: string; readonly admittedFactCount: number; readonly coverage: 'unavailable';
}
export function readPartialListeningScope(value: unknown): PartialListeningScope {
  const row = object(value, ['version', 'scopeId', 'segmentId', 'sessionId', 'generation', 'materialId', 'materialVersion', 'referenceVersion', 'startedAt', 'admittedFactCount', 'coverage']);
  if (row.version !== 'listening-partial-scope-v1' || row.coverage !== 'unavailable') fail();
  for (const key of ['scopeId', 'segmentId', 'sessionId', 'materialId', 'materialVersion', 'referenceVersion', 'startedAt']) text(row[key]);
  integer(row.generation, 1); integer(row.admittedFactCount); if (!Number.isFinite(Date.parse(row.startedAt as string))) fail();
  return freezeLegacyHistory(structuredClone(row)) as unknown as PartialListeningScope;
}
