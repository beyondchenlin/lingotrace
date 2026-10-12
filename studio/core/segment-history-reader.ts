import { readPartialListeningScope, type PartialListeningScope } from './listening-session';
import { readTrainingHistorySegment, type TrainingHistorySegmentCursor, type TrainingHistorySegmentList } from './repository';
import type { TrainingHistorySegment } from './training-history-segment';

export interface SegmentHistoryAccess {
  listTrainingHistorySegments(options?: { limit?: number; after?: TrainingHistorySegmentCursor | null }): Promise<TrainingHistorySegmentList>;
  loadTrainingHistorySegment(id: string): Promise<TrainingHistorySegment | null>;
  deliverTrainingHistorySegment(id: string, expected: TrainingHistorySegment, sink: () => void, expectedListeningScope?: PartialListeningScope | null): Promise<void>;
  loadPartialListeningScope?(id: string): Promise<PartialListeningScope | null>;
}
export interface SegmentHistoryView {
  readonly list: TrainingHistorySegmentList | null;
  readonly selected: TrainingHistorySegment | null;
  readonly listeningScope: PartialListeningScope | null;
  readonly loading: boolean;
  readonly downloading: boolean;
  readonly paging: boolean;
  readonly page: number;
  readonly error: string | null;
}

const emptyView = (): SegmentHistoryView => Object.freeze({ list: null, selected: null, listeningScope: null, loading: false, downloading: false, paging: false, page: 1, error: null });
const csvCell = (value: string): string => `"${value.replaceAll('"', '""')}"`;

/** Both formats preserve the exact retained projection, including nulls and redactions.
 * CSV has one row per metadata field or fact. JSON values keep nested alignment and
 * original strings reversible, and never expose answer text as spreadsheet formulas.
 * There is deliberately no export-time score, total, inferred duration or raw snapshot. */
export function exportTrainingHistorySegment(value: TrainingHistorySegment, listeningScope: PartialListeningScope | null = null): { json: string; csv: string } {
  const segment = readTrainingHistorySegment(value);
  if (listeningScope) {
    const scope = readPartialListeningScope(listeningScope);
    if (scope.segmentId !== segment.segmentId || scope.sessionId !== segment.sessionId || scope.generation !== segment.generation || scope.materialId !== segment.material.id || scope.materialVersion !== segment.material.version || scope.admittedFactCount > segment.facts.length) throw new Error('Listening scope and partial segment do not match.');
    const envelope = { exportVersion: 'listening-partial-export-v1', segment, listeningScope: scope };
    const csv = [['export_version', 'payload_json'], ['listening-partial-export-v1', JSON.stringify(envelope)]].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
    return { json: JSON.stringify(envelope, null, 2), csv };
  }
  const { facts, ...metadata } = segment;
  const rows: string[][] = [['row_type', 'field_or_ordinal', 'value_json']];
  for (const [key, field] of Object.entries(metadata)) rows.push(['segment', key, JSON.stringify(field)]);
  for (const fact of facts) rows.push(['fact', String(fact.ordinal), JSON.stringify(fact)]);
  return { json: JSON.stringify(segment, null, 2), csv: rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n' };
}

/** Readonly view lifetime. Only the repository's final guarded sink can deliver files. */
export class SegmentHistoryReader {
  private epoch = 0;
  private active = true;
  private boundaries: (TrainingHistorySegmentCursor | null)[] = [null];
  private listeners = new Set<() => void>();
  private state: SegmentHistoryView = emptyView();
  private pack: ReturnType<typeof exportTrainingHistorySegment> | null = null;
  private retryAction: (() => Promise<void>) | null = null;
  constructor(private readonly repository: SegmentHistoryAccess) {}
  activate(): void { ++this.epoch; this.active = true; }
  getSnapshot = (): SegmentHistoryView => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private current(token: number): boolean { return this.active && token === this.epoch; }
  private update(patch: Partial<SegmentHistoryView>): void { this.state = Object.freeze({ ...this.state, ...patch }); for (const listener of this.listeners) listener(); }
  async refresh(): Promise<void> {
    if (!this.active) return;
    const token = ++this.epoch; this.pack = null; this.retryAction = null; this.boundaries = [null];
    this.update({ selected: null, listeningScope: null, list: null, loading: true, downloading: false, paging: false, page: 1, error: null });
    if (!this.current(token)) return;
    try {
      const list = await this.repository.listTrainingHistorySegments({ limit: 100 });
      if (this.current(token)) this.update({ list, loading: false });
    } catch {
      if (this.current(token)) { this.retryAction = () => this.refresh(); this.update({ loading: false, error: '读取保留片段失败。原记录没有改动，请重试。' }); }
    }
  }
  async changePage(direction: 'next' | 'previous'): Promise<void> {
    const current = this.state, list = current.list;
    if (!this.active || current.loading || current.paging || current.selected || !list) return;
    const target = current.page + (direction === 'next' ? 1 : -1);
    if (target < 1 || (direction === 'next' && (!list.hasMore || !list.nextCursor))) return;
    const after = direction === 'next' ? list.nextCursor : this.boundaries[target - 1];
    if (after === undefined) return;
    const token = ++this.epoch; this.pack = null; this.retryAction = null;
    this.update({ paging: true, downloading: false, error: null });
    if (!this.current(token)) return;
    try {
      const next = await this.repository.listTrainingHistorySegments({ limit: 100, after });
      if (!this.current(token)) return;
      if (direction === 'next') this.boundaries = [...this.boundaries.slice(0, target - 1), after];
      this.update({ list: next, page: target, paging: false });
    } catch {
      if (this.current(token)) { this.retryAction = () => this.changePage(direction); this.update({ paging: false, error: '这批片段读取失败，仍保留当前列表。可重试或刷新片段列表。' }); }
    }
  }
  async select(id: string): Promise<void> {
    if (!this.active) return;
    const token = ++this.epoch; this.pack = null; this.retryAction = null;
    this.update({ selected: null, listeningScope: null, loading: true, downloading: false, paging: false, error: null });
    if (!this.current(token)) return;
    try {
      const value = await this.repository.loadTrainingHistorySegment(id);
      if (!this.current(token)) return;
      const selected = value === null ? null : readTrainingHistorySegment(value);
      if (selected && selected.segmentId !== id) throw new Error('History segment identity mismatch.');
      const rawScope = selected && this.repository.loadPartialListeningScope ? await this.repository.loadPartialListeningScope(id) : null;
      if (!this.current(token)) return;
      const listeningScope = rawScope === null ? null : readPartialListeningScope(rawScope);
      if (selected && listeningScope) exportTrainingHistorySegment(selected, listeningScope); // Validate joint identity before displaying either.
      if (!selected) this.retryAction = () => this.select(id);
      this.update({ selected, listeningScope, loading: false, error: selected ? null : '这个片段已不可读取。可重试或刷新列表；缺失不代表练习为零。' });
    } catch {
      if (this.current(token)) { this.retryAction = () => this.select(id); this.update({ loading: false, error: '这个片段无法安全读取。原记录保留，未补齐缺失内容或重新评分。' }); }
    }
  }
  back(): void {
    if (!this.active) return;
    ++this.epoch; this.pack = null; this.retryAction = null;
    this.update({ selected: null, listeningScope: null, loading: false, downloading: false, paging: false, error: null });
  }
  async retry(): Promise<void> { if (this.active && !this.state.loading && !this.state.paging && !this.state.downloading) await this.retryAction?.(); }
  async download(format: 'json' | 'csv', sink: (name: string, blob: Blob) => void): Promise<void> {
    const selected = this.state.selected;
    if (!this.active || !selected || this.state.downloading) return;
    const token = this.epoch; this.retryAction = null;
    this.update({ downloading: true, error: null });
    if (!this.current(token)) return;
    try {
      this.pack ??= exportTrainingHistorySegment(selected, this.state.listeningScope);
      const blob = new Blob([this.pack[format]], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' });
      await this.repository.deliverTrainingHistorySegment(selected.segmentId, selected, () => {
        if (this.current(token) && this.state.selected === selected) sink(`lingotrace-partial-history-segment.${format}`, blob);
      }, this.state.listeningScope);
      if (this.current(token)) this.update({ downloading: false });
    } catch {
      if (this.current(token)) {
        this.pack = null; this.retryAction = () => this.select(selected.segmentId);
        this.update({ downloading: false, error: '导出未开始：片段可能已更新、移除或暂不可读。点重试重新读取片段，核对后再下载。' });
      }
    }
  }
  dispose(): void {
    this.active = false; ++this.epoch; this.boundaries = [null]; this.pack = null; this.retryAction = null; this.listeners.clear(); this.state = emptyView();
  }
}
