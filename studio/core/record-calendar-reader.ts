import { LEGACY_HISTORY_SOURCE, legacyHistoryIdentity, readLegacyHistoryRecord, type LegacyHistoryCursor, type LegacyHistoryList, type LegacyHistorySession, type LegacyHistorySummary } from './legacy-history';
import { readTrainingHistorySegment, type TrainingHistorySegmentCursor, type TrainingHistorySegmentList, type TrainingHistorySegmentSummary } from './repository';
import type { TrainingHistorySegment } from './training-history-segment';
import { readListeningSession, type ListeningSessionRecord } from './listening-session';
import { validatePracticeTimeZone } from './practice-calendar';
import { RecordCalendarMetrics, emptyRecordCalendarMetrics, projectRecordCalendarMetricFacts, type RecordCalendarMetricSnapshot, type RecordCalendarMetricFact } from './record-calendar-metrics';
import { recordCalendarOccurrences, recordCalendarSourceIdentity, type RecordCalendarRecord } from './record-calendar';

export interface RecordCalendarAccess {
  listHistory(options?: { limit?: number; after?: LegacyHistoryCursor | null }): Promise<LegacyHistoryList>;
  loadHistorySession(id: string): Promise<LegacyHistorySession | null>;
  listTrainingHistorySegments(options?: { limit?: number; after?: TrainingHistorySegmentCursor | null }): Promise<TrainingHistorySegmentList>;
  loadTrainingHistorySegment(id: string): Promise<TrainingHistorySegment | null>;
  /** Optional for older read adapters only; absent capability is an explicit issue. */
  listListeningSessions?(): Promise<readonly ListeningSessionRecord[]>;
  loadListeningSession?(id: string): Promise<ListeningSessionRecord | null>;
  /** Optional batch verification: one fresh, detached, atomically validated
   * family snapshot. Older adapters retain their individual reread contract. */
  readListeningSessionSnapshot?(): Promise<readonly ListeningSessionRecord[]>;
}
export type RecordCalendarSelection =
  | { readonly source: 'legacy-full'; readonly record: RecordCalendarRecord; readonly session: LegacyHistorySession }
  | { readonly source: 'partial-segment'; readonly record: RecordCalendarRecord; readonly segment: TrainingHistorySegment }
  | { readonly source: 'listening-session'; readonly record: RecordCalendarRecord; readonly listeningSession: ListeningSessionRecord };
export interface RecordCalendarView {
  readonly timeZone: string | null;
  readonly status: 'idle' | 'loading' | 'loaded' | 'partial' | 'failed' | 'cancelled';
  readonly records: readonly RecordCalendarRecord[];
  readonly metrics: RecordCalendarMetricSnapshot;
  readonly selected: RecordCalendarSelection | null;
  readonly selecting: boolean;
  readonly scannedRecords: number;
  /** Read failures are issues, not a claim about how many missing records exist. */
  readonly unreadableCount: number;
  readonly undatedEventCount: number;
  readonly undatedRecordCount: number;
  readonly error: string | null;
}
interface ReaderOptions {
  readonly yieldEvery?: number;
  readonly yieldControl?: () => Promise<void>;
}
const emptyView = (): RecordCalendarView => Object.freeze({ timeZone: null, status: 'idle', records: Object.freeze([]), metrics: emptyRecordCalendarMetrics(), selected: null, selecting: false, scannedRecords: 0, unreadableCount: 0, undatedEventCount: 0, undatedRecordCount: 0, error: null });
const aborted = (): Error => Object.assign(new Error('Record calendar read cancelled.'), { name: 'AbortError' });
function check(signal: AbortSignal): void { if (signal.aborted) throw aborted(); }
/** Repository operations have no abort parameter. Stop awaiting immediately, and
 * consume late success/failure without publishing it or starting another read. */
function interruptible<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(aborted()); };
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(value => { signal.removeEventListener('abort', cancel); if (signal.aborted) reject(aborted()); else resolve(value); }, error => { signal.removeEventListener('abort', cancel); reject(error); });
    if (signal.aborted) cancel();
  });
}
function readLegacy(value: LegacyHistorySession | null, id: string): LegacyHistorySession {
  if (!value || value.source !== LEGACY_HISTORY_SOURCE || value.summary.sessionId !== id || value.snapshot.sessionId !== id) throw new Error('Missing or mismatched source record.');
  const verified = readLegacyHistoryRecord({ sessionId: id, sequence: value.summary.sequence, updatedAt: value.summary.updatedAt, snapshot: value.snapshot }, id);
  if (legacyHistoryIdentity(value.summary) !== legacyHistoryIdentity(verified.summary)) throw new Error('Mismatched source summary.');
  return verified;
}
function assertLegacySummary(actual: LegacyHistorySummary, expected: LegacyHistorySummary): void {
  if (legacyHistoryIdentity(actual) !== legacyHistoryIdentity(expected)) throw new Error('Source changed after listing.');
}
function assertSegmentSummary(segment: TrainingHistorySegment, expected: TrainingHistorySegmentSummary): void {
  if (segment.segmentId !== expected.segmentId || segment.sessionId !== expected.sessionId || segment.generation !== expected.generation
    || segment.startedAt !== expected.startedAt || segment.endedAt !== expected.endedAt || segment.facts.length !== expected.factCount
    || expected.coverage !== 'partial' || expected.replayable !== false) throw new Error('Source changed after listing.');
}
function keyIdentity(key: IDBValidKey): string {
  if (typeof key === 'string') return `s:${JSON.stringify(key)}`;
  if (typeof key === 'number' && Number.isFinite(key)) return `n:${key}`;
  if (key instanceof Date && Number.isFinite(key.getTime())) return `d:${key.getTime()}`;
  if (Array.isArray(key)) return `a:[${key.map(keyIdentity).join(',')}]`;
  if (key instanceof ArrayBuffer || ArrayBuffer.isView(key)) {
    const bytes = key instanceof ArrayBuffer ? new Uint8Array(key) : new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
    return `b:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  throw new Error('Invalid source cursor.');
}
function legacyCursorKey(cursor: LegacyHistoryCursor): string {
  if (cursor.version !== 1 || (cursor.updatedAtMs !== null && !Number.isSafeInteger(cursor.updatedAtMs))) throw new Error('Invalid source cursor.');
  return `${cursor.updatedAtMs}:${keyIdentity(cursor.key)}`;
}
function segmentCursorKey(cursor: TrainingHistorySegmentCursor): string {
  if (cursor.version !== 1 || !Number.isSafeInteger(cursor.startedAtMs) || typeof cursor.segmentId !== 'string' || !cursor.segmentId.trim()) throw new Error('Invalid source cursor.');
  return `${cursor.startedAtMs}:${JSON.stringify(cursor.segmentId)}`;
}
function assertPage(page: { entries: readonly unknown[]; limit: number; hasMore: boolean; nextCursor: unknown }): void {
  if (!Array.isArray(page.entries) || page.limit !== 100 || page.entries.length > 100 || typeof page.hasMore !== 'boolean'
    || (page.hasMore ? !page.nextCursor || !page.entries.length : page.nextCursor !== null)) throw new Error('Incomplete source page.');
}

/** Independent scan/selection fences let month navigation close a detail while
 * all source pages continue scanning. No writer, live engine or storage setting. */
export class RecordCalendarReader {
  private active = true;
  private scanEpoch = 0;
  private selectionEpoch = 0;
  private scanAbort: AbortController | null = null;
  private selectionAbort: AbortController | null = null;
  private state: RecordCalendarView = emptyView();
  private listeners = new Set<() => void>();
  private readonly yieldEvery: number;
  private readonly yieldControl: () => Promise<void>;
  private scanError: string | null = null;
  private selectionError: string | null = null;
  constructor(private readonly repository: RecordCalendarAccess, options: ReaderOptions = {}) {
    this.yieldEvery = options.yieldEvery ?? 8;
    if (!Number.isSafeInteger(this.yieldEvery) || this.yieldEvery < 1) throw new RangeError('A positive calendar yield batch size is required.');
    this.yieldControl = options.yieldControl ?? (() => new Promise(resolve => setTimeout(resolve, 0)));
  }
  getSnapshot = (): RecordCalendarView => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<RecordCalendarView>): void {
    this.state = Object.freeze({ ...this.state, ...patch, error: this.selectionError ?? this.scanError });
    for (const listener of this.listeners) listener();
  }
  private currentScan(token: number): boolean { return this.active && token === this.scanEpoch; }
  private currentSelection(token: number): boolean { return this.active && token === this.selectionEpoch; }
  activate(): void {
    this.scanAbort?.abort(); this.selectionAbort?.abort(); ++this.scanEpoch; ++this.selectionEpoch; this.active = true;
    this.scanError = null; this.selectionError = null; this.state = emptyView(); this.update({});
  }
  async refresh(timeZone: string, externalSignal?: AbortSignal): Promise<void> {
    if (!this.active) return;
    this.scanAbort?.abort(); this.selectionAbort?.abort(); ++this.selectionEpoch;
    const token = ++this.scanEpoch, controller = new AbortController(), signal = controller.signal;
    this.scanAbort = controller; this.scanError = null; this.selectionError = null;
    let zone: string;
    try { zone = validatePracticeTimeZone(timeZone); }
    catch { this.scanError = '时区无效，日期索引未读取。请选择有效的 IANA 时区。'; this.update({ ...emptyView(), status: 'failed' }); return; }
    const onExternalAbort = () => { if (this.currentScan(token)) this.cancel(); };
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    this.update({ timeZone: zone, status: 'loading', records: Object.freeze([]), metrics: emptyRecordCalendarMetrics(), selected: null, selecting: false, scannedRecords: 0, unreadableCount: 0, undatedEventCount: 0, undatedRecordCount: 0 });
    if (externalSignal?.aborted) onExternalAbort();
    const records: RecordCalendarRecord[] = [];
    const metrics = new RecordCalendarMetrics(zone);
    let issues = 0, processed = 0, undatedEventCount = 0, undatedRecordCount = 0;
    const counts = () => ({ scannedRecords: records.length, unreadableCount: issues, undatedEventCount, undatedRecordCount });
    const publish = () => { if (this.currentScan(token)) this.update({ records: Object.freeze([...records]), metrics: metrics.getSnapshot(), ...counts() }); };
    const pause = async () => { check(signal); publish(); check(signal); await interruptible(this.yieldControl(), signal); check(signal); };
    const accept = async (record: RecordCalendarRecord) => { records.push(Object.freeze(record)); undatedEventCount += record.undatedEventCount; if (!record.days.length) undatedRecordCount++; if (++processed % this.yieldEvery === 0) await pause(); };
    const issue = () => { issues++; };
    try {
      check(signal);
      // updatedAt and startedAt are sort positions only, never month filters.
      try {
        let after: LegacyHistoryCursor | null = null;
        const cursors = new Set<string>(), ids = new Set<string>();
        for (;;) {
          check(signal);
          const page: LegacyHistoryList = await interruptible(this.repository.listHistory({ limit: 100, after: structuredClone(after) }), signal);
          check(signal); assertPage(page);
          if (page.source !== LEGACY_HISTORY_SOURCE) throw new Error('Mismatched source list.');
          for (const entry of page.entries) {
            check(signal);
            if (entry.status !== 'ready') { issue(); continue; }
            const id = entry.summary.sessionId;
            if (ids.has(id)) throw new Error('Repeated or changing source page.');
            ids.add(id);
            try {
              const session = readLegacy(await interruptible(this.repository.loadHistorySession(id), signal), id);
              assertLegacySummary(session.summary, entry.summary);
              const dates = await recordCalendarOccurrences((function* () { for (const event of session.snapshot.events) yield event.wallTime; })(), zone, pause); check(signal);
              const identity = await interruptible(recordCalendarSourceIdentity(session), signal); check(signal);
              const metricFacts = await projectRecordCalendarMetricFacts(session, `legacy-full:${id}`, zone, pause); check(signal); metrics.add(metricFacts);
              await accept({ source: 'legacy-full', key: `legacy-full:${id}`, recordId: id, sessionId: id, sequence: session.summary.sequence,
                updatedAt: session.summary.updatedAt, materialId: session.summary.materialId, materialVersion: session.summary.materialVersion, identity, ...dates });
            } catch (error) { check(signal); issue(); }
          }
          await pause();
          if (!page.hasMore) break;
          const next: LegacyHistoryCursor = page.nextCursor!;
          const cursorKey = legacyCursorKey(next);
          if (cursors.has(cursorKey)) throw new Error('Repeated source cursor.');
          if (after && ((after.updatedAtMs === null ? next.updatedAtMs !== null : next.updatedAtMs !== null && next.updatedAtMs > after.updatedAtMs) || next.updatedAtMs === after.updatedAtMs && typeof next.key === 'string' && typeof after.key === 'string' && next.key <= after.key)) throw new Error('Source cursor moved backwards.');
          const last = page.entries.at(-1)!;
          if (last.status === 'ready' && (next.key !== last.summary.sessionId || next.updatedAtMs !== Date.parse(last.summary.updatedAt))) throw new Error('Source cursor does not match page.');
          cursors.add(cursorKey); after = structuredClone(next);
        }
      } catch (error) { check(signal); issue(); }
      try {
        let after: TrainingHistorySegmentCursor | null = null;
        const cursors = new Set<string>(), ids = new Set<string>();
        for (;;) {
          check(signal);
          const page: TrainingHistorySegmentList = await interruptible(this.repository.listTrainingHistorySegments({ limit: 100, after: structuredClone(after) }), signal);
          check(signal); assertPage(page);
          for (const summary of page.entries) {
            check(signal);
            const id = summary.segmentId;
            if (ids.has(id)) throw new Error('Repeated or changing source page.');
            ids.add(id);
            try {
              const loaded = await interruptible(this.repository.loadTrainingHistorySegment(id), signal);
              if (!loaded) throw new Error('Missing source segment.');
              const segment = readTrainingHistorySegment(loaded); assertSegmentSummary(segment, summary);
              const dates = await recordCalendarOccurrences((function* () { for (const fact of segment.facts) yield fact.wallTime; })(), zone, pause); check(signal);
              const identity = await interruptible(recordCalendarSourceIdentity(segment), signal); check(signal);
              const metricFacts = await projectRecordCalendarMetricFacts(segment, `partial-segment:${id}`, zone, pause); check(signal); metrics.add(metricFacts);
              await accept({ source: 'partial-segment', key: `partial-segment:${id}`, recordId: id, sessionId: segment.sessionId,
                generation: segment.generation, writerInstanceId: segment.writerInstanceId, factCount: segment.facts.length,
                materialId: segment.material.id, materialVersion: segment.material.version, identity, ...dates });
            } catch (error) { check(signal); issue(); }
          }
          await pause();
          if (!page.hasMore) break;
          const next: TrainingHistorySegmentCursor = page.nextCursor!;
          const cursorKey = segmentCursorKey(next), last = page.entries.at(-1)!;
          if (cursors.has(cursorKey) || next.segmentId !== last.segmentId || next.startedAtMs !== Date.parse(last.startedAt)) throw new Error('Repeated or mismatched source cursor.');
          if (after && (next.startedAtMs > after.startedAtMs || next.startedAtMs === after.startedAtMs && next.segmentId <= after.segmentId)) throw new Error('Source cursor moved backwards.');
          cursors.add(cursorKey); after = structuredClone(next);
        }
      } catch (error) { check(signal); issue(); }
      try {
        check(signal);
        if (!this.repository.listListeningSessions || !this.repository.loadListeningSession) throw new Error('Listening source read capability is unavailable.');
        const listed = await interruptible(this.repository.listListeningSessions(), signal); check(signal);
        if (!Array.isArray(listed)) throw new Error('Invalid listening source list.');
        // The repository admits this family atomically. Keep that contract for
        // adapters too: no subset of a corrupt/duplicate/stale family is published.
        const ids = new Set<string>(), originals: ListeningSessionRecord[] = [];
        for (const value of listed) {
          check(signal);
          const original = readListeningSession(value);
          if (ids.has(original.sessionId)) throw new Error('Repeated listening source identity.');
          ids.add(original.sessionId); originals.push(original);
          if (originals.length % this.yieldEvery === 0) await pause();
        }
        const batchVerification = this.repository.readListeningSessionSnapshot !== undefined;
        const staged: { record: RecordCalendarRecord; facts: readonly RecordCalendarMetricFact[] }[] = [];
        for (const original of originals) {
          check(signal);
          const id = original.sessionId, key = `listening-session:${id}`;
          const identity = await interruptible(recordCalendarSourceIdentity(original), signal); check(signal);
          const listening = batchVerification ? original : readListeningSession(await interruptible(this.repository.loadListeningSession(id), signal), id);
          check(signal);
          if (!batchVerification && await interruptible(recordCalendarSourceIdentity(listening), signal) !== identity) throw new Error('Listening source changed after listing.');
          check(signal);
          const dates = await recordCalendarOccurrences((function* () { for (const event of listening.trainingSnapshot.events) yield event.wallTime; })(), zone, pause); check(signal);
          const facts = await projectRecordCalendarMetricFacts(listening, key, zone, pause); check(signal);
          staged.push({ record: Object.freeze({ source: 'listening-session', key, recordId: id, sessionId: id,
            sequence: listening.sequence, updatedAt: listening.updatedAt, scopeId: listening.scope.scopeId, revision: listening.scope.revision,
            materialId: listening.trainingSnapshot.material.id, materialVersion: listening.trainingSnapshot.material.version, identity, ...dates }), facts });
          if (staged.length % this.yieldEvery === 0) await pause();
        }
        // Verify after projection so edits or unrelated corrupt additions made
        // while staging are observed before any listening result is published.
        // The fresh snapshot replaces N full-store per-ID rereads. Validate and
        // detach every entry before any await, including unlisted extras, so a
        // mutable adapter cannot change a later entry during identity checks.
        if (batchVerification) {
          const values = await interruptible(this.repository.readListeningSessionSnapshot!(), signal); check(signal);
          if (!Array.isArray(values)) throw new Error('Invalid listening source snapshot.');
          const snapshot = new Map<string, ListeningSessionRecord>();
          for (const value of values) {
            check(signal);
            const verified = readListeningSession(value);
            if (snapshot.has(verified.sessionId)) throw new Error('Repeated listening source identity.');
            snapshot.set(verified.sessionId, verified);
          }
          await pause();
          let verifiedCount = 0;
          for (const { record } of staged) {
            check(signal);
            const current = snapshot.get(record.recordId);
            if (!current || await interruptible(recordCalendarSourceIdentity(current), signal) !== record.identity) throw new Error('Listening source changed after listing.');
            check(signal);
            if (++verifiedCount % this.yieldEvery === 0) await pause();
          }
        }
        check(signal);
        // All wrapper validation/read fences have passed. Publish only compact
        // facts; raw answers and assistance remain in the selected original only.
        for (const { record, facts } of staged) { metrics.add(facts); await accept(record); }
      } catch (error) { check(signal); issue(); }
      if (this.currentScan(token)) {
        const incomplete = issues > 0 || undatedEventCount > 0 || undatedRecordCount > 0 || metrics.getSnapshot().conflictCount > 0;
        this.scanError = incomplete ? '部分保留记录缺失、已更改、无法安全读取或没有可用的发生日期。日期索引不完整；未标记的日期不能视为没有练习。请刷新重试。' : null;
        this.update({ records: Object.freeze([...records]), metrics: metrics.getSnapshot(), ...counts(), status: incomplete ? records.length ? 'partial' : 'failed' : 'loaded' });
      }
    } catch {
      if (this.currentScan(token)) this.update({ records: Object.freeze([...records]), metrics: metrics.getSnapshot(), ...counts(), status: 'cancelled' });
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort);
      if (this.currentScan(token)) this.scanAbort = null;
    }
  }
  /** A click rereads the exact source and refuses changed identity or content. */
  async select(key: string): Promise<void> {
    if (!this.active) return;
    this.selectionAbort?.abort();
    const token = ++this.selectionEpoch, controller = new AbortController(), signal = controller.signal;
    this.selectionAbort = controller; this.selectionError = null;
    const record = this.state.records.find(value => value.key === key);
    this.update({ selected: null, selecting: true });
    if (!this.currentSelection(token) || signal.aborted) return;
    try {
      if (!record) throw new Error('Unknown date-index source.');
      let selected: RecordCalendarSelection;
      if (record.source === 'legacy-full') {
        const session = readLegacy(await interruptible(this.repository.loadHistorySession(record.recordId), signal), record.recordId);
        if (await interruptible(recordCalendarSourceIdentity(session), signal) !== record.identity) throw new Error('Changed source record.');
        selected = Object.freeze({ source: 'legacy-full', record, session });
      } else if (record.source === 'partial-segment') {
        const loaded = await interruptible(this.repository.loadTrainingHistorySegment(record.recordId), signal);
        if (!loaded) throw new Error('Missing source segment.');
        const segment = readTrainingHistorySegment(loaded);
        if (segment.segmentId !== record.recordId || await interruptible(recordCalendarSourceIdentity(segment), signal) !== record.identity) throw new Error('Changed source segment.');
        selected = Object.freeze({ source: 'partial-segment', record, segment });
      } else {
        if (!this.repository.loadListeningSession) throw new Error('Listening source read capability is unavailable.');
        const listeningSession = readListeningSession(await interruptible(this.repository.loadListeningSession(record.recordId), signal), record.recordId);
        if (await interruptible(recordCalendarSourceIdentity(listeningSession), signal) !== record.identity) throw new Error('Changed listening source record.');
        selected = Object.freeze({ source: 'listening-session', record, listeningSession });
      }
      if (this.currentSelection(token)) this.update({ selected, selecting: false });
    } catch {
      if (this.currentSelection(token)) { this.selectionError = '这条保留记录缺失、已更改或无法安全核对。请刷新日期索引后重试，当前不显示旧内容。'; this.update({ selected: null, selecting: false }); }
    } finally { if (this.currentSelection(token)) this.selectionAbort = null; }
  }
  back(): void {
    if (!this.active) return;
    ++this.selectionEpoch; this.selectionAbort?.abort(); this.selectionAbort = null; this.selectionError = null;
    this.update({ selected: null, selecting: false });
  }
  cancel(): void {
    if (!this.active) return;
    ++this.scanEpoch; this.scanAbort?.abort(); this.scanAbort = null;
    ++this.selectionEpoch; this.selectionAbort?.abort(); this.selectionAbort = null; this.selectionError = null;
    this.scanError = '日期读取已取消，已读取的部分不代表完整历史。';
    this.update({ status: 'cancelled', selected: null, selecting: false });
  }
  dispose(): void {
    this.active = false; ++this.scanEpoch; ++this.selectionEpoch; this.scanAbort?.abort(); this.selectionAbort?.abort();
    this.scanAbort = null; this.selectionAbort = null; this.scanError = null; this.selectionError = null; this.listeners.clear(); this.state = emptyView();
  }
}
