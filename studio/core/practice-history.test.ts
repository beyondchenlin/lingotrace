import test from 'node:test';
import assert from 'node:assert/strict';
import {PracticeEngine,ORIGINAL_PRACTICE_MATERIAL,redactPracticeAttempt,type PracticeMaterial} from './practice';
import {projectPracticeHistory,normalizePracticeHistoryQuery,type PracticeHistoryQuery} from './practice-history';

const query:PracticeHistoryQuery={fromInclusive:'2026-10-07T00:00:00.000Z',toExclusive:'2026-10-10T00:00:00.000Z',timeZone:'UTC'};
function fixture(id='history',base='2026-10-08T00:00:00.000Z',catalog:readonly PracticeMaterial[]=[ORIGINAL_PRACTICE_MATERIAL]){
 let elapsed=0,wall=Date.parse(base),serial=0;
 const clock={now:()=>elapsed,wallTime:()=>new Date(wall).toISOString(),id:()=>`${id}-event-${++serial}`};
 const engine=new PracticeEngine({sessionId:id,catalog,clock});
 return{engine,clock,tick(ms:number,wallMs=ms){elapsed+=ms;wall+=wallMs},start(mode:'dictation'|'recording-comparison'='dictation'){
  engine.startRound({materialId:catalog[0].materialId});return engine.startAttempt({unitId:catalog[0].units[0].unitId,mode,attemptId:`${id}-a1`});
 },project(q=query){return projectPracticeHistory([engine.getSnapshot()],q)}};
}

test('3 empty and unopened calendar days are unknown, never fabricated zero coverage',()=>{
 const p=projectPracticeHistory([],query);
 assert.equal(p.totals.attemptsStarted.value,null);assert.equal(p.totals.recordedActiveMs.value,null);
 assert.deepEqual(p.days.map(d=>[d.day,d.coverage,d.metrics.firstSubmissions.value]),[['2026-10-07','unmeasured',null],['2026-10-08','unmeasured',null],['2026-10-09','unmeasured',null]]);
 assert.equal(p.coverage.collectionStartedAt,null);assert.equal(p.coverage.collectionIntervals,null);assert.equal(p.coverage.firstObservedAt,null);
 const f=fixture();assert.deepEqual(f.project().totals,p.totals,'merely registering a catalog does not start practice');
 f.start();const started=f.project();assert.equal(started.days[1].coverage,'partial');assert.equal(started.days[1].metrics.firstSubmissions.value,0);assert.equal(started.days[0].metrics.firstSubmissions.value,null);
 assert.equal(started.coverage.collectionStartedAt,null);assert.equal(started.coverage.firstObservedAt,'2026-10-08T00:00:00.000Z');
});

test('3 first submission and revisions keep distinct meanings; repeated delivery and same draft do not inflate',()=>{
 const f=fixture();const a=f.start();f.engine.input('X');const first=f.engine.submit();f.engine.input(a.reference.text);f.engine.submit();f.engine.submit();
 const snapshot=f.engine.getSnapshot(),p=projectPracticeHistory([snapshot,snapshot],query);
 assert.equal(p.totals.attemptsStarted.value,1);assert.equal(p.totals.firstSubmissions.value,1);assert.equal(p.totals.revisions.value,1);
 assert.equal(p.totals.independentFirstWordMatch.value,first.alignment!.accuracy);assert.equal(p.history[0].firstResult?.targetMet,false);assert.equal(p.history[0].currentTargetMet,true);
 f.engine.input('changed after success');const edited=f.project();assert.equal(edited.history[0].currentEvaluationComplete,false);assert.equal(edited.history[0].currentTargetMet,null);assert.equal(edited.history[0].firstResult?.targetMet,false);
 assert.equal(JSON.stringify(edited).includes('changed after success'),false);assert.equal(JSON.stringify(edited).includes(a.reference.text),false);
 assert.equal(JSON.stringify(f.engine.getSnapshot()),JSON.stringify(f.engine.getSnapshot()),'read model does not dispatch events');
});

test('3 explicit retries count attempts but unique units deduplicate across attempts, modes and days',()=>{
 const f=fixture();const a=f.start();f.engine.input(a.reference.text);f.engine.submit();f.engine.retryAttempt();f.engine.input('X');f.engine.submit();f.engine.switchMode('recording-comparison');
 f.engine.pausePractice();f.tick(86400000);f.engine.resumePractice();f.engine.input('note');
 const p=f.project();assert.equal(p.totals.attemptsStarted.value,3);assert.equal(p.totals.uniqueUnits.value,1);assert.equal(p.days[1].metrics.uniqueUnits.value,1);assert.equal(p.days[2].metrics.uniqueUnits.value,1);
 assert.equal(p.totals.firstSubmissions.value,2);assert.equal(p.history.find(r=>r.mode==='recording-comparison')?.currentEvaluationComplete,false);
 assert.equal(p.unavailable.includes('audio-assessment'),true);
});

test('3 input effort counts committed added graphemes, with paste and deletion excluded',()=>{
 const f=fixture();f.start();f.engine.input('copied','paste');f.engine.input('copied👩‍💻','ime');f.engine.input('copied👩‍💻!');f.engine.input('copied');f.engine.input('copied');f.engine.submit();
 const p=f.project();assert.equal(p.totals.typedGraphemes.value,2);assert.equal(p.totals.typedGraphemes.unit,'graphemes');assert.equal(p.totals.inputCommits.value,4);
 assert.equal(p.totals.independentFirstWordMatch.value,null);assert.notEqual(p.totals.assistedFirstWordMatch.value,null);assert.equal(p.history[0].firstResult?.assisted,true);
});

test('3 first-answer word match is weighted by reference tokens and assistance stays separate',()=>{
 const catalog:PracticeMaterial[]=[{materialId:'words',title:'Original word fixture',rights:'Original test text',durationSeconds:20,units:[{unitId:'short',references:[{referenceVersion:'v1',text:'one two',startSeconds:0,endSeconds:5}]},{unitId:'long',references:[{referenceVersion:'v1',text:'one two three four five six',startSeconds:5,endSeconds:10}]}]}];
 const f=fixture('weighted',undefined,catalog);f.start();f.engine.input('one no');f.engine.submit();f.engine.startAttempt({unitId:'long',mode:'dictation'});f.engine.input('one two three four five six');f.engine.submit();
 f.engine.exposeReference('hint');f.engine.retryAttempt();f.engine.input('one two three four five six');f.engine.submit();
 const p=f.project(),ind=p.totals.independentFirstWordMatch,ass=p.totals.assistedFirstWordMatch;
 assert.equal(ind.numerator,7);assert.equal(ind.denominator,8);assert.equal(ind.value,87.5);assert.equal(ind.unit,'percent');assert.equal(ass.value,100);assert.equal(ass.denominator,6);
 assert.equal(p.totals.firstSubmissions.value,3);assert.equal(p.totals.uniqueUnits.value,2);
});

test('3 manual pause is excluded and video pause remains practice time',()=>{
 const f=fixture();f.start();f.tick(10000);f.engine.pausePractice();f.tick(20000);assert.throws(()=>f.engine.input('blocked'));f.engine.resumePractice();f.tick(5000);f.engine.setVideoPaused(true);f.tick(2500);f.engine.sampleClock();
 const p=f.project();assert.equal(p.totals.recordedActiveMs.value,17500);assert.equal(p.unallocatedTime.milliseconds,0);assert.equal(p.days[1].metrics.recordedActiveMs.value,17500);
});

test('3 intervals split at explicit local midnight, clip to query and preserve fractional milliseconds',()=>{
 const f=fixture('midnight','2026-10-08T15:59:59.000Z');f.start();f.tick(2500.5);f.engine.sampleClock();
 const p=f.project({...query,timeZone:'Asia/Shanghai'});assert.equal(p.totals.recordedActiveMs.value,2500.5);
 // Wall stamps truncate sub-ms; the elapsed interval ends at 16:00:01.500Z.
 assert.equal(p.days.find(d=>d.day==='2026-10-08')!.metrics.recordedActiveMs.value,1000.5);
 assert.equal(p.days.find(d=>d.day==='2026-10-09')!.metrics.recordedActiveMs.value,1500);
 const clipped=f.project({fromInclusive:'2026-10-08T16:00:00.000Z',toExclusive:'2026-10-08T16:00:01.000Z',timeZone:'Asia/Shanghai'});
 assert.equal(clipped.totals.recordedActiveMs.value,1000);assert.equal(clipped.totals.attemptsStarted.value,0);assert.equal(clipped.history[0].startedInRange,false);
});

test('3 simultaneous recorded intervals from separate tabs are unioned, not double counted',()=>{
 const a=fixture('tab-a','2026-10-08T23:59:55.000Z'),b=fixture('tab-b','2026-10-09T00:00:00.000Z');a.start();b.start();a.tick(10000);a.engine.sampleClock();b.tick(10000);b.engine.sampleClock();
 const p=projectPracticeHistory([b.engine.getSnapshot(),a.engine.getSnapshot()],query);
 assert.equal(p.totals.recordedActiveMs.value,15000);assert.equal(p.days[1].metrics.recordedActiveMs.value,5000);assert.equal(p.days[2].metrics.recordedActiveMs.value,10000);
 assert.equal(p.totals.attemptsStarted.value,2);assert.equal(p.totals.uniqueUnits.value,1);
 assert.deepEqual(p,projectPracticeHistory([a.engine.getSnapshot(),b.engine.getSnapshot()],query));
});

test('3 deleting a1 removes its counts, content and time while preserving a2 assisted first evidence',()=>{
 const f=fixture();const a1=f.start();f.engine.exposeReference('hint');f.engine.input('PRIVATE_DELETED_CANARY','paste');f.tick(13007);f.engine.submit();const a2=f.engine.retryAttempt();f.engine.input(a2.reference.text);f.tick(5000);f.engine.submit();
 let serial=0;const redacted=redactPracticeAttempt(f.engine.getSnapshot(),{attemptId:a1.attemptId,redactionId:'privacy-delete',eventId:()=>`new-redaction-${++serial}`});
 const p=projectPracticeHistory([redacted],query);assert.equal(p.history.length,1);assert.equal(p.history[0].attemptId,a2.attemptId);assert.equal(p.totals.attemptsStarted.value,1);assert.equal(p.totals.firstSubmissions.value,1);assert.equal(p.totals.recordedActiveMs.value,5000);assert.equal(p.totals.assistedFirstWordMatch.value,100);assert.equal(p.totals.independentFirstWordMatch.value,null);
 assert.equal(JSON.stringify(p).includes('PRIVATE_DELETED_CANARY'),false);assert.equal(JSON.stringify(p).includes('13007'),false);assert.equal(JSON.stringify(p).includes(a1.attemptId),false);
 assert.equal(p.coverage.reasons.includes('retained-history-has-redactions'),true);
});

test('3 incompatible wall clock leaves time unallocated and does not invent earlier calendar activity',()=>{
 const f=fixture();f.start();f.tick(1000);f.engine.sampleClock();f.tick(5000,20000);f.engine.sampleClock();const p=f.project();
 assert.equal(p.totals.recordedActiveMs.value,null);assert.equal(p.totals.recordedActiveMs.observedValue,1000);assert.equal(p.unallocatedTime.milliseconds,5000);assert.equal(p.unallocatedTime.reason,'incompatible-wall-clock');assert.equal(p.days[0].coverage,'unmeasured');
 const restoreClock={...f.clock,now:()=>100000};const restored=new PracticeEngine({snapshot:f.engine.getSnapshot(),clock:restoreClock});assert.deepEqual(projectPracticeHistory([restored.getSnapshot()],query),p);
 const earlier=projectPracticeHistory([f.engine.getSnapshot()],{fromInclusive:'2026-10-08T00:00:02.000Z',toExclusive:'2026-10-08T00:00:03.000Z',timeZone:'UTC'});
 assert.equal(earlier.history.length,0);assert.equal(earlier.totals.recordedActiveMs.value,null);
});

test('3 first and revised submissions on different days are assigned to their own event dates',()=>{
 const f=fixture('days','2026-10-08T23:59:59.000Z');const a=f.start();f.engine.input('X');f.engine.submit();f.engine.pausePractice();f.tick(2000);f.engine.resumePractice();f.engine.input(a.reference.text);f.engine.submit();
 const p=f.project();assert.equal(p.days[1].metrics.firstSubmissions.value,1);assert.equal(p.days[2].metrics.firstSubmissions.value,0);assert.equal(p.days[2].metrics.revisions.value,1);assert.equal(p.days[2].metrics.independentFirstWordMatch.value,null);
});

test('3 unsupported evaluation remains null rather than a zero score or invented completion',()=>{
 const f=fixture('recording');f.start('recording-comparison');f.engine.input('practice note');const p=f.project();
 assert.equal(p.history[0].practiceComplete,false);assert.equal(p.history[0].currentTargetMet,null);assert.equal(p.history[0].firstResult,null);assert.equal(p.totals.independentFirstWordMatch.value,null);
 const material:PracticeMaterial={materialId:'empty-words',title:'Original punctuation fixture',rights:'Original test text',durationSeconds:null,units:[{unitId:'u',references:[{referenceVersion:'v1',text:'…',startSeconds:0,endSeconds:1}]}]};
 const empty=fixture('unscorable',undefined,[material]);empty.start();empty.engine.input('text');empty.engine.submit();const result=empty.project();
 assert.equal(result.history[0].practiceComplete,true);assert.equal(result.history[0].currentEvaluationComplete,false);assert.equal(result.totals.independentFirstWordMatch.value,null);
});

test('3 input and output are immutable and different same-session branches are conflicts',()=>{
 const f=fixture();f.start();const old=f.engine.getSnapshot(),bytes=JSON.stringify(old),p=f.project();
 assert.equal(JSON.stringify(old),bytes);assert.throws(()=>{(p.days as unknown[]).push({})},TypeError);assert.throws(()=>{(p.totals.attemptsStarted as {value:number}).value=99},TypeError);
 f.engine.input('new');assert.throws(()=>projectPracticeHistory([old,f.engine.getSnapshot()],query),/conflict/i);
});

test('3 queries require bounded canonical instants and an explicit valid time zone',()=>{
 for(const bad of [{...query,timeZone:''},{...query,timeZone:'Not/A_Zone'},{...query,fromInclusive:'2026-10-07'},{...query,toExclusive:query.fromInclusive},{...query,toExclusive:'2028-10-01T00:00:00.000Z'}])assert.throws(()=>normalizePracticeHistoryQuery(bad));
 assert.equal(normalizePracticeHistoryQuery({...query,timeZone:'Etc/UTC'}).timeZone,'UTC');
});


test('history range labels tolerate midnight rollback and full-range date-line skips',()=>{
 const rollback={fromInclusive:'1988-10-30T02:00:00.000Z',toExclusive:'1988-10-30T03:00:00.000Z',timeZone:'America/Goose_Bay'};
 assert.deepEqual(projectPracticeHistory([],rollback).days.map(d=>d.day),['1988-10-29','1988-10-30']);
 const f=fixture('rollback',rollback.fromInclusive);f.start();f.tick(3600000);f.engine.sampleClock();
 const projected=f.project(rollback);
 assert.equal(projected.totals.recordedActiveMs.value,3600000);
 assert.equal(projected.days.reduce((sum,d)=>sum+d.metrics.recordedActiveMs.observedValue,0),3600000);
 const skipped=projectPracticeHistory([],{fromInclusive:'2011-01-01T12:00:00.000Z',toExclusive:'2012-01-02T12:00:00.000Z',timeZone:'Pacific/Apia'});
 assert.equal(skipped.days.length,368);
 assert.equal(skipped.days.find(d=>d.day==='2011-12-30')?.coverage,'unmeasured');
});
