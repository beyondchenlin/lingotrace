import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';
import {writeFile} from 'node:fs/promises';
import {TrainingEngine} from '../studio/core/training.ts';
import {paintTransparentScene} from '../studio/scene/transparent-renderer.ts';

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
const frame={input:{commits10s:4,energy:.5,latestRate:2.4,observedMs:5000,frozen:false,points:[{atMs:400,value:1.2},{atMs:1600,value:2.5},{atMs:3200,value:3.4}],pulses:[{atMs:3000,amplitude:.9}]},enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:6000,replay:false,pageInputStarted:true};
async function shot(name:string,edition:'pro'|'kids',portrait:boolean,height=1080){
 const visual:any={layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:true,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:'',inputFocused:false,composition:false,caret:0,selectionEnd:0,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,playbackTime:0,playbackDuration:72,renderTime:1200,snapshot:engine.getSnapshot(),visualEdition:edition,keyboardFeedback:{visible:false,codes:[],committedUntil:0,composing:false}};
 const scale=portrait?2:1;
 const w=portrait?430:1672,h=portrait?height:941;
 const canvas=createCanvas(Math.round(w*scale),Math.round(h*scale));
 paintTransparentScene(canvas as any,media,visual,frame,portrait,height);
 const path=`/workspace/lingotrace-kids-${name}.png`;
 await writeFile(path,canvas.toBuffer('image/png'));
 console.log(path, canvas.width+'x'+canvas.height, edition);
}
await shot('desktop-pro', 'pro', false);
await shot('desktop-kids', 'kids', false);
await shot('mobile-kids', 'kids', true, 930);
await shot('mobile-pro', 'pro', true, 930);
console.log('kids qa done');
