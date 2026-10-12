import {createRequire} from 'node:module';
const{createCanvas,loadImage,GlobalFonts}=createRequire(import.meta.url)('@napi-rs/canvas');
import{writeFile,mkdir}from'node:fs/promises';
import{paintTransparentScene}from'../studio/scene/transparent-renderer';
import type{SceneVisual,SceneMedia}from'../studio/scene/renderer';
import{TrainingEngine}from'../studio/core/training';
import{PageInputGate}from'../studio/scene/transparent-presentation';
import{TransparentInputProjector}from'../studio/scene/transparent-input';
for(const suffix of['Regular','Bold','Italic','BoldItalic']){GlobalFonts.registerFromPath(`/usr/share/fonts/truetype/liberation/LiberationSans-${suffix}.ttf`,'Arial');GlobalFonts.registerFromPath(`/usr/share/fonts/truetype/liberation/LiberationMono-${suffix}.ttf`,'Courier New')}
GlobalFonts.registerFromPath('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','Microsoft YaHei');for(const name of['studio-sans-regular','studio-sans-bold','studio-mono-regular','studio-semibold'])GlobalFonts.registerFromPath(`public/studio-assets/fonts/${name}.woff`);
const out=process.argv[2]||'/workspace/scratch/dd3f275409c3/studio-qa/v23';await mkdir(out,{recursive:true});const poster=await loadImage('public/studio-assets/06-cafe-poster.jpg');Object.defineProperty(poster,'naturalWidth',{value:poster.width});Object.defineProperty(poster,'naturalHeight',{value:poster.height});
const video={readyState:0,videoWidth:0,videoHeight:0,paused:true,duration:72},media={lesson:video,camera:video,poster,image:poster,reference:poster,kind:'demo',name:'原创素材'} as unknown as SceneMedia;
let now=0,id=0;const clock={now:()=>now,wallTime:()=>new Date(Date.UTC(2026,9,8)+now).toISOString(),id:()=>`program-event-${++id}`},engine=new TrainingEngine({clock}),projector=new TransparentInputProjector();projector.attach(engine.getSnapshot(),0);const gate=new PageInputGate();gate.begin(engine.getSnapshot());engine.subscribe(()=>{projector.observe(engine.getSnapshot(),now);gate.observe(engine.getSnapshot())});
const base:SceneVisual={layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:false,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:'',inputFocused:false,composition:false,caret:0,selectionEnd:0,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,playbackTime:0,playbackDuration:72,renderTime:1000,snapshot:engine.getSnapshot()};
async function render(name:string,view:SceneVisual){for(const[w,h,portrait]of[[1672,941,false],[1920,1080,false],[430,820,true]] as const){const c=createCanvas(w,h);paintTransparentScene(c,media,view,{input:projector.frame(now),enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:Date.UTC(2026,9,8)+now,replay:false,pageInputStarted:gate.started},portrait,820);await writeFile(`${out}/${name}-${w}x${h}-program-render.png`,c.toBuffer('image/png'))}}
now=1000;await render('fresh',{...base,renderTime:now});
for(const ch of'Could I have coffee, please?'){now+=110;engine.input(engine.draft+ch);projector.frame(now)}
engine.submit();now+=400;await render('first-answer',{...base,renderTime:now,snapshot:engine.getSnapshot(),draft:engine.draft,lastResult:engine.currentResult,gain:engine.currentResult?.gain??0,rewardAttemptId:engine.currentResult?.attemptId,rewardAt:now-400});
now+=500;engine.input('Could I have a coffee, please?');const result=engine.submit();now+=350;await render('corrected',{...base,renderTime:now,snapshot:engine.getSnapshot(),draft:engine.draft,lastResult:result,gain:result?.gain??0,rewardAttemptId:result?.attemptId,rewardAt:now-350});
console.log('Saved programmatic Canvas frames from the actual renderer and scripted original input. Not browser, DOM or real-user QA.');
