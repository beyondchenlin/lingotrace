import type { DataState, HudColors, HudNode, HudTypography, MeasurementQuality, MetricSource } from '../schema.ts';
export type Paint = Readonly<{ ctx: CanvasRenderingContext2D; node: HudNode; colors: HudColors; font: HudTypography; width: number; height: number; state: DataState; quality: MeasurementQuality; source: MetricSource }>;
export function text(p: Paint, value: string, x: number, y: number, size: number, color: string, options: { align?: CanvasTextAlign; weight?: number; numeric?: boolean; maxWidth?: number } = {}) {
  const c = p.ctx; c.font = `${options.weight ?? 400} ${size}px ${options.numeric ? p.font.numericFamily : p.font.family}`;
  c.textAlign = options.align ?? 'left'; c.textBaseline = 'alphabetic';
  const outline = p.node.style?.textOutline;
  if (outline && outline.width > 0) { c.strokeStyle = outline.color; c.lineWidth = outline.width * 2; c.lineJoin = 'round'; c.strokeText(value, x, y, options.maxWidth); }
  c.fillStyle = color; c.fillText(value, x, y, options.maxWidth);
}
export function line(p: Paint, points: readonly (readonly [number, number])[], color: string, width = 1) {
  const c = p.ctx; c.beginPath(); points.forEach(([x,y], i) => i ? c.lineTo(x,y) : c.moveTo(x,y)); c.strokeStyle = color; c.lineWidth = width; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke();
}
export function header(p: Paint) {
  line(p, [[18,18],[32,18]], p.colors.accent, 2);
  text(p, p.node.label.toUpperCase(), 42, 22, p.font.labelSize, p.colors.text, { weight: 600, maxWidth: p.width - 142 });
  if (p.state.status !== 'ready' || p.source === 'fixture' || p.quality === 'estimated') {
    const label = p.state.status === 'no-data' ? 'NO DATA' : p.state.status === 'ready' ? p.source === 'fixture' ? 'FIXTURE' : 'ESTIMATED' : p.state.status.toUpperCase();
    text(p, label, p.width - 18, 22, 9, p.state.status === 'error' ? p.colors.error : p.colors.muted, { align: 'right', weight: 600 });
  }
}
export function footnote(p: Paint, value: string) { text(p, value, 18, p.height - 16, 10, p.colors.muted, { maxWidth: p.width - 36 }); }
export function empty(p: Paint) {
  const isError = p.state.status === 'error';
  text(p, isError ? '!' : '—', 18, Math.round(p.height * .6), 38, isError ? p.colors.error : p.colors.muted, { numeric: true });
  const message = 'message' in p.state ? p.state.message : undefined;
  footnote(p, message ?? (isError ? 'Data unavailable' : 'Not yet observed'));
}
export function unavailable(p: Paint) { return p.state.status === 'no-data' || p.state.status === 'error'; }
