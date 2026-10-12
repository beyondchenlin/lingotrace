/** Version 1 display-only contract (additive v0.2 component set). No score calculation, timers, persistence or input capture. */
import type { Anchor, Point, Rect, Size } from './layout.ts';
export const HUD_SCHEMA_VERSION = 1 as const;
export type MetricSource = 'practice-projection' | 'input-event' | 'legacy-training-snapshot' | 'fixture';
export type MeasurementQuality = 'measured' | 'estimated' | 'unmeasured';
export type MetricUnit = 'count' | 'words' | 'graphemes' | 'seconds' | 'milliseconds' | 'percent' | 'graphemes/second' | 'graphemes/minute';
export type DataState =
  | Readonly<{ status: 'ready' }>
  | Readonly<{ status: 'no-data'; message?: string }>
  | Readonly<{ status: 'paused'; frozenAtMs: number; message?: string }>
  | Readonly<{ status: 'error'; message: string }>;
export type MetricBinding = Readonly<{
  metricKey: string; metricVersion: 1; schemaVersion: typeof HUD_SCHEMA_VERSION; unit: MetricUnit; source: MetricSource;
}>;
type MetricBase = Readonly<{
  schemaVersion: typeof HUD_SCHEMA_VERSION; metricId: string; metricVersion: 1; unit: MetricUnit; source: MetricSource; state: DataState;
  quality: MeasurementQuality; observedAtMs: number | null; sourceEventIds: readonly string[];
}>;
export type NumberMetric = MetricBase & Readonly<{ kind: 'number'; value: number | null }>;
export type TrendPoint = Readonly<{ atMs: number; value: number | null; quality: MeasurementQuality; sourceEventIds: readonly string[]; state?: 'active' | 'missing' | 'paused' }>;
export type TrendMetric = MetricBase & Readonly<{
  kind: 'trend'; points: readonly TrendPoint[];
  domain: Readonly<{ startMs: number; endMs: number; min: number; max: number }>;
}>;
export type InputPulseEvent = Readonly<{
  id: string; atMs: number; source: 'typed' | 'ime' | 'paste' | 'delete' | 'other'; addedGraphemes: number;
}>;
export type InputPulseMetric = MetricBase & Readonly<{ kind: 'input-pulse'; events: readonly InputPulseEvent[] }>;
export type ProgressMetric = MetricBase & Readonly<{ kind: 'progress'; numerator: number | null; denominator: number | null }>;
export type DataCoverage = 'complete' | 'partial' | 'unknown';
export type BarDatum = Readonly<{
  id: string; label: string; value: number | null; coverage: DataCoverage; sourceEventIds: readonly string[];
  interval?: Readonly<{ start: number; end: number }>;
}>;
export type BarMetric = MetricBase & Readonly<{
  kind: 'bar'; grouping: Readonly<{ kind: 'interval' | 'sentence' | 'category'; label: string; intervalUnit?: 'seconds' | 'milliseconds' }>;
  groups: readonly BarDatum[]; domain: Readonly<{ min: 0; max: number }>;
}>;
export type TargetBandMetric = MetricBase & Readonly<{
  kind: 'target-band'; value: number | null; target: Readonly<{ min: number | null; max: number | null }>;
  scale: Readonly<{ min: number; max: number }>;
}>;
export type CalendarDay = Readonly<{ date: string; value: number | null; coverage: DataCoverage; sourceEventIds: readonly string[] }>;
export type CalendarMetric = MetricBase & Readonly<{
  kind: 'calendar'; timezone: string; startDate: string; endDate: string; weekStartsOn: 'monday' | 'sunday';
  /** One explicit row per date in the inclusive window; missing dates must be unknown rows. */
  days: readonly CalendarDay[]; colorDomain: Readonly<{ min: 0; max: number }>;
}>;
export type HudMetric = NumberMetric | TrendMetric | InputPulseMetric | ProgressMetric | BarMetric | TargetBandMetric | CalendarMetric;
export type HudColors = Readonly<{
  text: string; muted: string; accent: string; accentSoft: string; track: string; guide: string; warning: string; error: string;
}>;
export type HudTypography = Readonly<{ family: string; numericFamily: string; labelSize: number; valueSize: number }>;
export type HudStyle = Readonly<{
  colors?: Partial<HudColors>; font?: Partial<HudTypography>; opacity?: number;
  backplate?: Readonly<{ color: string; opacity: number }>;
  textOutline?: Readonly<{ color: string; width: number }>;
}>;
export type MotionPolicy = 'subtle' | 'none';
type NodeBase = Readonly<{
  id: string; schemaVersion: typeof HUD_SCHEMA_VERSION; metricBinding: MetricBinding;
  label: string; description?: string; position: Point; size: Size; anchor: Anchor; zIndex: number;
  style?: HudStyle; motion: MotionPolicy;
}>;
export type NumberNode = NodeBase & Readonly<{ type: 'numeric'; precision: 0 | 1 | 2; suffix?: string }>;
export type TrendNode = NodeBase & Readonly<{ type: 'trend-line'; maxGapMs: number }>;
export type TrendBarsNode = NodeBase & Readonly<{ type: 'trend-bars' }>;
export type InputPulseNode = NodeBase & Readonly<{ type: 'input-pulse'; windowMs: number; visualization: 'wave-scan' | 'event-stems' }>;
export type ProgressNode = NodeBase & Readonly<{ type: 'progress-ring'; precision: 0 | 1 }>;
export type ProgressTrackNode = NodeBase & Readonly<{ type: 'progress-track'; precision: 0 | 1 }>;
export type BarNode = NodeBase & Readonly<{ type: 'bar-chart' }>;
export type TargetBandNode = NodeBase & Readonly<{ type: 'target-band' }>;
export type CalendarNode = NodeBase & Readonly<{ type: 'calendar-heatmap' }>;
export type HudNode = NumberNode | TrendNode | TrendBarsNode | InputPulseNode | ProgressNode | ProgressTrackNode | BarNode | TargetBandNode | CalendarNode;
export type HudScene = Readonly<{
  schemaVersion: typeof HUD_SCHEMA_VERSION; size: Size; safeBounds: Rect;
  nodes: readonly HudNode[]; metrics: Readonly<Record<string, HudMetric>>;
}>;
/** A monotonic caller-owned timestamp, in the same timeline as metric events. */
export type RenderClock = Readonly<{ nowMs: number; reducedMotion: boolean }>;
export type RenderedNode = Readonly<{
  id: string; type: HudNode['type']; rect: Rect; status: DataState['status']; accessibleText: string;
}>;
