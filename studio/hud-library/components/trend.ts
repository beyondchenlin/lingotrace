import type { TrendMetric, TrendNode } from '../schema.ts';
import { formatNumber, trendSegments } from '../metrics.ts';
import { empty, footnote, line, text, unavailable, type Paint } from './shared.ts';
export function paintTrend(p: Paint, node: TrendNode, metric: TrendMetric) {
  if (unavailable(p)) { empty(p); return; }
  const c = p.ctx, d = metric.domain; const left = 34, right = p.width - 18, top = 53, bottom = p.height - 51;
  for (let step = 0; step <= 2; step++) {
    const y = top + (bottom - top) * step / 2;
    c.setLineDash(step === 2 ? [] : [2, 6]); line(p, [[left,y],[right,y]], p.colors.track); c.setLineDash([]);
  }
  text(p, formatNumber(d.max,0), 24, top+3, 9, p.colors.muted, { align:'right', numeric:true });
  text(p, formatNumber(d.min,0), 24, bottom+3, 9, p.colors.muted, { align:'right', numeric:true });
  const xy = (at: number, value: number): [number,number] => [left+(at-d.startMs)/(d.endMs-d.startMs)*(right-left),bottom-(Math.max(d.min,Math.min(d.max,value))-d.min)/(d.max-d.min)*(bottom-top)];
  for (const segment of trendSegments(metric,node.maxGapMs)) {
    const pts = segment.map(s => xy(s.atMs,s.value!));
    line(p,pts,p.colors.accent,2);
    // Actual observation dots, never interpolated or invented observations.
    for (const [x,y] of pts) { c.beginPath(); c.arc(x,y,2.2,0,Math.PI*2); c.fillStyle=p.colors.accent; c.fill(); }
  }
  text(p, `${(d.startMs / 1000).toFixed(0)}s`, left, bottom+18, 9, p.colors.muted, { numeric:true });
  text(p, `${(d.endMs / 1000).toFixed(0)}s`, right, bottom+18, 9, p.colors.muted, { numeric:true, align:'right' });
  footnote(p, node.description ?? `${metric.unit} · missing and paused intervals stay open`);
}
