import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';
import {writeFile,mkdir} from 'node:fs/promises';
import {TrainingEngine} from '../studio/core/training.ts';
import {paintTransparentScene} from '../studio/scene/transparent-renderer.ts';
import {responsiveLayout as base} from '../studio/scene/responsive-layout.ts';
import {applyInputCardLayout} from '../studio/scene/input-card.ts';

for(const [file,family] of [['studio-sans-regular.woff','Lingo Studio Sans'],['studio-sans-bold.woff','Lingo Studio Sans'],['studio-semibold.woff','Lingo Studio Semibold'],['studio-mono-regular.woff','Lingo Studio Mono']]){
 GlobalFonts.registerFromPath(`public/studio-assets/fonts/${file}`,family);
}
try{GlobalFonts.registerFromPath('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','Microsoft YaHei')}catch{}

const OUT='/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/prd-continue10-qa';
await mkdir(OUT,{recursive:true});
const poster=await loadImage('public/studio-assets/06-cafe-poster.jpg');
Object.defineProperty(poster,'naturalWidth',{value:poster.width});
Object.defineProperty(poster,'naturalHeight',{value:poster.height});
const video={readyState:0,videoWidth:0,videoHeight:0,paused:true,duration:43};
const media={lesson:video,camera:video,poster,image:poster,reference:poster,kind:'demo',name:'QA'} as any;
const engine=new TrainingEngine();
const snapshot=engine.getSnapshot();
const cue=snapshot.material.cues[0]?.text??'Hi, everybody.';
const frame={
 input:{commits10s:4,energy:.45,latestRate:2.4,observedMs:6000,frozen:false,
  points:[{atMs:400,value:.8},{atMs:1600,value:2.2},{atMs:3200,value:3.4},{atMs:4800,value:2.1}],
  pulses:[{eventId:'p1',atMs:2500,added:2,source:'typed'},{eventId:'p2',atMs:3100,added:3,source:'typed'},{eventId:'p3',atMs:4200,added:1,source:'typed'}]},
 enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:7000,replay:false,pageInputStarted:true
};
async function shot(name:string,opts:{portrait:boolean;height?:number;draft?:string;reference?:boolean;dictation?:boolean}){
 const height=opts.height??(opts.portrait?930:941);
 const layout=applyInputCardLayout(base(opts.portrait,{},'lesson',height),{keyboardVisible:false});
 const visual:any={
  layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:false,camera:'off',
  recording:false,recordingStarted:null,recordingBytes:0,
  draft:opts.draft??'',inputFocused:true,composition:false,
  caret:(opts.draft??'').length,selectionEnd:(opts.draft??'').length,scrollLeft:0,scrollTop:0,
  message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,
  playbackTime:4.2,playbackDuration:43,renderTime:2400,snapshot,
  visualEdition:'pro',videoSize:'native',
  cameraViewport:{width:layout.width,height:layout.height},
  keyboardFeedback:{visible:false,codes:[],committedUntil:0,composing:false},
  referenceGuide:opts.dictation?undefined:(opts.reference?cue:undefined),
  underlineMode:'words',
 };
 const scale=opts.portrait?2:1.25;
 const canvas=createCanvas(Math.round(layout.width*scale),Math.round(layout.height*scale));
 paintTransparentScene(canvas as any,media,visual,frame,opts.portrait,height);
 await writeFile(`${OUT}/${name}.png`,canvas.toBuffer('image/png'));
 console.log(name);
}
await shot('mobile-nps-assisted',{portrait:true,height:930,reference:true,draft:''});
await shot('mobile-nps-assisted-typed',{portrait:true,height:930,reference:true,draft:cue});
await shot('desktop-nps-assisted',{portrait:false,reference:true,draft:''});
await shot('mobile-nps-dictation',{portrait:true,height:930,dictation:true,draft:''});
console.log('prd-continue10 craft qa done');
