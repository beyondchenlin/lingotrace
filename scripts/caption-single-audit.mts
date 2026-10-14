
import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';
import {writeFile,mkdir} from 'node:fs/promises';
import {TrainingEngine} from '../studio/core/training.ts';
import {paintTransparentScene} from '../studio/scene/transparent-renderer.ts';
import {responsiveLayout as base} from '../studio/scene/responsive-layout.ts';
import {applyInputCardLayout,paintInputText} from '../studio/scene/input-card.ts';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);

for(const [file,family] of [['studio-sans-regular.woff','Lingo Studio Sans'],['studio-sans-bold.woff','Lingo Studio Sans'],['studio-semibold.woff','Lingo Studio Semibold'],['studio-mono-regular.woff','Lingo Studio Mono']]){
 GlobalFonts.registerFromPath(`public/studio-assets/fonts/${file}`,family);
}
try{GlobalFonts.registerFromPath('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','Microsoft YaHei')}catch{}

const OUT='/cursor/stores/store-ff53f92a-627a-43b0-9205-873f7626ce00/caption-single-audit-qa';
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

function captureLabels(visual:any, portrait:boolean, height:number){
 const layout=applyInputCardLayout(base(portrait,{},'lesson',height),{keyboardVisible:false});
 const labels:any[]=[];
 const scale=portrait?2:1.25;
 const canvas=createCanvas(Math.round(layout.width*scale),Math.round(layout.height*scale));
 const real=canvas.getContext('2d');
 const proto=Object.getPrototypeOf(real);
 const orig=proto.fillText;
 proto.fillText=function(text:string,x:number,y:number,...rest:any[]){
  const m=this.measureText(String(text));
  const font=String(this.font||'');
  const size=Number((/(\d+(?:\.\d+)?)px/.exec(font)||[])[1]||0);
  labels.push({text:String(text),x,y,size,width:m.width,align:this.textAlign,fill:this.fillStyle,alpha:this.globalAlpha});
  return orig.call(this,text,x,y,...rest);
 };
 try{
  paintTransparentScene(canvas as any,media,{...visual,cameraViewport:{width:layout.width,height:layout.height}},frame,portrait,height);
 } finally {
  proto.fillText=orig;
 }
 return {labels,layout,canvas};
}

const cases=[
 {name:'mobile-assisted-empty', portrait:true, height:930, showSubtitle:false, referenceGuide:cue, draft:''},
 {name:'mobile-assisted-empty-both-flags', portrait:true, height:930, showSubtitle:true, referenceGuide:cue, draft:''},
 {name:'mobile-showSubtitle-only', portrait:true, height:930, showSubtitle:true, referenceGuide:undefined, draft:''},
 {name:'mobile-dictation-empty', portrait:true, height:930, showSubtitle:false, referenceGuide:undefined, draft:''},
 {name:'mobile-assisted-typed', portrait:true, height:930, showSubtitle:false, referenceGuide:cue, draft:cue},
 {name:'desktop-assisted-empty', portrait:false, height:941, showSubtitle:false, referenceGuide:cue, draft:''},
 {name:'desktop-assisted-empty-both-flags', portrait:false, height:941, showSubtitle:true, referenceGuide:cue, draft:''},
 {name:'desktop-dictation-empty', portrait:false, height:941, showSubtitle:false, referenceGuide:undefined, draft:''},
 {name:'mobile-kids-assisted-empty', portrait:true, height:930, showSubtitle:false, referenceGuide:cue, draft:'', edition:'kids'},
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
  visualEdition:c.edition??'pro',videoSize:'native',
  keyboardFeedback:{visible:false,codes:[],committedUntil:0,composing:false},
  referenceGuide:c.referenceGuide,
  underlineMode:'words',
 };
 const {labels,layout,canvas}=captureLabels(visual,c.portrait,c.height);
 await writeFile(`${OUT}/${c.name}.png`,canvas.toBuffer('image/png'));
 const g=layout;
 const cueHits=labels.filter(l=>l.text===cue || words.some(w=>l.text===w || l.text.includes(w.replace(/[^\w]/g,''))));
 const typingBand=labels.filter(l=>l.x>=g.inputCard.input.x-4 && l.x<=g.inputCard.input.x+g.inputCard.input.w+4 && l.y>=g.inputCard.input.y-8 && l.y<=g.inputCard.input.y+g.inputCard.input.h+24);
 const typingCue=typingBand.filter(l=>l.text===cue || words.some(w=>l.text===w));
 const captionBand=labels.filter(l=>l.x>=g.subtitle.x-8 && l.x<=g.subtitle.x+g.subtitle.w+8 && l.y>=g.subtitle.y-8 && l.y<=g.subtitle.y+g.subtitle.h+24);
 const captionCue=captionBand.filter(l=>l.text===cue || words.some(w=>l.text===w) || l.text.split(' ').some((p:string)=>words.includes(p)));
 const fullCueCount=labels.filter(l=>l.text===cue).length;
 const row={
  name:c.name,
  cue,
  fullCueCount,
  typingCueTexts:typingCue.map(l=>l.text),
  captionCueTexts:captionCue.map(l=>l.text),
  allCueLike:cueHits.map(l=>({text:l.text,x:Math.round(l.x),y:Math.round(l.y),fill:String(l.fill),alpha:l.alpha})),
  failEmptyDual: !c.draft && typingCue.length>0,
  failDictationLeak: !c.referenceGuide && cueHits.some(l=>l.text===cue || words.some(w=>l.text===w||l.text.includes(w))),
  failShowSubtitleOnly: c.name.includes('showSubtitle-only') && cueHits.length>0,
 };
 report.push(row);
 console.log(JSON.stringify(row,null,2));
}

await writeFile(`${OUT}/audit-report.json`,JSON.stringify(report,null,2));
const failures=report.filter(r=>r.failEmptyDual || r.failDictationLeak || r.failShowSubtitleOnly || (r.name.includes('assisted-empty') && !r.name.includes('both') && r.typingCueTexts.length>0));
console.log('FAILURES', failures.length);
await writeFile(`${OUT}/failures.json`,JSON.stringify(failures,null,2));
