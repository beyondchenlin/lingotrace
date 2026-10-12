import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');await swc.loadBindings();

// The shipped host callbacks execute with synthetic media promises, not browser audio.
const source=readFileSync(new URL('../components/Studio.tsx',import.meta.url),'utf8');
const start=source.indexOf('async function toggleCorrectedPlay('),end=source.indexOf('\n function reveal(',start),fn=source.slice(start,end);
const bs=source.indexOf('beforeListen:(native)=>')+'beforeListen:'.length,be=source.indexOf(',\n  afterListen:',bs),before=source.slice(bs,be);
const ps=source.indexOf('const onPlay=(event:Event)=>'),pe=source.indexOf(',onTime=()=>',ps),callbacks=source.slice(ps,pe);
const compiled=(await swc.transform(`${fn}\n${callbacks};const beforeListen=${before}`,{jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}})).code;
function setup(){
 let release!:(value:boolean)=>void;const gate=new Promise<boolean>(resolve=>release=resolve),material={localReference:true},snapshot={material,sessionId:'s'};let plays=0;
 const frozen=new Map<string,boolean>();
 const legacy={paused:true,currentTime:6.02,currentSrc:'blob:a',pause(){this.paused=true},async play(){plays++;this.paused=false;scope.onPlay()}};
 const native={paused:true};const engine={getSnapshot:()=>snapshot,cue:{id:'cue3',start:6.02,end:8.21},activatePractice(){},setFrozen(reason:string,value:boolean){frozen.set(reason,value)}};
 const scope:any={cancelFollow(){},followNativeEventsRef:{current:new WeakSet()},cancelTypingErrorFeedback(){},engineRef:{current:engine},lessonRef:{current:legacy},lesson:legacy,referenceBlocked:()=>false,mediaRef:{current:{kind:'demo',lesson:legacy}},correctedPlayRequest:{current:0},correctedPlayOwner:{current:null},disposed:{current:false},document:{hidden:false},referenceRepository:()=>({isExactSavedMaterial:()=>gate}),currentCorrectedMediaError:()=>null,mediaInteractedRef:{current:false},seekTo:()=>true,courseRoutingRef:{current:null},notify(){},inputRef:{current:null},submissionSound:{audio:{current:null}},standbyAudioRef:{current:null},setShowSubtitle(){},clearKeyboardFeedback(){},reviewMediaRef:{current:null},strictCourse:()=>true,listening:{playerRef:{current:null}}};
 Object.assign(scope,new Function('scope',`with(scope){${compiled};return{toggleCorrectedPlay,onPlay,onPause,beforeListen}}`)(scope));
 return{scope,legacy,native,frozen,release,plays:()=>plays};
}
test('pending legacy playback admission cannot restart behind the new listening video',async()=>{
 const f=setup(),pending=f.scope.toggleCorrectedPlay();
 f.scope.listening.playerRef.current={getState:()=>({active:true})};f.scope.beforeListen(f.native);f.release(true);await pending;
 assert.equal(f.plays(),0);assert.equal(f.legacy.paused,true);assert.equal(f.scope.mediaRef.current.lesson,f.native);
});
test('late legacy play or queued pause events cannot steal the active listening owner',()=>{
 const f=setup();f.scope.listening.playerRef.current={getState:()=>({active:true})};f.scope.beforeListen(f.native);
 f.scope.onPause();assert.equal(f.frozen.get('listening'),true,'queued legacy pause must not unfreeze continuous listening');
 f.legacy.paused=false;f.scope.onPlay();assert.equal(f.legacy.paused,true,'a native late start must be silenced before it can overlap');
 assert.equal(f.scope.mediaRef.current.lesson,f.native);
});
