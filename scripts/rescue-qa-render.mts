import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';
import {writeFile} from 'node:fs/promises';
import {TrainingEngine} from '../studio/core/training.ts';
import {paintTransparentScene} from '../studio/scene/transparent-renderer.ts';
import {responsiveLayout as base} from '../studio/scene/responsive-layout.ts';
import {applyInputCardLayout} from '../studio/scene/input-card.ts';

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
const visual:any={layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:true,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:'',inputFocused:false,composition:false,caret:0,selectionEnd:0,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,playbackTime:0,playbackDuration:72,renderTime:1200,snapshot:engine.getSnapshot()};
const frame={input:{commits10s:3,energy:.4,latestRate:2.1,observedMs:4000,frozen:false,points:[{atMs:500,value:1},{atMs:1500,value:2.2},{atMs:3000,value:3.1}],pulses:[{atMs:2800,amplitude:.8}]},enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:5000,replay:false,pageInputStarted:true};

async function shot(name:string,portrait:boolean,height=1080,keyboardVisible=false){
 const g=applyInputCardLayout(base(portrait,{},'lesson',height),{keyboardVisible});
 const scale=portrait?2:1;
 const canvas=createCanvas(Math.round(g.width*scale),Math.round(g.height*scale));
 paintTransparentScene(canvas as any,media,visual,frame,portrait,height);
 const path=`/workspace/lingotrace-rescue-${name}.png`;
 await writeFile(path,canvas.toBuffer('image/png'));
 console.log(path, `${canvas.width}x${canvas.height}`, 'stage', `${g.width}x${g.height}`, 'compact', !!(g as any).practiceCompact, 'goalW', Math.round(g.goal.w));
}

await shot('mobile-390x844-portrait', true, 930, false);
await shot('mobile-393x852-portrait', true, 820, false);
await shot('desktop-1280x800-landscape', false, 941, true);
await shot('desktop-1440x900-landscape', false, 941, true);
await shot('portrait-tall-1080-baseline', true, 1080, false);
console.log('done');
