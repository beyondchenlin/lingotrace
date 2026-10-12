import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {TrainingEngine} from '../core/training';
import {paintScene,containRect,insetContentRect,ZONES,type SceneMedia,type SceneVisual} from './renderer';
const {createCanvas}=createRequire(import.meta.url)('@napi-rs/canvas');

function source(w:number,h:number){const c=createCanvas(w,h);Object.assign(c,{readyState:4,videoWidth:w,videoHeight:h,paused:true});return c}
const view:SceneVisual={layout:'camera',fixture:false,showSubtitle:false,paused:false,reducedMotion:true,camera:'on',recording:false,recordingStarted:null,recordingBytes:0,draft:'',inputFocused:false,composition:false,caret:0,selectionEnd:0,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,playbackTime:0,playbackDuration:3.12,renderTime:100,snapshot:new TrainingEngine().getSnapshot()};

test('actual inset media draws stay above the status strip for three ratios and resized windows',()=>{
 for(const layout of ['camera','lesson'] as const)for(const [w,h]of [[160,90],[90,160],[100,100]])for(const recording of [false,true])for(const b of [ZONES.camera,{x:1000,y:100,w:400,h:320},{x:20,y:110,w:240,h:192}]){
  const lesson=source(w,h),camera=source(w,h),image={complete:false,naturalWidth:0};
  const media={lesson,camera,poster:image,image,reference:image,kind:'video',name:'Synthetic ratio marker'}as unknown as SceneMedia;
  const watched=layout==='camera'?lesson:camera,canvas=createCanvas(1672,941),ctx=canvas.getContext('2d');
  const draw=ctx.drawImage.bind(ctx),calls:number[][]=[];
  ctx.drawImage=(src:unknown,...args:number[])=>{if(src===watched)calls.push(args);return draw(src,...args)};
  paintScene(canvas as HTMLCanvasElement,media,{...view,layout,recording,recordingStarted:Date.now(),arrangement:{inset:b}});
  assert.equal(calls.length,1);
  const [x,y,dw,dh]=calls[0];
  assert.ok(x>=b.x&&x+dw<=b.x+b.w+.001);
  assert.ok(y>=b.y&&y+dh<=b.y+b.h-37+.001,'no contained source pixels behind REC/preview status');
  assert.ok(Math.abs(dw/dh-w/h)<.000001,'source ratio preserved');
  assert.deepEqual(insetContentRect(b),{...b,h:b.h-37});
 }
});

test('portrait and square retain their full source bounds instead of the prior37px overlap',()=>{
 const b=ZONES.camera;
 for(const [w,h]of [[90,160],[100,100]]){
  const before=containRect(w,h,b.x,b.y,b.w,b.h),body=insetContentRect(b),after=containRect(w,h,body.x,body.y,body.w,body.h);
  assert.equal(before.y+before.h-(b.y+b.h-37),37);
  assert.ok(Math.abs(after.y+after.h-(b.y+b.h-37))<.001);
 }
});
