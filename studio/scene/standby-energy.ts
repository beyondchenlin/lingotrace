/** Presentation-only motion. The caller owns the clock and the standby lifetime. */
export type StandbyEnergyPhase = 'charge' | 'attack' | 'decay' | 'idle';

export interface StandbyEnergySample {
  energy: number;
  phase: StandbyEnergyPhase;
  /** Absolute cycle number; -1 means inactive, delayed, or reduced motion. */
  cycleIndex: number;
  phaseProgress: number;
  /** The current cycle's maximum energy. */
  peak: number;
}

export interface StandbyEnergyOptions {
  /** Delay this view of the shared envelope; never advance the clock. */
  lagMs?: number;
  reducedMotion?: boolean;
}

export interface StandbyEnergyCycle {
  readonly index: number;
  /** All timestamps are offsets within one repeating bank. */
  readonly startMs: number;
  readonly attackStartMs: number;
  readonly peakAtMs: number;
  readonly idleStartMs: number;
  readonly endMs: number;
  readonly chargeMs: number;
  readonly attackMs: number;
  readonly decayMs: number;
  readonly idleMs: number;
  readonly peak: number;
  readonly chargePeak: number;
}

export const STANDBY_ENERGY_FLOOR = 0.06;
export const STANDBY_ENERGY_REDUCED = 0.16;

// A small authored bank avoids both a metronomic loop and accumulated timers.
// Charge, accelerating attack, damped release, and low dwell are independent.
const cycleSettings = [
  [280, 420, 1480, 920, 0.86],
  [320, 400, 1580, 1110, 0.81],
  [260, 450, 1360, 870, 0.89],
  [300, 410, 1640, 1030, 0.84],
  [340, 460, 1420, 960, 0.91],
  [290, 390, 1530, 1160, 0.83],
  [310, 430, 1660, 900, 0.88],
  [270, 415, 1320, 1080, 0.82],
] as const;

/** Immutable timeline for screenshot sampling and synchronized decorations. */
export const STANDBY_ENERGY_CYCLES: readonly StandbyEnergyCycle[] = (() => {
  let startMs = 0;
  return Object.freeze(cycleSettings.map(([chargeMs, attackMs, decayMs, idleMs, peak], index) => {
    const attackStartMs = startMs + chargeMs;
    const peakAtMs = attackStartMs + attackMs;
    const idleStartMs = peakAtMs + decayMs;
    const endMs = idleStartMs + idleMs;
    const cycle = Object.freeze({
      index, startMs, attackStartMs, peakAtMs, idleStartMs, endMs,
      chargeMs, attackMs, decayMs, idleMs, peak,
      chargePeak: STANDBY_ENERGY_FLOOR + peak * 0.1,
    });
    startMs = endMs;
    return cycle;
  }));
})();

export const STANDBY_ENERGY_PERIOD_MS = STANDBY_ENERGY_CYCLES.at(-1)!.endMs;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Zero first and second derivatives at both endpoints. */
function smootherstep(value: number): number {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function idleSample(energy = 0): StandbyEnergySample {
  return { energy, phase: 'idle', cycleIndex: -1, phaseProgress: 0, peak: energy };
}

/**
 * Sample one deterministic, asymmetric standby pulse without any retained state.
 * Invalid/negative clocks and clocks before entry are inert. A lag holds the low
 * floor until its first charge; reduced motion ignores lag and stays constant.
 * Modulo plus binary search keeps cost bounded even after years of uptime.
 * At times beyond Number's integer precision, cycleIndex is approximate while
 * all fields remain finite and the sample remains deterministic.
 */
export function sampleStandbyEnergy(
  nowMs: number,
  enteredAtMs: number,
  options: StandbyEnergyOptions = {},
): StandbyEnergySample {
  const lagMs = options.lagMs ?? 0;
  if (!Number.isFinite(nowMs) || !Number.isFinite(enteredAtMs)
    || !Number.isFinite(lagMs) || nowMs < 0 || enteredAtMs < 0
    || lagMs < 0 || nowMs < enteredAtMs) {
    return idleSample();
  }
  if (options.reducedMotion) return idleSample(STANDBY_ENERGY_REDUCED);

  const elapsedMs = nowMs - enteredAtMs - lagMs;
  if (elapsedMs < 0) return idleSample(STANDBY_ENERGY_FLOOR);

  const bankMs = elapsedMs % STANDBY_ENERGY_PERIOD_MS;
  let low = 0;
  let high = STANDBY_ENERGY_CYCLES.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (bankMs < STANDBY_ENERGY_CYCLES[middle].endMs) high = middle;
    else low = middle + 1;
  }
  const cycle = STANDBY_ENERGY_CYCLES[low];
  const cycleIndex = Math.floor(elapsedMs / STANDBY_ENERGY_PERIOD_MS)
    * STANDBY_ENERGY_CYCLES.length + cycle.index;
  let phase: StandbyEnergyPhase;
  let phaseProgress: number;
  let energy: number;

  if (bankMs < cycle.attackStartMs) {
    phase = 'charge';
    phaseProgress = (bankMs - cycle.startMs) / cycle.chargeMs;
    energy = STANDBY_ENERGY_FLOOR
      + (cycle.chargePeak - STANDBY_ENERGY_FLOOR) * smootherstep(phaseProgress);
  } else if (bankMs < cycle.peakAtMs) {
    phase = 'attack';
    phaseProgress = (bankMs - cycle.attackStartMs) / cycle.attackMs;
    // A full-phase smootherstep keeps zero endpoint velocity without compressing
    // the visible 10–90% rise into only two display frames.
    energy = cycle.chargePeak
      + (cycle.peak - cycle.chargePeak) * smootherstep(phaseProgress);
  } else if (bankMs < cycle.idleStartMs) {
    phase = 'decay';
    phaseProgress = (bankMs - cycle.peakAtMs) / cycle.decayMs;
    const damping = 6 * phaseProgress;
    const release = (1 + damping) * Math.exp(-damping);
    // Critical damping gives a slow, non-oscillating tail. A soft terminal
    // window lands exactly on the floor with zero slope before the dwell.
    const tail = 1 - smootherstep((phaseProgress - 0.6) / 0.4);
    energy = STANDBY_ENERGY_FLOOR + (cycle.peak - STANDBY_ENERGY_FLOOR) * release * tail;
  } else {
    phase = 'idle';
    phaseProgress = (bankMs - cycle.idleStartMs) / cycle.idleMs;
    energy = STANDBY_ENERGY_FLOOR;
  }

  // Preserve the exact authored bounds despite floating-point interpolation.
  return {
    energy: Math.max(STANDBY_ENERGY_FLOOR, Math.min(cycle.peak, energy)),
    phase, cycleIndex, phaseProgress: clamp01(phaseProgress), peak: cycle.peak,
  };
}
