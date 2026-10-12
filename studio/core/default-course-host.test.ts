import {translate,translateKnownUi} from '../i18n/locale';
import { inactiveListeningTestScope } from './inactive-listening-test-fixture.mjs';
import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {IDBFactory} from 'fake-indexeddb';
import {TrainingEngine,type TrainingSnapshot} from './training';
import {NPS_MATERIAL} from './builtin-material';
import {IndexedDBTrainingRepository} from './repository';
import {TrainingHistoryRecorder} from './training-history-recorder';
import {readDefaultCourseBootstrap} from './default-course-bootstrap';
import {bindTrainingTabRecovery} from './training-tab-recovery';
import {flushReferenceTransition,assertReferenceTransitionBoundary} from './reference-transition';
const source=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8'),require=createRequire(import.meta.url),parser=require('next/dist/compiled/babel/parser'),swc=require('next/dist/build/swc');await swc.loadBindings();
const ast=parser.parse(source,{sourceType:'module',plugins:['typescript','jsx']});const studio=ast.program.body.find((n:any)=>n.type==='FunctionDeclaration'&&n.id?.name==='StudioContent');
const names=['continueSavedHistory','changeHistoryRecording','retryHistorySave'];
const functions=names.map(name=>{const n=studio.body.body.find((n:any)=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(n);return source.slice(n.start,n.end)}).join('\n');
const between=(start:string,end:string)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b)};
const construct=between('const engine=new TrainingEngine(','engineRef.current=engine;').replace('const engine=','return ');
const bootstrap=between('readDefaultCourseBootstrap(repo,',';let reconcileBusy=');
const queue=between(' const queueSave=',' async function changeHistoryRecording');
const lifecycle=between('const pageHide=','const observationBlur=');
const code=(await swc.transform(`${functions}\n${queue}\n${lifecycle}\nfunction makeEngine(){${construct}}\nasync function boot(){return ${bootstrap}}`,{jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}})).code;
const install=new Function('scope',`with(scope){${code};return {makeEngine,boot,queueSave,pageHide,pageShow,${names.join(',')}}}`);
const ref=(current:any)=>({current}),noop=()=>{};
async function setup(t:TestContext,{saved,search='',storage=new Map<string,string>(),database}:{saved?:TrainingSnapshot[];search?:string;storage?:Map<string,string>;database?:{factory:IDBFactory;name:string}}={}){
 database??={factory:new IDBFactory(),name:`boot-host-${crypto.randomUUID()}`};const repo=new IndexedDBTrainingRepository({indexedDB:database.factory,dbName:database.name});for(const s of saved??[])await repo.saveSession(s);
 const history=new TrainingHistoryRecorder(repo),notices:string[]=[],navigation:string[]=[],loaded:string[]=[],timers=new Map<number,()=>void>();let timer=0;
 class Recorder{getSnapshot(){return{state:'idle'}}async dispose(){}async prepare(){}subscribe(){return noop}}
 const ctx:any={ ...inactiveListeningTestScope(),locale:'zh-CN',localeRef:{current:'zh-CN'},t:translate.bind(null,'zh-CN'),ui:translateKnownUi.bind(null,'zh-CN'),TrainingEngine,NPS_MATERIAL,readDefaultCourseBootstrap,flushReferenceTransition,assertReferenceTransitionBoundary,crypto,URL,URLSearchParams,
  repo,history,repoRef:ref(repo),historyRef:ref(history),engineRef:ref(null),unsubscribe:noop,disposed:ref(false),life:ref(1),generation:1,
  // This storage/bootstrap fixture has no qualified native media. Match the
  // production initial scope without minting Follow authority from loadDemo's stub.
  followBootstrapEpoch:0,followSourceQualified:()=>false,
  window:{location:{href:`https://example.test/studio/${search}`,search,assign:(url:string)=>navigation.push(url)},history:{state:null,replaceState:(_state:unknown,_title:string,url:string)=>{ctx.window.location.href=url;ctx.window.location.search=new URL(url).search}}},document:{hidden:false,activeElement:null,hasFocus:()=>true},
  restoredSessionRef:ref(undefined),restoreFailedRef:ref(false),historyBindingPausedRef:ref(false),historyPageInactiveRef:ref(false),historyActionRef:ref(0),historyChannelRef:ref(null),
  inputProjectorRef:ref({observe:noop,attach:noop}),pageInputGateRef:ref({begin:noop,observe:noop}),performance:{now:()=>0},saveTimer:ref(null),
  setTimeout:(fn:()=>void)=>{timers.set(++timer,fn);return timer},clearTimeout:(id:number)=>timers.delete(id),
  setTemporaryHistory:(v:boolean)=>ctx.temporary=v,setReady:(v:boolean)=>ctx.ready=v,setRestoreFailed:(v:boolean)=>ctx.restoreFailed=v,setPaused:noop,syncDraft:noop,
  notify:(s:string)=>notices.push(s),loadDemo:async()=>{loaded.push(ctx.engineRef.current.getSnapshot().material.id)},restoreSavedReviewBinding:async()=>{},
  lesson:{pause:noop,removeAttribute:noop,load:noop},visualRef:ref({ready:false}),setMediaDuration:noop,
  referenceTransitionRef:ref(false),referenceBlocked:()=>ctx.referenceTransitionRef.current,composing:ref(false),fixture:false,replaySnapshot:ref(null),bookmarkRecordingBlocked:()=>false,
  setReferenceBusy:(v:boolean)=>ctx.referenceBusy=v,reviewTransitionRef:ref(false),stopReviewTracking:noop,reviewVerificationRef:ref(null),referenceActionRef:ref(0),referenceVerificationRef:ref(null),referencePreviewRef:ref(null),
  layoutTransactionsRef:ref({active:false}),cancelLayoutPreview:noop,soundRequestRef:ref(0),standbyAudioRef:ref(null),setSoundEnabled:noop,
  recordRequestToken:ref(0),recordPreparing:ref(false),setStartingRecord:noop,cameraToken:ref(0),cameraStreamRef:ref(null),releaseMix:noop,recorder:new Recorder(),exitHistorySave:null,
  inputRef:ref(null),mediaInteractedRef:ref(false),standbyPausedRef:ref(false),sceneMotionRef:ref({enteredAt:0,mediaChangedAt:0}),setStorageReady:noop,unsubRecorder:noop,cameraRef:ref(null),setCameraState:noop,SceneRecorder:Recorder,recorderRef:ref(null),observedRecorder:null,onRecorderChange:noop,setStorageError:noop,
 };
 ctx.tabRecovery=bindTrainingTabRecovery({storage:()=>({getItem:key=>storage.get(key)??null,setItem:(key,value)=>{storage.set(key,value)},removeItem:key=>{storage.delete(key)}}),repository:repo,history,snapshot:()=>ctx.engineRef.current?.getSnapshot()??null,isCurrent:()=>!ctx.disposed.current&&ctx.generation===ctx.life.current,onError:()=>ctx.recoveryStorageError=true});
 Object.assign(ctx,install(ctx));ctx.engine=ctx.makeEngine();ctx.engineRef.current=ctx.engine;ctx.unsubscribe=ctx.engineRef.current.subscribe(ctx.queueSave);await ctx.boot();
 t.after(async()=>{ctx.unsubscribe();ctx.tabRecovery.dispose();history.dispose();await repo.close()});
 return{ctx,repo,history,notices,navigation,loaded,timers,storage,database,get engine(){return ctx.engineRef.current as TrainingEngine},async flushTimers(){for(const fn of timers.values())fn();timers.clear();await history.flush()}};
}
function savedCoffee(){const e=new TrainingEngine({sessionId:`coffee-${crypto.randomUUID()}`});e.input(e.cue.text);e.submit();e.nextCue();e.input('unfinished original coffee');e.setFrozen('idle',true);return e.getSnapshot()}
test('actual ordinary Studio bootstrap shows NPS and does not save a replacement over coffee, including bfcache',async t=>{const old=savedCoffee(),f=await setup(t,{saved:[old]});assert.deepEqual(f.loaded,[NPS_MATERIAL.id]);assert.equal(f.engine.isAwaitingInitialInput,true);assert.equal(f.history.isFreshPreview,true);f.engine.exposeHint('reveal');f.engine.nextCue(2);f.engine.setFrozen('modal',true);await f.flushTimers();assert.equal((await f.repo.loadLatest())!.sessionId,old.sessionId);f.ctx.pageHide();await f.ctx.exitHistorySave;await f.ctx.pageShow({persisted:true});await f.flushTimers();assert.equal(f.history.isFreshPreview,true);assert.deepEqual((await f.repo.loadHistorySession(old.sessionId))!.snapshot,old);assert.equal((await f.repo.listHistory()).entries.length,1);f.engine.setFrozen('modal',false);f.engine.input('first actual NPS answer');await f.flushTimers();assert.equal((await f.repo.loadLatest())!.sessionId,f.engine.getSnapshot().sessionId);assert.deepEqual((await f.repo.loadHistorySession(old.sessionId))!.snapshot,old)});
test('actual fresh Studio bootstrap has usable legacy controls but no fake saved source',async t=>{const f=await setup(t);assert.equal(f.ctx.ready,true);assert.equal(f.history.getSnapshot().mode,'legacy');assert.equal(f.history.getCommittedReviewSession(),null);await f.ctx.retryHistorySave();assert.match(f.notices.at(-1)!,/尚未输入/);assert.equal((await f.repo.listHistory()).entries.length,0);await f.ctx.changeHistoryRecording(false);f.engine.input('PRIVATE_PREVIEW');await f.flushTimers();assert.equal((await f.repo.listHistory()).entries.length,0);await f.ctx.changeHistoryRecording(true);assert.equal(f.history.getSnapshot().mode,'segment')});
test('actual explicit history action preserves current NPS before navigating to exact coffee id/sequence',async t=>{const old=savedCoffee(),f=await setup(t,{saved:[old]});f.engine.input('keep current NPS draft');const current=f.engine.getSnapshot();await f.ctx.continueSavedHistory(old);assert.equal(f.navigation.length,1);const url=new URL(f.navigation[0]);assert.equal(url.searchParams.get('resume'),old.sessionId);assert.equal(url.searchParams.get('resumeSequence'),String(old.sequence));assert.deepEqual((await f.repo.loadHistorySession(current.sessionId))!.snapshot,current);assert.deepEqual((await f.repo.loadHistorySession(old.sessionId))!.snapshot,old);const restored=await setup(t,{saved:[old,current],search:url.search});assert.equal(restored.engine.isPassiveRestored,true);assert.deepEqual(restored.engine.getSnapshot(),old);assert.deepEqual(restored.loaded,[old.material.id])});
for(const fault of ['dirty save','privacy generation','stale selected','OFF temporary'] as const)test(`actual history continuation retains current work on ${fault}`,async t=>{const old=savedCoffee(),f=await setup(t,{saved:[old]});f.engine.input('current draft must survive');const current=f.engine.getSnapshot();let selected=old;
 if(fault==='dirty save')f.repo.saveSession=async()=>{throw Error('quota')};
 if(fault==='privacy generation'){const read=f.repo.loadHistorySession.bind(f.repo);f.repo.loadHistorySession=async id=>{const value=await read(id);await f.repo.disableAutomaticHistory(0);return value}}
 if(fault==='stale selected')selected={...old,sequence:old.sequence+1};
 if(fault==='OFF temporary')await f.ctx.changeHistoryRecording(false);
 await f.ctx.continueSavedHistory(selected);assert.equal(f.navigation.length,0);assert.deepEqual(f.engine.getSnapshot(),current);assert.equal(f.ctx.referenceTransitionRef.current,false);assert.ok(f.notices.length>0)
});
test('actual resume URL with stale sequence fails visibly instead of replacing with fresh NPS',async t=>{const old=savedCoffee(),f=await setup(t,{saved:[old],search:`?resume=${old.sessionId}&resumeSequence=${old.sequence+1}`});assert.equal(f.ctx.restoreFailed,true);assert.deepEqual(f.loaded,[]);assert.equal(f.history.getSnapshot().mode,'unprepared');assert.deepEqual((await f.repo.loadHistorySession(old.sessionId))!.snapshot,old)});

test('validated one-time sequence is consumed so resumed coffee can save and refresh',async t=>{const old=savedCoffee(),f=await setup(t,{saved:[old],search:`?resume=${old.sessionId}&resumeSequence=${old.sequence}`});assert.equal(new URL(f.ctx.window.location.href).searchParams.has('resumeSequence'),false);assert.equal(new URL(f.ctx.window.location.href).searchParams.get('resume'),old.sessionId);f.engine.input('resumed coffee new draft');await f.flushTimers();const saved=(await f.repo.loadHistorySession(old.sessionId))!.snapshot;assert.ok(saved.sequence>old.sequence);const refresh=await setup(t,{saved:[saved],search:f.ctx.window.location.search});assert.equal(refresh.ctx.restoreFailed,undefined);assert.deepEqual(refresh.engine.getSnapshot(),saved);const ordinary=await setup(t,{saved:[saved]});assert.equal(ordinary.engine.getSnapshot().material.id,NPS_MATERIAL.id)});
test('a later explicit session switch clears old resume selection before refresh',async t=>{const old=savedCoffee(),f=await setup(t,{saved:[old],search:`?resume=${old.sessionId}&resumeSequence=${old.sequence}`});f.ctx.historyBindingPausedRef.current=true;f.engine.startReferenceSession(NPS_MATERIAL,0);f.ctx.historyBindingPausedRef.current=false;f.history.connect(f.engine.getSnapshot(),{state:'legacy-default',generation:0});f.ctx.queueSave();await f.flushTimers();const url=new URL(f.ctx.window.location.href);assert.equal(url.searchParams.has('resume'),false);assert.equal(url.searchParams.has('resumeSequence'),false);const current=(await f.repo.loadLatest())!;const refresh=await setup(t,{saved:[old,current],search:url.search});assert.equal(refresh.engine.getSnapshot().sessionId,current.sessionId);assert.equal(refresh.engine.getSnapshot().material.id,NPS_MATERIAL.id)});
test('new tabs without a committed locator restore the same existing NPS even after coffee was last saved',async t=>{const n=new TrainingEngine({material:NPS_MATERIAL,sessionId:'saved-nps-repeat'});n.input('retained NPS draft');n.setFrozen('idle',true);const saved=n.getSnapshot(),coffee=savedCoffee();for(let i=0;i<3;i++){const f=await setup(t,{saved:[saved,coffee]});assert.equal(f.engine.getSnapshot().sessionId,saved.sessionId);assert.equal(f.engine.isPassiveRestored,true);assert.deepEqual(f.engine.getSnapshot(),saved);assert.deepEqual(f.loaded,[NPS_MATERIAL.id]);await f.flushTimers();assert.equal((await f.repo.listHistory()).entries.length,2);assert.equal((await f.repo.loadLatest())!.sessionId,coffee.sessionId)}});
test('history detail exposes an explicit continuation command without changing read-only selection',async()=>{const panel=await readFile(new URL('../components/LegacyHistoryPanel.tsx',import.meta.url),'utf8');assert.match(panel,/t\('history.continue'\)/);assert.equal(translate('zh-CN','history.continue'),'继续这次已保存练习');assert.match(panel,/onContinue\(snapshot\)/);assert.match(panel,/reader\.select\(entry\.summary\.sessionId\)/);assert.match(source,/onContinue=\{continueSavedHistory\}/);assert.doesNotMatch(panel,/saveSession\(|startReferenceSession\(|new TrainingEngine/)});

test('same-tab ordinary refresh restores the committed café selection and exact draft instead of the NPS default',async t=>{
 const f=await setup(t);f.ctx.historyBindingPausedRef.current=true;f.engine.startReferenceSession(savedCoffee().material,0);f.ctx.historyBindingPausedRef.current=false;f.history.connect(f.engine.getSnapshot(),{state:'legacy-default',generation:0});f.ctx.queueSave();
 f.engine.input('First line\nSecond line\nThird line x','paste');await f.flushTimers();const saved=f.engine.getSnapshot();
 const refresh=await setup(t,{storage:f.storage,database:f.database});assert.deepEqual(refresh.engine.getSnapshot(),saved);assert.deepEqual(refresh.loaded,[saved.material.id]);assert.equal(refresh.engine.isPassiveRestored,true);assert.equal(refresh.history.getSnapshot().dirty,false);
 const freshTab=await setup(t,{database:f.database});assert.equal(freshTab.engine.getSnapshot().material.id,NPS_MATERIAL.id);assert.deepEqual((await freshTab.repo.loadHistorySession(saved.sessionId))!.snapshot,saved);
});
test('missing tab restore target is visible in actual host and never loads or saves a blank replacement',async t=>{
 const f=await setup(t);f.engine.input('retained NPS');await f.flushTimers();const saved=f.engine.getSnapshot();
 const key=[...f.storage.keys()][0];f.storage.set(key,JSON.stringify({version:1,sessionId:'missing',sequence:1}));
 const refresh=await setup(t,{storage:f.storage,database:f.database});assert.equal(refresh.ctx.restoreFailed,true);assert.deepEqual(refresh.loaded,[]);assert.equal(refresh.history.getSnapshot().mode,'unprepared');await refresh.flushTimers();assert.deepEqual((await refresh.repo.loadLatest())!,saved);assert.ok(refresh.notices.some(n=>n.includes('未清空')));
});

test('actual status-strip JSX never calls a dirty/debounced tail saved and surfaces tab storage failure',async t=>{
 const f=await setup(t);f.engine.input('first committed');await f.flushTimers();assert.equal(f.repo.getStatus().state,'persisted');
 const statusLine=source.split('\n').find(line=>line.includes('<div className="status-strip"'))!.trim();
 const compiled=(await swc.transform(`function renderStatus(){return (${statusLine});}`,{jsc:{parser:{syntax:'typescript',tsx:true},target:'es2022',transform:{react:{runtime:'classic'}}},module:{type:'commonjs'}})).code;
 const render=new Function('scope',`with(scope){${compiled};return renderStatus()}`),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const html=(recoveryStorageError=false)=>renderToStaticMarkup(render({React,historyStatus:f.history.getSnapshot(),persistence:f.repo.getStatus(),historyRef:f.ctx.historyRef,t:translate.bind(null,'en'),fixture:false,replayIndex:null,mediaKind:'demo',restoreFailed:false,recoveryStorageError,openPanel:noop,pauseTraining:noop,paused:false,togglePlay:noop}));
 assert.match(html(),/Saved on this device/);f.engine.input('first committed plus unsaved tail');assert.equal(f.history.getSnapshot().dirty,true);assert.equal(f.repo.getStatus().state,'persisted');assert.doesNotMatch(html(),/Saved on this device/);assert.match(html(),/Saving/);await f.flushTimers();assert.match(html(),/Saved on this device/);assert.match(html(true),/Refresh recovery unavailable/);assert.doesNotMatch(html(true),/Saved on this device/);
});

test('unreadable tab storage triggers the actual visible recovery failure without touching existing records',async t=>{
 const f=await setup(t);f.engine.input('saved before storage block');await f.flushTimers();const saved=f.engine.getSnapshot(),storage=new Map(f.storage);storage.get=()=>{throw Error('sessionStorage blocked')};
 const refresh=await setup(t,{storage,database:f.database});assert.equal(refresh.ctx.restoreFailed,true);assert.deepEqual(refresh.loaded,[]);assert.equal(refresh.history.getSnapshot().mode,'unprepared');await refresh.flushTimers();assert.deepEqual((await refresh.repo.loadHistorySession(saved.sessionId))!.snapshot,saved);
});
