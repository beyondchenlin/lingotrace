import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';
import {writeFile} from 'node:fs/promises';
import {TrainingEngine} from '../studio/core/training.ts';
import {paintTransparentScene} from '../studio/scene/transparent-renderer.ts';
import {responsiveLayout as base} from '../studio/scene/responsive-layout.ts';
import {applyInputCardLayout} from '../studio/scene/input-card.ts';
import {cameraControlGeometry} from '../studio/scene/camera-control.ts';

for(const [file,family] of [['studio-sans-regular.woff','Lingo Studio Sans'],['studio-sans-bold.woff','Lingo Studio Sans'],['studio-semibold.woff','Lingo Studio Semibold'],['studio-mono-regular.woff','Lingo Studio Mono']]){
 GlobalFonts.registerFromPath(`public/studio-assets/fonts/${file}`,family);
}
try{GlobalFonts.registerFromPath('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','Microsoft YaHei')}catch{}
const poster=await loadImage('public/studio-assets/06-cafe-poster.jpg');
Object.defineProperty(poster,'naturalWidth',{value:poster.width});
Object.defineProperty(poster,'naturalHeight',{value:poster.height});
const video={readyState:0,videoWidth:0,videoHeight:0,paused:true,duration:72};
const media={lesson:video,camera:video,poster,image:poster,reference:poster,kind:'demo',name:'QA'} as any;
const engine=new TrainingEngine();
const frame={input:{commits10s:4,energy:.4,latestRate:2.1,observedMs:5000,frozen:false,points:[{atMs:400,value:.8},{atMs:1600,value:2.2},{atMs:3200,value:3.1}],pulses:[{atMs:2800,amplitude:.7}]},enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:6000,replay:false,pageInputStarted:true};

async function shot(name:string,opts:{portrait:boolean;height?:number;draft?:string}){
 const height=opts.height??1080;
 const layout=applyInputCardLayout(base(opts.portrait,{},'lesson',height),{keyboardVisible:false});
 const cam=cameraControlGeometry(layout,'off','lesson',{cssWidth:layout.width});
 const visual:any={layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:false,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:opts.draft??'Hi, everybody.',inputFocused:true,composition:false,caret:14,selectionEnd:14,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,playbackTime:0,playbackDuration:43,renderTime:1600,snapshot:engine.getSnapshot(),visualEdition:'pro',videoSize:'native',cameraViewport:{width:layout.width,height:layout.height},keyboardFeedback:{visible:false,codes:[],committedUntil:0,composing:false}};
 const scale=opts.portrait?2:1;
 const canvas=createCanvas(Math.round(layout.width*scale),Math.round(layout.height*scale));
 paintTransparentScene(canvas as any,media,visual,frame,opts.portrait,height);
 // Annotate key panels for QA proof
 const ctx=canvas.getContext('2d');
 const mark=(r:{x:number;y:number;w:number;h:number},color:string,label:string)=>{
  ctx.save();ctx.strokeStyle=color;ctx.lineWidth=2*scale;ctx.strokeRect(r.x*scale,r.y*scale,r.w*scale,r.h*scale);
  ctx.fillStyle=color;ctx.font=`${11*scale}px sans-serif`;ctx.fillText(label,r.x*scale+4*scale,r.y*scale+14*scale);ctx.restore();
 };
 mark(layout.goal,'#c4fc57','GOAL');
 mark(layout.metrics,'#42ebda','FLOW');
 mark(layout.trend,'#ffc15f','TREND');
 mark(cam.visual,'#ff6b8a','CAM');
 const path=`/workspace/lingotrace-hud-${name}.png`;
 await writeFile(path,canvas.toBuffer('image/png'));
 const flowUnder=layout.metrics.y>=layout.goal.y+layout.goal.h-1;
 const camClear=!(cam.visual.x<layout.trend.x+layout.trend.w&&cam.visual.x+cam.visual.w>layout.trend.x&&cam.visual.y<layout.trend.y+layout.trend.h&&cam.visual.y+cam.visual.h>layout.trend.y);
 console.log(JSON.stringify({path,portrait:opts.portrait,h:layout.height,compact:layout.practiceCompact,flowUnder,camClear,metricsY:+layout.metrics.y.toFixed(1),camY:+cam.visual.y.toFixed(1)}));
}

await shot('phone',{portrait:true,height:930});
await shot('ipad',{portrait:true,height:1080}); // tall portrait, not practiceCompact
await shot('desktop',{portrait:false});
console.log('hud redesign qa done');
