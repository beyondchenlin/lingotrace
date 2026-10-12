import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {TrainingEngine, CAFE_MATERIAL, type Material} from '../core/training';
import {buildLocalReferenceProposal,LOCAL_REFERENCE_MEDIA_ID,LOCAL_REFERENCE_MEDIA_SHA256} from '../core/local-reference';
import {paintTransparentScene,type TransparentSceneFrame} from './transparent-renderer';
import type {SceneMedia,SceneVisual} from './renderer';

for (const [ready,duration] of [[false,72],[false,NaN],[true,NaN],[true,72]] as const) test(`real corrected Canvas labels unknown media honestly (ready=${ready}, duration=${duration})`,async()=>{
 const proposal=await buildLocalReferenceProposal({original:CAFE_MATERIAL,parent:CAFE_MATERIAL,editedCueId:CAFE_MATERIAL.cues[0].id,text:'Could I please have a coffee?',start:0,end:5,media:{id:LOCAL_REFERENCE_MEDIA_ID,sha256:LOCAL_REFERENCE_MEDIA_SHA256,durationSeconds:72},saveRequestId:'duration-label-test'});
 const engine=new TrainingEngine();engine.startReferenceSession(proposal.material as Material,0);
 const view:SceneVisual={layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:true,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:'',inputFocused:false,composition:false,caret:0,selectionEnd:0,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready,playbackTime:0,playbackDuration:0,renderTime:1200,snapshot:engine.getSnapshot()};
 const frame:TransparentSceneFrame={input:{commits10s:0,energy:0,latestRate:null,observedMs:0,frozen:true,points:[],pulses:[]},enteredAt:0,mediaChangedAt:0,mediaLoading:!ready,wallNowMs:1000,replay:false,pageInputStarted:false};
 const media={lesson:{readyState:0,paused:true,duration},camera:{readyState:0},poster:{complete:false},image:{complete:false},reference:{complete:false},kind:'demo',name:'corrected'} as unknown as SceneMedia;
 const canvas=createCanvas(1672,941),ctx=canvas.getContext('2d'),fill=ctx.fillText.bind(ctx),labels:string[]=[];
 ctx.fillText=((text:string,x:number,y:number,maxWidth?:number)=>{labels.push(text);fill(text,x,y,maxWidth)}) as typeof ctx.fillText;
 paintTransparentScene(canvas as unknown as HTMLCanvasElement,media,view,frame);
 const known=ready&&Number.isFinite(duration)&&duration>0;
 assert.equal(labels.includes('Media time not ready'),!known);
 assert.equal(labels.includes('00:00 / 01:12'),known);
 assert.equal(labels.includes('00:00 / 00:00'),false);
});
