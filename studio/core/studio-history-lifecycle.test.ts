import {translate} from '../i18n/locale';
import { inactiveListeningTestScope } from './inactive-listening-test-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {IDBFactory} from 'fake-indexeddb';
import {TrainingEngine} from './training.ts';
import {IndexedDBTrainingRepository} from './repository.ts';
import {TrainingHistoryRecorder} from './training-history-recorder.ts';

const source=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
const defaultBootstrap=await readFile(new URL('./default-course-bootstrap.ts',import.meta.url),'utf8');
const start=source.indexOf(' const queueSave='),end=source.indexOf('\n const syncDraft=',start);
assert.ok(start>=0&&end>start);
const swc=createRequire(import.meta.url)('next/dist/build/swc');await swc.loadBindings();
const {code}=await swc.transform(source.slice(start,end).replace(' const queueSave=','var queueSave='),{jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}});
const ref=(current:unknown)=>({current});
async function setup(t:any){
 let serial=0,now=0;const clock={id:()=>`source-${++serial}`,now:()=>now,wallTime:()=>new Date(1700000000000+now).toISOString()};
 const engine=new TrainingEngine({clock}),repo=new IndexedDBTrainingRepository({dbName:`ui-history-${crypto.randomUUID()}`,indexedDB:new IDBFactory()});
 const history=new TrainingHistoryRecorder(repo,{clock:{id:()=>`segment-${++serial}`,wallTime:clock.wallTime}});history.connect(engine.getSnapshot(),{state:'legacy-default',generation:0});
 const notices:string[]=[],timers=new Map<number,()=>void>();let timer=0;
 const context=vm.createContext({ ...inactiveListeningTestScope(),reviewTransitionRef:ref(false),stopReviewTracking(){},referenceBlocked:()=>false,referenceTransitionRef:ref(false),submissionSound:{audio:{current:{cancel(){},play(){}}}},
   engineRef:ref(engine),repoRef:ref(repo),historyRef:ref(history),historyActionRef:ref(0),disposed:ref(false),life:ref(1),historyBindingPausedRef:ref(false),historyPageInactiveRef:ref(false),restoredSessionRef:ref(null),restoreFailedRef:ref(false),saveTimer:ref(null),
   inputProjectorRef:ref({observe(){}}),pageInputGateRef:ref({observe(){},begin(){}}),historyChannelRef:ref({postMessage(){}}),lessonRef:ref({pause(){}}),sceneMotionRef:ref({enteredAt:0,mediaChangedAt:0}),mediaInteractedRef:ref(false),standbyPausedRef:ref(false),
   newRoundBusy:false,performance:{now:()=>now},setTimeout:(fn:()=>void)=>{timers.set(++timer,fn);return timer},clearTimeout:(id:number)=>timers.delete(id),
   notify:(message:string)=>notices.push(message),setNewRoundBusy:(value:boolean)=>{context.newRoundBusy=value},setRestoreFailed(){},setTemporaryHistory(){},setPaused(){},setShowSubtitle(){},syncDraft(){},seekTo(){},closePanel(){},
 });
 vm.runInContext(code,context);const unsubscribe=engine.subscribe(()=>context.queueSave());
 t.after(async()=>{unsubscribe();history.dispose();await repo.close()});
 return {engine,repo,history,c:context,notices,advance:(ms:number)=>{now+=ms},timers};
}
const edit=(e:TrainingEngine,text:string,data=text)=>e.input(text,'typed',{version:'dom-edit-v1',kind:'input',inputType:text?'insertText':'deleteContentBackward',data:text?data:null});
test('shipped Studio queue and settings keep OFF content out of retained history while live scoring continues',async t=>{
 const {engine,repo,history,c}=await setup(t);edit(engine,'saved prefix');await history.flush();const saved=await repo.loadLatest();
 await c.changeHistoryRecording(false);edit(engine,'OFF_PRIVATE_NATIVE_SENTINEL');engine.submit();const beforeOn=engine.getSnapshot();await history.flush();
 await c.changeHistoryRecording(true);assert.strictEqual(engine.getSnapshot(),beforeOn);edit(engine,'OFF_PRIVATE_NATIVE_SENTINEL extra',' extra');engine.submit();await history.flush();
 edit(engine,'');edit(engine,'A table for two, please.');engine.submit();await history.flush();
 assert.equal(engine.getSnapshot().sessionId,beforeOn.sessionId);assert.equal(engine.getSnapshot().attempts.length,3);assert.ok(engine.getSnapshot().attempts[0].answer.includes('OFF_PRIVATE'));
 assert.deepEqual(await repo.loadLatest(),saved);const list=await repo.listTrainingHistorySegments();assert.equal(list.entries.length,1);const segment=await repo.loadTrainingHistorySegment(list.entries[0].segmentId);
 assert.ok(!JSON.stringify(segment).includes('OFF_PRIVATE'));assert.ok(JSON.stringify(segment).includes('A table for two'));assert.equal(history.getSnapshot().mode,'segment');
});
test('shipped new round rebinds history only for an explicit reset, preserving OFF and saved prefixes',async t=>{
 const {engine,repo,history,c}=await setup(t);edit(engine,'old saved');await history.flush();await c.changeHistoryRecording(false);edit(engine,'OFF_NEW_ROUND_PRIVATE');const old=engine.getSnapshot().sessionId;
 await c.beginNewRound();assert.notEqual(engine.getSnapshot().sessionId,old);assert.equal(history.getSnapshot().mode,'off');edit(engine,'still private');await history.flush();assert.equal((await repo.listHistory()).entries.length,1);assert.equal((await repo.listTrainingHistorySegments()).entries.length,0);
 await c.changeHistoryRecording(true);edit(engine,'');edit(engine,'first recorded');await history.flush();const before=engine.getSnapshot().sessionId;
 await c.beginNewRound();assert.notEqual(engine.getSnapshot().sessionId,before);assert.equal(history.getSnapshot().mode,'segment');edit(engine,'second recorded');await history.flush();assert.equal((await repo.listTrainingHistorySegments()).entries.length,2);
});
test('shipped new round refuses to discard dirty history after a write failure',async t=>{
 const {engine,repo,history,c,notices}=await setup(t);edit(engine,'unsaved');const id=engine.getSnapshot().sessionId;repo.saveSession=async()=>{throw Error('quota')};
 await c.beginNewRound();assert.equal(engine.getSnapshot().sessionId,id);assert.equal(history.getSnapshot().dirty,true);assert.match(notices.at(-1)!,/尚未保存/);assert.equal(c.newRoundBusy,false);
});
test('actual Studio has no raw snapshot persistence or partial replay path outside the permission adapter',()=>{
 assert.equal(/(?:repo|repoRef\.current)[?.]*\.saveSession\(/.test(source),false);
 assert.ok(source.includes('readDefaultCourseBootstrap(repo,'));assert.ok(defaultBootstrap.includes('readTrainingHistoryBootstrap(repository)'));assert.ok(source.includes('history.suspend();historyPageInactiveRef.current=false'));
 assert.ok(source.includes('historyPageInactiveRef.current||restoredSessionRef'));
 assert.ok(!source.includes('replay(segment'));assert.ok(source.includes("t('data.temporaryNotice')"));assert.ok(translate('zh-CN','data.temporaryNotice').includes('可能包含关闭自动历史期间的临时内容'));
});

test('new round cannot erase an unknown-settings restore error',async t=>{
 const {engine,history,c,notices}=await setup(t);history.suspend();c.historyRef.current=new TrainingHistoryRecorder(c.repoRef.current);c.restoreFailedRef.current=true;const before=engine.getSnapshot();
 await c.beginNewRound();assert.strictEqual(engine.getSnapshot(),before);assert.equal(c.restoreFailedRef.current,true);assert.match(notices.at(-1)!,/恢复历史设置/);c.historyRef.current.dispose();
});
test('late settings completion after a newer OFF intent cannot announce successful ON',async t=>{
 const {history,c,notices}=await setup(t);await c.changeHistoryRecording(false);notices.length=0;
 const on=c.changeHistoryRecording(true),off=c.changeHistoryRecording(false);await Promise.all([on,off]);assert.equal(history.getSnapshot().mode,'off');assert.ok(!notices.some(n=>n.includes('已从现在开始记录')));
});
test('unmounted new-round continuation never resets the live attempt',async t=>{
 const {engine,history,c}=await setup(t);const before=engine.getSnapshot();let release!:()=>void,entered!:()=>void;const enteredFlush=new Promise<void>(resolve=>{entered=resolve});history.flush=()=>new Promise(resolve=>{release=resolve;entered()});
 const pending=c.beginNewRound();await enteredFlush;assert.equal(typeof release,'function','inactive listening transition reaches the held history flush');c.disposed.current=true;c.life.current++;release();await pending;assert.strictEqual(engine.getSnapshot(),before);
});

test('bfcache failed recheck cannot reuse an old non-null control to reset and hide recovery failure',async t=>{
 const {engine,history,c,notices}=await setup(t);history.suspend();assert.ok(history.getSnapshot().control);c.restoreFailedRef.current=true;const before=engine.getSnapshot();
 await c.beginNewRound();assert.strictEqual(engine.getSnapshot(),before);assert.equal(c.restoreFailedRef.current,true);assert.equal(history.getSnapshot().mode,'unprepared');assert.match(notices.at(-1)!,/恢复历史设置/);
});
