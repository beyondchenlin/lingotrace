import { LegacyHistoryError, type LegacyHistoryList, type LegacyHistorySession, type LegacyHistoryCursor } from './legacy-history';
import { RULE_VERSION, PACE_RULE_VERSION, type TrainingSnapshot } from './training';
import { exportStudioSession } from './session-export';

export interface LegacyHistoryAccess {
  listHistory(options?: { limit?: number; after?: LegacyHistoryCursor | null }): Promise<LegacyHistoryList>;
  loadHistorySession(id: string): Promise<LegacyHistorySession | null>;
  deliverHistorySession(id: string, expected: TrainingSnapshot, sink: () => void): Promise<void>;
}
export interface LegacyHistoryView {
  readonly list: LegacyHistoryList | null;
  readonly selected: LegacyHistorySession | null;
  readonly loading: boolean;
  readonly downloading: boolean;
  readonly paging: boolean;
  readonly page: number;
  readonly error: string | null;
  readonly canRetry: boolean;
}
const emptyView = (): LegacyHistoryView => Object.freeze({ list: null, selected: null, loading: false, downloading: false, paging: false, page: 1, error: null, canRetry: false });
/** Retry temporary reads, never validation or permission refusals. Every attempt
 * still passes through the repository's original readonly validation. */
function canRetryRead(error: unknown): boolean {
  if (error instanceof LegacyHistoryError) return error.code === 'read-failed' || error.code === 'stale-record';
  return !(error instanceof Error && ['SecurityError', 'NotAllowedError', 'PermissionDeniedError'].includes(error.name));
}
export function supportsLegacyHistoryExport(session: LegacyHistorySession): boolean {
  return session.summary.ruleVersions.length > 0 && session.summary.ruleVersions.every(rule => rule === RULE_VERSION)
    && session.summary.paceRuleVersions.length > 0 && session.summary.paceRuleVersions.every(rule => rule === PACE_RULE_VERSION);
}
/** View-only lifetime fence. No engine, save, delete, scoring or aggregate state. */
export class LegacyHistoryReader {
  private readonly repository: LegacyHistoryAccess;
  private readonly makeExport: typeof exportStudioSession;
  private epoch = 0;
  private active = true;
  private boundaries: (LegacyHistoryCursor | null)[] = [null];
  private listeners = new Set<() => void>();
  private pack: ReturnType<typeof exportStudioSession> | null = null;
  private retryAction: (() => Promise<void>) | null = null;
  private state: LegacyHistoryView = emptyView();
  constructor(repository: LegacyHistoryAccess, makeExport = exportStudioSession) { this.repository = repository; this.makeExport = makeExport; }
  activate(): void {
    ++this.epoch; this.active = true; this.pack = null; this.retryAction = null;
    this.update({ loading: false, downloading: false, paging: false, error: null, canRetry: false });
  }
  getSnapshot = (): LegacyHistoryView => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private current(token: number) { return this.active && token === this.epoch; }
  private update(patch: Partial<LegacyHistoryView>) { this.state = Object.freeze({ ...this.state, ...patch }); for (const listener of this.listeners) listener(); }
  async refresh(): Promise<void> {
    if (!this.active) return;
    const token = ++this.epoch; this.pack = null; this.retryAction = null; this.boundaries = [null];
    this.update({ selected: null, list: null, loading: true, downloading: false, paging: false, page: 1, error: null, canRetry: false });
    if (!this.current(token)) return;
    try { const list = await this.repository.listHistory({ limit: 100 }); if (this.current(token)) this.update({ list, loading: false }); }
    catch (error) {
      if (!this.current(token)) return;
      this.retryAction = canRetryRead(error) ? () => this.refresh() : null;
      this.update({ loading: false, canRetry: this.retryAction !== null, error: this.retryAction ? '读取本机历史失败。原记录没有改动，可重试读取。' : '本机历史无法安全读取。原记录没有改动，当前不能重试。' });
    }
  }
  /** Pages are independent readonly views, not an immutable database snapshot.
   * Keep only cursor boundaries; reread earlier pages instead of caching answers. */
  async changePage(direction: 'next' | 'previous'): Promise<void> {
    const current = this.state, list = current.list;
    if (!this.active || current.loading || current.paging || current.selected || !list) return;
    const target = current.page + (direction === 'next' ? 1 : -1);
    if (target < 1 || (direction === 'next' && (!list.hasMore || !list.nextCursor))) return;
    const after = direction === 'next' ? list.nextCursor : this.boundaries[target - 1];
    if (after === undefined) return;
    await this.readPage(direction, target, structuredClone(after));
  }
  /** Capture the failed page's original boundary, rather than recomputing it
   * from a later list. Cursor keys can themselves be mutable IndexedDB values. */
  private async readPage(direction: 'next' | 'previous', target: number, after: LegacyHistoryCursor | null): Promise<void> {
    if (!this.active) return;
    const token = ++this.epoch; this.pack = null; this.retryAction = null;
    this.update({ paging: true, downloading: false, error: null, canRetry: false });
    if (!this.current(token)) return;
    try {
      const next = await this.repository.listHistory({ limit: 100, after: structuredClone(after) });
      if (!this.current(token)) return;
      if (direction === 'next') this.boundaries = [...this.boundaries.slice(0, target - 1), after];
      this.update({ list: next, page: target, paging: false });
    } catch (error) {
      if (!this.current(token)) return;
      this.retryAction = canRetryRead(error) ? () => this.readPage(direction, target, after) : null;
      this.update({ paging: false, canRetry: this.retryAction !== null, error: this.retryAction ? '这批历史读取失败，仍保留当前列表。可重试读取同一批历史。' : '这批历史无法安全读取，仍保留当前列表，当前不能重试。' });
    }
  }
  async select(id: string): Promise<void> {
    if (!this.active) return;
    const token = ++this.epoch; this.pack = null; this.retryAction = null;
    this.update({ selected: null, loading: true, downloading: false, paging: false, error: null, canRetry: false });
    if (!this.current(token)) return;
    try {
      const selected = await this.repository.loadHistorySession(id);
      if (!this.current(token)) return;
      if (selected && (selected.snapshot.sessionId !== id || selected.summary.sessionId !== id)) throw new LegacyHistoryError('invalid-record', 'History session identity mismatch.');
      if (!selected) this.retryAction = () => this.select(id);
      this.update({ selected, loading: false, canRetry: this.retryAction !== null, error: selected ? null : '这条记录已不可读取。可重试读取同一条记录；原数据未改动。' });
    } catch (error) {
      if (!this.current(token)) return;
      this.retryAction = canRetryRead(error) ? () => this.select(id) : null;
      this.update({ loading: false, canRetry: this.retryAction !== null, error: this.retryAction ? '这条记录暂时无法读取。可重试读取同一条记录，未重新计算成绩。' : '这条记录无法安全读取，当前不能重试。原数据保留，未重新计算成绩。' });
    }
  }
  back(): void { if (!this.active) return; ++this.epoch; this.pack = null; this.retryAction = null; this.update({ selected: null, loading: false, downloading: false, paging: false, error: null, canRetry: false }); }
  async retry(): Promise<void> {
    if (!this.active || !this.state.canRetry || this.state.loading || this.state.paging || this.state.downloading) return;
    await this.retryAction?.();
  }
  async download(format: 'json' | 'csv', sink: (name: string, blob: Blob) => void): Promise<void> {
    const selected = this.state.selected;
    if (!this.active || !selected || this.state.downloading) return;
    const token = ++this.epoch; this.retryAction = null;
    if (!supportsLegacyHistoryExport(selected)) { this.update({ error: '该记录使用尚未支持导出的旧规则。原数据仍保留，当前不会用新版公式替换它。', canRetry: false }); return; }
    this.update({ downloading: true, error: null, canRetry: false });
    if (!this.current(token)) return;
    try {
      this.pack ??= this.makeExport(selected.snapshot);
      const pack = this.pack, blob = new Blob([pack[format]], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' });
      // Recheck the durable boundary in the repository's readonly transaction.
      // The sink is synchronous; closing/navigating invalidates this final handoff.
      await this.repository.deliverHistorySession(selected.snapshot.sessionId, selected.snapshot, () => {
        if (this.current(token) && this.state.selected === selected) sink(`lingotrace-training-v1-history.${format}`, blob);
      });
      if (this.current(token)) this.update({ downloading: false });
    } catch (error) {
      if (!this.current(token)) return;
      this.pack = null; this.retryAction = canRetryRead(error) ? () => this.select(selected.snapshot.sessionId) : null;
      this.update({ downloading: false, canRetry: this.retryAction !== null, error: this.retryAction ? '导出未开始：记录可能已更新、移除或暂不可读。点重试重新读取同一条记录，核对后再下载。' : '导出未开始：这条记录无法安全读取，当前不能重试。原数据仍保留。' });
    }
  }
  dispose(): void { this.boundaries = [null]; this.active = false; ++this.epoch; this.pack = null; this.retryAction = null; this.listeners.clear(); this.state = emptyView(); }
}
