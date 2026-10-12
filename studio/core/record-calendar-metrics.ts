import {legacyHistoryIdentity, readLegacyHistoryRecord, type LegacyHistorySession} from './legacy-history';
import {readTrainingHistorySegment} from './repository';
import type {TrainingHistorySegment} from './training-history-segment';
import {readListeningSession, type ListeningSessionRecord} from './listening-session';
import type {AlignmentResult} from './training';
import {listPracticeDays, practiceDayKey, splitPracticeInterval, validatePracticeTimeZone} from './practice-calendar';
import {parseRecordWallTime} from './record-calendar';

/** Read-only recorded-fact metrics, never Practice totals, proficiency or rewards. */
export interface RecordMetricSource {readonly sessionId:string;readonly eventId:string;readonly recordKeys:readonly string[]}
export interface RecordMetricValue {
 readonly value:number|null;
 /** Missing/conflicting metric fields remain visible beside any known lower bound. */
 readonly unknownCount:number;
 readonly sourceEventIds:readonly RecordMetricSource[];
}
export interface RecordCalendarMetricBucket {
 readonly day:string; readonly coverage:'partial';
 readonly submissions:RecordMetricValue; readonly firstCompletions:RecordMetricValue;
 readonly matchedTerms:RecordMetricValue; readonly inputActiveMs:RecordMetricValue;
}
export interface RecordCalendarMetricWeek extends RecordCalendarMetricBucket {readonly through:string}
export interface RecordCalendarMetricSnapshot {
 readonly days:readonly RecordCalendarMetricBucket[];readonly weeks:readonly RecordCalendarMetricWeek[];
 readonly conflictCount:number;readonly unlocatedCount:number;
}
export const emptyRecordCalendarMetrics=():RecordCalendarMetricSnapshot=>Object.freeze({days:Object.freeze([]),weeks:Object.freeze([]),conflictCount:0,unlocatedCount:0});
interface Interval {readonly start:number;readonly end:number;readonly predecessor:string}
/** Compact ephemeral evidence only: no source text, drafts, answers or alignment. */
export interface RecordCalendarMetricFact {
 readonly key:string;readonly sessionId:string;readonly eventId:string;readonly recordKey:string;
 readonly day:string|null;readonly instant:number|null;readonly common:string;readonly type:string;
 readonly context:string;readonly attemptKey?:string;readonly requestDigest?:string;
 readonly detailDigest?:string;readonly durationDisposition?:'active'|'excluded';
 readonly resultRequestKey?:string;readonly resultDigest?:string;readonly resultAnswerDigest?:string;readonly termIds?:readonly string[];
 readonly completionKey?:string|null;readonly delta?:number;readonly interval?:Interval;
 readonly invalidResult?:boolean;readonly invalidDuration?:boolean;
}
const compound=(...values:unknown[])=>JSON.stringify(values);
const digest=async(value:unknown)=>Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(legacyHistoryIdentity(value)))),v=>v.toString(16).padStart(2,'0')).join('');
const wall=(value:string)=>{try{return parseRecordWallTime(value)}catch{return null}};

/** Uses only saved results, with structural admission and relational checks. Does
 * not call TrainingEngine, a reducer, replay, align, or current material lookup. */
export async function projectRecordCalendarMetricFacts(
 source:LegacyHistorySession|TrainingHistorySegment|ListeningSessionRecord,recordKey:string,timeZone:string,yieldControl:()=>Promise<void>=async()=>{},
):Promise<readonly RecordCalendarMetricFact[]> {
 const zone=validatePracticeTimeZone(timeZone);
 // Admit the complete wrapper first. Its Training facts keep wrapper provenance;
 // conditions and pre-B receipts are never alternate event or metric sources.
 const listening='version' in source?readListeningSession(source):null;
 if(listening&&recordKey!==`listening-session:${listening.sessionId}`)throw new Error('Listening metric provenance must name its complete wrapper.');
 const full=!listening&&'summary' in source?readLegacyHistoryRecord({sessionId:source.summary.sessionId,sequence:source.summary.sequence,updatedAt:source.summary.updatedAt,snapshot:source.snapshot}):null;
 const partial=listening||full?null:readTrainingHistorySegment(source);
 const snapshot=listening?.trainingSnapshot??full?.snapshot,events=snapshot?.events??partial!.facts;
 const sessionId=snapshot?.sessionId??partial!.sessionId,material=snapshot?.material??partial!.material;
 const attempts=new Map(snapshot?.attempts.map(a=>[a.attemptId,a])??[]);
 const matchingJudgments=new Map<string,number>();
 if(snapshot)for(const e of snapshot.events){if(e.type==='judgmentApplied'){const a=attempts.get(e.attemptId);if(a&&a.wallTime===e.wallTime&&a.cueId===e.cueId)matchingJudgments.set(e.attemptId,(matchingJudgments.get(e.attemptId)??0)+1)}}
 const terms=new Map<string,Promise<string>>(),facts:RecordCalendarMetricFact[]=[];
 const submitted=new Map<string,(typeof events[number])[]>();
 const explicitBlockers=new Set<string>();
 for(let i=0;i<events.length;i++){
  const e=events[i],eventId='eventId' in e?e.eventId:e.sourceEventId,instant=wall(e.wallTime);
  let day:string|null=null;try{if(instant!==null)day=practiceDayKey(instant,zone)}catch{}
  const rule='ruleVersion' in e?[e.schemaVersion,e.ruleVersion,e.paceRuleVersion]:[partial!.rules.trainingSchemaVersion,partial!.rules.ruleVersion,partial!.rules.paceRuleVersion];
  const context=compound(material.id,material.version,e.cueId,rule);
  const fact:RecordCalendarMetricFact={key:compound(sessionId,eventId),sessionId,eventId,recordKey,day,instant,type:e.type,context,
   common:compound(context,e.type,instant??e.wallTime,rule,'attemptId' in e?e.attemptId:null,e.type==='inputCommitted'?e.source:e.type==='freezeChanged'?[e.reason,e.on]:e.type==='cueChanged'?e.index:e.type==='hintExposed'?e.kind:null),...('attemptId' in e?{attemptKey:compound(sessionId,e.attemptId)}:{})};
  let extra:Partial<RecordCalendarMetricFact>={};
  if(e.type==='inputCommitted'&&'text' in e)extra={detailDigest:await digest(e.text)};
  if(e.type==='submitRequested'){const previous=submitted.get(e.attemptId)??[];previous.push(e);submitted.set(e.attemptId,previous);if('answer' in e)extra={requestDigest:await digest(e.answer)}}
  if(e.type==='judgmentApplied'){
   const a=snapshot?attempts.get(e.attemptId):undefined;
   const result:AlignmentResult&{answer:string}|undefined=snapshot
    ?a&&a.wallTime===e.wallTime&&a.cueId===e.cueId&&matchingJudgments.get(e.attemptId)===1&&'ruleVersion' in e&&a.ruleVersion===e.ruleVersion&&a.inputVersion===e.inputVersion&&a.activeMs===e.activeMs&&a.reference===snapshot.material.cues.find(c=>c.id===e.cueId)?.text?a:undefined
    :'retention' in e&&e.retention==='recorded'?e.result:undefined;
   if(result){
    // A malformed imported match cannot silently manufacture a lexeme.
    const expectedPositions=result.alignment.filter(t=>t.kind!=='extra').map(t=>t.position);
    const valid=expectedPositions.length===result.words&&new Set(expectedPositions).size===expectedPositions.length&&result.errors<=result.alignment.length
     &&result.alignment.every(t=>t.kind==='extra'?t.position===null&&t.expected==='':t.position!==null&&t.position<result.words&&t.expected.length>0&&(t.kind!=='match'||t.expected===t.actual));
    if(valid){
     const request=(submitted.get(e.attemptId)??[]).find(r=>r.type==='submitRequested'&&r.attemptId===e.attemptId&&r.cueId===e.cueId&&'answer' in r&&r.answer===result.answer&&wall(r.wallTime)!==null&&instant!==null&&wall(r.wallTime)!<=instant&&(!a||!('draftVersion' in r)||r.draftVersion===a.inputVersion)&&(!('ruleVersion' in r)||legacyHistoryIdentity([r.schemaVersion,r.ruleVersion,r.paceRuleVersion])===legacyHistoryIdentity(rule)));
     const ids=await Promise.all([...new Set(result.alignment.filter(t=>t.kind==='match').map(t=>t.expected))].map(term=>{if(!terms.has(term))terms.set(term,digest(term));return terms.get(term)!}));
     extra={resultDigest:await digest({answer:result.answer,words:result.words,errors:result.errors,accuracy:result.accuracy,alignment:result.alignment}),resultAnswerDigest:await digest(result.answer),...(request?{resultRequestKey:compound(sessionId,'eventId' in request?request.eventId:request.sourceEventId),termIds:Object.freeze(ids)}:{}),...(a&&request?{completionKey:a.firstCompletion?compound(sessionId,material.id,material.version,a.cueId):null}:{})};
    }else extra={invalidResult:true};
   }else if(a&&a.wallTime===e.wallTime&&a.cueId===e.cueId)extra={invalidResult:true};
  }
  if(e.type==='timeAdvanced'){
   if('durationCoverage' in e&&e.durationCoverage==='frozen')extra={durationDisposition:'excluded'};
   const delta='durationCoverage' in e?e.durationCoverage==='observed'?e.deltaMs:null:e.deltaMs;
   if(delta!==null){
    extra={delta};const previous=events[i-1],start=previous?wall(previous.wallTime):null;
    const nextActive=snapshot?(snapshot.events[i+1]?.activeMs??snapshot.activeMs):null;
    const activeConsistent=!snapshot||'activeMs' in e&&nextActive!==null&&Math.abs(nextActive-e.activeMs-delta)<0.000001;
    extra={...extra,...(activeConsistent&&delta>0?{durationDisposition:'active' as const}:snapshot&&'activeMs' in e&&nextActive===e.activeMs?{durationDisposition:'excluded' as const}:{})};
    // Require agreement with both retained endpoints; do not invent an interval
    // from rounded/shifted clocks. Epsilon is floating arithmetic, not a gap allowance.
    // No metadata, gap extrapolation or cumulative active counter supplies a start.
    if(extra.durationDisposition==='active'&&explicitBlockers.size)extra={...extra,invalidDuration:true};
    if(!explicitBlockers.size&&instant!==null&&start!==null&&delta>0&&instant>start&&Math.abs(instant-start-delta)<0.000001&&activeConsistent){
     try{splitPracticeInterval(instant-delta,instant,zone);extra={...extra,interval:Object.freeze({start:instant-delta,end:instant,predecessor:compound(sessionId,'eventId' in previous?previous.eventId:previous.sourceEventId)})}}catch{}
    }
   }
  }
  facts.push(Object.freeze({...fact,...extra}));
  if(e.type==='freezeChanged'){if(e.on)explicitBlockers.add(e.reason);else explicitBlockers.delete(e.reason)}
  else if(e.type==='compositionStarted')explicitBlockers.add('composition');
  else if(e.type==='compositionEnded')explicitBlockers.delete('composition');
  else if(e.type==='cueChanged'){explicitBlockers.delete('composition');explicitBlockers.delete('review');explicitBlockers.add('idle')}
  // An input may clear the source engine's idle/review gate; it cannot clear an explicit pause or dialog.
  else if(e.type==='inputCommitted'){explicitBlockers.delete('idle');explicitBlockers.delete('review')}
  else if(e.type==='judgmentApplied')explicitBlockers.delete('checking');
  if((i+1)%64===0)await yieldControl();
 }
 return Object.freeze(facts);
}

export function recordCalendarWeek(day:string):{from:string;to:string}{
 listPracticeDays(day,day);const date=new Date(`${day}T12:00:00Z`),offset=(date.getUTCDay()+6)%7;
 date.setUTCDate(date.getUTCDate()-offset);const from=date.toISOString().slice(0,10);date.setUTCDate(date.getUTCDate()+6);const to=date.toISOString().slice(0,10);
 // Keep the supported calendar boundary explicit, including year 0001/9999.
 listPracticeDays(from,to);return{from,to};
}
interface Merged {fact:RecordCalendarMetricFact;records:Set<string>;days:Set<string>;attemptKeys:Set<string>;hasUnlocated:boolean;conflict:boolean}
interface ValueBuilder {known:boolean;ids:Set<string>;unknown:Set<string>;sources:Map<string,RecordMetricSource>;intervals:{start:number;end:number}[]}
interface BucketBuilder {day:string;submissions:ValueBuilder;firstCompletions:ValueBuilder;matchedTerms:ValueBuilder;inputActiveMs:ValueBuilder}
type MetricName='submissions'|'firstCompletions'|'matchedTerms'|'inputActiveMs';
const names:readonly MetricName[]=['submissions','firstCompletions','matchedTerms','inputActiveMs'];
const valueBuilder=():ValueBuilder=>({known:false,ids:new Set(),unknown:new Set(),sources:new Map(),intervals:[]});
const bucketBuilder=(day:string):BucketBuilder=>({day,submissions:valueBuilder(),firstCompletions:valueBuilder(),matchedTerms:valueBuilder(),inputActiveMs:valueBuilder()});
function elapsed(intervals:{start:number;end:number}[]):number{let total=0,end=-Infinity;for(const slice of [...intervals].sort((a,b)=>a.start-b.start||a.end-b.end)){total+=Math.max(0,slice.end-Math.max(slice.start,end));end=Math.max(end,slice.end)}return total}
function finish(bucket:BucketBuilder):RecordCalendarMetricBucket{
 const result={day:bucket.day,coverage:'partial' as const} as RecordCalendarMetricBucket;
 for(const name of names){const b=bucket[name];Object.assign(result,{[name]:Object.freeze({value:b.known?(name==='inputActiveMs'?elapsed(b.intervals):b.ids.size):null,unknownCount:b.unknown.size,sourceEventIds:Object.freeze([...b.sources.values()].sort((a,b)=>a.sessionId.localeCompare(b.sessionId)||a.eventId.localeCompare(b.eventId)))})})}
 return Object.freeze(result);
}
/** Scanner-owned, disposable accumulation. Shared event IDs merge across all
 * pages/source families; contradictions retract contributions instead of adding. */
export class RecordCalendarMetrics {
 private readonly events=new Map<string,Merged>();private readonly zone:string;private cached:RecordCalendarMetricSnapshot|null=null;
 constructor(timeZone:string){this.zone=validatePracticeTimeZone(timeZone)}
 add(facts:readonly RecordCalendarMetricFact[]):void{
  this.cached=null;
  for(const fact of facts){const old=this.events.get(fact.key);
   if(!old){this.events.set(fact.key,{fact,records:new Set([fact.recordKey]),days:new Set(fact.day?[fact.day]:[]),attemptKeys:new Set(fact.attemptKey?[fact.attemptKey]:[]),hasUnlocated:fact.day===null,conflict:false});continue}
   old.records.add(fact.recordKey);if(fact.day)old.days.add(fact.day);if(fact.attemptKey)old.attemptKeys.add(fact.attemptKey);if(fact.day===null)old.hasUnlocated=true;
   if(old.fact.common!==fact.common)old.conflict=true;
   if(old.fact.interval&&fact.interval&&legacyHistoryIdentity(old.fact.interval)!==legacyHistoryIdentity(fact.interval))old.conflict=true;
   for(const field of ['requestDigest','resultDigest','completionKey','delta','detailDigest','durationDisposition','resultRequestKey'] as const){if(old.fact[field]!==undefined&&fact[field]!==undefined&&old.fact[field]!==fact[field])old.conflict=true}
   // Unknown/redacted fields are absence of evidence, not evidence of a conflict.
   old.fact={...fact,...old.fact,...Object.fromEntries(Object.entries(fact).filter(([key,value])=>value!==undefined&&(old.fact as unknown as Record<string,unknown>)[key]===undefined))};
   if(fact.invalidResult||fact.invalidDuration)old.conflict=true;
  }
 }
 getSnapshot():RecordCalendarMetricSnapshot{
  if(this.cached)return this.cached;
  const days=new Map<string,BucketBuilder>(),weeks=new Map<string,BucketBuilder>();
  const buckets=(day:string)=>{if(!days.has(day))days.set(day,bucketBuilder(day));let week:string;try{week=recordCalendarWeek(day).from}catch{return[days.get(day)!]};if(!weeks.has(week))weeks.set(week,bucketBuilder(week));return[days.get(day)!,weeks.get(week)!]};
  const source=(item:Merged):RecordMetricSource=>Object.freeze({sessionId:item.fact.sessionId,eventId:item.fact.eventId,recordKeys:Object.freeze([...item.records].sort())});
  const unknown=(item:Merged,metrics:readonly MetricName[]=names)=>{for(const day of item.days)for(const b of buckets(day))for(const name of metrics){b[name].unknown.add(item.fact.key);b[name].sources.set(item.fact.key,source(item))}};
  const include=(items:readonly Merged[],day:string,name:MetricName,ids:readonly string[])=>{for(const b of buckets(day)){b[name].known=true;ids.forEach(id=>b[name].ids.add(id));for(const item of items)b[name].sources.set(item.fact.key,source(item))}};
  let conflictCount=0,unlocatedCount=0;
  const rejectedAttempts=new Set<string>(),submissions=new Map<string,Merged[]>(),judgments=new Map<string,Merged[]>();
  for(const item of this.events.values()){
   const f=item.fact;for(const day of item.days)buckets(day);
   if(item.hasUnlocated)unlocatedCount++;
   if(item.conflict||f.invalidResult||f.invalidDuration){conflictCount++;unknown(item);item.attemptKeys.forEach(key=>rejectedAttempts.add(key));continue}
   if(f.attemptKey){const map=f.type==='submitRequested'?submissions:f.type==='judgmentApplied'?judgments:null;if(map){const values=map.get(f.attemptKey)??[];values.push(item);map.set(f.attemptKey,values)}}
  }
  const compatible=(items:Merged[],field:'requestDigest'|'resultDigest')=>new Set(items.map(i=>i.fact.context)).size===1&&new Set(items.map(i=>i.fact[field]).filter(v=>v!==undefined)).size<=1;
  for(const [key,items]of submissions)if(!compatible(items,'requestDigest')||items.some(i=>!i.fact.day)){rejectedAttempts.add(key);conflictCount++}
  for(const [key,items]of judgments)if(!compatible(items,'resultDigest')||items.some(i=>!i.fact.day)||items.filter(i=>i.fact.resultDigest!==undefined).length>1){rejectedAttempts.add(key);conflictCount++}
  const dated=(items:Merged[])=>items.filter(i=>i.fact.day&&i.fact.instant!==null).sort((a,b)=>a.fact.instant!-b.fact.instant!||a.fact.key.localeCompare(b.fact.key));
  for(const [key,items]of submissions){if(rejectedAttempts.has(key)){items.forEach(i=>unknown(i,['submissions']));continue}const first=dated(items)[0];if(first)include(items,first.fact.day!,'submissions',[key])}
  const completed=new Map<string,{day:string;instant:number;items:Merged[]}>();
  for(const [key,items]of judgments){
   const requests=submissions.get(key)??[];
   const good=dated(items).filter(i=>i.fact.resultDigest&&i.fact.resultRequestKey&&requests.some(r=>r.fact.key===i.fact.resultRequestKey&&r.fact.requestDigest===i.fact.resultAnswerDigest&&r.fact.context===i.fact.context&&r.fact.instant!==null&&r.fact.instant<=i.fact.instant!));
   if(rejectedAttempts.has(key)||!good.length){items.forEach(i=>unknown(i,['firstCompletions','matchedTerms']));continue}
   const item=good[0],f=item.fact;include(items,f.day!,'matchedTerms',f.termIds??[]);
   const known=good.find(i=>i.fact.completionKey!==undefined);
   if(!known){items.forEach(i=>unknown(i,['firstCompletions']));continue}
   if(known.fact.completionKey===null){include(items,known.fact.day!,'firstCompletions',[]);continue}
   const completion=known.fact.completionKey!,old=completed.get(completion);
   if(!old)completed.set(completion,{day:known.fact.day!,instant:known.fact.instant!,items:[...items]});
   else{old.items.push(...items);if(known.fact.instant!<old.instant){old.day=known.fact.day!;old.instant=known.fact.instant!}}
  }
  for(const [key,value]of completed)include(value.items,value.day,'firstCompletions',[key]);
  for(const item of this.events.values()){
   const f=item.fact;if(f.type!=='timeAdvanced'||item.conflict||f.invalidDuration||f.durationDisposition==='excluded')continue;
   const interval=f.interval,predecessor=interval?this.events.get(interval.predecessor):null;
   if(!interval||!predecessor||predecessor.conflict){unknown(item,['inputActiveMs']);continue}
   for(const slice of splitPracticeInterval(interval.start,interval.end,this.zone))for(const b of buckets(slice.day)){
    b.inputActiveMs.known=true;b.inputActiveMs.intervals.push({start:slice.startMs,end:slice.endMs});b.inputActiveMs.sources.set(f.key,source(item));
   }
  }
  return this.cached=Object.freeze({days:Object.freeze([...days.values()].sort((a,b)=>a.day.localeCompare(b.day)).map(finish)),weeks:Object.freeze([...weeks.values()].sort((a,b)=>a.day.localeCompare(b.day)).map(b=>Object.freeze({...finish(b),through:recordCalendarWeek(b.day).to}))),conflictCount,unlocatedCount});
 }
}
