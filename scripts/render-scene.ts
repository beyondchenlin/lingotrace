import {createRequire} from 'node:module';
const {createCanvas,loadImage,GlobalFonts}=createRequire(import.meta.url)('@napi-rs/canvas');
import {writeFile,mkdir} from 'node:fs/promises';
import {paintScene,type SceneMedia,type SceneVisual} from '../studio/scene/renderer';
import {TrainingEngine} from '../studio/core/training';
for(const suffix of ['Regular','Bold','Italic','BoldItalic']){GlobalFonts.registerFromPath(`/usr/share/fonts/truetype/liberation/LiberationSans-${suffix}.ttf`,'Arial');GlobalFonts.registerFromPath(`/usr/share/fonts/truetype/liberation/LiberationMono-${suffix}.ttf`,'Courier New');}GlobalFonts.registerFromPath('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','Microsoft YaHei');
const out=process.argv[2]||'/workspace/scratch/dd3f275409c3/studio-qa';await mkdir(out,{recursive:true});
const poster=await loadImage('public/studio-assets/06-cafe-poster.jpg'),ref=await loadImage('public/studio-assets/06-reference.png');
for(const image of [poster,ref]){if(!image.naturalWidth)Object.defineProperty(image,'naturalWidth',{value:image.width});if(!image.naturalHeight)Object.defineProperty(image,'naturalHeight',{value:image.height});}
const fakeVideo={readyState:0,videoWidth:0,videoHeight:0,paused:true},engine=new TrainingEngine();
const media={lesson:fakeVideo,camera:fakeVideo,poster,image:poster,reference:ref,kind:'demo',name:'原创素材'} as unknown as SceneMedia;
const base={layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:false,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:'',inputFocused:false,composition:false,caret:0,selectionEnd:0,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,playbackTime:0,playbackDuration:72,renderTime:1000,snapshot:engine.getSnapshot()} satisfies SceneVisual;
for(const [width,height]of [[1672,941],[1920,1080]])for(const fixture of [false,true]){const c=createCanvas(width,height);paintScene(c as unknown as HTMLCanvasElement,media,{...base,fixture});await writeFile(`${out}/06-${width}x${height}-${fixture?'reference-fixture':'fresh'}-program-render.png`,c.toBuffer('image/png'));}
console.log('Programmatic Canvas render saved; this is not a browser or DOM verification.');
const custom=createCanvas(1672,941);paintScene(custom as unknown as HTMLCanvasElement,media,{...base,arrangement:{media:{x:20,y:110,w:850,h:850*941/1672},inset:{x:1120,y:105,w:300,h:300*218/273},subtitle:{x:750,y:465,w:766,h:73},metrics:{x:280,y:365,w:1200,h:1200*118/1672}}});await writeFile(`${out}/06-1672x941-custom-layout-program-render.png`,custom.toBuffer('image/png'));
// Explicit program-only boundary fixtures. No event log or live training data is modified.
if(process.argv.includes('--pace-boundaries'))for(const value of[0,99,100,999,1000])for(const[width,height]of[[1672,941],[1920,1080]]){const c=createCanvas(width,height);paintScene(c as unknown as HTMLCanvasElement,media,{...base,message:`程序边界夹具 · 节奏测试值 ${value} · 非真实训练`,snapshot:{...base.snapshot,pace:value}});await writeFile(`${out}/06-${width}x${height}-pace-${value}-program-fixture.png`,c.toBuffer('image/png'));}
