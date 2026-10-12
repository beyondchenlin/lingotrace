import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eventBars, MAX_EVENT_BARS, monotoneCurve,
  type CubicTraceSegment, type TraceInputEvent, type TracePoint,
} from './hud-traces';

function sample(segment: CubicTraceSegment, t: number): TracePoint {
  const u = 1 - t;
  const coordinate = (key: 'x' | 'y') => u ** 3 * segment.from[key]
    + 3 * u * u * t * segment.c1[key] + 3 * u * t * t * segment.c2[key]
    + t ** 3 * segment.to[key];
  return { x: coordinate('x'), y: coordinate('y') };
}

const input = (eventId: string, atMs: number, added = 1, source = 'typed'): TraceInputEvent =>
  ({ eventId, atMs, added, source });

test('curves preserve every exact measured endpoint without extending the domain', () => {
  const points = [{ x: 0.25, y: 4 }, { x: 2.5, y: 8 }, { x: 3, y: 3 }, { x: 8, y: 9 }];
  const commands = monotoneCurve(points);
  assert.equal(commands.length, points.length - 1);
  commands.forEach((command, index) => {
    assert.deepEqual(command.from, points[index]);
    assert.deepEqual(command.to, points[index + 1]);
    assert.deepEqual(sample(command, 0), points[index]);
    assert.deepEqual(sample(command, 1), points[index + 1]);
  });
});

test('uneven rising, falling, flat, and turning data stay within each pair of observations', () => {
  const fixtures = [
    [0, 0, 0, 0], [0, 0.001, 1000, 1000.001], [100, 2, 1.99, -1000],
    [0, 100, 0, 100], [5, 5, -3, -3], [-10, -1, 0, 0.1],
  ];
  for (const values of fixtures) {
    const commands = monotoneCurve(values.map((y, index) => ({ x: [0, 0.1, 3, 100][index], y })));
    for (const command of commands) {
      const direction = Math.sign(command.to.y - command.from.y);
      let previous = command.from;
      for (let step = 1; step <= 100; step++) {
        const point = sample(command, step / 100);
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
        assert.ok(point.x >= previous.x - 1e-10);
        assert.ok(point.y >= Math.min(command.from.y, command.to.y) - 1e-10);
        assert.ok(point.y <= Math.max(command.from.y, command.to.y) + 1e-10);
        assert.ok((point.y - previous.y) * direction >= -1e-10);
        previous = point;
      }
    }
  }
});

test('cubic joins retain the same derivative and flatten measured turning points', () => {
  const commands = monotoneCurve([
    { x: 0, y: 1 }, { x: 1, y: 3 }, { x: 4, y: 6 }, { x: 9, y: 2 },
  ]);
  for (let index = 1; index < commands.length; index++) {
    const before = commands[index - 1];
    const after = commands[index];
    const left = (before.to.y - before.c2.y) / (before.to.x - before.c2.x);
    const right = (after.c1.y - after.from.y) / (after.c1.x - after.from.x);
    assert.ok(Math.abs(left - right) < 1e-12);
  }
  assert.equal(commands[1].c2.y, 6);
  assert.equal(commands[2].c1.y, 6);
});

test('empty, single, null, and invalid observations invent no bridge or baseline', () => {
  assert.deepEqual(monotoneCurve([]), []);
  assert.deepEqual(monotoneCurve([{ x: 2, y: 4 }]), []);
  const points = [
    { x: 0, y: 1 }, { x: 1, y: 2 }, null,
    { x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: NaN },
    { x: 6, y: 5 }, { x: 7, y: 6 }, { x: Infinity, y: 8 },
    { x: 9, y: 7 }, undefined, { x: 11, y: 8 },
  ];
  assert.deepEqual(monotoneCurve(points).map(({ from, to }) => [from.x, to.x]), [[0, 1], [3, 4], [6, 7]]);
  // Time gaps are split by the caller before mapping to render coordinates.
  const splitRuns = [[{ x: 0, y: 1 }, { x: 1, y: 2 }], [{ x: 20, y: 3 }, { x: 21, y: 4 }]];
  assert.deepEqual(splitRuns.flatMap(monotoneCurve).map(({ from, to }) => [from.x, to.x]), [[0, 1], [20, 21]]);
});

test('duplicate, reversed, and overflowed intervals break safely without sorting the evidence', () => {
  const commands = monotoneCurve([
    { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 3 },
    { x: 2, y: 4 }, { x: 0, y: 5 }, { x: 1, y: 6 },
  ]);
  assert.deepEqual(commands.map(({ from, to }) => [from, to]), [
    [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    [{ x: 1, y: 3 }, { x: 2, y: 4 }],
    [{ x: 0, y: 5 }, { x: 1, y: 6 }],
  ]);
  assert.deepEqual(monotoneCurve([{ x: -1e308, y: 0 }, { x: 1e308, y: 1 }]), []);
  assert.deepEqual(monotoneCurve([{ x: 0, y: -1e308 }, { x: 1, y: 1e308 }]), []);
  assert.deepEqual(monotoneCurve([{ x: 0, y: 0 }, { x: Number.MIN_VALUE, y: 1 }]), []);
});

test('curve construction accepts frozen data and exposes independent endpoint values', () => {
  const points = Object.freeze([Object.freeze({ x: 0, y: 0 }), Object.freeze({ x: 3, y: 3 })]);
  const before = JSON.stringify(points);
  const [command] = monotoneCurve(points);
  assert.equal(JSON.stringify(points), before);
  assert.notEqual(command.from, points[0]);
  assert.notEqual(command.to, points[1]);
  assert.deepEqual(command.c1, { x: 1, y: 1 });
  assert.deepEqual(command.c2, { x: 2, y: 2 });
});

test('event bars retain only actual committed typed/IME timestamps and stable time order', () => {
  const events = [
    input('latest', 10000, 3), input('first-tie', 5000), input('ime-tie', 5000, 2, 'ime'),
    input('edge', 0), input('future', 10001), input('paste', 6000, 20, 'paste'),
    input('unknown', 6000, 2, 'composition'), input('empty', 6000, 0),
  ];
  const bars = eventBars(events, 10000);
  assert.deepEqual(bars.map(bar => [bar.id, bar.ageMs, bar.position]), [
    ['edge', 10000, 0], ['first-tie', 5000, 0.5], ['ime-tie', 5000, 0.5], ['latest', 0, 1],
  ]);
  assert.ok(bars[2].amplitude > bars[1].amplitude);
  assert.ok(bars[3].amplitude > bars[2].amplitude);
});

test('bars move smoothly every 16 ms while identity, timestamp, and count-based amplitude stay fixed', () => {
  const events = Object.freeze([Object.freeze(input('typed', 9000, 2))]);
  let previous = eventBars(events, 10000)[0];
  for (let nowMs = 10016; nowMs <= 10512; nowMs += 16) {
    const current = eventBars(events, nowMs)[0];
    assert.equal(current.id, 'typed');
    assert.equal(current.ageMs, nowMs - 9000);
    assert.equal(current.amplitude, previous.amplitude);
    assert.ok(Math.abs(previous.position - current.position - 0.0016) < 1e-12);
    // At a 288 px drawing width the step is 0.4608 px, never rounded to pixels.
    assert.ok(Math.abs((previous.position - current.position) * 288 - 0.4608) < 1e-10);
    previous = current;
  }
  assert.deepEqual(events, [input('typed', 9000, 2)]);
});

test('invalid clocks, counts, events, and expired history produce no synthetic activity', () => {
  for (const nowMs of [NaN, Infinity, -Infinity, -1]) assert.deepEqual(eventBars([input('a', 0)], nowMs), []);
  for (const windowMs of [NaN, Infinity, -Infinity, -1, 0]) assert.deepEqual(eventBars([input('a', 0)], 1, windowMs), []);
  assert.deepEqual(eventBars([
    null, undefined, input('', 1), input('expired', 0), input('negative-time', -1),
    input('nan-time', NaN), input('infinite-time', Infinity),
    ...[NaN, Infinity, -1, 0, 0.5, Number.MAX_VALUE].map((added, i) => input(`bad-${i}`, 5000, added)),
  ], 10001), []);
  const [maximum] = eventBars([input('large', 1, Number.MAX_SAFE_INTEGER)], 1);
  assert.equal(maximum.amplitude, 1);
});

test('large unordered readonly histories retain the newest 256 events with bounded finite geometry', () => {
  const events = Object.freeze(Array.from({ length: 20000 }, (_, index) =>
    Object.freeze(input(`event-${19999 - index}`, 19999 - index, index % 17 + 1))));
  const bars = eventBars(events, 20000, 30000);
  assert.equal(bars.length, MAX_EVENT_BARS);
  assert.equal(bars[0].id, `event-${20000 - MAX_EVENT_BARS}`);
  assert.equal(bars.at(-1)?.id, 'event-19999');
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index];
    assert.ok(bar.position >= 0 && bar.position <= 1);
    assert.ok(bar.amplitude > 0 && bar.amplitude <= 1);
    assert.ok(Number.isFinite(bar.ageMs));
    if (index) assert.ok(bar.ageMs <= bars[index - 1].ageMs);
  }
  assert.equal(events.length, 20000);
  assert.equal(events[0].eventId, 'event-19999');
  assert.equal(events.at(-1)?.eventId, 'event-0');
});
