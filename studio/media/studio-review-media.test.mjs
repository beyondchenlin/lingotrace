import { inactiveListeningTestScope } from '../core/inactive-listening-test-fixture.mjs';
import {NPS_PLAYBACK_MEDIA} from './nps-playback.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {TrainingEngine,CAFE_MATERIAL} from '../core/training.ts';
import {buildLocalReferenceProposal,canonicalLocalReferenceJSON,LOCAL_REFERENCE_MEDIA_ID,LOCAL_REFERENCE_MEDIA_SHA256} from '../core/local-reference.ts';
import {createContextBookmarkPreviewController,isExactNativeAACError,isVerifiedCourseMediaLease,ORIGINAL_COURSE_MEDIA} from './context-bookmark-media.ts';

const require=createRequire(import.meta.url),parser=require('next/dist/compiled/babel/parser'),swc=require('next/dist/build/swc');
// The normal media command uses strip-only TypeScript; this existing TS module
// also has parameter properties. Load it with the project's installed TS loader.
const {buildReviewTarget,reviewSame}=require('tsx/cjs/api').require('../core/review-tasks.ts',import.meta.url);
const {fixedReviewDurationMatches,fixedReviewTargetMatches,reviewMediaDiagnostic,reviewDurationDiagnostic,reviewRangeDiagnostic}=require('tsx/cjs/api').require('./fixed-review-media.ts',import.meta.url);
const {NPS_MATERIAL,NPS_COURSE_MEDIA,builtinCourseForMaterial,isBuiltinMaterial}=require('tsx/cjs/api').require('../core/builtin-material.ts',import.meta.url);
await swc.loadBindings();
const source=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
const ast=parser.parse(source,{sourceType:'module',plugins:['typescript','jsx']});
const studio=ast.program.body.find(node=>node.type==='FunctionDeclaration'&&node.id?.name==='StudioContent');
assert.ok(studio,'Find the real Studio component');
const names=['coursePool','strictCourse','prepareCoursePoster','sameMaterial','referenceRepository','isKnownReference','bookmarkRecordingBlocked','releaseOriginalMedia','stopReviewTracking','verifyReviewMedia','reviewMediaError','loadReviewMaterial'];
const actualFunctions=names.map(name=>{
 const node=studio.body.body.find(item=>item.type==='FunctionDeclaration'&&item.id.name===name);
 assert.ok(node,`Missing real Studio function: ${name}`);return source.slice(node.start,node.end);
}).join('\n');
const {code}=await swc.transform(actualFunctions,{jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}});
// Evaluate in the host realm: production target validation intentionally rejects
// foreign prototypes. Only DOM/media device boundaries are synthetic. These are
// actual Studio functions and actual preview, engine and digest implementations.
const install=new Function('scope',`with(scope){${code}\nreturn {${names.join(',')}}}`);
const ref=current=>({current}),copy=value=>structuredClone(value),tick=()=>new Promise(resolve=>setImmediate(resolve));
function gate(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
const media={id:LOCAL_REFERENCE_MEDIA_ID,sha256:LOCAL_REFERENCE_MEDIA_SHA256,durationSeconds:73.625};
const target=await buildReviewTarget(CAFE_MATERIAL,CAFE_MATERIAL.cues[2].id,media);
const corrected=(await buildLocalReferenceProposal({original:CAFE_MATERIAL,parent:CAFE_MATERIAL,editedCueId:CAFE_MATERIAL.cues[1].id,
 text:'Would you like your coffee hot or iced today?',start:6.125,end:11.875,media,saveRequestId:'review-media-correction',createdAt:'2026-10-10T10:00:00.000Z'})).material;
const correctedTarget=await buildReviewTarget(corrected,CAFE_MATERIAL.cues[4].id,media);

class Video extends EventTarget{
 _src='';currentSrc='';duration=media.durationSeconds;readyState=0;currentTime=0;paused=true;muted=true;volume=.8;autoplay=false;loop=false;preload='metadata';playbackRate=1;
 onerror=null;onloadedmetadata=null;handlers=new Map();plays=0;pauses=0;loads=0;sources=[];autoMetadata=false;
 get src(){return this._src}
 set src(value){this._src=value;this.sources.push(value)}
 addEventListener(name,callback,options){const set=this.handlers.get(name)??new Set();set.add(callback);this.handlers.set(name,set);super.addEventListener(name,callback,options)}
 removeEventListener(name,callback,options){this.handlers.get(name)?.delete(callback);if(!this.handlers.get(name)?.size)this.handlers.delete(name);super.removeEventListener(name,callback,options)}
 get listenerCount(){return [...this.handlers.values()].reduce((total,set)=>total+set.size,0)}
 pause(){this.pauses++;this.paused=true}
 play(){this.plays++;this.paused=false;return Promise.resolve()}
 load(){this.loads++;if(!this.src){this.currentSrc='';this.readyState=0;return}const selected=this.src;if(this.autoMetadata)queueMicrotask(()=>{if(this.src===selected)this.metadata()})}
 metadata(){this.currentSrc=this.src;this.readyState=1;this.dispatchEvent(new Event('loadedmetadata'));this.onloadedmetadata?.()}
 fail(){this.dispatchEvent(new Event('error'));this.onerror?.()}
 removeAttribute(name){assert.equal(name,'src');this._src='';this.currentSrc='';this.readyState=0}
}
function setup(t,selected=target){
 let serial=0,acquireOverride=null,leaseOverride={},timerId=0,known=true;
 const engine=new TrainingEngine({material:selected.material,clock:{now:()=>0,wallTime:()=> '2026-10-10T10:00:00.000Z',id:()=>`review-media-${++serial}`}});
 const video=new Video(),auxiliary=[],controllers=[],leases=[],acquisitions=[],timers=new Map(),calls=[];
 const makeLease=(patch={})=>{
  const lease={url:`blob:verified-review-${leases.length+1}`,mediaId:media.id,mediaSha256:media.sha256,actualSha256:media.sha256,verified:true,verificationError:null,...patch,
   releases:0,releaseCalls:0,release(){this.releaseCalls++;this.releases=1}};leases.push(lease);return lease;
 };
 const pool={async acquire(options){acquisitions.push(options);return acquireOverride?acquireOverride(options):makeLease(leaseOverride)}};
 const c={ ...inactiveListeningTestScope(),Error,AbortController,Image:class{src=''},NPS_MATERIAL,NPS_COURSE_MEDIA,NPS_PLAYBACK_MEDIA,isExactNativeAACError,isVerifiedCourseMediaLease,ORIGINAL_COURSE_MEDIA,builtinCourseForMaterial,isBuiltinMaterial,CAFE_MATERIAL,LOCAL_REFERENCE_MEDIA_ID,LOCAL_REFERENCE_MEDIA_SHA256,canonicalLocalReferenceJSON,buildReviewTarget,reviewSame,fixedReviewDurationMatches,fixedReviewTargetMatches,reviewMediaDiagnostic,reviewDurationDiagnostic,reviewRangeDiagnostic,
  engineRef:ref(engine),lessonRef:ref(video),mediaRef:ref({kind:'demo',name:''}),originalMediaPool:pool,mediaToken:ref(0),originalMediaRequest:ref(null),originalMediaLease:ref(null),
  reviewMediaRequestRef:ref(null),reviewMediaRef:ref(null),reviewVerificationRef:ref(null),reviewVerifyRequestRef:ref(0),reviewActionRef:ref(0),reviewBindingRef:ref(null),reviewPendingRef:ref(new Set()),
  correctedMediaRef:ref(null),correctedPlayRequest:ref(0),correctedPlayOwner:ref(null),disposed:ref(false),life:ref(1),visualRef:ref({ready:false,showSubtitle:false}),
  referenceRepositoryRef:ref({async isExactSavedMaterial(material){calls.push(['library.verify',material]);return known}}),
  recordPreparing:ref(false),recorderRef:ref({getSnapshot:()=>({state:'idle'})}),repoRef:ref({revokeReviewSessionBindings:()=>calls.push(['bindings.revoke'])}),
  document:{hidden:false,createElement(name){assert.equal(name,'video');const element=new Video();element.autoMetadata=true;auxiliary.push(element);return element}},
  videoPalette:{sourceChanged:value=>calls.push(['palette',value])},pendingSeek:ref(null),mediaDuration:0,bookmarkReady:false,
  setMediaDuration(value){c.mediaDuration=value;calls.push(['duration',value])},setShowSubtitle:value=>calls.push(['subtitle',value]),setMediaKind:value=>calls.push(['kind',value]),setMediaName:value=>calls.push(['name',value]),
  setBuiltinMediaReady(value){c.builtinMediaReady=value},setBookmarkMediaReady(value){c.bookmarkReady=value},setReviewTrackingMessage:value=>calls.push(['tracking',value]),setReviewPendingCount:value=>calls.push(['pending',value]),
  seekTo(value){video.currentTime=value;calls.push(['seek',value]);return true},
  setTimeout(callback,ms){const id=++timerId;timers.set(id,{callback,ms});return id},clearTimeout:id=>timers.delete(id),
  previewRecording(){assert.fail('Review media must never open a recording preview')},setPreview(){assert.fail('Review media must never expose a recording preview')},
  setReferenceConfirmation(){assert.fail('Review media must never expose a reference confirmation')},
 };
 c.createContextBookmarkPreviewController=dependencies=>{
  const controller=createContextBookmarkPreviewController({...dependencies,lifecycle:{isHidden:()=>c.document.hidden},metadataTimeoutMs:1000});
  controllers.push(controller);return controller;
 };
 Object.assign(c,install(c));
 t.after(()=>{c.disposed.current=true;c.reviewVerificationRef.current?.dispose();for(const controller of controllers)controller.dispose();c.releaseOriginalMedia();timers.clear()});
 return{c,engine,video,auxiliary,controllers,leases,acquisitions,timers,calls,makeLease,
  setAcquire:value=>{acquireOverride=value},setLease:value=>{leaseOverride=value},setKnown:value=>{known=value},
  expire(){assert.equal(timers.size,1);const [id,timer]=[...timers][0];assert.equal(timer.ms,20000);timers.delete(id);timer.callback()},
 };
}
async function loading(f,selected=target){const promise=f.c.loadReviewMaterial(selected);promise.catch(()=>{});await tick();assert.equal(f.video.src,f.leases.at(-1).url);return{promise,lease:f.leases.at(-1)}}
async function ready(f,selected=target){const pending=await loading(f,selected);f.video.metadata();await pending.promise;return pending.lease}
function cleaned(f,lease){
 assert.equal(lease.releases,1,'Failed preparation releases its own lease exactly once');
 assert.equal(f.c.originalMediaLease.current,null);assert.equal(f.c.originalMediaRequest.current,null);assert.equal(f.c.reviewMediaRequestRef.current,null);
 assert.equal(f.c.reviewMediaRef.current,null);assert.equal(f.c.correctedMediaRef.current,null);
 assert.equal(f.video.src,'','Failed preparation removes its own source');assert.equal(f.video.currentSrc,'');assert.equal(f.video.listenerCount,0);
 assert.equal(f.timers.size,0);assert.equal(f.c.visualRef.current.ready,false);assert.equal(f.c.mediaDuration,0);assert.equal(f.c.bookmarkReady,false);
}
function noExposure(f,before){
 assert.equal(f.engine.getSnapshot(),before,'Media verification/loading adds no Training event, reveal, attempt or earned words');
 assert.equal(f.video.plays,0);assert.ok(f.auxiliary.every(video=>video.plays===0));
 assert.ok(f.calls.filter(call=>call[0]==='subtitle').every(call=>call[1]===false));
 assert.equal(f.c.visualRef.current.showSubtitle,false);
}

test('actual strict load uses the verified lease and exact non-72 duration, without autoplay, answer exposure or a recording preview',async t=>{
 const f=setup(t),before=f.engine.getSnapshot(),lease=await ready(f);
 assert.equal(f.c.reviewMediaError(target),null);assert.equal(f.c.originalMediaLease.current,lease);assert.equal(lease.releases,0);
 assert.equal(f.c.mediaDuration,media.durationSeconds);assert.equal(f.video.currentTime,target.material.cues[2].start);assert.equal(f.c.pendingSeek.current,target.material.cues[2].start);
 assert.equal(f.c.reviewMediaRef.current.sessionId,before.sessionId);assert.equal(f.c.reviewMediaRef.current.materialDigest,target.materialDigest);assert.deepEqual(f.c.reviewMediaRef.current.target,target);
 assert.equal(f.video.listenerCount,0);assert.equal(f.timers.size,0);assert.deepEqual(f.video.sources,[lease.url]);noExposure(f,before);
});

test('actual corrected strict load seeks the task cue, not the correction editedCueId, with hidden answer',async t=>{
 const f=setup(t,correctedTarget),before=f.engine.getSnapshot(),lease=await ready(f,correctedTarget);
 assert.notEqual(correctedTarget.cueId,corrected.localReference.editedCueId);assert.equal(f.video.currentTime,24);
 assert.equal(f.c.correctedMediaRef.current.identity,JSON.stringify(corrected));assert.equal(f.c.correctedMediaRef.current.url,lease.url);assert.equal(f.c.bookmarkReady,false);
 assert.equal(f.c.reviewMediaError(correctedTarget),null);noExposure(f,before);
});

for(const [label,mutate] of [
 ['unverified lease',f=>{f.c.originalMediaLease.current.verified=false}],
 ['wrong actual SHA-256',f=>{f.c.originalMediaLease.current.actualSha256='0'.repeat(64)}],
 ['absent actual SHA-256',f=>{f.c.originalMediaLease.current.actualSha256=null}],
 ['wrong declared SHA-256',f=>{f.c.originalMediaLease.current.mediaSha256='0'.repeat(64)}],
 ['wrong media identity',f=>{f.c.originalMediaLease.current.mediaId='other-media'}],
 ['different lease URL',f=>{f.c.originalMediaLease.current.url='blob:another-lease'}],
 ['ordinary unverified URL fallback',f=>{f.video.src='/studio-assets/06-cafe.mp4';f.video.currentSrc=f.video.src}],
 ['mismatched selected currentSrc',f=>{f.video.currentSrc='blob:stale-decoder'}],
 ['missing currentSrc',f=>{f.video.currentSrc=''}],
 ['metadata unavailable',f=>{f.video.readyState=0}],
 ['72-second fallback duration',f=>{f.video.duration=72}],
 ['rounded duration',f=>{f.video.duration=media.durationSeconds+Number.EPSILON*128}],
 ['infinite duration',f=>{f.video.duration=Infinity}],
 ['unknown duration',f=>{f.video.duration=NaN}],
 ['zero duration',f=>{f.video.duration=0}],
 ['wrong session',f=>{f.c.reviewMediaRef.current.sessionId='other-session'}],
 ['wrong stored digest',f=>{f.c.reviewMediaRef.current.materialDigest='0'.repeat(64)}],
 ['other strict target cue',f=>{f.c.reviewMediaRef.current.target={...target,cueId:CAFE_MATERIAL.cues[0].id}}],
 ['other strict target media',f=>{f.c.reviewMediaRef.current.target={...target,media:{...target.media,durationSeconds:74}}}],
 ['changed full material metadata',f=>{const snapshot=f.engine.getSnapshot();f.c.engineRef.current={getSnapshot:()=>({...snapshot,material:{...snapshot.material,rights:'changed entire snapshot'}})}}],
])test(`actual playback guard rejects ${label}`,async t=>{
 const f=setup(t);await ready(f);mutate(f);assert.match(f.c.reviewMediaError(target)??'',/不能播放/);
});

for(const [label,patch] of [
 ['unverified',{verified:false}],['actual hash mismatch',{actualSha256:'0'.repeat(64)}],['declared hash mismatch',{mediaSha256:'0'.repeat(64)}],['media identity mismatch',{mediaId:'other-media'}],
])test(`actual strict loader rejects ${label} before assigning any URL`,async t=>{
 const f=setup(t),before=f.engine.getSnapshot();f.setLease(patch);
 await assert.rejects(f.c.loadReviewMaterial(target));const lease=f.leases[0];cleaned(f,lease);assert.deepEqual(f.video.sources,[]);noExposure(f,before);
});

for(const [label,finish] of [
 ['wrong exact duration',f=>{f.video.duration=72;f.video.metadata()}],
 ['decode error',f=>f.video.fail()],
 ['metadata timeout',f=>f.expire()],
 ['aborted metadata',f=>f.c.originalMediaRequest.current.abort()],
 ['hidden metadata completion',f=>{f.c.document.hidden=true;f.video.metadata()}],
 ['changed session metadata completion',f=>{f.engine.resetSession();f.video.metadata()}],
 ['disposed metadata completion',f=>{f.c.disposed.current=true;f.video.metadata()}],
])test(`actual ${label} rejects and clears only its pending source, lease, listener and timer`,async t=>{
 const f=setup(t,correctedTarget),pending=await loading(f,correctedTarget);finish(f);await assert.rejects(pending.promise);cleaned(f,pending.lease);
 assert.ok(!f.video.sources.includes('/studio-assets/06-cafe.mp4'),'No compatibility URL fallback');
 f.video.metadata();f.video.fail();assert.equal(f.c.visualRef.current.ready,false,'Late media events cannot rearm failed preparation');
});

test('actual loadedmetadata refuses a different decoder source even when duration matches',async t=>{
 const f=setup(t),pending=await loading(f);f.video.currentSrc='blob:other-decoder';f.video.readyState=1;f.video.dispatchEvent(new Event('loadedmetadata'));
 await assert.rejects(pending.promise);cleaned(f,pending.lease);
});

test('actual rejected acquisition leaves no retained review request or fallback source',async t=>{
 const f=setup(t);f.setAcquire(async()=>{throw Error('read failed')});await assert.rejects(f.c.loadReviewMaterial(target),/read failed/);
 assert.equal(f.c.originalMediaRequest.current,null);assert.equal(f.c.reviewMediaRequestRef.current,null);assert.equal(f.c.reviewMediaRef.current,null);
 assert.equal(f.video.src,'');assert.equal(f.video.listenerCount,0);assert.equal(f.timers.size,0);assert.equal(f.c.mediaDuration,0);
});

for(const stale of ['cancel','hidden','session','token','disposed'])test(`late successful acquire after ${stale} releases without attaching or revealing`,async t=>{
 const f=setup(t),held=gate();f.setAcquire(()=>held.promise);const pending=f.c.loadReviewMaterial(target);pending.catch(()=>{});await tick();
 if(stale==='cancel')f.c.stopReviewTracking();else if(stale==='hidden')f.c.document.hidden=true;else if(stale==='session')f.engine.resetSession();else if(stale==='token')f.c.mediaToken.current++;else f.c.disposed.current=true;
 const lease=f.makeLease();held.resolve(lease);await assert.rejects(pending);assert.equal(lease.releases,1);assert.equal(f.video.src,'');assert.deepEqual(f.video.sources,[]);
 assert.equal(f.c.reviewMediaRef.current,null);assert.equal(f.video.listenerCount,0);assert.equal(f.timers.size,0);assert.equal(f.video.plays,0);
});

test('actual tracking cancellation immediately rejects pending metadata and clears source ownership',async t=>{
 const f=setup(t),pending=await loading(f);f.c.stopReviewTracking('cancelled');await assert.rejects(pending.promise);cleaned(f,pending.lease);
});

for(const outcome of ['resolve','reject'])test(`old acquired promise may ${outcome} after a newer ready source without cleaning it`,async t=>{
 const f=setup(t),held=gate();f.setAcquire(()=>held.promise);const first=f.c.loadReviewMaterial(target);first.catch(()=>{});await tick();
 f.setAcquire(null);const newer=await ready(f),source=f.video.src,strict=f.c.reviewMediaRef.current;
 if(outcome==='resolve'){const stale=f.makeLease();held.resolve(stale);await assert.rejects(first);assert.equal(stale.releases,1)}else{held.reject(Error('old load failed'));await assert.rejects(first,/old load failed/)}
 assert.equal(f.video.src,source);assert.equal(f.c.originalMediaLease.current,newer);assert.equal(f.c.reviewMediaRef.current,strict);assert.equal(newer.releases,0);
 assert.equal(f.c.visualRef.current.ready,true);assert.equal(f.c.mediaDuration,media.durationSeconds);assert.equal(f.c.reviewMediaError(target),null);
});

test('old metadata rejection cannot clear a newer source after synchronous source replacement',async t=>{
 const f=setup(t),old=await loading(f),newer=await ready(f);await assert.rejects(old.promise);
 assert.equal(old.lease.releases,1);assert.equal(newer.releases,0);assert.equal(f.c.originalMediaLease.current,newer);assert.equal(f.video.src,newer.url);
 assert.equal(f.c.reviewMediaError(target),null);assert.equal(f.c.visualRef.current.ready,true);assert.equal(f.video.listenerCount,0);assert.equal(f.timers.size,0);
});

for(const selected of [target,correctedTarget])test(`actual detached verification validates complete ${selected.material.localReference?'corrected':'original'} target and disposes its preview`,async t=>{
 const f=setup(t,selected),before=f.engine.getSnapshot();const result=await f.c.verifyReviewMedia(selected.material,selected.cueId,selected);
 assert.deepEqual(result,selected);assert.equal(f.auxiliary.length,1);assert.equal(f.auxiliary[0].src,'');assert.equal(f.auxiliary[0].listenerCount,0);
 assert.equal(f.leases[0].releases,1);assert.equal(f.c.reviewVerificationRef.current,null);assert.equal(f.video.src,'');assert.equal(f.c.originalMediaLease.current,null);noExposure(f,before);
});

for(const patch of [
 {verified:false},{actualSha256:'0'.repeat(64)},{mediaSha256:'0'.repeat(64)},{mediaId:'other-media'},
])test(`actual detached verification rejects invalid lease ${Object.keys(patch)[0]} without fallback`,async t=>{
 const f=setup(t);f.setLease(patch);await assert.rejects(f.c.verifyReviewMedia(target.material,target.cueId));
 assert.equal(f.leases[0].releases,1);assert.equal(f.c.reviewVerificationRef.current,null);assert.equal(f.auxiliary[0].src,'');assert.equal(f.auxiliary[0].listenerCount,0);assert.equal(f.video.src,'');
});

for(const label of ['cue','digest','full snapshot','duration'])test(`actual detached verification refuses changed expected ${label}`,async t=>{
 const f=setup(t),expected=copy(target);
 if(label==='cue')expected.cueId=CAFE_MATERIAL.cues[0].id;else if(label==='digest')expected.materialDigest='0'.repeat(64);else if(label==='full snapshot')expected.material.rights='changed metadata';else expected.media.durationSeconds=72;
 await assert.rejects(f.c.verifyReviewMedia(target.material,target.cueId,expected),/完整摘要|固定版本/);assert.equal(f.leases[0].releases,1);assert.equal(f.c.reviewVerificationRef.current,null);
});

test('actual detached verification fails closed for missing correction ancestry and nonexistent target cue',async t=>{
 const f=setup(t,correctedTarget);f.setKnown(false);await assert.rejects(f.c.verifyReviewMedia(corrected,correctedTarget.cueId),/祖先链/);
 await assert.rejects(f.c.verifyReviewMedia(CAFE_MATERIAL,'missing-cue'),/目标句/);assert.equal(f.acquisitions.length,0);assert.equal(f.auxiliary.length,0);
});

test('actual detached verification checks corrected exact duration against its immutable media binding',async t=>{
 const f=setup(t,correctedTarget),create=f.c.document.createElement;f.c.document.createElement=name=>{const video=create(name);video.duration=72;return video};
 await assert.rejects(f.c.verifyReviewMedia(corrected,correctedTarget.cueId),/时长/);assert.equal(f.leases[0].releases,1);assert.equal(f.c.reviewVerificationRef.current,null);
});

test('actual verification tracking cancellation disposes the detached controller and fences late acquisition',async t=>{
 const f=setup(t),held=gate();f.setAcquire(()=>held.promise);const pending=f.c.verifyReviewMedia(target.material,target.cueId);pending.catch(()=>{});await tick();
 f.c.stopReviewTracking();const lease=f.makeLease();held.resolve(lease);await assert.rejects(pending);
 assert.equal(lease.releases,1);assert.equal(f.c.reviewVerificationRef.current,null);assert.equal(f.auxiliary[0].src,'');assert.equal(f.auxiliary[0].listenerCount,0);
});

for(const stale of ['cancel','disposed','lifecycle'])test(`actual verification fences ${stale} while immutable-library validation is pending`,async t=>{
 const f=setup(t,correctedTarget),held=gate();f.c.referenceRepositoryRef.current.isExactSavedMaterial=()=>held.promise;
 const pending=f.c.verifyReviewMedia(corrected,correctedTarget.cueId);pending.catch(()=>{});await tick();
 if(stale==='cancel')f.c.stopReviewTracking();else if(stale==='disposed')f.c.disposed.current=true;else f.c.life.current++;
 held.resolve(true);await assert.rejects(pending);assert.equal(f.acquisitions.length,0,'Cancelled ancestry read must not start new media acquisition');
 assert.equal(f.c.reviewVerificationRef.current,null);assert.equal(f.video.src,'');
});

test('actual verification cancellation during target digest cannot return a verified target afterward',async t=>{
 const f=setup(t),held=gate(),building=gate();f.c.buildReviewTarget=async(...args)=>{building.resolve();await held.promise;return buildReviewTarget(...args)};
 const pending=f.c.verifyReviewMedia(target.material,target.cueId);pending.catch(()=>{});await building.promise;f.c.stopReviewTracking();held.resolve();
 await assert.rejects(pending);assert.equal(f.c.reviewVerificationRef.current,null);assert.equal(f.leases[0].releases,1);assert.equal(f.auxiliary[0].src,'');
});

test('an older target digest cannot succeed after a newer detached verification owns the operation',async t=>{
 const f=setup(t),held=gate(),building=gate();let calls=0;
 f.c.buildReviewTarget=async(...args)=>{if(++calls===1){building.resolve();await held.promise}return buildReviewTarget(...args)};
 const old=f.c.verifyReviewMedia(target.material,target.cueId);old.catch(()=>{});await building.promise;
 assert.deepEqual(await f.c.verifyReviewMedia(target.material,target.cueId),target);held.resolve();await assert.rejects(old);
 assert.equal(f.c.reviewVerificationRef.current,null);assert.ok(f.leases.every(lease=>lease.releases===1));assert.ok(f.auxiliary.every(video=>video.src===''));
});


test('synchronous native lesson load failure clears its metadata listeners, timer and lease',async t=>{
 const f=setup(t),load=f.video.load.bind(f.video);
 f.video.load=()=>{if(f.video.src)throw Error('PRIVATE_NATIVE_LOAD_DETAIL');load()};
 await assert.rejects(f.c.loadReviewMaterial(target),error=>{
  assert.match(error.message,/lesson; MEDIA_0/);assert.equal(error.message.includes('PRIVATE_'),false);return true;
 });
 cleaned(f,f.leases[0]);
});
