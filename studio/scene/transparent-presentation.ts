import type { TrainingSnapshot } from '../core/training';
import { sampleStandbyEnergy, STANDBY_ENERGY_PERIOD_MS } from './standby-energy';

export interface TransparentPresentationOptions {
  readonly nowMs: number;
  readonly enteredAtMs: number;
  readonly reducedMotion: boolean;
  readonly paused: boolean;
  /** True only after a new changed input during this page entry. Never persisted. */
  readonly pageInputStarted: boolean;
  /** Set on loading a saved round; affects explanatory copy, never eligibility. */
  readonly restored: boolean;
  readonly restoreFailed?: boolean;
  readonly replay: boolean;
  readonly scorable: boolean;
}

/**
 * Read-only observer of the engine; state belongs only to the current page entry.
 * Call begin on mount, after restoring an engine, and on a bfcache pageshow.
 * Old draft versions establish a baseline, so reopening never counts old input.
 * No snapshot, draft text, event, result or metric is retained or modified here.
 */
export class PageInputGate {
  private sessionId: string | null = null;
  private readonly versions = new Map<string, number>();
  private inputStarted = false;

  get started(): boolean { return this.inputStarted; }

  begin(snapshot: TrainingSnapshot): void {
    this.sessionId = snapshot.sessionId;
    this.inputStarted = false;
    this.versions.clear();
    for (const [cueId, draft] of Object.entries(snapshot.drafts)) {
      this.versions.set(cueId, draft.version);
    }
  }

  observe(snapshot: TrainingSnapshot): void {
    // A new explicit round has a new session ID. Initial observation is a
    // baseline too; loaders should still explicitly begin after restoration.
    if (snapshot.sessionId !== this.sessionId) {
      this.begin(snapshot);
      return;
    }
    for (const [cueId, draft] of Object.entries(snapshot.drafts)) {
      const previous = this.versions.get(cueId) ?? 0;
      // Only actual changed input advances a draft version. Hint, timer,
      // composition-start, freeze and unchanged-text events do not advance it.
      if (draft.version > previous) {
        this.inputStarted = true;
        this.versions.set(cueId, draft.version);
      }
    }
  }
}

export interface StandbyPoint {
  readonly atMs: number;
  readonly value: number;
  readonly provenance: 'presentation-demo';
}

export interface StandbyPulse {
  readonly eventId: string;
  readonly atMs: number;
  readonly ageMs: number;
  readonly added: number;
  /** Waveform style only. This is never a committed input event. */
  readonly source: 'typed';
  readonly strength: number;
  readonly provenance: 'presentation-demo';
}

export interface TransparentStandby {
  /** Discriminator deliberately prevents interpreting this payload as training. */
  readonly source: 'presentation-demo';
  /** Decorative display clock, independent of the measured input timeline. */
  readonly nowMs: number;
  readonly goalWords: number;
  readonly goalTotal: 24;
  /** Continuous display geometry; rounded readouts never drive the ring. */
  readonly goalFraction: number;
  readonly historyWindowMs: number;
  readonly commits10s: number;
  readonly points: readonly StandbyPoint[];
  readonly pulses: readonly StandbyPulse[];
  readonly energy: number;
  readonly sweep: number;
  readonly frozen: boolean;
}

export interface TransparentPresentation {
  readonly mode: 'standby' | 'live' | 'waiting' | 'replay';
  readonly label: string;
  readonly detail: string;
  /** Mode accent only; correctness/error styling belongs to draft feedback. */
  readonly accent: 'mint' | 'amber' | 'neutral';
  readonly standby: TransparentStandby | null;
}

const PROVENANCE = 'presentation-demo' as const;
const WINDOW_MS = 12000;
const TRACE_STEP_MS=40;
const PULSE_WINDOW_MS = 10000;
const PULSE_INTERVAL_MS = 180;

/**
 * Derive only display decoration from an immutable v1 training snapshot.
 * No engine methods, real clock, timers, random values, persistence or media
 * access exist here. Never send `standby` to a training/metrics/export adapter.
 *
 * The caller owns the transient page input gate. Persisted drafts, attempts and
 * earned words never determine the initial display mode, and are never cleared
 * to produce standby. The first new changed input selects actual statistics for
 * the rest of this page entry; a reopen begins a new display-only gate.
 */
export function deriveTransparentPresentation(
  snapshot: TrainingSnapshot | null,
  options: TransparentPresentationOptions,
): TransparentPresentation {
  if (options.replay) return {
    mode: 'replay', label: '事件回放', detail: '事件回放，不计入新成果', accent: 'neutral', standby: null,
  };

  if (options.restoreFailed) return {
    mode: 'waiting', label: '恢复失败',
    detail: '本地记录恢复失败，请重试；历史统计暂不可用', accent: 'neutral', standby: null,
  };

  if (snapshot && options.pageInputStarted) return {
    mode: 'live', label: '训练中',
    detail: options.paused ? '练习已暂停，已获得成果保留' : '正在显示本轮实际统计',
    accent: 'amber', standby: null,
  };

  if (!snapshot || !options.scorable) return {
    mode: 'waiting', label: '待开始',
    detail: !options.scorable ? '当前素材没有可统计的参考文本'
      : '等待练习就绪',
    accent: 'neutral', standby: null,
  };

  checkTime(options.nowMs);
  checkTime(options.enteredAtMs);
  // Paused and reduced-motion frames are identical for any caller-owned now.
  const frozen = options.paused || options.reducedMotion;
  const elapsedMs = frozen ? 0 : Math.max(0, options.nowMs - options.enteredAtMs);
  // Seed a complete decorative 12-second trace without claiming observed time.
  const nowMs = Math.max(WINDOW_MS, options.enteredAtMs) + elapsedMs;
  const clockMs=options.enteredAtMs+elapsedMs;
  const core=sampleStandbyEnergy(clockMs,options.enteredAtMs,{reducedMotion:frozen});
  const rhythm=sampleStandbyEnergy(clockMs,options.enteredAtMs,{lagMs:130,reducedMotion:frozen});
  const historyEnergy=(relativeMs:number,lagMs:number)=>sampleStandbyEnergy(relativeMs<0?((relativeMs%STANDBY_ENERGY_PERIOD_MS)+STANDBY_ENERGY_PERIOD_MS)%STANDBY_ENERGY_PERIOD_MS:relativeMs,0,{lagMs,reducedMotion:frozen}).energy;
  // Timestamp-anchored samples are immutable; only their screen position scrolls.
  // Causal smoothing broadens the standby trace, without changing real measurements.
  const smoothTrace=(relativeMs:number)=>[.1,.2,.4,.2,.1].reduce((sum,weight,index)=>sum+weight*historyEnergy(relativeMs-index*80,70),0);
  const points:StandbyPoint[]=[];
  const firstIndex=Math.floor((elapsedMs-WINDOW_MS)/TRACE_STEP_MS),lastIndex=Math.floor(elapsedMs/TRACE_STEP_MS);
  for(let index=firstIndex;index<=lastIndex;index++){
    const at=index*TRACE_STEP_MS;points.push({atMs:nowMs+(at-elapsedMs),value:.35+smoothTrace(at)*5.1,provenance:PROVENANCE});
  }
  if(elapsedMs%TRACE_STEP_MS!==0)points.push({atMs:nowMs,value:.35+smoothTrace(elapsedMs)*5.1,provenance:PROVENANCE});
  const pulses: StandbyPulse[] = [];
  // Display-only prehistory uses the same authored repeating bank, never saved input.
  // Aligned to this entry's clock: frequent small samples form bursts during the
  // same attack/decay, followed by a genuinely quiet low-energy dwell.
  const newest=Math.floor(elapsedMs/PULSE_INTERVAL_MS);
  for(let index=newest-56;index<=newest;index++){
    const offset=index*PULSE_INTERVAL_MS,ageMs=elapsedMs-offset;
    const energy=historyEnergy(offset,130);
    if(ageMs>=PULSE_WINDOW_MS||energy<.11)continue;
    pulses.push({eventId:`presentation-standby-${index}`,atMs:nowMs-ageMs,ageMs,added:Math.max(1,Math.round(energy*5)),source:'typed',strength:energy,provenance:PROVENANCE});
  }

  return {
    mode: 'standby', label: '待开始',
    detail: `待机动效，尚未统计本次输入${options.restored ? '；已有记录保留' : ''}`, accent: 'mint',
    standby: {
      source: PROVENANCE, nowMs, goalWords: 1 + Math.round(core.energy*21),
      goalTotal: 24, goalFraction:(1+core.energy*21)/24, historyWindowMs:WINDOW_MS, commits10s: Math.round(rhythm.energy*24), points, pulses,
      energy: core.energy, sweep:core.energy, frozen,
    },
  };
}

function checkTime(value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Presentation time must be finite and nonnegative.');
}
