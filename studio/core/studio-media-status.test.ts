import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,gate,tick} from './studio-host-test-fixture';
import {NPS_MATERIAL} from './builtin-material';

test('new NPS load clears previous failure, and body rejection ends Loading without changing the draft or source policy',async t=>{
 const f=await setup(t);f.ctx.historyBindingPausedRef.current=true;f.engine.startReferenceSession(NPS_MATERIAL,0);f.engine.input('hello');f.ctx.inputRef.current.value='hello';const before=f.engine.getSnapshot(),wait=gate();
 f.ctx.visualRef.current.message='previous source failed';f.ctx.npsMediaPool.acquire=async()=>{await wait.promise;throw TypeError('synthetic body failure')};
 const pending=f.ctx.loadBuiltinMaterial(NPS_MATERIAL);await tick();assert.equal(f.ctx.visualRef.current.message,'正在核验课程视频…');assert.equal(f.ctx.visualRef.current.ready,false);assert.equal(f.ctx.builtinMediaReady,false);
 wait.resolve();await pending;assert.equal(f.ctx.visualRef.current.message,'视频暂不可用，请重新加载');assert.equal(f.ctx.visualRef.current.ready,false);assert.match(f.ctx.courseError,/synthetic body failure/);assert.equal(f.video.src,'');assert.equal(f.video.plays,0);assert.equal(f.ctx.inputRef.current.value,'hello');assert.deepEqual(f.engine.getSnapshot(),before);
});
test('late failure from previous NPS load does not replace current media status',async t=>{
 const f=await setup(t);f.ctx.historyBindingPausedRef.current=true;f.engine.startReferenceSession(NPS_MATERIAL,0);const wait=gate();f.ctx.npsMediaPool.acquire=async()=>{await wait.promise;throw TypeError('stale body failure')};
 const pending=f.ctx.loadBuiltinMaterial(NPS_MATERIAL);await tick();f.ctx.courseLoadRequest.current++;f.ctx.visualRef.current.message='New source loading';f.ctx.courseError='';wait.resolve();await pending;assert.equal(f.ctx.visualRef.current.message,'New source loading');assert.equal(f.ctx.courseError,'');
});
test('original-course acquire rejection displays failure rather than permanent Loading',async t=>{
 const f=await setup(t);f.ctx.originalMediaPool.acquire=async()=>{throw TypeError('synthetic body failure')};f.ctx.loadDemo();await tick();await tick();assert.equal(f.ctx.visualRef.current.ready,false);assert.equal(f.ctx.visualRef.current.message,'视频暂不可用，请重新加载');assert.equal(f.video.plays,0);
});

test('failed precommit NPS selection leaves the valid current café scene without a false unavailable banner',async t=>{
 const f=await setup(t);f.ctx.builtinMediaReady=false;f.ctx.visualRef.current.ready=true;f.ctx.visualRef.current.message='';const material=f.engine.getSnapshot().material,source=f.video.src;
 f.ctx.npsMediaPool.acquire=async()=>{throw TypeError('new NPS selection failed')};await assert.rejects(f.ctx.startBuiltinPractice(NPS_MATERIAL),/new NPS selection failed/);
 assert.equal(f.engine.getSnapshot().material.id,material.id);assert.equal(f.video.src,source);assert.equal(f.ctx.visualRef.current.ready,true);assert.match(f.ctx.courseError,/new NPS selection failed/);assert.equal(f.ctx.renderCourseError(),false);
 // A message describing an in-progress current load is not a media failure either.
 f.ctx.visualRef.current.ready=false;f.ctx.visualRef.current.message='正在核验课程视频…';assert.equal(f.ctx.renderCourseError(),false);
 f.ctx.visualRef.current.message='视频暂不可用，请重新加载';assert.ok(f.ctx.renderCourseError());
});
