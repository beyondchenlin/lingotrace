import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,until,tick,learning} from './studio-host-test-fixture';
import {NPS_MATERIAL,NPS_COURSE_MEDIA} from './builtin-material';

type Fixture=Awaited<ReturnType<typeof setup>>;
function pendingMain(f:Fixture,initial:number,ready=1){
 let events=0;
 f.video.load=function(){const selected=this.src;this.currentSrc=selected;if(!selected){this.readyState=0;return}
  this.duration=initial;this.readyState=ready;this.error=null;
  queueMicrotask(()=>{if(this.src!==selected)return;events++;this.dispatchEvent(new Event('loadedmetadata'));this.onloadedmetadata?.();});
 };
 return{get events(){return events},finite(event='durationchange',duration=NPS_COURSE_MEDIA.durationSeconds){f.video.duration=duration;f.video.readyState=1;f.video.dispatchEvent(new Event(event));}};
}
function manualDeadline(f:Fixture){
 const timers:{callback:()=>void;delay:number;cleared:boolean}[]=[];let now=100;
 f.ctx.Date={now:()=>now};
 f.ctx.setTimeout=(callback:()=>void,delay:number)=>{const entry={callback,delay,cleared:false};timers.push(entry);return entry};
 f.ctx.clearTimeout=(entry:typeof timers[number])=>{entry.cleared=true};
 return{timers,advance(ms:number){now+=ms}};
}

for(const initial of [NaN,Infinity,0,-1])for(const progress of ['durationchange','loadeddata','canplay'])test(`actual main waits for ${initial} then ${progress} finite duration without touching old attempt`,async t=>{
 const f=await setup(t,{courseSources:true}),old=f.engine.getSnapshot(),p=pendingMain(f,initial);
 let settled=false;const work=f.ctx.startBuiltinPractice(NPS_MATERIAL).finally(()=>{settled=true});work.catch(()=>{});
 await until(()=>p.events>0,'main unknown metadata');await tick();
 assert.equal(settled,false);assert.equal(f.ctx.builtinMediaReady,false);assert.equal(f.video.plays,0);
 p.finite(progress);await work;
 assert.equal(f.ctx.builtinMediaReady,true);assert.equal(f.video.duration,NPS_COURSE_MEDIA.durationSeconds);assert.equal(f.video.currentTime,.77);
 assert.equal(f.video.plays,0);assert.equal(f.ctx.reviewMediaError(f.ctx.reviewMediaRef.current.target),null);
 assert.deepEqual((await f.repo.loadHistorySession(old.sessionId))!.snapshot,old);assert.deepEqual(f.engine.getSnapshot().material,NPS_MATERIAL);
});

test('actual main does not admit a positive stale duration at readyState zero',async t=>{
 const f=await setup(t,{courseSources:true}),p=pendingMain(f,NPS_COURSE_MEDIA.durationSeconds,0);
 let settled=false;const work=f.ctx.startBuiltinPractice(NPS_MATERIAL).finally(()=>{settled=true});work.catch(()=>{});
 await until(()=>p.events>0,'ready zero metadata');await tick();assert.equal(settled,false);assert.equal(f.ctx.builtinMediaReady,false);
 p.finite('loadedmetadata');await work;assert.equal(f.ctx.builtinMediaReady,true);
});

for(const duration of [1.529,2,43.36,43.3659])test(`first finite main duration ${duration} remains strictly invalid`,async t=>{
 const f=await setup(t,{courseSources:true}),old=f.engine.getSnapshot();pendingMain(f,duration);
 await assert.rejects(f.ctx.startBuiltinPractice(NPS_MATERIAL),/range-v71/);
 assert.equal(f.ctx.builtinMediaReady,false);assert.equal(f.video.plays,0);
 assert.deepEqual((await f.repo.loadHistorySession(old.sessionId))!.snapshot,old);
 f.video.duration=NPS_COURSE_MEDIA.durationSeconds;f.video.dispatchEvent(new Event('durationchange'));assert.equal(f.ctx.builtinMediaReady,false);
});

test('registered 43.366 millisecond metadata still passes without altering final cue end',async t=>{
 const f=await setup(t,{courseSources:true});pendingMain(f,43.366);await f.ctx.startBuiltinPractice(NPS_MATERIAL);
 assert.equal(f.ctx.builtinMediaReady,true);assert.equal(f.engine.getSnapshot().material.cues.at(-1)!.end,43.366);
});

test('unknown main duration never refreshes its original deadline and late progress cannot revive timeout',async t=>{
 const f=await setup(t,{courseSources:true}),timing=manualDeadline(f),p=pendingMain(f,Infinity);
 const work=f.ctx.startBuiltinPractice(NPS_MATERIAL);const failure=assert.rejects(work,/range-v71.*actual=Infinity/);
 await until(()=>p.events>0,'pending main');assert.equal(timing.timers.length,1);assert.equal(timing.timers[0].delay,20000);
 for(const name of ['durationchange','loadedmetadata','loadeddata','canplay']){timing.advance(1000);f.video.dispatchEvent(new Event(name));}
 assert.equal(timing.timers.length,1);timing.timers[0].callback();await failure;
 assert.equal(timing.timers[0].cleared,true);p.finite();assert.equal(f.ctx.builtinMediaReady,false);assert.equal(f.video.plays,0);
});

for(const interruption of ['hidden','recording','dispose','abort','source'])test(`pending main ${interruption} prevents late duration admission`,async t=>{
 const f=await setup(t,{courseSources:true}),p=pendingMain(f,NaN);const work=f.ctx.startBuiltinPractice(NPS_MATERIAL);const failure=assert.rejects(work);
 await until(()=>p.events>0,'pending main before interruption');
 if(interruption==='hidden')f.ctx.document.hidden=true;else if(interruption==='recording')f.ctx.recordPreparing.current=true;else if(interruption==='dispose')f.ctx.disposed.current=true;
 else if(interruption==='abort')f.ctx.releaseOriginalMedia();else f.video.currentSrc='blob:foreign-source';
 p.finite();await failure;assert.equal(f.ctx.builtinMediaReady,false);assert.equal(f.video.plays,0);
});

test('native non-AAC error while main duration pending fails without source retry',async t=>{
 const f=await setup(t,{courseSources:true}),p=pendingMain(f,Infinity);const work=f.ctx.startBuiltinPractice(NPS_MATERIAL);const failure=assert.rejects(work,/MEDIA_3/);
 await until(()=>p.events>0,'pending before native error');const sources=f.video.sources.slice();f.video.fail();await failure;
 assert.deepEqual(f.video.sources,sources);assert.equal(f.ctx.builtinMediaReady,false);assert.equal(f.video.plays,0);
});

test('ready main with later nonfinite duration remains blocked rather than returning to an unbounded loading state',async t=>{
 const f=await setup(t,{courseSources:true});await f.ctx.startBuiltinPractice(NPS_MATERIAL);
 f.video.duration=Infinity;f.video.dispatchEvent(new Event('durationchange'));
 assert.notEqual(f.ctx.currentCorrectedMediaError(),null);assert.equal(f.ctx.builtinAnswerBlocked(),true);
 await f.ctx.toggleCorrectedPlay();assert.equal(f.video.plays,0);
});

test('finite main progress after the deadline cannot beat a delayed timeout callback',async t=>{
 const f=await setup(t,{courseSources:true}),timing=manualDeadline(f),p=pendingMain(f,NaN);
 const work=f.ctx.startBuiltinPractice(NPS_MATERIAL);const failure=assert.rejects(work,/超时.*range-v71/);
 await until(()=>p.events>0,'pending main at deadline');timing.advance(20001);p.finite();await failure;
 assert.equal(f.ctx.builtinMediaReady,false);assert.equal(f.video.plays,0);assert.equal(timing.timers[0].cleared,true);
});

test('native error between main metadata resolution and final handoff cannot report successful ready',async t=>{
 const f=await setup(t,{courseSources:true});let scheduled=false;
 f.video.load=function(){const selected=this.src;this.currentSrc=selected;if(!selected){scheduled=false;this.readyState=0;return}if(scheduled)return;scheduled=true;
  queueMicrotask(()=>{if(this.src!==selected)return;this.duration=NPS_COURSE_MEDIA.durationSeconds;this.readyState=1;this.error=null;
   this.dispatchEvent(new Event('loadedmetadata'));this.error={code:3,message:'late decoder failure'};this.dispatchEvent(new Event('error'));
  });
 };
 await assert.rejects(f.ctx.startBuiltinPractice(NPS_MATERIAL),/MEDIA_3/);
 assert.equal(f.ctx.builtinMediaReady,false);assert.equal(f.ctx.builtinAnswerBlocked(),true);assert.equal(f.video.plays,0);assert.equal(f.video.src,'');
});

test('main metadata resolved before deadline still cannot finalize after its deadline',async t=>{
 const f=await setup(t,{courseSources:true}),timing=manualDeadline(f),p=pendingMain(f,NaN);
 const work=f.ctx.startBuiltinPractice(NPS_MATERIAL);const failure=assert.rejects(work,/最终交接/);
 await until(()=>p.events>0,'pending main before accept deadline');timing.advance(19999);p.finite();timing.advance(2);await failure;
 assert.equal(f.ctx.builtinMediaReady,false);assert.equal(f.video.plays,0);assert.equal(f.video.src,'');
});
