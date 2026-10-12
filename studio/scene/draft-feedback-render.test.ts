import test from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';
import{TrainingEngine}from'../core/training';import{paintScene,type SceneMedia,type SceneVisual}from'./renderer';
const{createCanvas}=createRequire(import.meta.url)('@napi-rs/canvas');
test('paint rejects stale success, Next and reward after the visible draft changes',()=>{
 const e=new TrainingEngine();e.input(e.cue.text);const old=e.submit()!;e.input('changed');
 const canvas=createCanvas(1672,941),ctx=canvas.getContext('2d'),labels:string[]=[];const original=ctx.fillText.bind(ctx);ctx.fillText=(value:string,...args:number[])=>{labels.push(value);return original(value,...args)};
 const video={readyState:0,videoWidth:0,videoHeight:0,paused:true},image={complete:false,naturalWidth:0,naturalHeight:0};
 const media={lesson:video,camera:video,poster:image,image,reference:image,kind:'demo',name:'test'}as unknown as SceneMedia;
 const view:SceneVisual={layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:true,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:e.draft,inputFocused:false,composition:false,caret:0,selectionEnd:0,scrollLeft:0,message:'本句已匹配，可以继续下一句。',gain:old.gain,rewardAttemptId:old.attemptId,rewardAt:0,lastResult:old,volume:.8,muted:false,ready:true,playbackTime:0,playbackDuration:72,renderTime:100,snapshot:e.getSnapshot()};
 paintScene(canvas as HTMLCanvasElement,media,view);assert.ok(labels.some(x=>x.includes('尚未判定')));assert.ok(labels.includes('Confirm'));assert.ok(!labels.some(x=>x.includes('本句已匹配')||x==='Next'||x.startsWith('+')));
 labels.length=0;view.lastResult=null;paintScene(canvas as HTMLCanvasElement,media,view);assert.ok(!labels.some(x=>x.startsWith('+')));
 labels.length=0;e.input(e.cue.text);const current=e.submit()!;view.snapshot=e.getSnapshot();view.draft=e.draft;view.lastResult=current;view.gain=6;view.rewardAttemptId=old.attemptId;paintScene(canvas as HTMLCanvasElement,media,view);assert.ok(labels.some(x=>x.includes('本句已匹配')));assert.ok(!labels.some(x=>x.startsWith('+')),'replayed/current result must not inherit a different attempt reward');
});
