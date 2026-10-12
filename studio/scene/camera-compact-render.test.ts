import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {TrainingEngine} from '../core/training';
import {paintTransparentScene,type TransparentSceneFrame} from './transparent-renderer';
import {responsiveLayout as baseResponsiveLayout} from './responsive-layout';
import {applyInputCardLayout} from './input-card';
const responsiveLayout=(...args:Parameters<typeof baseResponsiveLayout>)=>applyInputCardLayout(baseResponsiveLayout(...args),{cssScale:500/(args[0]?430:1672)});
import type {SceneMedia,SceneVisual} from './renderer';
const media={lesson:{readyState:0,paused:true,duration:72},camera:{readyState:0},poster:{complete:false},image:{complete:false},reference:{complete:false},kind:'demo',name:'camera view fixture'} as unknown as SceneMedia;
const frame:TransparentSceneFrame={input:{commits10s:0,energy:0,latestRate:null,observedMs:0,frozen:true,points:[],pulses:[]},enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:51000,replay:false,pageInputStarted:false};
function draw(camera:SceneVisual['camera'],portrait:boolean,recording=false,layout:SceneVisual['layout']='lesson'){
 const g=responsiveLayout(portrait,{},layout,820),canvas=createCanvas(g.width,g.height),ctx=canvas.getContext('2d'),labels:string[]=[],rects:number[][]=[];
 const text=ctx.fillText.bind(ctx),rect=ctx.roundRect.bind(ctx);
 ctx.fillText=(value:string,...args:any[])=>{labels.push(value);return Reflect.apply(text,ctx,[value,...args])};
 ctx.roundRect=(...args:any[])=>{const t=ctx.getTransform(),[x,y,w,h]=args;rects.push([x*t.a+t.e,y*t.d+t.f,w*t.a,h*t.d]);return Reflect.apply(rect,ctx,args)};
 const v:SceneVisual={cameraViewport:{width:500,height:500*g.height/g.width},layout,fixture:false,showSubtitle:false,paused:false,reducedMotion:true,camera,recording,recordingStarted:46000,recordingBytes:0,draft:'',inputFocused:false,composition:false,caret:0,selectionEnd:0,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,playbackTime:0,playbackDuration:72,renderTime:1200,snapshot:new TrainingEngine().getSnapshot()};
 const before=JSON.stringify(v);paintTransparentScene(canvas as unknown as HTMLCanvasElement,media,v,frame,portrait,820);assert.equal(JSON.stringify(v),before);return{g,labels,rects,canvas};
}
for(const portrait of [false,true])for(const state of ['off','requesting','error']as const)test(`lesson ${state} ${portrait} has compact icon, no old placeholder frame and no false camera pixels`,()=>{
 const r=draw(state,portrait);assert.ok(!r.labels.includes('Camera off'));assert.ok(!r.labels.includes('Permission…'));assert.ok(!r.labels.includes('Camera unavailable'));
 assert.ok(!r.rects.some(([x,y,w,h])=>Math.abs(x-r.g.inset.x)<.01&&Math.abs(y-r.g.inset.y)<.01&&Math.abs(w-r.g.inset.w)<.01&&Math.abs(h-r.g.inset.h)<.01));
 assert.ok(r.rects.some(([, ,w,h])=>Math.abs(w*500/r.g.width-30)<.01&&Math.abs(h*500/r.g.width-30)<.01));
});
for(const portrait of [false,true])for(const state of ['off','on']as const)test(`Canvas ${state} ${portrait} keeps actual REC elapsed time`,()=>{
 assert.ok(draw(state,portrait,true).labels.includes('● REC 00:05'));
 assert.ok(!draw(state,portrait,false).labels.some(s=>s.startsWith('● REC')));
});
for(const portrait of [false,true])for(const layout of ['camera','split']as const)test(`${layout} ${portrait} keeps original role and status`,()=>{
 const r=draw('off',portrait,false,layout);assert.ok(r.labels.includes(layout==='camera'?'Local preview only':'Camera off'));
 assert.ok(!r.rects.some(([, ,w,h])=>Math.abs(w*500/r.g.width-30)<.01&&Math.abs(h*500/r.g.width-30)<.01));
});
