import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';
import {writeFile,mkdir} from 'node:fs/promises';
import {TrainingEngine} from '../studio/core/training.ts';
import {paintTransparentScene} from '../studio/scene/transparent-renderer.ts';
import {responsiveLayout as base} from '../studio/scene/responsive-layout.ts';
import {applyInputCardLayout} from '../studio/scene/input-card.ts';
import {learningGeometry} from '../studio/scene/learning-surface.ts';

for(const [file,family] of [['studio-sans-regular.woff','Lingo Studio Sans'],['studio-sans-bold.woff','Lingo Studio Sans'],['studio-semibold.woff','Lingo Studio Semibold'],['studio-mono-regular.woff','Lingo Studio Mono']]){
 GlobalFonts.registerFromPath(`public/studio-assets/fonts/${file}`,family);
}
try{GlobalFonts.registerFromPath('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','Microsoft YaHei')}catch{}

const OUT='/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/no-video-capsule-qa';
await mkdir(OUT,{recursive:true});

const poster=await loadImage('public/studio-assets/06-cafe-poster.jpg');
Object.defineProperty(poster,'naturalWidth',{value:poster.width});
Object.defineProperty(poster,'naturalHeight',{value:poster.height});
const video={readyState:0,videoWidth:0,videoHeight:0,paused:true,duration:43};
const media={lesson:video,camera:video,poster,image:poster,reference:poster,kind:'demo',name:'QA'} as any;
const engine=new TrainingEngine();
const snapshot=engine.getSnapshot();
const cue=snapshot.material.cues[0]?.text??'Hi, everybody.';
const words=cue.split(/\s+/).filter(w=>w.replace(/\W/g,'').length>1);

const frame={
 input:{commits10s:0,energy:0,latestRate:0,observedMs:0,frozen:false,points:[],pulses:[]},
 enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:1000,replay:false,pageInputStarted:true
};

function capture(visual:any, portrait:boolean, height:number){
 const layout=applyInputCardLayout(base(portrait,{},'lesson',height),{keyboardVisible:false});
 const g=learningGeometry(layout,{keyboardVisible:false,cssWidth:portrait?430:1672});
 const labels:any[]=[];
 const scale=portrait?2:1.25;
 const canvas=createCanvas(Math.round(g.width*scale),Math.round(g.height*scale));
 const real=canvas.getContext('2d');
 const proto=Object.getPrototypeOf(real);
 const orig=proto.fillText;
 proto.fillText=function(text:string,x:number,y:number,...rest:any[]){
  const t=this.getTransform(),m=this.measureText(String(text));
  const sx=(t.a*x+t.c*y+t.e)/scale, sy=(t.b*x+t.d*y+t.f)/scale;
  labels.push({text:String(text),x:sx,y:sy,fill:String(this.fillStyle),alpha:this.globalAlpha});
  return orig.call(this,text,x,y,...rest);
 };
 try{
  paintTransparentScene(canvas as any,media,{...visual,cameraViewport:{width:g.width,height:g.height}},frame,portrait,height);
 } finally { proto.fillText=orig; }
 return {labels,g,canvas};
}

const cases=[
 {name:'mobile-assisted-empty', portrait:true, height:930, referenceGuide:cue, draft:''},
 {name:'desktop-assisted-empty', portrait:false, height:941, referenceGuide:cue, draft:''},
 {name:'mobile-dictation-empty', portrait:true, height:930, referenceGuide:undefined, draft:''},
 {name:'desktop-dictation-empty', portrait:false, height:941, referenceGuide:undefined, draft:''},
 {name:'mobile-assisted-typed', portrait:true, height:930, referenceGuide:cue, draft:'Hi'},
 {name:'desktop-assisted-typed', portrait:false, height:941, referenceGuide:cue, draft:'Hi'},
 {name:'mobile-showSubtitle-only', portrait:true, height:930, referenceGuide:undefined, draft:'', showSubtitle:true},
];

const report:any[]=[];
for(const c of cases){
 const visual:any={
  layout:'lesson',fixture:false,showSubtitle:!!c.showSubtitle,paused:false,reducedMotion:true,camera:'off',
  recording:false,recordingStarted:null,recordingBytes:0,
  draft:c.draft,inputFocused:true,composition:false,
  caret:c.draft.length,selectionEnd:c.draft.length,scrollLeft:0,scrollTop:0,
  message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,
  playbackTime:1.2,playbackDuration:43,renderTime:1000,snapshot,
  visualEdition:'pro',videoSize:'native',
  keyboardFeedback:{visible:false,codes:[],committedUntil:0,composing:false},
  referenceGuide:c.referenceGuide, underlineMode:'words',
 };
 const {labels,g,canvas}=capture(visual,c.portrait,c.height);
 await writeFile(`${OUT}/${c.name}.png`,canvas.toBuffer('image/png'));
 const isCue=l=>l.text===cue||words.some(w=>l.text===w||l.text.includes(w));
 const videoCapsule=labels.filter(l=>l.x>g.subtitle.x-4&&l.x<g.subtitle.x+g.subtitle.w+4&&l.y>=g.subtitle.y-4&&l.y<=g.subtitle.y+g.subtitle.h+4&&isCue(l));
 const aboveTyping=labels.filter(l=>l.y<g.inputCard.card.y-4&&isCue(l));
 const typing=labels.filter(l=>l.x>=g.inputCard.input.x-4&&l.x<=g.inputCard.input.x+g.inputCard.input.w+4&&l.y>=g.inputCard.input.y-4&&l.y<=g.inputCard.input.y+g.inputCard.input.h+24&&isCue(l));
 const pale=typing.filter(l=>String(l.fill).includes('b7c6c1')||l.alpha<1);
 const row={
  name:c.name, cue,
  videoCapsule:videoCapsule.map(l=>l.text),
  aboveTyping:aboveTyping.map(l=>l.text),
  typingCue:typing.map(l=>l.text),
  paleTyping:pale.map(l=>l.text),
  failVideoCapsule: videoCapsule.length>0 || aboveTyping.length>0,
  failMissingTypingRef: !!c.referenceGuide && !c.draft && typing.length===0,
  failDictationLeak: !c.referenceGuide && labels.some(isCue),
 };
 report.push(row);
 console.log(JSON.stringify(row,null,2));
}
await writeFile(`${OUT}/audit-report.json`,JSON.stringify(report,null,2));
const failures=report.filter(r=>r.failVideoCapsule||r.failMissingTypingRef||r.failDictationLeak);
await writeFile(`${OUT}/failures.json`,JSON.stringify(failures,null,2));
console.log('FAILURES',failures.length);
