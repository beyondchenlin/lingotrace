import { inactiveListeningTestScope } from './inactive-listening-test-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {IDBFactory} from 'fake-indexeddb';
import {TrainingEngine, replay, exportSession} from './training.ts';
import {IndexedDBTrainingRepository} from './repository.ts';
import {TrainingHistoryRecorder} from './training-history-recorder.ts';


export const source=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
const require=createRequire(import.meta.url);
const swc=require('next/dist/build/swc');await swc.loadBindings();
async function compile(code:string){return (await swc.transform(code,{jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}})).code;}
const between=(start:string,end:string)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,`Missing actual source boundary ${start}`);return source.slice(a,b)};
const bootstrap=await compile(between('const restored=new TrainingEngine','engineRef.current=restored;')+'engineRef.current=restored;');
const panels=await compile(between(' async function openPanel',' function submit('));
// These history-only pages have no recording owner, but execute the real interruption guard.
const visibility=await compile(between(' function interruptPracticeRecording(', ' async function openPanel(')+between('const visibility=','const beforeUnload=').replace('const visibility=','var visibility='));
const connect=await compile(between('if(saved&&engineRef.current!.isPassiveRestored)','setTemporaryHistory(temporary)'));
const beforeUnload=await compile(between('const beforeUnload=','const pageHide=').replace('const beforeUnload=','var beforeUnload='));
const lifecycle=await compile(between('const pageHide=','const observationBlur=').replace('const pageHide=','var pageHide=').replace('const pageShow=','var pageShow='));
const ref=(current:any)=>({current});
const noop=()=>{};
function settledFixture(){
 let serial=0,now=0;const clock={now:()=>now,id:()=>`settled-${++serial}`,wallTime:()=>new Date(1700000000000+now).toISOString()};
 const engine=new TrainingEngine({clock});
 for(let i=0;i<2;i++){engine.input('draft');engine.submit();engine.input('wrong');engine.submit();engine.input(engine.cue.text);engine.submit();engine.nextCue()}
 engine.input('retained third draft');engine.setFrozen('idle',true);engine.setFrozen('modal',true);return engine.getSnapshot();
}
export const baseline=settledFixture();
export const learning=(s:any)=>Object.fromEntries(['sessionId','roundId','cueIndex','drafts','attempts','earnedWords','confirmedPositions','completedCueIds','activeMs','pendingAttempts'].map(k=>[k,s[k]]));
export const database=()=>({factory:new IDBFactory(),name:`passive-v61-${crypto.randomUUID()}`});
export function repoFor(db:any){return new IndexedDBTrainingRepository({indexedDB:db.factory,dbName:db.name})}
export async function readRaw(db:any){
 const conn=await new Promise<IDBDatabase>((resolve,reject)=>{const r=db.factory.open(db.name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 try{return await new Promise((resolve,reject)=>{const tx=conn.transaction(['sessions','events','meta'],'readonly'),result:Record<string,unknown>={};for(const name of ['sessions','events','meta']){const r=tx.objectStore(name).getAll();r.onsuccess=()=>{result[name]=r.result}}tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(tx.error)});}finally{conn.close()}
}
export async function seed(db:any,snapshot=baseline){const repo=repoFor(db);await repo.saveSession(snapshot);await repo.close()}
export async function page(db:any,id:string,{normalize=true,snapshot}:{normalize?:boolean,snapshot?:import('./training.ts').TrainingSnapshot}={}){
 const repo=repoFor(db),saved=snapshot??await repo.loadLatest();assert.ok(saved);
 let serial=0,now=id==='A'?10000:20000,saveCalls=0;
 const clock={now:()=>now,id:()=>`${id}-${++serial}`,wallTime:()=>new Date(1800000000000+now).toISOString()};
 class PageEngine extends TrainingEngine{constructor(options:import('./training.ts').EngineOptions){super({...options,clock})}}
 class TestRecorder{getSnapshot(){return {state:'idle'}}async dispose(){}async prepare(){}subscribe(){return noop}async list(){return []}async refreshStorageEstimate(){}}
 const e=new PageEngine({snapshot:saved,restoredReadOnly:true,inputObservation:{runId:`run-${id}`}});
 const notices:string[]=[],state:any={panel:null,review:null,recordings:null,ready:false,temporary:false};
 const ctx=vm.createContext({ ...inactiveListeningTestScope(),courseLoadRequest:ref(0),reviewMediaRequestRef:ref(null),reviewTransitionRef:ref(false),reviewStartFailureRef:ref(null),reviewVerificationRef:ref(null),stopReviewTracking:noop,restoreSavedReviewBinding:async()=>{},referenceBlocked:()=>false,referenceTransitionRef:ref(false),referenceConfirmationRef:ref(null),referencePanelRef:ref(false),referenceActionRef:ref(0),referencePreviewRef:ref(null),referenceVerificationRef:ref(null),correctedPlayRequest:ref(0),correctedPlayOwner:ref(null),TrainingEngine:PageEngine,saved,control:{state:'legacy-default',generation:0},crypto:{randomUUID:()=>`run-${id}`},
  engineRef:ref(e),history:null,document:{hidden:false,activeElement:{focus:noop},hasFocus:()=>true},
  layoutTransactionsRef:ref({active:false}),visualRef:ref({fixture:false}),replaySnapshot:ref(null),
  submissionSound:{audio:ref({cancel:noop})},lastFocus:ref(null),previewURL:ref(null),exportRef:ref(null),
  recorderRef:ref(new TestRecorder()),recorder:new TestRecorder(),SceneRecorder:TestRecorder,
  lesson:{pause:noop},restoredSessionRef:ref(saved.sessionId),restoreFailedRef:ref(false),
  notify:(m:string)=>notices.push(m),setPanel:(v:unknown)=>{state.panel=v},setReviewSnapshot:(v:unknown)=>{state.review=v},setRecordings:(v:unknown)=>{state.recordings=v},
  startLayoutPreview:()=>true,cancelLayoutPreview:noop,setMutedRecord:noop,clearRecordingPreview:noop,cancelRecordingPreparation:noop,
  setToolsOpen:noop,setPreview:noop,setPreviewInfo:noop,setDeleteId:noop,setResetPrompt:noop,syncDraft:noop,
  requestAnimationFrame:(fn:()=>void)=>fn(),URL:{revokeObjectURL:noop},INITIAL_PREVIEW_INFO:{},exportSession,
  historyPageInactiveRef:ref(false),saveTimer:ref(null),soundRequestRef:ref(0),standbyAudioRef:ref(null),recordRequestToken:ref(0),recordInputRef:ref(null),activeRecordInputRef:ref(null),recordPreparing:ref(false),cameraToken:ref(0),cameraStreamRef:ref(null),cameraRef:ref(null),inputRef:ref(null),
  setSoundEnabled:noop,setStartingRecord:noop,releaseMix:noop,exitHistorySave:null,repo,disposed:ref(false),generation:1,life:ref(1),
  setReady:(value:boolean)=>{state.ready=value},setTemporaryHistory:(value:boolean)=>{state.temporary=value},setRestoreFailed:noop,
  pageInputGateRef:ref({begin:noop}),mediaInteractedRef:ref(false),standbyPausedRef:ref(false),sceneMotionRef:ref({enteredAt:0,mediaChangedAt:0}),
  setStorageReady:noop,unsubRecorder:noop,setCameraState:noop,observedRecorder:null,onRecorderChange:noop,setStorageError:noop,clearTimeout:noop,performance:{now:()=>now},
 });
 if(normalize)vm.runInContext(bootstrap,ctx);
 const engine:TrainingEngine=ctx.engineRef.current,history=new TrainingHistoryRecorder(repo,{clock:{id:clock.id,wallTime:clock.wallTime},writerInstanceId:`writer-${id}`});
 ctx.history=history;ctx.control={state:'legacy-default',generation:0};vm.runInContext(connect,ctx);
 const save=repo.saveSession.bind(repo);repo.saveSession=async s=>{saveCalls++;return save(s)};
 const unsub=engine.subscribe(()=>history.observe(engine.getSnapshot()));
 vm.runInContext(panels+visibility+beforeUnload+lifecycle,ctx);
 return {engine,history,repo,ctx,state,notices,get saveCalls(){return saveCalls},advance:(ms:number)=>{now+=ms},
  async browse(names=['review','bookmarks','history','data','library']){for(const name of names){now+=100;await ctx.openPanel(name);now+=100;ctx.closePanel(false)}},
  async hiddenRoundTrip(){ctx.document.hidden=true;ctx.visibility();await history.flush();now+=30000;ctx.document.hidden=false;ctx.visibility()},
  async pageHide(){ctx.pageHide();await ctx.exitHistorySave;await Promise.resolve()},
  async pageShow(){await ctx.pageShow({persisted:true})},
  async close(){unsub();history.dispose();await repo.close()},
 };
}


test('actual restore/panel handlers: two passive pages leave sessions/events/latest and all learning facts unchanged',async t=>{
 const db=database();await seed(db);const before=await readRaw(db),a=await page(db,'A'),b=await page(db,'B');t.after(()=>Promise.all([a.close(),b.close()]));
 assert.equal(baseline.earnedWords,13);assert.equal(baseline.completedCueIds.length,2);assert.equal(baseline.attempts.length,6);
 assert.equal(a.engine.isPassiveRestored,true);assert.equal(b.engine.isPassiveRestored,true);
 for(let i=0;i<3;i++){await a.browse();await b.browse();await a.hiddenRoundTrip();await b.hiddenRoundTrip();a.advance(60000);a.engine.sampleClock();b.engine.tick(60000);await a.history.flush();await b.history.flush()}
 assert.deepEqual(a.engine.getSnapshot(),baseline);assert.deepEqual(b.engine.getSnapshot(),baseline);assert.deepEqual(await readRaw(db),before);
 assert.equal(a.saveCalls+b.saveCalls,0);assert.equal(a.history.getSnapshot().dirty,false);assert.equal(b.history.getSnapshot().error,null);
 let prevented=false;b.ctx.beforeUnload({preventDefault(){prevented=true},returnValue:''});assert.equal(prevented,false);
});

test('a passive page does not write over a peer, and its later first genuine answer still conflicts safely',async t=>{
 const db=database();await seed(db);const a=await page(db,'A'),b=await page(db,'B');t.after(()=>Promise.all([a.close(),b.close()]));
 await a.browse();a.engine.input('first real answer');await a.history.flush();const stored=await readRaw(db);
 await b.browse();await b.history.flush();assert.equal(b.saveCalls,0);assert.deepEqual(await readRaw(db),stored);
 b.engine.input('different stale answer');await b.history.flush();assert.match(b.repo.getStatus().error!,/changed in another tab/);assert.equal(b.history.getSnapshot().dirty,true);assert.deepEqual(await readRaw(db),stored);
 assert.equal(JSON.parse(exportSession(b.engine.getSnapshot()).json).session.drafts[b.engine.cue.id].text,'different stale answer');
 assert.deepEqual(b.engine.getSnapshot().events.slice(0,baseline.sequence),baseline.events);
});

test('remote OFF after passive restore is still enforced by the unchanged same-transaction repository fence',async t=>{
 const db=database();await seed(db);const a=await page(db,'A'),peer=repoFor(db);t.after(()=>Promise.all([a.close(),peer.close()]));
 await peer.disableAutomaticHistory(0);const before=await readRaw(db);await a.browse();await a.history.flush();assert.equal(a.saveCalls,0);
 a.engine.input('private actual answer');await a.history.flush();assert.match(a.history.getSnapshot().error!,/尚未保存/);assert.deepEqual(await readRaw(db),before);
});

test('active modal and background boundaries keep counting only the original unblocked intervals',async t=>{
 const db=database();await seed(db);const a=await page(db,'A');t.after(()=>a.close());a.ctx.closePanel(false);a.engine.input('first real answer');const active=a.engine.getSnapshot().activeMs;
 a.advance(1000);await a.ctx.openPanel('review');assert.equal(a.engine.getSnapshot().activeMs,active+1000);
 a.advance(30000);a.ctx.closePanel(false);assert.equal(a.engine.getSnapshot().activeMs,active+1000);
 a.advance(1000);await a.hiddenRoundTrip();assert.equal(a.engine.getSnapshot().activeMs,active+2000);assert.equal(a.engine.isPassiveRestored,false);
});

test('actual pagehide/pageshow handlers keep only the untouched passive original baseline clean across bfcache',async t=>{
 const db=database();await seed(db);const before=await readRaw(db),a=await page(db,'A');t.after(()=>a.close());
 for(let i=0;i<3;i++){await a.browse();a.ctx.document.hidden=true;a.ctx.visibility();await a.pageHide();assert.equal(a.history.getSnapshot().mode,'unprepared');a.advance(60000);a.ctx.document.hidden=false;await a.pageShow();assert.equal(a.history.getSnapshot().mode,'legacy');assert.equal(a.history.getSnapshot().dirty,false)}
 assert.equal(a.engine.isPassiveRestored,true);assert.deepEqual(a.engine.getSnapshot(),baseline);assert.deepEqual(await readRaw(db),before);assert.equal(a.saveCalls,0);
});

test('actual bfcache return after practice never reenters passive or uses the clean admission',async t=>{
 const db=database();await seed(db);const a=await page(db,'A');t.after(()=>a.close());a.ctx.closePanel(false);a.engine.input('active before bfcache');
 a.advance(500);a.ctx.document.hidden=true;a.ctx.visibility();await a.pageHide();const active=a.engine.getSnapshot().activeMs;a.advance(60000);a.ctx.document.hidden=false;await a.pageShow();
 assert.equal(a.engine.isPassiveRestored,false);assert.equal(a.engine.draft,'active before bfcache');assert.equal(a.engine.getSnapshot().activeMs,active);assert.equal(a.history.getSnapshot().dirty,true);
 await a.history.flush();assert.equal(a.history.getSnapshot().error,null);assert.ok(a.saveCalls>=2);assert.equal((await a.repo.loadLatest())!.drafts[a.engine.cue.id].text,'active before bfcache');
});

test('actual bfcache recheck failure leaves history unprepared rather than granting a clean saved status',async t=>{
 const db=database();await seed(db);const a=await page(db,'A');t.after(()=>a.close());await a.pageHide();a.repo.readAutomaticHistoryControl=async()=>{throw Error('read unavailable')};await a.pageShow();
 assert.equal(a.ctx.restoreFailedRef.current,true);assert.equal(a.history.getSnapshot().mode,'unprepared');assert.equal(a.saveCalls,0);assert.deepEqual(a.engine.getSnapshot(),baseline);assert.match(a.notices.at(-1)!,/未能恢复/);
});

test('actual bfcache OFF recheck revokes clean legacy capability and leaves later practice private',async t=>{
 const db=database();await seed(db);const a=await page(db,'A'),peer=repoFor(db);t.after(()=>Promise.all([a.close(),peer.close()]));await a.pageHide();await peer.disableAutomaticHistory(0);const before=await readRaw(db);await a.pageShow();
 assert.equal(a.history.getSnapshot().mode,'off');assert.equal(a.state.temporary,true);a.engine.input('private after return');await a.history.flush();assert.deepEqual(await readRaw(db),before);assert.equal(a.saveCalls,0);
});

test('a failed active pagehide write is still dirty/exportable on return and a later real retry saves it',async t=>{
 const db=database();await seed(db);const a=await page(db,'A');t.after(()=>a.close());a.engine.input('retained pending failure');const original=a.repo.saveSession.bind(a.repo);a.repo.saveSession=async()=>{throw Error('quota')};await a.pageHide();await a.pageShow();
 assert.equal(a.engine.isPassiveRestored,false);assert.equal(a.history.getSnapshot().dirty,true);assert.equal(a.engine.draft,'retained pending failure');assert.equal(JSON.parse(exportSession(a.engine.getSnapshot()).json).session.drafts[a.engine.cue.id].text,'retained pending failure');
 a.repo.saveSession=original;await a.history.flush();assert.equal(a.history.getSnapshot().error,null);assert.equal((await a.repo.loadLatest())!.drafts[a.engine.cue.id].text,'retained pending failure');
});
