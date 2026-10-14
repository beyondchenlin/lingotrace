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
const frameStandby={input:{commits10s:0,energy:0,latestRate:null,observedMs:0,frozen:true,points:[],pulses:[]},enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:2000,replay:false,pageInputStarted:false};
const frameTyping={input:{commits10s:5,energy:.55,latestRate:2.8,observedMs:6000,frozen:false,points:[{atMs:500,value:1},{atMs:1800,value:2.6},{atMs:3500,value:3.8}],pulses:[{atMs:3200,amplitude:.85}]},enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:7000,replay:false,pageInputStarted:true};

async function shot(name:string,opts:{portrait:boolean;height?:number;edition?:'pro'|'kids';keyboard?:boolean;availableHeight?:number;frame?:any;draft?:string;cropToAvail?:boolean}){
 const height=opts.height??1080;
 const layout=applyInputCardLayout(base(opts.portrait,{},'lesson',height),{keyboardVisible:!!opts.keyboard,availableHeight:opts.availableHeight});
 const visual:any={layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:false,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:opts.draft??'',inputFocused:!!opts.draft,composition:false,caret:(opts.draft??'').length,selectionEnd:(opts.draft??'').length,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,playbackTime:12,playbackDuration:72,renderTime:1800,snapshot:engine.getSnapshot(),visualEdition:opts.edition??'pro',keyboardFeedback:{visible:!!opts.keyboard,codes:[],committedUntil:0,composing:false}};
 const scale=opts.portrait?2:1;
 const full=createCanvas(Math.round(layout.width*scale),Math.round(layout.height*scale));
 paintTransparentScene(full as any,media,visual,opts.frame??frameStandby,opts.portrait,height);
 let out=full;
 if(opts.cropToAvail&&opts.availableHeight){
  const avail=opts.availableHeight;
  const kbH=Math.round((layout.height-avail)*scale);
  const visH=Math.round(avail*scale);
  const composite=createCanvas(full.width,visH+Math.min(kbH,Math.round(280*scale)));
  const ctx=composite.getContext('2d');
  ctx.drawImage(full,0,0,full.width,visH,0,0,full.width,visH);
  // Fake OS keyboard plate so the fold boundary is explicit in the QA artifact
  const ky=visH;
  ctx.fillStyle='#1c1c1e';
  ctx.fillRect(0,ky,full.width,composite.height-ky);
  ctx.fillStyle='#2c2c2e';
  const rowH=Math.round(42*scale),pad=Math.round(6*scale);
  for(let row=0;row<4;row++){
   for(let col=0;col<10;col++){
    const kw=Math.round((full.width-pad*11)/10);
    ctx.fillRect(pad+col*(kw+pad),ky+pad+row*(rowH+pad),kw,rowH);
   }
  }
  ctx.fillStyle='#8e8e93';
  ctx.font=`${Math.round(13*scale)}px sans-serif`;
  ctx.fillText('OS keyboard (visualViewport fold)', pad, ky+Math.round(18*scale));
  out=composite;
 }
 const path=`/workspace/lingotrace-onescreen-${name}.png`;
 await writeFile(path,out.toBuffer('image/png'));
 const empty=+(layout.height-(layout.player.y+layout.player.h)).toFixed(2);
 console.log(path, `${out.width}x${out.height}`, 'logical', `${layout.width}x${layout.height}`, 'playerH', layout.player.h.toFixed(1), 'cardY', layout.inputCard.card.y.toFixed(1), 'empty', empty, 'media', `${layout.media.w}x${layout.media.h}`);
}

await shot('mobile-standby',{portrait:true,height:930,keyboard:false,frame:frameStandby});
await shot('mobile-typing',{portrait:true,height:930,keyboard:false,frame:frameTyping,draft:'Could I'});
await shot('mobile-keyboard-open',{portrait:true,height:930,keyboard:false,availableHeight:930*0.52,frame:frameTyping,draft:'Could I have',cropToAvail:true});
await shot('mobile-kids-standby',{portrait:true,height:930,edition:'kids',keyboard:false,frame:frameStandby});
await shot('desktop-landscape',{portrait:false,keyboard:true,frame:frameTyping,draft:'Could I'});
console.log('onescreen qa done');
