/** Development evidence only: actual scene render, not browser or device recording. */
import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {paintTransparentScene} from '../studio/scene/transparent-renderer';
import {STANDBY_ENERGY_CYCLES,sampleStandbyEnergy} from '../studio/scene/standby-energy';
import {TrainingEngine} from '../studio/core/training';
import type {SceneVisual,SceneMedia} from '../studio/scene/renderer';
for(const suffix of ['Regular','Bold','Italic','BoldItalic']){GlobalFonts.registerFromPath(`/usr/share/fonts/truetype/liberation/LiberationSans-${suffix}.ttf`,'Arial');GlobalFonts.registerFromPath(`/usr/share/fonts/truetype/liberation/LiberationMono-${suffix}.ttf`,'Courier New')}
GlobalFonts.registerFromPath('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','Microsoft YaHei');
for(const name of ['studio-sans-regular','studio-sans-bold','studio-mono-regular','studio-semibold'])GlobalFonts.registerFromPath(`public/studio-assets/fonts/${name}.woff`);
const out=process.argv[2];if(!out)throw Error('Pass an output directory');await mkdir(out,{recursive:true});
const poster=await loadImage('public/studio-assets/06-cafe-poster.jpg');Object.defineProperty(poster,'naturalWidth',{value:poster.width});Object.defineProperty(poster,'naturalHeight',{value:poster.height});
const lesson={readyState:0,paused:true,duration:72,currentTime:0},media={lesson,camera:lesson,poster,image:poster,reference:poster,kind:'demo',name:'原创素材'} as unknown as SceneMedia;
const snapshot=new TrainingEngine().getSnapshot(),before=JSON.stringify(snapshot);
const base:SceneVisual={layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:false,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:'',inputFocused:false,composition:false,caret:0,selectionEnd:0,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,playbackTime:0,playbackDuration:72,renderTime:0,snapshot};
const frame={input:{commits10s:0,energy:0,latestRate:null,observedMs:0,frozen:true,points:[],pulses:[]},enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:Date.UTC(2026,9,8),replay:false,pageInputStarted:false};
const cycle=STANDBY_ENERGY_CYCLES[0];const moments=[['charge',140],['attack',cycle.attackStartMs+cycle.attackMs*.8],['peak',cycle.peakAtMs],['decay',cycle.peakAtMs+480],['dwell',cycle.idleStartMs+250]] as const;
for(const [name,now] of moments)for(const [w,h] of [[1672,941],[1920,1080]]){const canvas=createCanvas(w,h);paintTransparentScene(canvas as unknown as HTMLCanvasElement,media,{...base,renderTime:now},frame);await writeFile(`${out}/${name}-${w}x${h}-program-render.png`,canvas.toBuffer('image/png'))}
const canvas=createCanvas(1280,720),fps=60,seconds=10;
const encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgba','-video_size','1280x720','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart',`${out}/v27-continuous-traces-program-render.mp4`],{stdio:['pipe','ignore','pipe']});
let errors='';encoder.stderr.setEncoding('utf8');encoder.stderr.on('data',text=>errors+=text);const finished=once(encoder,'close');
for(let index=0;index<fps*seconds;index++){paintTransparentScene(canvas as unknown as HTMLCanvasElement,media,{...base,renderTime:index*1000/fps},frame);const pixels=canvas.getContext('2d').getImageData(0,0,1280,720).data;if(!encoder.stdin.write(pixels))await once(encoder.stdin,'drain')}
encoder.stdin.end();const[code]=await finished;if(code!==0)throw Error(errors||`ffmpeg exited ${code}`);
if(JSON.stringify(snapshot)!==before||lesson.currentTime!==0)throw Error('Evidence render changed facts/media');
await writeFile(`${out}/MOTION-EVIDENCE.json`,JSON.stringify({kind:'Actual Canvas renderer program evidence, not browser/DOM/device recording',sound:'Silent; optional WebAudio must be verified in browser after user gesture',fps,seconds,firstCycle:cycle,moments:moments.map(([name,atMs])=>({name,atMs,energy:sampleStandbyEnergy(atMs,0)})),unchangedTrainingSnapshot:true,unchangedMediaTime:true},null,2));console.log('Rendered 10-second silent program clip plus 10 exact-size phase frames; facts and media time unchanged.');
