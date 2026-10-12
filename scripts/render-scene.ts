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
