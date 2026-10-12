import {translate,translateKnownUi} from '../i18n/locale';
import { inactiveListeningTestScope } from './inactive-listening-test-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {cameraControlGeometry} from '../scene/camera-control';
import {responsiveLayout} from '../scene/responsive-layout';
import {applyInputCardLayout} from '../scene/input-card';
import {learningGeometry,DEFAULT_HUD} from '../scene/learning-surface';
import {rectStyle} from '../scene/transparent-layout';
import {insetRect as legacyInsetRect} from '../scene/layout';
import {TrainingEngine} from './training';

// These are the actual shipped handlers and effects. Only the browser/device
// boundaries are synthetic; no real permission or hardware acceptance is claimed.
const require=createRequire(import.meta.url),parser=require('next/dist/compiled/babel/parser'),swc=require('next/dist/build/swc');
await swc.loadBindings();
const source=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
const ast=parser.parse(source,{sourceType:'module',plugins:['typescript','jsx']});
const studio=ast.program.body.find((node:any)=>node.type==='FunctionDeclaration'&&node.id?.name==='StudioContent');
const names=['showCameraState','releaseCameraStream','releaseCamera','stopCamera','cancelPendingCamera','openCamera','openPanel','closePanel'];
const functions=names.map(name=>{const node=studio.body.body.find((node:any)=>node.type==='FunctionDeclaration'&&node.id.name===name);assert.ok(node,name);return source.slice(node.start,node.end)}).join('\n');
let cameraButton:any,measureEffect:any,lifecycleEffect:any;
function visit(node:any){if(!node||typeof node!=='object')return;
 if(node.type==='JSXElement'&&node.openingElement.attributes.some((attribute:any)=>attribute.name?.name==='className'&&attribute.value?.value==='camera-hit hit'))cameraButton=node;
 if(node.type==='CallExpression'&&node.callee.name==='useLayoutEffect'&&source.slice(node.start,node.end).includes('setCameraViewport'))measureEffect=node.arguments[0];
 if(node.type==='CallExpression'&&node.callee.name==='useEffect'&&source.slice(node.start,node.end).includes('const hideCamera='))lifecycleEffect=node.arguments[0];
 for(const [key,value] of Object.entries(node))if(!['loc','comments','tokens'].includes(key)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value)}
}
visit(studio);assert.ok(cameraButton);assert.ok(measureEffect);assert.ok(lifecycleEffect);
const declarations=['geometry','cameraControl'].map(name=>{const node=studio.body.body.find((node:any)=>node.type==='VariableDeclaration'&&node.declarations.some((declaration:any)=>declaration.id.name===name));assert.ok(node,name);return source.slice(node.start,node.end)}).join('\n');
const {code}=await swc.transform(`${functions}\nconst installMeasurement=${source.slice(measureEffect.start,measureEffect.end)};\nconst installCameraLifecycle=${source.slice(lifecycleEffect.start,lifecycleEffect.end)};\nfunction renderCameraControl(){${declarations}\nreturn {control:cameraControl,element:${source.slice(cameraButton.start,cameraButton.end)}}}`,{jsc:{parser:{syntax:'typescript',tsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
const install=new Function('scope',`with(scope){${code}\nreturn {${names.join(',')},installMeasurement,installCameraLifecycle,renderCameraControl}}`);
const ref=<T,>(current:T)=>({current});
const noop=()=>{};
function gate<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
class Track extends EventTarget{readyState='live';stops=0;stop(){this.stops++;this.readyState='ended'}end(){this.readyState='ended';this.dispatchEvent(new Event('ended'))}}
class Stream{videos=[new Track(),new Track()];auxiliary=new Track();getVideoTracks(){return this.videos}getTracks(){return[...this.videos,this.auxiliary]}}
function setup(){
 const requests:any[]=[],changes:string[]=[],listeners=new Map<string,()=>void>(),engine=new TrainingEngine();engine.input('preserved draft');
 const saved={inset:{x:1300,y:250,w:240,h:152}},bounds={width:360,height:202.5};
 const video:any={srcObject:null,readyState:2,videoWidth:640,videoHeight:480,plays:0,pauses:0,play(){this.plays++;return Promise.resolve()},pause(){this.pauses++}};
 const scope:any={ ...inactiveListeningTestScope(),locale:'zh-CN',localeRef:{current:'zh-CN'},t:translate.bind(null,'zh-CN'),ui:translateKnownUi.bind(null,'zh-CN'),require,exports:{},Error,disposed:ref(false),cameraRequestRef:ref(false),cameraVideoOwnerRef:ref(null),cameraToken:ref(0),cameraStreamRef:ref(null),cameraRef:ref(video),visualRef:ref({camera:'off',layout:'lesson',arrangement:saved,recording:true,recordingStarted:777}),videoSize:'native',learningViewport:undefined,keyboardPlacement:'inside',mediaIntrinsic:{width:1920,height:1080},cameraState:'off',cameraMessage:'',cameraDevices:[],selectedCamera:'',panel:null,
  navigator:{mediaDevices:{getUserMedia:(options:any)=>{const request=gate<Stream>();requests.push({options,...request});return request.promise},enumerateDevices:async()=>[{kind:'videoinput',deviceId:'camera-1'},{kind:'audioinput',deviceId:'not-requested'}]}},
  setCameraState:(value:string)=>{scope.cameraState=value;changes.push(value)},setCameraMessage:(value:string)=>{scope.cameraMessage=value},setCameraDevices:(value:any)=>{scope.cameraDevices=value},setLayout:(value:string)=>{scope.layout=value},
  arrangement:saved,arrangementRef:ref(saved),layoutCacheRef:ref({landscape:saved,portrait:{inset:{x:100,y:30,w:150,h:95}}}),layout:'lesson',portrait:false,portraitHeight:1080,fixture:false,
  cameraViewport:undefined,cameraViewportRef:ref(undefined),stageRef:ref({getBoundingClientRect:()=>({...bounds})}),setCameraViewport:(update:any)=>{scope.cameraViewport=update(scope.cameraViewport)},
  window:{addEventListener:(name:string,callback:()=>void)=>listeners.set(name,callback),removeEventListener:(name:string,callback:()=>void)=>{if(listeners.get(name)===callback)listeners.delete(name)}},
  ResizeObserver:class{callback:()=>void;constructor(callback:()=>void){this.callback=callback;scope.observer=this}observe(target:any){scope.observed=target}disconnect(){scope.observerDisconnected=true}},
  cameraControlGeometry,responsiveLayout,applyInputCardLayout,learningGeometry,hudPreferences:DEFAULT_HUD,softwareKeyboardOpen:false,keyboardVisible:true,rectStyle,legacyInsetRect,referenceBlocked:()=>false,referenceTransitionRef:ref(false),reviewTransitionRef:ref(false),reviewStartFailureRef:ref(''),referenceConfirmationRef:ref(null),referencePanelRef:ref(false),referenceActionRef:ref(0),referencePreviewRef:ref(null),referenceVerificationRef:ref(null),layoutTransactionsRef:ref({active:false}),submissionSound:{audio:ref(null)},
  setMutedRecord:noop,clearRecordingPreview:noop,cancelRecordingPreparation:noop,lastFocus:ref(null),document:{activeElement:null},engineRef:ref(engine),setPanel:(value:any)=>{scope.panel=value},setToolsOpen:noop,cancelLayoutPreview:noop,replaySnapshot:ref(null),previewURL:ref(null),setDeleteId:noop,setResetPrompt:noop,requestAnimationFrame:(callback:()=>void)=>callback(),notify:noop};
 Object.assign(scope,install(scope));return{scope,requests,changes,video,saved,bounds,listeners,engine};
}
async function ready(f:ReturnType<typeof setup>){const work=f.scope.openCamera(),stream=new Stream();f.requests.at(-1).resolve(stream);await work;return stream}
function released(stream:Stream){for(const track of stream.getTracks())assert.equal(track.readyState,'ended')}

test('camera entry opens only settings, with keyboard-native button and accessible name',async()=>{
 const f=setup(),{element}=f.scope.renderCameraControl();assert.equal(element.type,'button');assert.equal(element.props['aria-label'],'打开摄像头设置');await element.props.onClick();assert.equal(f.scope.panel,'camera');assert.equal(f.requests.length,0);assert.equal(f.video.plays,0);
});
test('synchronous repeated enable requests produce one video-only permission request',async()=>{
 const f=setup();f.scope.selectedCamera='camera-2';const first=f.scope.openCamera(),second=f.scope.openCamera();assert.equal(f.requests.length,1);assert.deepEqual(f.requests[0].options,{video:{deviceId:{exact:'camera-2'}},audio:false});assert.equal(f.scope.cameraState,'requesting');assert.equal(f.scope.visualRef.current.camera,'requesting');f.requests[0].resolve(new Stream());await Promise.all([first,second]);assert.equal(f.scope.cameraState,'on');assert.deepEqual(f.scope.cameraDevices,[{kind:'videoinput',deviceId:'camera-1'}]);
});
test('closing settings or switching panels cancels pending permission, releases late streams and never plays them',async()=>{
 for(const action of ['close','switch','cancel']){const f=setup();f.scope.panel='camera';const work=f.scope.openCamera();if(action==='close')f.scope.closePanel(false);else if(action==='switch')await f.scope.openPanel('media');else f.scope.stopCamera();const stream=new Stream();f.requests[0].resolve(stream);await work;released(stream);assert.equal(f.video.plays,0);assert.equal(f.scope.cameraState,'off');assert.equal(f.scope.cameraStreamRef.current,null);assert.equal(f.video.srcObject,null);assert.equal(f.scope.cameraRequestRef.current,false)}
});
test('closing the settings panel after readiness keeps the active preview and stream',async()=>{
 const f=setup();f.scope.panel='camera';const stream=await ready(f);f.scope.closePanel(false);assert.equal(f.scope.cameraState,'on');assert.equal(f.video.srcObject,stream);assert.ok(stream.getTracks().every(track=>track.stops===0));
});
test('late play resolution after cancellation cannot turn preview ON or clear a newer owner',async()=>{
 const f=setup(),play=gate<void>();f.video.play=()=>play.promise;const pending=f.scope.openCamera(),oldStream=new Stream();f.requests[0].resolve(oldStream);await tick();assert.equal(f.scope.cameraState,'requesting');f.scope.stopCamera();f.video.play=()=>Promise.resolve();const latest=await ready(f);play.resolve();await pending;released(oldStream);assert.equal(f.scope.cameraState,'on');assert.equal(f.scope.cameraStreamRef.current,latest);assert.equal(f.video.srcObject,latest);assert.ok(latest.getTracks().every(track=>track.stops===0));
});
test('late rejection after cancellation cannot overwrite a newer successful preview',async()=>{
 const f=setup();const old=f.scope.openCamera();f.scope.stopCamera();const latest=await ready(f);f.requests[0].reject(Error('denied old request'));await old;assert.equal(f.scope.cameraState,'on');assert.equal(f.video.srcObject,latest);
});
test('native play completion and viable dimensions are both required before ON',async()=>{
 for(const invalid of ['zero-width','zero-height','not-ready','missing-video','ended','play-error']){const f=setup(),stream=new Stream();if(invalid==='zero-width')f.video.videoWidth=0;if(invalid==='zero-height')f.video.videoHeight=0;if(invalid==='not-ready')f.video.readyState=1;if(invalid==='missing-video')f.scope.cameraRef.current=null;if(invalid==='ended')stream.videos.forEach(track=>track.stop());if(invalid==='play-error')f.video.play=()=>Promise.reject(Error('play refused'));const work=f.scope.openCamera();f.requests[0].resolve(stream);await work;assert.equal(f.scope.cameraState,'error',invalid);assert.equal(f.scope.visualRef.current.camera,'error');assert.equal(f.scope.cameraStreamRef.current,null);assert.equal(f.video.srcObject,null);assert.equal(f.scope.cameraRequestRef.current,false);released(stream);assert.ok(!f.changes.includes('on'))}
});
test('disconnect during native play releases all tracks, detaches video and permits retry',async()=>{
 const f=setup(),play=gate<void>();f.video.play=()=>play.promise;const work=f.scope.openCamera(),stream=new Stream();f.requests[0].resolve(stream);await tick();stream.videos[1].end();assert.equal(f.scope.cameraState,'error');assert.match(f.scope.cameraMessage,/断开.*重试/);released(stream);assert.equal(f.video.srcObject,null);play.resolve();await work;assert.equal(f.scope.cameraState,'error');f.video.play=()=>Promise.resolve();await ready(f);assert.equal(f.scope.cameraState,'on');
});
test('disconnect after readiness releases every owned track and does not leave a false ON preview',async()=>{
 const f=setup(),stream=await ready(f);stream.videos[0].end();released(stream);assert.equal(f.scope.cameraState,'error');assert.equal(f.scope.visualRef.current.camera,'error');assert.equal(f.scope.cameraStreamRef.current,null);assert.equal(f.video.srcObject,null);
});
test('missing APIs, refused permission and failed device enumeration remain honest and retryable',async()=>{
 const missing=setup();missing.scope.navigator.mediaDevices=undefined;await missing.scope.openCamera();assert.equal(missing.scope.cameraState,'error');assert.match(missing.scope.cameraMessage,/课程训练仍可继续/);
 const f=setup(),failed=f.scope.openCamera();f.requests[0].reject(Error('NotAllowedError'));await failed;assert.equal(f.scope.cameraState,'error');assert.equal(f.scope.cameraRequestRef.current,false);f.scope.navigator.mediaDevices.enumerateDevices=async()=>{throw Error('not available')};const stream=await ready(f);assert.equal(f.scope.cameraState,'on');assert.equal(f.video.srcObject,stream);assert.match(f.scope.cameraMessage,/暂不能列出/);
});
test('page exit and unmount cancel pending permission and release active or late streams',async()=>{
 for(const phase of ['permission','play','on'])for(const exit of ['pagehide','unmount']){const f=setup(),cleanup=f.scope.installCameraLifecycle(),play=gate<void>(),stream=new Stream();if(phase==='play')f.video.play=()=>play.promise;const work=f.scope.openCamera();if(phase!=='permission'){f.requests[0].resolve(stream);await tick()}if(exit==='pagehide')f.listeners.get('pagehide')!();else{f.scope.disposed.current=true;f.scope.cameraRef.current=null;cleanup()}if(phase==='permission')f.requests[0].resolve(stream);if(phase==='play')play.resolve();await work;released(stream);assert.equal(f.scope.cameraStreamRef.current,null);assert.equal(f.video.srcObject,null);assert.equal(f.scope.cameraRequestRef.current,false);assert.equal(f.scope.visualRef.current.camera,'off');if(exit==='unmount')assert.equal(f.listeners.has('pagehide'),false)}
});
test('camera transitions retain saved geometry, training facts and actual recording state',async()=>{
 const f=setup(),before=f.engine.getSnapshot(),cache=f.scope.layoutCacheRef.current;for(let i=0;i<2;i++){await ready(f);f.scope.stopCamera()}assert.equal(f.scope.arrangementRef.current,f.saved);assert.equal(f.scope.visualRef.current.arrangement,f.saved);assert.equal(f.scope.layoutCacheRef.current,cache);assert.deepEqual(f.engine.getSnapshot(),before);assert.equal(f.engine.draft,'preserved draft');assert.equal(f.scope.visualRef.current.recording,true);assert.equal(f.scope.visualRef.current.recordingStarted,777);
 const recording=source.slice(source.indexOf(' async function startRecording(){'),source.indexOf(' function stopRecording('));assert.ok(recording.indexOf('layoutTransactionsRef.current.active')<recording.indexOf('canvas.captureStream'));assert.match(recording,/RecordingPreparationCanceled/);assert.doesNotMatch(functions,/setLessonAudio|setMicAudio|startRecording\(/);
});
test('initial measurement and ResizeObserver keep DOM and Canvas on the same real CSS viewport',()=>{
 const f=setup(),cleanup=f.scope.installMeasurement();assert.deepEqual(f.scope.cameraViewport,{width:360,height:202.5});assert.equal(f.scope.visualRef.current.cameraViewport,f.scope.cameraViewportRef.current);assert.equal(f.scope.observed,f.scope.stageRef.current);
 for(const [width,height,portrait] of [[360,202.5,false],[320,740,true],[390,844,true],[1920,1080,false]] as const){f.bounds.width=width;f.bounds.height=height;f.scope.portrait=portrait;f.scope.observer.callback();const rendered=f.scope.renderCameraControl(),geometry=applyInputCardLayout(responsiveLayout(portrait,f.saved,'lesson',1080),{cssScale:width/(portrait?430:1672),keyboardVisible:true}),canvas=cameraControlGeometry(geometry,'off','lesson',{cssWidth:f.scope.visualRef.current.cameraViewport.width,cssHeight:f.scope.visualRef.current.cameraViewport.height});assert.deepEqual(rendered.control,canvas);assert.ok(parseFloat(rendered.element.props.style.width)*width/100>=44-1e-7);assert.ok(parseFloat(rendered.element.props.style.height)*height/100>=44-1e-7)}
 cleanup();assert.equal(f.scope.observerDisconnected,true);assert.equal(f.listeners.has('resize'),false);
});
test('compact hit resolution applies to OFF, requesting and error; ON, camera-primary, split and fixture roles remain full sized',()=>{
 const f=setup();f.scope.installMeasurement();for(const state of ['off','requesting','error']){f.scope.cameraState=state;assert.equal(f.scope.renderCameraControl().control.compact,true)}for(const layout of ['lesson','camera','split']){f.scope.layout=layout;f.scope.cameraState='on';const rendered=f.scope.renderCameraControl();assert.equal(rendered.control.compact,false);assert.deepEqual(rendered.element.props.style,applyInputCardLayout(responsiveLayout(false,f.saved,layout as any,1080),{cssScale:f.bounds.width/1672,keyboardVisible:true}).style(responsiveLayout(false,f.saved,layout as any,1080).inset));if(layout!=='lesson'){f.scope.cameraState='off';assert.equal(f.scope.renderCameraControl().control.compact,false)}}f.scope.fixture=true;f.scope.layout='lesson';assert.deepEqual(f.scope.renderCameraControl().element.props.style,rectStyle(legacyInsetRect('lesson',{},true)));
});
