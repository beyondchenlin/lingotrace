import {createRequire} from 'node:module';
const{createCanvas,loadImage,GlobalFonts}=createRequire(import.meta.url)('@napi-rs/canvas');
import{writeFile,mkdir}from'node:fs/promises';
import{paintTransparentScene}from'../studio/scene/transparent-renderer';
import type{SceneVisual,SceneMedia}from'../studio/scene/renderer';
import{TrainingEngine}from'../studio/core/training';
import{responsiveLayout}from'../studio/scene/responsive-layout';
import{applyInputCardLayout,inputGuideMask,inputViewportPlan,wrapInputText}from'../studio/scene/input-card';
import{PageInputGate}from'../studio/scene/transparent-presentation';
import{TransparentInputProjector}from'../studio/scene/transparent-input';
for(const suffix of['Regular','Bold','Italic','BoldItalic']){GlobalFonts.registerFromPath(`/usr/share/fonts/truetype/liberation/LiberationSans-${suffix}.ttf`,'Arial');GlobalFonts.registerFromPath(`/usr/share/fonts/truetype/liberation/LiberationMono-${suffix}.ttf`,'Courier New')}
GlobalFonts.registerFromPath('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','Microsoft YaHei');for(const name of['studio-sans-regular','studio-sans-bold','studio-mono-regular','studio-semibold'])GlobalFonts.registerFromPath(`public/studio-assets/fonts/${name}.woff`);
const out=process.argv[2]||'/workspace/scratch/dd3f275409c3/studio-qa/v23';await mkdir(out,{recursive:true});const poster=await loadImage('public/studio-assets/06-cafe-poster.jpg');Object.defineProperty(poster,'naturalWidth',{value:poster.width});Object.defineProperty(poster,'naturalHeight',{value:poster.height});
const video={readyState:0,videoWidth:0,videoHeight:0,paused:true,duration:72},media={lesson:video,camera:video,poster,image:poster,reference:poster,kind:'demo',name:'原创素材'} as unknown as SceneMedia;
let now=0,id=0;const clock={now:()=>now,wallTime:()=>new Date(Date.UTC(2026,9,8)+now).toISOString(),id:()=>`program-event-${++id}`},engine=new TrainingEngine({clock}),projector=new TransparentInputProjector();projector.attach(engine.getSnapshot(),0);const gate=new PageInputGate();gate.begin(engine.getSnapshot());engine.subscribe(()=>{projector.observe(engine.getSnapshot(),now);gate.observe(engine.getSnapshot())});
const base:SceneVisual={layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:false,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:'',inputFocused:false,composition:false,caret:0,selectionEnd:0,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,playbackTime:0,playbackDuration:72,renderTime:1000,snapshot:engine.getSnapshot()};
async function render(name:string,view:SceneVisual,portrait=false){const g=applyInputCardLayout(responsiveLayout(portrait),{keyboardVisible:!portrait});const c=createCanvas(g.width,g.height);paintTransparentScene(c,media,{...view,keyboardFeedback:{visible:!portrait,codes:[],committedUntil:0,composing:false}},{input:projector.frame(now),enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:Date.UTC(2026,9,8)+now,replay:false,pageInputStarted:gate.started},portrait);await writeFile(`${out}/${name}.png`,c.toBuffer('image/png'))}
for(const portrait of [false,true]){const suffix=portrait?'portrait':'desktop';await render(`strict-empty-${suffix}`,base,portrait);await render(`typed-hello-${suffix}`,{...base,draft:'HELLO'},portrait);await render(`guided-hello-${suffix}`,{...base,inputGuide:{mode:'letters',mask:inputGuideMask('HELLO')}},portrait);await render(`guided-words-${suffix}`,{...base,inputGuide:{mode:'words',mask:inputGuideMask('Hello this is a longer sentence that wraps naturally into multiple lines.')}},portrait)}
console.log('Actual Canvas program renders only; no browser/IME/recording claim.');

// Programmatic proof of the same Canvas window at the tail of an empty guided cue.
const guideMask=inputGuideMask('This deliberately long sentence has enough words to occupy several visible lines, and its final placeholders must remain reachable before the learner has typed anything at all.');
const guideCard=applyInputCardLayout(responsiveLayout(true),{keyboardVisible:false}).inputCard;
const measure=createCanvas(1,1).getContext('2d'),font=`400 ${guideCard.fontSize}px "Lingo Studio Mono", "Courier New", monospace`;measure.font=font;
const guideLines=wrapInputText(guideMask,guideCard.input.w-guideCard.paddingX*2,(text:string)=>measure.measureText(text).width);
const display={text:'',lines:[{start:0,end:0,text:'',x:guideCard.paddingX,y:guideCard.paddingY,width:0,height:guideCard.lineHeight,baseline:guideCard.paddingY+guideCard.lineHeight*.8}],selection:[],caret:{x:guideCard.paddingX,y:guideCard.paddingY,w:1.5,h:guideCard.lineHeight},scrollLeft:0,scrollTop:0,width:guideCard.input.w,height:guideCard.input.h,font,letterSpacing:0,lineHeight:guideCard.lineHeight,paddingX:guideCard.paddingX,paddingY:guideCard.paddingY};
const guidePlan=inputViewportPlan(display,guideCard.input.h,guideLines.length*guideCard.lineHeight+guideCard.paddingY*2,Infinity,false);
await render('long-empty-guide-top-portrait',{...base,inputGuide:{mode:'letters',mask:guideMask},nativeInputDisplay:display},true);
await render('long-empty-guide-tail-portrait',{...base,inputGuide:{mode:'letters',mask:guideMask},nativeInputDisplay:{...display,scrollTop:guidePlan.scrollTop}},true);
await writeFile(`${out}/empty-guide-scroll-plan.json`,JSON.stringify({kind:'programmatic, not browser',draft:'',guideLines:guideLines.length,...guidePlan},null,2));
