import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listPracticeDays,
  MAX_PRACTICE_CALENDAR_DAYS,
  MAX_PRACTICE_INTERVAL_MS,
  practiceDayKey,
  splitPracticeInterval,
  validatePracticeTimeZone,
  type PracticeDaySlice,
} from './practice-calendar';

const ms = (iso: string) => Date.parse(iso);
const hour = 3_600_000;

function checkPartition(slices: PracticeDaySlice[], startMs: number, endMs: number, timeZone: string) {
  assert.equal(slices.reduce((sum, slice) => sum + slice.durationMs, 0), endMs - startMs);
  let cursor = startMs;
  for (const slice of slices) {
    assert.equal(slice.startMs, cursor);
    assert.equal(slice.durationMs, slice.endMs - slice.startMs);
    assert.ok(Number.isFinite(slice.durationMs) && slice.durationMs > 0);
    assert.equal(practiceDayKey(slice.startMs, timeZone), slice.day);
    assert.equal(practiceDayKey(slice.endMs - Math.min(1, slice.durationMs / 2), timeZone), slice.day);
    cursor = slice.endMs;
  }
  assert.equal(cursor, endMs);
}

test('calendar requires an explicit zone and uses Intl canonical identifiers', () => {
  assert.equal(validatePracticeTimeZone('UTC'), 'UTC');
  assert.equal(validatePracticeTimeZone('asia/shanghai'), 'Asia/Shanghai');
  assert.equal(validatePracticeTimeZone('US/Eastern'), validatePracticeTimeZone('America/New_York'));
  const instant = ms('2024-02-29T18:15:00.000Z');
  assert.equal(practiceDayKey(instant, 'UTC'), '2024-02-29');
  assert.equal(practiceDayKey(instant, 'Asia/Shanghai'), '2024-03-01');
  for (const zone of ['', ' ', ' UTC', 'UTC ', 'Not/A_Zone', '+05:45', undefined, null, 123]) {
    assert.throws(() => validatePracticeTimeZone(zone as string), RangeError);
    assert.throws(() => practiceDayKey(instant, zone as string), RangeError);
    assert.throws(() => splitPracticeInterval(instant, instant, zone as string), RangeError);
  }
});

test('UTC splitting preserves milliseconds across leap day with a half-open midnight end', () => {
  const start = ms('2024-02-28T23:59:59.987Z');
  const end = ms('2024-03-01T00:00:00.000Z');
  const slices = splitPracticeInterval(start, end, 'UTC');
  assert.deepEqual(slices, [
    {day: '2024-02-28', startMs: start, endMs: start + 13, durationMs: 13},
    {day: '2024-02-29', startMs: start + 13, endMs: end, durationMs: 24 * hour},
  ]);
  checkPartition(slices, start, end, 'UTC');
  assert.deepEqual(splitPracticeInterval(end, end, 'UTC'), []);
  assert.deepEqual(splitPracticeInterval(end, end + 1, 'UTC'), [
    {day: '2024-03-01', startMs: end, endMs: end + 1, durationMs: 1},
  ]);
});

test('Shanghai uses local midnight and does not create a phantom end-day slice', () => {
  const start = ms('2024-02-28T15:59:59.987Z');
  const end = ms('2024-02-29T16:00:00.000Z');
  const slices = splitPracticeInterval(start, end, 'Asia/Shanghai');
  assert.deepEqual(slices.map(slice => [slice.day, slice.durationMs]), [
    ['2024-02-28', 13], ['2024-02-29', 24 * hour],
  ]);
  checkPartition(slices, start, end, 'Asia/Shanghai');
});

for (const [name, startIso, endIso, date, hours] of [
  ['spring forward', '2024-03-10T05:00:00.000Z', '2024-03-11T04:00:00.000Z', '2024-03-10', 23],
  ['fall back', '2024-11-03T04:00:00.000Z', '2024-11-04T05:00:00.000Z', '2024-11-03', 25],
] as const) {
  test(`New York ${name} counts the actual ${hours}-hour day`, () => {
    const start = ms(startIso);
    const end = ms(endIso);
    const slices = splitPracticeInterval(start, end, 'America/New_York');
    assert.deepEqual(slices, [{day: date, startMs: start, endMs: end, durationMs: hours * hour}]);
    checkPartition(slices, start, end, 'America/New_York');
    const withEdges = splitPracticeInterval(start - 1, end + 1, 'America/New_York');
    assert.deepEqual(withEdges.map(slice => slice.durationMs), [1, hours * hour, 1]);
    checkPartition(withEdges, start - 1, end + 1, 'America/New_York');
  });
}

test('Kathmandu quarter-hour offset retains exact milliseconds around local midnight', () => {
  const start = ms('2024-02-28T18:14:59.987Z');
  const end = ms('2024-02-28T18:15:00.021Z');
  const slices = splitPracticeInterval(start, end, 'Asia/Kathmandu');
  assert.deepEqual(slices.map(slice => [slice.day, slice.durationMs]), [
    ['2024-02-28', 13], ['2024-02-29', 21],
  ]);
  checkPartition(slices, start, end, 'Asia/Kathmandu');
});

test('Lord Howe half-hour DST produces a 23.5-hour local day', () => {
  const start = ms('2024-10-05T13:30:00.000Z');
  const end = ms('2024-10-06T13:00:00.000Z');
  const slices = splitPracticeInterval(start, end, 'Australia/Lord_Howe');
  assert.deepEqual(slices.map(slice => [slice.day, slice.durationMs]), [['2024-10-06', 23.5 * hour]]);
  checkPartition(slices, start, end, 'Australia/Lord_Howe');
});

test('Samoa date-line skip omits the nonexistent local day while civil lists retain it', context => {
  try { validatePracticeTimeZone('Pacific/Apia'); } catch { context.skip('Runtime lacks Pacific/Apia'); return; }
  const start = ms('2011-12-30T09:59:59.999Z');
  const end = ms('2011-12-30T10:00:00.001Z');
  const slices = splitPracticeInterval(start, end, 'Pacific/Apia');
  assert.deepEqual(slices.map(slice => [slice.day, slice.durationMs]), [
    ['2011-12-29', 1], ['2011-12-31', 1],
  ]);
  checkPartition(slices, start, end, 'Pacific/Apia');
  assert.deepEqual(listPracticeDays('2011-12-29', '2011-12-31'), ['2011-12-29', '2011-12-30', '2011-12-31']);
});

test('historical 23-hour rollback retains the whole 47-hour Kwajalein day', () => {
  const start = ms('1969-09-29T13:00:00.000Z');
  const end = ms('1969-10-01T12:00:00.000Z');
  const slices = splitPracticeInterval(start, end, 'Pacific/Kwajalein');
  assert.deepEqual(slices.map(slice => [slice.day, slice.durationMs]), [['1969-09-30', 47 * hour]]);
  checkPartition(slices, start, end, 'Pacific/Kwajalein');
});

test('civil lists strictly validate Gregorian dates and preserve early years', () => {
  assert.deepEqual(listPracticeDays('2024-02-28', '2024-03-01'), ['2024-02-28', '2024-02-29', '2024-03-01']);
  assert.deepEqual(listPracticeDays('2023-12-31', '2024-01-01'), ['2023-12-31', '2024-01-01']);
  assert.deepEqual(listPracticeDays('0099-12-31', '0100-01-01'), ['0099-12-31', '0100-01-01']);
  assert.deepEqual(listPracticeDays('0001-01-01', '0001-01-01'), ['0001-01-01']);
  assert.equal(practiceDayKey(ms('0001-01-01T00:00:00.000Z'), 'UTC'), '0001-01-01');
  assert.equal(practiceDayKey(ms('0099-12-31T00:00:00.000Z'), 'UTC'), '0099-12-31');
  for (const date of ['', '2024-2-01', '2024-02-1', '2024-02-30', '2023-02-29', '1900-02-29',
    '2024-13-01', '2024-00-01', '2024-01-00', '2024-01-32', '0000-01-01', '10000-01-01',
    '2024-01-01T00:00:00Z', ' 2024-01-01', '2024-01-01 ', null, undefined]) {
    assert.throws(() => listPracticeDays(date as string, '2024-03-01'), RangeError);
    assert.throws(() => listPracticeDays('2024-01-01', date as string), RangeError);
  }
  assert.throws(() => listPracticeDays('2024-01-02', '2024-01-01'), RangeError);
});

test('bounded interval and inclusive civil range allow their exact limits only', () => {
  const start = ms('2024-01-01T00:00:00.000Z');
  const end = start + MAX_PRACTICE_INTERVAL_MS;
  const slices = splitPracticeInterval(start, end, 'UTC');
  assert.equal(slices.length, 366);
  checkPartition(slices, start, end, 'UTC');
  assert.equal(listPracticeDays('2024-01-01', '2025-01-01').length, MAX_PRACTICE_CALENDAR_DAYS);
  assert.throws(() => splitPracticeInterval(start, end + 1, 'UTC'), /366/);
  assert.throws(() => listPracticeDays('2024-01-01', '2025-01-02'), /367/);
});

test('invalid instants and negative durations fail explicitly', () => {
  for (const instant of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1, '0', null, undefined]) {
    assert.throws(() => practiceDayKey(instant as number, 'UTC'), RangeError);
    assert.throws(() => splitPracticeInterval(instant as number, 0, 'UTC'), RangeError);
    assert.throws(() => splitPracticeInterval(0, instant as number, 'UTC'), RangeError);
  }
  assert.throws(() => splitPracticeInterval(1, 0, 'UTC'), RangeError);
  assert.throws(() => practiceDayKey(ms('0000-01-01T00:00:00.000Z'), 'UTC'), /years/);
  assert.throws(() => practiceDayKey(ms('+010000-01-01T00:00:00.000Z'), 'UTC'), /years/);
  assert.deepEqual(splitPracticeInterval(-1, 1, 'UTC').map(slice => [slice.day, slice.durationMs]), [
    ['1969-12-31', 1], ['1970-01-01', 1],
  ]);
});

test('fractional milliseconds survive midnight and DST boundaries without rounding', () => {
  const midnight = ms('2024-03-10T05:00:00.000Z');
  const nextMidnight = ms('2024-03-11T04:00:00.000Z');
  const start = midnight - 0.25;
  const end = nextMidnight + 0.375;
  const slices = splitPracticeInterval(start, end, 'America/New_York');
  assert.deepEqual(slices.map(slice => [slice.day, slice.durationMs]), [
    ['2024-03-09', 0.25], ['2024-03-10', 23 * hour], ['2024-03-11', 0.375],
  ]);
  checkPartition(slices, start, end, 'America/New_York');
  assert.deepEqual(splitPracticeInterval(-0.25, 0.375, 'UTC'), [
    {day: '1969-12-31', startMs: -0.25, endMs: 0, durationMs: 0.25},
    {day: '1970-01-01', startMs: 0, endMs: 0.375, durationMs: 0.375},
  ]);
  assert.equal(practiceDayKey(-0.001, 'UTC'), '1969-12-31');
  assert.equal(practiceDayKey(0.001, 'UTC'), '1970-01-01');
  assert.deepEqual(splitPracticeInterval(0.125, 0.125, 'UTC'), []);
  const short = splitPracticeInterval(0.125, 0.375, 'UTC');
  assert.equal(short[0].durationMs, 0.25);
  assert.throws(() => splitPracticeInterval(start, start + MAX_PRACTICE_INTERVAL_MS + 0.25, 'UTC'), /366/);
});
