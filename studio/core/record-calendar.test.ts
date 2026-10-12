import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecordWallTime, recordCalendarLegacyDates, recordCalendarSegmentDates, recordCalendarOccurrences, recordCalendarMonth, recordCalendarSourceIdentity, type RecordCalendarRecord } from './record-calendar';
import { practiceDayKey } from './practice-calendar';
import type { LegacyHistorySession } from './legacy-history';
import type { TrainingHistorySegment } from './training-history-segment';

const record = (days: string[], source: 'legacy-full' | 'partial-segment' = 'legacy-full'): RecordCalendarRecord => ({
  key: `${source}:one`, recordId: 'one', sessionId: 'session-one', materialId: 'material', materialVersion: 'v1', identity: 'digest', days, undatedEventCount: 0,
  ...(source === 'legacy-full' ? { source, sequence: 2, updatedAt: '2026-01-01T00:00:00Z' } : { source, generation: 1, writerInstanceId: 'writer', factCount: 2 }),
});

test('wall timestamps require explicit offset, a real Gregorian date, and valid clock fields', () => {
  for (const value of [undefined, '', '2026-10-09', '2026-10-09T12:00:00', '2026-02-29T12:00:00Z', '2024-02-30T12:00:00Z',
    '2026-13-01T12:00:00Z', '2026-00-01T12:00:00Z', '2026-01-00T12:00:00Z', '0000-01-01T00:00:00Z', '2026-10-09T24:00:00Z',
    '2026-10-09T12:60:00Z', '2026-10-09T12:00:60Z', '2026-10-09T12:00:00+24:00', '2026-10-09T12:00:00+08:60',
    ' 2026-10-09T12:00:00Z', '2026-10-09 12:00:00Z']) assert.throws(() => parseRecordWallTime(value), RangeError, String(value));
  assert.equal(parseRecordWallTime('2024-02-29T00:00:00Z'), Date.parse('2024-02-29T00:00:00Z'));
  assert.equal(parseRecordWallTime('0099-01-01T00:00:00.1Z'), Date.parse('0099-01-01T00:00:00.100Z'));
  assert.equal(parseRecordWallTime('2026-10-09T08:00:00+08:00'), parseRecordWallTime('2026-10-09T00:00:00Z'));
  assert.equal(parseRecordWallTime('2026-10-08T19:00:00-0500'), parseRecordWallTime('2026-10-09T00:00:00Z'));
});

test('occurrence days cross local midnight and year boundaries only at actual facts', () => {
  const at = parseRecordWallTime('2026-01-01T00:30:00Z');
  assert.equal(practiceDayKey(at, 'America/Los_Angeles'), '2025-12-31');
  assert.equal(practiceDayKey(at, 'Asia/Shanghai'), '2026-01-01');
  const source = { snapshot: { events: [{wallTime:'2026-01-01T07:59:59.999Z'}, {wallTime:'2026-01-01T08:00:00Z'}] } } as unknown as LegacyHistorySession;
  assert.deepEqual(recordCalendarLegacyDates(source, 'America/Los_Angeles'), ['2025-12-31','2026-01-01']);
});

test('spring forward and repeated fall-back hour never infer elapsed intervals or duplicate dates', () => {
  for (const [times, day] of [
    [['2026-03-08T01:59:59-05:00', '2026-03-08T03:00:00-04:00'], '2026-03-08'],
    [['2026-11-01T01:30:00-04:00', '2026-11-01T01:30:00-05:00'], '2026-11-01'],
  ] as const) {
    const source = { facts: times.map(wallTime => ({wallTime})) } as unknown as TrainingHistorySegment;
    assert.deepEqual(recordCalendarSegmentDates(source, 'America/New_York'), [day]);
  }
});

test('full sessions and partial segments use wallTime only, never metadata, score or ON/OFF intervals', () => {
  const segment = { startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-02-28T00:00:00Z', facts: [
    {wallTime:'2026-01-30T23:59:59Z', type:'timeAdvanced', deltaMs:86_400_000},
    {wallTime:'2026-02-02T00:00:00Z', type:'timeAdvanced', deltaMs:null},
  ] } as unknown as TrainingHistorySegment;
  assert.deepEqual(recordCalendarSegmentDates(segment, 'UTC'), ['2026-01-30','2026-02-02']);
  assert.deepEqual(recordCalendarSegmentDates({...segment,facts:[]}, 'UTC'), []);
  const source = { summary: {updatedAt:'2026-10-09T00:00:00Z'}, snapshot: { createdAt:'2026-04-01T00:00:00Z', activeMs:99_999_999,
    attempts:[{wallTime:'2026-05-01T00:00:00Z'}], events:[{wallTime:'2026-06-01T00:00:00Z'}] } } as unknown as LegacyHistorySession;
  assert.deepEqual(recordCalendarLegacyDates(source, 'UTC'), ['2026-06-01']);
});

test('invalid occurrence times are counted and never replaced by guessed dates', async () => {
  let yields = 0;
  const result = await recordCalendarOccurrences(['2024-02-29T23:00:00Z','2024-02-30T23:00:00Z','2026-10-09T12:00:00','2024-02-29T23:00:00+00:00'], 'UTC', async () => { yields++; }, 2);
  assert.deepEqual(result, {days:['2024-02-29'],undatedEventCount:2}); assert.equal(yields,2);
  await assert.rejects(recordCalendarOccurrences([], 'not/a-zone', async () => {}));
});

test('month labels support leap years, cross-year edges and all-source provenance without complete or zero', () => {
  const records = [record(['2024-02-01','2024-02-29']),record(['2024-02-29'],'partial-segment')];
  const month = recordCalendarMonth(records,'2024-02');
  assert.equal(month.length,29); assert.equal(recordCalendarMonth([], '2026-02').length,28);
  assert.equal(recordCalendarMonth([], '2000-02').length,29); assert.equal(recordCalendarMonth([], '1900-02').length,28);
  assert.equal(recordCalendarMonth([], '9999-12').length,31); assert.equal(recordCalendarMonth([], '0001-01').length,31);
  assert.equal(month[0].coverage,'partial'); assert.equal(month[1].coverage,'unknown');
  assert.deepEqual(month.at(-1)?.records.map(value => value.source),['legacy-full','partial-segment']);
  assert.equal(month.some(day => Object.hasOwn(day,'value') || Object.hasOwn(day,'durationMs') || Object.hasOwn(day,'score')),false);
  for (const value of ['2026-2','2026-13','2026-00','0000-01','2026-02-01',' 2026-02']) assert.throws(() => recordCalendarMonth([],value));
});

test('exact source fingerprint detects text changes with identical metadata and ignores object key order', async () => {
  const a = {sessionId:'same',generation:1, facts:[{text:'private answer'}]} as unknown as TrainingHistorySegment;
  const b = {facts:[{text:'private answer'}],generation:1,sessionId:'same'} as unknown as TrainingHistorySegment;
  const c = {...a,facts:[{text:'changed private answer'}]} as unknown as TrainingHistorySegment;
  const digest = await recordCalendarSourceIdentity(a);
  assert.match(digest,/^[a-f0-9]{64}$/); assert.equal(digest,await recordCalendarSourceIdentity(b)); assert.notEqual(digest,await recordCalendarSourceIdentity(c));
  assert.equal(digest.includes('private'),false);
});
