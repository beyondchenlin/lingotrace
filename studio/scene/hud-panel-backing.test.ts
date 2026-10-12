import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,type Canvas} from '@napi-rs/canvas';
import {TrainingEngine} from '../core/training';
import {learningGeometry} from './learning-surface';
import {responsiveLayout} from './responsive-layout';
import {paintTransparentScene,type TransparentSceneFrame} from './transparent-renderer';
import type {SceneMedia,SceneVisual} from './renderer';
import {HudContrastController,type HudContrastRegions} from './hud-contrast';
import {hudPanelBackingRects,hudPanelContentRects} from './hud-panel-backing';
import {cameraControlGeometry} from './camera-control';

function fixture(cssWidth:number,placement:'inside'|'below',hud:SceneVisual['hudPreferences']={mode:'follow',size:1}){
 const geometry=learningGeometry(responsiveLayout(false),{keyboardVisible:true,keyboardPlacement:placement,cssWidth,hud,videoSize:'fit'});
 const white=createCanvas(1672,941),ctx=white.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,white.width,white.height);
 Object.assign(white,{complete:true,naturalWidth:white.width,naturalHeight:white.height,src:'hud-panel-white'});
 const media={lesson:{readyState:0,videoWidth:0,videoHeight:0},camera:{readyState:0},poster:{complete:false},image:white,reference:{complete:false},kind:'image',name:'white'} as unknown as SceneMedia;
 const visual:SceneVisual={layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:true,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:'',inputFocused:false,composition:false,caret:0,selectionEnd:0,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,playbackTime:0,playbackDuration:72,renderTime:1200,snapshot:new TrainingEngine().getSnapshot(),cameraViewport:{width:cssWidth,height:900},keyboardPlacement:placement,keyboardFeedback:{visible:true,codes:[],committedUntil:0,composing:false},hudPreferences:hud,videoSize:'fit'};
 const frame:TransparentSceneFrame={input:{commits10s:0,energy:0,latestRate:null,observedMs:0,frozen:true,points:[],pulses:[]},enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:1000,replay:false,pageInputStarted:true};
 const draw=(beforePaint?:(canvas:Canvas)=>void)=>{const canvas=createCanvas(cssWidth,Math.round(geometry.height*cssWidth/geometry.width));beforePaint?.(canvas);paintTransparentScene(canvas as unknown as HTMLCanvasElement,media,visual,frame);return canvas};
 return{geometry,visual,frame,draw,dispose:()=>{white.width=1;white.height=1}};
}

test('real Canvas panel edges share a top rail and a left rail across display scales and keyboard placement',()=>{
 for(const width of[960,1280,1672,1920])for(const placement of['inside','below'] as const)for(const hud of[{mode:'follow',size:1},{mode:'fixed',size:1.15}] as const){
  const {geometry:g,draw,dispose}=fixture(width,placement,hud),canvas=draw(),ctx=canvas.getContext('2d'),scale=width/g.width;
  const dark=(x:number,y:number)=>{const p=ctx.getImageData(x,y,1,1).data;return(p[0]+p[1]+p[2])/3<125};
  const tops=[g.goal,g.title,g.trend].map(r=>{const x=Math.round((r.x+r.w/2)*scale);for(let y=Math.floor(24*scale);y<Math.ceil(55*scale);y++)if(dark(x,y))return y;return -1});
  assert.ok(tops[0]>=0,`${width} ${placement}: visible background top`);
  assert.deepEqual(tops,[tops[0],tops[0],tops[0]],`${width} ${placement} ${hud.mode}: all three actual painted top edges`);
  const lefts=[g.goal,g.metrics].map(r=>{const y=Math.round((r.y+r.h*.62)*scale);for(let x=0;x<Math.ceil(55*scale);x++)if(dark(x,y))return x;return -1});
  assert.ok(lefts[0]>=0,`${width} ${placement}: visible background left`);
  assert.deepEqual(lefts,[lefts[0],lefts[0]],`${width} ${placement} ${hud.mode}: both actual painted left edges`);
  canvas.width=1;canvas.height=1;dispose();
 }
});

test('aligned panel rendering preserves input facts and deterministic recording pixels',()=>{
 const {visual,frame,draw,dispose}=fixture(1280,'below'),before=JSON.stringify({visual,frame});
 const a=draw(),b=draw();assert.deepEqual(a.toBuffer('image/png'),b.toBuffer('image/png'));a.width=1;b.width=1;dispose();
 assert.equal(JSON.stringify({visual,frame}),before);
 assert.equal(visual.snapshot!.earnedWords,0);assert.equal(frame.input.commits10s,0);assert.deepEqual(frame.input.points,[]);
});

test('the renderer sends the actual aligned plate extents to adaptive sampling, not the older content bounds',()=>{
 const {geometry:g,visual,draw,dispose}=fixture(1280,'below');visual.reducedMotion=false;
 const original=HudContrastController.prototype.update,seen:HudContrastRegions[]=[];
 HudContrastController.prototype.update=function(source,identity,regions,time,reduced){seen.push(regions);return original.call(this,source,identity,regions,time,reduced)};
 try{
  const canvas=draw(),camera=cameraControlGeometry(g,'off','lesson',{cssWidth:1280,cssHeight:900}).visual,plates=hudPanelBackingRects(g,camera);
  assert.equal(seen.length,1);
  for(const key of['goal','title','trend','flow']){
   const r=plates[key];assert.deepEqual(seen[0][key],{x:r.x/1672,y:r.y/941,w:r.w/1672,h:r.h/941},key);
  }
  canvas.width=1;canvas.height=1;
 }finally{HudContrastController.prototype.update=original;dispose()}
});

test('every plate keeps the original content-based gradient instead of changing unrelated panel shading',()=>{
 const {geometry:g,draw,dispose}=fixture(1280,'below'),gradients:number[][]=[];
 const canvas=draw(canvas=>{
  const ctx=canvas.getContext('2d'),original=ctx.createLinearGradient.bind(ctx);
  ctx.createLinearGradient=(...args:Parameters<typeof ctx.createLinearGradient>)=>{gradients.push(args);return original(...args)};
 });
 const camera=cameraControlGeometry(g,'off','lesson',{cssWidth:1280,cssHeight:900}).visual,contents=hudPanelContentRects(g,camera),expected=Object.values(contents).map(r=>[0,r.y,0,r.y+r.h]);
 assert.deepEqual(gradients.slice(0,expected.length),expected);
 canvas.width=1;canvas.height=1;dispose();
});
