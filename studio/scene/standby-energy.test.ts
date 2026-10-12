import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sampleStandbyEnergy,
  STANDBY_ENERGY_CYCLES,
  STANDBY_ENERGY_FLOOR,
  STANDBY_ENERGY_PERIOD_MS,
  STANDBY_ENERGY_REDUCED,
} from './standby-energy';

const sample = (elapsedMs: number) => sampleStandbyEnergy(elapsedMs, 0);

test('every pulse has a low charge, accelerating attack spread over visible frames, long damped decay, and low dwell', () => {
  for (const cycle of STANDBY_ENERGY_CYCLES) {
    assert.ok(cycle.chargeMs < cycle.decayMs / 3);
    assert.ok(cycle.attackMs >= 380 && cycle.attackMs <= 470);
    assert.ok(cycle.decayMs >= 1200 && cycle.decayMs <= 1800);
    assert.ok(cycle.decayMs > cycle.attackMs * 2.8);
    assert.ok(cycle.chargePeak < 0.16);
    assert.equal(sample(cycle.startMs).phase, 'charge');
    assert.equal(sample(cycle.attackStartMs).phase, 'attack');
    assert.equal(sample(cycle.peakAtMs).phase, 'decay');
    assert.equal(sample(cycle.idleStartMs).phase, 'idle');
    assert.equal(sample(cycle.peakAtMs).energy, cycle.peak);

    const attackAt = (progress: number) => sample(cycle.attackStartMs + progress * cycle.attackMs).energy;
    const earlyRise = attackAt(0.3) - attackAt(0.1);
    const middleRise = attackAt(0.5) - attackAt(0.3);
    const lateRise = attackAt(0.7) - attackAt(0.5);
    assert.ok(earlyRise < middleRise && Math.abs(middleRise-lateRise)<1e-12);
    assert.ok(Math.abs(attackAt(0.5)-(cycle.chargePeak + (cycle.peak-cycle.chargePeak)*.5))<1e-12);

    let previous = cycle.peak;
    for (let step = 1; step <= 100; step++) {
      const energy = sample(cycle.peakAtMs + cycle.decayMs * step / 100).energy;
      assert.ok(energy <= previous, 'damping must not rebound or overshoot');
      previous = energy;
    }
    const halfRelease = sample(cycle.peakAtMs + cycle.decayMs / 2).energy;
    assert.ok(halfRelease > STANDBY_ENERGY_FLOOR);
    assert.ok(halfRelease < STANDBY_ENERGY_FLOOR + (cycle.peak - STANDBY_ENERGY_FLOOR) * 0.25);
    assert.equal(sample(cycle.idleStartMs + cycle.idleMs / 2).energy, STANDBY_ENERGY_FLOOR);
  }
});

test('cycle peaks and spacing vary subtly, and the exported bank is immutable and contiguous', () => {
  const peaks = STANDBY_ENERGY_CYCLES.map(cycle => cycle.peak);
  const spacings = STANDBY_ENERGY_CYCLES.map(cycle => cycle.endMs - cycle.startMs);
  assert.ok(new Set(peaks).size >= 4);
  assert.ok(new Set(spacings).size >= 4);
  assert.ok(Math.max(...peaks) - Math.min(...peaks) <= 0.12);
  assert.ok(Math.max(...spacings) / Math.min(...spacings) < 1.25);
  assert.ok(Object.isFrozen(STANDBY_ENERGY_CYCLES));
  let endMs = 0;
  for (const cycle of STANDBY_ENERGY_CYCLES) {
    assert.ok(Object.isFrozen(cycle));
    assert.equal(cycle.startMs, endMs);
    endMs = cycle.endMs;
  }
  assert.equal(endMs, STANDBY_ENERGY_PERIOD_MS);
});

test('all energies and phase progress remain bounded across a complete bank', () => {
  for (let time = 0; time < STANDBY_ENERGY_PERIOD_MS * 2; time += 7) {
    const result = sample(time);
    assert.ok(result.energy >= STANDBY_ENERGY_FLOOR && result.energy <= result.peak);
    assert.ok(result.peak <= 1);
    assert.ok(result.phaseProgress >= 0 && result.phaseProgress <= 1);
    assert.ok(Number.isInteger(result.cycleIndex) && result.cycleIndex >= 0);
  }
});

test('phase joins and the repeating-bank seam have continuous energy and matching near-zero slopes', () => {
  const epsilon = 0.01;
  for (const cycle of STANDBY_ENERGY_CYCLES) {
    for (const boundary of [cycle.attackStartMs, cycle.peakAtMs, cycle.idleStartMs, cycle.endMs]) {
      const before = sample(boundary - epsilon).energy;
      const at = sample(boundary).energy;
      const after = sample(boundary + epsilon).energy;
      assert.ok(Math.abs(at - before) < 0.000001);
      assert.ok(Math.abs(after - at) < 0.000001);
      assert.ok(Math.abs((at - before) / epsilon - (after - at) / epsilon) < 0.00001);
    }
  }
});

test('lagged views sample the same explicit signal without restarting their cycle', () => {
  const enteredAtMs = 4500;
  for (const lagMs of [0, 70, 130, 190, STANDBY_ENERGY_PERIOD_MS + 70]) {
    for (const elapsed of [0, 310, 440, 470, 1200, 4500, STANDBY_ENERGY_PERIOD_MS + 130]) {
      assert.deepEqual(
        sampleStandbyEnergy(enteredAtMs + elapsed + lagMs, enteredAtMs, { lagMs }),
        sample(elapsed),
      );
    }
  }
  assert.deepEqual(sampleStandbyEnergy(enteredAtMs + 50, enteredAtMs, { lagMs: 190 }), {
    energy: STANDBY_ENERGY_FLOOR, phase: 'idle', cycleIndex: -1, phaseProgress: 0, peak: STANDBY_ENERGY_FLOOR,
  });
});

test('reduced motion is static from entry and independent of cycle, elapsed time, and lag', () => {
  const expected = {
    energy: STANDBY_ENERGY_REDUCED, phase: 'idle', cycleIndex: -1, phaseProgress: 0, peak: STANDBY_ENERGY_REDUCED,
  };
  for (const nowMs of [1000, 1190, 1470, 87000, Number.MAX_VALUE]) {
    for (const lagMs of [0, 70, 190, 10000]) {
      assert.deepEqual(sampleStandbyEnergy(nowMs, 1000, { lagMs, reducedMotion: true }), expected);
    }
  }
});

test('invalid clocks, negative clocks, invalid lags, and pre-entry clocks are inert', () => {
  const inert = { energy: 0, phase: 'idle', cycleIndex: -1, phaseProgress: 0, peak: 0 };
  for (const bad of [NaN, Infinity, -Infinity, -1]) {
    assert.deepEqual(sampleStandbyEnergy(bad, 0), inert);
    assert.deepEqual(sampleStandbyEnergy(1000, bad), inert);
    assert.deepEqual(sampleStandbyEnergy(1000, 0, { lagMs: bad }), inert);
    assert.deepEqual(sampleStandbyEnergy(bad, 0, { reducedMotion: true }), inert);
  }
  assert.deepEqual(sampleStandbyEnergy(999, 1000), inert);
  assert.deepEqual(sampleStandbyEnergy(999, 1000, { reducedMotion: true }), inert);
});

test('sampling is order independent and repeats the authored bank with advancing cycle numbers', () => {
  const times = [0, 170, 370, 470, 650, 1950, 4700, 9130, STANDBY_ENERGY_PERIOD_MS - 1];
  const expected = times.map(sample);
  for (const time of [...times].reverse()) sample(time);
  assert.deepEqual(times.map(sample), expected);
  times.forEach((time, index) => {
    const repeated = sample(time + STANDBY_ENERGY_PERIOD_MS * 100);
    assert.deepEqual(repeated, {
      ...expected[index],
      cycleIndex: expected[index].cycleIndex + STANDBY_ENERGY_CYCLES.length * 100,
    });
  });
});

test('years of uptime and the largest finite clock remain finite with bounded lookup work', () => {
  for (const time of [365 * 24 * 60 * 60 * 1000, 1e15, Number.MAX_SAFE_INTEGER, 1e100, Number.MAX_VALUE]) {
    const result = sample(time);
    assert.deepEqual(sample(time), result);
    assert.ok(Object.values(result).every(value => typeof value !== 'number' || Number.isFinite(value)));
    assert.ok(result.energy >= STANDBY_ENERGY_FLOOR && result.energy <= 1);
    assert.ok(result.phaseProgress >= 0 && result.phaseProgress <= 1);
    assert.ok(result.cycleIndex >= 0);
    const moduloSample = sample(time % STANDBY_ENERGY_PERIOD_MS);
    assert.deepEqual({ ...result, cycleIndex: moduloSample.cycleIndex }, moduloSample);
  }
});

test('the meaningful 10–90 percent rise spans at least 190ms, without changing peak bounds',()=>{for(const cycle of STANDBY_ENERGY_CYCLES){let t10=0,t90=0;for(let t=0;t<=cycle.attackMs;t++){const amount=(sample(cycle.attackStartMs+t).energy-cycle.chargePeak)/(cycle.peak-cycle.chargePeak);if(!t10&&amount>=.1)t10=t;if(!t90&&amount>=.9)t90=t}assert.ok(t90-t10>=190);assert.ok(t90-t10<300)}});
