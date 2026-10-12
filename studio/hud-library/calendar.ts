/** A Gregorian civil date, without a clock time or timezone. */
export type CivilDate = Readonly<{ year: number; month: number; day: number }>;
export type WeekStartsOn = 'monday' | 'sunday';
export type CalendarCell = Readonly<{ date: string; column: number; row: number }>;

const MIN_YEAR = 1900;
const MAX_YEAR = 2199;
const MAX_CALENDAR_DAYS = 112;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month - 1];
}

function assertCivilDate(value: CivilDate): void {
  if (!value || !Number.isInteger(value.year) || value.year < MIN_YEAR || value.year > MAX_YEAR ||
      !Number.isInteger(value.month) || value.month < 1 || value.month > 12 ||
      !Number.isInteger(value.day) || value.day < 1 || value.day > daysInMonth(value.year, value.month)) {
    throw new RangeError('Date must be a real Gregorian date within 1900-01-01..2199-12-31');
  }
}

/** Parse only canonical, complete YYYY-MM-DD dates in the supported range. */
export function parseIsoDate(value: string): CivilDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('Date must use the exact YYYY-MM-DD format');
  }
  const date = { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)), day: Number(value.slice(8, 10)) };
  assertCivilDate(date);
  return date;
}

/** Format a validated civil date without normalization or locale defaults. */
export function formatIsoDate(value: CivilDate): string {
  assertCivilDate(value);
  return `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
}

// Zero-based ordinal from Gregorian 0001-01-01, which was a Monday.
function daysBeforeYear(year: number): number {
  const previous = year - 1;
  return previous * 365 + Math.floor(previous / 4) - Math.floor(previous / 100) + Math.floor(previous / 400);
}

function ordinal(date: CivilDate): number {
  let result = daysBeforeYear(date.year) + date.day - 1;
  for (let month = 1; month < date.month; month++) result += daysInMonth(date.year, month);
  return result;
}

function fromOrdinal(value: number): CivilDate {
  if (value < daysBeforeYear(MIN_YEAR) || value >= daysBeforeYear(MAX_YEAR + 1)) {
    throw new RangeError('Date arithmetic must stay within 1900-01-01..2199-12-31');
  }
  let low = MIN_YEAR;
  let high = MAX_YEAR + 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (daysBeforeYear(middle) <= value) low = middle;
    else high = middle;
  }
  let remainder = value - daysBeforeYear(low);
  let month = 1;
  while (remainder >= daysInMonth(low, month)) {
    remainder -= daysInMonth(low, month);
    month++;
  }
  return { year: low, month, day: remainder + 1 };
}

export function addCalendarDays(value: string, delta: number): string {
  const date = parseIsoDate(value);
  if (!Number.isSafeInteger(delta)) throw new RangeError('Calendar-day delta must be a safe integer');
  return formatIsoDate(fromOrdinal(ordinal(date) + delta));
}

/** Signed difference: the number of civil-day steps from start to end. */
export function daysBetween(start: string, end: string): number {
  return ordinal(parseIsoDate(end)) - ordinal(parseIsoDate(start));
}

function assertWeekStartsOn(value: WeekStartsOn): void {
  if (value !== 'monday' && value !== 'sunday') {
    throw new RangeError('Week must start on monday or sunday');
  }
}

export function weekdayIndex(value: string, weekStartsOn: WeekStartsOn): number {
  assertWeekStartsOn(weekStartsOn);
  return (ordinal(parseIsoDate(value)) + (weekStartsOn === 'sunday' ? 1 : 0)) % 7;
}

/**
 * Inclusive dates in a seven-row calendar. Columns are week offsets and rows
 * are weekday indices. Leading/trailing padding never creates synthetic dates.
 */
export function calendarCells(startDate: string, endDate: string, weekStartsOn: WeekStartsOn): readonly CalendarCell[] {
  assertWeekStartsOn(weekStartsOn);
  const start = ordinal(parseIsoDate(startDate));
  const end = ordinal(parseIsoDate(endDate));
  const length = end - start + 1;
  if (length < 1 || length > MAX_CALENDAR_DAYS) {
    throw new RangeError('Calendar window must contain 1..112 inclusive days in chronological order');
  }
  const offset = (start + (weekStartsOn === 'sunday' ? 1 : 0)) % 7;
  return Array.from({ length }, (_, index) => ({
    date: formatIsoDate(fromOrdinal(start + index)),
    column: Math.floor((offset + index) / 7),
    row: (offset + index) % 7,
  }));
}
