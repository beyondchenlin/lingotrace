import {applyInputCardLayout} from './input-card';
import {responsiveLayout} from './responsive-layout';
import test from 'node:test';import assert from 'node:assert/strict';import{createCanvas}from'@napi-rs/canvas';
import{PageInputGate}from'./transparent-presentation';import{TrainingEngine}from'../core/training';import{paintTransparentScene,transparentEntrance,type TransparentSceneFrame}from'./transparent-renderer';import type{SceneMedia,SceneVisual}from'./renderer';import{ZONES,CONSOLE_RECT,PLAYER_RECT,cueMarkerRect,timelinePointerProgress,DEFAULT_RECTS,constrainRect,keyboardRect,parseArrangement}from'./transparent-layout';
const media={lesson:{readyState:0,paused:true,duration:72},camera:{readyState:0},poster:{complete:false},image:{complete:false},reference:{complete:false},kind:'demo',name:'fixture'}as unknown as SceneMedia;
function state(){const snapshot=new TrainingEngine().getSnapshot();const v:SceneVisual={layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:false,camera:'off',recording:false,recordingStarted:null,recordingBytes:0,draft:'',inputFocused:false,composition:false,caret:0,selectionEnd:0,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,ready:true,playbackTime:0,playbackDuration:72,renderTime:1200,snapshot};const f:TransparentSceneFrame={input:{commits10s:0,energy:0,latestRate:null,observedMs:0,frozen:true,points:[],pulses:[]},enteredAt:0,mediaChangedAt:0,mediaLoading:false,wallNowMs:1000,replay:false,pageInputStarted:false};return{v,f}}
function paint(v:SceneVisual,f:TransparentSceneFrame){const c=createCanvas(1672,941);paintTransparentScene(c as unknown as HTMLCanvasElement,media,v,f);return c.toBuffer('image/png')}
test('transparent preview and recording frame are identical for the same explicit state/clock',()=>{const{v,f}=state(),before=JSON.stringify(v.snapshot);assert.deepEqual(paint(v,f),paint(v,f));assert.equal(JSON.stringify(v.snapshot),before)});
test('reduced motion removes decorative clock variation while preserving facts',()=>{const{v,f}=state();v.reducedMotion=true;assert.deepEqual(paint(v,f),paint({...v,renderTime:2300},f));assert.equal(v.snapshot!.earnedWords,0)});
test('idle breathing changes artwork pixels without changing input or achievement data',()=>{const{v,f}=state();assert.notDeepEqual(paint(v,f),paint({...v,renderTime:2900},f));assert.deepEqual(f.input.points,[]);assert.equal(f.input.commits10s,0);assert.equal(v.snapshot!.earnedWords,0)});
test('media HUD exit/entrance is bounded and reduced motion is immediate',()=>{assert.equal(transparentEntrance(720,0,0,false,false),1);assert.ok(transparentEntrance(220,0,0,true,false)<.4);assert.equal(transparentEntrance(0,0,0,true,true),1)});
test('compact input and player hit zones are separate and inside both desktop projections',()=>{for(const scale of[1,1920/1672]){for(const key of['input','submit','play','seek','mute','previous','next']as const){const r=ZONES[key];assert.ok(r.x>=0&&r.y>=0&&(r.x+r.w)*scale<=1672*scale&&(r.y+r.h)*scale<=941*scale)}const overlap=(a:typeof ZONES.input,b:typeof ZONES.input)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));assert.equal(overlap(ZONES.input,ZONES.submit),0);assert.equal(overlap(ZONES.seek,ZONES.mute),0);assert.equal(overlap(ZONES.play,ZONES.seek),0)}});
test('transparent layout parsing and keyboard moves keep movable HUD clear of the fixed console',()=>{for(const key of['inset','subtitle','metrics']as const){const moved=constrainRect(key,{...DEFAULT_RECTS[key],y:900});assert.ok(moved.y+moved.h<=724);assert.ok(keyboardRect(key,moved,'ArrowDown')!.y+moved.h<=724)}assert.deepEqual(parseArrangement({inset:{x:NaN,y:1,w:10,h:10}}),{});assert.deepEqual(parseArrangement({}),{})});
test('replay never paints future live metrics, selection, reward or horizontal scroll over the selected history',()=>{const{v,f}=state();const replay={...f,replay:true},historical={...v,draft:'Could I',inputFocused:false};const future={...historical,scrollLeft:550,caret:3,selectionEnd:29,inputFocused:true,gain:6,rewardAt:1000,rewardAttemptId:'future'};const live={...replay,input:{...f.input,commits10s:30,energy:1,points:[{atMs:1000,value:15}],pulses:[{eventId:'future',atMs:1100,ageMs:100,added:12,source:'typed' as const,strength:1}]}};assert.deepEqual(paint(historical,replay),paint(future,live))});
test('player is below the same-width input and visual controls keep generous hit areas',()=>{for(const height of[941,1080]){const scale=height/941;assert.equal(CONSOLE_RECT.x*scale,PLAYER_RECT.x*scale);assert.equal(CONSOLE_RECT.w*scale,PLAYER_RECT.w*scale);assert.ok(PLAYER_RECT.y>CONSOLE_RECT.y+CONSOLE_RECT.h);for(const key of['play','previous','next','mute']as const){const r=ZONES[key];assert.equal((r.y+r.h/2)*scale,912*scale);assert.ok(r.w>=44&&r.h>=44)}assert.equal(ZONES.input.y+ZONES.input.h/2,ZONES.submit.y+ZONES.submit.h/2)}});
function captureLabels(v:SceneVisual,f:TransparentSceneFrame){const canvas=createCanvas(1672,941),ctx=canvas.getContext('2d'),original=ctx.fillText.bind(ctx),labels:{text:string;center:number}[]=[];ctx.fillText=((text:string,x:number,y:number,maxWidth?:number)=>{const m=ctx.measureText(text);labels.push({text,center:y-(m.actualBoundingBoxAscent-m.actualBoundingBoxDescent)/2});original(text,x,y,maxWidth)})as typeof ctx.fillText;const mode=paintTransparentScene(canvas as unknown as HTMLCanvasElement,media,v,f);return{mode,labels}}
test('standby labels are part of the recorded Canvas and do not mutate achievements',()=>{const{v,f}=state();v.recording=true;v.recordingStarted=0;const before=JSON.stringify(v.snapshot),result=captureLabels(v,f);assert.equal(result.mode,'standby');assert.equal(result.labels.filter(x=>x.text==='STANDBY').length,1);assert.ok(result.labels.some(x=>/^\d+%$/.test(x.text)));assert.ok(result.labels.some(x=>/^\d+ \/ 24$/.test(x.text)));assert.ok(!result.labels.some(x=>x.text.includes('尚未统计')));assert.ok(result.labels.some(x=>x.text.startsWith('● REC')));assert.ok(!result.labels.some(x=>x.text.includes('演示')));assert.equal(JSON.stringify(v.snapshot),before)});
test('renderer switches on a new changed input before Confirm and clearing never returns standby',()=>{const{v,f}=state(),e=new TrainingEngine(),gate=new PageInputGate();gate.begin(e.getSnapshot());e.input('x');gate.observe(e.getSnapshot());let result=captureLabels({...v,snapshot:e.getSnapshot(),draft:'x'},{...f,pageInputStarted:gate.started});assert.equal(result.mode,'live');assert.ok(!result.labels.some(x=>x.text==='STANDBY'));assert.ok(result.labels.some(x=>x.text==='0%'));assert.equal(e.getSnapshot().attempts.length,0);e.input('');gate.observe(e.getSnapshot());result=captureLabels({...v,snapshot:e.getSnapshot(),draft:''},{...f,pageInputStarted:gate.started});assert.equal(result.mode,'live')});
test('restored history begins standby while keeping actual draft and achievement facts intact',()=>{const{v,f}=state(),e=new TrainingEngine();e.input(e.cue.text);e.submit();const before=JSON.stringify(e.getSnapshot()),result=captureLabels({...v,snapshot:e.getSnapshot(),draft:e.draft},{...f,restored:true});assert.equal(result.mode,'standby');assert.ok(result.labels.some(x=>x.text==='STANDBY'));assert.ok(result.labels.some(x=>/^\d+ \/ 24$/.test(x.text)));assert.equal(JSON.stringify(e.getSnapshot()),before);assert.ok(e.getSnapshot().earnedWords>0)});
test('restore failure remains visible and never fabricates replacement standby numbers',()=>{const{v,f}=state(),result=captureLabels(v,{...f,restoreFailed:true});assert.equal(result.mode,'waiting');assert.ok(result.labels.some(x=>x.text==='Local records could not be restored. Retry recovery; historical totals are unavailable.'));assert.ok(result.labels.some(x=>x.text==='Recovery failed'));assert.ok(!result.labels.some(x=>x.text.includes('待机动效')))});
test('quiet empty-input cue replaces the placeholder while check remains a bare glyph hit below the draft',()=>{const{v,f}=state(),result=captureLabels(v,f),placeholder=result.labels.find(x=>x.text==='Hidden · Show');assert.ok(placeholder);const card=applyInputCardLayout(responsiveLayout(false)).inputCard;assert.ok(placeholder.center>card.card.y&&placeholder.center<card.input.y);assert.ok(!result.labels.some(x=>/写下你听到|先听一句|Enter 检查|Check ↵/.test(x.text)));assert.ok(card.submit.y>card.input.y+card.input.h);assert.ok(Math.min(card.submit.w,card.submit.h)>=44-1e-6)});
test('standby timeline animates pixels without changing media time or snapshot, and interaction selects real playhead',()=>{const{v,f}=state(),lesson=media.lesson;Object.defineProperty(lesson,'currentTime',{get:()=>7,set:()=>{throw Error('renderer must never seek')},configurable:true});const before=JSON.stringify(v.snapshot),a=paint({...v,renderTime:1800},f),b=paint({...v,renderTime:2700},f);assert.notDeepEqual(a,b);assert.equal(lesson.currentTime,7);assert.equal(JSON.stringify(v.snapshot),before);const result=captureLabels(v,{...f,mediaInteracted:true});assert.ok(!result.labels.some(x=>x.text==='待机光点 · 不自动播放'));assert.ok(!result.labels.some(x=>x.text.includes('Space 播放')))});

test('all twelve cue hit boxes stay visible at 1672 and 1920, and pointer seek matches rail bounds',()=>{for(const width of[1672,1920]){const scale=width/1672;for(let i=0;i<12;i++){const r=cueMarkerRect(i/12);assert.ok(r.y*scale>=0&&(r.y+r.h)*scale<=941*scale);assert.ok(r.x*scale>=0&&(r.x+r.w)*scale<=width);assert.ok(r.w>=38&&r.h>=44)}const left=ZONES.seek.x+20,right=ZONES.seek.x+ZONES.seek.w-20;assert.equal(timelinePointerProgress(left*scale,0,width),0);assert.equal(timelinePointerProgress(right*scale,0,width),1);assert.ok(Math.abs(timelinePointerProgress((left+right)/2*scale,0,width)-.5)<1e-12)}});

test('B automatic text paints visual reference without changing the real draft or observed input/score facts',()=>{
 const{v,f}=state(),e=new TrainingEngine();e.input('real private draft');e.setFrozen('listening',true);
 v.snapshot=e.getSnapshot();v.draft=e.draft;v.keyboardFeedback={visible:true,codes:[],committedUntil:0,composing:false};f.pageInputStarted=true;
 const before=JSON.stringify({snapshot:v.snapshot,draft:v.draft,input:f.input}),base={active:true,hidden:false,text:'AUTO',cueId:e.cue.id,targetKey:'KeyQ'};
 const shown=paint({...v,listeningDisplay:base},f),changed=paint({...v,listeningDisplay:{...base,text:'AUTOMATIC',targetKey:'KeyR'}},f);
 assert.notDeepEqual(shown,changed,'reference progress is painted on the shared scene Canvas');
 assert.deepEqual(paint({...v,listeningDisplay:{...base,hidden:true}},f),paint({...v,listeningDisplay:{...base,hidden:true,text:'DIFFERENT',targetKey:'KeyZ'}},f),'hiding the reference also hides automatic keys');
 assert.equal(JSON.stringify({snapshot:v.snapshot,draft:v.draft,input:f.input}),before);assert.equal(e.draft,'real private draft');assert.equal(e.getSnapshot().attempts.length,0);assert.equal(e.getSnapshot().earnedWords,0);assert.equal(f.input.commits10s,0);assert.deepEqual(f.input.points,[]);
});

const cadenceFixture={source:'sentence-reference' as const,quality:'estimated' as const,storage:'ephemeral' as const,status:'active' as const,windowMs:30000 as const,endMs:1000,points:[{atMs:500,value:4},{atMs:1000,value:4}]};
test('listening replaces standby fixture with estimated cadence and genuine zero facts',()=>{
 const{v,f}=state();const listeningDisplay={active:true,hidden:false,text:'AUTO',cueId:'one',targetKey:null,cadence:cadenceFixture};const before=JSON.stringify({v,f});const result=captureLabels({...v,listeningDisplay},f);
 assert.equal(result.mode,'live');assert.ok(result.labels.some(x=>x.text==='REFERENCE PACE'));assert.ok(result.labels.some(x=>x.text==='ESTIMATED'));assert.ok(!result.labels.some(x=>x.text==='INPUT TREND'||x.text==='STANDBY'));assert.ok(result.labels.some(x=>x.text==='0 / 24'));assert.ok(result.labels.some(x=>x.text==='0%'));assert.equal(JSON.stringify({v,f}),before);
 const changed=paint({...v,listeningDisplay:{...listeningDisplay,cadence:{...cadenceFixture,points:[{atMs:500,value:2},{atMs:1000,value:2}]}}},f);assert.notDeepEqual(paint({...v,listeningDisplay},f),changed);
 assert.deepEqual(paint(v,f),paint({...v,listeningDisplay:undefined},f),'leaving B restores exact original standby output');
});
test('hidden and reduced-motion listening suppress every target-derived graph pixel',()=>{
 const{v,f}=state();const display={active:true,hidden:true,text:'short',cueId:'one',targetKey:'KeyA',cadence:cadenceFixture};const other={...display,text:'a much longer reference',cueId:'two',targetKey:'KeyZ',cadence:{...cadenceFixture,endMs:300000,points:[{atMs:200000,value:200},{atMs:300000,value:900}]}};
 assert.deepEqual(paint({...v,listeningDisplay:display},f),paint({...v,listeningDisplay:other},f));
 const reduced={...v,reducedMotion:true,listeningDisplay:{...display,hidden:false,text:'same',targetKey:null}};
 assert.deepEqual(paint(reduced,f),paint({...reduced,listeningDisplay:{...reduced.listeningDisplay,cadence:other.cadence}},f));
 assert.ok(captureLabels(reduced,f).labels.some(x=>x.text==='Reduced motion'));
});
test('returning to typing and replay cannot retain automatic cadence or modify real traces',()=>{
 const{v,f}=state();f.pageInputStarted=true;f.input={...f.input,points:[{atMs:500,value:2},{atMs:1000,value:3}]};const before=JSON.stringify(f),normal=paint(v,f);paint({...v,listeningDisplay:{active:true,hidden:false,text:'AUTO',cueId:'one',targetKey:'KeyA',cadence:cadenceFixture}},f);assert.deepEqual(paint(v,f),normal);assert.equal(JSON.stringify(f),before);assert.deepEqual(paint(v,{...f,replay:true}),paint({...v,listeningDisplay:{active:true,hidden:false,text:'AUTO',cueId:'one',targetKey:'KeyA',cadence:cadenceFixture}},{...f,replay:true}));
});

test('hidden listening cannot leak the older Training target through an enabled subtitle',()=>{
 const{v,f}=state();const e=new TrainingEngine(),snapshot=e.getSnapshot(),display={active:true,hidden:true,text:'',cueId:null,targetKey:null,cadence:cadenceFixture};const a={...v,showSubtitle:true,snapshot,listeningDisplay:display},b={...a,snapshot:{...snapshot,material:{...snapshot.material,cues:snapshot.material.cues.map(c=>({...c,text:'a different hidden target with a different length'}))}}};assert.ok(paint(a,f).equals(paint(b,f)),'hidden subtitle must not reveal target text or length');
});

test('v78 reference guide is presentation-only and strict hidden listening suppresses every guide glyph',()=>{
 const{v,f}=state(),cue='Private guide reference',before=JSON.stringify(v.snapshot);const shown=captureLabels({...v,referenceGuide:cue},f);assert.ok(shown.labels.some(label=>label.text===cue));assert.ok(shown.labels.some(label=>label.text==='Assisted · Hide'));assert.equal(v.draft,'');assert.equal(JSON.stringify(v.snapshot),before);
 const hidden=captureLabels({...v,referenceGuide:cue,inputGuide:{mode:'letters',mask:'_______________________'},showSubtitle:true,listeningDisplay:{active:true,hidden:true,text:'Another hidden answer',cueId:'hidden',targetKey:'KeyA'}},f);assert.ok(!hidden.labels.some(label=>label.text.includes('Private')||label.text.includes('Another')||label.text.includes('____')||label.text.includes('Reference ·')));assert.equal(JSON.stringify(v.snapshot),before);
});

test('bright-frame typing backing includes the real status and action row in display and recording',async()=>{
 const{learningGeometry}=await import('./learning-surface');
 for(const portrait of[false,true])for(const cssWidth of portrait?[430,500]:[720,1280]){
  const{v,f}=state();v.reducedMotion=true;v.cameraViewport={width:cssWidth,height:900};
  const geometry=learningGeometry(responsiveLayout(portrait),{keyboardVisible:true,cssWidth}),card=geometry.inputCard;
  // A full-scene white source leaves no dark letterbox to conceal a missing plate.
  const white=createCanvas(geometry.width,geometry.height);white.getContext('2d').fillStyle='#fff';white.getContext('2d').fillRect(0,0,white.width,white.height);
  Object.assign(white,{complete:true,naturalWidth:white.width,naturalHeight:white.height,src:'qa-white-frame'});
  const source={...media,kind:'image',image:white} as unknown as SceneMedia;
  const draw=()=>{const canvas=createCanvas(geometry.width,geometry.height);paintTransparentScene(canvas as unknown as HTMLCanvasElement,source,v,f,portrait);return canvas};
  const canvas=draw(),ctx=canvas.getContext('2d');
  for(const [name,r]of Object.entries({status:card.status,keyboard:card.toggle,settings:card.modeToggle,check:card.submit})){
   // Check now has its own thin outline; sample its interior backing, not the intentional light stroke.
   const pixel=ctx.getImageData(Math.floor(r.x+(name==='check'?8/card.cssScale:3)),Math.floor(name==='check'?r.y+r.h/2:r.y+r.h-3),1,1).data;
   assert.ok((pixel[0]+pixel[1]+pixel[2])/3<130,`${portrait?'portrait':'landscape'} ${cssWidth}px ${name} must remain backed on white; got ${[...pixel]}`);
  }
  assert.deepEqual(canvas.toBuffer('image/png'),draw().toBuffer('image/png'),'same full scene is recorded');
 }
});

test('listening transport counter follows media ownership without changing training or revealing text',()=>{
 const{v,f}=state(),before=JSON.stringify(v.snapshot);v.listeningDisplay={active:true,hidden:true,text:'',cueId:null,targetKey:null};
 const original=captureLabels({...v,transportCueIndex:0},f),later=captureLabels({...v,transportCueIndex:2},f);
 assert.ok(original.labels.some(label=>label.text==='01'));assert.ok(later.labels.some(label=>label.text==='03'));
 assert.equal(JSON.stringify(v.snapshot),before);
 const typing=captureLabels({...v,listeningDisplay:undefined,transportCueIndex:8},f);
 assert.ok(typing.labels.some(label=>label.text===String((v.snapshot?.cueIndex??0)+1).padStart(2,'0')));
});
