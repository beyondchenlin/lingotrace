import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {setup,learning,HOST_MEDIA_ORIGIN} from './studio-host-test-fixture';
import {NPS_MATERIAL,NPS_COURSE_MEDIA} from './builtin-material';
import {NPS_PLAYBACK_MEDIA} from '../media/nps-playback';
import {createOriginalCourseMediaPool,isVerifiedCourseMediaLease} from '../media/context-bookmark-media';
const AAC='PipelineStatus::DEMUXER_ERROR_DETECTED_AAC';
const directURL=HOST_MEDIA_ORIGIN+NPS_PLAYBACK_MEDIA.playbackVariant.url;
const source=new Blob([await readFile(new URL('../../public'+NPS_PLAYBACK_MEDIA.playbackVariant.url,import.meta.url))],{type:'video/mp4'});
type Fixture=Awaited<ReturnType<typeof setup>>;
function attachRealPool(f:Fixture){
 const calls={fetches:0,digests:0,created:[] as string[],revoked:[] as string[]};
 f.ctx.npsMediaPool=createOriginalCourseMediaPool({origin:HOST_MEDIA_ORIGIN,
  fetch:async(url,options)=>{calls.fetches++;assert.equal(url,directURL);assert.equal(options.redirect,'error');return{ok:true,status:200,url:directURL,redirected:false,type:'basic',headers:new Headers({'Content-Type':'video/mp4'}),blob:async()=>source}},
  digest:async bytes=>{calls.digests++;return webcrypto.subtle.digest('SHA-256',bytes)},
  createObjectURL:()=>{const url=`blob:aac-proof-${calls.created.length}`;calls.created.push(url);return url},revokeObjectURL:url=>calls.revoked.push(url)},NPS_PLAYBACK_MEDIA);
 const configureDuration=(v:any)=>{v.durationForSource=(url:string)=>url.startsWith('blob:aac-proof-')||url===directURL?NPS_COURSE_MEDIA.durationSeconds:72;return v};
 configureDuration(f.video);const make=f.ctx.document.createElement;f.ctx.document.createElement=(tag:string)=>configureDuration(make(tag));return calls;
}
function nativeLoader(video:any,options:{blobError?:string;directError?:string;beforeError?:()=>void;beforeDirect?:()=>void}={}){
 video.load=function(){const selected=this.src;this.currentSrc=selected;if(!selected){this.readyState=0;return}
  if(selected===directURL)options.beforeDirect?.();
  queueMicrotask(()=>{if(this.src!==selected)return;const message=selected.startsWith('blob:')?options.blobError:options.directError;
   if(message){this.readyState=0;this.error={code:4,message};options.beforeError?.();this.dispatchEvent(new Event('error'));this.onerror?.();}
   else{this.readyState=1;this.error=null;this.duration=NPS_COURSE_MEDIA.durationSeconds;this.dispatchEvent(new Event('loadedmetadata'));this.onloadedmetadata?.();}});
 };
}
function configureVerifier(f:Fixture,options:Parameters<typeof nativeLoader>[1]){const make=f.ctx.document.createElement;f.ctx.document.createElement=(tag:string)=>{const v=make(tag);nativeLoader(v,options);return v};}

test('actual exact-AAC verifier hands its verified direct transport to the main player without trying Blob again',async t=>{
 const f=await setup(t,{courseSources:true}),old=f.engine.getSnapshot(),calls=attachRealPool(f);configureVerifier(f,{blobError:AAC});nativeLoader(f.video,{blobError:AAC});
 await f.ctx.startBuiltinPractice(NPS_MATERIAL);
 assert.equal(calls.fetches,1);assert.equal(calls.digests,1);assert.deepEqual(f.video.sources,[directURL]);
 const lease=f.ctx.originalMediaLease.current;assert.equal(lease.transport,'verified-direct');assert.equal(lease.url,directURL);
 assert.equal(isVerifiedCourseMediaLease(lease,NPS_PLAYBACK_MEDIA,HOST_MEDIA_ORIGIN),true);assert.equal(f.ctx.reviewMediaRef.current.url,directURL);assert.equal(f.ctx.correctedMediaRef.current.url,directURL);
 assert.equal(f.ctx.reviewMediaError(f.ctx.reviewMediaRef.current.target),null);assert.equal(f.ctx.builtinMediaReady,true);assert.equal(f.video.plays,0);assert.deepEqual(calls.revoked,[]);
 assert.deepEqual((await f.repo.loadHistorySession(old.sessionId))!.snapshot,old);assert.deepEqual(f.engine.getSnapshot().material,NPS_MATERIAL);
 f.ctx.releaseOriginalMedia();assert.deepEqual(calls.revoked,calls.created);
});

test('actual Blob-ready verifier then main AAC error performs one direct retry in the same newly committed round',async t=>{
 const f=await setup(t,{courseSources:true}),calls=attachRealPool(f);nativeLoader(f.video,{blobError:AAC});
 await f.ctx.startBuiltinPractice(NPS_MATERIAL);assert.equal(calls.fetches,1);assert.equal(calls.digests,1);
 assert.equal(f.video.sources.filter(s=>s.startsWith('blob:')).length,1);assert.equal(f.video.sources.filter(s=>s===directURL).length,1);
 assert.equal(f.trace.filter(s=>s==='engine.start').length,1);assert.equal(f.ctx.originalMediaLease.current.transport,'verified-direct');assert.equal(f.video.plays,0);
 assert.equal(f.ctx.reviewMediaError(f.ctx.reviewMediaRef.current.target),null);
});

for(const message of [' PipelineStatus::DEMUXER_ERROR_DETECTED_AAC','PipelineStatus::DEMUXER_ERROR_DETECTED_AAC ','prefix '+AAC,AAC+' suffix','DEMUXER_ERROR_DETECTED_AAC','PipelineStatus::DEMUXER_ERROR_COULD_NOT_OPEN'])test(`actual host does not broaden native AAC trigger: ${JSON.stringify(message)}`,async t=>{
 const f=await setup(t,{courseSources:true}),old=learning(f.engine.getSnapshot()),calls=attachRealPool(f);configureVerifier(f,{blobError:message});
 await assert.rejects(f.ctx.startBuiltinPractice(NPS_MATERIAL));assert.deepEqual(learning(f.engine.getSnapshot()),old);assert.equal(f.video.sources.length,0);assert.deepEqual(calls.revoked,calls.created);
 assert.ok(f.auxiliary.every(v=>!v.sources.includes(directURL)));
});

for(const phase of ['verifier','main'] as const)test(`repeated native AAC failure stops after one direct retry at ${phase}`,async t=>{
 const f=await setup(t,{courseSources:true}),calls=attachRealPool(f),old=learning(f.engine.getSnapshot());
 if(phase==='verifier')configureVerifier(f,{blobError:AAC,directError:AAC});else nativeLoader(f.video,{blobError:AAC,directError:AAC});
 await assert.rejects(f.ctx.startBuiltinPractice(NPS_MATERIAL),/transport=verified-direct/);
 assert.deepEqual(calls.revoked,calls.created);assert.equal(calls.fetches,1);assert.equal(f.ctx.builtinMediaReady,false);
 const v=phase==='main'?f.video:f.auxiliary.find(v=>v.sources.some(s=>s.startsWith('blob:aac-proof-')))!;assert.equal(v.sources.filter(s=>s===directURL).length,1);assert.equal(v.plays,0);
 if(phase==='verifier')assert.deepEqual(learning(f.engine.getSnapshot()),old);else{assert.notEqual(f.engine.getSnapshot().sessionId,old.sessionId);assert.equal(f.ctx.builtinAnswerBlocked(),true)}
});

for(const interrupt of ['cancel','hidden','recording','dispose'] as const)test(`actual verifier AAC error after ${interrupt} cannot convert or reset the old round`,async t=>{
 const f=await setup(t,{courseSources:true}),old=learning(f.engine.getSnapshot()),calls=attachRealPool(f);
 configureVerifier(f,{blobError:AAC,beforeError:()=>{if(interrupt==='cancel')f.ctx.cancelCourseSelection();else if(interrupt==='hidden')f.ctx.document.hidden=true;else if(interrupt==='recording')f.ctx.recordPreparing.current=true;else f.ctx.disposed.current=true}});
 await assert.rejects(f.ctx.startBuiltinPractice(NPS_MATERIAL));assert.deepEqual(learning(f.engine.getSnapshot()),old);assert.ok(f.auxiliary.every(v=>!v.sources.includes(directURL)));assert.deepEqual(calls.revoked,calls.created);
});

test('a released verified-direct main holder blocks play even though its immutable URL still exists',async t=>{
 const f=await setup(t,{courseSources:true});attachRealPool(f);configureVerifier(f,{blobError:AAC});await f.ctx.startBuiltinPractice(NPS_MATERIAL);
 const lease=f.ctx.originalMediaLease.current;lease.release();assert.equal(isVerifiedCourseMediaLease(lease,NPS_PLAYBACK_MEDIA,HOST_MEDIA_ORIGIN),false);assert.match(f.ctx.reviewMediaError(f.ctx.reviewMediaRef.current.target),/尚未/);
 await f.ctx.toggleCorrectedPlay();assert.equal(f.video.plays,0);
});

function pendingNative(v:any,{aac=false}:{aac?:boolean}={}){
 let delivered=0;
 v.load=function(){const selected=this.src;this.currentSrc=selected;if(!selected){this.readyState=0;return}
  this.readyState=1;this.duration=NaN;this.error=null;
  queueMicrotask(()=>{if(this.src!==selected)return;delivered++;
   if(aac&&selected.startsWith('blob:')){this.readyState=0;this.error={code:4,message:AAC};this.dispatchEvent(new Event('error'));}
   else this.dispatchEvent(new Event('loadedmetadata'));
  });
 };
 return{get delivered(){return delivered},ready(){v.duration=NPS_COURSE_MEDIA.durationSeconds;v.readyState=1;v.dispatchEvent(new Event('durationchange'));}};
}
const awaitPending=async(test:()=>boolean)=>{for(let i=0;i<1000;i++){if(test())return;await new Promise(r=>setTimeout(r,1))}assert.fail('pending media stage not reached');};

test('actual AAC direct handoff waits for finite duration in verifier and main without changing reference or retrying Blob',async t=>{
 const f=await setup(t,{courseSources:true}),old=f.engine.getSnapshot(),calls=attachRealPool(f),main=pendingNative(f.video);
 const verifiers:{v:any;control:ReturnType<typeof pendingNative>}[]=[];const make=f.ctx.document.createElement;
 f.ctx.document.createElement=(name:string)=>{const v=make(name),control=pendingNative(v,{aac:true});verifiers.push({v,control});return v};
 let settled=false;const work=f.ctx.startBuiltinPractice(NPS_MATERIAL).finally(()=>{settled=true});work.catch(()=>{});
 await awaitPending(()=>verifiers.some(({v,control})=>v.src===directURL&&control.delivered>=2));
 assert.equal(settled,false);assert.equal(f.trace.includes('engine.start'),false);assert.equal(f.video.sources.length,0);
 const verifier=verifiers.find(({v})=>v.src===directURL)!;verifier.control.ready();
 await awaitPending(()=>f.video.src===directURL&&main.delivered>0);assert.equal(settled,false);assert.equal(f.ctx.builtinMediaReady,false);
 main.ready();await work;assert.equal(f.ctx.builtinMediaReady,true);assert.equal(f.ctx.originalMediaLease.current.transport,'verified-direct');
 assert.deepEqual(f.video.sources,[directURL]);assert.equal(calls.fetches,1);assert.equal(calls.digests,1);assert.equal(f.video.plays,0);
 assert.deepEqual((await f.repo.loadHistorySession(old.sessionId))!.snapshot,old);assert.deepEqual(f.engine.getSnapshot().material,NPS_MATERIAL);
});

test('main unknown-duration AAC retry consumes only the remaining original twenty-second budget',async t=>{
 const f=await setup(t,{courseSources:true});attachRealPool(f);const pending=pendingNative(f.video);let now=100;
 const timers:{callback:()=>void;ms:number;cleared:boolean}[]=[];f.ctx.Date={now:()=>now};f.ctx.setTimeout=(callback:()=>void,ms:number)=>{const item={callback,ms,cleared:false};timers.push(item);return item};f.ctx.clearTimeout=(timer:typeof timers[number])=>{timer.cleared=true};
 const work=f.ctx.startBuiltinPractice(NPS_MATERIAL);const failure=assert.rejects(work,/range-v71.*transport=verified-direct/);
 await awaitPending(()=>pending.delivered>0&&timers.length===1);assert.equal(timers[0].ms,20000);
 now+=12000;f.video.error={code:4,message:AAC};f.video.dispatchEvent(new Event('error'));
 await awaitPending(()=>f.video.src===directURL&&timers.length===2);assert.equal(timers[0].cleared,true);assert.equal(timers[1].ms,8000);
 f.video.duration=Infinity;f.video.dispatchEvent(new Event('durationchange'));assert.equal(timers.length,2);
 timers[1].callback();await failure;assert.equal(f.ctx.builtinMediaReady,false);pending.ready();assert.equal(f.ctx.builtinMediaReady,false);assert.equal(f.video.plays,0);
});

test('main timely AAC event cannot start direct transport after the original deadline passes before its promise continuation',async t=>{
 const f=await setup(t,{courseSources:true});const calls=attachRealPool(f),pending=pendingNative(f.video);let now=100;
 const timers:{callback:()=>void;ms:number;cleared:boolean}[]=[];f.ctx.Date={now:()=>now};f.ctx.setTimeout=(callback:()=>void,ms:number)=>{const item={callback,ms,cleared:false};timers.push(item);return item};f.ctx.clearTimeout=(timer:typeof timers[number])=>{timer.cleared=true};
 const work=f.ctx.startBuiltinPractice(NPS_MATERIAL);const failure=assert.rejects(work,/MEDIA_4/);
 await awaitPending(()=>pending.delivered>0&&timers.length===1);now+=19999;
 f.video.error={code:4,message:AAC};f.video.dispatchEvent(new Event('error'));now+=2;
 // If a regression starts direct, settle its timer so the negative test cannot hang.
 await new Promise(r=>setImmediate(r));if(timers.length>1)timers.at(-1)!.callback();await failure;
 assert.equal(f.video.sources.some(s=>s===directURL),false);assert.equal(timers.length,1);assert.equal(f.ctx.builtinMediaReady,false);assert.equal(f.video.plays,0);
 assert.deepEqual(calls.revoked,calls.created);
});
