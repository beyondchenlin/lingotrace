import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {startSceneFrameLoop,resetSceneContext,sceneRenderFailureCode} from './frame-loop';
import {mediaShortcut} from './transparent-timeline';
const source=readFileSync(process.env.STUDIO_SOURCE_FILE??new URL('../components/Studio.tsx',import.meta.url),'utf8');

test('the actual Studio RAF setup survives a frame exception and retains a retry',()=>{
 const start=source.indexOf('let frame=0;const draw=')>=0?source.indexOf('let frame=0;const draw='):source.indexOf('const draw=(_rafTime:number)=>');
 const end=source.indexOf('const timer=setInterval',start);assert.ok(start>=0&&end>start);
 const js=stripTypeScriptTypes(source.slice(start,end),{mode:'strip'});
 let id=0,recovered=0;const queued=new Map<number,FrameRequestCallback>(),errors:unknown[]=[],phases:string[]=[];
 const request=(callback:FrameRequestCallback)=>{queued.set(++id,callback);return id},cancel=(id:number)=>{queued.delete(id)};
 const canvas={getContext:()=>({}),width:860};
 const visualRef:{current:unknown}={current:{set locale(value:string){void value;throw Error('injected frame exception')}}};
 const scope={sceneRenderPhaseRef:{current:'context'},performance:{now:()=>100},disposed:{current:false},canvas,visualRef,mediaRef:{current:{}},engineRef:{current:{}},localeRef:{current:'en'},requestAnimationFrame:request,cancelAnimationFrame:cancel,startSceneFrameLoop,resetSceneContext,failSceneRendering:(error:unknown)=>{errors.push(error);phases.push(scope.sceneRenderPhaseRef.current)},recoverSceneRendering:()=>{recovered++},frameLoopRef:{current:null}};
 new Function('scope',`with(scope){${js}}`)(scope);
 const entry=queued.entries().next().value!;queued.delete(entry[0]);try{entry[1](16)}catch{};
 assert.equal(queued.size,1,'a frame exception must not permanently kill RAF before a keyboard resize clears the Canvas');
 assert.equal(errors.length,1);assert.deepEqual(phases,['snapshot']);visualRef.current=null;const retry=queued.entries().next().value!;queued.delete(retry[0]);retry[1](32);assert.equal(recovered,1);assert.equal(queued.size,1);
});

test('pointer focus suppresses only the pointer ring and restores keyboard/blur behavior',()=>{
 assert.match(source,/dataset\.pointerFocused='true';e\.currentTarget\.focus\(\{preventScroll:true\}\)/);
 assert.match(source,/onKeyDown=\{e=>\{delete e\.currentTarget\.dataset\.pointerFocused\}\}/);
 assert.match(source,/onBlur=\{e=>\{delete e\.currentTarget\.dataset\.pointerFocused\}\}/);
 const css=readFileSync(new URL('../../app/studio/studio.css',import.meta.url),'utf8');assert.match(css,/\.scene-canvas:focus-visible\{outline:2px/);assert.match(css,/\.scene-canvas\[data-pointer-focused=true\]:focus-visible\{outline:none\}/);
});
test('persistent renderer and course errors have native visible recovery controls',()=>{
 assert.match(source,/className="scene-display-fallback" role="alertdialog"/);
 assert.match(source,/if\(sceneFailure&&!dialog.open\)dialog.showModal\(\);else if\(!sceneFailure&&dialog.open\)dialog.close\(\)/);
 assert.match(source,/frameLoopRef\.current\?\.retry\(\)/);
 assert.match(source,/courseError&&!builtinMediaReady&&mediaKind==='demo'&&!visualRef.current\?\.ready&&visualRef.current\?\.message==='视频暂不可用，请重新加载'&&<div className="scene-media-error" role="alert"/);
 assert.match(source,/if\(sceneFailureRef\.current\)\{notify\(t\('studio.displayInterrupted'\)\);return\}/);
 assert.match(source,/stopRecording\(RECORD_STOP_REASON\.renderInterrupted\)/);
});

test('native recovery dialog target cannot invoke underlying playback or cue shortcuts',()=>{
 const start=source.indexOf('const handler=(event:KeyboardEvent)=>'),end=source.indexOf(';window.addEventListener',start);assert.ok(start>=0&&end>start);
 const code=stripTypeScriptTypes(source.slice(start,end),{mode:'strip'});class Element {closest(){return null}}
 const failure={current:true},scope={Element,mediaShortcut,sceneFailureRef:failure,composing:{current:false},panel:null,editingLayout:false,fixture:false,replayIndex:null,ready:true,fontsReady:true};
 const handler=new Function('scope',`with(scope){${code};return handler}`)(scope);
 for(const key of[' ','ArrowLeft','ArrowRight'])assert.doesNotThrow(()=>handler({target:new Element(),key,isComposing:false,preventDefault(){assert.fail('blocked shortcut must not run underlying action')}}));
});

test('the actual failure dialog consumer keeps only a safe code and clears it on recovery',()=>{
 const a=source.indexOf(' function failSceneRendering('),b=source.indexOf(' const[fontsReady,',a);assert.ok(a>=0&&b>a);
 const canceled:string[]=[];
 const scope={cancelFollow(){},cancelTypingErrorFeedback(){canceled.push('typing')},submissionSound:{audio:{current:{cancel(){canceled.push('submission')}}}},sceneRenderFailureCode,sceneRenderPhaseRef:{current:'native-input'},sceneFailureRef:{current:false},stageRef:{current:{dataset:{} as Record<string,string>}},recorderRef:{current:null},cancelRecordingPreparation(){},failure:null as unknown,code:'',setSceneFailure(value:unknown){scope.failure=value},setSceneFailureCode(value:string){scope.code=value}};
 const host=new Function('scope',`with(scope){${stripTypeScriptTypes(source.slice(a,b),{mode:'strip'})};return{failSceneRendering,recoverSceneRendering}}`)(scope);
 host.failSceneRendering(new DOMException('private draft /private/path https://private.example','IndexSizeError'),true);
 assert.deepEqual(canceled,['typing','submission']);
 assert.equal(scope.failure,'failed');assert.equal(scope.code,'native-input / IndexSizeError');assert.equal(scope.stageRef.current.dataset.renderError,scope.code);
 host.recoverSceneRendering();assert.equal(scope.failure,null);assert.equal(scope.code,'');assert.equal(scope.stageRef.current.dataset.renderError,undefined);
 assert.match(source,/<code translate="no">\{sceneFailureCode\}<\/code>/);
 assert.match(source,/<div ref=\{inputViewportRef\} translate="no"/);assert.match(source,/<textarea id="studio-answer" translate="no"/);
});
