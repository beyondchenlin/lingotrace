import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCanvas} from '@napi-rs/canvas';
import {learningGeometry,fitLearningSurface,containLearningMedia} from './learning-surface';
import {responsiveLayout} from './responsive-layout';
import {cameraControlGeometry} from './camera-control';
import {paintTransparentScene} from './transparent-renderer';
import {TrainingEngine} from '../core/training';
import type {Rect} from './layout';
const overlap=(a:Rect,b:Rect)=>a.x<b.x+b.w-1e-6&&a.x+a.w>b.x+1e-6&&a.y<b.y+b.h-1e-6&&a.y+a.h>b.y+1e-6;
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);

for(const cssWidth of[320,430,560,640,692,960,1165,1280,1672,1920])for(const mode of['half','native','fit'] as const)test(`shared playback targets and Below isolation ${cssWidth}/${mode}`,()=>{
 const base=responsiveLayout(false),before=JSON.stringify(base),options={cssWidth,videoSize:mode,availableHeight:1080};
 const hidden=learningGeometry(base,{...options,keyboardVisible:false}),below=learningGeometry(base,{...options,keyboardVisible:true,keyboardPlacement:'below'}),inside=learningGeometry(base,{...options,keyboardVisible:true,keyboardPlacement:'inside'}),scale=cssWidth/base.width;
 for(const g of[hidden,below,inside]){
  close(g.player.h*scale,cssWidth>=560?60:116);
  const targets=[g.inputCard.submit,g.inputCard.toggle,g.inputCard.modeToggle,g.zones.play,g.zones.previous,g.zones.next,g.zones.mute];
  for(const r of targets){assert.ok(r.w*scale>=44-1e-6&&r.h*scale>=44-1e-6);assert.ok(!overlap(r,g.inputCard.input));assert.ok(r.y+r.h<=g.height+1e-6)}
  for(const r of[g.goal,g.title,g.trend,g.metrics,g.inset,g.player,g.counter,g.inputCard.status])assert.ok(!overlap(g.inputCard.input,r));
  for(const r of[g.inputCard.submit,g.inputCard.toggle,g.inputCard.modeToggle,g.listeningDock])assert.ok(!overlap(r,g.zones.seek));
  for(const ratio of[0,.1,.25,.5,.9,1]){const marker=g.cueMarker(ratio);close(g.timelineProgress((marker.x+marker.w/2)*scale,0,cssWidth),ratio);assert.ok(marker.w*scale>=44-1e-6&&marker.h*scale>=44-1e-6);assert.ok(!overlap(marker,g.inputCard.input))}
  const camera=cameraControlGeometry(g,'off','lesson',{cssWidth,cssHeight:g.height*scale});
  for(const r of[g.inputCard.input,g.inputCard.helper,g.goal,g.title,g.trend])assert.ok(!overlap(camera.hit,r));
  assert.deepEqual(g.media,base.media);assert.deepEqual(g.goal,base.goal);assert.deepEqual(g.trend,base.trend);
 }
 for(const key of['input','helper','submit','toggle','modeToggle','status','card'] as const)assert.deepEqual(below.inputCard[key],hidden.inputCard[key]);
 for(const key of['player','zones','listeningDock','inset','metrics'] as const)assert.deepEqual(below[key],hidden[key]);
 const picture=containLearningMedia({width:1280,height:720},base.media,scale,mode),keyboard=below.inputCard.keyboard!;
 assert.ok(keyboard.y>=picture.y+picture.h);assert.ok(keyboard.y>=hidden.height);assert.ok(keyboard.y+keyboard.h<=below.height);assert.ok(!overlap(keyboard,below.player));assert.ok(keyboard.h*scale>=150-1e-6&&keyboard.h*scale<=260+1e-6);
 assert.equal(hidden.inputCard.keyboard,null);assert.equal(inside.inputCard.overlayKeyboard,true);assert.equal(below.inputCard.overlayKeyboard,false);assert.equal(JSON.stringify(base),before);
 if(cssWidth>=1165&&mode==='native'){assert.equal(hidden.height,base.height);assert.ok(hidden.player.y<base.media.y+base.media.h)}
});

test('below and hidden converge under width fitting without forcing native/half media to upscale',()=>{
 for(const portrait of[false,true])for(const keyboardVisible of[false,true])for(const keyboardPlacement of['inside','below'] as const)for(const availableWidth of[320,640,1280])for(const availableHeight of[180,720,1080])for(const videoSize of['half','native'] as const){
  const base=responsiveLayout(portrait);let width=availableWidth,previous=width;
  for(let i=0;i<16;i++){const g=learningGeometry(base,{keyboardVisible,keyboardPlacement,cssWidth:width,availableHeight,videoSize});previous=width;width=fitLearningSurface({availableWidth,availableHeight,sceneWidth:g.width,sceneHeight:g.height,media:g.media,intrinsicWidth:1280,intrinsicHeight:720,portrait,videoSize}).width}
  close(width,previous);const picture=containLearningMedia({width:1280,height:720},base.media,width/base.width,videoSize,{width:availableWidth,height:availableHeight});assert.ok(picture.w*width/base.width<=1280*(videoSize==='half'?.5:1)+1e-6);
 }
});

test('portrait keeps placement independence and existing separate control stack',()=>{
 for(const cssWidth of[320,390,430,640])for(const keyboardVisible of[false,true]){const base=responsiveLayout(true),a=learningGeometry(base,{cssWidth,keyboardVisible,keyboardPlacement:'inside'}),b=learningGeometry(base,{cssWidth,keyboardVisible,keyboardPlacement:'below'});assert.equal(JSON.stringify(a),JSON.stringify(b));assert.equal(a.inputCard.overlayControls,false);assert.equal(a.inputCard.playerTop,undefined)}
});

test('hidden/Below secondary HUD avoids enlarged input and primary HUD for saved arrangements',()=>{
 for(const cssWidth of[320,560,960,1280,1920])for(const metricsX of[50,350,650,1050,1363])for(const insetX of[0,500,1100,1374])for(const keyboardVisible of[false,true]){
  const base=responsiveLayout(false,{metrics:{x:metricsX,y:350,w:309,h:168},inset:{x:insetX,y:330,w:240,h:152}}),before=JSON.stringify(base),g=learningGeometry(base,{keyboardVisible,keyboardPlacement:'below',cssWidth}),c=g.inputCard;
  for(const r of[g.metrics,g.inset]){assert.ok(r.w>0&&r.h>0);for(const o of[c.input,c.helper,c.submit,c.status,g.goal,g.title,g.trend,g.player])assert.ok(!overlap(r,o))}assert.equal(JSON.stringify(base),before);
 }
});

test('program Canvas upper HUD and playback pixels are identical when only Below keyboard is added',()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'OffscreenCanvas');Object.defineProperty(globalThis,'OffscreenCanvas',{configurable:true,value:class{constructor(w:number,h:number){return createCanvas(w,h)}}});
 try{
 const poster=createCanvas(1280,720),c=poster.getContext('2d');c.fillStyle='#6daecc';c.fillRect(0,0,1280,720);c.fillStyle='#94a466';for(let x=0;x<1280;x+=80)c.fillRect(x,400,40,320);Object.assign(poster,{complete:true,naturalWidth:1280,naturalHeight:720});
 const engine=new TrainingEngine(),snapshot=engine.getSnapshot(),frame={input:{commits10s:0,energy:0,latestRate:null,observedMs:0,frozen:true,points:[],pulses:[]},enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:1000,replay:false,pageInputStarted:true,mediaInteracted:true};
 const media={lesson:{readyState:0,paused:true,duration:72,videoWidth:1280,videoHeight:720},camera:{readyState:0},poster,image:{complete:false},reference:{complete:false},kind:'demo',name:'program pixel comparison'};
 const draw=(keyboardVisible:boolean)=>{const g=learningGeometry(responsiveLayout(false),{cssWidth:1280,keyboardVisible,keyboardPlacement:'below',availableHeight:1080}),canvas=createCanvas(g.width,g.height);const v={layout:'lesson',fixture:false,showSubtitle:true,paused:false,reducedMotion:true,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:'',inputFocused:false,composition:false,caret:0,selectionEnd:0,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,playbackTime:1,playbackDuration:72,renderTime:1200,snapshot,cameraViewport:{width:1280,height:g.height*1280/g.width},keyboardFeedback:{visible:keyboardVisible,codes:[],committedUntil:0,composing:false},keyboardPlacement:'below',videoSize:'native',mediaViewport:{width:1280,height:1080}};paintTransparentScene(canvas as any,media as any,v as any,frame);return{canvas,g}};
 const hidden=draw(false),below=draw(true),h=hidden.g.height;assert.ok(Buffer.from(below.canvas.getContext('2d').getImageData(0,0,hidden.g.width,h).data).equals(Buffer.from(hidden.canvas.getContext('2d').getImageData(0,0,hidden.g.width,h).data)));
 }finally{if(prior)Object.defineProperty(globalThis,'OffscreenCanvas',prior);else Reflect.deleteProperty(globalThis,'OffscreenCanvas')}
});

test('presentation amendment adds no window/popout, data, media or input ownership paths',()=>{
 const source=readFileSync(new URL('./input-card.ts',import.meta.url),'utf8');assert.doesNotMatch(source,/documentPictureInPicture|requestWindow|window\.open|localStorage|indexedDB|fetch\(/);
 const host=readFileSync(new URL('../components/Studio.tsx',import.meta.url),'utf8');assert.match(host,/geometry\.zones\.previous/);assert.match(host,/geometry\.cueMarker\(c\.ratio\)/);assert.match(host,/geometry\.timelineProgress\(e\.clientX/);
});
