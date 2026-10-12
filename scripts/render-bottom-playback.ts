/** Same-renderer evidence; this is deliberately not a browser screenshot script. */
import {createCanvas,GlobalFonts,loadImage} from '@napi-rs/canvas';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {paintTransparentScene} from '../studio/scene/transparent-renderer';
import {learningGeometry} from '../studio/scene/learning-surface';
import {responsiveLayout} from '../studio/scene/responsive-layout';
import {TrainingEngine} from '../studio/core/training';
import {NPS_MATERIAL} from '../studio/core/builtin-material';
const out=resolve(process.argv[2]??'../lingotrace-bottom-playback-evidence'),baseline=resolve(process.argv[3]??'../lingotrace-typing-main-candidate');mkdirSync(out,{recursive:true});
const {paintTransparentScene:paintBefore}=await import(pathToFileURL(`${baseline}/studio/scene/transparent-renderer.ts`).href);
const {learningGeometry:geometryBefore}=await import(pathToFileURL(`${baseline}/studio/scene/learning-surface.ts`).href);
// Provide a local program Canvas only for the renderer's tiny source sampler.
(globalThis as any).OffscreenCanvas=class{constructor(width:number,height:number){return createCanvas(width,height)}};
for(const[file,family]of[['studio-sans-regular.woff','Lingo Studio Sans'],['studio-sans-bold.woff','Lingo Studio Sans'],['studio-semibold.woff','Lingo Studio Semibold'],['studio-mono-regular.woff','Lingo Studio Mono']])GlobalFonts.registerFromPath(`public/studio-assets/fonts/${file}`,family);
const poster=await loadImage(`${out}/nps-source-frame.png`);
Object.defineProperties(poster,{naturalWidth:{value:poster.width},naturalHeight:{value:poster.height},complete:{value:true}});
const media={lesson:{readyState:0,paused:true,duration:43,videoWidth:1280,videoHeight:720},camera:{readyState:0},poster,image:{complete:false},reference:{complete:false},kind:'demo',name:'NPS source frame, programmatic layout proof'} as any;
const e=new TrainingEngine({material:NPS_MATERIAL});e.nextCue(1);e.input('My name ');
const frame={input:{commits10s:0,energy:0,latestRate:null,observedMs:0,frozen:true,points:[],pulses:[]},enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:1000,replay:false,pageInputStarted:true,mediaInteracted:true};
const report=[];
for(const[width,portrait,placement,videoSize]of[[1280,false,'inside','native'],[1280,false,'hidden','native'],[1280,false,'below','native'],[640,false,'below','half'],[960,false,'hidden','native'],[390,true,'hidden','native']]as const){
 for(const version of['before','after']){
 const geometry=version==='before'?geometryBefore:learningGeometry,paint=version==='before'?paintBefore:paintTransparentScene;
 const options={keyboardVisible:placement!=='hidden',keyboardPlacement:placement==='below'?'below' as const:'inside' as const,cssWidth:width,availableHeight:1080,videoSize};
 const g=geometry(responsiveLayout(portrait),options),scale=width/g.width,canvas=createCanvas(width,Math.ceil(g.height*scale));
 const v={layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:true,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:e.draft,referenceGuide:e.cue.text,inputFocused:false,composition:false,caret:e.draft.length,selectionEnd:e.draft.length,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,playbackTime:1,playbackDuration:43,renderTime:1200,snapshot:e.getSnapshot(),cameraViewport:{width,height:g.height*scale},keyboardFeedback:{visible:placement!=='hidden',codes:[],committedUntil:0,composing:false},keyboardPlacement:options.keyboardPlacement,videoSize,mediaViewport:{width,height:1080}} as any;
 paint(canvas as any,media,v,frame,portrait);
 const file=`${version}-${width}-${portrait?'portrait':placement}.png`;writeFileSync(`${out}/${file}`,canvas.toBuffer('image/png'));
 report.push({version,width,portrait,placement,videoSize,file,canvasHeight:canvas.height,fontCss:g.inputCard.fontSize*scale,input:g.inputCard.input,card:g.inputCard.card,player:g.player,keyboard:g.inputCard.keyboard,metrics:g.metrics});canvas.width=1;canvas.height=1;
 }
}
writeFileSync(`${out}/geometry.json`,JSON.stringify({kind:'same-renderer program frames, not browser screenshots',source:'NPS original video frame at 1 second',beforeCommit:'1b693e483b44ddcf3a8c746d15cc543ccb076986',report},null,2));
