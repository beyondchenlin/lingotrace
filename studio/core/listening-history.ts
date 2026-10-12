import { listeningTotals, type ListeningSpan, type ListeningGap, type ListeningTotals } from './listening-flow.ts';
/** Standalone playback observations. Never a Training snapshot or assistance evidence. */
export const LISTENING_HISTORY_PREFIX = 'listening-history-v1:';
export interface ListeningHistorySpan {
  readonly ordinal: number; readonly kind: 'listening' | 'typing';
  readonly startMs: number; readonly endMs: number;
  readonly mediaStartMs: number | null; readonly mediaEndMs: number | null;
  readonly rate: number | null; readonly hidden: boolean;
}
export interface ListeningHistoryGap {
  readonly ordinal: number; readonly kind: 'gap'; readonly startMs: number | null; readonly endMs: number | null;
  readonly reason: 'unobserved' | 'suspended' | 'discontinuity';
}
export interface ListeningHistoryRecord {
  readonly schemaVersion: 'listening-history-v1'; readonly observationId: string; readonly writerInstanceId: string;
  readonly materialId: string; readonly materialVersion: string; readonly mediaId: string; readonly mediaSha256: string;
  readonly startedAt: string; readonly generation: number; readonly revision: number; readonly sealed: boolean;
  readonly facts: readonly (ListeningHistorySpan | ListeningHistoryGap)[];
}
declare const listeningPermitBrand: unique symbol;
export type ListeningHistoryPermit = Readonly<{ [listeningPermitBrand]: true }>;
export interface ListeningHistoryAdmission { readonly permit: ListeningHistoryPermit; readonly record: ListeningHistoryRecord }
export function listeningHistoryIdentity(record: ListeningHistoryRecord): string {
  const { revision: _revision, sealed: _sealed, facts: _facts, ...identity } = record;
  return JSON.stringify(identity);
}
function fail(): never { throw new Error('Invalid listening history record.'); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== keys.length) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) fail();
  }
  return value as Record<string, unknown>;
}
function num(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
/** Exact keys, finite coordinates, contiguous fact ordinals; clones before async work. */
export function readListeningHistory(value: unknown): ListeningHistoryRecord {
  const row = object(value, ['schemaVersion', 'observationId', 'writerInstanceId', 'materialId', 'materialVersion', 'mediaId', 'mediaSha256', 'startedAt', 'generation', 'revision', 'sealed', 'facts']);
  if (row.schemaVersion !== 'listening-history-v1') fail();
  for (const key of ['observationId', 'writerInstanceId', 'materialId', 'materialVersion', 'mediaId', 'mediaSha256']) if (typeof row[key] !== 'string' || !(row[key] as string).trim()) fail();
  if (!/^[a-f0-9]{64}$/.test(row.mediaSha256 as string)) fail();
  if (typeof row.startedAt !== 'string' || !Number.isFinite(Date.parse(row.startedAt))) fail();
  for (const key of ['generation', 'revision']) if (!num(row[key]) || !Number.isSafeInteger(row[key])) fail();
  if (typeof row.sealed !== 'boolean' || !Array.isArray(row.facts) || Reflect.ownKeys(row.facts).length !== row.facts.length + 1) fail();
  const facts = row.facts as unknown[];
  facts.forEach((fact, index) => {
    if (!fact || typeof fact !== 'object') fail();
    const kind = Object.getOwnPropertyDescriptor(fact, 'kind')?.value;
    const f = object(fact, kind === 'gap' ? ['ordinal', 'kind', 'startMs', 'endMs', 'reason'] : ['ordinal', 'kind', 'startMs', 'endMs', 'mediaStartMs', 'mediaEndMs', 'rate', 'hidden']);
    if (f.ordinal !== index + 1) fail();
    if (kind === 'gap') {
      if (!['unobserved', 'suspended', 'discontinuity'].includes(f.reason as string)) fail();
      if ((f.startMs !== null && !num(f.startMs)) || (f.endMs !== null && !num(f.endMs))) fail();
      if (typeof f.startMs === 'number' && typeof f.endMs === 'number' && f.endMs < f.startMs) fail();
    } else {
      if (!num(f.startMs) || !num(f.endMs) || f.endMs <= f.startMs || typeof f.hidden !== 'boolean') fail();
      if (kind === 'listening') {
        if (!num(f.mediaStartMs) || !num(f.mediaEndMs) || f.mediaEndMs <= f.mediaStartMs || !num(f.rate) || f.rate <= 0) fail();
      } else if (kind !== 'typing' || f.mediaStartMs !== null || f.mediaEndMs !== null || f.rate !== null || f.hidden) fail();
    }
  });
  // Explicit field order ensures immutable-prefix checks are independent of input key order.
  const result: ListeningHistoryRecord = {
    schemaVersion: 'listening-history-v1', observationId: row.observationId as string, writerInstanceId: row.writerInstanceId as string,
    materialId: row.materialId as string, materialVersion: row.materialVersion as string, mediaId: row.mediaId as string, mediaSha256: row.mediaSha256 as string,
    startedAt: row.startedAt as string, generation: row.generation as number, revision: row.revision as number, sealed: row.sealed as boolean,
    facts: facts.map(value => {
      const f = value as ListeningHistorySpan | ListeningHistoryGap;
      return Object.freeze(f.kind === 'gap' ? { ordinal: f.ordinal, kind: f.kind, startMs: f.startMs, endMs: f.endMs, reason: f.reason }
        : { ordinal: f.ordinal, kind: f.kind, startMs: f.startMs, endMs: f.endMs, mediaStartMs: f.mediaStartMs, mediaEndMs: f.mediaEndMs, rate: f.rate, hidden: f.hidden });
    }),
  };
  Object.freeze(result.facts); return Object.freeze(result);
}

export interface ListeningSnapshotCursor { readonly spans: number; readonly gaps: number }
/** Append only new observation tails. The caller starts a fresh observer after admission,
 * and discards both observer and cursor on OFF; this helper never grants persistence. */
export function appendListeningSnapshot(
  value: ListeningHistoryRecord,
  snapshot: ReturnType<import('./listening-flow.ts').ListeningObservation['snapshot']>,
  cursor: ListeningSnapshotCursor,
  sealed = false,
): { readonly record: ListeningHistoryRecord; readonly cursor: ListeningSnapshotCursor } {
  const record = readListeningHistory(value), identity = snapshot.identity;
  if (record.sealed || identity.runId !== record.observationId || identity.materialId !== record.materialId || identity.materialVersion !== record.materialVersion || identity.mediaId !== record.mediaId || identity.mediaSha256 !== record.mediaSha256) throw new Error('Listening snapshot identity does not match its admitted run.');
  if (![cursor.spans, cursor.gaps].every(n => Number.isSafeInteger(n) && n >= 0) || cursor.spans > snapshot.spans.length || cursor.gaps > snapshot.gaps.length) throw new Error('Listening snapshot cursor is invalid.');
  const facts: (ListeningHistorySpan | ListeningHistoryGap)[] = [...record.facts];
  for (const span of snapshot.spans.slice(cursor.spans)) {
    if (span.listening) {
      if (!span.media) throw new Error('Listening span has no media coordinates.');
      facts.push({ ordinal: facts.length + 1, kind: 'listening', startMs: span.wall[0], endMs: span.wall[1], mediaStartMs: span.media[0] * 1000, mediaEndMs: span.media[1] * 1000, rate: span.rate, hidden: span.hidden });
    }
    if (span.typing) facts.push({ ordinal: facts.length + 1, kind: 'typing', startMs: span.wall[0], endMs: span.wall[1], mediaStartMs: null, mediaEndMs: null, rate: null, hidden: false });
  }
  for (const gap of snapshot.gaps.slice(cursor.gaps)) facts.push({ ordinal: facts.length + 1, kind: 'gap', startMs: gap.wall?.[0] ?? null, endMs: gap.wall?.[1] ?? null, reason: gap.reason === 'observation-gap' ? 'unobserved' : 'discontinuity' });
  return Object.freeze({ record: readListeningHistory({ ...record, revision: record.revision + 1, sealed, facts }), cursor: Object.freeze({ spans: snapshot.spans.length, gaps: snapshot.gaps.length }) });
}

/** A single observation only: never sum independent page clocks into a global total. */
export function projectListeningHistory(value: ListeningHistoryRecord): ListeningTotals {
  const record = readListeningHistory(value), spans: ListeningSpan[] = [], gaps: ListeningGap[] = [];
  for (const fact of record.facts) {
    if (fact.kind === 'gap') gaps.push({ wall: fact.startMs === null || fact.endMs === null ? null : [fact.startMs, fact.endMs], reason: fact.reason === 'unobserved' ? 'observation-gap' : 'media-discontinuity' });
    else spans.push({ wall: [fact.startMs, fact.endMs], media: fact.kind === 'listening' ? [fact.mediaStartMs! / 1000, fact.mediaEndMs! / 1000] : null, rate: fact.rate ?? 1, listening: fact.kind === 'listening', typing: fact.kind === 'typing', hidden: fact.hidden });
  }
  return listeningTotals(spans, gaps);
}
export interface ListeningHistoryPersistenceStatus {
  readonly state: 'in-memory' | 'pending' | 'persisted' | 'error';
  readonly pendingWrites: number; readonly observationId: string | null; readonly revision: number | null; readonly error: string | null;
}
