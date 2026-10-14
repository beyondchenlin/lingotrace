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
const frame={input:{commits10s:5,energy:.55,latestRate:2.8,observedMs:6000,frozen:false,points:[{atMs:500,value:1},{atMs:1800,value:2.6}],pulses:[]},enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:7000,replay:false,pageInputStarted:true};
const visual:any={layout:'lesson',fixture:false,showSubtitle:true,paused:false,reducedMotion:false,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:'Could I',inputFocused:true,composition:false,caret:7,selectionEnd:7,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,playbackTime:12,playbackDuration:72,renderTime:1800,snapshot:engine.getSnapshot(),visualEdition:'pro',videoSize:'native',keyboardFeedback:{visible:true,codes:[],committedUntil:0,composing:false}};

const vpW=1600, vpH=1000;
const stageW=Math.min(vpW, Math.floor(vpH*1672/941));
const stageH=Math.round(stageW*941/1672);
const stage=createCanvas(stageW, stageH);
paintTransparentScene(stage as any, media, {...visual, cameraViewport:{width:stageW,height:stageH}}, frame, false, 1080);

async function compose(mode:'before'|'after', path:string){
  const page=createCanvas(vpW, vpH);
  const c=page.getContext('2d');
  c.fillStyle='#0d1419'; c.fillRect(0,0,vpW,vpH);
  const x=Math.round((vpW-stageW)/2);
  const y=mode==='before'?0:Math.round((vpH-stageH)/2);
  c.drawImage(stage, x, y);
  c.strokeStyle='#00e5ff88'; c.lineWidth=2; c.setLineDash([8,6]);
  c.beginPath(); c.moveTo(0, vpH/2); c.lineTo(vpW, vpH/2); c.stroke();
  c.setLineDash([]);
  c.strokeStyle='#c4fc57'; c.lineWidth=2; c.strokeRect(x+1,y+1,stageW-2,stageH-2);
  c.fillStyle='#c4fc57'; c.font='bold 16px sans-serif';
  const topGap=y, botGap=vpH-(y+stageH);
  c.fillText(`${mode.toUpperCase()}  topGap=${topGap}  bottomGap=${botGap}  vCenter=${Math.abs(topGap-botGap)<=1}  hCenter=true`, 16, 28);
  await writeFile(path, page.toBuffer('image/png'));
  console.log(path, {topGap, botGap, vCenter:Math.abs(topGap-botGap)<=1});
}
await compose('before','/workspace/lingotrace-desktop-before-center.png');
await compose('after','/workspace/lingotrace-desktop-centered.png');
console.log('done');
