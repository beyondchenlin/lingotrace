import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {TrainingEngine,replay,type NativeEditEvidence} from './training';
import {deriveInputRateTimeline,deriveLegacyInputRateTimeline,OBSERVED_INPUT_RATE_VERSION} from './input-rate-timeline';
import {IndexedDBTrainingRepository} from './repository';
import {exportStudioSession} from './session-export';
const ime=(data:string|null):NativeEditEvidence=>({version:'dom-edit-v1',kind:'compositionend',inputType:null,data});
function fixture(observed=true){let now=0,id=0,wallOffset=0;const clock={now:()=>now,wallTime:()=>new Date(1700000000000+now+wallOffset).toISOString(),id:()=>`observed-${++id}`};const engine=new TrainingEngine({sessionId:'observed-session',clock,...observed?{inputObservation:{runId:'page-A'}}:{}});return{engine,clock,advance(ms:number){now+=ms},tick(ms=1000){now+=ms;engine.sampleClock()},input(text:string,data:string){engine.input(text,'typed',{version:'dom-edit-v1',kind:'input',inputType:'insertText',data})},shiftWall(ms:number){wallOffset+=ms},read(){return deriveInputRateTimeline(engine.getSnapshot())}}}
const last=(f:ReturnType<typeof fixture>)=>f.read().points.at(-1)!;

test('first long composition starts observation without candidate text or practice time',()=>{
 const f=fixture();f.tick(20000);assert.equal(f.read().points.length,0);f.engine.beginComposition();
 assert.equal(last(f).state,'sampling');for(let i=0;i<6;i++)f.tick();
 assert.equal(last(f).cpm,0);assert.equal(last(f).observedMs,5000);assert.equal(f.engine.getSnapshot().activeMs,0);
 f.engine.endComposition('你好',ime('你好'));assert.equal(last(f).cpm,24);assert.equal(last(f).sourceEventIds.length,1);assert.equal(last(f).includesIME,true);
 assert.equal(f.read().version,OBSERVED_INPUT_RATE_VERSION);assert.equal(f.engine.getSnapshot().attempts.length,0);assert.equal(f.engine.getSnapshot().earnedWords,0);
 assert.ok(f.engine.getSnapshot().events.filter(e=>e.type==='inputObservationSampled').every(e=>!('text'in e)&&!('data'in e)));
});
test('successive IME cycles keep one observation window while activeMs still freezes',()=>{
 const f=fixture();f.engine.beginComposition();for(let i=1;i<=6;i++){f.tick();f.engine.endComposition('你'.repeat(i),ime('你'));if(i<6)f.engine.beginComposition()}
 assert.equal(last(f).cpm,60);assert.equal(last(f).sourceEventIds.length,5);assert.equal(f.engine.getSnapshot().activeMs,0);
 const proof=f.engine.getSnapshot().events.flatMap(e=>e.inputObservation?[e.inputObservation]:[]);assert.equal(new Set(proof.map(p=>p.segment)).size,1);
 assert.ok(!f.read().gaps.some(g=>g.reasons.includes('composition')));
});
test('explicit composition cancel is zero in v2; missing final data stays unavailable',()=>{
 const f=fixture();f.engine.beginComposition();for(let i=0;i<5;i++)f.tick();f.engine.endComposition('',ime(''));assert.equal(last(f).cpm,0);assert.equal(last(f).unknownEventIds.length,0);assert.equal(f.engine.draft,'');assert.equal(f.engine.getSnapshot().events.filter(e=>e.type==='inputCommitted').length,0);f.tick();assert.equal(last(f).cpm,0);assert.equal(last(f).state,'measured');
 const unknown=fixture();unknown.engine.beginComposition();for(let i=0;i<5;i++)unknown.tick();unknown.engine.endComposition('你',ime(null));assert.equal(last(unknown).state,'unavailable');assert.equal(last(unknown).cpm,null);
});
test('pauses, background, input/window blur and resume reset coverage without resetting facts',()=>{
 for(const reason of ['paused','background','blur'] as const){const f=fixture();f.input('a','a');for(let i=0;i<5;i++)f.tick();const saved=f.engine.getSnapshot();
  if(reason==='blur')f.engine.setInputObservationFocused(false);else f.engine.setFrozen(reason,true);
  assert.equal(last(f).state,'frozen');f.tick(20000);if(reason==='blur')f.engine.setInputObservationFocused(true);else f.engine.setFrozen(reason,false);
  assert.equal(last(f).state,'sampling');assert.equal(last(f).cpm,null);assert.equal(f.engine.draft,'a');assert.deepEqual(f.engine.getSnapshot().attempts,saved.attempts);
  f.input('ab','b');for(let i=0;i<4;i++)f.tick();assert.equal(last(f).cpm,null);f.tick();assert.equal(last(f).cpm,0);
 }
});
test('2500ms unobserved guard and monotonic regression break coverage, not practice or scores',()=>{
 const f=fixture();f.input('a','a');for(let i=0;i<5;i++)f.tick();const oldSegment=last(f).observationSegment;f.tick(2501);assert.equal(last(f).cpm,null);assert.notEqual(last(f).observationSegment,oldSegment);assert.ok(!f.engine.getSnapshot().frozenReasons.includes('paused'));
 f.advance(-1);f.engine.input('ab','typed',{version:'dom-edit-v1',kind:'input',inputType:'insertText',data:'b'});assert.equal(last(f).cpm,null);assert.equal(f.engine.getSnapshot().earnedWords,0);
});
test('wall-clock changes cannot inflate monotonic CPM',()=>{
 const f=fixture();f.input('a','a');f.tick();f.input('ab','b');f.shiftWall(-60000);for(let i=0;i<4;i++)f.tick();assert.equal(last(f).cpm,12);assert.ok(f.read().issues.some(i=>i.code==='wall-clock-reversed'));
});
test('legacy v1 prefix remains byte-equivalent and new restored observation starts a new window',()=>{
 const f=fixture(false);f.input('a','a');f.tick(1000);f.input('ab','b');f.tick(4000);const old=f.engine.getSnapshot(),oldJSON=JSON.stringify(old),oldPoints=deriveLegacyInputRateTimeline(old).points;
 const restored=new TrainingEngine({snapshot:old,clock:f.clock,inputObservation:{runId:'page-B'}});f.advance(100);restored.beginComposition();f.advance(1000);restored.sampleClock();restored.endComposition('ab你',ime('你'));
 const next=deriveInputRateTimeline(restored.getSnapshot());assert.equal(next.points.at(-1)?.cpm,null);assert.equal(JSON.stringify(old),oldJSON);assert.deepEqual(restored.getSnapshot().events.slice(0,old.events.length),old.events);
 assert.deepEqual(next.points.slice(0,oldPoints.length).map(({metricVersion,windowClock,...point})=>point),oldPoints);
 assert.equal(next.points[0].metricVersion,'input.cpm.5s.v1');assert.equal(next.points.at(-1)?.metricVersion,'input.cpm.5s.v2');
});
test('restored v2 resets run coverage and stores/replays/exports the same observation evidence',async()=>{
 const f=fixture();f.engine.beginComposition();for(let i=0;i<5;i++)f.tick();f.engine.endComposition('你好',ime('你好'));const before=f.engine.getSnapshot();
 const repository=new IndexedDBTrainingRepository({indexedDB:new IDBFactory(),dbName:'lingotrace-observation-fixture'});await repository.saveSession(before);const loaded=await repository.loadLatest();assert.deepEqual(loaded,before);
 const restored=new TrainingEngine({snapshot:loaded!,clock:f.clock,inputObservation:{runId:'page-restored'}});f.advance(100);restored.beginComposition();restored.endComposition('你好啊',ime('啊'));const state=restored.getSnapshot(),chart=deriveInputRateTimeline(state);assert.equal(chart.points.at(-1)?.cpm,null);assert.equal(chart.points.at(-1)?.observationRunId,'page-restored');
 const output=exportStudioSession(state,'2026-10-09T00:00:00.000Z');assert.deepEqual(JSON.parse(output.json).inputRateTimeline,chart);assert.ok(output.csv.includes('input.cpm.5s.v2'));assert.deepEqual(replay(state.events),state);await repository.close();
});
test('observation evidence cannot be malformed or stand alone without versioned proof',()=>{
 const f=fixture();f.input('a','a');const old=f.engine.getSnapshot(),base={...old.events.at(-1)!,sequence:old.sequence+1,eventId:'bad',inputVersion:1,activeMs:old.activeMs};
 assert.throws(()=>f.engine.dispatch({...base,type:'inputObservationSampled',inputObservation:undefined}),/requires versioned/);
 assert.throws(()=>f.engine.dispatch({...base,type:'inputObservationSampled',inputObservation:{version:'input-observation-v1',runId:'x',segment:1,atMs:NaN,state:'observing',reasons:[],restartReason:null}}),/Invalid input observation/);
 assert.equal(f.engine.getSnapshot(),old);
});


test('first commit transaction stays continuous when every now() read advances',()=>{
 let now=0,id=0;const engine=new TrainingEngine({clock:{now:()=>now+=.01,wallTime:()=>new Date(1700000000000+now).toISOString(),id:()=>`moving-${++id}`},inputObservation:{runId:'moving-page'}});
 engine.beginComposition();for(let i=0;i<6;i++){now+=1000;engine.sampleClock()}engine.endComposition('你',ime('你'));
 const point=deriveInputRateTimeline(engine.getSnapshot()).points.at(-1)!;assert.equal(point.cpm,12);assert.equal(point.observationSegment,1);assert.equal(engine.getSnapshot().attempts.length,0);
});

test('v2 excludes paste/delete/undo/redo and counts Unicode final graphemes once',()=>{
 const f=fixture();f.engine.beginComposition();for(let i=0;i<4;i++)f.tick();f.engine.endComposition('👩‍💻é',ime('👩‍💻é'));f.tick();
 assert.equal(last(f).cpm,24);assert.equal(last(f).addedGraphemes,2);
 const native=(inputType:string,data:string|null=null):NativeEditEvidence=>({version:'dom-edit-v1',kind:'input',inputType,data});
 for(const [text,inputType]of [['paste','insertFromPaste'],['past','deleteContentBackward'],['paste','historyUndo'],['past','historyRedo'],['drop','insertFromDrop']]){f.advance(50);f.engine.input(text,inputType==='insertFromPaste'?'paste':'typed',native(inputType))}
 assert.equal(last(f).cpm,24);assert.equal(last(f).excludedEventIds.length,5);assert.equal(last(f).sourceEventIds.length,1);assert.equal(f.engine.getSnapshot().earnedWords,0);
});
test('legacy empty-composition classification is not retrospectively changed',()=>{
 const f=fixture(false);f.input('a','a');f.tick();f.engine.endComposition('a',ime(''));f.tick(4000);
 const chart=f.read();assert.equal(chart.version,'input.cpm.5s.v1');assert.equal(chart.points.at(-1)?.cpm,null);assert.equal(chart.points.at(-1)?.state,'unavailable');
});
test('new round clears observation coverage without deleting the previous snapshot',()=>{
 const f=fixture();f.engine.beginComposition();for(let i=0;i<5;i++)f.tick();f.engine.endComposition('你',ime('你'));const old=f.engine.getSnapshot(),saved=JSON.stringify(old);f.engine.resetSession();assert.equal(f.read().points.length,0);
 f.engine.beginComposition();assert.equal(last(f).cpm,null);assert.notEqual(last(f).observationRunId,deriveInputRateTimeline(old).points.at(-1)?.observationRunId);assert.equal(JSON.stringify(old),saved);
});


test('changed final draft with empty native IME data is unknown rather than invented zero',()=>{
 const f=fixture();f.engine.beginComposition();for(let i=0;i<5;i++)f.tick();f.engine.endComposition('你',ime(''));assert.equal(last(f).state,'unavailable');assert.equal(last(f).cpm,null);assert.equal(last(f).unknownEventIds.length,1);
});
test('known pause duration is not duplicated as an unexplained gap',()=>{
 const f=fixture();f.input('a','a');for(let i=0;i<5;i++)f.tick();f.engine.setFrozen('paused',true);f.advance(20000);f.engine.setFrozen('paused',false);
 const chart=f.read();assert.ok(chart.gaps.some(g=>g.kind==='frozen'&&g.reasons.includes('paused')));for(const frozen of chart.gaps.filter(g=>g.kind==='frozen'))assert.ok(!chart.gaps.some(g=>g.kind==='unobserved'&&g.from.eventId===frozen.from.eventId&&g.to.eventId===frozen.to.eventId));
});

test('approved deterministic four-grapheme sample is 48 CPM without counting selection time as practice time',()=>{
 const f=fixture();f.engine.beginComposition();f.tick(500);f.tick(1000);f.engine.endComposition('你',ime('你'));
 f.tick(500);f.engine.beginComposition();f.tick(1000);f.engine.endComposition('你好啊',ime('好啊'));
 f.tick(500);f.engine.beginComposition();f.tick(1000);f.engine.endComposition('你好啊！',ime('！'));f.tick(500);
 assert.equal(last(f).cpm,48);assert.equal(last(f).wpmEquivalent,9.6);assert.equal(last(f).sourceEventIds.length,3);assert.equal(f.engine.getSnapshot().activeMs,1500);assert.equal(f.engine.getSnapshot().attempts.length,0);assert.equal(f.engine.getSnapshot().earnedWords,0);
});
