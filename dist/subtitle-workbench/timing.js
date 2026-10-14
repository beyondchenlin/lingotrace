/** Local millisecond controls only; no claim of sample- or frame-accurate seeking. */
export const TIMING_STEPS = Object.freeze([1, 10, 100]);
export function parseTimingSeconds(value) {
  if (typeof value !== 'string' || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
export function timingRange(start, end, duration) {
  const range = { start: parseTimingSeconds(start), end: parseTimingSeconds(end) };
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60) return { range, error: '原片尚未提供可核验时长，暂不能保存或试听边界。' };
  if (range.start === null || range.end === null) return { range, error: '请输入有效的非负秒数，不能留空。' };
  if (range.end <= range.start) return { range, error: '结束时间必须晚于开始时间。' };
  if (range.start > duration || range.end > duration) return { range, error: `时间不能超过本次可用原片时长 ${duration} 秒。` };
  return { range, error: '' };
}
export function nudgeTiming(value, direction, stepMs, duration) {
  const current = parseTimingSeconds(value);
  if (current === null || !TIMING_STEPS.includes(stepMs) || ![-1, 1].includes(direction) || !Number.isFinite(duration) || duration <= 0) return null;
  const next = Math.round((current + direction * stepMs / 1000) * 1e9) / 1e9;
  return next >= 0 && next <= duration ? String(next) : null;
}
export function boundaryPreview(range, boundary, duration) {
  const checked = timingRange(String(range.start), String(range.end), duration);
  if (checked.error || !['start', 'end', 'cue'].includes(boundary)) return null;
  if (boundary === 'cue') return checked.range;
  const center = range[boundary];
  return { start: Math.max(0, center - 0.5), end: Math.min(duration, center + 0.5) };
}
// Deliberately bound to the dedicated pad itself, never document/window or children.
export function timingShortcut(event, pad) {
  if (event.target !== pad || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.key === 'ArrowLeft') return -1;
  if (event.key === 'ArrowRight') return 1;
  if (event.key === ' ') return event.repeat ? 'hold' : 'play';
  return null;
}
