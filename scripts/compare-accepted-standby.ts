/** Offline exact-source comparison. Not browser FPS or device evidence. */
import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';
import {writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {paintTransparentScene} from '../studio/scene/transparent-renderer';
import {TrainingEngine} from '../studio/core/training';
import {STANDBY_ENERGY_CYCLES} from '../studio/scene/standby-energy';
import type {SceneMedia,SceneVisual} from '../studio/scene/renderer';
const [baseline,out]=process.argv.slice(2);if(!baseline||!out)throw Error('Pass extracted immutable v46 source and evidence directory');
const oldModule=await import(pathToFileURL(`${baseline}/studio/scene/transparent-renderer.ts`).href),oldPaint=oldModule.paintTransparentScene??oldModule.default?.paintTransparentScene;
assert.equal(typeof oldPaint,'function');await mkdir(out,{recursive:true});
for(const [file,name] of [['studio-sans-regular','Lingo Studio Sans'],['studio-sans-bold','Lingo Studio Sans'],['studio-mono-regular','Lingo Studio Mono'],['studio-semibold','Lingo Studio Semibold']])GlobalFonts.registerFromPath(`public/studio-assets/fonts/${file}.woff`,name);
GlobalFonts.registerFromPath('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','Microsoft YaHei');
const poster=await loadImage('public/studio-assets/06-cafe-poster.jpg');Object.defineProperties(poster,{naturalWidth:{value:poster.width},naturalHeight:{value:poster.height}});
const lesson={readyState:0,paused:true,duration:72,currentTime:0},media={lesson,camera:lesson,poster,image:poster,reference:poster,kind:'demo',name:'original course'} as unknown as SceneMedia;
const snapshot=new TrainingEngine().getSnapshot(),before=JSON.stringify(snapshot);
const visual:SceneVisual={layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:false,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:'',inputFocused:false,composition:false,caret:0,selectionEnd:0,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,playbackTime:0,playbackDuration:72,renderTime:0,snapshot};
const frame={input:{commits10s:0,energy:0,latestRate:null,observedMs:0,frozen:true,points:[],pulses:[]},enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:Date.UTC(2026,9,9),replay:false,pageInputStarted:false};
function render(paint:typeof paintTransparentScene,atMs:number,portrait:boolean){const canvas=createCanvas(portrait?430:1672,portrait?820:941),ctx=canvas.getContext('2d'),original=ctx.fillText.bind(ctx),numbers:string[]=[];ctx.fillText=((text:string,x:number,y:number,max?:number)=>{if((x===164&&(y===194||y===221))||(x===16&&y===75))numbers.push(text);original(text,x,y,max)})as typeof ctx.fillText;paint(canvas as unknown as HTMLCanvasElement,media,{...visual,renderTime:atMs},frame,portrait,820);return{canvas,numbers,ctx}}
const samples=[];const end=STANDBY_ENERGY_CYCLES[0].endMs;
for(const portrait of [false,true])for(let atMs=0;atMs<=end+100;atMs+=100){const old=render(oldPaint,atMs,portrait),current=render(paintTransparentScene,atMs,portrait);assert.deepEqual(current.numbers,old.numbers,`${portrait}/${atMs}`);if(!portrait){assert.deepEqual(current.ctx.getImageData(490,797,704,82).data,old.ctx.getImageData(490,797,704,82).data,`input surface ${atMs}`);assert.deepEqual(current.ctx.getImageData(1343,86,285,118).data,old.ctx.getImageData(1343,86,285,118).data,`trend geometry ${atMs}`)}samples.push({portrait,atMs,readouts:current.numbers});}
for(const [label,atMs] of [['peak',STANDBY_ENERGY_CYCLES[0].peakAtMs],['dwell',STANDBY_ENERGY_CYCLES[0].idleStartMs+200]] as const)for(const portrait of [false,true]){for(const [version,paint] of [['v46',oldPaint],['v48',paintTransparentScene]] as const){const result=render(paint,atMs,portrait);await writeFile(`${out}/${version}-${portrait?'portrait':'landscape'}-${label}.png`,result.canvas.toBuffer('image/png'))}}
assert.equal(JSON.stringify(snapshot),before);assert.equal(lesson.currentTime,0);
await writeFile(`${out}/same-state-comparison.json`,JSON.stringify({baseline:'6d5702502889e854ba493b923067fe58bae1fefd',kind:'actual old/current renderer program comparison, not browser',cycleEndMs:end,samples,checks:['same numeric readouts each100ms through full first cycle +100ms, desktop andportrait','desktop actual input glass/button pixels identical','desktop trend geometry pixels identical','facts and media time unchanged'],limits:['text explanation differences intentional','not full-frame pixel equality','not browser FPS']},null,2));console.log(`Compared ${samples.length} exact-clock samples, original readouts and selected pixels match.`);
