import type { DataState, HudMetric, InputPulseMetric, RenderClock, TrendMetric, TrendPoint } from './schema.ts';
export function effectiveState(metric: HudMetric): DataState {
  if (metric.state.status === 'error' || metric.state.status === 'no-data') return metric.state;
  if (metric.quality === 'unmeasured') return { status: 'no-data', message: 'Not measured' };
  if (metric.kind === 'number' && metric.value === null) return { status: 'no-data', message: 'No value provided' };
  if (metric.kind === 'progress' && (metric.numerator === null || metric.denominator === null || metric.denominator === 0)) {
    return { status: 'no-data', message: 'Total not provided' };
  }
  if (metric.kind === 'trend' && !metric.points.some(p => p.value !== null && p.quality !== 'unmeasured' && p.atMs >= metric.domain.startMs && p.atMs <= metric.domain.endMs && (!p.state || p.state === 'active'))) {
    return { status: 'no-data', message: 'No observations' };
  }
  if (metric.kind === 'input-pulse' && metric.events.length === 0) return { status: 'no-data', message: 'Waiting for input' };
  if (metric.kind === 'target-band' && (metric.value === null || metric.target.min === null || metric.target.max === null)) return { status: 'no-data', message: metric.value === null ? 'Actual value not provided' : 'Target interval not provided' };
  if (metric.kind === 'bar' && !metric.groups.some(g => g.coverage !== 'unknown')) return { status: 'no-data', message: 'No observed group quantities' };
  if (metric.kind === 'calendar' && !metric.days.some(d => d.coverage !== 'unknown')) return { status: 'no-data', message: 'No observed calendar quantities' };
  return metric.state;
}
export function trendSegments(metric: TrendMetric, maxGapMs: number): readonly (readonly TrendPoint[])[] {
  const segments: TrendPoint[][] = []; let segment: TrendPoint[] = [];
  const finish = () => { if (segment.length) segments.push(segment); segment = []; };
  for (const point of metric.points) {
    if (point.value === null || point.quality === 'unmeasured' || point.state === 'missing' || point.state === 'paused' || point.atMs < metric.domain.startMs || point.atMs > metric.domain.endMs) { finish(); continue; }
    if (segment.length && point.atMs - segment[segment.length - 1].atMs > maxGapMs) finish();
    segment.push(point);
  }
  finish(); return segments;
}
export function pulseReferenceTime(metric: InputPulseMetric, clock: RenderClock, motion: 'subtle' | 'none'): number {
  if (metric.state.status === 'paused') return metric.state.frozenAtMs;
  if (clock.reducedMotion || motion === 'none') return metric.events.reduce((latest, e) => e.atMs <= clock.nowMs && (e.source === 'typed' || e.source === 'ime') && e.addedGraphemes > 0 ? Math.max(latest, e.atMs) : latest, 0);
  return clock.nowMs;
}
export function eligiblePulseEvents(metric: InputPulseMetric, nowMs: number, windowMs: number) {
  return metric.events.filter(e => (e.source === 'typed' || e.source === 'ime') && e.addedGraphemes > 0 && e.atMs <= nowMs && e.atMs >= nowMs - windowMs);
}
export function formatNumber(value: number, precision: number): string {
  // Explicit locale-independent formatting keeps preview/export text stable.
  return value.toFixed(precision).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A compact deterministic pulse kernel. Amplitude is decorative, never a measurement. */
export function inputWaveKernel(ageMs: number): number {
  const knots = [[0,0],[50,-.12],[95,0],[145,1],[195,-.42],[265,.12],[390,0]] as const;
  if (ageMs < 0 || ageMs > 390) return 0;
  for (let i=1;i<knots.length;i++) if(ageMs<=knots[i][0]) { const [x0,y0]=knots[i-1], [x1,y1]=knots[i]; return y0+(y1-y0)*(ageMs-x0)/(x1-x0); }
  return 0;
}
export function inputWaveSamples(metric: InputPulseMetric, nowMs: number, windowMs: number, samples=480): readonly (readonly [number,number])[] {
  if (!Number.isInteger(samples) || samples < 2 || samples > 4096) throw new RangeError('wave samples must be within 2..4096');
  const events=eligiblePulseEvents(metric,nowMs,windowMs+390);
  return Array.from({length:samples},(_,i)=> {
    const at=nowMs-windowMs+i/(samples-1)*windowMs;
    const amplitude=events.reduce((sum,e)=>sum+inputWaveKernel(at-e.atMs)*Math.min(1,.62+Math.log2(e.addedGraphemes+1)*.12),0);
    return [at,Math.max(-1,Math.min(1,amplitude))] as const;
  });
}

/** Preserve explicit quantities without rounding a positive supplied denominator to zero. */
export function formatSuppliedNumber(value: number): string {
  const [integer, fraction] = value.toString().split('.');
  if(value.toString().includes('e'))return value.toString();
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')+(fraction===undefined?'':'.'+fraction);
}
