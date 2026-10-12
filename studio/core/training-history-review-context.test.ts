import test from 'node:test';
import assert from 'node:assert/strict';
import {TrainingEngine} from './training';
import {TrainingHistoryRecorder,type TrainingHistoryRecordingAccess} from './training-history-recorder';
import type {AutomaticHistoryControl} from './automatic-history-control';
import type {TrainingHistorySegmentPermit} from './repository';
function deferred<T>() { let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return {promise,resolve}; }
function setup(overrides:Partial<TrainingHistoryRecordingAccess>={}){
 let n=0;let control:AutomaticHistoryControl={state:'legacy-default',generation:0};const permit={} as TrainingHistorySegmentPermit;
 const engine=new TrainingEngine({sessionId:'review-context',clock:{now:()=>0,wallTime:()=>new Date(0).toISOString(),id:()=>`evt-${++n}`}});
 const repository:TrainingHistoryRecordingAccess={saveSession:async()=>{},readAutomaticHistoryControl:async()=>control,
  disableAutomaticHistory:async()=>control={state:'segment-off',generation:control.generation+1},enableAutomaticHistory:async()=>control={state:'segment-on',generation:control.generation+1},
  beginTrainingHistorySegment:async segment=>({segment,permit}),saveTrainingHistorySegment:async(_permit,segment)=>segment,revokeTrainingHistorySegment:()=>{},...overrides};
 const history=new TrainingHistoryRecorder(repository,{clock:{id:()=>`seg-${++n}`,wallTime:()=>new Date(0).toISOString()}});history.connect(engine.getSnapshot(),control);engine.subscribe(()=>history.observe(engine.getSnapshot()));return {history,engine};
}
test('review locator exists only after successful clean legacy save, has no answer or grant',async()=>{
 const f=setup();assert.equal(f.history.getCommittedReviewSession(),null);await f.history.flush();
 assert.deepEqual(f.history.getCommittedReviewSession(),{kind:'full',sessionId:'review-context',generation:0});
 assert.ok(Object.isFrozen(f.history.getCommittedReviewSession()));f.engine.input('private draft');assert.equal(f.history.getCommittedReviewSession(),null);
 await f.history.flush();assert.deepEqual(Object.keys(f.history.getCommittedReviewSession()!).sort(),['generation','kind','sessionId']);
});
test('pending legacy save and failure never yield committed locator',async()=>{
 const hold=deferred<void>();const f=setup({saveSession:()=>hold.promise});const saving=f.history.flush();assert.equal(f.history.getCommittedReviewSession(),null);hold.resolve();await saving;assert.ok(f.history.getCommittedReviewSession());
 const failed=setup({saveSession:async()=>{throw Error('quota')}});await failed.history.flush();assert.equal(failed.history.getCommittedReviewSession(),null);
});
test('segment locator follows admitted current segment, never complete reconstruction',async()=>{
 const f=setup();await f.history.turnOff();assert.equal(f.history.getCommittedReviewSession(),null);await f.history.turnOn();
 const admitted=f.history.getCommittedReviewSession();assert.equal(admitted?.kind,'partial');assert.equal(admitted?.generation,2);assert.ok(admitted&&'segmentId' in admitted);
 f.engine.input('post ON','typed',{version:'dom-edit-v1',kind:'input',inputType:'insertText',data:'post ON'});assert.equal(f.history.getCommittedReviewSession(),null);await f.history.flush();assert.deepEqual(f.history.getCommittedReviewSession(),admitted);
});
test('read persisted ON alone, suspend, disposal and OFF revoke locator immediately',async()=>{
 const f=setup();await f.history.flush();f.history.connect(f.engine.getSnapshot(),{state:'segment-on',generation:4});assert.equal(f.history.getCommittedReviewSession(),null);
 await f.history.turnOn();assert.ok(f.history.getCommittedReviewSession());f.history.suspend();assert.equal(f.history.getCommittedReviewSession(),null);
 const g=setup();await g.history.flush();const pending=g.history.turnOff();assert.equal(g.history.getCommittedReviewSession(),null);await pending;g.history.dispose();assert.equal(g.history.getCommittedReviewSession(),null);
});
test('new event while save awaits keeps context unavailable until its own flush',async()=>{
 const hold=deferred<void>();let count=0;const f=setup({saveSession:async()=>{if(++count===1)await hold.promise}});const first=f.history.flush();f.engine.input('tail');hold.resolve();await first;assert.equal(f.history.getCommittedReviewSession(),null);await f.history.flush();assert.ok(f.history.getCommittedReviewSession());
});
