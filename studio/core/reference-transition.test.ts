import test from 'node:test';
import assert from 'node:assert/strict';
import {TrainingEngine} from './training.ts';
import {TrainingHistoryRecorder} from './training-history-recorder.ts';
import {flushReferenceTransition} from './reference-transition.ts';
import type {AutomaticHistoryControl} from './automatic-history-control.ts';
function gate(){let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes});return{promise,resolve}}
function fixture(save:()=>Promise<void>=async()=>{}){
 let n=0;const engine=new TrainingEngine({clock:{now:()=>0,wallTime:()=>new Date(0).toISOString(),id:()=>`transition-${++n}`}});
 const history=new TrainingHistoryRecorder({saveSession:save} as never,{writerInstanceId:'transition-test'});
 const control={state:'legacy-default',generation:0} as const;history.connect(engine.getSnapshot(),control);engine.subscribe(()=>history.observe(engine.getSnapshot()));
 const run=(extra:Partial<Parameters<typeof flushReferenceTransition>[0]>={})=>flushReferenceTransition({snapshot:engine.getSnapshot,history,readControl:async()=>control,verifyTarget:async()=>{},isCurrent:()=>true,...extra});
 return{engine,history,run,control};
}
test('verified unchanged boundary is fully saved before the caller can reset',async()=>{const f=fixture();f.engine.input('saved');const result=await f.run();assert.equal(result.sequence,f.engine.getSnapshot().sequence);assert.equal(f.history.getSnapshot().dirty,false);assert.equal(f.engine.draft,'saved')});
test('new input during flush aborts instead of dropping dirty tail with no error',async()=>{const g=gate(),f=fixture(()=>g.promise);f.engine.input('old');const before=f.engine.getSnapshot().sessionId,p=f.run();await Promise.resolve();await Promise.resolve();f.engine.input('new tail');g.resolve();await assert.rejects(p,/变化|尚未保存/);assert.equal(f.engine.getSnapshot().sessionId,before);assert.equal(f.engine.draft,'new tail');assert.equal(f.history.getSnapshot().dirty,true)});
for(const action of ['reveal','cue','hidden']as const)test(`${action} during target readback aborts and retains old facts`,async()=>{const g=gate(),f=fixture(),old=f.engine.getSnapshot().sessionId;const p=f.run({verifyTarget:()=>g.promise});if(action==='reveal')f.engine.exposeHint('reveal');else if(action==='cue')f.engine.nextCue(1);else f.engine.setFrozen('background',true);g.resolve();await assert.rejects(p,/变化/);assert.equal(f.engine.getSnapshot().sessionId,old)});
test('a stale UI target cannot adopt even when the old session did not change',async()=>{const f=fixture();await assert.rejects(f.run({isCurrent:()=>false}),/变化/)});
test('remote OFF generation after flush prevents reset without changing permission',async()=>{const f=fixture();await assert.rejects(f.run({readControl:async()=>({state:'segment-off',generation:1})}),/变化/);assert.equal(f.history.getSnapshot().mode,'legacy')});
test('CAS/write error leaves the original session and answer untouched',async()=>{const f=fixture(async()=>{throw Error('CAS')});f.engine.input('answer');const before=f.engine.getSnapshot();await assert.rejects(f.run(),/尚未保存/);assert.strictEqual(f.engine.getSnapshot(),before)});
test('pending or failed history admission never starts a transition',async()=>{const f=fixture();const original=f.history.getSnapshot();for(const mode of ['unprepared','enabling','disposed'] as const){await assert.rejects(flushReferenceTransition({snapshot:f.engine.getSnapshot,history:{getSnapshot:()=>({...original,mode}),flush:async()=>{}},readControl:async()=>f.control,verifyTarget:async()=>{},isCurrent:()=>true}),/等待/)} });
for(const mode of ['off','awaiting-segment'] as const)test(`${mode} transition does not enable or backfill history`,async()=>{const f=fixture();const control={state:mode==='off'?'segment-off':'segment-on',generation:2} as AutomaticHistoryControl;f.history.connect(f.engine.getSnapshot(),control);f.engine.input('temporary');const boundary=await f.run({readControl:async()=>control});assert.equal(boundary.mode,mode);assert.equal(f.history.getSnapshot().mode,mode);assert.equal(f.engine.draft,'temporary')});
