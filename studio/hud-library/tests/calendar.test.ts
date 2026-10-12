import test from 'node:test';
import assert from 'node:assert/strict';
import { addCalendarDays, calendarCells, daysBetween, formatIsoDate, parseIsoDate, weekdayIndex } from '../calendar.ts';
import type { CivilDate, WeekStartsOn } from '../calendar.ts';

test('strict civil dates parse and format without a locale or timezone', () => {
  for (const value of ['1900-01-01', '2000-02-29', '2024-02-29', '2100-02-28', '2199-12-31']) {
    assert.equal(formatIsoDate(parseIsoDate(value)), value);
  }
  assert.deepEqual(parseIsoDate('2024-03-09'), { year: 2024, month: 3, day: 9 });
  assert.equal(formatIsoDate({ year: 2024, month: 3, day: 9 }), '2024-03-09');
});

test('parsing rejects malformed, impossible, unsupported, or implicitly normalized dates', () => {
  const invalid: unknown[] = [
    '', '2024-2-01', '2024-02-1', '24-02-01', '+2024-02-01', '2024/02/01',
    ' 2024-02-01', '2024-02-01 ', '2024-02-01\n', '2024-02-01T00:00:00Z',
    '2024-00-01', '2024-13-01', '2024-01-00', '2024-01-32', '2024-04-31',
    '2024-02-30', '2023-02-29', '1900-02-29', '2100-02-29',
    '1899-12-31', '2200-01-01', '0000-01-01', '10000-01-01',
    '２０２４-０２-０１', null, undefined, 20240201,
  ];
  for (const value of invalid) assert.throws(() => parseIsoDate(value as string), RangeError, String(value));
});

test('formatting rejects invalid numeric fields instead of rounding or overflowing', () => {
  const invalid: unknown[] = [
    { year: 2024.5, month: 1, day: 1 }, { year: 2024, month: 1.5, day: 1 },
    { year: 2024, month: 1, day: 1.5 }, { year: 2024, month: 2, day: 30 },
    { year: 1900, month: 2, day: 29 }, { year: 2100, month: 2, day: 29 },
    { year: 1899, month: 12, day: 31 }, { year: 2200, month: 1, day: 1 },
    { year: 2024, month: 0, day: 1 }, { year: 2024, month: 13, day: 1 },
    { year: 2024, month: 1, day: 0 }, { year: 2024, month: 1, day: NaN },
    { year: Infinity, month: 1, day: 1 }, { year: '2024', month: 1, day: 1 }, {}, null,
  ];
  for (const value of invalid) assert.throws(() => formatIsoDate(value as CivilDate), RangeError);
});

test('day arithmetic crosses leap, month, year and Gregorian century boundaries', () => {
  const pairs = [
    ['1900-02-28', '1900-03-01'], ['1999-12-31', '2000-01-01'],
    ['2000-02-28', '2000-02-29'], ['2000-02-29', '2000-03-01'],
    ['2024-02-28', '2024-02-29'], ['2024-02-29', '2024-03-01'],
    ['2024-04-30', '2024-05-01'], ['2099-12-31', '2100-01-01'],
    ['2100-02-28', '2100-03-01'],
    // These remain one civil day even where clock time changes for daylight saving.
    ['2024-03-10', '2024-03-11'], ['2024-11-03', '2024-11-04'],
  ];
  for (const [start, end] of pairs) {
    assert.equal(addCalendarDays(start, 1), end);
    assert.equal(addCalendarDays(end, -1), start);
    assert.equal(daysBetween(start, end), 1);
    assert.equal(daysBetween(end, start), -1);
  }
  assert.equal(addCalendarDays('2024-02-29', 0), '2024-02-29');
  assert.equal(daysBetween('2024-02-29', '2024-02-29'), 0);
  assert.equal(daysBetween('1900-01-01', '2199-12-31'), 109572);
  assert.equal(addCalendarDays('1900-01-01', 109572), '2199-12-31');
  assert.equal(addCalendarDays('2199-12-31', -109572), '1900-01-01');
});

test('arithmetic rejects invalid inputs and results outside the supported years', () => {
  for (const delta of [0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
    assert.throws(() => addCalendarDays('2024-01-01', delta as number), RangeError);
  }
  assert.throws(() => addCalendarDays('1900-01-01', -1), RangeError);
  assert.throws(() => addCalendarDays('2199-12-31', 1), RangeError);
  assert.throws(() => addCalendarDays('2024-01-01', Number.MAX_SAFE_INTEGER), RangeError);
  assert.throws(() => addCalendarDays('2024-01-01', -Number.MAX_SAFE_INTEGER), RangeError);
  assert.throws(() => addCalendarDays('2023-02-29', 0), RangeError);
  assert.throws(() => daysBetween('2024-01-01', '2023-02-29'), RangeError);
  assert.throws(() => daysBetween('2023-02-29', '2024-01-01'), RangeError);
});

test('weekday indices honor explicit Monday and Sunday starts across weeks and years', () => {
  const dates = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05', '2024-01-06', '2024-01-07'];
  assert.deepEqual(dates.map(date => weekdayIndex(date, 'monday')), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(dates.map(date => weekdayIndex(date, 'sunday')), [1, 2, 3, 4, 5, 6, 0]);
  assert.equal(weekdayIndex('1900-01-01', 'monday'), 0);
  assert.equal(weekdayIndex('2000-01-01', 'monday'), 5);
  assert.equal(weekdayIndex('2023-12-31', 'sunday'), 0);
  assert.equal(weekdayIndex('2024-02-29', 'monday'), 3);
  assert.throws(() => weekdayIndex('2024-01-01', 'tuesday' as WeekStartsOn), RangeError);
  assert.throws(() => weekdayIndex('2024-02-30', 'monday'), RangeError);
});

test('calendar cells use week columns and weekday rows without synthetic padding dates', () => {
  assert.deepEqual(calendarCells('2024-02-29', '2024-03-04', 'monday'), [
    { date: '2024-02-29', column: 0, row: 3 },
    { date: '2024-03-01', column: 0, row: 4 },
    { date: '2024-03-02', column: 0, row: 5 },
    { date: '2024-03-03', column: 0, row: 6 },
    { date: '2024-03-04', column: 1, row: 0 },
  ]);
  assert.deepEqual(calendarCells('2023-12-30', '2024-01-01', 'sunday'), [
    { date: '2023-12-30', column: 0, row: 6 },
    { date: '2023-12-31', column: 1, row: 0 },
    { date: '2024-01-01', column: 1, row: 1 },
  ]);
  assert.deepEqual(calendarCells('2024-01-07', '2024-01-07', 'monday'), [
    { date: '2024-01-07', column: 0, row: 6 },
  ]);
  for (const date of ['1900-01-01', '2199-12-31']) {
    assert.deepEqual(calendarCells(date, date, 'sunday'), [{ date, column: 0, row: weekdayIndex(date, 'sunday') }]);
  }
});

test('calendar windows accept exactly 112 days and reject reversed, oversized or invalid windows', () => {
  const start = '2024-01-03';
  const cells = calendarCells(start, addCalendarDays(start, 111), 'monday');
  assert.equal(cells.length, 112);
  assert.equal(cells[0].date, start);
  assert.equal(cells[111].date, '2024-04-23');
  assert.equal(new Set(cells.map(cell => cell.date)).size, 112);
  cells.forEach((cell, index) => {
    assert.equal(cell.date, addCalendarDays(start, index));
    assert.equal(cell.column, Math.floor((index + 2) / 7));
    assert.equal(cell.row, weekdayIndex(cell.date, 'monday'));
  });
  assert.throws(() => calendarCells(start, addCalendarDays(start, 112), 'monday'), RangeError);
  assert.throws(() => calendarCells(start, '2024-01-02', 'monday'), RangeError);
  assert.throws(() => calendarCells('1900-01-01', '2199-12-31', 'monday'), RangeError);
  assert.throws(() => calendarCells('2024-02-30', '2024-03-01', 'monday'), RangeError);
  assert.throws(() => calendarCells('2024-02-28', '2024-02-30', 'monday'), RangeError);
  assert.throws(() => calendarCells(start, start, undefined as unknown as WeekStartsOn), RangeError);
});

test('all supported civil days round-trip and advance weekday indices consistently', () => {
  let offset = 0;
  let mondayIndex = 0;
  for (let year = 1900; year <= 2199; year++) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= lengths[month - 1]; day++) {
        const date = formatIsoDate({ year, month, day });
        assert.deepEqual(parseIsoDate(date), { year, month, day });
        assert.equal(addCalendarDays('1900-01-01', offset), date);
        assert.equal(daysBetween('1900-01-01', date), offset);
        assert.equal(weekdayIndex(date, 'monday'), mondayIndex);
        assert.equal(weekdayIndex(date, 'sunday'), (mondayIndex + 1) % 7);
        offset++;
        mondayIndex = (mondayIndex + 1) % 7;
      }
    }
  }
  assert.equal(offset, 109573);
});
