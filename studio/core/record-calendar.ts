import { listPracticeDays, practiceDayKey, validatePracticeTimeZone } from './practice-calendar';
import { legacyHistoryIdentity, type LegacyHistorySession } from './legacy-history';
import type { TrainingHistorySegment } from './training-history-segment';
import type { ListeningSessionRecord } from './listening-session';

/** Read-only, ephemeral occurrence index. This is not a Practice score/calendar. */
interface RecordCalendarBase {
  readonly key: string;
  readonly recordId: string;
  readonly sessionId: string;
  readonly materialId: string;
  readonly materialVersion: string;
  /** Exact source fingerprint, never the source text or an answer cache. */
  readonly identity: string;
  readonly days: readonly string[];
  readonly undatedEventCount: number;
}
export type RecordCalendarRecord = RecordCalendarBase & (
  | { readonly source: 'legacy-full'; readonly sequence: number; readonly updatedAt: string }
  | { readonly source: 'partial-segment'; readonly generation: number; readonly writerInstanceId: string; readonly factCount: number }
  | { readonly source: 'listening-session'; readonly sequence: number; readonly updatedAt: string; readonly scopeId: string; readonly revision: number }
);
export interface RecordCalendarDay {
  readonly day: string;
  /** Even a full stored session says nothing about all activity on that day. */
  readonly coverage: 'partial' | 'unknown';
  readonly records: readonly RecordCalendarRecord[];
}

/** Only explicit-zone ISO instants are admitted. Date.parse alone normalizes
 * impossible dates such as February 30, and accepts host-zone-dependent strings. */
export function parseRecordWallTime(value: unknown): number {
  if (typeof value !== 'string') throw new RangeError('A strict explicit-zone record timestamp is required.');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):?(\d{2}))$/.exec(value);
  if (!match) throw new RangeError('A strict explicit-zone record timestamp is required.');
  const [, ys, mos, ds, hs, mis, ss, fraction, zone, sign, ohs, oms] = match;
  const [year, month, day, hour, minute, second] = [ys, mos, ds, hs, mis, ss].map(Number);
  const ms = Number((fraction ?? '').padEnd(3, '0'));
  const offsetHours = zone === 'Z' ? 0 : Number(ohs), offsetMinutes = zone === 'Z' ? 0 : Number(oms);
  if (year < 1 || hour > 23 || minute > 59 || second > 59 || offsetHours > 23 || offsetMinutes > 59) throw new RangeError('Invalid record timestamp.');
  const civil = new Date(0);
  civil.setUTCFullYear(year, month - 1, day); civil.setUTCHours(hour, minute, second, ms);
  if (civil.getUTCFullYear() !== year || civil.getUTCMonth() + 1 !== month || civil.getUTCDate() !== day
    || civil.getUTCHours() !== hour || civil.getUTCMinutes() !== minute || civil.getUTCSeconds() !== second || civil.getUTCMilliseconds() !== ms) {
    throw new RangeError('Invalid Gregorian record timestamp.');
  }
  const offset = (offsetHours * 60 + offsetMinutes) * 60_000 * (sign === '-' ? -1 : 1);
  const instant = civil.getTime() - offset;
  if (!Number.isFinite(instant)) throw new RangeError('Invalid record timestamp.');
  return instant;
}

function occurrenceDays(wallTimes: Iterable<string>, timeZone: string): readonly string[] {
  const zone = validatePracticeTimeZone(timeZone), days = new Set<string>();
  for (const wallTime of wallTimes) days.add(practiceDayKey(parseRecordWallTime(wallTime), zone));
  return Object.freeze([...days].sort());
}
/** Metadata, attempts and accumulated active time never establish a calendar day. */
export function recordCalendarLegacyDates(session: LegacyHistorySession, timeZone: string): readonly string[] {
  return occurrenceDays(session.snapshot.events.map(event => event.wallTime), timeZone);
}
/** startedAt/endedAt and gaps between facts never establish an interval. */
export function recordCalendarSegmentDates(segment: TrainingHistorySegment, timeZone: string): readonly string[] {
  return occurrenceDays(segment.facts.map(fact => fact.wallTime), timeZone);
}


export interface RecordCalendarOccurrences { readonly days: readonly string[]; readonly undatedEventCount: number }
/** Yielded projection keeps only distinct date labels. Invalid wall times are
 * accounted for explicitly; no metadata or surrounding facts fill their dates. */
export async function recordCalendarOccurrences(
  wallTimes: Iterable<string>, timeZone: string, yieldControl: () => Promise<void>, batchSize = 64,
): Promise<RecordCalendarOccurrences> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new RangeError('A positive occurrence batch size is required.');
  const zone = validatePracticeTimeZone(timeZone), days = new Set<string>();
  let undatedEventCount = 0, count = 0;
  for (const wallTime of wallTimes) {
    try { days.add(practiceDayKey(parseRecordWallTime(wallTime), zone)); } catch { undatedEventCount++; }
    if (++count % batchSize === 0) await yieldControl();
  }
  return Object.freeze({ days: Object.freeze([...days].sort()), undatedEventCount });
}

/** No canonical text is retained after this call. Includes all original source
 * fields, so even an in-place text change at the same sequence is detectable. */
export async function recordCalendarSourceIdentity(value: LegacyHistorySession | TrainingHistorySegment | ListeningSessionRecord): Promise<string> {
  const bytes = new TextEncoder().encode(legacyHistoryIdentity(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function recordCalendarMonth(records: readonly RecordCalendarRecord[], month: string): readonly RecordCalendarDay[] {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000')) throw new RangeError('A valid YYYY-MM month is required.');
  const [year, monthNumber] = month.split('-').map(Number);
  const last = new Date(0); last.setUTCFullYear(year, monthNumber, 0); last.setUTCHours(0, 0, 0, 0);
  const days = listPracticeDays(`${month}-01`, `${month}-${String(last.getUTCDate()).padStart(2, '0')}`);
  const byDay = new Map<string, RecordCalendarRecord[]>();
  for (const record of records) for (const day of record.days) {
    if (day.startsWith(`${month}-`)) { const found = byDay.get(day) ?? []; found.push(record); byDay.set(day, found); }
  }
  return Object.freeze(days.map(day => {
    const found = Object.freeze(byDay.get(day) ?? []);
    return Object.freeze({ day, coverage: found.length ? 'partial' as const : 'unknown' as const, records: found });
  }));
}
