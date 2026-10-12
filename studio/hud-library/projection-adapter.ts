import type { HudMetric, MetricBinding, RenderClock } from './schema.ts';
/** Integration boundary only. No authoritative PracticeSnapshot adapter ships in v0.1. */
export type MetricFrame = Readonly<Record<string, HudMetric>>;
export type ProjectionAdapter<Snapshot> = Readonly<{
  adapterId: string;
  /** Source ledger schema, deliberately distinct from the HUD scene schema. */
  ledgerSchemaVersion: string;
  bindings: readonly MetricBinding[];
  /** Must read an already-authoritative projection; no DOM listeners, writes, regrading or replay in paint. */
  project: (projection: Readonly<Snapshot>, context: RenderClock) => MetricFrame;
}>;
export const RESERVED_PRACTICE_BINDINGS = Object.freeze([
  {metricKey:'input.cpm.5s.v1',metricVersion:1,unit:'graphemes/minute',status:'unimplemented',requirement:'An external selector must define a measured five-second window, coverage and minutes conversion. Never bind legacy visual energy.'},
  {metricKey:'text.firstSubmission.wordMatch.v1',metricVersion:1,unit:'percent',status:'unimplemented',requirement:'An external selector must use the immutable first submission and name its existing alignment rule. Never infer proficiency.'},
  {metricKey:'practice.activeMs.v1',metricVersion:1,unit:'milliseconds',status:'unimplemented',requirement:'Use the authoritative observed activeMs projection; no hidden/offline elapsed time.'},
  {metricKey:'practice.completedAttemptCount.v1',metricVersion:1,unit:'count',status:'unimplemented',requirement:'Define practiceComplete independently of evaluationComplete and targetMet.'},
] as const);
