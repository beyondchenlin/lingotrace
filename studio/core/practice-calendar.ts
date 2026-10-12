/** Explicit-time-zone calendar projection. Nothing here reads a clock or storage. */
const CIVIL_DAY_MS = 86_400_000;
const OFFSET_SCAN_MS = 3_600_000;
export const MAX_PRACTICE_INTERVAL_MS = 366 * CIVIL_DAY_MS;
export const MAX_PRACTICE_CALENDAR_DAYS = 367;

export interface PracticeDaySlice {
  day: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

/** Validate the caller's zone, returning the identifier canonicalized by Intl. */
export function validatePracticeTimeZone(timeZone: string): string {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.trim() !== timeZone || /^[+-]/.test(timeZone)) {
    throw new RangeError('An explicit valid IANA time zone is required');
  }
  try {
    return new Intl.DateTimeFormat('en-US', {timeZone}).resolvedOptions().timeZone;
  } catch {
    throw new RangeError('An explicit valid IANA time zone is required');
  }
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: validatePracticeTimeZone(timeZone),
    calendar: 'gregory',
    numberingSystem: 'latn',
    era: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}

function validateInstant(epochMs: number): void {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs) || Math.abs(epochMs) > 8_640_000_000_000_000) {
    throw new RangeError('Practice instants must be finite epoch milliseconds in the Date range');
  }
}

function civilEpoch(year: number, month: number, day: number): number {
  // Date.UTC maps years 0–99 to 1900–1999; setUTCFullYear does not.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function key(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function localParts(epochMs: number, dateFormatter: Intl.DateTimeFormat) {
  // Intl/Date truncates fractional timestamps toward zero. Floor first so a
  // fraction immediately before the Unix epoch still belongs to December 31.
  const wholeMs = Math.floor(epochMs);
  const parts = dateFormatter.formatToParts(wholeMs);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value;
  const year = Number(part('year'));
  const month = Number(part('month'));
  const day = Number(part('day'));
  if (part('era') !== 'AD' || !Number.isInteger(year) || year < 1 || year > 9999) {
    throw new RangeError('Practice calendar dates must have years 0001 through 9999');
  }
  const dayStart = civilEpoch(year, month, day);
  const milliseconds = ((wholeMs % 1000) + 1000) % 1000;
  const localMs = dayStart + Number(part('hour')) * 3_600_000 + Number(part('minute')) * 60_000
    + Number(part('second')) * 1000 + milliseconds;
  return {day: key(year, month, day), dayStart, offsetMs: localMs - wholeMs};
}

/** Gregorian YYYY-MM-DD in the explicit zone, independent of the host locale. */
export function practiceDayKey(epochMs: number, timeZone: string): string {
  validateInstant(epochMs);
  return localParts(epochMs, formatter(timeZone)).day;
}

/**
 * Partition [startMs, endMs) at local date changes, preserving fractional ms.
 * Slices are chronological; historical backward date changes can repeat a key.
 * A civil midnight is projected using the current offset, then any intervening
 * IANA offset transition is found to the millisecond. Hourly offset probes also
 * catch rollbacks whose endpoints have the same date. No local day is assumed
 * to last 24 hours (CIVIL_DAY_MS is only arithmetic on the UTC civil calendar).
 */
export function splitPracticeInterval(startMs: number, endMs: number, timeZone: string): PracticeDaySlice[] {
  validateInstant(startMs);
  validateInstant(endMs);
  const durationMs = endMs - startMs;
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > MAX_PRACTICE_INTERVAL_MS) {
    throw new RangeError('Practice intervals must be ordered and at most 366 elapsed days');
  }
  const dateFormatter = formatter(timeZone);
  let current = localParts(startMs, dateFormatter);
  localParts(endMs, dateFormatter);
  if (durationMs === 0) return [];

  const slices: PracticeDaySlice[] = [];
  let cursor = startMs;
  let sliceStart = startMs;
  let sliceDay = current.day;
  while (cursor < endMs) {
    const projectedMidnight = current.dayStart + CIVIL_DAY_MS - current.offsetMs;
    let nextMs = Math.min(endMs, cursor + OFFSET_SCAN_MS, projectedMidnight);
    let next = localParts(nextMs, dateFormatter);
    if (next.offsetMs !== current.offsetMs) {
      // IANA transitions are isolated within the hourly probe. Date equality is
      // not a valid transition predicate: a rollback can repeat the same date.
      let low = Math.floor(cursor);
      let high = Math.floor(nextMs);
      while (high - low > 1) {
        const middle = low + Math.floor((high - low) / 2);
        if (localParts(middle, dateFormatter).offsetMs === current.offsetMs) low = middle;
        else high = middle;
      }
      nextMs = high;
      next = localParts(nextMs, dateFormatter);
    }
    if (next.day !== sliceDay && nextMs < endMs) {
      slices.push({day: sliceDay, startMs: sliceStart, endMs: nextMs, durationMs: nextMs - sliceStart});
      sliceStart = nextMs;
      sliceDay = next.day;
    }
    cursor = nextMs;
    current = next;
  }
  slices.push({day: sliceDay, startMs: sliceStart, endMs, durationMs: endMs - sliceStart});
  return slices;
}

function parseCivilDate(value: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('Practice dates must be strict YYYY-MM-DD calendar dates');
  }
  const [year, month, day] = value.split('-').map(Number);
  const epochMs = civilEpoch(year, month, day);
  const date = new Date(epochMs);
  if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new RangeError('Practice dates must be valid Gregorian dates in years 0001 through 9999');
  }
  return epochMs;
}

/** Inclusive civil date labels, including labels skipped by a particular zone. */
export function listPracticeDays(fromDate: string, toDateInclusive: string): string[] {
  const fromMs = parseCivilDate(fromDate);
  const toMs = parseCivilDate(toDateInclusive);
  const count = (toMs - fromMs) / CIVIL_DAY_MS + 1;
  if (count < 1 || count > MAX_PRACTICE_CALENDAR_DAYS) {
    throw new RangeError('Practice date ranges must be ordered and contain at most 367 days');
  }
  return Array.from({length: count}, (_, index) => {
    const date = new Date(fromMs + index * CIVIL_DAY_MS);
    return key(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  });
}
