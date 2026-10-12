import test from 'node:test';
import assert from 'node:assert/strict';
import {formatReviewDueTime, resolveReviewLocalTime, ReviewDueTimeError, validateReviewDueTime, type ReviewDueTime} from './review-due-time';

const utc: ReviewDueTime = {instant: '2026-10-10T12:34:00.000Z', localTime: '2026-10-10T12:34', timeZone: 'UTC', offsetMinutes: 0};
function one(localTime: string, timeZone: string): ReviewDueTime {
  const values = resolveReviewLocalTime(localTime, timeZone);
  assert.equal(values.length, 1);
  assert.deepEqual(validateReviewDueTime(values[0]), values[0]);
  return values[0];
}

test('UTC, Shanghai and LA preserve exact user clocks and complete independent-zone values', () => {
  assert.deepEqual(one(utc.localTime, 'UTC'), utc);
  const shanghai = one('2026-10-10T20:34', 'Asia/Shanghai');
  assert.equal(shanghai.instant, utc.instant); assert.equal(shanghai.offsetMinutes, 480);
  const la = one('2026-10-10T05:34', 'America/Los_Angeles');
  assert.equal(la.instant, utc.instant); assert.equal(la.offsetMinutes, -420);
  assert.equal(formatReviewDueTime(shanghai), '2026-10-10 20:34 · Asia/Shanghai · UTC+08:00');
  assert.equal(formatReviewDueTime(la), '2026-10-10 05:34 · America/Los_Angeles · UTC-07:00');
  assert.equal(formatReviewDueTime(utc), '2026-10-10 12:34 · UTC · UTC+00:00');
});

test('LA spring gap is empty, with no silent normalization to a later hour', () => {
  assert.deepEqual(resolveReviewLocalTime('2026-03-08T02:00', 'America/Los_Angeles'), []);
  assert.deepEqual(resolveReviewLocalTime('2026-03-08T02:30', 'America/Los_Angeles'), []);
  assert.deepEqual(resolveReviewLocalTime('2026-03-08T02:59', 'America/Los_Angeles'), []);
  assert.equal(one('2026-03-08T01:59', 'America/Los_Angeles').instant, '2026-03-08T09:59:00.000Z');
  assert.equal(one('2026-03-08T03:00', 'America/Los_Angeles').instant, '2026-03-08T10:00:00.000Z');
});

test('LA autumn fold returns both explicitly selectable offsets, in instant order', () => {
  const values = resolveReviewLocalTime('2026-11-01T01:30', 'America/Los_Angeles');
  assert.deepEqual(values, [
    {instant: '2026-11-01T08:30:00.000Z', localTime: '2026-11-01T01:30', timeZone: 'America/Los_Angeles', offsetMinutes: -420},
    {instant: '2026-11-01T09:30:00.000Z', localTime: '2026-11-01T01:30', timeZone: 'America/Los_Angeles', offsetMinutes: -480},
  ]);
  for (const value of values) assert.deepEqual(validateReviewDueTime(JSON.parse(JSON.stringify(value))), value);
  assert.throws(() => validateReviewDueTime({...values[0], offsetMinutes: -480}));
  assert.throws(() => validateReviewDueTime({...values[1], offsetMinutes: -420}));
});

test('non-hour offsets, half-hour folds and skipped dates are resolved without interval assumptions', () => {
  assert.equal(one('2026-10-10T12:34', 'Asia/Kathmandu').offsetMinutes, 345);
  const lordHowe = resolveReviewLocalTime('2026-04-05T01:45', 'Australia/Lord_Howe');
  assert.equal(lordHowe.length, 2);
  assert.deepEqual(lordHowe.map(value => value.offsetMinutes), [660, 630]);
  assert.equal(Date.parse(lordHowe[1].instant) - Date.parse(lordHowe[0].instant), 30 * 60_000);
  assert.deepEqual(resolveReviewLocalTime('2026-10-04T02:15', 'Australia/Lord_Howe'), []);
  assert.deepEqual(resolveReviewLocalTime('2011-12-30T12:00', 'Pacific/Apia'), []);
});

test('past choices, leap days, midnight, year boundaries and historical second offsets stay exact', () => {
  assert.equal(one('2000-02-29T00:00', 'UTC').instant, '2000-02-29T00:00:00.000Z');
  assert.equal(one('2024-02-29T23:59', 'Asia/Shanghai').instant, '2024-02-29T15:59:00.000Z');
  assert.equal(one('2026-01-01T00:00', 'Asia/Shanghai').instant, '2025-12-31T16:00:00.000Z');
  assert.equal(one('0001-01-01T00:00', 'UTC').instant, '0001-01-01T00:00:00.000Z');
  assert.equal(one('0099-12-31T23:59', 'UTC').instant, '0099-12-31T23:59:00.000Z');
  assert.equal(one('9999-12-31T23:59', 'UTC').instant, '9999-12-31T23:59:00.000Z');
  const historical = one('1900-01-01T09:00', 'Europe/Paris');
  assert.equal(historical.instant, '1900-01-01T08:50:39.000Z');
  assert.equal(historical.offsetMinutes, 9.35);
  assert.match(formatReviewDueTime(historical), /UTC\+00:09:21$/);
});

test('invalid and noncanonical calendar inputs are errors, not gaps or normalized choices', () => {
  for (const value of ['', '2026-02-29T12:00', '1900-02-29T12:00', '2026-04-31T12:00', '2026-00-01T12:00',
    '2026-13-01T12:00', '2026-01-00T12:00', '2026-01-32T12:00', '2026-10-10T24:00', '2026-10-10T12:60',
    '0000-01-01T00:00', '10000-01-01T00:00', '2026-1-1T01:02', '2026-10-10T12:34:00',
    '2026-10-10 12:34', '2026-10-10T12:34Z', '2026-10-10T12:34+08:00', ' 2026-10-10T12:34',
    null, undefined, 123, {}, new String(utc.localTime)]) {
    assert.throws(() => resolveReviewLocalTime(value as string, 'UTC'), (error: unknown) => error instanceof ReviewDueTimeError && error.code === 'invalid-local-time');
  }
});

test('zones are explicit supported IANA names or UTC, not host-zone fallback or numeric offsets', () => {
  for (const zone of ['', 'Mars/Unknown', '+08:00', 'UTC+8', 'GMT', 'PST', ' UTC', 'UTC ', 'Asia/Shanghai\n', null, undefined, {}, 480]) {
    assert.throws(() => resolveReviewLocalTime(utc.localTime, zone as string), (error: unknown) => error instanceof ReviewDueTimeError && error.code === 'invalid-time-zone');
  }
  assert.equal(one(utc.localTime, 'Etc/UTC').instant, utc.instant);
  assert.equal(one(utc.localTime, 'US/Pacific').offsetMinutes, -420);
});

test('validation rejects contradictory clocks, instants, zones and offsets without fixing any field', () => {
  for (const change of [{instant: 'invalid'}, {instant: '2026-10-10T12:34:00Z'}, {instant: '2026-10-10T12:34:00.001Z'},
    {instant: '2026-10-10T12:34:01.000Z'}, {instant: '2026-10-10T20:34:00.000+08:00'}, {instant: '2026-10-10T12:35:00.000Z'},
    {localTime: '2026-10-10T12:35'}, {localTime: '2026-02-29T12:34'}, {timeZone: 'Asia/Shanghai'},
    {offsetMinutes: 480}, {offsetMinutes: NaN}, {offsetMinutes: Infinity}, {offsetMinutes: -Infinity},
    {offsetMinutes: -0}, {offsetMinutes: 1441}, {offsetMinutes: 0.5}, {offsetMinutes: '0'}, {offsetMinutes: null}]) {
    assert.throws(() => validateReviewDueTime({...utc, ...change}));
  }
  assert.throws(() => validateReviewDueTime({instant: '2026-03-08T10:30:00.000Z', localTime: '2026-03-08T02:30', timeZone: 'America/Los_Angeles', offsetMinutes: -480}));
});

test('validation rejects accessors, prototypes, extra or missing keys and non-JSON shapes without invoking getters', () => {
  let reads = 0;
  const accessor = {...utc}; Object.defineProperty(accessor, 'instant', {enumerable: true, get() {reads++; return utc.instant;}});
  const extraAccessor = {...utc}; Object.defineProperty(extraAccessor, 'extra', {enumerable: true, get() {reads++; return 1;}});
  const hidden = {...utc}; Object.defineProperty(hidden, 'instant', {enumerable: false, value: utc.instant});
  const symbol = {...utc, [Symbol('extra')]: 1};
  const missing = {instant: utc.instant, localTime: utc.localTime, timeZone: utc.timeZone};
  for (const value of [accessor, extraAccessor, hidden, symbol, missing, {...utc, extra: false}, Object.create(utc),
    Object.assign(Object.create(null), utc), Object.assign([], utc), new Date(), null, undefined, true, 1, JSON.stringify(utc)]) {
    assert.throws(() => validateReviewDueTime(value));
  }
  assert.equal(reads, 0);
});

test('validation returns an independent frozen snapshot and formatting revalidates instead of projecting corruption', () => {
  const original = {...utc}; const captured = validateReviewDueTime(original);
  assert.notEqual(captured, original); assert.ok(Object.isFrozen(captured));
  original.instant = '2026-10-11T12:34:00.000Z'; assert.equal(captured.instant, utc.instant);
  assert.throws(() => formatReviewDueTime(original));
  const candidates = resolveReviewLocalTime(utc.localTime, utc.timeZone);
  assert.ok(Object.isFrozen(candidates[0]));
});

test('all functions ignore the runtime default timezone and do not depend on now', () => {
  const previous = process.env.TZ;
  const oldNow = Date.now;
  try {
    Date.now = () => {throw Error('Must not derive a date or interval from now');};
    for (const hostZone of ['Pacific/Honolulu', 'Asia/Tokyo', 'UTC']) {
      process.env.TZ = hostZone;
      assert.deepEqual(one(utc.localTime, 'UTC'), utc);
      assert.equal(formatReviewDueTime(utc), '2026-10-10 12:34 · UTC · UTC+00:00');
    }
  } finally {
    Date.now = oldNow;
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});
