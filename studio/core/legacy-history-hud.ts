import { freezeLegacyHistory, LegacyHistoryError, LEGACY_HISTORY_SOURCE, readLegacyHistoryRecord, type LegacyHistorySession } from './legacy-history';
import { deriveInputRateTimeline, INPUT_RATE_VERSION, type InputRatePoint, type InputRateTimeline } from './input-rate-timeline';
import { RULE_VERSION, PACE_RULE_VERSION } from './training';
import type { NumberMetric, ProgressMetric, TrendMetric, TrendPoint } from '../hud-library/schema';

export const LEGACY_HISTORY_HUD_VERSION = 'legacy-history-hud-v1' as const;
export const LEGACY_HISTORY_HUD_SOURCE = 'legacy-training-snapshot' as const;
export const LEGACY_HISTORY_HUD_POINT_LIMIT = 4096;

export interface LegacyHistoryHudTrend {
  readonly id: string;
  readonly label: string;
  readonly metric: TrendMetric;
  readonly metricVersion: string;
  readonly coverage: string;
  /** Display coordinates are exact wall-time offsets from this recorded origin. */
  readonly originWallTimeMs: number;
  /** Half-open indexes into the unchanged timeline.points; no point is discarded. */
  readonly sourcePointStart: number;
  readonly sourcePointEnd: number;
  /** Original measured path identity; null means these are only null observations. */
  readonly observationSegmentId: string | null;
}
export interface LegacyHistoryHudProjection {
  readonly version: typeof LEGACY_HISTORY_HUD_VERSION;
  readonly source: typeof LEGACY_HISTORY_HUD_SOURCE;
  readonly sessionId: string;
  readonly sequence: number;
  readonly material: Readonly<{ id: string; version: string; evidence: 'embedded-snapshot' }>;
  readonly words: NumberMetric;
  readonly completion: ProgressMetric;
  readonly timeline: InputRateTimeline | null;
  readonly trends: readonly LegacyHistoryHudTrend[];
  readonly limitations: readonly string[];
}

const base = { schemaVersion: 1, metricVersion: 1, source: LEGACY_HISTORY_HUD_SOURCE } as const;
const stateLabels = { measured: '已测', sampling: '采样中', frozen: '暂停', unavailable: '不可测' } as const;

function invalidSession(): never {
  throw new LegacyHistoryError('invalid-record', 'HUD metrics require a complete saved Training v1 snapshot. Partial observation segments cannot be projected.');
}

/** Check the saved boundary again, without trusting a TypeScript cast or invoking
 * scoring validation. The structural reader preserves historical aggregate facts. */
function checkedSession(session: LegacyHistorySession): LegacyHistorySession {
  if (!session || session.source !== LEGACY_HISTORY_SOURCE || !session.snapshot || !session.summary ||
    session.summary.source !== LEGACY_HISTORY_SOURCE || session.summary.materialSource !== 'embedded-snapshot') invalidSession();
  for (const value of [session, session.snapshot]) {
    if ('coverage' in value && value.coverage === 'partial' || 'replayable' in value && value.replayable === false) invalidSession();
  }
  const checked = readLegacyHistoryRecord({ sessionId: session.summary.sessionId, sequence: session.summary.sequence,
    updatedAt: session.summary.updatedAt, snapshot: session.snapshot }, session.summary.sessionId);
  if (checked.summary.materialId !== session.summary.materialId || checked.summary.materialVersion !== session.summary.materialVersion) {
    throw new LegacyHistoryError('invalid-material', 'Saved material identity or version does not match the history selection.');
  }
  return checked;
}

/** One display metric has one measured path, one metric version, increasing real
 * timestamps, and at most 4096 points. Never sort, average, deduplicate, interpolate,
 * invent a null endpoint, or join separate source paths to satisfy the HUD schema. */
function projectTrends(timeline: InputRateTimeline): LegacyHistoryHudTrend[] {
  const segmentForEvent = new Map<string, string>();
  for (const segment of timeline.segments) for (const point of segment.points) segmentForEvent.set(point.eventId, segment.id);
  const windows: LegacyHistoryHudTrend[] = [];
  let start = 0, boundary = '记录起点';
  const version = (point: InputRatePoint) => point.metricVersion ?? INPUT_RATE_VERSION;
  const path = (point: InputRatePoint) => segmentForEvent.get(point.eventId) ?? null;
  const observation = (point: InputRatePoint) => JSON.stringify([point.observationRunId ?? null, point.observationSegment ?? null]);
  function emit(end: number) {
    if (end <= start) return;
    const actual = timeline.points.slice(start, end), first = actual[0], last = actual[actual.length - 1];
    const originWallTimeMs = first.wallTimeMs;
    const points: TrendPoint[] = actual.map(point => ({
      atMs: point.wallTimeMs - originWallTimeMs,
      value: point.cpm,
      quality: point.cpm === null ? 'unmeasured' : 'measured',
      state: point.cpm !== null ? 'active' : point.state === 'frozen' ? 'paused' : 'missing',
      sourceEventIds: [...new Set([point.eventId, ...point.sourceEventIds, ...point.excludedEventIds, ...point.unknownEventIds])],
    }));
    const measured = actual.filter(point => point.cpm !== null), metricVersion = version(first);
    const metricId = `legacy-input-rate:${first.eventId}:${start}`;
    const status = measured.length ? { status: 'ready' as const } : { status: 'no-data' as const, message: '该窗口只有采样中、暂停或不可测记录；null 不是零。' };
    const counts = (Object.keys(stateLabels) as (keyof typeof stateLabels)[]).flatMap(state => {
      const count = actual.filter(point => point.state === state).length;
      return count ? [`${stateLabels[state]} ${count}`] : [];
    }).join('，');
    // A one-point window still needs a nonempty drawing domain. This padding is
    // canvas scale only, never an extra observation or a claimed duration.
    const endMs = Math.max(1, last.wallTimeMs - originWallTimeMs);
    windows.push({ id: metricId, label: `输入速率 CPM · 窗口 ${windows.length + 1}`, metricVersion,
      coverage: `原始点 ${start + 1}–${end} / ${timeline.points.length}；${counts}；${boundary}。窗口独立，不跨窗口连线；横轴从该窗口首个实点计秒。`,
      originWallTimeMs, sourcePointStart: start, sourcePointEnd: end, observationSegmentId: path(first),
      metric: { ...base, kind: 'trend', metricId, unit: 'graphemes/minute', state: status,
        quality: measured.length ? 'measured' : 'unmeasured', observedAtMs: last.wallTimeMs >= 0 ? last.wallTimeMs : null,
        sourceEventIds: actual.map(point => point.eventId), points,
        domain: { startMs: 0, endMs, min: 0, max: Math.max(1, ...measured.map(point => point.cpm!)) } },
    });
  }
  for (let index = 1; index < timeline.points.length; index++) {
    const previous = timeline.points[index - 1], point = timeline.points[index];
    const reason = point.wallTimeMs < previous.wallTimeMs ? '墙钟倒退，保留原始顺序并另起窗口'
      : point.wallTimeMs === previous.wallTimeMs ? '相同墙钟时间，两个实点分别保留'
      : version(point) !== version(previous) ? 'CPM 指标版本边界'
      : observation(point) !== observation(previous) ? '观测运行或观测段边界'
      : path(point) !== path(previous) ? '实测路径或 null 覆盖边界'
      : index - start >= LEGACY_HISTORY_HUD_POINT_LIMIT ? '达到每窗口 4096 点的显示上限'
      : null;
    if (reason) { emit(index); start = index; boundary = reason; }
  }
  emit(timeline.points.length);
  return windows;
}

/** Readonly presentation of a selected saved record. No catalog lookup, write,
 * live-engine restore, export replacement, migration, or new score calculation. */
export function projectLegacyHistoryHud(session: LegacyHistorySession): LegacyHistoryHudProjection {
  const selected = checkedSession(session), snapshot = selected.snapshot;
  const observedAt = Date.parse(selected.summary.updatedAt), observedAtMs = observedAt >= 0 ? observedAt : null;
  const limitations = [
    '累计得词沿用 Training v1 保存的旧规则 earnedWords，不按今天的规则重算，也不是输入速度或能力评分。',
    '完成数来自保存的 completedCueIds；分母只取与 sessionStarted 一致、带版本的内嵌材料，不读取当前目录。',
    'CPM 逐点复用原 input.cpm.5s.v1 / v2 推导，表示提交的手动输入字素/分钟，不使用能量值。',
    '每个趋势窗口最多 4096 个原始点；版本、观测段、实测路径、重复或倒退墙钟均分窗，不平均、不删点、不插值。',
    'null 采样、暂停和不可测记录保留；单点窗口横轴的一毫秒留白仅用于绘制，不代表额外观测。',
  ];
  let timeline: InputRateTimeline | null = null;
  if (selected.summary.ruleVersions.every(rule => rule === RULE_VERSION) && selected.summary.paceRuleVersions.every(rule => rule === PACE_RULE_VERSION)) {
    try { timeline = deriveInputRateTimeline(snapshot); }
    catch { limitations.push('该记录的事件无法由受支持的 CPM 推导安全读取；速率无数据，保存的累计得词和完成数仍原样展示。'); }
  } else {
    limitations.push('该记录含尚未支持的历史事件规则；速率无数据，不替换为当前规则。');
  }
  return freezeLegacyHistory({ version: LEGACY_HISTORY_HUD_VERSION, source: LEGACY_HISTORY_HUD_SOURCE,
    sessionId: snapshot.sessionId, sequence: snapshot.sequence,
    material: { id: snapshot.material.id, version: snapshot.material.version, evidence: 'embedded-snapshot' as const },
    words: { ...base, kind: 'number' as const, metricId: 'legacy-earned-words', unit: 'words' as const,
      value: snapshot.earnedWords, quality: 'measured' as const, state: { status: 'ready' as const }, observedAtMs, sourceEventIds: [] },
    completion: { ...base, kind: 'progress' as const, metricId: 'legacy-completed-cues', unit: 'count' as const,
      numerator: snapshot.completedCueIds.length, denominator: snapshot.material.cues.length,
      quality: 'measured' as const, state: { status: 'ready' as const }, observedAtMs, sourceEventIds: [] },
    timeline, trends: timeline ? projectTrends(timeline) : [], limitations: [...limitations, ...(timeline?.limitations ?? [])] });
}
