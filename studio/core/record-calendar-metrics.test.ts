import test from 'node:test';
import assert from 'node:assert/strict';
import {TrainingEngine, SCHEMA_VERSION, RULE_VERSION, PACE_RULE_VERSION} from './training';
import {readLegacyHistoryRecord, type LegacyHistorySession} from './legacy-history';
import {TRAINING_HISTORY_SEGMENT_VERSION, type TrainingHistorySegment} from './training-history-segment';
type Mutable<T>={-readonly [P in keyof T]:T[P]};
import {RecordCalendarMetrics, projectRecordCalendarMetricFacts, recordCalendarWeek} from './record-calendar-metrics';

function full(id='s', start='2026-10-05T23:59:30Z', duration=60_000):LegacyHistorySession {
 let now=0, seq=0; const base=Date.parse(start);
 const engine=new TrainingEngine({sessionId:id, clock:{now:()=>now,wallTime:()=>new Date(base+now).toISOString(),id:()=>`${id}-event-${++seq}`}});
 engine.input('Could I have a coffee, please?');now+=duration;engine.sampleClock();engine.submit();
 const snapshot=engine.getSnapshot();return readLegacyHistoryRecord({sessionId:id,sequence:snapshot.sequence,updatedAt:new Date(base+now).toISOString(),snapshot});
}
function part(source:LegacyHistorySession,id='part'):TrainingHistorySegment {
 const s=source.snapshot;
 return {schemaVersion:TRAINING_HISTORY_SEGMENT_VERSION,sessionId:s.sessionId,segmentId:id,writerInstanceId:'w',generation:1,material:{id:s.material.id,version:s.material.version},rules:{trainingSchemaVersion:SCHEMA_VERSION,ruleVersion:RULE_VERSION,paceRuleVersion:PACE_RULE_VERSION},startedAt:s.createdAt,endedAt:null,coverage:'partial',replayable:false,
 facts:s.events.filter(e=>e.type!=='sessionStarted').map((e,i)=>{const origin={sourceEventId:e.eventId,ordinal:i+1,wallTime:e.wallTime,cueId:e.cueId};if(e.type==='inputCommitted')return {...origin,type:e.type,source:e.source,retention:'recorded',text:e.text};if(e.type==='timeAdvanced')return {...origin,type:e.type,deltaMs:e.deltaMs,durationCoverage:'observed'};if(e.type==='submitRequested')return {...origin,type:e.type,attemptId:e.attemptId,retention:'recorded',answer:e.answer};if(e.type==='judgmentApplied'){const a=s.attempts.find(a=>a.attemptId===e.attemptId)!;return {...origin,type:e.type,attemptId:e.attemptId,retention:'recorded',result:{answer:a.answer,words:a.words,errors:a.errors,accuracy:a.accuracy,alignment:a.alignment}};}throw Error(e.type);})};
}
async function metrics(sources:(LegacyHistorySession|TrainingHistorySegment)[],zone='UTC') {const index=new RecordCalendarMetrics(zone);for(const [i,source] of sources.entries())index.add(await projectRecordCalendarMetricFacts(source,`record-${i}`,zone));return index.getSnapshot();}
test('recorded submission, first-completed sentence and distinct matched term counts trace source IDs without answer text',async()=>{
 const result=await metrics([full()]);const day=result.days.find(d=>d.day==='2026-10-06')!;
 assert.equal(day.submissions.value,1);assert.equal(day.firstCompletions.value,1);assert.equal(day.matchedTerms.value,6);assert.equal(day.coverage,'partial');assert.ok(day.matchedTerms.sourceEventIds.length);
 assert.doesNotMatch(JSON.stringify(result),/Could I|coffee|please|answer|alignment/);
});
test('full, partial and repeated source copies deduplicate globally without hiding unknown partial completion fields',async()=>{
 const f=full(),p=part(f);const result=await metrics([f,p,p]);const day=result.days.find(d=>d.day==='2026-10-06')!;
 assert.equal(day.submissions.value,1);assert.equal(day.firstCompletions.value,1);assert.equal(day.matchedTerms.value,6);assert.equal(day.firstCompletions.unknownCount,0);
 const only=(await metrics([p])).days.find(d=>d.day==='2026-10-06')!;assert.equal(only.firstCompletions.value,null);assert.ok(only.firstCompletions.unknownCount>0);
});
test('weekly terms are a set, not daily sum, and missing/off dates are absent, never invented zero',async()=>{
 const result=await metrics([full('a','2026-10-05T12:00:00Z'),full('b','2026-10-06T12:00:00Z')]);
 assert.equal(result.days.length,2);assert.equal(result.weeks[0].matchedTerms.value,6);assert.equal(result.weeks[0].submissions.value,2);assert.equal(result.weeks[0].firstCompletions.value,2);assert.equal((await metrics([])).days.length,0);
 assert.deepEqual(recordCalendarWeek('2026-10-11'),{from:'2026-10-05',to:'2026-10-11'});
});
test('corrupt same source event, attempt identity and invalid wall times fail closed for affected metrics',async()=>{
 const f=full(),p=structuredClone(part(f)) as Mutable<TrainingHistorySegment>;const submit=p.facts.find(e=>e.type==='submitRequested')!;Object.assign(submit,{wallTime:'2026-10-07T00:00:00Z'});
 const result=await metrics([f,p]);assert.ok(result.conflictCount>0);assert.ok(result.days.every(d=>d.submissions.value===null));
 const bad=structuredClone(part(f)) as Mutable<TrainingHistorySegment>;Object.assign(bad.facts.find(e=>e.type==='judgmentApplied')!,{wallTime:'2026-02-30T00:00:00Z'});const invalid=await metrics([bad]);assert.ok(invalid.unlocatedCount>0);assert.ok(invalid.days.every(d=>d.firstCompletions.value===null&&d.matchedTerms.value===null));
});
test('observed input activity splits at local midnight, unions overlapping pages and sessions, and does not claim learning minutes',async()=>{
 const result=await metrics([full('a'),full('b')]);assert.equal(result.days.find(d=>d.day==='2026-10-05')!.inputActiveMs.value,30_000);assert.equal(result.days.find(d=>d.day==='2026-10-06')!.inputActiveMs.value,30_000);assert.equal(result.weeks[0].inputActiveMs.value,60_000);
 const shifted=await metrics([full()], 'Asia/Shanghai');assert.equal(shifted.days.length,1);assert.equal(shifted.days[0].inputActiveMs.value,60_000);
});
test('DST uses actual elapsed time; inconsistent or unpaired wall/delta evidence remains unknown',async()=>{
 const spring=await metrics([full('spring','2026-03-08T06:59:30Z')],'America/New_York');assert.equal(spring.days[0].inputActiveMs.value,60_000);
 const autumn=await metrics([full('fall','2026-11-01T05:59:30Z')],'America/New_York');assert.equal(autumn.days[0].inputActiveMs.value,60_000);
 const bad=structuredClone(part(full())) as Mutable<TrainingHistorySegment>;const time=bad.facts.find(e=>e.type==='timeAdvanced')!;Object.assign(time,{deltaMs:5_000});const result=await metrics([bad]);assert.ok(result.days.every(d=>d.inputActiveMs.value===null));assert.ok(result.days.some(d=>d.inputActiveMs.unknownCount>0));
});

test('pending, repeated, redacted and unavailable submissions stay occurrence counts, never completed exercises',async()=>{
 const p=structuredClone(part(full())) as Mutable<TrainingHistorySegment>;const request=p.facts.find(e=>e.type==='submitRequested')!;
 const repeated={...request,sourceEventId:'repeat-request',wallTime:'2026-10-07T12:00:00Z'};
 p.facts=[...p.facts.filter(e=>e.type!=='judgmentApplied'),repeated].map((e,i)=>({...e,ordinal:i+1}));
 const projected=await metrics([p]);assert.equal(projected.weeks[0].submissions.value,1);assert.equal(projected.days.find(d=>d.day==='2026-10-06')!.submissions.value,1);assert.equal(projected.days.find(d=>d.day==='2026-10-07')!.submissions.value,null);assert.equal(projected.weeks[0].firstCompletions.value,null);assert.equal(projected.weeks[0].matchedTerms.value,null);
 const redacted=structuredClone(p) as Mutable<TrainingHistorySegment>;redacted.facts=redacted.facts.map(e=>e.type==='submitRequested'?{sourceEventId:e.sourceEventId,ordinal:e.ordinal,wallTime:e.wallTime,cueId:e.cueId,type:e.type,attemptId:e.attemptId,retention:'redacted',redactionReason:'draft-predates-segment'}:e);
 assert.equal((await metrics([redacted])).weeks[0].submissions.value,1);
 const unavailable=structuredClone(part(full())) as Mutable<TrainingHistorySegment>;unavailable.facts=unavailable.facts.map(e=>e.type==='judgmentApplied'?{sourceEventId:e.sourceEventId,ordinal:e.ordinal,wallTime:e.wallTime,cueId:e.cueId,type:e.type,attemptId:e.attemptId,retention:'unavailable',reason:'judgment-not-applied'}:e);
 const unavailableMetrics=await metrics([unavailable]);assert.equal(unavailableMetrics.weeks[0].submissions.value,1);assert.equal(unavailableMetrics.weeks[0].matchedTerms.value,null);
});
test('explicitly frozen source durations are excluded, contradictory active evidence is quarantined',async()=>{
 const f=full(),p=structuredClone(part(f)) as Mutable<TrainingHistorySegment>;p.facts=p.facts.map(e=>e.type==='timeAdvanced'?{...e,deltaMs:null,durationCoverage:'frozen'}:e);
 const frozen=await metrics([p]);assert.ok(frozen.days.every(d=>d.inputActiveMs.value===null&&d.inputActiveMs.unknownCount===0));
 const conflict=await metrics([f,p]);assert.ok(conflict.conflictCount>0);assert.ok(conflict.days.every(d=>d.inputActiveMs.value===null));
});
test('an altered prior event invalidates dependent timing; malformed import cannot enter the projection',async()=>{
 const f=full(),p=structuredClone(part(f)) as Mutable<TrainingHistorySegment>;const input=p.facts.find(e=>e.type==='inputCommitted')!;Object.assign(input,{text:'different retained input'});
 const conflicted=await metrics([f,p]);assert.ok(conflicted.conflictCount>0);assert.ok(conflicted.days.every(d=>d.inputActiveMs.value===null));
 const bad=structuredClone(part(f)) as Mutable<TrainingHistorySegment>;Object.assign(bad.facts.find(e=>e.type==='judgmentApplied')!,{result:{answer:'bad',alignment:[],words:NaN,errors:0,accuracy:100}});
 await assert.rejects(()=>metrics([bad]));
});
test('different match results for the same attempt fail closed instead of unioning invented terms',async()=>{
 const f=full(),p=structuredClone(part(f)) as Mutable<TrainingHistorySegment>;const judgment=p.facts.find(e=>e.type==='judgmentApplied'&&e.retention==='recorded')!;
 if(judgment.type==='judgmentApplied'&&judgment.retention==='recorded'){Object.assign(judgment,{sourceEventId:'other-judgment'});Object.assign(judgment.result,{alignment:[{kind:'match',position:0,expected:'invented',actual:'invented'}]})}
 const result=await metrics([f,p]);assert.ok(result.conflictCount>0);assert.ok(result.days.every(d=>d.matchedTerms.value===null&&d.firstCompletions.value===null));
});
test('stored first completions are deduplicated by session, material version and cue, with unlocatable duplicates withheld',async()=>{
 const f=structuredClone(full());const a=f.snapshot.attempts[0],request=f.snapshot.events.find(e=>e.type==='submitRequested')!,judgment=f.snapshot.events.find(e=>e.type==='judgmentApplied')!;
 Object.assign(f.snapshot,{attempts:[a,{...a,attemptId:'again'}],events:[...f.snapshot.events,{...request,sequence:f.snapshot.sequence+1,eventId:'again-request',attemptId:'again'},{...judgment,sequence:f.snapshot.sequence+2,eventId:'again-result',attemptId:'again'}],sequence:f.snapshot.sequence+2});
 Object.assign(f.summary,{sequence:f.snapshot.sequence});const result=await metrics([f]);assert.equal(result.weeks[0].submissions.value,2);assert.equal(result.weeks[0].firstCompletions.value,1);
 const p=structuredClone(part(full())) as Mutable<TrainingHistorySegment>;const r=p.facts.find(e=>e.type==='submitRequested')!;p.facts=[...p.facts,{...r,sourceEventId:'undated-repeat',ordinal:p.facts.length+1,wallTime:'2026-02-30T00:00:00Z'}];
 const invalid=await metrics([p]);assert.ok(invalid.unlocatedCount>0);assert.ok(invalid.days.every(d=>d.submissions.value===null));
});
test('redacted overlap contributes occurrence provenance without restoring answer text or double-counting a full result',async()=>{
 const f=full(),p=structuredClone(part(f)) as Mutable<TrainingHistorySegment>;p.facts=p.facts.map(e=>e.type==='judgmentApplied'?{sourceEventId:e.sourceEventId,ordinal:e.ordinal,wallTime:e.wallTime,cueId:e.cueId,type:e.type,attemptId:e.attemptId,retention:'redacted',redactionReason:'request-outside-segment'}:e);
 const result=await metrics([p,f]);assert.equal(result.weeks[0].matchedTerms.value,6);assert.equal(result.weeks[0].firstCompletions.value,1);assert.equal(result.conflictCount,0);assert.doesNotMatch(JSON.stringify(result),/coffee|Could I/);
});

test('a partial copy with new judgment identity cannot move a full first completion to an earlier date',async()=>{
 const f=full(),p=structuredClone(part(f)) as Mutable<TrainingHistorySegment>;
 p.facts=p.facts.filter(e=>e.type==='submitRequested'||e.type==='judgmentApplied').map((e,i)=>({...e,sourceEventId:`earlier-${e.sourceEventId}`,ordinal:i+1,wallTime:'2026-10-05T12:00:00Z'}));
 const result=await metrics([f,p]);assert.ok(result.conflictCount>0);assert.ok(result.days.every(d=>d.firstCompletions.value===null&&d.matchedTerms.value===null));
});

test('partial judgment must follow its matching retained request in source order, even at an equal wall time',async()=>{
 const p=structuredClone(part(full())) as Mutable<TrainingHistorySegment>;
 p.facts=[...p.facts].reverse().map((e,i)=>({...e,ordinal:i+1}));const result=await metrics([p]);
 assert.equal(result.weeks[0].submissions.value,1);assert.equal(result.weeks[0].matchedTerms.value,null);assert.equal(result.weeks[0].firstCompletions.value,null);
});
test('same attempt under contradictory source rules is not combined across newly assigned event IDs',async()=>{
 const f=full(),p=structuredClone(part(f)) as Mutable<TrainingHistorySegment>;
 Object.assign(p.rules,{ruleVersion:'corrupt-rule'});p.facts=p.facts.map(e=>({...e,sourceEventId:`other-${e.sourceEventId}`}));
 const result=await metrics([f,p]);assert.ok(result.conflictCount>0);assert.ok(result.days.every(d=>d.submissions.value===null&&d.matchedTerms.value===null&&d.firstCompletions.value===null));
});

test('source-event collision quarantines every claimed attempt independent of scan order',async()=>{
 const p=structuredClone(part(full())) as Mutable<TrainingHistorySegment>;
 const request=p.facts.find(e=>e.type==='submitRequested')!;
 p.facts=[request,{...request,sourceEventId:'request-b',attemptId:'attempt-b'}].map((e,i)=>({...e,ordinal:i+1}));
 const collision={...p,segmentId:'collision',facts:[{...p.facts[0],ordinal:1,attemptId:'attempt-b'}]} as TrainingHistorySegment;
 for(const sources of [[p,collision],[collision,p]]){const result=await metrics(sources);assert.ok(result.conflictCount>0);assert.ok(result.days.every(d=>d.submissions.value===null))}
});

test('conflicting interval predecessor evidence is order-independent and never kept by first-wins merging',async()=>{
 const p=structuredClone(part(full())) as Mutable<TrainingHistorySegment>;
 p.facts=p.facts.filter(e=>e.type==='inputCommitted'||e.type==='timeAdvanced');
 const other={...p,segmentId:'other',facts:p.facts.map(e=>e.type==='inputCommitted'?{...e,sourceEventId:'other-input'}:e)} as TrainingHistorySegment;
 const changed={...p,segmentId:'changed',facts:p.facts.filter(e=>e.type==='inputCommitted').map(e=>({...e,text:'changed input'}))} as TrainingHistorySegment;
 for(const sources of [[p,other,changed],[other,p,changed]]){const result=await metrics(sources);assert.ok(result.conflictCount>0);assert.ok(result.days.every(d=>d.inputActiveMs.value===null))}
});

test('shape-valid but contradictory stored alignment positions/counts cannot manufacture matched terms',async()=>{
 for(const change of [(r:any)=>{r.words=0},(r:any)=>{r.errors=50},(r:any)=>{r.alignment[0].position=999},(r:any)=>{r.alignment[1].position=r.alignment[0].position},(r:any)=>{r.alignment[0].actual='different'}]){
  const p=structuredClone(part(full()));const j=p.facts.find(e=>e.type==='judgmentApplied'&&e.retention==='recorded')!;if(j.type==='judgmentApplied'&&j.retention==='recorded')change(j.result);
  const result=await metrics([p]);assert.ok(result.conflictCount>0);assert.ok(result.days.every(d=>d.matchedTerms.value===null));
 }
});

test('full attempts with mismatched rules, version or embedded reference are not accepted as result evidence',async()=>{
 for(const patch of [{ruleVersion:'different-rule'},{inputVersion:900},{reference:'different reference'}]){
  const f=structuredClone(full());Object.assign(f.snapshot.attempts[0],patch);const result=await metrics([f]);assert.ok(result.conflictCount>0);assert.ok(result.days.every(d=>d.matchedTerms.value===null&&d.firstCompletions.value===null));
 }
});

test('an observed duration cannot cross an explicitly retained pause or composition gate',async()=>{
 for(const blocker of [{type:'freezeChanged' as const,reason:'paused' as const,on:true},{type:'compositionStarted' as const}]){
  const p=structuredClone(part(full())) as Mutable<TrainingHistorySegment>;const input=p.facts.find(e=>e.type==='inputCommitted')!,time=p.facts.find(e=>e.type==='timeAdvanced')!;
  p.facts=[{sourceEventId:'blocker',ordinal:1,wallTime:input.wallTime,cueId:input.cueId,...blocker},{...time,ordinal:2}];const result=await metrics([p]);assert.ok(result.conflictCount>0);assert.ok(result.days.every(d=>d.inputActiveMs.value===null));
 }
});

test('rounding uncertainty cannot create a tiny interval on the previous local date',async()=>{
 const p=structuredClone(part(full('midnight','2026-10-06T00:00:00Z')));const time=p.facts.find(e=>e.type==='timeAdvanced')!;Object.assign(time,{deltaMs:60000.5});const result=await metrics([p]);assert.equal(result.days.some(d=>d.day==='2026-10-05'),false);assert.ok(result.days.every(d=>d.inputActiveMs.value===null));
});

test('real Training navigation clears composition before a later valid recorded input interval',async()=>{
 let now=0,id=0;const start=Date.parse('2026-10-06T12:00:00Z');const engine=new TrainingEngine({sessionId:'navigation',clock:{now:()=>now,wallTime:()=>new Date(start+now).toISOString(),id:()=>`nav-${++id}`}});
 engine.input('Start');engine.beginComposition();engine.nextCue();engine.input('Would you like it hot or iced?');now=60000;engine.sampleClock();engine.submit();const snapshot=engine.getSnapshot();
 const f=readLegacyHistoryRecord({sessionId:snapshot.sessionId,sequence:snapshot.sequence,updatedAt:new Date(start+now).toISOString(),snapshot});const result=await metrics([f]);assert.equal(snapshot.activeMs,60000);assert.equal(result.days[0].inputActiveMs.value,60000);assert.equal(result.conflictCount,0);
});

test('undated conflicting-source diagnostics are stable in either scan order',async()=>{
 const f=full(),p=structuredClone(part(f));Object.assign(p.facts.find(e=>e.type==='submitRequested')!,{wallTime:'2026-02-30T00:00:00Z'});
 for(const sources of [[f,p],[p,f]]){const result=await metrics(sources);assert.equal(result.unlocatedCount,1);assert.ok(result.conflictCount>0);assert.ok(result.days.every(d=>d.submissions.value===null))}
});
