import { CAFE_MATERIAL, RULE_VERSION, SCHEMA_VERSION, type TrainingSnapshot } from './training';
import { projectRoundReview } from './round-review';

/** Explicit, user-created reference saves. Never a training attempt or a grade. */
export const CONTEXT_BOOKMARK_SCHEMA_VERSION = 'context-bookmark-v1' as const;
export const CONTEXT_BOOKMARK_MEDIA_ID = 'cafe-original-video-v1' as const;
export const CONTEXT_BOOKMARK_MEDIA_SHA256 = '22fc25ade368f351cda21951916e559ff359cf1ac8419fbfa5444e050cdbf740' as const;
export const CONTEXT_BOOKMARK_MEDIA_PATH = '/studio-assets/06-cafe.mp4' as const;

export interface ContextBookmarkReference {
  readonly materialId: string;
  readonly materialVersion: string;
  readonly cueId: string;
  readonly text: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly mediaId: string;
  readonly mediaSha256: string;
}
export interface ContextBookmarkSelection {
  /** Exact UTF-16 offsets in the original reference, never normalized answer text. */
  readonly start: number;
  readonly end: number;
  readonly text: string;
}
export interface ContextBookmark {
  readonly schemaVersion: typeof CONTEXT_BOOKMARK_SCHEMA_VERSION;
  readonly key: string;
  /** Independent creation identity; a remove/readd cannot reuse this incarnation. */
  readonly saveId: string;
  readonly reference: ContextBookmarkReference;
  readonly selection: ContextBookmarkSelection;
  readonly createdAt: string;
}
export type ContextBookmarkErrorCode = 'invalid-record' | 'stale-reference' | 'invalid-selection' | 'storage-conflict' | 'storage-unavailable' | 'closed';
export class ContextBookmarkError extends Error {
  constructor(readonly code: ContextBookmarkErrorCode, message: string) { super(message); this.name = 'ContextBookmarkError'; }
}
const referenceKeys = ['materialId', 'materialVersion', 'cueId', 'text', 'startSeconds', 'endSeconds', 'mediaId', 'mediaSha256'] as const;
const bookmarkKeys = ['schemaVersion', 'key', 'saveId', 'reference', 'selection', 'createdAt'] as const;
const selectionKeys = ['start', 'end', 'text'] as const;

/** Only own data properties; malformed persisted records never execute getters. */
function dataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return null;
    const names = Reflect.ownKeys(value);
    if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))) return null;
    const copy: Record<string, unknown> = {};
    for (const key of keys) {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property || !Object.hasOwn(property, 'value')) return null;
      copy[key] = property.value;
    }
    return copy;
  } catch { return null; }
}
function canonicalReference(cueId: unknown): ContextBookmarkReference | null {
  const cue = CAFE_MATERIAL.cues.find(value => value.id === cueId);
  return cue ? Object.freeze({ materialId: CAFE_MATERIAL.id, materialVersion: CAFE_MATERIAL.version, cueId: cue.id,
    text: cue.text, startSeconds: cue.start, endSeconds: cue.end,
    mediaId: CONTEXT_BOOKMARK_MEDIA_ID, mediaSha256: CONTEXT_BOOKMARK_MEDIA_SHA256 }) : null;
}
/** Validates the declared binding only. The playback/save caller must separately
 * verify the actual original media bytes; matching IDs do not prove a Blob. */
export function isCurrentBookmarkReference(value: unknown): value is ContextBookmarkReference {
  const record = dataRecord(value, referenceKeys), expected = canonicalReference(record?.cueId);
  return !!record && !!expected && referenceKeys.every(key => record[key] === expected[key]);
}
export function validateContextBookmarkReference(value: unknown): ContextBookmarkReference {
  if (!isCurrentBookmarkReference(value)) throw new ContextBookmarkError('stale-reference', '原句、素材版本或媒体关联无法核验，不能保存或重听。');
  return canonicalReference(value.cueId)!;
}

/** Current-round eligibility only. No migration or media recovery for old history.
 * The caller must supply the live current snapshot and an explicitly selected row. */
export function getBookmarkReference(snapshot: TrainingSnapshot, cueId: string): ContextBookmarkReference | null {
  try {
    if (snapshot.schemaVersion !== SCHEMA_VERSION || !snapshot.sessionId || !snapshot.roundId
      || snapshot.material.id !== CAFE_MATERIAL.id || snapshot.material.version !== CAFE_MATERIAL.version) return null;
    const expected = canonicalReference(cueId), cues = snapshot.material.cues.filter(cue => cue.id === cueId);
    if (!expected || cues.length !== 1 || cues[0].text !== expected.text || cues[0].start !== expected.startSeconds || cues[0].end !== expected.endSeconds) return null;
    const row = projectRoundReview(snapshot).rows.find(value => value.cueId === cueId);
    if (!row || (row.status !== 'matched' && row.status !== 'needs-correction') || !row.first || !row.latest || row.submissions < 1) return null;
    // Do not let malformed IDs or a different rule masquerade as a submitted row.
    if (snapshot.attempts.some(attempt => attempt.cueId === cueId && (!attempt.attemptId || attempt.ruleVersion !== RULE_VERSION))) return null;
    return expected;
  } catch { return null; }
}

/** Original word spans for explicit contiguous selection; punctuation between
 * selected words is retained verbatim. This does not tokenize or score answers. */
export function contextBookmarkWords(reference: ContextBookmarkReference): readonly ContextBookmarkSelection[] {
  const current = validateContextBookmarkReference(reference);
  return Object.freeze(Array.from(current.text.matchAll(/[a-zA-Z0-9]+(?:['’][a-zA-Z0-9]+)*/g), match =>
    Object.freeze({ start: match.index!, end: match.index! + match[0].length, text: match[0] })));
}
export function contextBookmarkSelection(reference: ContextBookmarkReference, start: number, end: number): ContextBookmarkSelection {
  const current = validateContextBookmarkReference(reference), words = contextBookmarkWords(current);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > current.text.length
    || !words.some(word => word.start === start) || !words.some(word => word.end === end)) {
    throw new ContextBookmarkError('invalid-selection', '请选择原句中连续的完整单词或短语。');
  }
  return Object.freeze({ start, end, text: current.text.slice(start, end) });
}
export function contextBookmarkKey(reference: ContextBookmarkReference, start: number, end: number): string {
  const current = validateContextBookmarkReference(reference);
  contextBookmarkSelection(current, start, end);
  return JSON.stringify([CONTEXT_BOOKMARK_SCHEMA_VERSION, current.materialId, current.materialVersion,
    current.mediaId, current.mediaSha256, current.cueId, start, end]);
}
export function createContextBookmark(reference: ContextBookmarkReference, start: number, end: number, createdAt: string, saveId: string): ContextBookmark {
  const current = validateContextBookmarkReference(reference), selection = contextBookmarkSelection(current, start, end);
  return validateContextBookmark({ schemaVersion: CONTEXT_BOOKMARK_SCHEMA_VERSION,
    key: contextBookmarkKey(current, start, end), saveId, reference: current, selection, createdAt });
}
/** Unknown, stale, extra-data or corrupt records remain unavailable, not repaired.
 * Copies and freezes the narrow reference-only model, so callers cannot mutate it. */
export function validateContextBookmark(value: unknown): ContextBookmark {
  const record = dataRecord(value, bookmarkKeys), selection = dataRecord(record?.selection, selectionKeys);
  if (!record || record.schemaVersion !== CONTEXT_BOOKMARK_SCHEMA_VERSION || !selection || typeof record.key !== 'string'
    || typeof record.saveId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(record.saveId)
    || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))
    || new Date(record.createdAt).toISOString() !== record.createdAt) {
    throw new ContextBookmarkError('invalid-record', '此收藏的数据结构或保存时间无法读取。');
  }
  const reference = validateContextBookmarkReference(record.reference);
  const selected = contextBookmarkSelection(reference, selection.start as number, selection.end as number);
  if (selected.text !== selection.text || record.key !== contextBookmarkKey(reference, selected.start, selected.end)) {
    throw new ContextBookmarkError('invalid-record', '此收藏的原文选区或标识不一致，未补填。');
  }
  return Object.freeze({ schemaVersion: CONTEXT_BOOKMARK_SCHEMA_VERSION, key: record.key, saveId: record.saveId, reference, selection: selected, createdAt: record.createdAt });
}
