import test from 'node:test';
import assert from 'node:assert/strict';
import {TrainingEngine, type TrainingSnapshot} from './training.ts';
import {TrainingHistoryRecorder, type TrainingHistoryRecordingAccess} from './training-history-recorder.ts';
import type {AutomaticHistoryControl} from './automatic-history-control.ts';

const legacy={state:'legacy-default',generation:0} as const;
function setup(overrides:Partial<TrainingHistoryRecordingAccess>={}){
 let serial=0,now=0,writes=0;
 const clock={now:()=>now,id:()=>`passive-history-${++serial}`,wallTime:()=>new Date(1700000000000+now).toISOString()};
 const original=new TrainingEngine({clock});original.input('saved draft');original.setFrozen('modal',true);
 const saved=original.getSnapshot(),engine=new TrainingEngine({snapshot:saved,clock,restoredReadOnly:true,inputObservation:{runId:'restored-run'}});
 const repo:TrainingHistoryRecordingAccess={saveSession:async()=>{writes++},readAutomaticHistoryControl:async()=>legacy,
  disableAutomaticHistory:async()=>({state:'off',generation:1}),enableAutomaticHistory:async()=>({state:'segment-on',generation:2}),
  beginTrainingHistorySegment:async()=>{throw Error('not used')},saveTrainingHistorySegment:async()=>{throw Error('not used')},revokeTrainingHistorySegment(){},...overrides};
 const recorder=new TrainingHistoryRecorder(repo,{clock,writerInstanceId:'passive-page'});
 return {engine,saved,recorder,repo,get writes(){return writes},advance:(ms:number)=>{now+=ms}};
}
test('initial verified stored baseline connects clean atomically and browsing flushes never call saveSession',async()=>{
 const f=setup();assert.equal(f.engine.isPassiveRestored,true);const states:boolean[]=[];
 f.recorder.subscribe(()=>{states.push(f.recorder.getSnapshot().dirty);void f.recorder.flush()});
 f.recorder.connectRestoredBaseline(f.engine.getSnapshot(),legacy,f.saved);
 const baseline=f.engine.getSnapshot();f.engine.subscribe(()=>f.recorder.observe(f.engine.getSnapshot()));
 for(let i=0;i<3;i++){f.engine.setFrozen('modal',false);f.engine.setFrozen('modal',true);f.engine.setInputObservationFocused(false);f.advance(30000);f.engine.sampleClock();await f.recorder.flush()}
 assert.strictEqual(f.engine.getSnapshot(),baseline);assert.equal(f.writes,0);assert.deepEqual(states,[false]);assert.equal(f.recorder.getSnapshot().error,null);
 f.recorder.dispose();
});
test('clean admission compares the complete stored snapshot rather than matching id and sequence',()=>{
 const f=setup(),forged={...f.saved,earnedWords:f.saved.earnedWords+1} as TrainingSnapshot;
 assert.throws(()=>f.recorder.connectRestoredBaseline(f.engine.getSnapshot(),legacy,forged),/verified initial/);
 assert.equal(f.recorder.getSnapshot().mode,'unprepared');f.recorder.connectRestoredBaseline(f.engine.getSnapshot(),legacy,f.saved);assert.equal(f.recorder.getSnapshot().dirty,false);f.recorder.dispose();
});
for(const state of ['off','segment-off','segment-on'] as const)test(`clean admission never grants ${state} a legacy write capability`,()=>{
 const f=setup(),control={state,generation:2} as AutomaticHistoryControl;
 assert.throws(()=>f.recorder.connectRestoredBaseline(f.engine.getSnapshot(),control,f.saved),/verified initial/);
 assert.equal(f.recorder.getSnapshot().mode,'unprepared');f.recorder.connect(f.engine.getSnapshot(),control);assert.equal(f.recorder.getSnapshot().mode,state==='segment-on'?'awaiting-segment':'off');assert.equal(f.recorder.getSnapshot().dirty,false);f.recorder.dispose();
});
test('generic legacy connect remains dirty and can never be relabeled a clean initial restore',()=>{
 const f=setup();f.recorder.connect(f.engine.getSnapshot(),legacy);const before=f.recorder.getSnapshot();
 assert.throws(()=>f.recorder.connectRestoredBaseline(f.engine.getSnapshot(),legacy,f.saved),/verified initial/);assert.strictEqual(f.recorder.getSnapshot(),before);
 f.recorder.suspend();assert.equal(f.recorder.resumeRestoredBaseline(f.engine.getSnapshot(),legacy),false);f.recorder.dispose();
});
test('untouched passive bfcache baseline may resume clean without fresh admission or writes',async()=>{
 const f=setup();const baseline=f.engine.getSnapshot();f.recorder.connectRestoredBaseline(baseline,legacy,f.saved);
 for(let i=0;i<3;i++){f.recorder.suspend();f.engine.setInputObservationFocused(false);f.engine.setFrozen('background',true);f.advance(60000);f.engine.setFrozen('background',false);assert.equal(f.recorder.resumeRestoredBaseline(baseline,legacy),true);await f.recorder.flush()}
 assert.equal(f.writes,0);assert.equal(f.engine.isPassiveRestored,true);assert.strictEqual(f.engine.getSnapshot(),baseline);f.recorder.dispose();
});
test('one real fact permanently revokes clean bfcache capability even after successful saving',async()=>{
 const f=setup();f.recorder.connectRestoredBaseline(f.engine.getSnapshot(),legacy,f.saved);f.engine.subscribe(()=>f.recorder.observe(f.engine.getSnapshot()));
 f.engine.setFrozen('modal',false);f.engine.input('new real draft');assert.equal(f.engine.isPassiveRestored,false);assert.equal(f.recorder.getSnapshot().dirty,true);await f.recorder.flush();assert.equal(f.writes,1);
 f.recorder.suspend();assert.equal(f.recorder.resumeRestoredBaseline(f.engine.getSnapshot(),legacy),false);assert.throws(()=>f.recorder.connectRestoredBaseline(f.engine.getSnapshot(),legacy,f.engine.getSnapshot()),/verified initial/);
 f.recorder.connect(f.engine.getSnapshot(),legacy);assert.equal(f.recorder.getSnapshot().dirty,true);f.recorder.dispose();
});
test('clean APIs cannot erase an in-flight write or its eventual failure and retry',async()=>{
 let reject!:(error:Error)=>void,writes=0,fail=true;
 const f=setup({saveSession:()=>{writes++;return fail?new Promise<void>((_,no)=>{reject=no}):Promise.resolve()}});
 f.recorder.connectRestoredBaseline(f.engine.getSnapshot(),legacy,f.saved);f.engine.subscribe(()=>f.recorder.observe(f.engine.getSnapshot()));f.engine.input('changed');
 const pending=f.recorder.flush();assert.equal(f.recorder.getSnapshot().pendingWrites,1);const state=f.recorder.getSnapshot();
 assert.throws(()=>f.recorder.connectRestoredBaseline(f.engine.getSnapshot(),legacy,f.saved),/verified initial/);assert.equal(f.recorder.resumeRestoredBaseline(f.engine.getSnapshot(),legacy),false);assert.strictEqual(f.recorder.getSnapshot(),state);
 reject(Error('quota'));await pending;assert.equal(f.recorder.getSnapshot().dirty,true);assert.match(f.recorder.getSnapshot().error!,/尚未保存/);
 assert.throws(()=>f.recorder.connectRestoredBaseline(f.engine.getSnapshot(),legacy,f.engine.getSnapshot()),/verified initial/);assert.equal(f.recorder.getSnapshot().dirty,true);
 fail=false;await f.recorder.flush();assert.equal(writes,2);assert.equal(f.recorder.getSnapshot().dirty,false);f.recorder.dispose();
});
test('generic reconnect and OFF revoke the original clean-only capability',async()=>{
 for(const action of ['connect','off'] as const){const f=setup();f.recorder.connectRestoredBaseline(f.engine.getSnapshot(),legacy,f.saved);
  if(action==='connect')f.recorder.connect(f.engine.getSnapshot(),legacy);else await f.recorder.turnOff();
  f.recorder.suspend();assert.equal(f.recorder.resumeRestoredBaseline(f.engine.getSnapshot(),legacy),false);f.recorder.dispose();
 }
});
test('recovered composition/judgment changes cannot be admitted as the old clean baseline',()=>{
 const f=setup();const original=new TrainingEngine();original.beginComposition();const interrupted=original.getSnapshot();
 const recovered=new TrainingEngine({snapshot:interrupted,restoredReadOnly:true});assert.equal(recovered.isPassiveRestored,false);
 assert.throws(()=>f.recorder.connectRestoredBaseline(recovered.getSnapshot(),legacy,interrupted),/verified initial/);
 f.recorder.connect(recovered.getSnapshot(),legacy);assert.equal(f.recorder.getSnapshot().dirty,true);f.recorder.dispose();
});
