import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,GlobalFonts} from '@napi-rs/canvas';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {TrainingEngine} from '../core/training';
import {paintTransparentScene,type TransparentSceneFrame} from './transparent-renderer';
import {responsiveLayout as baseResponsiveLayout,PORTRAIT_MIN_HEIGHT} from './responsive-layout';
import {applyInputCardLayout,inputFeedbackLines} from './input-card';
import {learningGeometry} from './learning-surface';
import {translate} from '../i18n/locale';
const responsiveLayout=(...args:Parameters<typeof baseResponsiveLayout>)=>applyInputCardLayout(baseResponsiveLayout(...args));
import type {SceneMedia,SceneVisual} from './renderer';

for(const [file,family] of [['studio-sans-regular.woff','Lingo Studio Sans'],['studio-sans-bold.woff','Lingo Studio Sans'],['studio-semibold.woff','Lingo Studio Semibold'],['studio-mono-regular.woff','Lingo Studio Mono']]){
 assert.ok(GlobalFonts.registerFromPath(fileURLToPath(new URL(`../../public/studio-assets/fonts/${file}`,import.meta.url)),family));
}

const cjkFont='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';
if(existsSync(cjkFont))assert.ok(GlobalFonts.registerFromPath(cjkFont,'Microsoft YaHei'));

const media={lesson:{readyState:0,paused:true,duration:72},camera:{readyState:0},poster:{complete:false},image:{complete:false},reference:{complete:false},kind:'demo',name:'live scene test'} as unknown as SceneMedia;
function state(){
 const engine=new TrainingEngine();
 const visual:SceneVisual={layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:false,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:'',inputFocused:false,composition:false,caret:0,selectionEnd:0,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,playbackTime:0,playbackDuration:72,renderTime:1200,snapshot:engine.getSnapshot()};
 const frame:TransparentSceneFrame={input:{commits10s:0,energy:0,latestRate:null,observedMs:0,frozen:true,points:[],pulses:[]},enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:1000,replay:false,pageInputStarted:false};
 return {engine,visual,frame};
}
function render(visual:SceneVisual,frame:TransparentSceneFrame,portrait=true,pixelScale=1,portraitHeight=1080,sceneMedia:SceneMedia=media){
 const g=responsiveLayout(portrait,visual.arrangement,visual.layout,portraitHeight),canvas=createCanvas(g.width*pixelScale,g.height*pixelScale),context=canvas.getContext('2d'),original=context.fillText.bind(context);
 const labels:{text:string;x:number;centerY:number;scale:number;size:number;left:number;right:number;top:number;bottom:number}[]=[],dots:{x:number;y:number;radius:number;alpha:number}[]=[],backdrops:{width:number;height:number;args:unknown[];transform:number[]}[]=[];
 context.fillText=((text:string,x:number,y:number,max?:number)=>{
  const t=context.getTransform(),box=context.measureText(text),size=Number(context.font.match(/([\d.]+)px/)?.[1]);
  labels.push({text,x:(t.a*x+t.c*y+t.e)/pixelScale,centerY:(t.b*x+t.d*(y-(box.actualBoundingBoxAscent-box.actualBoundingBoxDescent)/2)+t.f)/pixelScale,scale:t.a/pixelScale,size:size*t.a/pixelScale,left:(t.a*(x-box.actualBoundingBoxLeft)+t.e)/pixelScale,right:(t.a*(x+box.actualBoundingBoxRight)+t.e)/pixelScale,top:(t.d*(y-box.actualBoundingBoxAscent)+t.f)/pixelScale,bottom:(t.d*(y+box.actualBoundingBoxDescent)+t.f)/pixelScale});
  original(text,x,y,max);
 }) as typeof context.fillText;
 const arc=context.arc.bind(context);context.arc=((x:number,y:number,radius:number,...args:Parameters<typeof context.arc> extends [number,number,number,...infer R]?R:never)=>{const t=context.getTransform();if(radius===1.1)dots.push({x:(t.a*x+t.e)/pixelScale,y:(t.d*y+t.f)/pixelScale,radius:radius*t.a/pixelScale,alpha:context.globalAlpha});arc(x,y,radius,...args)}) as typeof context.arc;
 const drawImage=context.drawImage.bind(context);context.drawImage=((source:{width:number;height:number},...args:unknown[])=>{const t=context.getTransform();backdrops.push({width:source.width,height:source.height,args,transform:[t.a,t.b,t.c,t.d,t.e,t.f]});Reflect.apply(drawImage,context,[source,...args])}) as typeof context.drawImage;
 const mode=paintTransparentScene(canvas as unknown as HTMLCanvasElement,sceneMedia,visual,frame,portrait,portraitHeight);
 const dimensions={width:canvas.width,height:canvas.height},png=canvas.toBuffer('image/png');
 // Native Canvas backing stores are outside V8's heap; release each fixture's
 // raster after capturing its proof to bound the many-size regression suite.
 canvas.width=1;canvas.height=1;
 return{canvas:dimensions,mode,labels,dots,backdrops,png};
}
test('portrait paints the same live Canvas engine deterministically and preserves source facts',()=>{
 const {visual,frame}=state(),before=JSON.stringify({visual,frame}),first=render(visual,frame),second=render(visual,frame);
 assert.equal(first.canvas.width,430);assert.equal(first.canvas.height,responsiveLayout(true).height);assert.equal(first.mode,'standby');
 assert.deepEqual(first.png,second.png);assert.equal(JSON.stringify({visual,frame}),before);
 assert.equal(first.labels.filter(label=>label.text==='STANDBY').length,1);
 assert.ok(first.labels.some(label=>/^\d+%$/.test(label.text)));assert.ok(first.labels.some(label=>/^\d+ \/ 24$/.test(label.text)));assert.ok(!first.labels.some(label=>label.text.includes('尚未统计')));
});
test('portrait clock drives original standby animation and reduced motion freezes decorative pixels',()=>{
 const {visual,frame}=state();
 assert.notDeepEqual(render(visual,frame).png,render({...visual,renderTime:2900},frame).png);
 assert.deepEqual(render({...visual,reducedMotion:true},frame).png,render({...visual,reducedMotion:true,renderTime:2900},frame).png);
 assert.equal(visual.snapshot!.earnedWords,0);assert.equal(frame.input.commits10s,0);
 const early=render({...visual,reducedMotion:true},{...frame,standbyPaused:true});
 const late=render({...visual,reducedMotion:true,renderTime:8000},{...frame,standbyPaused:true});
 assert.deepEqual(early.png,late.png);
});
test('portrait split and camera modes change the existing media layout without changing training facts',()=>{
 const {visual,frame}=state(),before=JSON.stringify(visual.snapshot),lesson=render(visual,frame),split=render({...visual,layout:'split'},frame),camera=render({...visual,layout:'camera'},frame);
 assert.notDeepEqual(lesson.png,split.png);assert.notDeepEqual(lesson.png,camera.png);
 assert.equal(lesson.mode,split.mode);assert.equal(lesson.mode,camera.mode);
 assert.equal(JSON.stringify(visual.snapshot),before);
});
test('real input leaves standby, real judgment changes feedback, and replay excludes future live input',()=>{
 const {engine,visual,frame}=state();engine.input(engine.cue.text);engine.submit();
 const live={...visual,snapshot:engine.getSnapshot(),draft:engine.draft,showSubtitle:true},liveFrame={...frame,pageInputStarted:true,input:{...frame.input,commits10s:7,points:[{atMs:1000,value:3}],frozen:false}};
 const current=render(live,liveFrame);
 assert.equal(current.mode,'live');assert.ok(!current.labels.some(label=>label.text==='STANDBY'));assert.ok(current.labels.some(label=>label.text==='25%'));assert.ok(current.labels.some(label=>label.text==='Next →'));
 const rewarded=render({...live,rewardAttemptId:engine.currentResult!.attemptId,rewardAt:live.renderTime-100},liveFrame),reward=rewarded.labels.find(label=>label.text==='+6 words confirmed'),g=responsiveLayout(true);
 assert.ok(reward);assert.ok(reward.left>=g.inputCard.status.x&&reward.right<=g.inputCard.status.x+g.inputCard.status.w);assert.ok(reward.centerY>g.inputCard.status.y);assert.ok(reward.centerY<g.inputCard.status.y+g.inputCard.status.h);
 const replay={...liveFrame,replay:true};
 assert.deepEqual(render(live,replay).png,render({...live,scrollLeft:80,inputFocused:true,caret:3,selectionEnd:8,rewardAttemptId:'future'}, {...replay,input:{...liveFrame.input,commits10s:99,points:[{atMs:1000,value:100}]}}).png);
 assert.equal(render(live,replay).mode,'replay');
});
test('portrait multiline text and below-input action use the shared card geometry at recording resolution',()=>{
 const {visual,frame}=state(),g=responsiveLayout(true),draft={...visual,draft:'Could I',inputFocused:true,caret:5,selectionEnd:5};
 for(const pixelScale of [1,2]){
  const original=render(draft,frame,true,pixelScale),scrolled=render({...draft,scrollLeft:48},frame,true,pixelScale);
  const glyph=original.labels.find(label=>label.text==='Could I')!,moved=scrolled.labels.find(label=>label.text==='Could I')!;
  assert.ok(glyph);assert.ok(Math.abs(glyph.scale-1)<1e-6);
  assert.ok(Math.abs(glyph.x-(g.zones.input.x+g.inputCard.paddingX))<1e-4);
  assert.ok(Math.abs(glyph.x-moved.x-48)<1e-4);
  const empty=render(visual,frame,true,pixelScale),placeholder=empty.labels.find(item=>item.text==='Hidden · Show')!,confirm=empty.labels.find(item=>item.text==='Check ↵')!;
  assert.ok(placeholder.centerY>g.inputCard.card.y&&placeholder.centerY<g.zones.input.y);
  assert.ok(Math.abs(confirm.centerY-(g.zones.submit.y+g.zones.submit.h/2))<.01);
  assert.ok(g.zones.submit.y>=g.zones.input.y+g.zones.input.h);
 }
});
test('portrait text labels stay legible and timeline remains fully on the recording surface',()=>{
 const {visual,frame}=state();
 for(const height of [PORTRAIT_MIN_HEIGHT,840,880,940,1080,1400]){
 const result=render(visual,{...frame,pageInputStarted:true},true,1,height),g=responsiveLayout(true,{},'lesson',height);
 for(const label of result.labels){assert.ok(label.centerY>=0&&label.centerY<g.height,label.text);assert.ok(label.size>=9.999,label.text)}
 for(const text of ['Hidden · Show','Check ↵'])assert.ok(result.labels.find(label=>label.text===text)!.size>=11.999,text);
 assert.ok(!result.labels.some(label=>label.text==='OFF'),'collapsed camera has no large OFF label');
 if(g.practiceCompact){
  assert.ok(!result.labels.some(label=>label.text==='PRACTICE TARGET'));
  assert.ok(!result.labels.some(label=>/^\d+%$/.test(label.text)),'no fake standby percent on one-screen');
 }else{
  for(const text of ['PRACTICE TARGET','INPUT TREND','INPUT FLOW'])assert.ok(result.labels.find(label=>label.text===text)!.size>=11.999,text);
  const goalTitle=result.labels.find(label=>label.text===('PRACTICE TARGET'))!;
  assert.ok(goalTitle.left>=g.goal.x&&goalTitle.right<=g.goal.x+g.goal.w);assert.ok(goalTitle.top>=g.goal.y);
  const trendTitle=result.labels.find(label=>label.text==='INPUT TREND')!,trendUnit=result.labels.find(label=>label.text==='GRAPHEMES / SECOND')!;
  assert.ok(trendTitle.bottom<trendUnit.top);assert.ok(trendUnit.bottom<g.trend.y+(104-40)*(g.trend.w/352));
  assert.ok(trendTitle.left>=g.trend.x&&trendTitle.right<=g.trend.x+g.trend.w);
  assert.ok(trendUnit.left>=g.trend.x&&trendUnit.right<=g.trend.x+g.trend.w);
 }
 for(let i=1;i<=12;i++){
  const label=result.labels.find(item=>item.text===String(i).padStart(2,'0')&&item.centerY>g.zones.seek.y);assert.ok(label);
  const target=g.cueMarker((i-1)/12);assert.ok(label.x>=target.x&&label.x<=target.x+target.w);
 }
 }
});
test('portrait preserves every reference using at most two readable lines inside the subtitle frame',()=>{
 const {visual,frame}=state();
 for(const height of [PORTRAIT_MIN_HEIGHT,880,940,1080]){
 const g=responsiveLayout(true,{},'lesson',height);
 for(let cueIndex=0;cueIndex<visual.snapshot!.material.cues.length;cueIndex++){
  const snapshot={...visual.snapshot!,cueIndex},result=render({...visual,snapshot,showSubtitle:true},frame,true,1,height),cue=snapshot.material.cues[cueIndex].text;
  const lines=result.labels.filter(label=>label.x>g.subtitle.x&&label.x<g.subtitle.x+g.subtitle.w&&label.centerY>=g.subtitle.y&&label.centerY<=g.subtitle.y+g.subtitle.h);
  assert.ok(lines.length>=1&&lines.length<=2,cue);assert.equal(lines.map(line=>line.text).join(' '),cue);
  for(const line of lines){assert.ok(line.size>=9.999);assert.ok(line.left>=g.subtitle.x&&line.right<=g.subtitle.x+g.subtitle.w,cue);assert.ok(line.top>=g.subtitle.y&&line.bottom<=g.subtitle.y+g.subtitle.h,cue)}
  if(lines.length===2)assert.ok(lines[0].bottom<lines[1].top,cue);
 }
 }
});
test('live event labels and trend units fit their compact panels without sharing a text row',()=>{
 const {visual,frame}=state();
 for(const height of [PORTRAIT_MIN_HEIGHT,880,940,1080]){
 const g=responsiveLayout(true,{},'lesson',height);
 for(const commits10s of [0,9,99,999,1000,123456]){
  const result=render(visual,{...frame,pageInputStarted:true,input:{...frame.input,commits10s}},true,1,height);
  if(g.practiceCompact){
   assert.ok(!result.labels.some(label=>label.text==='INPUT TREND'));
   assert.ok(!result.labels.some(label=>['COMMITTED EVENTS','/ 10s','EVENTS / 10s'].includes(label.text)));
   continue;
  }
  const unit=result.labels.find(label=>label.text==='GRAPHEMES / SECOND')!,title=result.labels.find(label=>label.text==='INPUT TREND')!;
  assert.ok(title.bottom<unit.top);assert.ok(unit.left>=g.trend.x&&unit.right<=g.trend.x+g.trend.w);
  const flowLabels=result.labels.filter(label=>['COMMITTED EVENTS','/ 10s','EVENTS / 10s'].includes(label.text));
  assert.equal(flowLabels.length,String(commits10s).length<=3?2:1);
  for(const label of flowLabels){assert.ok(label.size>=9.999);assert.ok(label.left>=g.metrics.x&&label.right<=g.metrics.x+g.metrics.w,label.text);assert.ok(label.bottom<g.metrics.y+92*(g.metrics.w/309),label.text)}
  if(flowLabels.length===2)assert.ok(flowLabels[0].bottom<flowLabels[1].top);
 }
 }
});
test('portrait retains original breathing drafting marks at restored anchors without changing state',()=>{
 const {visual,frame}=state(),g=responsiveLayout(true),first=render(visual,frame),later=render({...visual,renderTime:2900},frame);
 assert.equal(first.dots.length,8);assert.deepEqual(first.dots.map(({x,y,radius})=>({x,y,radius})),later.dots.map(({x,y,radius})=>({x,y,radius})));
 assert.notEqual(first.dots[0].alpha,later.dots[0].alpha);
 assert.ok(Math.abs(first.dots[0].x-(g.goal.x+(45-32)*.58))<.001);assert.ok(Math.abs(first.dots[0].y-(g.goal.y+(24-54)*.58))<.001);
 assert.ok(Math.abs(first.dots.at(-1)!.x-(g.counter.x+68*.58))<.001);assert.ok(Math.abs(first.dots.at(-1)!.y-g.counter.y)<.001);
 assert.deepEqual(render({...visual,reducedMotion:true},frame).dots,render({...visual,reducedMotion:true,renderTime:2900},frame).dots);
});
test('portrait empty typing and hidden subtitles create no glass panel at any recording scale',()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'OffscreenCanvas');
 Object.defineProperty(globalThis,'OffscreenCanvas',{configurable:true,value:class{constructor(width:number,height:number){return createCanvas(width,height)}}});
 try{
  const {visual,frame}=state();
  for(const height of [PORTRAIT_MIN_HEIGHT,840,880,940,1080,1400])for(const scale of [1,2]){
   const {backdrops}=render(visual,frame,true,scale,height);
   assert.equal(backdrops.length,0,'v77 removes the inactive subtitle glass and keeps typing borderless');
   for(const backdrop of backdrops){assert.equal(backdrop.width,215);assert.equal(backdrop.height,Math.ceil(responsiveLayout(true,{},'lesson',height).height/2));assert.deepEqual(backdrop.transform,[1,0,0,1,0,0]);assert.deepEqual(backdrop.args,[0,0,430*scale,responsiveLayout(true,{},'lesson',height).height*scale])}
  }
 }finally{if(previous)Object.defineProperty(globalThis,'OffscreenCanvas',previous);else Reflect.deleteProperty(globalThis,'OffscreenCanvas')}
});
test('switching portrait and recording sizes cannot leak geometry or text settings into desktop frames',()=>{
 const {visual,frame}=state(),before=render(visual,frame,false).png;
 render(visual,frame);render({...visual,draft:'A later frame'},frame,true,2);
 assert.deepEqual(render(visual,frame,false).png,before);
 const desktop=responsiveLayout(false),canvas=createCanvas(desktop.width,desktop.height);paintTransparentScene(canvas as unknown as HTMLCanvasElement,media,visual,frame);
 assert.deepEqual(canvas.toBuffer('image/png'),before);
});

test('compact camera PiP renders its real buffer and keeps the recording label inside the complete inset',()=>{
 const {visual,frame}=state(),camera=createCanvas(320,180);
 Object.assign(camera,{readyState:2,videoWidth:320,videoHeight:180});
 const c=camera.getContext('2d');c.fillStyle='#57c9bb';c.fillRect(0,0,320,180);
 const sceneMedia={...media,camera} as unknown as SceneMedia;
 const view={...visual,camera:'on' as const,recording:true,recordingStarted:0};
 for(const height of [PORTRAIT_MIN_HEIGHT,880,940]){
  const result=render(view,frame,true,1,height,sceneMedia),g=responsiveLayout(true,{},'lesson',height);
  const cameraDraw=result.backdrops.find(item=>item.width===320&&item.height===180);
  assert.ok(cameraDraw);assert.ok(Math.abs(cameraDraw.transform[0]-.58)<1e-6);assert.ok(Math.abs(cameraDraw.transform[3]-.58)<1e-6);
  const recording=result.labels.find(label=>label.text==='● REC 00:01');assert.ok(recording);
  assert.ok(recording.left>=g.inset.x&&recording.right<=g.inset.x+g.inset.w);
  assert.ok(recording.top>=g.inset.y&&recording.bottom<=g.inset.y+g.inset.h);
  assert.ok(g.inset.y+g.inset.h<g.media.y+g.media.h);
 }
});

test('scaled desktop player labels and markers follow shifted DOM zones below the stacked keyboard',()=>{
 const {visual,frame}=state(),view={...visual,cameraViewport:{width:692,height:390}},g=applyInputCardLayout(baseResponsiveLayout(false),{cssScale:692/1672}),canvas=createCanvas(g.width,g.height),c=canvas.getContext('2d'),labels:{text:string;x:number;y:number}[]=[];
 const fill=c.fillText.bind(c);c.fillText=(text:string,x:number,y:number,...args:any[])=>{labels.push({text,x,y});return Reflect.apply(fill,c,[text,x,y,...args])};
 paintTransparentScene(canvas as unknown as HTMLCanvasElement,media,view,frame,false);
 const time=labels.find(label=>label.text==='00:00 / 01:12');assert.ok(time);assert.equal(time.y,g.zones.seek.y+12/(692/1672));assert.ok(time.y>g.inputCard.keyboard!.y+g.inputCard.keyboard!.h);
 for(let i=1;i<=12;i++){const marker=labels.find(label=>label.text===String(i).padStart(2,'0')&&label.y===g.zones.seek.y+45/(692/1672));assert.ok(marker)}
});

test('extended desktop typing has no old glass backdrop in either keyboard state',()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'OffscreenCanvas');Object.defineProperty(globalThis,'OffscreenCanvas',{configurable:true,value:class{constructor(w:number,h:number){return createCanvas(w,h)}}});
 try{for(const visible of[true,false]){const{visual,frame}=state(),g=applyInputCardLayout(baseResponsiveLayout(false),{cssScale:.414,keyboardVisible:visible});visual.cameraViewport={width:1672*.414,height:g.height*.414};visual.keyboardFeedback={visible,codes:[],committedUntil:0,composing:false};const canvas=createCanvas(1672,g.height),ctx=canvas.getContext('2d'),original=ctx.drawImage.bind(ctx),calls:{args:unknown[];transform:number[]}[]=[];ctx.drawImage=((image:any,...args:any[])=>{if(image.width===836){const t=ctx.getTransform();calls.push({args,transform:[t.a,t.b,t.c,t.d,t.e,t.f]})}(original as any)(image,...args)})as typeof ctx.drawImage;paintTransparentScene(canvas as unknown as HTMLCanvasElement,media,visual,frame,false);assert.equal(calls.length,0);for(const call of calls){assert.deepEqual(call.args,[0,0,canvas.width,canvas.height]);assert.deepEqual(call.transform,[1,0,0,1,0,0])}}}finally{if(previous)Object.defineProperty(globalThis,'OffscreenCanvas',previous);else Reflect.deleteProperty(globalThis,'OffscreenCanvas')}
});


test('transient reward shares the bounded status line without overlapping reference or hiding errors',()=>{
 for(const portrait of[false,true])for(const cssWidth of portrait?[300,430]:[560,640,1280])for(const locale of['en','zh-CN'] as const)for(const wrong of[false,true]){
  const {engine,visual,frame}=state();engine.input(wrong?engine.cue.text.replace('coffee','tea'):engine.cue.text);engine.submit();
  const attempt=engine.currentResult!,v={...visual,locale,snapshot:engine.getSnapshot(),draft:engine.draft,referenceGuide:engine.cue.text,rewardAttemptId:attempt.attemptId,rewardAt:visual.renderTime-100,cameraViewport:{width:cssWidth,height:900}},g=learningGeometry(baseResponsiveLayout(portrait),{keyboardVisible:true,cssWidth});
  const canvas=createCanvas(g.width,g.height),ctx=canvas.getContext('2d'),fill=ctx.fillText.bind(ctx),labels:{text:string;left:number;right:number;top:number;bottom:number}[]=[];
  ctx.fillText=((text:string,x:number,y:number,max?:number)=>{const box=ctx.measureText(text);labels.push({text,left:x-box.actualBoundingBoxLeft,right:x+box.actualBoundingBoxRight,top:y-box.actualBoundingBoxAscent,bottom:y+box.actualBoundingBoxDescent});fill(text,x,y,max)})as typeof ctx.fillText;
  paintTransparentScene(canvas as unknown as HTMLCanvasElement,media,v,{...frame,pageInputStarted:true},portrait);
  const reference=labels.find(l=>l.text===translate(locale,'scene.referenceActionCompact'));assert.ok(reference);
  const first=labels.find(l=>l.top>=g.inputCard.status.y&&inputFeedbackLines(attempt,locale)[0].startsWith(l.text)&&l.text.length>2);assert.ok(first,`${portrait}/${cssWidth}/${locale}/${wrong}`);
  const prefix=wrong?inputFeedbackLines(attempt,locale)[1]:translate(locale,'scene.confirmedGain',{count:attempt.gain});
  const second=labels.find(l=>l.top>=g.inputCard.status.y&&prefix.startsWith(l.text.split(' · ')[0])&&l.text.length>2);assert.ok(second,`${portrait}/${cssWidth}/${locale}/${wrong}`);
  assert.ok(second.left>=g.inputCard.status.x-1&&second.right<=g.inputCard.status.x+g.inputCard.status.w+1);
  assert.ok(second.top>=g.inputCard.status.y&&second.bottom<=g.inputCard.status.y+g.inputCard.status.h+1);
  assert.ok(second.top>first.bottom&&second.top>reference.bottom);
  if(wrong)assert.ok(second.text.startsWith(translate(locale,'hud.wrong')));
  canvas.width=1;canvas.height=1;
 }
});
