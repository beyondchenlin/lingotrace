import type { HudMetric, HudNode, HudScene } from '../hud-library/schema.ts';

export type HistoryHudStyle = 'numeric' | 'progress-ring' | 'progress-track' | 'trend-line' | 'trend-bars';
/** Presentation only: every style binds the exact same immutable supplied metric. */
export function historyHudScene(metric: HudMetric, type: HistoryHudStyle, width: number): HudScene {
  if (!Number.isFinite(width) || width < 270 || width > 16384) throw new RangeError('Unsupported history chart width');
  if (metric.source !== 'legacy-training-snapshot') throw new TypeError('Only retained Training v1 history belongs in this view');
  const kind = type === 'numeric' ? 'number' : type.startsWith('progress') ? 'progress' : 'trend';
  if (metric.kind !== kind) throw new TypeError('The selected appearance cannot change the metric kind');
  const size = { width, height: 260 };
  const base = {
    id: 'retained-history-view', schemaVersion: 1 as const,
    metricBinding: { metricKey: metric.metricId, metricVersion: metric.metricVersion, schemaVersion: metric.schemaVersion, unit: metric.unit, source: metric.source },
    label: kind === 'number' ? '已确认词' : kind === 'progress' ? '完成句子' : '真实输入率',
    description: kind === 'number' ? 'Training v1 原保存值' : kind === 'progress' ? '分母来自当时保存的素材' : '字符/分 · 本窗口相对时间（秒）',
    position: { x: 0, y: 0 }, size, anchor: 'top-left' as const, zIndex: 0, motion: 'none' as const,
    style: { font: { family: 'Arial, sans-serif', numericFamily: 'Arial, sans-serif', labelSize: 14, valueSize: 48 }, colors: { accent: '#b8e8bf', accentSoft: '#b8e8bf55' } },
  };
  let node: HudNode;
  switch (type) {
    case 'numeric': node = { ...base, type, precision: 0, suffix: '个 · 旧版确认规则' }; break;
    case 'progress-ring': case 'progress-track': node = { ...base, type, precision: 1 }; break;
    case 'trend-line': node = { ...base, type, maxGapMs: Number.MAX_SAFE_INTEGER }; break;
    case 'trend-bars': node = { ...base, type }; break;
  }
  return { schemaVersion: 1, size, safeBounds: { x: 0, y: 0, ...size }, nodes: [node], metrics: { [metric.metricId]: metric } };
}
