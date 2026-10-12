import test from 'node:test';
import assert from 'node:assert/strict';
import {TypingFollowHost,type TypingFollowPorts} from '../media/typing-follow-host.ts';
import {NPS_MATERIAL} from './builtin-material.ts';
import type {TypingFollowEnvironment,TypingFollowAppend} from './typing-follow-policy.ts';
const flush=async()=>{await Promise.resolve();await Promise.resolve()};
function setup(){
 const cue=NPS_MATERIAL.cues[5],b=NPS_MATERIAL.builtinReference;
 let now=0,owner=0,revision=0,rate=1,time=cue.start,playCount=0,pauseCount=0,seekCount=0,rateCount=0,clamp:number|null=null,delay=false;
 const pending:Array<()=>void>=[],timers=new Map<object,()=>void>();
 const media={currentSrc:'verified:nps',readyState:4,error:null as MediaError|null,seekable:{length:1,start:()=>0,end:()=>b.media.durationSeconds},paused:true,get currentTime(){return time},set currentTime(v:number){time=v;seekCount++},get playbackRate(){return rate},set playbackRate(v:number){rate=clamp??v;rateCount++},pause(){if(!this.paused)pauseCount++;this.paused=true}};
 const identity={courseId:NPS_MATERIAL.id,courseVersion:NPS_MATERIAL.version,mediaId:b.media.id,mediaSha256:b.media.sha256,sentenceMapVersion:b.sentenceMapVersion,sentenceMapSha256:b.sentenceMapSha256,cueId:cue.id,cueStartSeconds:cue.start,cueEndSeconds:cue.end};
 const env={identity,referenceShown:true,mode:'legacy-typing',listeningPlayerActive:false,recording:'idle',composing:false,focused:true,visible:true,practiceActive:true,blocked:false,sourceVerified:true,inputProvenanceAvailable:true,mediaReady:true,mediaDurationSeconds:b.media.durationSeconds} as const;
 const override:{-readonly [K in keyof TypingFollowEnvironment]?:TypingFollowEnvironment[K]}={};
 const ports:TypingFollowPorts={media:()=>media,context:()=>({...env,...override,nowMs:now,playbackOwnerId:String(owner),mediaPositionSeconds:time,mediaRate:rate,draftRevision:revision}),claim(){owner++},
  async play(_intent,current,prepare){if(delay)await new Promise<void>(resolve=>pending.push(resolve));if(!current()||!prepare())return false;playCount++;media.paused=false;return true},release(){},changed(){},schedule(cb){const id={};timers.set(id,cb);return id},unschedule(id){timers.delete(id as object)}};
 const host=new TypingFollowHost(ports);
 return {host,media,override,pending,timers,ports,identity,get counts(){return{playCount,pauseCount,seekCount,rateCount}},set now(v:number){now=v},set rate(v:number){rate=v},set position(v:number){time=v},set clamp(v:number|null){clamp=v},set delay(v:boolean){delay=v},newOwner(){owner++},edit(data='a',source:TypingFollowAppend['source']='typed'){const before='a'.repeat(revision),edit:TypingFollowAppend={before,after:before+data,beforeRevision:revision,afterRevision:++revision,selectionBefore:{start:before.length,end:before.length},source,kind:'input',inputType:'insertText',data,isTrusted:true,isComposing:false};host.input(edit)},async start(){host.start(true);await flush()},async advance(ms:number){now+=ms;host.tick();await flush()}};
}
test('off has no media calls or timer; only explicit Start seeks exactly once',async()=>{const f=setup();f.host.tick();f.host.start(false);assert.equal(f.counts.playCount,0);assert.equal(f.timers.size,0);await f.start();assert.equal(f.host.snapshot.phase,'following');assert.equal(f.media.playbackRate,.8);assert.equal(f.counts.seekCount,1);await f.advance(400);f.edit();await flush();assert.equal(f.counts.seekCount,1)});
test('Start synchronously silences previous media while authentication is pending',async()=>{const f=setup();f.delay=true;f.media.paused=false;f.position=f.identity.cueEndSeconds-.01;f.host.start(true);assert.equal(f.media.paused,true);assert.equal(f.counts.pauseCount,1);assert.equal(f.counts.playCount,0);f.position=f.identity.cueEndSeconds+.3;f.host.boundary();assert.equal(f.media.paused,true);f.host.stop();f.pending[0]();await flush();assert.equal(f.counts.playCount,0)});
test('owned idle keeps original media playing and renewed append never replays or seeks',async()=>{const f=setup();await f.start();f.position=f.media.currentTime+.4;await f.advance(750);await f.advance(750);assert.equal(f.host.snapshot.phase,'following');assert.equal(f.host.snapshot.reason,'idle-coasting');assert.equal(f.media.paused,false);const at=f.media.currentTime;f.edit();await flush();assert.equal(f.host.snapshot.phase,'following');assert.equal(f.host.snapshot.reason,null);assert.equal(f.media.currentTime,at);assert.equal(f.counts.seekCount,1);assert.equal(f.counts.playCount,1);assert.equal(f.counts.pauseCount,0)});
test('idle coasting continuously slows one original media owner and stops at sentence end',async()=>{
 const f=setup();await f.start();let previous=.8,coasted=false,ended=false;
 for(let step=0;step<1000&&f.host.active;step++){
  f.position=f.media.currentTime+f.media.playbackRate*.05;await f.advance(50);
  if(f.host.active){assert.ok(f.media.playbackRate<=previous+1e-9);assert.ok(previous-f.media.playbackRate<=.05+1e-9);previous=f.media.playbackRate;assert.equal(f.media.paused,false)}
  coasted ||= f.host.snapshot.reason==='idle-coasting';ended ||= f.host.snapshot.phase==='ended';
 }
 assert.equal(coasted,true);assert.equal(ended,true);assert.equal(f.media.paused,true);assert.equal(f.counts.playCount,1);assert.equal(f.counts.seekCount,1);assert.equal(f.counts.pauseCount,1);assert.equal(f.media.playbackRate,1);assert.equal(f.timers.size,0);
 assert.ok(f.media.currentTime>=f.identity.cueEndSeconds&&f.media.currentTime<f.identity.cueEndSeconds+.03,'authored 50ms tick fixture only; real mobile overshoot is unverified');
 f.edit();await flush();assert.equal(f.counts.playCount,1);
});
test('sentence end stays terminal and intercepts legacy rewind after active scope ends',async()=>{const f=setup();await f.start();f.position=f.identity.cueEndSeconds;assert.equal(f.host.boundary(),true);assert.equal(f.host.snapshot.phase,'ended');assert.equal(f.media.currentTime,f.identity.cueEndSeconds);f.edit();await flush();assert.equal(f.counts.playCount,1);assert.equal(f.counts.seekCount,1);assert.equal(f.host.boundary(),true);assert.equal(f.timers.size,0)});
test('manual pause cancels future typing and restores only its native rate',async()=>{const f=setup();f.rate=1.25;await f.start();f.host.stop('manual-pause');assert.equal(f.media.paused,true);assert.equal(f.media.playbackRate,1.25);f.edit();await flush();assert.equal(f.counts.playCount,1)});
test('external rate wins without base restore; native rate mismatch stops control',async()=>{const f=setup();await f.start();f.rate=2;f.host.native('ratechange');assert.equal(f.host.active,false);assert.equal(f.media.playbackRate,2);assert.equal(f.counts.rateCount,1)});
test('clamped adaptive write fails closed paused without fake applied-rate display',async()=>{const f=setup();await f.start();await f.advance(250);f.edit();await f.advance(250);f.edit();await f.advance(500);assert.equal(f.media.paused,false);f.clamp=1;await f.advance(250);assert.equal(f.host.active,false);assert.equal(f.media.paused,true);assert.equal(f.host.snapshot.reason,'media-error')});
test('late pending play cannot pause or retune a newer source owner',async()=>{const f=setup();f.delay=true;f.host.start(true);f.newOwner();f.media.currentSrc='new:source';f.media.paused=false;f.rate=1.75;f.host.tick();const before=f.counts;f.pending[0]();await flush();assert.deepEqual(f.counts,before);assert.equal(f.media.paused,false);assert.equal(f.media.playbackRate,1.75)});
for(const [name,change]of [['hidden',{referenceShown:false}],['background',{visible:false}],['blur',{focused:false}],['recording',{recording:'preparing'}],['listening',{listeningPlayerActive:true}],['modal',{blocked:true}],['restore',{practiceActive:false}],['source',{sourceVerified:false}]] as const)test(`${name} cancels and never auto-rearms`,async()=>{const f=setup();await f.start();Object.assign(f.override,change);await f.advance(50);assert.equal(f.host.active,false);assert.equal(f.media.paused,true);Object.keys(change).forEach(k=>delete (f.override as any)[k]);f.edit();await flush();assert.equal(f.counts.playCount,1)});
test('hidden or blocked start causes no playback, seek or rate writes',async()=>{for(const change of [{referenceShown:false},{recording:'recording' as const},{blocked:true},{practiceActive:false}]){const f=setup();Object.assign(f.override,change);await f.start();assert.deepEqual(f.counts,{playCount:0,pauseCount:0,seekCount:0,rateCount:0})}});
test('composition pauses preedit; cancel cannot resume; next genuine typing can',async()=>{const f=setup();await f.start();f.override.composing=true;f.host.compositionStart(1);assert.equal(f.media.paused,true);assert.equal(f.host.snapshot.phase,'waiting');f.override.composing=false;f.host.compositionCancel(1);await flush();assert.equal(f.counts.playCount,1);f.edit();await flush();assert.equal(f.counts.playCount,2)});
test('paste and unknown input disarm without seeking or scoring capability',async()=>{for(const source of ['paste','unknown','programmatic'] as const){const f=setup();await f.start();f.edit('a',source);await flush();assert.equal(f.media.paused,true);assert.equal(f.host.active,false);assert.equal(f.counts.seekCount,1)}});
test('queued owned pause remains attributable after scope ends',async()=>{const f=setup();await f.start();f.host.stop();assert.equal(f.host.native('pause'),true);assert.equal(f.host.native('pause'),false)});
test('dispose clears timer and late settlement cannot restart media',async()=>{const f=setup();f.delay=true;f.host.start(true);f.host.dispose();assert.equal(f.timers.size,0);f.pending[0]();await flush();assert.equal(f.counts.playCount,0)});

test('unavailable seekable range fails paused without queueing a future seek',async()=>{const f=setup();f.media.seekable.length=0;await f.start();assert.equal(f.host.active,false);assert.equal(f.media.paused,true);assert.equal(f.counts.seekCount,0);assert.equal(f.counts.playCount,0);assert.equal(f.host.snapshot.reason,'play-rejected')});
test('new native rate during pending initial admission is never overwritten',async()=>{const f=setup();f.delay=true;f.host.start(true);f.rate=2;f.pending[0]();await flush();assert.equal(f.media.playbackRate,2);assert.equal(f.counts.rateCount,0);assert.equal(f.host.active,false)});

test('queued owned pause after newer play stays attributed without canceling resumed owner',async()=>{const f=setup();f.media.paused=false;await f.start();assert.equal(f.media.paused,false);assert.equal(f.host.native('pause'),true);assert.equal(f.host.snapshot.phase,'following');assert.equal(f.media.paused,false)});
test('queued owned play after composition pause cannot resume or unfreeze the waiting scope',async()=>{const f=setup();await f.start();f.override.composing=true;f.host.compositionStart(1);assert.equal(f.media.paused,true);assert.equal(f.host.native('play'),true);assert.equal(f.host.snapshot.phase,'waiting');assert.equal(f.media.paused,true)});

test('queued known old-owner pause is consumed without mutating a newer source',async()=>{const f=setup();await f.start();f.host.stop();f.newOwner();f.media.currentSrc='new:source';f.media.paused=false;f.rate=2;const before=f.counts;assert.equal(f.host.native('pause'),true);assert.deepEqual(f.counts,before);assert.equal(f.media.paused,false);assert.equal(f.media.playbackRate,2)});
test('queued prior-epoch pause cannot cancel an immediate new Follow start',async()=>{const f=setup();await f.start();f.host.stop();await f.start();assert.equal(f.host.snapshot.phase,'following');const before=f.counts;assert.equal(f.host.native('pause'),true);assert.equal(f.host.snapshot.phase,'following');assert.deepEqual(f.counts,before)});

test('queued owned rate events A then B read latest B without canceling control',async()=>{const f=setup();await f.start();await f.advance(250);f.edit();await f.advance(250);f.edit();await f.advance(500);assert.equal(f.media.playbackRate,.75);assert.equal(f.host.native('ratechange'),true);assert.equal(f.host.native('ratechange'),true);assert.equal(f.host.snapshot.phase,'following')});
test('queued initial seek after playback advances remains owned within cue',async()=>{const f=setup();await f.start();f.position=f.identity.cueStartSeconds+.4;assert.equal(f.host.native('seeking'),true);assert.equal(f.host.snapshot.phase,'following');assert.equal(f.counts.seekCount,1)});

test('rejected Follow play does not leave phantom tickets that suppress later ordinary play',async()=>{const f=setup();f.ports.play=async(_intent,current,prepare)=>{assert.equal(current(),true);assert.equal(prepare(),true);throw Error('NotAllowedError')};await f.start();assert.equal(f.host.active,false);assert.equal(f.host.snapshot.reason,'play-rejected');f.newOwner();f.media.paused=false;assert.equal(f.host.native('play'),false);assert.equal(f.host.native('playing'),false)});

test('aborted native play retains queued play attribution but not a phantom playing event',async()=>{const f=setup();f.ports.play=async(_intent,current,prepare,issued)=>{assert.equal(current(),true);assert.equal(prepare(),true);f.media.paused=false;issued();throw Error('AbortError')};await f.start();assert.equal(f.host.active,false);assert.equal(f.media.paused,true);assert.equal(f.host.native('play'),true);assert.equal(f.host.native('playing'),false)});

test('matched queued play under an ended lease silences and attributes its cleanup',async()=>{const f=setup();await f.start();f.host.stop();f.media.paused=false;assert.equal(f.host.native('play'),true);assert.equal(f.media.paused,true);assert.equal(f.host.native('pause'),true)});

test('native source load discards old event tickets before ordinary replacement playback',async()=>{const f=setup();await f.start();f.host.stop();f.newOwner();f.media.currentSrc='replacement:media';f.host.native('emptied');f.media.paused=false;assert.equal(f.host.native('play'),false);f.media.paused=true;assert.equal(f.host.native('pause'),false);assert.equal(f.host.native('playing'),false)});

test('bounded issued pause ticket survives a long background scheduling delay',async()=>{const f=setup();await f.start();f.host.stop();f.newOwner();await f.advance(60000);assert.equal(f.host.native('pause'),true);assert.equal(f.host.native('pause'),false)});

test('semantic identity ownership ignores property order and undeclared fields',async()=>{
 for(const identityShape of ['reversed','extra'] as const){
  const f=setup();f.override.identity=Object.fromEntries([...Object.entries(f.identity).reverse(),...(identityShape==='extra'?[['presentationOnly','ignored']]:[])]) as unknown as typeof f.identity;
  f.media.paused=false;f.delay=true;f.host.start(true);
  assert.equal(f.media.paused,true,'verified same identity must synchronously silence ordinary media before awaiting');
  assert.equal(f.counts.pauseCount,1);f.pending[0]();await flush();
  assert.equal(f.host.snapshot.phase,'following');assert.equal(f.counts.playCount,1);assert.equal(f.counts.seekCount,1);
  f.host.stop();assert.equal(f.media.paused,true);assert.equal(f.media.playbackRate,1);
 }
});

test('owned native waiting then playing recovers after initial command tickets are consumed',async()=>{
 const f=setup();await f.start();for(const event of ['seeking','ratechange','play','playing'] as const)assert.equal(f.host.native(event),true);
 assert.equal(f.host.native('waiting'),true);assert.equal(f.host.snapshot.phase,'following');assert.equal(f.media.paused,false);
 f.override.mediaReady=false;await f.advance(200);assert.equal(f.host.snapshot.phase,'following');assert.equal(f.media.paused,false);
 f.override.mediaReady=true;assert.equal(f.host.native('playing'),true);assert.equal(f.host.snapshot.phase,'following');assert.equal(f.media.paused,false);
 assert.equal(f.counts.playCount,1);assert.equal(f.counts.seekCount,1);assert.equal(f.counts.pauseCount,0);
});

async function playingFixture(){const f=setup();await f.start();for(const event of ['seeking','ratechange','play','playing'] as const)assert.equal(f.host.native(event),true);return f}
test('metadata-ready buffering can begin after data readiness drops and accepts latest owned rate',async()=>{
 const f=await playingFixture();f.override.mediaReady=false;f.media.readyState=1;
 assert.equal(f.host.native('waiting'),true);
 for(let i=0;i<12;i++)await f.advance(200);
 assert.equal(f.host.active,true);assert.ok(f.media.playbackRate<.8);assert.equal(f.media.paused,false);
 f.media.readyState=2;f.override.mediaReady=true;assert.equal(f.host.native('playing'),true);
 assert.equal(f.host.active,true);assert.equal(f.counts.playCount,1);assert.equal(f.counts.seekCount,1);assert.equal(f.counts.pauseCount,0);
 assert.equal(f.host.native('stalled'),true);assert.equal(f.host.native('playing'),true);
});
test('unobserved data loss and caller-supplied buffering cannot authorize playback',async()=>{
 const initial=setup();initial.override.mediaReady=false;initial.override.mediaBuffering=true;await initial.start();assert.equal(initial.host.active,false);assert.equal(initial.counts.playCount,0);
 const f=await playingFixture();f.override.mediaReady=false;f.override.mediaBuffering=true;f.media.readyState=1;await f.advance(50);
 assert.equal(f.host.active,false);assert.equal(f.media.paused,true);assert.equal(f.host.native('waiting'),false);assert.equal(f.host.native('playing'),false);
});
for(const nativeProblem of ['unloaded','error']as const)test(`buffer admission never accepts native ${nativeProblem}`,async()=>{
 for(const alreadyWaiting of [false,true]){
  const f=await playingFixture();if(alreadyWaiting)assert.equal(f.host.native('waiting'),true);
  f.override.mediaReady=false;if(nativeProblem==='unloaded')f.media.readyState=0;else f.media.error={code:3}as MediaError;
  if(alreadyWaiting)await f.advance(50);else assert.equal(f.host.native('waiting'),false);
  assert.equal(f.host.active,false);assert.equal(f.media.paused,true);assert.equal(f.host.native('playing'),false);
 }
});
for(const [name,patch]of [['hidden',{referenceShown:false}],['background',{visible:false}],['blur',{focused:false}],['recording',{recording:'preparing'}],['source-invalid',{sourceVerified:false}],['blocked',{blocked:true}]]as const)test(`buffer recovery rechecks ${name} before accepting playing`,async()=>{
 const f=await playingFixture();assert.equal(f.host.native('waiting'),true);Object.assign(f.override,patch);
 assert.equal(f.host.native('playing'),false);assert.equal(f.host.active,false);assert.equal(f.media.paused,true);assert.equal(f.counts.playCount,1);
});
test('buffer recovery refuses new play and changed manual rate',async()=>{
 for(const external of ['play','rate']as const){const f=await playingFixture();f.host.native('waiting');if(external==='rate')f.rate=1.3;
  assert.equal(f.host.native(external==='play'?'play':'playing'),false);assert.equal(f.host.active,false);assert.equal(f.counts.playCount,1);
  if(external==='rate')assert.equal(f.media.playbackRate,1.3,'do not restore over an external rate');
 }
});
for(const boundary of ['pause','composition','ended','owner','source','identity']as const)test(`buffer recovery cannot revive ${boundary} scope`,async()=>{
 const f=await playingFixture();f.host.native('waiting');
 if(boundary==='pause')f.host.stop('manual-pause');
 if(boundary==='composition'){f.override.composing=true;f.host.compositionStart(1)}
 if(boundary==='ended'){f.position=f.identity.cueEndSeconds;f.host.boundary()}
 if(boundary==='owner')f.newOwner();
 if(boundary==='source')f.media.currentSrc='verified:new-source';
 if(boundary==='identity')f.override.identity={...f.identity,cueId:'another-cue'};
 const before=f.counts;assert.equal(f.host.native('playing'),false);assert.equal(f.host.active,false);assert.equal(f.counts.playCount,1);
 if(['owner','source','identity'].includes(boundary))assert.deepEqual(f.counts,before,'no writes to a replacement owner or source');
});
test('native paused state alone cannot borrow a prior buffering admission',async()=>{
 const f=await playingFixture();f.host.native('waiting');f.media.paused=true;
 assert.equal(f.host.native('playing'),false);assert.equal(f.host.active,false);assert.equal(f.media.paused,true);
});
test('waiting during a valid pending native play preserves its original request without buffer admission',async()=>{
 const f=setup();let resolve!:(ok:boolean)=>void;
 f.ports.play=(_intent,current,prepare,issued)=>{assert.equal(current(),true);assert.equal(prepare(),true);f.media.paused=false;issued();return new Promise<boolean>(done=>{resolve=done})};
 f.host.start(true);assert.equal(f.host.snapshot.phase,'starting');assert.equal(f.host.native('waiting'),false);assert.equal(f.host.active,true);
 resolve(true);await flush();assert.equal(f.host.snapshot.phase,'following');assert.equal(f.host.native('playing'),true);assert.equal(f.media.paused,false);
 assert.equal(f.host.native('playing'),false,'waiting before success never authorizes an extra recovery event');assert.equal(f.host.active,false);
});
test('unadmitted pending waiting retains its original timeout and rejects later buffering',async()=>{
 const f=setup();f.delay=true;f.host.start(true);assert.equal(f.host.native('waiting'),false);assert.equal(f.host.active,true);
 await f.advance(750);await f.advance(750);assert.equal(f.host.active,false);assert.equal(f.host.snapshot.reason,'play-timeout');f.pending[0]();await flush();assert.equal(f.counts.playCount,0);
 const rejected=setup();rejected.ports.play=async()=>false;await rejected.start();assert.equal(rejected.host.native('waiting'),false);assert.equal(rejected.host.native('playing'),false);assert.equal(rejected.counts.playCount,0);
});

function initialSeekDecodeFixture(synchronousNativeSeek=false){
 const f=setup();let settle!:(ok:boolean)=>void,plays=0,current!:()=>boolean;
 const original=Object.getOwnPropertyDescriptor(f.media,'currentTime')!;
 Object.defineProperty(f.media,'currentTime',{...original,set(value:number){original.set!.call(f.media,value);f.media.readyState=1;f.override.mediaReady=false;if(synchronousNativeSeek){f.host.native('seeking');f.host.tick()}}});
 f.ports.play=(_intent,isCurrent,prepare,issued)=>{
  current=isCurrent;if(!current()||!prepare())return Promise.resolve(false);
  plays++;f.media.paused=false;issued();return new Promise<boolean>(resolve=>{settle=resolve});
 };
 f.host.start(true);
 return Object.assign(f,{getPlays:()=>plays,isCurrent:()=>current(),settle(ok:boolean){settle(ok)},restore(){f.media.readyState=2;f.override.mediaReady=true}});
}
test('admitted initial seek can synchronously lose current-data readiness before guarded play',async()=>{
 const f=initialSeekDecodeFixture();assert.equal(f.getPlays(),1);assert.equal(f.host.snapshot.phase,'starting');assert.equal(f.isCurrent(),true);
 f.restore();f.settle(true);await flush();assert.equal(f.host.snapshot.phase,'following');assert.equal(f.media.paused,false);assert.equal(f.counts.seekCount,1);
});
for(const event of ['play','waiting','stalled','tick']as const)test(`owned initial-seek metadata decode survives ${event} under the original pending command`,async()=>{
 const f=initialSeekDecodeFixture();assert.equal(f.getPlays(),1);const pending=f.host.snapshot.active!.pendingPlay;
 if(event==='tick')await f.advance(50);else f.host.native(event);
 assert.equal(f.host.snapshot.phase,'starting');assert.deepEqual(f.host.snapshot.active!.pendingPlay,pending);assert.equal(f.media.paused,false);
 f.restore();f.settle(true);await flush();assert.equal(f.host.snapshot.phase,'following');
});

test('metadata-only entry and caller-supplied initial-seek claims never admit a new request',async()=>{
 for(const mediaReady of [false,true]){const f=setup();f.media.readyState=1;f.override.mediaReady=mediaReady;f.override.mediaInitialSeekCommandId=1;
  await f.start();assert.equal(f.host.active,false);assert.equal(f.counts.playCount,0);assert.equal(f.counts.seekCount,0);assert.equal(f.counts.rateCount,0);
 }
 const f=setup();f.delay=true;f.host.start(true);f.media.readyState=1;f.override.mediaReady=false;f.override.mediaInitialSeekCommandId=f.host.snapshot.active!.pendingPlay!.commandId;
 f.host.tick();assert.equal(f.host.active,false);f.pending[0]();await flush();assert.equal(f.counts.playCount,0);assert.equal(f.counts.seekCount,0);
});
test('initial seek decoding keeps original deadline and cannot turn early success into following',async()=>{
 const timed=initialSeekDecodeFixture(),original=timed.host.snapshot.active!.pendingPlay!.issuedMs;
 await timed.advance(750);assert.equal(timed.host.snapshot.active!.pendingPlay!.issuedMs,original);timed.host.native('waiting');
 await timed.advance(750);assert.equal(timed.host.active,false);assert.equal(timed.host.snapshot.reason,'play-timeout');assert.equal(timed.media.paused,true);assert.equal(timed.media.playbackRate,1);
 timed.restore();timed.settle(true);await flush();assert.equal(timed.host.active,false);assert.equal(timed.getPlays(),1);
 const early=initialSeekDecodeFixture();early.settle(true);await flush();assert.equal(early.host.active,false);assert.equal(early.media.paused,true);assert.equal(early.media.playbackRate,1);
 early.restore();early.host.tick();assert.equal(early.host.active,false);
});
for(const [name,patch]of [
 ['hidden',{referenceShown:false}],['background',{visible:false}],['blur',{focused:false}],['recording',{recording:'preparing'}],
 ['listening',{listeningPlayerActive:true}],['mode',{mode:'dictation'}],['practice',{practiceActive:false}],['blocked',{blocked:true}],
 ['source-verification',{sourceVerified:false}],['duration',{mediaDurationSeconds:NaN}],['changed-duration',{mediaDurationSeconds:99}],['provenance',{inputProvenanceAvailable:false}],
]as const)test(`initial seek decode never relaxes ${name}`,async()=>{
 const f=initialSeekDecodeFixture();Object.assign(f.override,patch);assert.equal(f.isCurrent(),false);f.host.tick();assert.equal(f.host.active,false);assert.equal(f.media.paused,true);
 f.restore();f.settle(true);await flush();assert.equal(f.host.active,false);assert.equal(f.getPlays(),1);
});
for(const change of ['owner','source','identity','error','unloaded','rate','pause','composition','rejected','ended']as const)test(`initial seek decode loses authority on ${change}`,async()=>{
 const f=initialSeekDecodeFixture();
 if(change==='owner')f.newOwner();if(change==='source')f.media.currentSrc='new:source';if(change==='identity')f.override.identity={...f.identity,cueId:'new-cue'};
 if(change==='error')f.media.error={code:3}as MediaError;if(change==='unloaded')f.media.readyState=0;if(change==='rate')f.rate=1.7;
 if(change==='pause')f.host.stop();if(change==='composition'){f.override.composing=true;f.host.compositionStart(1)};
 if(change==='rejected'){f.settle(false);await flush()};if(change==='ended')f.position=f.identity.cueEndSeconds;
 if(change!=='ended')assert.equal(f.isCurrent(),false);
 const before=f.counts;f.host.tick();
 if(change==='composition'){assert.equal(f.media.paused,true);assert.equal(f.host.active,false);f.override.composing=false;f.host.compositionCancel(1)}
 else if(change!=='ended')assert.equal(f.host.active,false);
 if(['owner','source','identity'].includes(change))assert.deepEqual(f.counts,before,'do not mutate replacement ownership');
 if(change==='rate')assert.equal(f.media.playbackRate,1.7,'do not overwrite external rate');
 f.restore();if(change!=='rejected')f.settle(true);await flush();assert.equal(f.host.active,false);assert.equal(f.getPlays(),1);
});
test('old initial decode cannot grant metadata-only readiness to composition resume or new epoch',async()=>{
 const f=initialSeekDecodeFixture();f.override.composing=true;f.host.compositionStart(1);f.override.composing=false;f.host.compositionCancel(1);
 f.edit();await flush();assert.equal(f.host.active,false);assert.equal(f.getPlays(),1);f.restore();f.settle(true);await flush();assert.equal(f.host.active,false);
 f.media.readyState=1;f.override.mediaReady=false;f.host.start(true);assert.equal(f.host.active,false);assert.equal(f.getPlays(),1);
});

test('own initial seek survives synchronous native seeking and boundary tick before the rate write',async()=>{
 const f=initialSeekDecodeFixture(true);assert.equal(f.getPlays(),1);assert.equal(f.host.snapshot.phase,'starting');
 f.host.native('play');f.host.native('waiting');f.restore();f.host.native('playing');f.settle(true);await flush();
 assert.equal(f.host.snapshot.phase,'following');assert.equal(f.media.paused,false);assert.equal(f.counts.seekCount,1);
});

test('issued initial play also tolerates metadata loss after prepare without issuing another play',async()=>{
 const f=setup();let finish!:(ok:boolean)=>void,plays=0;
 f.ports.play=(_intent,current,prepare,issued)=>{assert.equal(current(),true);assert.equal(prepare(),true);plays++;f.media.paused=false;issued();return new Promise<boolean>(resolve=>{finish=resolve})};
 f.host.start(true);f.media.readyState=1;f.override.mediaReady=false;const request=f.host.snapshot.active!.pendingPlay;
 assert.equal(f.host.native('play'),true);assert.equal(f.host.native('waiting'),false);await f.advance(50);
 assert.equal(f.host.snapshot.phase,'starting');assert.deepEqual(f.host.snapshot.active!.pendingPlay,request);assert.equal(plays,1);
 f.media.readyState=2;f.override.mediaReady=true;f.host.native('playing');finish(true);await flush();assert.equal(f.host.snapshot.phase,'following');assert.equal(plays,1);assert.equal(f.counts.seekCount,1);
});

test('restored data readiness cannot bypass original pending seek rate and duration ownership',async()=>{
 for(const change of ['rate','duration']as const){const f=initialSeekDecodeFixture();f.restore();if(change==='rate')f.rate=1.7;else f.override.mediaDurationSeconds=99999;
  assert.equal(f.isCurrent(),false);f.host.tick();assert.equal(f.host.active,false);assert.equal(f.media.paused,true);
  if(change==='rate')assert.equal(f.media.playbackRate,1.7);f.settle(true);await flush();assert.equal(f.host.active,false);
 }
});

test('native play synchronously reaching sentence end settles terminally without leaving starting',async()=>{
 const f=setup();f.ports.play=async(_intent,current,prepare,issued)=>{assert.equal(current(),true);assert.equal(prepare(),true);f.media.paused=false;issued();f.position=f.identity.cueEndSeconds;return true};
 await f.start();assert.equal(f.media.paused,true);assert.equal(f.host.snapshot.phase,'ended');assert.equal(f.host.active,false);assert.equal(f.timers.size,0);assert.equal(f.counts.seekCount,1);
 f.edit();await flush();assert.equal(f.host.snapshot.phase,'ended');
});
