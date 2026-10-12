import test from 'node:test';
import assert from 'node:assert/strict';
import { knownCueMarkers, mediaShortcut, timelineMotion, type TimelineCue } from './transparent-timeline';
import { sampleStandbyEnergy, STANDBY_ENERGY_CYCLES, STANDBY_ENERGY_FLOOR, STANDBY_ENERGY_PERIOD_MS } from './standby-energy';

test('markers preserve only actual bound cue times and their original indices', () => {
  const cues: readonly TimelineCue[] = Object.freeze([
    Object.freeze({ id: 'opening', start: 0, end: 2 }),
    Object.freeze({ id: 'unknown' }),
    Object.freeze({ id: 'later', start: 7.25, end: 9 }),
    Object.freeze({ id: 'middle', start: 4, end: 6 }),
  ]);
  const before = JSON.stringify(cues);
  assert.deepEqual(knownCueMarkers(cues, 10, true), [
    { cueIndex: 0, id: 'opening', start: 0, ratio: 0 },
    { cueIndex: 2, id: 'later', start: 7.25, ratio: 0.725 },
    { cueIndex: 3, id: 'middle', start: 4, ratio: 0.4 },
  ]);
  assert.equal(JSON.stringify(cues), before);
});

test('unknown, non-finite and nonpositive duration never yield cue markers', () => {
  const cues = [{ id: 'real', start: 1, end: 2 }];
  for (const duration of [undefined, null, NaN, Infinity, -Infinity, 0, -10]) {
    assert.deepEqual(knownCueMarkers(cues, duration, true), []);
  }
  assert.deepEqual(knownCueMarkers(cues, 10, false), []);
  assert.deepEqual(knownCueMarkers([], 10, true), []);
});

test('missing, impossible and out-of-media cue timings are omitted, never distributed evenly', () => {
  const timings = [
    {}, { start: null, end: 2 }, { start: 0, end: undefined },
    { start: NaN, end: 2 }, { start: 1, end: Infinity },
    { start: -1, end: 2 }, { start: 2, end: 2 }, { start: 3, end: 2 },
    { start: 9, end: 11 }, { start: 10.0001, end: 10.0002 },
  ];
  const cues = timings.map((timing, index) => ({ id: `unknown-${index}`, ...timing }));
  assert.deepEqual(knownCueMarkers(cues, 10, true), []);
});

test('only a small end-time rounding tolerance is allowed without changing the start', () => {
  assert.deepEqual(knownCueMarkers([
    { id: 'rounded', start: 9.75, end: 10.0005 },
    { id: 'outside', start: 9.75, end: 10.002 },
  ], 10, true), [{ cueIndex: 0, id: 'rounded', start: 9.75, ratio: 0.975 }]);
});

test('decorative progress follows each shared fast attack and slow release 190 ms later', () => {
  const frame = (elapsed: number) => timelineMotion(1000 + elapsed, 1000, false, true, false);
  assert.deepEqual(frame(0), { progressFraction: 0, playOffsetPx: 0 });
  for (const cycle of STANDBY_ENERGY_CYCLES) {
    const charge = frame(cycle.attackStartMs + 190);
    const peak = frame(cycle.peakAtMs + 190);
    const retreat = frame(cycle.peakAtMs + cycle.decayMs / 2 + 190);
    const idle = frame(cycle.idleStartMs + 190);
    assert.ok(charge.progressFraction > 0);
    assert.ok(peak.progressFraction > charge.progressFraction);
    assert.ok(retreat.progressFraction > 0 && retreat.progressFraction < peak.progressFraction);
    assert.ok(peak.playOffsetPx > charge.playOffsetPx && peak.playOffsetPx > retreat.playOffsetPx);
    assert.deepEqual(idle, { progressFraction: 0, playOffsetPx: 0 });
    assert.deepEqual(frame(STANDBY_ENERGY_PERIOD_MS * 1000 + cycle.peakAtMs + 190), peak);
  }
});

test('rail and play offset share the envelope clock and deterministic cycle variation', () => {
  for (let elapsed = 0; elapsed < STANDBY_ENERGY_PERIOD_MS; elapsed += 73) {
    const { energy } = sampleStandbyEnergy(elapsed, 0, { lagMs: 190 });
    const activity = Math.max(0, (energy - STANDBY_ENERGY_FLOOR) / (1 - STANDBY_ENERGY_FLOOR));
    assert.deepEqual(timelineMotion(elapsed, 0, false, true, false), {
      progressFraction: 0.028 * activity,
      playOffsetPx: 2.5 * activity,
    });
  }
  const peaks = STANDBY_ENERGY_CYCLES.map(cycle => timelineMotion(cycle.peakAtMs + 190, 0, false, true, false).progressFraction);
  assert.ok(new Set(peaks).size >= 4);
});

test('every animated sample remains small and continuous across the cycle boundary', () => {
  let last = timelineMotion(0, 0, false, true, false);
  for (let nowMs = 16; nowMs <= STANDBY_ENERGY_PERIOD_MS * 2; nowMs += 16) {
    const current = timelineMotion(nowMs, 0, false, true, false);
    assert.ok(current.progressFraction >= 0 && current.progressFraction <= 0.028);
    assert.ok(Math.abs(current.playOffsetPx) <= 2.5);
    assert.ok(Math.abs(current.progressFraction - last.progressFraction) < 0.007);
    assert.ok(Math.abs(current.playOffsetPx - last.playOffsetPx) < 0.625);
    last = current;
  }
  for (const cycle of STANDBY_ENERGY_CYCLES) {
    const boundary = cycle.endMs + 190;
    const before = timelineMotion(boundary - 0.01, 0, false, true, false);
    const after = timelineMotion(boundary + 0.01, 0, false, true, false);
    assert.ok(Math.abs(after.progressFraction - before.progressFraction) < 1e-9);
    assert.ok(Math.abs(after.playOffsetPx - before.playOffsetPx) < 1e-7);
  }
});

test('reduced motion, ended standby and any media interaction fully suppress decoration', () => {
  const stopped = { progressFraction: 0, playOffsetPx: 0 };
  for (const nowMs of [0, 1200, 2400, 86400000]) {
    assert.deepEqual(timelineMotion(nowMs, 0, true, true, false), stopped);
    assert.deepEqual(timelineMotion(nowMs, 0, false, false, false), stopped);
    assert.deepEqual(timelineMotion(nowMs, 0, false, true, true), stopped);
  }
});

test('invalid or pre-entry clocks stay inert instead of producing invalid geometry', () => {
  const stopped = { progressFraction: 0, playOffsetPx: 0 };
  for (const invalid of [NaN, Infinity, -Infinity, -1]) {
    assert.deepEqual(timelineMotion(invalid, 0, false, true, false), stopped);
    assert.deepEqual(timelineMotion(1200, invalid, false, true, false), stopped);
  }
  assert.deepEqual(timelineMotion(100, 1000, false, true, false), stopped);
});

test('only Space and horizontal arrows become media shortcuts', () => {
  const context = { editing: false, composing: false, blocked: false };
  assert.equal(mediaShortcut(' ', context), 'play');
  assert.equal(mediaShortcut('Space', context), 'play');
  assert.equal(mediaShortcut('ArrowLeft', context), 'previous');
  assert.equal(mediaShortcut('ArrowRight', context), 'next');
  for (const key of ['Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'p', 'Process', 'Unidentified']) {
    assert.equal(mediaShortcut(key, context), null);
  }
});

test('editing, IME, blocked UI and each modifier protect all media keys', () => {
  const context = { editing: false, composing: false, blocked: false };
  for (const fence of ['editing', 'composing', 'blocked', 'altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
    for (const key of [' ', 'Space', 'ArrowLeft', 'ArrowRight']) {
      assert.equal(mediaShortcut(key, { ...context, [fence]: true }), null, `${fence}: ${key}`);
    }
  }
});
