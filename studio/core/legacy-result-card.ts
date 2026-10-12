import { freezeLegacyHistory, type LegacyHistorySession } from './legacy-history';
import { projectLegacyHistoryHud } from './legacy-history-hud';
import { renderHudScene } from '../hud-library/renderer';
import { formatSuppliedNumber } from '../hud-library/metrics';
import type { HudScene, ProgressMetric } from '../hud-library/schema';

export const LEGACY_RESULT_CARD_VERSION = 'legacy-result-card-v1' as const;
export const LEGACY_RESULT_CARD_WIDTH = 1200;
export const LEGACY_RESULT_CARD_HEIGHT = 800;

export interface LegacyResultCardFields {
  readonly words?: boolean;
  readonly completion?: boolean;
}

/** The complete export boundary: only these flat primitives may reach the canvas.
 * Source identity and lineage stay with the caller and are never included here. */
export interface LegacyResultCardModel {
  readonly version: typeof LEGACY_RESULT_CARD_VERSION;
  readonly sourceState: 'saved' | 'no-data';
  readonly includeWords: boolean;
  readonly includeCompletion: boolean;
  readonly earnedWords: number | null;
  readonly completedCount: number | null;
  readonly materialCueCount: number | null;
}

const modelKeys = ['version', 'sourceState', 'includeWords', 'includeCompletion', 'earnedWords', 'completedCount', 'materialCueCount'] as const;
const family = '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif';
const numericFamily = family;

function plainFields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'));
}

function selectedFields(fields: LegacyResultCardFields): { words: boolean; completion: boolean } {
  if (!plainFields(fields, ['words', 'completion'])) throw new TypeError('Only words and completion may be selected for the result card.');
  for (const value of Object.values(fields)) if (value !== undefined && typeof value !== 'boolean') throw new TypeError('Result card field selections must be boolean.');
  const words = fields.words !== false, completion = fields.completion !== false;
  if (!words && !completion) throw new RangeError('Select at least one result card field.');
  return { words, completion };
}

/** Reuse the checked saved-history projection, including its embedded-material
 * proof. No replay, current catalog, score calculation, writes or live state. */
export function projectLegacyResultCard(session: LegacyHistorySession | null, fields: LegacyResultCardFields = {}): LegacyResultCardModel {
  const selected = selectedFields(fields);
  const projection = session === null ? null : projectLegacyHistoryHud(session);
  const model: LegacyResultCardModel = {
    version: LEGACY_RESULT_CARD_VERSION,
    sourceState: projection ? 'saved' : 'no-data',
    includeWords: selected.words,
    includeCompletion: selected.completion,
    earnedWords: selected.words && projection ? projection.words.value : null,
    completedCount: selected.completion && projection ? projection.completion.numerator : null,
    materialCueCount: selected.completion && projection ? projection.completion.denominator : null,
  };
  validateModel(model);
  return freezeLegacyHistory(model);
}

function validateModel(model: LegacyResultCardModel): void {
  if (!plainFields(model, modelKeys) || Object.keys(model).length !== modelKeys.length
    || model.version !== LEGACY_RESULT_CARD_VERSION || !['saved', 'no-data'].includes(model.sourceState)
    || typeof model.includeWords !== 'boolean' || typeof model.includeCompletion !== 'boolean'
    || (!model.includeWords && !model.includeCompletion)) throw new TypeError('Invalid private result card model.');
  const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const wordsAvailable = model.sourceState === 'saved' && model.includeWords;
  const completionAvailable = model.sourceState === 'saved' && model.includeCompletion;
  if (wordsAvailable ? !integer(model.earnedWords) : model.earnedWords !== null) throw new TypeError('Invalid saved word quantity.');
  if (completionAvailable) {
    if (!integer(model.completedCount) || !integer(model.materialCueCount) || model.materialCueCount === 0
      || model.completedCount > model.materialCueCount) throw new TypeError('Completion requires the saved numerator and a positive material total.');
  } else if (model.completedCount !== null || model.materialCueCount !== null) throw new TypeError('Hidden or unavailable completion must contain no quantities.');
}

function fittedText(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string,
  width: number, options: { align?: CanvasTextAlign; numeric?: boolean; weight?: number } = {}): void {
  const font = options.numeric ? numericFamily : family, weight = options.weight ?? 400;
  ctx.font = `${weight} ${size}px ${font}`;
  const measured = ctx.measureText(value).width;
  if (measured > width) ctx.font = `${weight} ${size * width / measured}px ${font}`;
  ctx.textAlign = options.align ?? 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = color;
  ctx.fillText(value, x, y, width);
}

function plate(ctx: CanvasRenderingContext2D, x: number, width: number): void {
  ctx.beginPath(); ctx.roundRect(x, 232, width, 410, 26);
  ctx.fillStyle = '#152220'; ctx.fill(); ctx.strokeStyle = '#30403b'; ctx.lineWidth = 1; ctx.stroke();
}

function paintWords(ctx: CanvasRenderingContext2D, model: LegacyResultCardModel, x: number, width: number): void {
  plate(ctx, x, width);
  ctx.fillStyle = '#bce7b8'; ctx.fillRect(x + 34, 275, 18, 3);
  fittedText(ctx, '已确认词数', x + 64, 282, 20, '#ecf3ed', width - 100, { weight: 600 });
  const center = x + width / 2, available = model.earnedWords !== null;
  fittedText(ctx, available ? formatSuppliedNumber(model.earnedWords!) : '—', center, 470, width > 600 ? 142 : 122,
    available ? '#c7edbc' : '#8b9e93', width - 84, { numeric: true, align: 'center', weight: 700 });
  fittedText(ctx, available ? '个词 · 原确认规则' : '暂无已保存数据', center, 528, 21, '#b6c7bc', width - 84, { align: 'center' });
  fittedText(ctx, available ? '沿用 Training v1 保存的确认词数' : '没有记录时不显示为零', center, 608, 17, '#91a599', width - 84, { align: 'center' });
}

/** A fresh allowlisted metric feeds the existing HUD ring. No original metric
 * object, source event, ID, timestamp or arbitrary description enters the scene. */
function completionScene(model: LegacyResultCardModel): HudScene {
  const available = model.sourceState === 'saved';
  const metric: ProgressMetric = {
    schemaVersion: 1, metricVersion: 1, metricId: 'private-card-completion', kind: 'progress', unit: 'count',
    source: 'legacy-training-snapshot', state: available ? { status: 'ready' } : { status: 'no-data', message: '没有保存的素材总数时不计算比例' },
    quality: available ? 'measured' : 'unmeasured', observedAtMs: null, sourceEventIds: [],
    numerator: model.completedCount, denominator: model.materialCueCount,
  };
  return {
    schemaVersion: 1, size: { width: 350, height: 290 }, safeBounds: { x: 0, y: 0, width: 350, height: 290 },
    metrics: { [metric.metricId]: metric }, nodes: [{
      id: 'private-card-ring', type: 'progress-ring', schemaVersion: 1, precision: 1,
      metricBinding: { metricKey: metric.metricId, metricVersion: 1, schemaVersion: 1, unit: 'count', source: metric.source },
      label: '素材完成情况', description: '完成句数 / 当时保存素材的总句数',
      position: { x: 0, y: 0 }, size: { width: 350, height: 290 }, anchor: 'top-left', zIndex: 0, motion: 'none',
      style: { font: { family, numericFamily, labelSize: 14, valueSize: 64 },
        colors: { text: '#ecf3ed', muted: '#91a599', accent: '#c7edbc', track: '#34453e', guide: '#465c50' } },
    }],
  };
}

function paintCompletion(ctx: CanvasRenderingContext2D, model: LegacyResultCardModel, x: number, width: number): void {
  plate(ctx, x, width);
  ctx.save();
  try {
    ctx.translate(x + (width - 472.5) / 2, 248); ctx.scale(1.35, 1.35);
    renderHudScene(ctx, completionScene(model), { nowMs: 0, reducedMotion: true });
  } finally { ctx.restore(); }
}

/** The single preview/PNG compositor. It owns the fixed canvas dimensions and
 * resets the entire surface, including previous clipping and transforms.
 * It never fetches, uploads, downloads, captures media, or inspects live state. */
export function renderLegacyResultCard(ctx: CanvasRenderingContext2D, model: LegacyResultCardModel): void {
  validateModel(model);
  ctx.canvas.width = LEGACY_RESULT_CARD_WIDTH; ctx.canvas.height = LEGACY_RESULT_CARD_HEIGHT;
  ctx.save();
  try {
    const background = ctx.createLinearGradient(0, 0, 1200, 800);
    background.addColorStop(0, '#12211d'); background.addColorStop(1, '#0c1414');
    ctx.fillStyle = background; ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = '#bce7b8'; ctx.beginPath(); ctx.arc(71, 63, 6, 0, Math.PI * 2); ctx.fill();
    fittedText(ctx, 'LINGOTRACE', 90, 69, 18, '#c5d7ca', 360, { numeric: true, weight: 600 });
    fittedText(ctx, '私人结果卡', 1136, 69, 17, '#91a599', 220, { align: 'right' });
    fittedText(ctx, '我的练习记录', 64, 148, 50, '#f0f5ef', 1072, { weight: 700 });
    fittedText(ctx, model.sourceState === 'saved' ? 'Training v1 · 已保存快照' : 'Training v1 · 暂无已保存快照', 66, 192, 20, '#a7bcb0', 1072);

    const both = model.includeWords && model.includeCompletion, width = both ? 520 : 1072;
    if (model.includeWords) paintWords(ctx, model, 64, width);
    if (model.includeCompletion) paintCompletion(ctx, model, both ? 616 : 64, width);

    ctx.beginPath(); ctx.moveTo(64, 686); ctx.lineTo(1136, 686); ctx.strokeStyle = '#314039'; ctx.lineWidth = 1; ctx.stroke();
    fittedText(ctx, '原确认规则 · 完成比例不是能力评分', 64, 727, 21, '#b7cabe', 1072, { weight: 500 });
    fittedText(ctx, '仅展示所选字段的保存结果', 64, 761, 16, '#82988c', 1072);
  } finally { ctx.restore(); }
}
