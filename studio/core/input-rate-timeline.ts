import { graphemes, nativeInsertedText, createInitialSnapshot, getDraft, reduceTraining, replay, type TrainingEvent, type TrainingSnapshot } from './training';
import {MAX_OBSERVATION_GAP_MS} from './input-observation';
import { derivePaceTimeline, type PaceTimeline, type PaceTimelinePoint, type PaceTrace, type PaceTimelineGap, type PaceTimelineMarker, type PaceTimelineIssue } from './pace-timeline';

export const INPUT_RATE_VERSION = 'input.cpm.5s.v1';
export const OBSERVED_INPUT_RATE_VERSION = 'input.cpm.5s.v2';
export const INPUT_RATE_WINDOW_MS = 5000;
export type InputRateState = 'sampling' | 'measured' | 'frozen' | 'unavailable';
export interface InputRatePoint extends Omit<PaceTimelinePoint, 'pace' | 'rawPace'> {
  readonly metricVersion?: typeof INPUT_RATE_VERSION | typeof OBSERVED_INPUT_RATE_VERSION;
  readonly windowClock?: 'recorded-wall-time' | 'input-observation-v1';
  readonly observationRunId?: string;
  readonly observationSegment?: number;
  readonly state: InputRateState;
  readonly cpm: number | null;
  readonly wpmEquivalent: number | null;
  readonly addedGraphemes: number | null;
  readonly observedMs: number;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly sourceEventIds: readonly string[];
  readonly excludedEventIds: readonly string[];
  readonly unknownEventIds: readonly string[];
  readonly includesIME: boolean;
  readonly unavailableReason: 'legacy-or-unknown-input' | 'grapheme-segmentation-unavailable' | null;
}
export interface InputRateTimeline extends Omit<PaceTimeline, 'version' | 'points' | 'segments' | 'limitations'> {
  readonly version: typeof INPUT_RATE_VERSION | typeof OBSERVED_INPUT_RATE_VERSION;
  readonly maxObservationGapMs?: number;
  readonly unit: 'graphemes/minute';
  readonly windowMs: typeof INPUT_RATE_WINDOW_MS;
  readonly formula: '12 × committed manual graphemes in (t − 5000ms, t]';
  readonly legacyPaceVersion: PaceTimeline['version'];
  readonly points: readonly InputRatePoint[];
  readonly segments: readonly { readonly id: string; readonly points: readonly InputRatePoint[] }[];
  readonly limitations: readonly string[];
}
type Edit = { count: number; classification: 'manual' | 'excluded' | 'unknown'; ime: boolean };

/** Final committed text only. An unclassified legacy insertion is never guessed to be a keystroke. */
export function classifyInputRateEdit(event: Extract<TrainingEvent, { type: 'inputCommitted' }>, before: string): Edit {
  const n = event.nativeEdit;
  if (event.source === 'paste' || (n?.kind === 'input' && (
    n.inputType?.startsWith('delete') || ['historyUndo', 'historyRedo', 'insertFromPaste', 'insertFromDrop', 'insertReplacementText'].includes(n.inputType ?? '')
  ))) return { count: 0, classification: 'excluded', ime: false };
  const inserted = nativeInsertedText(event.source, n);
  return inserted === null ? { count: 0, classification: 'unknown', ime: false } : { count: graphemes(inserted).length, classification: 'manual', ime: event.source === 'ime' };
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Additive read-only metric. Never overwrites energy, attempts, events or persisted history. */
export function deriveLegacyInputRateTimeline(snapshot: TrainingSnapshot): InputRateTimeline {
  const legacy = derivePaceTimeline(snapshot);
  const edits = new Map<string, Edit>();
  let state = createInitialSnapshot(snapshot.sessionId, snapshot.material);
  const segmentationAvailable = typeof Intl.Segmenter === 'function';
  for (const event of snapshot.events) {
    const before = state;
    state = reduceTraining(state, event);
    if (state === before || event.type !== 'inputCommitted' || state.frozenReasons.length) continue;
    // No code-point fallback under a metric promising Unicode graphemes.
    edits.set(event.eventId, segmentationAvailable ? classifyInputRateEdit(event, getDraft(before).text) : { count: 0, classification: 'unknown', ime: false });
  }
  const frozenIds = new Set(legacy.markers.filter(m => m.after.length).map(m => m.at.eventId));
  const points: InputRatePoint[] = [];
  const segments: { id: string; points: InputRatePoint[] }[] = [];
  for (const oldSegment of legacy.segments) {
    let connected: { id: string; points: InputRatePoint[] } | null = null;
    const start = oldSegment.points[0].wallTimeMs;
    const window: { at: number; eventId: string; edit: Edit }[] = [];
    for (const old of oldSegment.points) {
      const edit = edits.get(old.eventId);
      if (edit) window.push({ at: old.wallTimeMs, eventId: old.eventId, edit });
      const lower = old.wallTimeMs - INPUT_RATE_WINDOW_MS;
      while (window.length && window[0].at <= lower) window.shift();
      const manual = window.filter(v => v.edit.classification === 'manual');
      const unknown = window.filter(v => v.edit.classification === 'unknown');
      const observedMs = Math.min(INPUT_RATE_WINDOW_MS, Math.max(0, old.wallTimeMs - start));
      const unavailableReason = !segmentationAvailable ? 'grapheme-segmentation-unavailable' : unknown.length ? 'legacy-or-unknown-input' : null;
      const coverage: InputRateState = frozenIds.has(old.eventId) ? 'frozen' : observedMs < INPUT_RATE_WINDOW_MS ? 'sampling' : unavailableReason ? 'unavailable' : 'measured';
      const count = coverage === 'measured' ? manual.reduce((sum, v) => sum + v.edit.count, 0) : null;
      const { rawPace: _raw, pace: _pace, ...trace } = old;
      const point: InputRatePoint = { ...trace, state: coverage, cpm: count === null ? null : 12 * count, wpmEquivalent: count === null ? null : 12 * count / 5,
        addedGraphemes: count, observedMs, windowStartMs: lower, windowEndMs: old.wallTimeMs,
        sourceEventIds: manual.map(v => v.eventId), excludedEventIds: window.filter(v => v.edit.classification === 'excluded').map(v => v.eventId),
        unknownEventIds: unknown.map(v => v.eventId), includesIME: manual.some(v => v.edit.ime), unavailableReason };
      points.push(point);
      // Sampling/unavailable/frozen is a gap, never a numeric zero or line bridge.
      if (coverage === 'measured') {
        if (!connected) { connected = { id: `input-rate:${old.eventId}`, points: [] }; segments.push(connected); }
        connected.points.push(point);
      } else connected = null;
    }
  }
  const { version, points: _points, segments: _segments, limitations, ...metadata } = legacy;
  return freeze({ ...metadata, version: INPUT_RATE_VERSION, unit: 'graphemes/minute', windowMs: INPUT_RATE_WINDOW_MS,
    formula: '12 × committed manual graphemes in (t − 5000ms, t]', legacyPaceVersion: version, points, segments,
    limitations: [...limitations,
      'An incomplete uninterrupted five-second window is sampling, never zero. Pauses, IME composition and observation gaps restart coverage.',
      'Legacy or unknown edits lack native operation provenance: overlapping complete windows are unavailable, not reconstructed as exact CPM.',
      'Native insertText and final IME commits count native inserted graphemes, including incorrect text. Paste, deletion, undo/redo, drop and browser replacement do not count.',
      'IME final commits are observed once, but the existing composition freeze restarts coverage. Repeated composition can remain sampling indefinitely; measured IME input rates are not yet implemented. WPM is only CPM / 5, not English proficiency.',
      'Native operation evidence does not prove physical device input. Unicode grapheme segmentation depends on the runtime ICU version; absent Intl.Segmenter is unavailable.',
    ] });
}


/** New evidence never reconstructs a legacy interval. Mixed histories retain v1 points explicitly. */
export function deriveInputRateTimeline(snapshot: TrainingSnapshot): InputRateTimeline {
  const firstObserved=snapshot.events.findIndex(event=>!!event.inputObservation);
  if(firstObserved<0)return deriveLegacyInputRateTimeline(snapshot);
  const legacy=firstObserved>0?deriveLegacyInputRateTimeline(replay(snapshot.events.slice(0,firstObserved),snapshot.material)):null;
  const points:InputRatePoint[]=(legacy?.points??[]).map(point=>({...point,metricVersion:INPUT_RATE_VERSION,windowClock:'recorded-wall-time'}));
  const byId=new Map(points.map(point=>[point.eventId,point]));
  const segments:{id:string;points:InputRatePoint[]}[]=(legacy?.segments??[]).map(segment=>({id:segment.id,points:segment.points.map(point=>byId.get(point.eventId)!)}));
  const gaps:PaceTimelineGap[]=[...(legacy?.gaps??[])],markers:PaceTimelineMarker[]=[...(legacy?.markers??[])],issues:PaceTimelineIssue[]=[...(legacy?.issues??[])];
  let state=createInitialSnapshot(snapshot.sessionId,snapshot.material),previous:PaceTrace|null=null,priorEvidence:TrainingEvent['inputObservation']=undefined;
  let key:string|null=null,start=0,connected:{id:string;points:InputRatePoint[]}|null=null,interrupted=true;
  let window:{at:number;eventId:string;edit:Edit}[]=[];
  const segmentationAvailable=typeof Intl.Segmenter==='function';
  const origin=snapshot.events[0],originMs=origin?Date.parse(origin.wallTime):0;
  const trace=(event:TrainingEvent):PaceTrace=>({eventId:event.eventId,sequence:event.sequence,eventType:event.type,sessionId:event.sessionId,roundId:state.roundId,materialId:event.materialId,materialVersion:event.materialVersion,cueId:event.cueId,inputVersion:event.inputVersion,attemptId:'attemptId'in event?event.attemptId:null,schemaVersion:event.schemaVersion,ruleVersion:event.ruleVersion,paceRuleVersion:event.paceRuleVersion,wallTime:event.wallTime,wallTimeMs:Date.parse(event.wallTime),elapsedWallMs:Date.parse(event.wallTime)-originMs,activeMsBefore:event.activeMs,activeMs:state.activeMs});
  const gap=(kind:PaceTimelineGap['kind'],from:PaceTrace,to:PaceTrace,reasons:readonly string[]=[],open=false)=>gaps.push({id:`observed-${kind}:${from.eventId}:${to.eventId}`,kind,from,to,reasons:reasons as PaceTimelineGap['reasons'],observedWallMs:to.wallTimeMs>=from.wallTimeMs?to.wallTimeMs-from.wallTimeMs:null,open});
  for(const event of snapshot.events){
    const before=state;state=reduceTraining(state,event);if(state===before)continue;
    const at=trace(event),evidence=event.inputObservation;
    if(!evidence){previous=at;priorEvidence=undefined;interrupted=true;connected=null;continue}
    const nextKey=`${evidence.runId}:${evidence.segment}`;
    const invalidContinuity=!!priorEvidence&&(evidence.atMs<priorEvidence.atMs||evidence.atMs-priorEvidence.atMs>MAX_OBSERVATION_GAP_MS);
    const boundary=interrupted||key!==nextKey||invalidContinuity;
    if(boundary){start=evidence.atMs;window=[];connected=null;if(previous&&priorEvidence?.state!=='suspended')gap('unobserved',previous,at)}
    if(previous&&at.wallTimeMs<previous.wallTimeMs){issues.push({code:'wall-clock-reversed',from:previous,to:at,wallDeltaMs:at.wallTimeMs-previous.wallTimeMs,activeDeltaMs:at.activeMs-previous.activeMs});gap('clock-discontinuity',previous,at);connected=null;}
    if(priorEvidence?.state==='suspended'&&previous)gap('frozen',previous,at,priorEvidence.reasons);
    if(priorEvidence?.state!==evidence.state||JSON.stringify(priorEvidence.reasons)!==JSON.stringify(evidence.reasons))markers.push({at,before:(priorEvidence?.reasons??[]) as PaceTimelineMarker['before'],after:evidence.reasons as PaceTimelineMarker['after']});
    if(evidence.state==='observing'&&event.type==='inputCommitted')window.push({at:evidence.atMs,eventId:event.eventId,edit:segmentationAvailable?(event.source==='ime'&&event.nativeEdit?.kind==='compositionend'&&event.nativeEdit.data===''&&event.text===getDraft(before).text?{count:0,classification:'excluded',ime:true}:classifyInputRateEdit(event,getDraft(before).text)):{count:0,classification:'unknown',ime:false}});
    const lower=evidence.atMs-INPUT_RATE_WINDOW_MS;while(window.length&&window[0].at<=lower)window.shift();
    const manual=window.filter(v=>v.edit.classification==='manual'),unknown=window.filter(v=>v.edit.classification==='unknown');
    const observedMs=evidence.state==='observing'?Math.min(INPUT_RATE_WINDOW_MS,Math.max(0,evidence.atMs-start)):0;
    const unavailableReason=!segmentationAvailable?'grapheme-segmentation-unavailable':unknown.length?'legacy-or-unknown-input':null;
    const coverage:InputRateState=evidence.state==='suspended'?'frozen':observedMs<INPUT_RATE_WINDOW_MS?'sampling':unavailableReason?'unavailable':'measured';
    const count=coverage==='measured'?manual.reduce((sum,item)=>sum+item.edit.count,0):null;
    const point:InputRatePoint={...at,kind:event.type==='inputCommitted'?'input':event.type==='timeAdvanced'||event.type==='inputObservationSampled'?'sample':'boundary',metricVersion:OBSERVED_INPUT_RATE_VERSION,windowClock:'input-observation-v1',observationRunId:evidence.runId,observationSegment:evidence.segment,state:coverage,cpm:count===null?null:12*count,wpmEquivalent:count===null?null:12*count/5,addedGraphemes:count,observedMs,windowStartMs:lower,windowEndMs:evidence.atMs,sourceEventIds:manual.map(v=>v.eventId),excludedEventIds:window.filter(v=>v.edit.classification==='excluded').map(v=>v.eventId),unknownEventIds:unknown.map(v=>v.eventId),includesIME:manual.some(v=>v.edit.ime),unavailableReason};
    points.push(point);
    if(coverage==='measured'){if(!connected){connected={id:`observed-rate:${event.eventId}`,points:[]};segments.push(connected)}connected.points.push(point)}else connected=null;
    key=nextKey;interrupted=evidence.state==='suspended';previous=at;priorEvidence=evidence;
  }
  if(previous&&priorEvidence?.state==='suspended')gap('frozen',previous,previous,priorEvidence.reasons,true);
  let minWallTimeMs=Infinity,maxWallTimeMs=-Infinity;
  for(const point of points){minWallTimeMs=Math.min(minWallTimeMs,point.wallTimeMs);maxWallTimeMs=Math.max(maxWallTimeMs,point.wallTimeMs)}
  return freeze({version:OBSERVED_INPUT_RATE_VERSION,axis:'recorded-wall-time',sessionId:state.sessionId,roundId:state.roundId,lastSequence:state.sequence,originWallTime:origin?.wallTime??null,domain:points.length?{minWallTimeMs,maxWallTimeMs}:null,points,segments,gaps,markers,issues,sampleCount:points.filter(p=>p.kind!=='boundary').length,clockToleranceMs:50,maxObservationGapMs:MAX_OBSERVATION_GAP_MS,unit:'graphemes/minute',windowMs:INPUT_RATE_WINDOW_MS,formula:'12 × committed manual graphemes in (t − 5000ms, t]',legacyPaceVersion:'recorded-wall-events-v1',limitations:[
    'v2 uses explicit foreground monotonic observation evidence. Composition-only practice freezes do not interrupt this clock. Practice activeMs and scoring retain their existing rules.',
    'Observation starts on this page’s first committed edit or native compositionstart, never on page standby. Compositionstart stores timing only, never candidate/preedit text. A full five-second window is required; incomplete coverage is null, never a fabricated zero.',
    'Manual pause, background, modal/listening/checking/review, actual input/window focus loss, page restore, changed observation run, backward monotonic clocks, or more than 2500ms between samples restart coverage. The legacy idle flag is not the observation focus gate. Missing evidence is never bridged.',
    'Only native insertText / final compositionend inserted graphemes count. Paste, deletion, undo/redo, drop and browser replacement are excluded. WPM is CPM / 5 only.',
    'Older points retain the explicit input.cpm.5s.v1 metric version and recorded-wall-time window. They are not rewritten or backfilled with observation evidence.',
    'Native operation metadata is not proof of physical device input. Native OS IME, Unicode/ICU portability and browser-specific event ordering require actual-device qualification.',
  ]});
}
