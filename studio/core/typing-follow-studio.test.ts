import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,ref,tick} from './studio-host-test-fixture.ts';
import {TypingFollowHost} from '../media/typing-follow-host.ts';
import {TypingFollowInput} from './typing-follow-input.ts';
import {NPS_MATERIAL} from './builtin-material.ts';
import {TrainingEngine} from './training.ts';
import {TrainingHistoryRecorder} from './training-history-recorder.ts';
import {exportStudioSession} from './session-export.ts';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import {translate} from '../i18n/locale.ts';
const require=createRequire(import.meta.url),parser=require('next/dist/compiled/babel/parser'),swc=require('next/dist/build/swc');await swc.loadBindings();
const source=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
const ast=parser.parse(source,{sourceType:'module',plugins:['typescript','jsx']});
const callbacks:Record<string,string>={},uiParts:Record<string,string>={};let toolbar='',settings='';
function visit(node:any){if(!node||typeof node!=='object')return;
 if(node.type==='CallExpression'&&node.callee?.property?.name==='then'&&node.callee.object?.callee?.name==='readDefaultCourseBootstrap')callbacks.bootstrap=source.slice(node.arguments[0].start,node.arguments[0].end);
 if(node.type==='JSXOpeningElement'&&node.name?.name==='form'&&node.attributes.some((attr:any)=>attr.name?.name==='className'&&attr.value?.value==='entry-form'))for(const attr of node.attributes)if(attr.name?.name==='onSubmit')callbacks.formSubmit=source.slice(attr.value.expression.start,attr.value.expression.end);
 if(node.type==='JSXOpeningElement'&&node.name?.name==='button'&&node.attributes.some((attr:any)=>attr.name?.name==='className'&&attr.value?.value==='submit-hit hit'))for(const attr of node.attributes)if(attr.name?.name==='onClick')callbacks.submitClick=source.slice(attr.value.expression.start,attr.value.expression.end);
 if(node.type==='VariableDeclarator'&&['followUnavailable','followUnavailableReason','followActive','followAutoReady','followStatus','followButton'].includes(node.id?.name))uiParts[node.id.name]=source.slice(node.init.start,node.init.end);
 if(node.type==='JSXExpressionContainer'&&source.slice(node.expression.start,node.expression.end).includes('typing-follow-toolbar'))toolbar=source.slice(node.expression.start,node.expression.end);
 if(node.type==='JSXElement'&&source.slice(node.start,node.end).startsWith(`<div className="hud-panel-section"><span className="hud-section-label">{t('follow.title')}`))settings=source.slice(node.start,node.end);
 if(node.type==='JSXOpeningElement'&&node.name?.name==='textarea')for(const attr of node.attributes){if(['onCompositionStart','onCompositionEnd','onBlur'].includes(attr.name?.name))callbacks[attr.name.name]=source.slice(attr.value.expression.start,attr.value.expression.end)}
 if(node.type==='JSXOpeningElement'&&node.name?.name==='button'&&node.attributes.some((attr:any)=>attr.name?.name==='className'&&attr.value?.value==='play-hit hit'))for(const attr of node.attributes){if(attr.name?.name==='onPointerDown')callbacks.playPointerDown=source.slice(attr.value.expression.start,attr.value.expression.end)}
 if(node.type==='VariableDeclarator'&&node.id?.name==='listener'&&source.slice(node.start,node.end).includes('handleAnswerBeforeInput(native)'))callbacks.beforeInput=source.slice(node.init.start,node.init.end);
 for(const [key,value]of Object.entries(node))if(!['loc','comments','tokens'].includes(key)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value)}
}visit(ast);
assert.equal(Object.keys(callbacks).length,8);
const {code}=await swc.transform(Object.entries(callbacks).map(([name,body])=>`const ${name}=${body};`).join('\n'),{jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}});
assert.equal(Object.keys(uiParts).length,6);assert.ok(toolbar);assert.ok(settings);
const uiCode=(await swc.transform(`function renderFollow(){${Object.entries(uiParts).map(([name,body])=>`const ${name}=${body};`).join('')}return {button:followButton,toolbar:(${toolbar}),settings:inputSettingsOpen&&(${settings})}}`,{jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}})).code;
const installUi=new Function('scope',`with(scope){${uiCode};return renderFollow}`);
const install=new Function('scope',`with(scope){${code};return {${Object.keys(callbacks).join(',')}}}`);
async function followSetup(t:Parameters<typeof setup>[0]){
 const f=await setup(t,{courseSources:true});const{ctx,video,engine}=f;
 await ctx.startBuiltinPractice(NPS_MATERIAL);ctx.changeCue(5,false);engine.setFrozen('modal',false);engine.setFrozen('listening',false);engine.setFrozen('idle',true);
 video.readyState=2;let now=0,focusCount=0;ctx.performance.now=()=>now;ctx.document.hasFocus=()=>true;
 ctx.sceneFailureRef=ref(false);ctx.followInputRef=ref(new TypingFollowInput());ctx.followRenderRef=ref({ready:true,fontsReady:true});ctx.layoutEditingRef=ref(false);ctx.dialogRef=ref({open:false});ctx.visualRef.current.referenceGuide=engine.cue.text;
 ctx.referenceVisibleRef.current=true;ctx.referenceExposureRef.current={unavailable:false,has:()=>true};ctx.setInputSettingsOpen=()=>{};
 ctx.followPauseClickRef=ref(false);ctx.followNativeEventsRef=ref(new WeakSet<Event>());
 const input=ctx.inputRef.current;input.disabled=false;input.onbeforeinput=null;input.selectionStart=input.selectionEnd=input.value.length;input.focus=()=>{focusCount++;ctx.document.activeElement=input};ctx.document.activeElement=input;ctx.input=input;
 Object.assign(ctx,install(ctx));ctx.followHeader={follow:{x:0,y:0,w:150,h:44}};ctx.hitStyle=()=>({});ctx.HudGlyph=({name})=>(require('react').createElement('svg',{'data-glyph':name,'aria-hidden':'true'}));ctx.portrait=false;ctx.geometry={practiceCompact:false};ctx.renderFollow=installUi(ctx);ctx.followReady=true;ctx.readonly=false;ctx.paused=false;ctx.referenceVisible=true;ctx.inputSettingsOpen=false;ctx.replayIndex=null;ctx.editingLayout=false;ctx.referenceConfirmation=null;
 const timers=new Map<object,()=>void>();
 const host=new TypingFollowHost({media:()=>video as any,context:ctx.followEnvironment,claim(){ctx.correctedPlayRequest.current++;ctx.correctedPlayOwner.current=null},play:(intent,current,prepare,issued,pause)=>ctx.toggleCorrectedPlay(false,{intent,current,prepare,issued,pause}),release(scope){if(String(ctx.correctedPlayRequest.current)===scope.ownerId)ctx.correctedPlayOwner.current=null;ctx.followInputRef.current.clear()},changed(state){ctx.observeFixedPaceFollow(state)},schedule(cb){const id={};timers.set(id,()=>{ctx.observeFixedPaceMedia();cb()});return id},unschedule(id){timers.delete(id as object)}});ctx.followRef.current=host;
 (video as any).seekable={length:1,start:()=>0,end:()=>video.duration};
 // Browser fixture emits synchronous events; listeners keep the production registration order.
 video.removeEventListener('play',ctx.onPlay);video.removeEventListener('pause',ctx.onPause);
 for(const kind of ['play','playing','pause','seeking','ratechange','waiting','stalled','error','emptied'] as const)video.addEventListener(kind,event=>ctx.handleFollowNative(kind,event,host));
 video.addEventListener('play',ctx.onPlay);video.addEventListener('pause',ctx.onPause);video.addEventListener('timeupdate',ctx.onTime);
 t.after(()=>host.dispose());
 const append=(data:string,type='insertText',trusted=true)=>{const native={inputType:type,data,isTrusted:trusted,isComposing:false,defaultPrevented:false,cancelable:true,preventDefault(){this.defaultPrevented=true}};input.selectionStart=input.selectionEnd=input.value.length;ctx.beforeInput(native);input.value+=data;ctx.inputHandler({currentTarget:input,nativeEvent:native});};
 return {...f,host,timers,input,append,get focuses(){return focusCount},async start(){ctx.startFollow(true);await tick()},async advance(ms:number){now+=ms;ctx.observeFixedPaceMedia();host.tick();await tick()}};
}
test('actual Studio authenticated Start/idle/end is history- and export-neutral without input',async t=>{
 const f=await followSetup(t);await f.history.flush();const before=JSON.stringify(f.engine.getSnapshot()),exportBefore=exportStudioSession(f.engine.getSnapshot(),'2026-10-11T00:00:00.000Z');
 await f.start();assert.equal(f.host.snapshot.phase,'following');assert.ok(f.ctx.correctedPlayOwner.current,'source guard installed authenticated owner');assert.equal(f.focuses,1);
 await f.advance(750);await f.advance(750);assert.equal(f.host.snapshot.phase,'following');assert.equal(f.host.snapshot.reason,'idle-coasting');assert.equal(f.video.paused,false);
 f.host.stop();await f.start();f.video.currentTime=f.engine.cue.end;f.video.dispatchEvent(new Event('timeupdate'));assert.equal(f.host.snapshot.phase,'ended');assert.equal(f.video.currentTime,f.engine.cue.end);
 assert.equal(JSON.stringify(f.engine.getSnapshot()),before);assert.deepEqual(exportStudioSession(f.engine.getSnapshot(),'2026-10-11T00:00:00.000Z'),exportBefore);assert.equal(f.history.getSnapshot().dirty,false);
});
test('actual input ends idle coasting without replay and keeps normal input evidence',async t=>{
 const f=await followSetup(t);await f.start();await f.advance(750);await f.advance(750);const before=f.video.plays;
 f.append('x');await tick();assert.equal(f.host.snapshot.phase,'following');assert.equal(f.video.plays,before);assert.equal(f.host.snapshot.reason,null);assert.equal(f.engine.draft,'x');assert.equal(f.engine.getSnapshot().events.at(-1)?.type,'inputCommitted');assert.equal(f.engine.getSnapshot().attempts.length,0);
});
test('actual pointer Pause survives editor blur cancellation and cannot restart',async t=>{
 const f=await followSetup(t);await f.start();const before=f.video.plays;f.ctx.playPointerDown();f.ctx.onBlur();f.ctx.togglePlay();await tick();assert.equal(f.video.plays,before);assert.equal(f.video.paused,true);assert.equal(f.host.active,false);f.append('x');await tick();assert.equal(f.video.plays,before);
});
test('actual Check/Next and hide interrupts leave no Follow auto-play authority',async t=>{
 const f=await followSetup(t);await f.start();f.ctx.submit();assert.equal(f.host.active,false);assert.equal(f.video.paused,true);await f.start();f.ctx.changeCue(6,false);assert.equal(f.host.active,false);const before=f.video.plays;f.append('x');await tick();assert.equal(f.video.plays,before);
});
test('actual composition handlers pause preedit and admit final commit exactly once',async t=>{
 const f=await followSetup(t);await f.start();const before=f.video.plays;
 f.ctx.onCompositionStart({currentTarget:f.input,nativeEvent:{isTrusted:true}});assert.equal(f.host.snapshot.phase,'waiting');assert.equal(f.video.paused,true);
 f.input.value='你';f.ctx.inputHandler({currentTarget:f.input,nativeEvent:{inputType:'insertCompositionText',data:'你',isTrusted:true,isComposing:true}});assert.equal(f.engine.draft,'');
 f.ctx.onCompositionEnd({currentTarget:f.input,data:'你',nativeEvent:{data:'你',isTrusted:true}});const revision=f.ctx.followInputRef.current.revision;
 f.ctx.inputHandler({currentTarget:f.input,nativeEvent:{inputType:'insertFromComposition',data:'你',isTrusted:true,isComposing:false}});assert.equal(f.ctx.followInputRef.current.revision,revision);await tick();assert.equal(f.host.snapshot.phase,'following');assert.equal(f.video.plays,before+1);
});
test('actual cancelled composition never resumes automatically',async t=>{
 const f=await followSetup(t);await f.start();const before=f.video.plays;f.ctx.onCompositionStart({currentTarget:f.input,nativeEvent:{isTrusted:true}});f.ctx.onCompositionEnd({currentTarget:f.input,data:'',nativeEvent:{data:'',isTrusted:true}});await tick();assert.equal(f.video.plays,before);assert.equal(f.video.paused,true);
});
test('actual restored passive state is blocked; genuine input unlocks a later explicit Start',async t=>{
 const f=await followSetup(t);const snapshot=f.engine.getSnapshot();const restored=new TrainingEngine({snapshot,restoredReadOnly:true});f.ctx.engineRef.current=restored;f.ctx.restoredSessionRef.current=snapshot.sessionId;assert.equal(f.ctx.followEnvironment().practiceActive,false);await f.start();assert.equal(f.host.active,false);
 f.input.value='real';f.ctx.inputHandler({currentTarget:f.input,nativeEvent:{inputType:'insertText',data:'real',isTrusted:true}});assert.equal(restored.isPassiveRestored,false);assert.equal(f.ctx.followEnvironment().practiceActive,true);await f.start();assert.equal(f.host.snapshot.phase,'following');
});
test('actual pending source guard is rechecked after focus/source changes and no new fetch occurs',async t=>{
 const f=await followSetup(t);const acquired=f.npsAcquired;let resolve!:()=>void;f.ctx.courseRoutingRef.current={};f.ctx.prepareCourseRouting=()=>new Promise<void>(yes=>{resolve=yes});f.ctx.startFollow(true);await Promise.resolve();f.ctx.document.hidden=true;f.host.tick();resolve();await tick();assert.equal(f.video.paused,true);assert.equal(f.host.active,false);assert.equal(f.npsAcquired,acquired);
});
test('programmatic DOM value changes invalidate Follow at the next guard without count/replay',async t=>{
 const f=await followSetup(t);await f.start();const snapshot=JSON.stringify(f.engine.getSnapshot());f.input.value='programmatic';await f.advance(50);assert.equal(f.host.active,false);assert.equal(f.video.paused,true);assert.equal(JSON.stringify(f.engine.getSnapshot()),snapshot);
});
for(const blocked of ['cafe','local','unready','unexposed','hidden','recording','listening'])test(`actual ${blocked} entry is unavailable before focus or media ownership changes`,async t=>{
 const f=await followSetup(t);const token=f.ctx.correctedPlayRequest.current,focuses=f.focuses;
 if(blocked==='cafe')f.ctx.engineRef.current=new TrainingEngine();
 if(blocked==='local')f.ctx.mediaRef.current.kind='video';
 if(blocked==='unready')f.video.readyState=1;
 if(blocked==='unexposed')f.ctx.referenceExposureRef.current.has=()=>false;
 if(blocked==='hidden')f.ctx.referenceVisibleRef.current=false;
 if(blocked==='recording')f.ctx.recordPreparing.current=true;
 if(blocked==='listening')f.ctx.listening.playerRef.current={getState:()=>({active:true})};
 f.video.paused=false;await f.start();assert.equal(f.host.active,false);assert.equal(f.ctx.correctedPlayRequest.current,token);assert.equal(f.focuses,focuses);assert.equal(f.video.paused,false);
 if(blocked==='listening')f.ctx.listening.playerRef.current=null;
});
test('actual Start with queued ordinary pause does not disarm after guarded playback begins',async t=>{
 const f=await followSetup(t);const queue:Event[]=[];const ordinaryPause=f.video.pause.bind(f.video);f.video.pause=()=>{if(!f.video.paused){f.video.paused=true;queue.push(new Event('pause'))}};
 f.video.paused=false;f.engine.setFrozen('listening',true);await f.start();assert.equal(f.host.snapshot.phase,'following');assert.equal(f.video.paused,false);assert.equal(queue.length,1);
 f.video.dispatchEvent(queue.shift()!);assert.equal(f.host.snapshot.phase,'following');assert.equal(f.video.paused,false);assert.ok(!f.engine.getSnapshot().frozenReasons.includes('listening'));f.video.pause=ordinaryPause;
});
test('recording interruption is synchronous before capture work and cannot auto-resume',async t=>{
 const f=await followSetup(t);await f.start();f.ctx.cancelFollow('recording');f.ctx.recordPreparing.current=true;const count=f.video.plays;assert.equal(f.video.paused,true);assert.equal(f.video.playbackRate,1);assert.equal(f.host.active,false);f.append('x');await tick();assert.equal(f.video.plays,count);f.ctx.recordPreparing.current=false;
});

test('rejected Follow then genuine ordinary Play retains existing listening timing',async t=>{const f=await followSetup(t);const play=f.video.play.bind(f.video);f.video.play=()=>Promise.reject(Error('NotAllowedError'));await f.start();assert.equal(f.host.active,false);f.video.play=play;await f.ctx.toggleCorrectedPlay();assert.equal(f.video.paused,false);assert.ok(f.engine.getSnapshot().frozenReasons.includes('listening'))});
test('known queued old pause cannot unfreeze newer ordinary playback',async t=>{const f=await followSetup(t);const queue:Event[]=[];f.video.pause=()=>{if(!f.video.paused){f.video.paused=true;queue.push(new Event('pause'))}};await f.start();f.host.stop();await f.ctx.toggleCorrectedPlay();assert.equal(f.video.paused,false);assert.ok(f.engine.getSnapshot().frozenReasons.includes('listening'));f.video.dispatchEvent(queue.shift()!);assert.equal(f.video.paused,false);assert.ok(f.engine.getSnapshot().frozenReasons.includes('listening'))});

test('actual opt-in UI is beside typing while off and localized after Start',async t=>{const f=await followSetup(t);f.ctx.followView={state:f.host.snapshot,rate:null};assert.ok(f.ctx.renderFollow().toolbar);await f.start();f.ctx.followView={state:f.host.snapshot,rate:f.video.playbackRate};for(const locale of ['en','zh-CN'] as const){f.ctx.t=translate.bind(null,locale);const html=renderToStaticMarkup(f.ctx.renderFollow().toolbar);assert.match(html,/0.80/);const label=locale==='en'?'Stop assist':'停止辅助';assert.match(html,new RegExp(`aria-label="${label}"`));assert.match(html,new RegExp(`title="${label}"`));assert.ok(html.includes(label),'accessible name stays localized');assert.match(html,/data-glyph="pace"/);assert.doesNotMatch(html,/Beta|测试版|<details/);assert.match(html,/aria-live="polite"/);assert.ok(!html.includes(f.engine.cue.text))}});
test('actual hidden-target UI and prerequisite description are identical for different targets in both languages',async t=>{
 const f=await followSetup(t);await f.start();f.ctx.cancelFollow('hide-reference');f.ctx.referenceVisibleRef.current=false;f.ctx.referenceVisible=false;f.ctx.inputSettingsOpen=true;f.ctx.followView={state:f.host.snapshot,rate:1.2};const snapshot=f.engine.getSnapshot();
 for(const readonly of [false,true])for(const locale of ['en','zh-CN'] as const){f.ctx.readonly=readonly;f.ctx.replayIndex=readonly?0:null;f.ctx.t=translate.bind(null,locale);let prior='';for(const text of ['hidden_target_A','a much longer hidden_target_B with different tokens']){
  f.ctx.engineRef.current={isPassiveRestored:false,getSnapshot:()=>({...snapshot,material:{...snapshot.material,cues:[{id:'hidden',start:0,end:5,text}]}}),cue:{id:'hidden',start:0,end:5,text}};
  const ui=f.ctx.renderFollow(),html=renderToStaticMarkup([ui.settings,ui.toolbar]);assert.ok(!html.includes(text));assert.ok(!html.includes('1.20'));assert.match(html,/disabled=""/);assert.ok(html.includes(translate(locale,readonly?'follow.unavailableReadonly':'follow.unavailableReference')));assert.match(html,/aria-describedby="typing-follow-prerequisite"/);assert.equal((html.match(/id="typing-follow-prerequisite"/g)??[]).length,1);if(prior)assert.equal(html,prior);prior=html;
 }}
});
test('Start from ordinary playback has only existing explicit-Pause training delta',async t=>{const a=await followSetup(t),b=await followSetup(t);a.video.paused=false;b.video.paused=false;a.engine.setFrozen('listening',true);b.engine.setFrozen('listening',true);const seq=a.engine.getSnapshot().sequence;assert.equal(b.engine.getSnapshot().sequence,seq);b.ctx.togglePlay();await tick();await a.start();assert.deepEqual(a.engine.getSnapshot(),b.engine.getSnapshot());assert.equal(a.engine.getSnapshot().events.slice(seq).filter(e=>e.type==='inputCommitted'||e.type==='submitRequested'||e.type==='timeAdvanced').length,0);const after=JSON.stringify(a.engine.getSnapshot());await a.advance(750);await a.advance(750);assert.equal(JSON.stringify(a.engine.getSnapshot()),after)});

test('actual aborted composition resume queues only attributed cleanup and adds no controller history',async t=>{const f=await followSetup(t);await f.start();f.host.compositionStart(1);f.host.compositionCancel(1);const queue:Event[]=[];f.video.play=()=>{f.video.paused=false;queue.push(new Event('play'));return Promise.reject(Error('AbortError'))};f.video.pause=()=>{if(!f.video.paused){f.video.paused=true;queue.push(new Event('pause'))}};f.append('x');const afterInput=JSON.stringify(f.engine.getSnapshot());await tick();assert.equal(f.host.active,false);assert.equal(f.video.paused,true);assert.deepEqual(queue.map(event=>event.type),['play','pause']);for(const event of queue)f.video.dispatchEvent(event);assert.equal(JSON.stringify(f.engine.getSnapshot()),afterInput)});
test('actual endpoint during native play settlement uses attributed pause without rewind/history',async t=>{const f=await followSetup(t);const queue:Event[]=[];f.video.play=()=>{f.video.paused=false;queue.push(new Event('play'));f.video.currentTime=f.engine.cue.end;return Promise.resolve()};f.video.pause=()=>{if(!f.video.paused){f.video.paused=true;queue.push(new Event('pause'))}};const before=JSON.stringify(f.engine.getSnapshot());await f.start();assert.equal(f.video.paused,true);assert.equal(f.host.snapshot.phase,'ended');for(const event of queue)f.video.dispatchEvent(event);assert.equal(JSON.stringify(f.engine.getSnapshot()),before);assert.equal(f.video.currentTime,f.engine.cue.end)});
test('actual stale native play after cancellation is silenced only under its old lease and remains history-neutral',async t=>{const f=await followSetup(t);const queue:Event[]=[];let finish!:()=>void;f.video.play=()=>{f.video.paused=false;queue.push(new Event('play'));return new Promise<void>(resolve=>{finish=resolve})};f.video.pause=()=>{if(!f.video.paused){f.video.paused=true;queue.push(new Event('pause'))}};f.ctx.startFollow(true);await Promise.resolve();assert.ok(finish);f.host.stop();const before=JSON.stringify(f.engine.getSnapshot());f.video.paused=false;finish();await tick();assert.equal(f.video.paused,true);for(const event of queue)f.video.dispatchEvent(event);assert.equal(JSON.stringify(f.engine.getSnapshot()),before)});

test('actual background revocation keeps known Follow cleanup out of training history',async t=>{const f=await followSetup(t);await f.start();f.append('x');const queue:Event[]=[];f.video.pause=()=>{if(!f.video.paused){f.video.paused=true;queue.push(new Event('pause'))}};f.ctx.document.hidden=true;f.ctx.visibility();const before=JSON.stringify(f.engine.getSnapshot());assert.ok(f.engine.getSnapshot().frozenReasons.includes('background'));for(const event of queue)f.video.dispatchEvent(event);assert.equal(JSON.stringify(f.engine.getSnapshot()),before);assert.equal(f.video.paused,true)});

test('actual source load reset preserves subsequent ordinary Play and Pause timing',async t=>{const f=await followSetup(t);await f.start();f.host.stop();f.video.dispatchEvent(new Event('emptied'));await f.ctx.toggleCorrectedPlay();assert.equal(f.video.paused,false);assert.ok(f.engine.getSnapshot().frozenReasons.includes('listening'));f.ctx.togglePlay();assert.equal(f.video.paused,true);assert.ok(!f.engine.getSnapshot().frozenReasons.includes('listening'));assert.ok(f.engine.getSnapshot().frozenReasons.includes('idle'))});

test('delayed background native cleanup remains attributed beyond the old play timeout',async t=>{const f=await followSetup(t);await f.start();f.append('x');const queue:Event[]=[];f.video.pause=()=>{if(!f.video.paused){f.video.paused=true;queue.push(new Event('pause'))}};f.ctx.document.hidden=true;f.ctx.visibility();const before=JSON.stringify(f.engine.getSnapshot());await f.advance(2000);for(const event of queue)f.video.dispatchEvent(event);assert.equal(JSON.stringify(f.engine.getSnapshot()),before);assert.equal(f.video.paused,true)});


const prerequisiteCases=[
 ['scene error','studio.displayInterrupted',(f:any)=>{f.ctx.sceneFailureRef.current=true}],
 ['recording','follow.unavailableRecording',(f:any)=>{f.ctx.activeRecord=true}],
 ['recording preparation','follow.unavailableRecording',(f:any)=>{f.ctx.startingRecord=true}],
 ['listening','follow.unavailableListening',(f:any)=>{f.ctx.listening.state={active:true}}],
 ['cafe','follow.unavailableCourse',(f:any)=>{f.ctx.engineRef.current=new TrainingEngine()}],
 ['local media','follow.unavailableCourse',(f:any)=>{f.ctx.mediaRef.current.kind='video'}],
 ['hidden reference','follow.unavailableReference',(f:any)=>{f.ctx.referenceVisible=false;f.ctx.referenceVisibleRef.current=false}],
 ['reference not yet exposed','follow.unavailableReference',(f:any)=>{f.ctx.referenceExposureRef.current.has=()=>false}],
 ['paused practice','follow.unavailablePaused',(f:any)=>{f.ctx.paused=true}],
 ['passive restore','follow.unavailableRestored',(f:any)=>{f.ctx.engineRef.current=new TrainingEngine({snapshot:f.engine.getSnapshot(),restoredReadOnly:true})}],
 ['read-only practice','follow.unavailableReadonly',(f:any)=>{f.ctx.readonly=true}],
 ['read-only with unshown reference','follow.unavailableReadonly',(f:any)=>{f.ctx.readonly=true;f.ctx.referenceExposureRef.current.has=()=>false;f.ctx.visualRef.current.referenceGuide=undefined}],
 ['review practice','follow.unavailableReadonly',(f:any)=>{f.ctx.reviewBindingRef.current={}}],
 ['hidden reference during review','follow.unavailableReadonly',(f:any)=>{f.ctx.reviewBindingRef.current={};f.ctx.referenceVisible=false;f.ctx.referenceVisibleRef.current=false}],
 ['hidden reference during replay','follow.unavailableReadonly',(f:any)=>{f.ctx.readonly=true;f.ctx.replayIndex=0;f.ctx.referenceVisible=false;f.ctx.referenceVisibleRef.current=false}],
 ['hidden reference during layout editing','follow.unavailableReadonly',(f:any)=>{f.ctx.readonly=true;f.ctx.editingLayout=true;f.ctx.referenceVisible=false;f.ctx.referenceVisibleRef.current=false}],
 ['media loading','follow.unavailableLoading',(f:any)=>{f.video.readyState=1;f.ctx.readonly=true}],
 ['source verification','follow.unavailableLoading',(f:any)=>{f.ctx.reviewMediaRef.current=null;f.ctx.readonly=true}],
 ['restore loading','follow.unavailableLoading',(f:any)=>{f.ctx.restoredSessionRef.current=undefined}],
 ['unavailable practice','follow.unavailable',(f:any)=>{f.ctx.followReady=false}],
] as const;
for(const [name,key,block] of prerequisiteCases)test(`actual ${name} prerequisite is visible and describes disabled Start in English and Chinese`,async t=>{
 const f=await followSetup(t);block(f);f.ctx.followView={state:f.host.snapshot,rate:1.2};f.ctx.inputSettingsOpen=true;
 const state=JSON.stringify(f.engine.getSnapshot()),owner=f.ctx.correctedPlayRequest.current,focuses=f.focuses,plays=f.video.plays;
 for(const locale of ['en','zh-CN'] as const){f.ctx.t=translate.bind(null,locale);const expected=translate(locale,key),ui=f.ctx.renderFollow(),html=renderToStaticMarkup(ui.settings);assert.ok(ui.toolbar,'Follow stays discoverable next to typing while off');assert.match(html,/disabled=""/);assert.match(html,/aria-describedby="typing-follow-prerequisite"/);assert.ok(html.includes(`<p class="note" id="typing-follow-prerequisite">${expected}</p>`));assert.ok(!html.includes('1.20'));
  f.ctx.followView={state:{...f.host.snapshot,enabled:true},rate:1.2};f.ctx.inputSettingsOpen=false;const opted=renderToStaticMarkup(f.ctx.renderFollow().toolbar);assert.match(opted,/aria-describedby="typing-follow-status"/);assert.ok(opted.includes(`<span id="typing-follow-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true">${expected}</span>`));assert.ok(!opted.includes('1.20'));f.ctx.followView={state:f.host.snapshot,rate:1.2};f.ctx.inputSettingsOpen=true;
 }
 assert.equal(JSON.stringify(f.engine.getSnapshot()),state);assert.equal(f.ctx.correctedPlayRequest.current,owner);assert.equal(f.focuses,focuses);assert.equal(f.video.plays,plays);
});
test('current prerequisite precedence resolves as blockers clear without exposing reference text',async t=>{
 const f=await followSetup(t);f.ctx.t=translate.bind(null,'en');f.ctx.inputSettingsOpen=true;f.ctx.followView={state:f.host.snapshot,rate:null};f.ctx.activeRecord=true;f.ctx.listening.state={active:true};f.ctx.referenceVisible=false;f.ctx.referenceVisibleRef.current=false;f.ctx.paused=true;
 const reason=(key:Parameters<typeof translate>[1])=>assert.ok(renderToStaticMarkup(f.ctx.renderFollow().settings).includes(translate('en',key)));
 reason('follow.unavailableRecording');f.ctx.activeRecord=false;reason('follow.unavailableListening');f.ctx.listening.state={active:false};reason('follow.unavailableReference');f.ctx.referenceVisible=true;f.ctx.referenceVisibleRef.current=true;reason('follow.unavailablePaused');f.ctx.paused=false;
 const html=renderToStaticMarkup(f.ctx.renderFollow().settings);assert.ok(!html.includes('disabled=""'));assert.ok(!html.includes('typing-follow-prerequisite'));assert.ok(f.ctx.renderFollow().toolbar);
});

test('verified NPS ordinary Play is issued within the explicit gesture call before microtasks',async t=>{
 const f=await followSetup(t),before=f.video.plays;
 const work=f.ctx.toggleCorrectedPlay();assert.equal(f.video.plays,before+1,'no unnecessary async catalog lookup may defer native play');await work;
});
test('verified NPS Follow starts audio resume and native play in the same gesture even while resume settles',async t=>{
 const f=await followSetup(t);let resumeCalls=0,finish!:()=>void;
 f.ctx.courseRoutingRef.current={};f.ctx.prepareCourseRouting=()=>{resumeCalls++;return new Promise<void>(resolve=>{finish=resolve})};
 const before=f.video.plays;f.ctx.startFollow(true);assert.equal(resumeCalls,1);assert.equal(f.video.plays,before+1);finish();await tick();assert.equal(f.host.snapshot.phase,'following');
});

test('Follow stays starting until both native play and audio routing settle, then reports the actual playing rate',async t=>{
 const f=await followSetup(t);let finishRoute!:()=>void,finishPlay!:()=>void;
 f.ctx.courseRoutingRef.current={};f.ctx.prepareCourseRouting=()=>new Promise<void>(resolve=>{finishRoute=resolve});
 const play=f.video.play.bind(f.video);f.video.play=()=>{void play();return new Promise<void>(resolve=>{finishPlay=resolve})};
 f.ctx.startFollow(true);assert.equal(f.host.snapshot.phase,'starting');finishRoute();await tick();assert.equal(f.host.snapshot.phase,'starting');finishPlay();await tick();assert.equal(f.host.snapshot.phase,'following');assert.equal(f.video.playbackRate,.8);
});
test('audio route rejection ends the owned Follow playback without changing the draft',async t=>{
 const f=await followSetup(t);f.append('draft');const draft=f.engine.draft;let reject!:(_error:Error)=>void;
 f.ctx.courseRoutingRef.current={};f.ctx.prepareCourseRouting=()=>new Promise<void>((_resolve,no)=>{reject=no});
 f.ctx.startFollow(true);assert.equal(f.video.paused,false);reject(Error('resume rejected'));await tick();assert.equal(f.host.active,false);assert.equal(f.video.paused,true);assert.equal(f.engine.draft,draft);
});
test('late audio route rejection cannot silence a newer ordinary Play owner',async t=>{
 const f=await followSetup(t);let reject!:(_error:Error)=>void;
 f.ctx.courseRoutingRef.current={};f.ctx.prepareCourseRouting=()=>new Promise<void>((_resolve,no)=>{reject=no});
 f.ctx.startFollow(true);f.ctx.cancelFollow('manual-play');f.ctx.courseRoutingRef.current=null;await f.ctx.toggleCorrectedPlay();const owner=f.ctx.correctedPlayOwner.current;assert.ok(owner);assert.equal(f.video.paused,false);
 reject(Error('old route rejected'));await tick();assert.equal(f.video.paused,false);assert.equal(f.ctx.correctedPlayOwner.current,owner);
});

test('an active starting or buffered Follow keeps an enabled Stop control when readyState temporarily drops',async t=>{
 const f=await followSetup(t);f.ctx.t=translate.bind(null,'en');
 for(const phase of ['starting','following'] as const){
  f.video.readyState=1;f.ctx.followView={state:{...f.host.snapshot,active:true,phase},rate:.8};
  const ui=f.ctx.renderFollow(),html=renderToStaticMarkup(ui.toolbar);assert.match(html,/Stop assist/);assert.doesNotMatch(html,/disabled=""/);assert.match(html,new RegExp(`data-follow-phase="${phase}"`));
  let reason='';const cancel=f.ctx.cancelFollow;f.ctx.cancelFollow=(value:string)=>{reason=value};ui.button.props.onClick({nativeEvent:{isTrusted:true}});assert.equal(reason,'manual-pause');f.ctx.cancelFollow=cancel;
 }
});

test('actual admitted cue-start seek may temporarily lose frame readiness and remains cancelable until owned native recovery',async t=>{
 const f=await followSetup(t);f.ctx.t=translate.bind(null,'en');let time=f.video.currentTime,finishPlay!:()=>void;
 Object.defineProperty(f.video,'currentTime',{configurable:true,get:()=>time,set(value:number){time=value;f.video.readyState=1;f.video.dispatchEvent(new Event('seeking'))}});
 const play=f.video.play.bind(f.video);f.video.play=()=>{void play();f.video.dispatchEvent(new Event('waiting'));return new Promise<void>(resolve=>{finishPlay=resolve})};
 const before=f.video.plays;f.ctx.startFollow(true);assert.equal(f.video.plays,before+1);assert.equal(f.host.snapshot.phase,'starting');assert.equal(f.video.paused,false);
 f.ctx.followView={state:f.host.snapshot,rate:f.video.playbackRate};const html=renderToStaticMarkup(f.ctx.renderFollow().toolbar);assert.ok(html.includes(translate('en','follow.stop')));assert.doesNotMatch(html,/disabled=""/);
 await f.advance(50);assert.equal(f.host.active,true);f.video.readyState=2;f.video.dispatchEvent(new Event('playing'));finishPlay();await tick();assert.equal(f.host.snapshot.phase,'following');assert.equal(f.video.currentTime,f.engine.cue.start);assert.ok(!f.engine.getSnapshot().frozenReasons.includes('listening'));
});

test('a stale active view remains stoppable but Hidden never paints a target-derived rate',async t=>{
 const f=await followSetup(t);await f.start();f.ctx.followView={state:f.host.snapshot,rate:1.23};f.ctx.referenceVisible=false;f.ctx.referenceVisibleRef.current=false;f.ctx.t=translate.bind(null,'en');
 const html=renderToStaticMarkup(f.ctx.renderFollow().toolbar);assert.match(html,/Stop assist/);assert.doesNotMatch(html,/disabled=""|1\.23/);assert.ok(html.includes(translate('en','follow.unavailableReference')));
});

test('fresh eligible real tail append starts Follow synchronously without explicit Start or focus movement',async t=>{
 const f=await followSetup(t);f.ctx.armFollowAutoEntry(f.ctx.followAutoEpochRef.current,true);const plays=f.video.plays,focuses=f.focuses;
 assert.equal(f.host.active,false);f.append('x');assert.equal(f.video.plays,plays+1);assert.equal(f.focuses,focuses);await tick();assert.equal(f.host.snapshot.phase,'following');assert.equal(f.video.playbackRate,.8);assert.equal(f.engine.draft,'x');assert.equal(f.host.snapshot.active?.samples.length,1);assert.equal(f.host.snapshot.active?.samples[0].count,1);assert.equal(f.engine.getSnapshot().attempts.length,0);
});
test('unattributed native controls revoke an armed token, even if values return before typing',async t=>{
 for(const kind of ['play','playing','pause','seeking','ratechange','error','emptied'] as const){const f=await followSetup(t);f.ctx.armFollowAutoEntry(f.ctx.followAutoEpochRef.current,true);const plays=f.video.plays;f.video.dispatchEvent(new Event(kind));assert.equal(f.ctx.followAutoEntryRef.current,null,kind);f.append('x');assert.equal(f.video.plays,plays,kind)}
});
test('one pending admitted navigation seek notification preserves only that current armed cue',async t=>{
 const f=await followSetup(t);(f.video as any).seeking=true;f.ctx.armFollowAutoEntry(f.ctx.followAutoEpochRef.current,true);f.video.dispatchEvent(new Event('seeking'));assert.ok(f.ctx.followAutoEntryRef.current);(f.video as any).seeking=false;const plays=f.video.plays;f.append('x');assert.equal(f.video.plays,plays+1);
});

test('auto-entry observes real fast and slow commits, clamps and slews native rate without replay',async t=>{
 const f=await followSetup(t);f.ctx.armFollowAutoEntry(f.ctx.followAutoEpochRef.current,true);f.append('x');await tick();const plays=f.video.plays;let previous=f.video.playbackRate;
 for(let i=0;i<12;i++){await f.advance(250);f.append('abcdefghijklmnopqrst');assert.ok(Math.abs(f.video.playbackRate-previous)<=.0625+1e-9);previous=f.video.playbackRate}
 assert.ok(f.video.playbackRate>1);assert.ok(f.video.playbackRate<=1.5);
 for(let i=0;i<32;i++){await f.advance(250);if(i%4===0)f.append('x');assert.ok(Math.abs(f.video.playbackRate-previous)<=.0625+1e-9);previous=f.video.playbackRate}
 assert.equal(f.video.playbackRate,.5);assert.equal(f.video.plays,plays);assert.equal(f.engine.getSnapshot().attempts.length,0);
});
test('auto-entry has the same Training/export facts as identical real input with Follow disarmed',async t=>{
 const a=await followSetup(t),b=await followSetup(t);a.ctx.armFollowAutoEntry(a.ctx.followAutoEpochRef.current,true);
 a.append('wrong');b.append('wrong');await tick();assert.deepEqual(a.engine.getSnapshot(),b.engine.getSnapshot());
 const before=exportStudioSession(a.engine.getSnapshot(),'2026-10-12T00:00:00.000Z');for(let i=0;i<10;i++)await a.advance(200);assert.deepEqual(exportStudioSession(a.engine.getSnapshot(),'2026-10-12T00:00:00.000Z'),before);assert.equal(a.engine.getSnapshot().attempts.length,0);
});
test('fresh IME preedit stays silent and final trusted commit enters exactly once',async t=>{
 const f=await followSetup(t);f.ctx.armFollowAutoEntry(f.ctx.followAutoEpochRef.current,true);const plays=f.video.plays;
 f.ctx.onCompositionStart({currentTarget:f.input,nativeEvent:{isTrusted:true}});f.ctx.beforeInput({inputType:'insertCompositionText',data:'你',isTrusted:true,isComposing:true});f.input.value='你';f.ctx.inputHandler({currentTarget:f.input,nativeEvent:{inputType:'insertCompositionText',data:'你',isTrusted:true,isComposing:true}});assert.equal(f.video.plays,plays);assert.ok(f.ctx.followAutoEntryRef.current);
 f.ctx.onCompositionEnd({currentTarget:f.input,data:'你',nativeEvent:{data:'你',isTrusted:true}});assert.equal(f.video.plays,plays+1);const revision=f.ctx.followInputRef.current.revision;
 f.ctx.inputHandler({currentTarget:f.input,nativeEvent:{inputType:'insertFromComposition',data:'你',isTrusted:true,isComposing:false}});await tick();assert.equal(f.ctx.followInputRef.current.revision,revision);assert.equal(f.host.snapshot.active?.samples.length,1);assert.equal(f.host.snapshot.active?.samples[0].count,1);assert.equal(f.video.plays,plays+1);
});
test('empty initial composition, paste, unknown input and untrusted input consume the opportunity',async t=>{
 for(const kind of ['cancel','paste','unknown','untrusted'] as const){const f=await followSetup(t);f.ctx.armFollowAutoEntry(f.ctx.followAutoEpochRef.current,true);const plays=f.video.plays;
  if(kind==='cancel'){f.ctx.onCompositionStart({currentTarget:f.input,nativeEvent:{isTrusted:true}});f.ctx.onCompositionEnd({currentTarget:f.input,data:'',nativeEvent:{data:'',isTrusted:true}})}
  else if(kind==='unknown'){f.input.value='x';f.ctx.inputHandler({currentTarget:f.input,nativeEvent:{inputType:'insertText',data:'x',isTrusted:true,isComposing:false}})}
  else f.append('x',kind==='paste'?'insertFromPaste':'insertText',kind!=='untrusted');
  f.append('y');await tick();assert.equal(f.video.plays,plays,kind);assert.equal(f.ctx.followAutoEntryRef.current,null,kind);
 }
});
test('auto-entry denies mid-draft insertion, replacement, deletion and programmatic pre-value drift',async t=>{
 for(const kind of ['middle','replace','delete','drift'] as const){const f=await followSetup(t);f.append('old');f.ctx.armFollowAutoEntry(f.ctx.followAutoEpochRef.current,true);const plays=f.video.plays;
  if(kind==='drift')f.input.value='programmatic';
  const data=kind==='delete'?null:'x',inputType=kind==='delete'?'deleteContentBackward':'insertText';f.input.selectionStart=kind==='middle'||kind==='replace'?0:f.input.value.length;f.input.selectionEnd=kind==='replace'?3:f.input.selectionStart;
  const native={isTrusted:true,inputType,data,isComposing:false};f.ctx.beforeInput(native);f.input.value=kind==='middle'?'xold':kind==='replace'?'x':kind==='delete'?'ol':'programmaticx';f.ctx.inputHandler({currentTarget:f.input,nativeEvent:native});f.append('y');await tick();assert.equal(f.video.plays,plays,kind);
 }
});
test('denied first auto play has no retry loop and explicit Start remains recovery',async t=>{
 const f=await followSetup(t);f.ctx.armFollowAutoEntry(f.ctx.followAutoEpochRef.current,true);const play=f.video.play.bind(f.video);f.video.play=()=>{f.video.plays++;return Promise.reject(Error('NotAllowedError'))};
 f.append('x');await tick();const plays=f.video.plays;assert.equal(f.host.active,false);assert.equal(f.ctx.followAutoEntryRef.current,null);f.append('y');await f.advance(200);assert.equal(f.video.plays,plays);
 f.video.play=play;await f.start();assert.equal(f.host.snapshot.phase,'following');assert.equal(f.video.plays,plays+1);
});
test('manual pause, Hidden, background, blur, checks and recording lock an armed cue even before first input',async t=>{
 for(const reason of ['manual-pause','hide-reference','background','blur','check','recording','manual-play','manual-seek','manual-rate','manual-replay'] as const){const f=await followSetup(t);f.ctx.armFollowAutoEntry(f.ctx.followAutoEpochRef.current,true);f.ctx.cancelFollow(reason);const plays=f.video.plays;f.append('x');await tick();assert.equal(f.video.plays,plays,reason);assert.equal(f.ctx.followAutoEntryRef.current,null,reason)}
});
test('actual manual Pause after auto-entry prevents subsequent typing resurrection',async t=>{
 const f=await followSetup(t);f.ctx.armFollowAutoEntry(f.ctx.followAutoEpochRef.current,true);f.append('x');await tick();const plays=f.video.plays;f.ctx.togglePlay();f.append('y');await tick();assert.equal(f.video.plays,plays);assert.equal(f.video.paused,true);assert.equal(f.host.active,false);
});
test('fresh auto-ready status offers Stop before typing and does not create media or learning facts',async t=>{
 const f=await followSetup(t);const before=JSON.stringify(f.engine.getSnapshot()),plays=f.video.plays;f.ctx.armFollowAutoEntry(f.ctx.followAutoEpochRef.current,true);f.ctx.followView={state:f.host.snapshot,rate:null};
 for(const locale of ['en','zh-CN'] as const){f.ctx.t=translate.bind(null,locale);const html=renderToStaticMarkup(f.ctx.renderFollow().toolbar);assert.ok(html.includes(translate(locale,'follow.autoReady')));assert.ok(html.includes(translate(locale,'follow.stop')));assert.match(html,/aria-pressed="true"/)}
 f.ctx.renderFollow().button.props.onClick({nativeEvent:{isTrusted:true}});assert.equal(f.ctx.followAutoEntryRef.current,null);assert.equal(f.video.plays,plays);assert.equal(JSON.stringify(f.engine.getSnapshot()),before);f.append('x');assert.equal(f.video.plays,plays);
});
test('only trusted navigation into a new unoffered cue arms once and navigation itself is silent',async t=>{
 const f=await followSetup(t);f.ctx.armFollowAutoEntry(f.ctx.followAutoEpochRef.current,true);const plays=f.video.plays;f.ctx.cancelFollow('manual-pause');
 f.ctx.changeCue(6,false,false);assert.equal(f.ctx.followAutoEntryRef.current,null);f.ctx.changeCue(7,false,true);assert.ok(f.ctx.followAutoEntryRef.current);assert.equal(f.video.plays,plays);
 f.ctx.visualRef.current.referenceGuide=f.engine.cue.text;f.append('x');assert.equal(f.video.plays,plays+1);await tick();f.ctx.cancelFollow('manual-pause');
 f.ctx.changeCue(8,false,true);f.ctx.changeCue(7,false,true);assert.equal(f.ctx.followAutoEntryRef.current,null);f.ctx.changeCue(5,false,true);assert.equal(f.ctx.followAutoEntryRef.current,null);f.ctx.visualRef.current.referenceGuide=f.engine.cue.text;f.append('x');assert.equal(f.video.plays,plays+1);
});
test('restored input and explicit cue navigation cannot silently obtain fresh-practice authority',async t=>{
 const f=await followSetup(t);f.ctx.armFollowAutoEntry(f.ctx.followAutoEpochRef.current,true);const snapshot=f.engine.getSnapshot(),restored=new TrainingEngine({snapshot,restoredReadOnly:true});f.ctx.engineRef.current=restored;f.ctx.restoredSessionRef.current=snapshot.sessionId;
 const plays=f.video.plays;f.append('x');await tick();assert.equal(restored.isPassiveRestored,false);assert.equal(f.video.plays,plays);f.ctx.changeCue(6,false,true);f.ctx.visualRef.current.referenceGuide=restored.cue.text;f.append('y');assert.equal(f.video.plays,plays);assert.equal(f.ctx.followAutoEntryRef.current,null);
});
test('successful actual new practice grants a fresh token without starting sound',async t=>{
 const f=await followSetup(t);f.ctx.cancelFollow('manual-pause');const plays=f.video.plays;await f.ctx.startBuiltinPractice(NPS_MATERIAL,true);assert.ok(f.ctx.followAutoEntryRef.current);assert.equal(f.video.plays,plays);f.ctx.visualRef.current.referenceGuide=f.engine.cue.text;f.append('x');assert.equal(f.video.plays,plays+1);await tick();assert.equal(f.host.active,true);
});
test('actual completed fresh bootstrap stays silent until a first genuine append and never arms unknown saved state',async t=>{
 for(const saved of [null,undefined]){const f=await followSetup(t);f.ctx.cancelFollow('course-change');const preview=new TrainingEngine({material:NPS_MATERIAL,deferInitialPractice:true}),history=new TrainingHistoryRecorder(f.repo);t.after(()=>history.dispose());f.ctx.history=history;f.ctx.historyRef.current=history;f.ctx.engineRef.current=preview;f.ctx.engine=preview;f.ctx.generation=f.ctx.life.current;f.ctx.followBootstrapEpoch=f.ctx.followAutoEpochRef.current;f.ctx.setReady=(value:boolean)=>{f.ctx.followRenderRef.current.ready=value};f.ctx.followAutoSessionRef.current=null;
  const control=await f.repo.readAutomaticHistoryControl(),plays=f.video.plays;await f.ctx.bootstrap({saved,control,temporary:false,listeningSession:null});assert.equal(f.video.plays,plays);assert.equal(!!f.ctx.followAutoEntryRef.current,saved===null);f.ctx.visualRef.current.referenceGuide=preview.cue.text;f.append('x');assert.equal(f.video.plays,plays+(saved===null?1:0));await tick();assert.equal(f.host.active,saved===null);
 }
});
test('pending actual new-practice admission cannot arm after an intervening manual interruption',async t=>{
 const f=await followSetup(t);const flush=f.history.flushForTransition.bind(f.history);let proceed!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{proceed=resolve}),waiting=new Promise<void>(resolve=>{entered=resolve});f.history.flushForTransition=async(...args:any[])=>{const value=await flush(...args as Parameters<typeof flush>);entered();await gate;return value};
 const work=f.ctx.startBuiltinPractice(NPS_MATERIAL,true);await waiting;f.ctx.cancelFollow('manual-pause');proceed();await work;assert.equal(f.ctx.followAutoEntryRef.current,null);f.ctx.visualRef.current.referenceGuide=f.engine.cue.text;const plays=f.video.plays;f.append('x');assert.equal(f.video.plays,plays);
});
test('nested new-round completion cannot rebase auto authority after interruption during its outer await',async t=>{
 const f=await followSetup(t),old=f.engine.getSnapshot().sessionId;let proceed!:()=>void,entered!:()=>void,calls=0;const gate=new Promise<void>(resolve=>{proceed=resolve}),waiting=new Promise<void>(resolve=>{entered=resolve});f.ctx.listening.beforeTransition=async()=>{if(calls++===0){entered();await gate}};
 const work=f.ctx.beginNewRound(true);await waiting;f.ctx.cancelFollow('manual-pause');proceed();await work;assert.notEqual(f.engine.getSnapshot().sessionId,old);assert.equal(f.ctx.followAutoEntryRef.current,null);f.ctx.visualRef.current.referenceGuide=f.engine.cue.text;const plays=f.video.plays;f.append('x');assert.equal(f.video.plays,plays);
});
test('programmatic new-practice completion does not grant automatic typing authority',async t=>{
 const f=await followSetup(t);await f.ctx.startBuiltinPractice(NPS_MATERIAL);assert.equal(f.ctx.followAutoEntryRef.current,null);f.ctx.visualRef.current.referenceGuide=f.engine.cue.text;const plays=f.video.plays;f.append('x');assert.equal(f.video.plays,plays);
});
test('UA-trusted form submission alone cannot mint Next authority, but trusted native button click can',async t=>{
 for(const gesture of [false,true]){const f=await followSetup(t);f.ctx.armFollowAutoEntry(f.ctx.followAutoEpochRef.current,true);f.append(f.engine.cue.text);await tick();f.ctx.submit();assert.equal(f.engine.currentResult?.errors,0);const plays=f.video.plays;
  const event={nativeEvent:{isTrusted:true},preventDefault(){}};if(gesture)f.ctx.submitClick(event);else f.ctx.formSubmit(event);
  assert.equal(f.video.plays,plays);assert.equal(!!f.ctx.followAutoEntryRef.current,gesture);f.ctx.visualRef.current.referenceGuide=f.engine.cue.text;f.append('x');assert.equal(f.video.plays,plays+(gesture?1:0));
 }
});

for(const [name,block] of [
 ['Hidden',(f:any)=>{f.ctx.referenceVisibleRef.current=false}],['unexposed',(f:any)=>{f.ctx.referenceExposureRef.current.has=()=>false}],['loading',(f:any)=>{f.video.readyState=1}],['background',(f:any)=>{f.ctx.document.hidden=true}],['blurred',(f:any)=>{f.ctx.document.activeElement=null}],['recording',(f:any)=>{f.ctx.recordPreparing.current=true}],['Listening',(f:any)=>{f.ctx.listening.playerRef.current={getState:()=>({active:true}),nativeInput:()=>{}}}],['readonly',(f:any)=>{f.input.disabled=true}],['paused',(f:any)=>{f.engine.setFrozen('paused',true)}],['modal',(f:any)=>{f.ctx.dialogRef.current.open=true}],['layout',(f:any)=>{f.ctx.layoutEditingRef.current=true}],['replay',(f:any)=>{f.ctx.replaySnapshot.current=f.engine.getSnapshot()}],['review',(f:any)=>{f.ctx.reviewBindingRef.current={}}],['source mismatch',(f:any)=>{f.video.currentSrc='blob:changed'}],['unqualified local',(f:any)=>{f.ctx.mediaRef.current.kind='video'}],['native rate change',(f:any)=>{f.video.playbackRate=1.25}],['native seek',(f:any)=>{f.video.currentTime+=.1}],
] as const)test(`armed first input in ${name} remains silent and consumes its opportunity`,async t=>{
 const f=await followSetup(t);f.ctx.armFollowAutoEntry(f.ctx.followAutoEpochRef.current,true);const plays=f.video.plays;block(f);f.append('x');assert.equal(f.video.plays,plays);assert.equal(f.ctx.followAutoEntryRef.current,null);
});

async function fixedSetup(t:Parameters<typeof setup>[0],rate=1){
 const f=await followSetup(t);f.ctx.choosePacingStrategy('fixed');if(rate!==1)f.ctx.chooseFixedRate(rate);
 f.ctx.armFollowAutoEntry(f.ctx.followAutoEpochRef.current,true);return f;
}
async function advanceFixedMedia(f:Awaited<ReturnType<typeof fixedSetup>>,milliseconds:number){
 let remaining=milliseconds;while(remaining>1e-6){const step=Math.min(50,remaining);f.video.currentTime+=step*f.video.playbackRate/1000;await f.advance(step);remaining-=step;}
}
async function finishFixedSentence(f:Awaited<ReturnType<typeof fixedSetup>>,rate=1){
 await advanceFixedMedia(f,(f.engine.cue.end-f.video.currentTime)*1000/rate);
 assert.equal(f.ctx.fixedPaceObserverRef.current.snapshot.phase,'ended',JSON.stringify(f.ctx.fixedPaceObserverRef.current.snapshot));
 assert.equal(f.host.snapshot.phase,'ended');assert.equal(f.video.paused,true);
}
test('new primary source defaults fixed 1x, actual first append holds that speed through idle and fast input',async t=>{
 assert.match(source,/useState<'fixed'\|'adaptive'>\('fixed'\)/);assert.match(source,/\[fixedRate,setFixedRate\]=useState\(1\)/);
 const f=await fixedSetup(t);f.append('a');await tick();assert.equal(f.video.playbackRate,1);assert.equal(f.ctx.followEnvironment().pacingStrategy,'fixed');
 await advanceFixedMedia(f,1600);assert.equal(f.video.playbackRate,1);f.append(' fast real tail input');await advanceFixedMedia(f,600);assert.equal(f.video.playbackRate,1);assert.equal(f.host.snapshot.reason,null);
});
test('actual fixed run checks an early full answer only after observed sentence end, with no extra Training metric',async t=>{
 const f=await fixedSetup(t);const answer=f.engine.cue.text;f.append(answer.slice(0,1));await tick();await advanceFixedMedia(f,200);f.append(answer.slice(1));
 assert.equal(f.ctx.fixedPaceResult,null);const time=f.engine.cue.end-f.engine.cue.start;await finishFixedSentence(f);assert.equal(f.ctx.fixedPaceResult,null);
 const before=f.engine.getSnapshot().attempts.length;f.ctx.submit();const receipt=f.ctx.fixedPaceResult;assert.ok(receipt,JSON.stringify({frame:f.ctx.fixedPaceFrame(),phase:f.ctx.fixedPaceObserverRef.current.snapshot,frozen:f.engine.getSnapshot().frozenReasons},(k,v)=>k==='engine'?undefined:v));assert.equal(receipt.accuracy,100);assert.equal(receipt.errors,0);assert.equal(receipt.referenceAssisted,true);assert.equal(receipt.rate,1);assert.ok(Math.abs(receipt.deltaMs-(200-time*1000))<1e-5);assert.equal(f.engine.getSnapshot().attempts.length,before+1);
 assert.equal(exportStudioSession(f.engine.getSnapshot()).json.includes('deltaMs'),false);const html=renderToStaticMarkup(f.ctx.renderFixedPaceResult());assert.match(html,/早/);assert.match(html,/辅助/);assert.match(html,/不是逐词声学同步/);
});
test('actual post-end trusted append remains measurable after Follow releases its parser',async t=>{
 const f=await fixedSetup(t);const answer=f.engine.cue.text;f.append(answer.slice(0,1));await tick();await finishFixedSentence(f);const plays=f.video.plays;
 await f.advance(500);f.append(answer.slice(1));await tick();assert.equal(f.video.plays,plays);f.ctx.submit();assert.equal(f.ctx.fixedPaceResult.deltaMs,500);assert.equal(f.ctx.fixedPaceResult.rate,1);
});
test('actual fixed non-1x selection remains exact and is displayed with reference assistance',async t=>{
 const f=await fixedSetup(t,1.25);const answer=f.engine.cue.text;f.append(answer);await tick();assert.equal(f.video.playbackRate,1.25);await finishFixedSentence(f,1.25);f.ctx.submit();assert.equal(f.ctx.fixedPaceResult.rate,1.25);assert.match(renderToStaticMarkup(f.ctx.renderFixedPaceResult()),/1.25×.*辅助/);
});
test('adaptive requires an explicit mode choice and never creates a fixed-pace finish receipt',async t=>{
 const f=await fixedSetup(t);f.ctx.choosePacingStrategy('adaptive');assert.equal(f.ctx.followAutoEntryRef.current,null);await f.start();assert.equal(f.video.playbackRate,.8);assert.equal(f.ctx.fixedPaceScopeRef.current,null);
 f.append(f.engine.cue.text);f.ctx.submit();assert.equal(f.ctx.fixedPaceResult,null);assert.ok(translate('en','follow.description').includes('does not prove original-speed'));
});
for(const interrupt of ['manual-pause','background','hide-reference','blur','recording','manual-seek','manual-rate'] as const)test(`actual fixed ${interrupt} does not turn an accurate answer into a completion difference`,async t=>{
 const f=await fixedSetup(t);f.append(f.engine.cue.text);await tick();await advanceFixedMedia(f,100);f.ctx.cancelFollow(interrupt);const plays=f.video.plays;f.ctx.submit();assert.equal(f.video.plays,plays);assert.ok(f.ctx.fixedPaceResult);assert.equal(f.ctx.fixedPaceResult.deltaMs,null);
});
test('actual native stall invalidates timing although the playback controller can later recover',async t=>{
 const f=await fixedSetup(t);f.append(f.engine.cue.text);await tick();await advanceFixedMedia(f,200);f.video.dispatchEvent(new Event('waiting'));await advanceFixedMedia(f,(f.engine.cue.end-f.video.currentTime)*1000);assert.equal(f.ctx.fixedPaceObserverRef.current.snapshot.phase,'unknown');f.ctx.submit();assert.equal(f.ctx.fixedPaceResult?.deltaMs,null);assert.equal(f.ctx.fixedPaceResult?.reason,'waiting');
});
test('actual early Check seals unknown and a late media position cannot backfill timing',async t=>{
 const f=await fixedSetup(t);f.append(f.engine.cue.text);await tick();await advanceFixedMedia(f,100);f.ctx.submit();assert.equal(f.ctx.fixedPaceResult.deltaMs,null);const receipt=f.ctx.fixedPaceResult;f.video.currentTime=f.engine.cue.end;f.ctx.onTime();assert.deepEqual(f.ctx.fixedPaceResult,receipt);
});
test('actual fixed composition interrupts without input-dependent automatic resume',async t=>{
 const f=await fixedSetup(t);f.append('a');await tick();const plays=f.video.plays;f.ctx.onCompositionStart({currentTarget:f.input,nativeEvent:{isTrusted:true}});assert.equal(f.host.active,false);assert.equal(f.video.paused,true);f.input.value='ab';f.ctx.onCompositionEnd({currentTarget:f.input,data:'b',nativeEvent:{data:'b',isTrusted:true}});await tick();assert.equal(f.video.plays,plays);assert.equal(f.ctx.fixedPaceObserverRef.current.snapshot.phase,'unknown');
});
test('actual post-end paste, deletion and untrusted input cannot claim timely completion',async t=>{
 for(const kind of ['paste','delete','untrusted']){const f=await fixedSetup(t);const answer=f.engine.cue.text;f.append(answer.slice(0,1));await tick();await finishFixedSentence(f);
  if(kind==='delete'){const native={inputType:'deleteContentBackward',data:null,isTrusted:true,isComposing:false};f.ctx.beforeInput(native);f.input.value='';f.ctx.inputHandler({currentTarget:f.input,nativeEvent:native});f.append(answer)}else f.append(answer.slice(1),kind==='paste'?'insertFromPaste':'insertText',kind!=='untrusted');
  f.ctx.submit();assert.equal(f.ctx.fixedPaceResult?.deltaMs,null,kind);assert.match(f.ctx.fixedPaceResult?.reason??'',/input|revision/,kind);
 }
});
test('pre-existing or cleared drafts can play fixed speed but cannot get fresh-run timing',async t=>{
 const f=await fixedSetup(t);f.ctx.cancelFollow('manual-pause');f.append('prior');f.ctx.startFollow(true);await tick();assert.equal(f.video.playbackRate,1);assert.equal(f.ctx.fixedPaceObserverRef.current.snapshot.reason,'nonempty-or-untrusted-start');
});
test('hidden target before Check has no fixed timing result or target-derived UI',async t=>{
 const f=await fixedSetup(t);f.append('x');await tick();f.ctx.referenceVisibleRef.current=false;f.ctx.referenceVisible=false;f.ctx.cancelFollow('hide-reference');assert.equal(f.ctx.fixedPaceResult,null);assert.equal(f.ctx.renderFixedPaceResult(),null);
});

test('checked fixed receipt cannot follow navigation onto a different cue or reappear on return',async t=>{
 const f=await fixedSetup(t);f.append(f.engine.cue.text);await tick();await finishFixedSentence(f);f.ctx.submit();assert.ok(f.ctx.renderFixedPaceResult());const original=f.engine.getSnapshot().cueIndex;
 f.ctx.changeCue(original+1,false,true);assert.equal(f.ctx.fixedPaceResult,null);assert.equal(f.ctx.renderFixedPaceResult(),null);f.ctx.changeCue(original,false,true);assert.equal(f.ctx.renderFixedPaceResult(),null);
});
test('checked fixed receipt is removed when a real composition edits the previously checked draft',async t=>{
 const f=await fixedSetup(t);f.append(f.engine.cue.text);await tick();await finishFixedSentence(f);f.ctx.submit();assert.ok(f.ctx.renderFixedPaceResult());
 f.ctx.onCompositionStart({currentTarget:f.input,nativeEvent:{isTrusted:true}});assert.equal(f.ctx.fixedPaceResult,null);f.input.value+='x';f.ctx.onCompositionEnd({currentTarget:f.input,data:'x',nativeEvent:{data:'x',isTrusted:true}});assert.equal(f.ctx.renderFixedPaceResult(),null);assert.equal(f.engine.currentResult,null);
});

test('last NPS media native-end pause preserves only its observed owned endpoint',async t=>{
 const f=await fixedSetup(t);f.ctx.changeCue(10,false,true);f.ctx.visualRef.current.referenceGuide=f.engine.cue.text;f.ctx.document.activeElement=f.input;f.ctx.armFollowAutoEntry(f.ctx.followAutoEpochRef.current,true);f.append(f.engine.cue.text);await tick();
 await advanceFixedMedia(f,(f.video.duration-f.video.currentTime-.01)*1000);f.video.currentTime=f.video.duration;f.video.paused=true;(f.video as any).ended=true;await f.advance(10);assert.equal(f.ctx.fixedPaceObserverRef.current.snapshot.phase,'ended');
 f.video.dispatchEvent(new Event('timeupdate'));f.video.dispatchEvent(new Event('pause'));f.ctx.submit();assert.ok(f.ctx.fixedPaceResult);assert.notEqual(f.ctx.fixedPaceResult.deltaMs,null);
});
test('unowned terminal-looking pause cannot preserve a stale source endpoint',async t=>{
 const f=await fixedSetup(t);f.append(f.engine.cue.text);await tick();await finishFixedSentence(f);f.video.currentSrc='blob:new-owner';(f.video as any).ended=true;f.video.dispatchEvent(new Event('pause'));assert.equal(f.ctx.fixedPaceObserverRef.current.snapshot.phase,'unknown');f.ctx.submit();assert.equal(f.ctx.fixedPaceResult,null);
});
