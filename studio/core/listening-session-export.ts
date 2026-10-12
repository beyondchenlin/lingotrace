import type { Attempt } from './training.ts';
import { readListeningSession, type ListeningSessionRecord } from './listening-session.ts';
import type { Assistance, AssistanceCoverage } from './listening-flow.ts';
export const LISTENING_SESSION_EXPORT_VERSION = 'listening-session-export-v1' as const;
export interface ListeningAttemptProjection { readonly attempt: Attempt; readonly assistance: Assistance; readonly coverage: AssistanceCoverage; readonly boundaryRecorded: boolean }
/** Read one validated wrapper; old positive Training flags survive missing B evidence. */
export function projectListeningSessionHistory(value: ListeningSessionRecord) {
  const record = readListeningSession(value);
  const attempts: ListeningAttemptProjection[] = record.trainingSnapshot.attempts.map(attempt => {
    const boundary = record.conditions.boundaries.find(item => item.attemptId === attempt.attemptId);
    return Object.freeze({ attempt, assistance: attempt.conditions.hinted || attempt.conditions.revealed ? 'known-assisted' : boundary?.assistance ?? 'unknown', coverage: boundary?.coverage ?? 'unavailable', boundaryRecorded: !!boundary });
  });
  return Object.freeze({ record, attempts: Object.freeze(attempts), pending: Object.freeze(record.conditions.boundaries.filter(item => item.disposition === 'pending')), discarded: Object.freeze(record.conditions.boundaries.filter(item => item.disposition === 'discarded')) });
}
export function listeningSessionExport(value: ListeningSessionRecord, format: 'json' | 'csv'): { readonly name: string; readonly mime: string; readonly text: string } {
  const record = readListeningSession(value), envelope = { exportVersion: LISTENING_SESSION_EXPORT_VERSION, record };
  const safeId = record.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'session';
  if (format === 'json') return Object.freeze({ name: `lingotrace-listening-${safeId}.json`, mime: 'application/json;charset=utf-8', text: JSON.stringify(envelope, null, 2) });
  if (format !== 'csv') throw new Error('Unsupported listening session export format.');
  // The authoritative payload is a complete versioned envelope, never a stripped Training CSV.
  const cell = (value: string) => `"${(/^[=+\-@\t\r\n]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
  const row = ['exportVersion', 'recordType', 'sessionId', 'payloadJson'].map(cell).join(',') + '\r\n' + [LISTENING_SESSION_EXPORT_VERSION, 'complete-listening-envelope', record.sessionId, JSON.stringify(envelope)].map(cell).join(',') + '\r\n';
  return Object.freeze({ name: `lingotrace-listening-${safeId}.csv`, mime: 'text/csv;charset=utf-8', text: row });
}
export function readListeningSessionExport(value: unknown): ListeningSessionRecord {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== 2 || (value as { exportVersion?: unknown }).exportVersion !== LISTENING_SESSION_EXPORT_VERSION || !Object.hasOwn(value, 'record')) throw new Error('Unsupported listening session export envelope.');
  return readListeningSession((value as { record: unknown }).record);
}
