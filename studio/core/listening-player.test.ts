import test from 'node:test';import assert from 'node:assert/strict';
import {ListeningPlayer} from '../media/listening-player.ts';import {ORIGINAL_COURSE_MEDIA} from '../media/context-bookmark-media.ts';import {CAFE_MATERIAL} from './training.ts';
class Media extends EventTarget{src='';preload='';playsInline=false;playbackRate=1;currentTime=0;duration=72;readyState=4;paused=true;ended=false;seeking=false;muted=false;volume=1;plays=0;emit(n:string){this.dispatchEvent(new Event(n))}async play(){this.plays++;this.paused=false;this.emit('playing')}pause(){if(!this.paused){this.paused=true;this.emit('pause')}}removeAttribute(n:string){if(n==='src')this.src=''}load(){}advance(n:number){this.currentTime=n;this.emit('timeupdate')}}
function setup(){let now=0,hidden=false,before=0,blocked=false;const media=new Media();const player=new ListeningPlayer({media:media as unknown as HTMLVideoElement,lease:{url:'blob:verified',mediaId:ORIGINAL_COURSE_MEDIA.mediaId,mediaSha256:ORIGINAL_COURSE_MEDIA.mediaSha256,actualSha256:ORIGINAL_COURSE_MEDIA.mediaSha256,verified:true,verificationError:null,release(){}},descriptor:ORIGINAL_COURSE_MEDIA,material:CAFE_MATERIAL,identity:{runId:'r',sessionId:'s',roundId:'s',materialId:CAFE_MATERIAL.id,materialVersion:CAFE_MATERIAL.version,referenceVersion:CAFE_MATERIAL.version,mediaId:ORIGINAL_COURSE_MEDIA.mediaId,mediaSha256:ORIGINAL_COURSE_MEDIA.mediaSha256},now:()=>now,hidden:()=>hidden,beforeListen:()=>before++,changed(){},blocked:()=>blocked});return{media,player,block:(value=true)=>{blocked=value},tick:(n:number,t:number)=>{now=n;media.advance(t)},hide:()=>{hidden=true;player.visibilityChanged()},show:()=>{hidden=false;player.visibilityChanged()},before:()=>before}}
test('continuous listen crosses cue boundary without Training navigation',async()=>{const{media,player,tick,before}=setup();try{player.enter(0);await player.play();tick(1000,1);tick(6000,6);tick(7000,7);assert.equal(media.paused,false);assert.equal(player.getState().frame.cueId,CAFE_MATERIAL.cues[1].id);assert.equal(before(),1)}finally{player.dispose()}});
test('native speeds apply; repeat exactly one stops at verified cue end',async()=>{const{media,player,tick}=setup();try{player.enter(0);player.rate(.8);assert.equal(media.playbackRate,.8);player.rate(.3);assert.equal(media.playbackRate,.8);player.repeatCurrent(1);await Promise.resolve();tick(1000,6);assert.equal(media.paused,true);assert.equal(media.currentTime,6);assert.equal(player.getState().loopRemaining,0)}finally{player.dispose()}});
test('typing fixes selected cue, retains original text separation, pauses at its end',async()=>{const{media,player,tick}=setup();try{player.enter(6);player.type(1);player.nativeInput();await player.play();tick(1000,7);tick(6000,12);assert.equal(media.paused,true);assert.equal(player.getState().mode,'type');assert.equal(player.getState().position,12)}finally{player.dispose()}});
test('help keeps exact position and close does not auto resume',async()=>{const{media,player,tick}=setup();try{player.enter(0);await player.play();tick(1000,1);player.help();assert.equal(media.currentTime,1);assert.equal(media.paused,true);player.closeHelp();assert.equal(media.paused,true);assert.equal(player.getState().helpOpen,false)}finally{player.dispose()}});
test('hidden suspends answer layer but permits native playback only',async()=>{const{media,player,tick,hide}=setup();try{player.enter(0);await player.play();tick(1000,1);hide();assert.equal(media.paused,false);assert.equal(player.getState().frame.text,'');tick(2000,2);tick(3000,3);assert.ok(player.getState().observation.totals.backgroundMs>0)}finally{player.dispose()}});
test('canceling delayed repeat cannot resurrect playback',async()=>{const{media,player,tick}=setup();try{player.enter(0);player.repeatCurrent(2,.01);await Promise.resolve();tick(1000,6);player.pause();await new Promise(r=>setTimeout(r,25));assert.equal(media.paused,true);assert.equal(media.plays,1)}finally{player.dispose()}});
test('unknown reference interval has no fabricated cue or repeat',()=>{const{media,player}=setup();try{player.enter(90);media.currentTime=90;player.repeatCurrent();assert.match(player.getState().error??'',/没有已核验/);assert.equal(media.plays,0)}finally{player.dispose()}});

// These exercise the real native player with synthetic media events, not browser audio.
test('host block prevents direct play, repeat and continuous controls without clearing a known error',async()=>{
 const{media,player,block}=setup();try{player.enter(2);media.emit('error');const error=player.getState().error;block();await player.play();player.repeatCurrent(2,.01);player.continueAll();await Promise.resolve();assert.equal(media.plays,0);assert.equal(media.paused,true);assert.equal(media.currentTime,2,'blocked repeat must preserve the paused position');assert.equal(player.getState().error,error);block(false);assert.equal(media.plays,0,'unblocking never resumes media');await player.play();assert.equal(media.plays,1)}finally{player.dispose()}
});
test('host becoming blocked during native play admission stops the late media start',async()=>{
 const{media,player,block}=setup();let release!:()=>void;media.play=()=>new Promise<void>(resolve=>{release=()=>{media.paused=false;media.emit('playing');resolve()}});try{player.enter(0);const pending=player.play();block();release();assert.equal(media.paused,true,'a blocked playing event must stop synchronously');await pending;assert.equal(media.paused,true);block(false);assert.equal(media.paused,true)}finally{player.dispose()}
});
test('blocked repeat timeout cannot seek or restart native playback',async()=>{
 const{media,player,tick,block}=setup();try{player.enter(0);player.repeatCurrent(2,.01);await Promise.resolve();tick(1000,6);block();await new Promise(r=>setTimeout(r,25));assert.equal(media.plays,1);assert.equal(media.currentTime,6);assert.equal(media.paused,true);block(false);assert.equal(media.paused,true)}finally{player.dispose()}
});

for(const repeats of [2,3,Infinity])test(`explicit play resumes canceled repeat gap with ${repeats} selected passes`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const{media,player,tick,block}=setup();try{
  player.enter(0);player.repeatCurrent(repeats,.01);await Promise.resolve();tick(1000,6);assert.equal(media.paused,true);
  const remaining=player.getState().loopRemaining;block();player.pause();t.mock.timers.tick(20);await player.play();assert.equal(media.currentTime,6);assert.equal(media.plays,1);block(false);assert.equal(media.paused,true);
  await player.play();assert.equal(media.currentTime,0,'explicit resume re-enters the active selected repeat cue');assert.equal(media.plays,2);assert.equal(player.getState().loopRemaining,remaining>0?remaining-1:remaining);tick(1500,.5);assert.equal(media.paused,false);
  for(let pass=2;pass<=(repeats===Infinity?3:repeats);pass++){
   tick(pass*1000,6);assert.equal(media.paused,true);
   if(pass<repeats){t.mock.timers.tick(20);await Promise.resolve();assert.equal(media.currentTime,0);assert.equal(media.plays,pass+1)}
  }
  if(repeats!==Infinity){assert.equal(media.plays,repeats);await player.play();assert.equal(media.currentTime,6,'finished finite repeat has released its cue scope');tick(5000,7);assert.equal(media.paused,false)}
 }finally{player.dispose()}
});
test('explicit play during repeat gap cancels its old timeout without a second restart',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const{media,player,tick}=setup();try{player.enter(0);player.repeatCurrent(2,.01);await Promise.resolve();tick(1000,6);await player.play();assert.equal(media.currentTime,0);tick(1500,.5);t.mock.timers.tick(20);assert.equal(media.plays,2);assert.equal(media.currentTime,.5);assert.equal(media.paused,false)}finally{player.dispose()}
});
test('fixed type cue explicitly restarts at its own beginning after reaching the end',async()=>{
 const{media,player,tick}=setup();try{player.enter(6);player.type(1);await player.play();tick(1000,12);assert.equal(media.paused,true);await player.play();assert.equal(media.currentTime,6);tick(1500,6.5);assert.equal(media.paused,false);tick(7000,12);assert.equal(media.paused,true);assert.equal(player.getState().mode,'type')}finally{player.dispose()}
});
test('continuous listening after canceling a repeat gap releases the cue without rewinding',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const{media,player,tick}=setup();try{player.enter(0);player.repeatCurrent(2,.01);await Promise.resolve();tick(1000,6);player.pause();player.continueAll();await Promise.resolve();assert.equal(media.currentTime,6);tick(2000,7);t.mock.timers.tick(20);assert.equal(media.paused,false);assert.equal(media.currentTime,7);assert.equal(media.plays,2)}finally{player.dispose()}
});
test('explicit repeat resumption counts observed replay time without double-counting media coverage',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const{media,player,tick,block}=setup();try{
  player.enter(0);player.repeatCurrent(2,.01);await Promise.resolve();for(let n=1;n<=12;n++)tick(n*500,n*.5);
  const before=player.getState().observation.totals;assert.equal(before.mediaCoverageSeconds,6);assert.equal(before.listeningMs,6000);
  block();player.pause();t.mock.timers.tick(20);tick(10000,6);assert.equal(player.getState().observation.totals.listeningMs,before.listeningMs);block(false);await player.play();assert.equal(media.currentTime,0);
  for(let n=1;n<=12;n++)tick(10000+n*500,n*.5);const after=player.getState().observation.totals;assert.equal(after.listeningMs,12000);assert.equal(after.effectiveMs,12000);assert.equal(after.mediaCoverageSeconds,6);assert.equal(after.typingMs,0);assert.equal(media.paused,true);
 }finally{player.dispose()}
});
for(const position of [5.985,6])for(const repeats of [1,2])test(`pause before queued boundary callback keeps ${repeats} selected passes at ${position}`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const{media,player,tick}=setup();try{
  player.enter(0);player.repeatCurrent(repeats,.01);await Promise.resolve();media.currentTime=position;player.pause();await player.play();
  if(repeats===1){assert.equal(media.currentTime,position,'completed single pass releases listen scope');tick(1500,7);assert.equal(media.paused,false);assert.equal(media.plays,2)}
  else{assert.equal(media.currentTime,0);assert.equal(player.getState().loopRemaining,0,'the admitted replay consumes the remaining pass exactly once');tick(2000,6);t.mock.timers.tick(20);await Promise.resolve();assert.equal(media.paused,true);assert.equal(media.plays,2,'no extra third pass after a delayed native callback')}
 }finally{player.dispose()}
});
for(const repeats of [2,3])test(`explicit interior seeks after a canceled gap preserve ${repeats} selected passes`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const{media,player,tick}=setup();try{
  player.enter(0);player.repeatCurrent(repeats,.01);await Promise.resolve();tick(1000,6);player.pause();player.seek(2);player.seek(3);assert.equal(player.getState().loopRemaining,repeats-2,'only the first seek from completed boundary reserves the next pass');assert.equal(media.paused,true);await player.play();assert.equal(media.currentTime,3);
  for(let pass=2;pass<=repeats;pass++){tick(pass*1000,6);if(pass<repeats){t.mock.timers.tick(20);await Promise.resolve();assert.equal(media.currentTime,0)}}
  t.mock.timers.tick(20);await Promise.resolve();assert.equal(media.paused,true);assert.equal(media.plays,repeats,'seeking during a paused repeat must not add a full pass');
 }finally{player.dispose()}
});

for(const rate of [.5,.8,1])test(`native ${rate}x cadence remains separate from actual observation and Training`,async()=>{
 const{player,tick}=setup();try{player.enter(0);player.rate(rate);await player.play();tick(500,.5*rate);player.getState();tick(1000,rate);const state=player.getState();assert.equal(state.cadence.status,'active');assert.ok(state.cadence.points.every(p=>p.value===state.frame.estimatedCharactersPerSecond));assert.equal(state.observation.totals.listeningMs,1000);const bytes=JSON.stringify(state.observation);for(let n=0;n<50;n++)player.getState();assert.equal(JSON.stringify(player.getState().observation),bytes,'RAF visual reads must not sample or mutate observation');assert.ok(!bytes.includes('cadence'));assert.ok(!bytes.includes('estimatedRate'))}finally{player.dispose()}
});
test('reference toggle clears visual history without losing actual listened time',async()=>{
 const{player,tick}=setup();try{player.enter(0);await player.play();tick(500,.5);player.getState();tick(1000,1);assert.equal(player.getState().cadence.status,'active');player.showText(false);player.showText(true);assert.deepEqual(player.getState().cadence.points,[],'rapid hide/show invalidates the old graph even without a rendered hidden frame');tick(1500,1.5);assert.equal(player.getState().cadence.status,'active');assert.equal(player.getState().observation.totals.listeningMs,1500);player.showText(false);assert.deepEqual(player.getState().cadence.points,[]);tick(2000,2);assert.equal(player.getState().observation.totals.listeningMs,2000)}finally{player.dispose()}
});
test('native pause seek rate wait background repeat and type boundaries never bridge a visual tail',async()=>{
 const{player,media,tick,hide,show}=setup();try{player.enter(0);await player.play();tick(500,.5);player.getState();tick(1000,1);assert.equal(player.getState().cadence.status,'active');player.pause();assert.deepEqual(player.getState().cadence.points,[]);await player.play();assert.deepEqual(player.getState().cadence.points,[]);tick(1500,1.5);assert.equal(player.getState().cadence.status,'active');player.seek(1.55);assert.deepEqual(player.getState().cadence.points,[]);tick(2000,2.05);assert.equal(player.getState().cadence.status,'active');player.rate(.8);assert.deepEqual(player.getState().cadence.points,[]);tick(2500,2.45);assert.equal(player.getState().cadence.status,'active');media.emit('waiting');assert.deepEqual(player.getState().cadence.points,[]);media.emit('playing');tick(3000,2.85);player.getState();tick(3500,3.25);assert.equal(player.getState().cadence.status,'active');hide();assert.deepEqual(player.getState().cadence.points,[]);tick(4000,3.65);show();assert.deepEqual(player.getState().cadence.points,[]);tick(4500,4.05);assert.equal(player.getState().cadence.status,'active');player.repeatCurrent(2);assert.deepEqual(player.getState().cadence.points,[]);player.type(0);assert.equal(player.getState().cadence.status,'inactive');player.listen();assert.deepEqual(player.getState().cadence.points,[])}finally{player.dispose()}
});

test('older native play fulfillment cannot pause a newer successful play intent',async()=>{
 const{media,player}=setup();const releases:(()=>void)[]=[];
 media.play=()=>new Promise<void>(resolve=>{releases.push(()=>{media.paused=false;media.emit('playing');resolve()})});
 try{player.enter(0);const old=player.play();player.pause();const current=player.play();releases[1]();await current;assert.equal(media.paused,false);releases[0]();await old;assert.equal(media.paused,false)}finally{player.dispose()}
});
test('late native play fulfillment still respects the latest explicit pause',async()=>{
 const{media,player}=setup();let release!:()=>void;
 media.play=()=>new Promise<void>(resolve=>{release=()=>{media.paused=false;media.emit('playing');resolve()}});
 try{player.enter(0);const pending=player.play();player.pause();release();await pending;assert.equal(media.paused,true)}finally{player.dispose()}
});
test('an older native play rejection cannot replace a newer successful playback state',async()=>{
 const{media,player}=setup();let rejectOld!:(error:Error)=>void,calls=0;const nativePlay=media.play.bind(media);
 media.play=()=>++calls===1?new Promise<void>((_resolve,reject)=>{rejectOld=reject}):nativePlay();
 try{player.enter(0);const old=player.play();player.pause();await player.play();rejectOld(Error('superseded'));await old;assert.equal(media.paused,false);assert.equal(player.getState().error,null)}finally{player.dispose()}
});
test('an old queued pause event cannot revoke a newer native play intent',async()=>{
 const{media,player}=setup();let release!:()=>void;
 try{player.enter(0);await player.play();player.pause();media.play=()=>new Promise<void>(resolve=>{media.paused=false;release=()=>{media.emit('playing');resolve()}});const pending=player.play();media.emit('pause');release();await pending;assert.equal(media.paused,false)}finally{player.dispose()}
});
