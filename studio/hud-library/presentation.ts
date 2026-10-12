import type { HudMetric, HudNode, InputPulseNode, MetricUnit } from './schema.ts';

/** Presentation choices preserve the metric's semantic kind and supplied unit. */
export type HudVariantId =
  | 'numeric'
  | 'trend-line'
  | 'trend-bars'
  | 'pulse-wave'
  | 'pulse-events'
  | 'progress-ring'
  | 'progress-track'
  | 'bar-chart'
  | 'target-band'
  | 'calendar-heatmap';

export type PresentationOption = Readonly<{
  id: HudVariantId;
  label: string;
  nodeType: HudNode['type'];
  /** Semantic/shape compatibility is independent of observation availability. */
  compatible: boolean;
  available: boolean;
  reason: string | null;
}>;

type VariantDefinition = Readonly<{
  id: HudVariantId;
  label: string;
  nodeType: HudNode['type'];
  kind: HudMetric['kind'];
  units: readonly MetricUnit[];
  kindReason: string;
  unitReason: string;
  visualization?: InputPulseNode['visualization'];
}>;

const ALL_UNITS: readonly MetricUnit[] = Object.freeze([
  'count', 'words', 'graphemes', 'seconds', 'milliseconds', 'percent',
  'graphemes/second', 'graphemes/minute',
]);
const QUANTITY_UNITS: readonly MetricUnit[] = Object.freeze([
  'count', 'words', 'graphemes', 'seconds', 'milliseconds',
]);
const PULSE_UNITS: readonly MetricUnit[] = Object.freeze(['graphemes']);

// Kept independent of rendering and sizing registries: choosing a form never
// bins observations, invents a denominator or converts one semantic kind to another.
const VARIANTS: readonly VariantDefinition[] = Object.freeze([
  { id: 'numeric', label: '数值', nodeType: 'numeric', kind: 'number', units: ALL_UNITS, kindReason: '需要单值指标', unitReason: '不支持此单位' },
  { id: 'trend-line', label: '趋势折线', nodeType: 'trend-line', kind: 'trend', units: ALL_UNITS, kindReason: '需要时间序列指标', unitReason: '不支持此趋势单位' },
  { id: 'trend-bars', label: '趋势柱状', nodeType: 'trend-bars', kind: 'trend', units: ALL_UNITS, kindReason: '需要时间序列指标', unitReason: '不支持此趋势单位' },
  { id: 'pulse-wave', label: '输入波形', nodeType: 'input-pulse', kind: 'input-pulse', units: PULSE_UNITS, kindReason: '需要已提交输入事件', unitReason: '输入事件必须使用字素单位', visualization: 'wave-scan' },
  { id: 'pulse-events', label: '输入事件', nodeType: 'input-pulse', kind: 'input-pulse', units: PULSE_UNITS, kindReason: '需要已提交输入事件', unitReason: '输入事件必须使用字素单位', visualization: 'event-stems' },
  { id: 'progress-ring', label: '进度环', nodeType: 'progress-ring', kind: 'progress', units: QUANTITY_UNITS, kindReason: '需要完成量与总量指标', unitReason: '进度需要数量或时长单位' },
  { id: 'progress-track', label: '进度条', nodeType: 'progress-track', kind: 'progress', units: QUANTITY_UNITS, kindReason: '需要完成量与总量指标', unitReason: '进度需要数量或时长单位' },
  { id: 'bar-chart', label: '分组柱状', nodeType: 'bar-chart', kind: 'bar', units: QUANTITY_UNITS, kindReason: '需要明确分组的数量指标', unitReason: '分组柱状需要数量或时长单位' },
  { id: 'target-band', label: '目标区间', nodeType: 'target-band', kind: 'target-band', units: ALL_UNITS, kindReason: '需要实际值与目标区间指标', unitReason: '不支持此目标单位' },
  { id: 'calendar-heatmap', label: '日历热力', nodeType: 'calendar-heatmap', kind: 'calendar', units: QUANTITY_UNITS, kindReason: '需要逐日覆盖数据', unitReason: '日历需要数量或时长单位' },
].map(definition => Object.freeze(definition)) as readonly VariantDefinition[]);

function variantDefinition(id: HudVariantId): VariantDefinition {
  const definition = VARIANTS.find(variant => variant.id === id);
  if (!definition) throw new RangeError(`Unknown HUD variant: ${String(id)}`);
  return definition;
}

export function variantToNodeType(id: HudVariantId): HudNode['type'] {
  return variantDefinition(id).nodeType;
}

export function pulseVisualizationForVariant(id: HudVariantId): InputPulseNode['visualization'] | undefined {
  return variantDefinition(id).visualization;
}

const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);

function availabilityReason(metric: HudMetric): string | null {
  if (metric.state.status === 'error') return '数据读取失败';
  if (metric.state.status === 'no-data') return '暂无数据';
  if (metric.quality === 'unmeasured') return '尚未测量';

  switch (metric.kind) {
    case 'number':
      return finite(metric.value) ? null : '数值尚未提供';
    case 'trend':
      return metric.points.some(point => finite(point.value)
        && point.quality !== 'unmeasured'
        && (!point.state || point.state === 'active')
        && point.atMs >= metric.domain.startMs && point.atMs <= metric.domain.endMs)
        ? null : '暂无有效时间序列观测';
    case 'input-pulse':
      return metric.events.some(event => (event.source === 'typed' || event.source === 'ime') && event.addedGraphemes > 0)
        ? null : '暂无已提交输入';
    case 'progress':
      if (!finite(metric.numerator)) return '已完成数量未知';
      if (metric.numerator < 0) return '已完成数量无效';
      if (!finite(metric.denominator)) return '总量未知，无法显示比例';
      if (metric.denominator <= 0) return '总量必须大于零';
      return Number.isFinite(metric.numerator / metric.denominator * 100) ? null : '比例超出有效范围';
    case 'target-band':
      if (!finite(metric.value)) return '实际值未知';
      return finite(metric.target.min) && finite(metric.target.max) ? null : '目标上下限未完整提供';
    case 'bar':
      // Partial coverage is a supplied fact even when its quantity is still null.
      return metric.groups.some(group => group.coverage === 'complete' || group.coverage === 'partial')
        ? null : '分组数据均未知';
    case 'calendar':
      return metric.days.some(day => day.coverage === 'complete' || day.coverage === 'partial')
        ? null : '日期数据均未知';
  }
}

/**
 * Missing observations remain semantically compatible so an already selected
 * configuration can keep rendering its explicit no-data state. An invalid shape
 * (such as bars without a zero baseline) is incompatible and must not be retained.
 * Use `available` for new selections and `compatible` when retaining a saved choice.
 */
export function presentationOptions(metric: HudMetric): readonly PresentationOption[] {
  const missingReason = availabilityReason(metric);
  return Object.freeze(VARIANTS.map(variant => {
    const invalidBarBaseline = variant.id === 'trend-bars' && metric.kind === 'trend'
      && !(metric.domain.min <= 0 && metric.domain.max >= 0);
    const compatible = variant.kind === metric.kind && variant.units.includes(metric.unit) && !invalidBarBaseline;
    let reason: string | null;
    if (variant.kind !== metric.kind) reason = variant.kindReason;
    else if (!variant.units.includes(metric.unit)) reason = variant.unitReason;
    else if (invalidBarBaseline) reason = '纵轴范围须包含零';
    else if (missingReason) reason = missingReason;
    else reason = null;
    return Object.freeze({
      id: variant.id, label: variant.label, nodeType: variant.nodeType,
      compatible, available: compatible && reason === null, reason,
    });
  }));
}
