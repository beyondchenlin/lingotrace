import type { NumberMetric, NumberNode } from '../schema.ts';
import { formatNumber } from '../metrics.ts';
import { empty, footnote, line, text, unavailable, type Paint } from './shared.ts';
export function paintNumeric(p: Paint, node: NumberNode, metric: NumberMetric) {
  if (unavailable(p)) { empty(p); return; }
  const baseline = Math.min(p.height - 54, Math.max(85, p.height * .58));
  text(p, formatNumber(metric.value!, node.precision), 18, baseline, Math.min(p.font.valueSize, p.height * .32), p.colors.text, { numeric: true, weight: 700, maxWidth: p.width - 38 });
  text(p, node.suffix ?? metric.unit, 20, baseline + 24, 11, p.colors.accent, { maxWidth: p.width - 38 });
  line(p, [[18,p.height-38],[p.width-18,p.height-38]], p.colors.track);
  line(p, [[18,p.height-38],[54,p.height-38]], p.colors.accent, 2);
  footnote(p, node.description ?? 'Supplied value · no inferred assessment');
}
