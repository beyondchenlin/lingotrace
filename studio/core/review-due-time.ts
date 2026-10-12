/** Explicit user-chosen wall time and its exact instant. No clock or scheduling policy. */
export interface ReviewDueTime {
  instant: string;
  localTime: string;
  timeZone: string;
  offsetMinutes: number;
}

export type ReviewDueTimeErrorCode = 'invalid-local-time' | 'invalid-time-zone' | 'invalid-due-time';
export class ReviewDueTimeError extends RangeError {
  readonly code: ReviewDueTimeErrorCode;
  constructor(code: ReviewDueTimeErrorCode, message: string) {
    super(message); this.name = 'ReviewDueTimeError'; this.code = code;
  }
}

const MINUTE_MS = 60_000;
const OFFSET_LIMIT_MINUTES = 24 * 60;
const dueKeys = ['instant', 'localTime', 'timeZone', 'offsetMinutes'] as const;
const badDue = () => new ReviewDueTimeError('invalid-due-time', '到期时间的日期、时区、UTC 偏移与保存时刻不一致，无法使用。');

function civilEpoch(year: number, month: number, day: number, hour: number, minute: number, second = 0): number {
  // Date.UTC would silently reinterpret years 0001–0099 as 1901–1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

function parseLocalTime(localTime: string): number {
  if (typeof localTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localTime)) {
    throw new ReviewDueTimeError('invalid-local-time', '请填写完整日期和时间（YYYY-MM-DDTHH:mm，精确到分钟）。');
  }
  const [year, month, day, hour, minute] = localTime.split(/[-T:]/).map(Number);
  const epoch = civilEpoch(year, month, day, hour, minute);
  const date = new Date(epoch);
  if (year < 1 || year > 9999 || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute) {
    throw new ReviewDueTimeError('invalid-local-time', '日期或时间不存在，请检查月份、日数和闰年；不会自动改成另一天。');
  }
  return epoch;
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  // Named IANA zones (including legacy path aliases) and explicit UTC only;
  // numeric offsets and ambiguous abbreviations must not impersonate a zone.
  if (typeof timeZone !== 'string' || timeZone.length > 128
    || !/^(?:UTC|[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)+)$/.test(timeZone)) {
    throw new ReviewDueTimeError('invalid-time-zone', '请使用有效 IANA 时区，例如 Asia/Shanghai、America/Los_Angeles 或 UTC。');
  }
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone, calendar: 'gregory', numberingSystem: 'latn', era: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
      minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  } catch {
    throw new ReviewDueTimeError('invalid-time-zone', '此浏览器不支持所填 IANA 时区，请检查名称或明确选择 UTC。');
  }
}

function wallEpoch(epoch: number, dateFormatter: Intl.DateTimeFormat): number {
  const parts = dateFormatter.formatToParts(epoch);
  const part = (kind: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === kind)?.value;
  const year = Number(part('year'));
  // Probes near 0001-01-01 can lie in 1 BCE even for an allowed input date.
  return civilEpoch(part('era') === 'BC' ? 1 - year : year, Number(part('month')), Number(part('day')),
    Number(part('hour')), Number(part('minute')), Number(part('second')));
}

/**
 * All exact candidates in chronological order: [] for a skipped wall time,
 * one for an ordinary time, multiple for a fold. Never silently pick an offset.
 * Malformed calendar input / unknown zones throw; a DST gap is not malformed.
 * The supported input precision is one minute, in Gregorian years 0001–9999.
 */
export function resolveReviewLocalTime(localTime: string, timeZone: string): ReviewDueTime[] {
  const localEpoch = parseLocalTime(localTime);
  const dateFormatter = formatter(timeZone);
  const offsets = new Set<number>();
  // IANA offsets lie inside ±24 hours. Probe each UTC minute in that window,
  // discovering both sides of transitions, including half-hour/day changes.
  // Deriving the offset from full seconds also preserves historical offsets
  // that were not a whole number of minutes; no rounding is performed.
  for (let minute = -OFFSET_LIMIT_MINUTES; minute <= OFFSET_LIMIT_MINUTES; minute++) {
    const epoch = localEpoch + minute * MINUTE_MS;
    offsets.add(wallEpoch(epoch, dateFormatter) - epoch);
  }
  const candidates: ReviewDueTime[] = [];
  for (const offset of offsets) {
    const epoch = localEpoch - offset;
    if (Math.abs(offset) > OFFSET_LIMIT_MINUTES * MINUTE_MS || wallEpoch(epoch, dateFormatter) !== localEpoch) continue;
    candidates.push(Object.freeze({instant: new Date(epoch).toISOString(), localTime, timeZone, offsetMinutes: offset / MINUTE_MS}));
  }
  return candidates.sort((a, b) => Date.parse(a.instant) - Date.parse(b.instant));
}

/** Validate exact plain JSON fields without reading accessors or repairing data. */
export function validateReviewDueTime(value: unknown): ReviewDueTime {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw badDue();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== dueKeys.length || keys.some(key => typeof key !== 'string' || !dueKeys.includes(key as typeof dueKeys[number]))) throw badDue();
  const data: Record<string, unknown> = Object.create(null);
  for (const key of dueKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw badDue();
    data[key] = descriptor.value;
  }
  if (typeof data.instant !== 'string' || typeof data.localTime !== 'string' || typeof data.timeZone !== 'string'
    || typeof data.offsetMinutes !== 'number' || !Number.isFinite(data.offsetMinutes) || Object.is(data.offsetMinutes, -0)
    || Math.abs(data.offsetMinutes) > OFFSET_LIMIT_MINUTES) throw badDue();
  const epoch = Date.parse(data.instant);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== data.instant || epoch % 1000 !== 0) throw badDue();
  const localEpoch = parseLocalTime(data.localTime);
  const actualWall = wallEpoch(epoch, formatter(data.timeZone));
  if (actualWall !== localEpoch || (localEpoch - epoch) / MINUTE_MS !== data.offsetMinutes) throw badDue();
  // Fresh frozen value: caller mutation cannot change a validated time later.
  return Object.freeze({instant: data.instant, localTime: data.localTime, timeZone: data.timeZone, offsetMinutes: data.offsetMinutes});
}

/** Human-readable stored wall clock, zone and its actual offset; never host-zone conversion. */
export function formatReviewDueTime(value: ReviewDueTime): string {
  const due = validateReviewDueTime(value);
  const seconds = Math.round(Math.abs(due.offsetMinutes) * 60);
  const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor(seconds % 3600 / 60)).padStart(2, '0');
  const secondPart = seconds % 60 ? `:${String(seconds % 60).padStart(2, '0')}` : '';
  return `${due.localTime.replace('T', ' ')} · ${due.timeZone} · UTC${due.offsetMinutes < 0 ? '-' : '+'}${hours}:${minutes}${secondPart}`;
}
