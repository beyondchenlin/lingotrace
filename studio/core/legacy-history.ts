import { SCHEMA_VERSION, validateTrainingProfile, type TrainingSnapshot } from './training.ts';
import { isInputObservationEvidence } from './input-observation.ts';
import { BUILTIN_TRAINING_SCHEMA, validateOptionalBuiltinSource } from './builtin-material.ts';
import { validateOptionalLocalReference } from './local-reference.ts';
import { validateOptionalReferenceExposure } from './reference-exposure.ts';

/** Compatibility reads only. This is not the Practice collection/privacy model. */
export const LEGACY_HISTORY_SOURCE = 'legacy-training-v1' as const;
export const LEGACY_HISTORY_LIMIT = 100;
export type LegacyHistoryErrorCode = 'invalid-record' | 'invalid-material' | 'unsupported-schema' | 'read-failed' | 'invalid-query' | 'stale-record' | 'invalid-sink';
export class LegacyHistoryError extends Error {
  readonly code: LegacyHistoryErrorCode;
  constructor(code: LegacyHistoryErrorCode, message: string) { super(message); this.code = code; this.name = 'LegacyHistoryError'; }
}
export interface LegacyHistorySummary {
  readonly source: typeof LEGACY_HISTORY_SOURCE;
  readonly sessionId: string; readonly sequence: number; readonly createdAt: string; readonly updatedAt: string;
  readonly schemaVersion: string; readonly materialId: string; readonly materialVersion: string; readonly materialTitle: string;
  readonly materialSource: 'embedded-snapshot'; readonly ruleVersions: readonly string[]; readonly paceRuleVersions: readonly string[];
  readonly earnedWords: number; readonly completedCount: number; readonly attemptCount: number; readonly activeMs: number;
}
export type LegacyHistoryEntry =
  | { readonly status: 'ready'; readonly summary: LegacyHistorySummary }
  | { readonly status: 'error'; readonly source: typeof LEGACY_HISTORY_SOURCE; readonly sessionId: string | null; readonly updatedAt: string | null; readonly error: { readonly code: LegacyHistoryErrorCode; readonly message: string } };
/** Ephemeral list boundary only: no answer, snapshot or export content. */
export interface LegacyHistoryCursor {
  readonly version: 1; readonly updatedAtMs: number | null; readonly key: IDBValidKey;
}
export interface LegacyHistoryList {
  readonly source: typeof LEGACY_HISTORY_SOURCE; readonly entries: readonly LegacyHistoryEntry[];
  readonly limit: number; readonly hasMore: boolean; readonly nextCursor: LegacyHistoryCursor | null;
}
export interface LegacyHistorySession {
  readonly source: typeof LEGACY_HISTORY_SOURCE; readonly summary: LegacyHistorySummary; readonly snapshot: TrainingSnapshot;
}

type RecordValue = Record<string, unknown>;
function fail(path: string, code: LegacyHistoryErrorCode = 'invalid-record'): never {
  // Paths use our field names, never potentially unsafe stored text.
  throw new LegacyHistoryError(code, `Saved history has an unsupported or invalid ${path}. The record was not changed.`);
}
function object(value: unknown, path: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(path);
  return value as RecordValue;
}
function text(value: unknown, path: string, nonempty = false): string {
  if (typeof value !== 'string' || (nonempty && !value.trim())) fail(path);
  return value;
}
function number(value: unknown, path: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) fail(path);
  return value;
}
function bool(value: unknown, path: string): void { if (typeof value !== 'boolean') fail(path); }
function date(value: unknown, path: string): string {
  const result = text(value, path, true); if (!Number.isFinite(Date.parse(result))) fail(path); return result;
}
function array(value: unknown, path: string): unknown[] { if (!Array.isArray(value)) fail(path); return value; }
function oneOf(value: unknown, choices: readonly unknown[], path: string): void { if (!choices.includes(value)) fail(path); }
function strings(value: unknown, path: string, unique = false): string[] {
  const result = array(value, path).map(v => text(v, path, true));
  if (unique && new Set(result).size !== result.length) fail(path); return result;
}
const sources = ['typed', 'paste', 'ime'];
const reasons = ['idle', 'paused', 'listening', 'composition', 'background', 'modal', 'checking', 'review'];
function conditions(value: unknown): void {
  const c = object(value, 'attempt conditions'); oneOf(c.exposure, ['first', 'retry'], 'exposure');
  for (const key of ['hinted', 'revealed', 'pasted']) bool(c[key], `conditions.${key}`);
  oneOf(c.inputSource, sources, 'input source');
}
/** Reject non-JSON values/cycles rather than losing fields during export or equality checks. */
function jsonShape(value: unknown, ancestors = new Set<object>(), depth = 0): void {
  if (depth > 64) fail('record nesting');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('numeric field'); return; }
  if (!value || typeof value !== 'object' || ancestors.has(value)) fail('record structure');
  if (!Array.isArray(value)) object(value, 'record structure');
  ancestors.add(value); for (const child of Object.values(value)) jsonShape(child, ancestors, depth + 1); ancestors.delete(value);
}
export function freezeLegacyHistory<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeLegacyHistory(child); Object.freeze(value);
  }
  return value;
}
/** Property ordering is not a fact. Arrays, strings and every stored value are. */
export function legacyHistoryIdentity(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(legacyHistoryIdentity).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${legacyHistoryIdentity((value as RecordValue)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Structural validation deliberately never calls replay, a reducer or alignment.
 * Stored scores and attempts remain historical facts, even if today's rules differ.
 * The material is self-contained; no current catalog lookup rewrites its version. */
export function readLegacyHistoryRecord(value: unknown, expectedSessionId?: string): LegacyHistorySession {
  const record = object(value, 'record'), s = object(record.snapshot, 'snapshot');
  if (s.schemaVersion !== SCHEMA_VERSION && s.schemaVersion !== BUILTIN_TRAINING_SCHEMA) fail('snapshot schema version', 'unsupported-schema');
  jsonShape(record);
  const sessionId = text(record.sessionId, 'session ID', true), sequence = number(record.sequence, 'sequence', true);
  if (s.sessionId !== sessionId || (expectedSessionId !== undefined && sessionId !== expectedSessionId) || s.sequence !== sequence || sequence < 1) fail('record identity');
  const roundId = text(s.roundId, 'round ID', true), createdAt = date(s.createdAt, 'creation time'), updatedAt = date(record.updatedAt, 'saved time');
  let material: RecordValue, cues: unknown[];
  try {
    material = object(s.material, 'material');
    text(material.id, 'material ID', true); text(material.version, 'material version', true);
    text(material.title, 'material title'); text(material.rights, 'material rights');
    cues = array(material.cues, 'material cues'); if (!cues.length) fail('material cues');
    for (const entry of cues) { const cue = object(entry, 'material cue'); text(cue.id, 'cue ID', true); text(cue.text, 'cue text'); if (number(cue.end, 'cue end') < number(cue.start, 'cue start')) fail('cue interval'); }
    validateOptionalLocalReference(material);
    validateOptionalBuiltinSource(material);
  } catch { fail('embedded material or material version', 'invalid-material'); }
  try { validateTrainingProfile(s as unknown as TrainingSnapshot); } catch { fail('material/schema profile', 'unsupported-schema'); }
  const cueIds = new Set(cues.map(c => (c as RecordValue).id)); if (cueIds.size !== cues.length) fail('duplicate cue ID', 'invalid-material');
  const cueId = (id: unknown) => { if (!cueIds.has(id)) fail('material cue reference', 'invalid-material'); };
  if (number(s.cueIndex, 'cue index', true) >= cues.length) fail('cue index', 'invalid-material');
  const earnedWords = number(s.earnedWords, 'earned words', true), activeMs = number(s.activeMs, 'active time'); number(s.pace, 'pace');
  strings(s.confirmedPositions, 'confirmed positions', true);
  const completed = strings(s.completedCueIds, 'completed cue IDs', true); completed.forEach(cueId);
  strings(s.frozenReasons, 'frozen reasons', true).forEach(r => oneOf(r, reasons, 'freeze reason'));
  strings(s.discardedJudgmentIds, 'discarded judgment IDs', true);
  for (const [id, value] of Object.entries(object(s.drafts, 'drafts'))) {
    cueId(id); const draft = object(value, 'draft'); text(draft.text, 'draft text'); number(draft.version, 'draft version', true);
    oneOf(draft.source, sources, 'draft source'); for (const key of ['hinted', 'revealed', 'pasted']) bool(draft[key], `draft.${key}`);
  }
  for (const [id, value] of Object.entries(object(s.pendingAttempts, 'pending attempts'))) {
    const a = object(value, 'pending attempt'); if (a.attemptId !== id) fail('pending attempt identity'); cueId(a.cueId);
    text(a.answer, 'pending answer'); number(a.inputVersion, 'pending input version', true); conditions(a.conditions);
  }
  const attempts = array(s.attempts, 'attempts'), attemptIds = new Set<string>(), ruleVersions = new Set<string>(), paceRuleVersions = new Set<string>();
  for (const value of attempts) {
    const a = object(value, 'attempt'), id = text(a.attemptId, 'attempt ID', true);
    if (attemptIds.has(id) || a.sessionId !== sessionId || a.roundId !== roundId) fail('attempt identity'); attemptIds.add(id); cueId(a.cueId);
    if (a.materialId !== material.id || a.materialVersion !== material.version) fail('attempt material version', 'invalid-material');
    ruleVersions.add(text(a.ruleVersion, 'attempt rule version', true));
    text(a.reference, 'attempt reference'); text(a.answer, 'attempt answer'); number(a.inputVersion, 'attempt input version', true);
    conditions(a.conditions); number(a.words, 'attempt words', true); number(a.errors, 'attempt errors', true);
    if (number(a.accuracy, 'attempt accuracy') > 100) fail('attempt accuracy'); number(a.gain, 'attempt gain', true);
    bool(a.firstCompletion, 'first completion'); number(a.activeMs, 'attempt active time'); date(a.wallTime, 'attempt time');
    if (a.dataset !== 'local_interactive') fail('attempt dataset');
    for (const value of array(a.alignment, 'attempt alignment')) {
      const token = object(value, 'alignment token'); oneOf(token.kind, ['match', 'replace', 'missing', 'extra'], 'alignment kind');
      if (token.position !== null) number(token.position, 'alignment position', true);
      text(token.expected, 'alignment expected text'); text(token.actual, 'alignment actual text');
    }
  }
  const events = array(s.events, 'events'), eventIds = new Set<string>(); if (events.length !== sequence) fail('event count');
  events.forEach((value, index) => {
    const e = object(value, 'event'), id = text(e.eventId, 'event ID', true);
    if (eventIds.has(id) || e.sessionId !== sessionId || e.sequence !== index + 1) fail('event identity'); eventIds.add(id);
    if (e.schemaVersion !== s.schemaVersion) fail('event schema version', 'unsupported-schema');
    if (e.materialId !== material.id || e.materialVersion !== material.version) fail('event material version', 'invalid-material');
    ruleVersions.add(text(e.ruleVersion, 'event rule version', true)); paceRuleVersions.add(text(e.paceRuleVersion, 'pace rule version', true));
    date(e.wallTime, 'event time'); number(e.activeMs, 'event active time'); number(e.inputVersion, 'event input version', true); cueId(e.cueId);
    if (e.inputObservation !== undefined && !isInputObservationEvidence(e.inputObservation)) fail('input observation');
    try { validateOptionalReferenceExposure(e); } catch { fail('reference exposure', 'unsupported-schema'); }
    if (index === 0 && (e.type !== 'sessionStarted' || e.wallTime !== createdAt)) fail('session start');
    switch (e.type) {
      case 'sessionStarted': if (index !== 0 || legacyHistoryIdentity(e.material) !== legacyHistoryIdentity(material)) fail('session material', 'invalid-material'); break;
      case 'timeAdvanced': number(e.deltaMs, 'elapsed time'); break;
      case 'inputObservationSampled': if (e.inputObservation === undefined) fail('input observation'); break;
      case 'inputCommitted': {
        text(e.text, 'input text'); oneOf(e.source, sources, 'input source');
        if (e.nativeEdit !== undefined) {
          const n = object(e.nativeEdit, 'native edit'); if (n.version !== 'dom-edit-v1') fail('native edit version', 'unsupported-schema');
          oneOf(n.kind, ['input', 'compositionend'], 'native edit kind'); if (n.inputType !== null) text(n.inputType, 'native input type'); if (n.data !== null) text(n.data, 'native input data');
        }
        break;
      }
      case 'compositionStarted': case 'compositionEnded': break;
      case 'freezeChanged': oneOf(e.reason, reasons, 'freeze reason'); bool(e.on, 'freeze state'); break;
      case 'cueChanged': if (number(e.index, 'event cue index', true) >= cues.length) fail('event cue index', 'invalid-material'); break;
      case 'hintExposed': oneOf(e.kind, ['hint', 'reveal'], 'hint kind'); break;
      case 'submitRequested': text(e.attemptId, 'requested attempt ID', true); text(e.answer, 'submitted answer'); number(e.draftVersion, 'submitted draft version', true); break;
      case 'judgmentApplied': text(e.attemptId, 'judged attempt ID', true); break;
      default: fail('event type', 'unsupported-schema');
    }
  });
  const summary: LegacyHistorySummary = { source: LEGACY_HISTORY_SOURCE, sessionId, sequence, createdAt, updatedAt,
    schemaVersion: s.schemaVersion, materialId: material.id as string, materialVersion: material.version as string, materialTitle: material.title as string,
    materialSource: 'embedded-snapshot', ruleVersions: [...ruleVersions].sort(), paceRuleVersions: [...paceRuleVersions].sort(),
    earnedWords, completedCount: completed.length, attemptCount: attempts.length, activeMs };
  return freezeLegacyHistory({ source: LEGACY_HISTORY_SOURCE, summary, snapshot: structuredClone(s) as unknown as TrainingSnapshot });
}

export function legacyHistoryEntry(value: unknown, key: IDBValidKey): LegacyHistoryEntry {
  try {
    if (typeof key !== 'string') fail('session key');
    return freezeLegacyHistory({ status: 'ready', summary: readLegacyHistoryRecord(value, key).summary });
  } catch (error) {
    const record = value && typeof value === 'object' ? value as RecordValue : null;
    const updatedAt = typeof record?.updatedAt === 'string' && Number.isFinite(Date.parse(record.updatedAt)) ? record.updatedAt : null;
    const failure = error instanceof LegacyHistoryError ? error : new LegacyHistoryError('invalid-record', 'Saved history could not be read. The record was not changed.');
    return freezeLegacyHistory({ status: 'error', source: LEGACY_HISTORY_SOURCE, sessionId: typeof key === 'string' ? key : null, updatedAt, error: { code: failure.code, message: failure.message } });
  }
}
