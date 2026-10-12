/** Read-only projections of canonical retained facts. No listeners, storage or migration. */
import {validatePracticeSnapshot,type PracticeSnapshot,type PracticeAttempt,type PracticeSubmission} from './practice';
import {canonicalJson,PracticeStorageConflict} from './practice-repository';
import {addedGraphemes} from './training';
import {validatePracticeTimeZone,practiceDayKey,splitPracticeInterval,listPracticeDays} from './practice-calendar';

export const PRACTICE_HISTORY_VERSION='lingotrace-practice-history-v1' as const;
export interface PracticeHistoryQuery {readonly fromInclusive:string;readonly toExclusive:string;readonly timeZone:string}
export type HistoryMetricUnit='count'|'graphemes'|'milliseconds'|'percent';
export type HistoryCoverage='partial'|'unmeasured';
export interface PracticeHistoryMetric {
 readonly metricKey:string;readonly metricVersion:1;readonly unit:HistoryMetricUnit;
 /** Only value is eligible for a HUD binding. Null must never be formatted as zero. */
 readonly value:number|null;readonly observedValue:number;readonly quality:'measured'|'unmeasured';readonly coverage:HistoryCoverage;
 readonly sourceEventIds:readonly string[];readonly numerator?:number;readonly denominator?:number;
}
export interface PracticeHistoryMetrics {
 readonly attemptsStarted:PracticeHistoryMetric;readonly firstSubmissions:PracticeHistoryMetric;readonly revisions:PracticeHistoryMetric;
 readonly inputCommits:PracticeHistoryMetric;readonly typedGraphemes:PracticeHistoryMetric;readonly uniqueUnits:PracticeHistoryMetric;
 readonly recordedActiveMs:PracticeHistoryMetric;readonly independentFirstWordMatch:PracticeHistoryMetric;readonly assistedFirstWordMatch:PracticeHistoryMetric;
}
export interface PracticeHistoryRow {
 readonly sessionId:string;readonly attemptId:string;readonly practiceRoundId:string;readonly materialId:string;readonly unitId:string;
 readonly referenceVersion:string;readonly mode:PracticeAttempt['mode'];readonly startedAt:string;
 readonly startedInRange:boolean;readonly firstSubmittedAt:string|null;readonly firstSubmissionInRange:boolean;readonly revisionsInRange:number;
 readonly practiceComplete:boolean;readonly currentEvaluationComplete:boolean;readonly currentTargetMet:boolean|null;
 readonly firstResult:{readonly evaluationComplete:boolean;readonly targetMet:boolean|null;readonly assisted:boolean;readonly referenceWords:number|null;readonly editErrors:number|null}|null;
}
export interface PracticeHistoryProjection {
 readonly schemaVersion:typeof PRACTICE_HISTORY_VERSION;readonly query:PracticeHistoryQuery;
 readonly sourceRevisions:readonly {readonly sessionId:string;readonly sequence:number}[];
 readonly coverage:{readonly scope:'retained-recorded-facts-only';readonly status:HistoryCoverage;readonly collectionStartedAt:null;
  readonly collectionIntervals:null;readonly firstObservedAt:string|null;readonly reasons:readonly string[]};
 readonly totals:PracticeHistoryMetrics;readonly days:readonly {readonly day:string;readonly coverage:HistoryCoverage;readonly metrics:PracticeHistoryMetrics}[];
 readonly history:readonly PracticeHistoryRow[];
 readonly unallocatedTime:{readonly milliseconds:number;readonly eventIds:readonly string[];readonly reason:'incompatible-wall-clock'|null};
 readonly unavailable:readonly string[];
}
interface Bucket {observed:boolean;starts:number;first:number;revisions:number;commits:number;graphemes:number;units:Set<string>;evidence:Set<string>;activeMs:number;independent:{words:number;errors:number;ids:Set<string>};assisted:{words:number;errors:number;ids:Set<string>}}
interface Interval {start:number;end:number;evidence:string}
const bucket=():Bucket=>({observed:false,starts:0,first:0,revisions:0,commits:0,graphemes:0,units:new Set(),evidence:new Set(),activeMs:0,independent:{words:0,errors:0,ids:new Set()},assisted:{words:0,errors:0,ids:new Set()}});
function immutable<T>(value:T):T {if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(immutable);Object.freeze(value)}return value}
function stamp(value:string){if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new Error('An explicit canonical UTC timestamp is required.');return Date.parse(value)}
export function normalizePracticeHistoryQuery(query:PracticeHistoryQuery):PracticeHistoryQuery {
 if(!query||typeof query!=='object')throw new Error('An explicit history query is required.');
 const fromInclusive=query.fromInclusive,toExclusive=query.toExclusive,timeZone=validatePracticeTimeZone(query.timeZone);
 const start=stamp(fromInclusive),end=stamp(toExclusive);if(end<=start||end-start>366*86400000)throw new Error('History range must be positive and at most 366 days.');
 return Object.freeze({fromInclusive,toExclusive,timeZone});
}
const eventIdentity=(sessionId:string,eventId:string)=>JSON.stringify([sessionId,eventId]);
const assisted=(submission:PracticeSubmission)=>submission.pasted||submission.exposureAtSubmission.length>0;
function metric(key:string,unit:HistoryMetricUnit,value:number,observed:boolean,ids:Set<string>,unknown=false):PracticeHistoryMetric {
 return{metricKey:key,metricVersion:1,unit,value:observed&&!unknown?value:null,observedValue:value,quality:observed&&!unknown?'measured':'unmeasured',coverage:observed?'partial':'unmeasured',sourceEventIds:[...ids].sort()};
}
function metrics(b:Bucket,unknownTime:boolean):PracticeHistoryMetrics {
 const count=(key:string,value:number)=>metric(key,'count',value,b.observed,b.evidence);
 const match=(key:string,t:Bucket['independent'])=>{const numerator=Math.max(0,t.words-t.errors);return{...metric(key,'percent',t.words?100*numerator/t.words:0,t.words>0,t.ids),numerator,denominator:t.words}};
 return{attemptsStarted:count('practice.attemptsStarted',b.starts),firstSubmissions:count('practice.firstSubmissions',b.first),revisions:count('practice.submissionRevisions',b.revisions),inputCommits:count('input.committedChanges',b.commits),typedGraphemes:metric('input.addedTypedGraphemes','graphemes',b.graphemes,b.observed,b.evidence),uniqueUnits:count('practice.uniqueMaterialUnits',b.units.size),recordedActiveMs:metric('practice.recordedIntervalUnion','milliseconds',b.activeMs,b.observed,b.evidence,unknownTime),independentFirstWordMatch:match('dictation.independentFirstSubmissionWordMatch',b.independent),assistedFirstWordMatch:match('dictation.assistedFirstSubmissionWordMatch',b.assisted)};
}
/** A caller-owned snapshot is not a privacy authority. Saved-history UI must use
 * FencedPracticeRepository.readHistoryProjection, never cached pre-delete input.
 * This pure function is for deterministic fixtures and repository-local reads.
 * Unknown/off/deleted coverage is never inferred from the earliest observation. */
export function projectPracticeHistory(inputs:readonly PracticeSnapshot[],inputQuery:PracticeHistoryQuery):PracticeHistoryProjection {
 const query=normalizePracticeHistoryQuery(inputQuery),from=stamp(query.fromInclusive),to=stamp(query.toExclusive),tz=query.timeZone;
 const sessions=new Map<string,PracticeSnapshot>();for(const input of inputs){const s=validatePracticeSnapshot(input),old=sessions.get(s.sessionId);if(old&&canonicalJson(old)!==canonicalJson(s))throw new PracticeStorageConflict();sessions.set(s.sessionId,s)}
 const snapshots=[...sessions.values()].sort((a,b)=>a.sessionId.localeCompare(b.sessionId));
 // Local date labels can go backwards at historical midnight rollbacks or
 // skip a day across date-line changes. Build from the entire instant range,
 // retaining skipped civil labels as unknown rather than assuming endpoints
 // form a monotone range. This also supports 366 elapsed days spanning a skip.
 const querySlices=splitPracticeInterval(from,to,tz),labels=new Set<string>();
 for(let i=0;i<querySlices.length;i++){const day=querySlices[i].day;labels.add(day);const prior=querySlices[i-1]?.day;if(prior&&prior<day)for(const label of listPracticeDays(prior,day))labels.add(label)}
 const days=new Map([...labels].sort().map(day=>[day,bucket()])),total=bucket();
 const intervals:Interval[]=[],history:PracticeHistoryRow[]=[],unallocatedIds:string[]=[];let unallocated=0,firstObserved:number|null=null,hasRedaction=false;
 const inRange=(at:number)=>at>=from&&at<to;
 for(const s of snapshots){
  hasRedaction ||= (s.projections.redaction?.targets.length??0)>0;
  const texts=new Map<string,string>(),activeAttempts=new Set<string>(),revisionCounts=new Map<string,number>();let current:string|null=null,lastWall:number|null=null;
  const submissions=new Map<string,{attempt:PracticeAttempt;submission:PracticeSubmission;first:boolean}>();
  for(const a of Object.values(s.projections.attempts)){if(a.firstSubmission)submissions.set(a.firstSubmission.eventId,{attempt:a,submission:a.firstSubmission,first:true});for(const revision of a.revisions)submissions.set(revision.eventId,{attempt:a,submission:revision,first:false})}
  const observe=(at:number,id:string,a:PracticeAttempt,apply:(b:Bucket)=>void=()=>{})=>{
   if(firstObserved===null||at<firstObserved)firstObserved=at;
   if(!inRange(at))return;
   const day=days.get(practiceDayKey(at,tz))!;activeAttempts.add(a.attemptId);
   for(const b of[total,day]){b.observed=true;b.units.add(JSON.stringify([a.reference.materialId,a.reference.unitId]));b.evidence.add(id);apply(b)}
  };
  for(const e of s.events){
   if(e.schemaVersion==='lingotrace-practice-v2'){if(e.payload.type==='redactedAttemptBoundary'){current=null;lastWall=null}continue}
   const at=stamp(e.occurredAt),p=e.payload,id=eventIdentity(s.sessionId,e.eventId);
   if(p.type==='attemptStarted'){current=p.attemptId;const a=s.projections.attempts[p.attemptId];if(a)observe(at,id,a,b=>{b.starts++})}
   else if(p.type==='roundEnded')current=null;
   else if(p.type==='inputCommitted'){
    const a=s.projections.attempts[p.attemptId];if(a){const before=texts.get(p.attemptId)??'';texts.set(p.attemptId,p.text);if(before!==p.text){const added=p.source==='paste'?0:addedGraphemes(before,p.text);observe(at,id,a,b=>{b.commits++;b.graphemes+=added})}}
   }else if(p.type==='submissionCommitted'){
    const found=submissions.get(e.eventId);if(found){const{attempt:a,submission,first}=found;observe(at,id,a,b=>{if(first){b.first++;if(submission.evaluationComplete&&submission.alignment){const target=assisted(submission)?b.assisted:b.independent;target.words+=submission.alignment.words;target.errors+=submission.alignment.errors;target.ids.add(id)}}else b.revisions++});if(!first&&inRange(at))revisionCounts.set(a.attemptId,(revisionCounts.get(a.attemptId)??0)+1)}
   }else if(p.type==='referenceExposed'&&p.attemptId!==null){const a=s.projections.attempts[p.attemptId];if(a)observe(at,id,a)}
   else if(p.type==='timeAdvanced'&&current){const a=s.projections.attempts[current];if(a){const start=at-p.deltaMs;
    // Wall timestamps have millisecond precision while the elapsed clock may
    // carry fractions. Larger disagreement is not safe to assign to a day.
    const compatible=lastWall!==null&&Math.abs((at-lastWall)-p.deltaMs)<=2;
    const left=Math.max(from,start),right=Math.min(to,at);
    if(compatible&&right>left){intervals.push({start:left,end:right,evidence:id});activeAttempts.add(a.attemptId);if(firstObserved===null||at<firstObserved)firstObserved=at;total.observed=true;total.units.add(JSON.stringify([a.reference.materialId,a.reference.unitId]));total.evidence.add(id);for(const slice of splitPracticeInterval(left,right,tz)){const b=days.get(slice.day)!;b.observed=true;b.units.add(JSON.stringify([a.reference.materialId,a.reference.unitId]));b.evidence.add(id)}}
    else if(!compatible&&inRange(at)){unallocated+=p.deltaMs;unallocatedIds.push(id);activeAttempts.add(a.attemptId);total.observed=true;total.evidence.add(id);total.units.add(JSON.stringify([a.reference.materialId,a.reference.unitId]));if(inRange(at))observe(at,id,a)}
   }}
   lastWall=at;
  }
  for(const a of Object.values(s.projections.attempts))if(activeAttempts.has(a.attemptId)){
   const first=a.firstSubmission;history.push({sessionId:s.sessionId,attemptId:a.attemptId,practiceRoundId:a.practiceRoundId,materialId:a.reference.materialId,unitId:a.reference.unitId,referenceVersion:a.reference.referenceVersion,mode:a.mode,startedAt:a.startedAt,startedInRange:inRange(stamp(a.startedAt)),firstSubmittedAt:first?.occurredAt??null,firstSubmissionInRange:!!first&&inRange(stamp(first.occurredAt)),revisionsInRange:revisionCounts.get(a.attemptId)??0,practiceComplete:a.practiceComplete,currentEvaluationComplete:a.evaluationComplete,currentTargetMet:a.targetMet,firstResult:first?{evaluationComplete:first.evaluationComplete,targetMet:first.targetMet,assisted:assisted(first),referenceWords:first.alignment?.words??null,editErrors:first.alignment?.errors??null}:null});
  }
 }
 // Union observed wall intervals across tabs/sessions. Overlap is not extra
 // practice time; daily sums and the period total come from this one union.
 intervals.sort((a,b)=>a.start-b.start||a.end-b.end);const union:{start:number;end:number}[]=[];
 for(const i of intervals){const tail=union.at(-1);if(tail&&i.start<=tail.end)tail.end=Math.max(tail.end,i.end);else union.push({start:i.start,end:i.end})}
 for(const i of union){total.activeMs+=i.end-i.start;for(const slice of splitPracticeInterval(i.start,i.end,tz))days.get(slice.day)!.activeMs+=slice.durationMs}
 history.sort((a,b)=>b.startedAt.localeCompare(a.startedAt)||a.sessionId.localeCompare(b.sessionId)||a.attemptId.localeCompare(b.attemptId));
 return immutable({schemaVersion:PRACTICE_HISTORY_VERSION,query,sourceRevisions:snapshots.map(s=>({sessionId:s.sessionId,sequence:s.sequence})),coverage:{scope:'retained-recorded-facts-only',status:total.observed?'partial':'unmeasured',collectionStartedAt:null,collectionIntervals:null,firstObservedAt:firstObserved===null?null:new Date(firstObserved).toISOString(),reasons:['collection-intervals-not-recorded','off-or-missing-periods-are-unknown',...(hasRedaction?['retained-history-has-redactions']:[])]},totals:metrics(total,unallocated>0),days:[...days].map(([day,b])=>({day,coverage:b.observed?'partial' as const:'unmeasured' as const,metrics:metrics(b,unallocated>0)})),history,unallocatedTime:{milliseconds:unallocated,eventIds:unallocatedIds.sort(),reason:unallocated>0?'incompatible-wall-clock':null},unavailable:['first-keystroke-accuracy','audio-assessment','listening-duration','reward-qualification','review-schedule','complete-collection-coverage']});
}
