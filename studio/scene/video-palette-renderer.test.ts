import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {TrainingEngine} from '../core/training';
import {paintTransparentScene, type TransparentSceneFrame} from './transparent-renderer';
import type {SceneMedia, SceneVisual} from './renderer';
import {createVideoPalette, validateVideoPalette, videoPaletteLuminance} from './video-palette';

const palette = createVideoPalette({hue:210,saturation:.7,lightness:.5,luminance:.25});
function fixture() {
  const engine = new TrainingEngine();
  const video = createCanvas(96,54), context = video.getContext('2d');
  context.fillStyle='#e9dcc1';context.fillRect(0,0,96,54);
  Object.assign(video,{readyState:2,videoWidth:96,videoHeight:54,paused:true,duration:72});
  const media = {lesson:video,camera:{readyState:0},poster:{complete:false},image:{complete:false},reference:{complete:false},kind:'demo',name:'palette test'} as unknown as SceneMedia;
  const visual:SceneVisual = {layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:false,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:'',inputFocused:false,composition:false,caret:0,selectionEnd:0,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,playbackTime:0,playbackDuration:72,renderTime:1200,snapshot:engine.getSnapshot()};
  const frame:TransparentSceneFrame = {input:{commits10s:0,energy:0,latestRate:null,observedMs:0,frozen:true,points:[],pulses:[]},enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:1000,replay:false,pageInputStarted:false};
  return {engine,media,visual,frame};
}
function render(media:SceneMedia,visual:SceneVisual,frame:TransparentSceneFrame,portrait=false,height=1080) {
  const canvas=createCanvas(portrait?430:1672,portrait?height:941), context=canvas.getContext('2d');
  const original=context.fillText.bind(context), labels:unknown[]=[];
  context.fillText=((text:string,x:number,y:number,max?:number)=>{
    const t=context.getTransform();
    labels.push([text,x,y,max,context.font,context.fillStyle,context.textAlign,t.a,t.b,t.c,t.d,t.e,t.f]);
    original(text,x,y,max);
  }) as typeof context.fillText;
  const mode=paintTransparentScene(canvas as unknown as HTMLCanvasElement,media,visual,frame,portrait,height);
  return {png:canvas.toBuffer('image/png'),labels,mode};
}
test('missing/off/invalid palette retain exactly the same stage pixels',()=>{
  const {media,visual,frame}=fixture();
  for(const portrait of [false,true]) {
    const baseline=render(media,visual,frame,portrait).png;
    for(const value of [undefined,null,{}, {frame:'red'}, {...palette,glassTop:'#ffffff'}, {...palette,frame:'url(https://invalid.example)'}]) {
      assert.deepEqual(render(media,{...visual,palette:value as any},frame,portrait).png,baseline);
    }
  }
});
test('active palette changes only decorative pixels, retaining every text/color/coordinate and training fact',()=>{
  const {engine,media,visual,frame}=fixture();
  for(const submitted of [false,true]) {
    if(submitted){engine.input('Could I have tea please?');engine.submit();visual.snapshot=engine.getSnapshot();visual.draft=engine.draft;frame.pageInputStarted=true;}
    const before=JSON.stringify({visual,frame});
    for(const [portrait,height] of [[false,1080],[true,840],[true,1080],[true,1400]] as const) {
      const original=render(media,visual,frame,portrait,height), colored=render(media,{...visual,palette},frame,portrait,height);
      assert.notDeepEqual(colored.png,original.png);assert.deepEqual(colored.labels,original.labels);
      assert.equal(colored.mode,original.mode);
    }
    assert.equal(JSON.stringify({visual,frame}),before);
  }
});
test('palette-aware preview and recording use the same immutable scene and replay does not generate facts',()=>{
  const {engine,media,visual,frame}=fixture();engine.input(engine.cue.text);const attempt=engine.submit()!;
  const view={...visual,snapshot:engine.getSnapshot(),draft:engine.draft,palette,rewardAttemptId:attempt.attemptId,rewardAt:1100};
  const active={...frame,pageInputStarted:true}, before=JSON.stringify(view.snapshot);
  for(const portrait of [false,true]) {
    assert.deepEqual(render(media,view,active,portrait).png,render(media,view,active,portrait).png);
    const replay={...active,replay:true};
    assert.deepEqual(render(media,view,replay,portrait).png,render(media,{...view,rewardAttemptId:'other',gain:999},replay,portrait).png);
  }
  assert.equal(JSON.stringify(view.snapshot),before);
});
test('palette never changes the approved standby energy timing or reduced-motion rules',()=>{
  const {media,visual,frame}=fixture();const view={...visual,palette};
  assert.notDeepEqual(render(media,view,frame).png,render(media,{...view,renderTime:2900},frame).png);
  assert.deepEqual(render(media,{...view,reducedMotion:true},frame).png,render(media,{...view,reducedMotion:true,renderTime:2900},frame).png);
  assert.deepEqual(render(media,visual,frame).labels,render(media,view,frame).labels);
});
test('all accepted tinted glass slots keep white caption contrast above 4.5 on a worst-case white background',()=>{
  for(let hue=0;hue<360;hue+=5)for(const saturation of [0,.5,1])for(const lightness of [0,.5,1]) {
    const color=createVideoPalette({hue,saturation,lightness,luminance:lightness});assert.ok(validateVideoPalette(color));
    for(const [slot,alpha]of [[color.glassTop,220/255],[color.glassBottom,230/255]] as const) {
      const channels=[1,3,5].map(index=>parseInt(slot.slice(index,index+2),16)*alpha+255*(1-alpha));
      const background=videoPaletteLuminance(channels[0],channels[1],channels[2]);
      const foreground=videoPaletteLuminance(244,246,245);
      assert.ok((foreground+.05)/(background+.05)>=4.5,`${hue}/${saturation}/${lightness} ${slot}`);
    }
  }
});
