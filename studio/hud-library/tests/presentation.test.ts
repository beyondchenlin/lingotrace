import test from 'node:test';
import assert from 'node:assert/strict';
import { presentationOptions, pulseVisualizationForVariant, variantToNodeType } from '../presentation.ts';
import type { HudVariantId } from '../presentation.ts';
import type { BarMetric, CalendarMetric, HudMetric, InputPulseMetric, MetricUnit, NumberMetric, ProgressMetric, TargetBandMetric, TrendMetric } from '../schema.ts';
import { fixtureScene } from '../showcase/fixtures.ts';
import { batch2FixtureScene } from '../showcase/batch2-fixtures.ts';

const number = Object.values(fixtureScene('numeric').metrics)[0] as NumberMetric;
const trend = Object.values(fixtureScene('trend-line').metrics)[0] as TrendMetric;
const pulse = Object.values(fixtureScene('input-pulse').metrics)[0] as InputPulseMetric;
const progress = Object.values(fixtureScene('progress-ring').metrics)[0] as ProgressMetric;
const bar = Object.values(batch2FixtureScene('bar-chart').metrics)[0] as BarMetric;
const target = Object.values(batch2FixtureScene('target-band').metrics)[0] as TargetBandMetric;
const calendar = Object.values(batch2FixtureScene('calendar-heatmap').metrics)[0] as CalendarMetric;
const ALL_UNITS: readonly MetricUnit[] = ['count', 'words', 'graphemes', 'seconds', 'milliseconds', 'percent', 'graphemes/second', 'graphemes/minute'];
const QUANTITY_UNITS = ALL_UNITS.slice(0, 5);
const option = (metric: HudMetric, id: HudVariantId) => presentationOptions(metric).find(candidate => candidate.id === id)!;
const variants = (metric: HudMetric) => presentationOptions(metric).filter(candidate => candidate.compatible).map(candidate => candidate.id);

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test('the ten variants have stable IDs, concise labels and exact node mappings', () => {
  const mappings = [
    ['numeric', 'numeric'], ['trend-line', 'trend-line'], ['trend-bars', 'trend-bars'],
    ['pulse-wave', 'input-pulse'], ['pulse-events', 'input-pulse'],
    ['progress-ring', 'progress-ring'], ['progress-track', 'progress-track'],
    ['bar-chart', 'bar-chart'], ['target-band', 'target-band'], ['calendar-heatmap', 'calendar-heatmap'],
  ] as const;
  assert.deepEqual(presentationOptions(number).map(({ id, nodeType }) => [id, nodeType]), mappings);
  for (const [id, nodeType] of mappings) {
    assert.equal(variantToNodeType(id), nodeType);
    assert.match(option(number, id).label, /^[\u3400-\u9fff]{2,6}$/);
  }
  assert.equal(pulseVisualizationForVariant('pulse-wave'), 'wave-scan');
  assert.equal(pulseVisualizationForVariant('pulse-events'), 'event-stems');
  for (const [id] of mappings) if (id !== 'pulse-wave' && id !== 'pulse-events') assert.equal(pulseVisualizationForVariant(id), undefined);
  for (const id of ['unknown', 'audio', 'ecg', 'toString', '__proto__', 'input-pulse']) {
    assert.throws(() => variantToNodeType(id as HudVariantId), /Unknown HUD variant/);
    assert.throws(() => pulseVisualizationForVariant(id as HudVariantId), /Unknown HUD variant/);
  }
});

test('all semantic kinds are exclusive; groups, scalars and input events are never reinterpreted', () => {
  const cases: readonly (readonly [HudMetric, readonly HudVariantId[]])[] = [
    [number, ['numeric']], [trend, ['trend-line', 'trend-bars']],
    [pulse, ['pulse-wave', 'pulse-events']], [progress, ['progress-ring', 'progress-track']],
    [bar, ['bar-chart']], [target, ['target-band']], [calendar, ['calendar-heatmap']],
  ];
  for (const [metric, expected] of cases) {
    assert.deepEqual(variants(metric), expected, metric.kind);
    for (const candidate of presentationOptions(metric)) {
      assert.equal(candidate.available, expected.includes(candidate.id), `${metric.kind}: ${candidate.id}`);
      assert.equal(candidate.reason === null, candidate.available);
      if (!candidate.compatible) assert.ok(candidate.reason);
    }
  }
  assert.equal(option({ ...number, unit: 'percent', value: 70 }, 'progress-ring').compatible, false);
  assert.equal(option(bar, 'trend-line').compatible, false);
  assert.equal(option(pulse, 'trend-bars').compatible, false);
});

test('compatibility checks units as well as kinds without converting rate or percent data', () => {
  for (const unit of ALL_UNITS) {
    assert.deepEqual(variants({ ...number, unit }), ['numeric']);
    assert.deepEqual(variants({ ...trend, unit }), ['trend-line', 'trend-bars']);
    assert.deepEqual(variants({ ...target, unit }), ['target-band']);
    assert.deepEqual(variants({ ...pulse, unit }), unit === 'graphemes' ? ['pulse-wave', 'pulse-events'] : []);
    assert.deepEqual(variants({ ...progress, unit }), QUANTITY_UNITS.includes(unit) ? ['progress-ring', 'progress-track'] : []);
    assert.deepEqual(variants({ ...bar, unit }), QUANTITY_UNITS.includes(unit) ? ['bar-chart'] : []);
    assert.deepEqual(variants({ ...calendar, unit }), QUANTITY_UNITS.includes(unit) ? ['calendar-heatmap'] : []);
  }
  for (const metric of [number, trend, pulse, progress, bar, target, calendar]) {
    assert.deepEqual(variants({ ...metric, unit: 'bpm' as MetricUnit }), []);
  }
});

test('explicit error, no-data and unmeasured states retain compatibility but disable selections', () => {
  for (const metric of [number, trend, pulse, progress, bar, target, calendar]) {
    for (const changed of [
      { ...metric, state: { status: 'no-data' as const } },
      { ...metric, state: { status: 'error' as const, message: 'Unavailable' } },
      { ...metric, quality: 'unmeasured' as const },
    ]) {
      assert.deepEqual(variants(changed), variants(metric));
      assert.equal(presentationOptions(changed).some(candidate => candidate.available), false);
      assert.ok(presentationOptions(changed).every(candidate => candidate.reason !== null));
    }
    for (const changed of [
      { ...metric, state: { status: 'paused' as const, frozenAtMs: 30000 } },
      { ...metric, quality: 'estimated' as const },
    ]) assert.deepEqual(presentationOptions(changed), presentationOptions(metric));
  }
});

test('numeric known zero is available while a missing or nonfinite value is unavailable', () => {
  assert.equal(option({ ...number, value: 0 }, 'numeric').available, true);
  for (const value of [null, NaN, Infinity]) {
    const candidate = option({ ...number, value }, 'numeric');
    assert.equal(candidate.compatible, true);
    assert.equal(candidate.available, false);
  }
});

test('progress uses a supplied positive total and never implies a percentage from unknown totals', () => {
  for (const id of ['progress-ring', 'progress-track'] as const) {
    for (const denominator of [null, 0, -1, NaN, Infinity]) {
      const candidate = option({ ...progress, denominator }, id);
      assert.equal(candidate.compatible, true);
      assert.equal(candidate.available, false);
      assert.match(candidate.reason!, /总量/);
      assert.doesNotMatch(candidate.reason!, /0%|百分之零/);
    }
    for (const numerator of [null, -1, NaN]) assert.equal(option({ ...progress, numerator }, id).available, false);
    for (const numerator of [0, 18, 30]) assert.equal(option({ ...progress, numerator }, id).available, true);
    assert.equal(option({ ...progress, numerator: .2, denominator: .4 }, id).available, true);
    assert.equal(option({ ...progress, numerator: 1e308, denominator: 1e-308 }, id).available, false);
  }
});

test('trend lines preserve supplied units and bars require a truthful zero baseline', () => {
  for (const [min, max] of [[0, 6], [-6, 0], [-6, 6]]) {
    assert.equal(option({ ...trend, domain: { ...trend.domain, min, max } }, 'trend-bars').available, true);
  }
  for (const [min, max] of [[1, 6], [-6, -1]]) {
    const metric = { ...trend, domain: { ...trend.domain, min, max } };
    assert.equal(option(metric, 'trend-line').available, true);
    assert.equal(option(metric, 'trend-bars').compatible, false);
    assert.equal(option(metric, 'trend-bars').available, false);
    assert.match(option(metric, 'trend-bars').reason!, /零/);
    assert.equal(option({ ...metric, state: { status: 'no-data' } }, 'trend-bars').compatible, false);
  }
  for (const points of [
    [], trend.points.map(point => ({ ...point, value: null })),
    trend.points.map(point => ({ ...point, quality: 'unmeasured' as const })),
    trend.points.map(point => ({ ...point, state: 'missing' as const })),
    trend.points.map(point => ({ ...point, state: 'paused' as const })),
    trend.points.map(point => ({ ...point, atMs: trend.domain.endMs + 1 })),
  ]) for (const id of ['trend-line', 'trend-bars'] as const) {
    assert.equal(option({ ...trend, points }, id).compatible, true);
    assert.equal(option({ ...trend, points }, id).available, false);
  }
  assert.equal(option({ ...trend, points: [{ ...trend.points[0], value: 0 }] }, 'trend-bars').available, true);
});

test('input variants require actual positive typed or IME commits, never paste or deletion', () => {
  for (const id of ['pulse-wave', 'pulse-events'] as const) {
    assert.equal(option({ ...pulse, events: [] }, id).available, false);
    for (const source of ['paste', 'delete', 'other'] as const) {
      assert.equal(option({ ...pulse, events: [{ ...pulse.events[0], source, addedGraphemes: 3 }] }, id).available, false);
    }
    for (const source of ['typed', 'ime'] as const) {
      assert.equal(option({ ...pulse, events: [{ ...pulse.events[0], source, addedGraphemes: 0 }] }, id).available, false);
      assert.equal(option({ ...pulse, events: [{ ...pulse.events[0], source, addedGraphemes: 1 }] }, id).available, true);
    }
  }
});

test('target interval requires actual and both supplied bounds, preserving valid zero and exact goals', () => {
  for (const metric of [
    { ...target, value: null },
    { ...target, target: { min: null, max: 50 } },
    { ...target, target: { min: 20, max: null } },
    { ...target, target: { min: null, max: null } },
  ]) {
    assert.equal(option(metric, 'target-band').compatible, true);
    assert.equal(option(metric, 'target-band').available, false);
  }
  assert.equal(option({ ...target, value: 0, target: { min: 0, max: 0 } }, 'target-band').available, true);
  assert.equal(option({ ...target, value: 1e308 }, 'target-band').available, true);
});

test('group and calendar coverage preserve complete zero, partial zero and partial null as distinct facts', () => {
  for (const coverage of ['complete', 'partial', 'unknown'] as const) for (const value of [0, null]) {
    if ((coverage === 'complete' && value === null) || (coverage === 'unknown' && value === 0)) continue;
    const grouped = { ...bar, groups: bar.groups.map(group => ({ ...group, value, coverage })) };
    const dated = { ...calendar, days: calendar.days.map(day => ({ ...day, value, coverage })) };
    for (const [metric, id] of [[grouped, 'bar-chart'], [dated, 'calendar-heatmap']] as const) {
      assert.equal(option(metric, id).compatible, true);
      assert.equal(option(metric, id).available, coverage !== 'unknown');
    }
  }
  assert.equal(option({ ...bar, groups: [] }, 'bar-chart').available, false);
  assert.equal(option({ ...calendar, days: [] }, 'calendar-heatmap').available, false);
});

test('eligibility is deterministic, immutable and independent of ambient time or random values', () => {
  const metrics = freeze(structuredClone([number, trend, pulse, progress, bar, target, calendar]));
  const before = JSON.stringify(metrics);
  const expected = metrics.map(presentationOptions);
  const now = Date.now, random = Math.random;
  Date.now = () => { throw Error('Current time is forbidden'); };
  Math.random = () => { throw Error('Random values are forbidden'); };
  try {
    assert.deepEqual(metrics.map(presentationOptions), expected);
    assert.equal(JSON.stringify(metrics), before);
    for (const options of expected) {
      assert.equal(Object.isFrozen(options), true);
      assert.ok(options.every(candidate => Object.isFrozen(candidate)));
      assert.throws(() => { (options as unknown as { label: string }[])[0].label = 'Changed'; }, TypeError);
    }
  } finally {
    Date.now = now;
    Math.random = random;
  }
});
