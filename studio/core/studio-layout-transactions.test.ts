import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {LayoutTransactions} from '../scene/layout-transactions';
import {TrainingEngine} from './training';
const source=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
const swc=createRequire(import.meta.url)('next/dist/build/swc');await swc.loadBindings();
const actual=source.slice(source.indexOf(' function updateArrangement('),source.indexOf(' function releaseMix('));
const {code}=await swc.transform(actual,{jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}});
function harness(){
 const initial={inset:{x:1300,y:250,w:240,h:152}},engine=new TrainingEngine();engine.input('retained draft');const store=new Map<string,string>();store.set('landscape',JSON.stringify(initial));const calls:unknown[][]=[];
 const messages:Record<string,string>={'error.layoutRecordingBlocked':'录制中不能改布局。','error.layoutRealPractice':'先返回真实训练，再编辑舞台布局。','error.layoutApplyBlocked':'录制状态已变化，请先结束本段再应用布局。','error.layoutReading':'布局文件读取中，请稍候。','notice.layoutViewport':'视口已变化，未应用布局。','notice.layoutRecordingChanged':'录制状态已变化，布局预览已取消。','notice.layoutPreference':'无法保存布局偏好，可继续本页使用，但刷新后不会保留。'};
 const c:any={t:(key:string)=>messages[key]??key,cancelFollow(){},layoutImportBusyRef:{current:false},setLayoutImportBusy(){},disposed:{current:false},cameraState:'off',cameraStreamRef:{current:null},layoutTransactionsRef:{current:new LayoutTransactions()},arrangementRef:{current:initial},visualRef:{current:{layout:'lesson',arrangement:initial,fixture:false}},layout:'lesson',portraitRef:{current:false},portraitHeightRef:{current:1080},recordPreparing:{current:false},recordInputRef:{current:null},recorderRef:{current:{getSnapshot:()=>({state:c.recordState})}},recordState:'idle',layoutEditingRef:{current:false},layoutReturnFocusRef:{current:false},replaySnapshot:{current:null},fixture:false,engineRef:{current:engine},dialogRef:{current:{open:true,close(){c.dialogRef.current.open=false;calls.push(['closeDialog'])}}},layoutCacheRef:{current:{portrait:null,landscape:initial}},setArrangement:(v:any)=>calls.push(['arrangement',v]),setLayout:(v:any)=>{c.layout=v;calls.push(['layout',v])},setEditingLayout:(v:any)=>calls.push(['editing',v]),setLayoutPreview:(v:any)=>calls.push(['preview',v]),setLayoutUndoAvailable:(v:any)=>calls.push(['undoAvailable',v]),setToolsOpen:()=>{},notify:(s:string)=>calls.push(['notice',s]),layoutStorageKey:(p:boolean)=>p?'portrait':'landscape',localStorage:{setItem:(k:string,v:string)=>{if(c.failStorage)throw Error('quota');store.set(k,v);calls.push(['persist',k,v])}},closePanel:(_focus:boolean,keep=false)=>{if(!keep&&c.layoutTransactionsRef.current.active)c.cancelLayoutPreview();c.dialogRef.current.open=false}};
 vm.createContext(c);vm.runInContext(code,c);return{c,engine,initial,store,calls};
}
test('actual preview and cancel preserve persisted preference, mode, draft, attempts and rewards',()=>{
 const h=harness(),before=h.engine.getSnapshot();h.c.startLayoutPreview();h.c.previewLayout({inset:{x:100,y:100,w:250,h:158}});assert.equal(h.c.arrangementRef.current.inset.x,100);assert.equal(h.store.get('landscape'),JSON.stringify(h.initial));h.c.cancelLayoutPreview();assert.deepEqual(h.c.arrangementRef.current,h.initial);assert.equal(h.c.visualRef.current.layout,'lesson');assert.equal(h.engine.draft,'retained draft');assert.deepEqual(h.engine.getSnapshot().attempts,before.attempts);assert.equal(h.engine.getSnapshot().earnedWords,before.earnedWords);
});
test('actual apply persists exactly preview and undo restores original without removing preferences',()=>{
 const h=harness();h.c.startLayoutPreview();h.c.previewLayout({inset:{x:100,y:100,w:250,h:158}});h.c.finishLayout();assert.equal(JSON.parse(h.store.get('landscape')!).inset.x,100);assert.equal(h.c.layoutTransactionsRef.current.active,false);h.c.startLayoutPreview();h.c.undoLayout();assert.equal(h.store.get('landscape'),JSON.stringify(h.initial));assert.equal(h.c.layoutTransactionsRef.current.active,true);h.c.cancelLayoutPreview();assert.equal(h.store.get('landscape'),JSON.stringify(h.initial));
});
test('record preparation, owned input resource, encoding and finalization reject preview before any canvas update',()=>{
 for(const phase of ['prepare','resource','recording','stopping']){const h=harness();if(phase==='prepare')h.c.recordPreparing.current=true;else if(phase==='resource')h.c.recordInputRef.current={};else h.c.recordState=phase;assert.equal(h.c.startLayoutPreview(),false);h.c.beginLayout();assert.equal(h.c.layoutTransactionsRef.current.active,false);assert.equal(h.c.arrangementRef.current,h.initial);assert.equal(h.calls.filter(c=>c[0]==='persist').length,0);}
});
test('record state change during drag restores baseline and late drag callback cannot reapply candidate',()=>{
 const h=harness();h.c.startLayoutPreview();h.c.previewLayout({});h.c.recordState='recording';h.c.previewLayout({inset:{x:10,y:10,w:250,h:158}});assert.deepEqual(h.c.arrangementRef.current,h.initial);assert.equal(h.c.layoutTransactionsRef.current.active,false);h.c.recordState='idle';h.c.previewLayout({});assert.deepEqual(h.c.arrangementRef.current,h.initial);
});
test('failed preference write is visible and leaves previous storage intact; current page apply still undoable',()=>{
 const h=harness();h.c.startLayoutPreview();h.c.previewLayout({});h.c.failStorage=true;h.c.finishLayout();assert.equal(h.store.get('landscape'),JSON.stringify(h.initial));assert.ok(h.calls.some(c=>c[0]==='notice'&&String(c[1]).includes('无法保存')));assert.equal(h.c.layoutTransactionsRef.current.canUndo(h.c.currentLayout(),false),true);
});
test('default-layout command is preview only until explicit apply',()=>{
 const h=harness();h.c.resetArrangement();assert.deepEqual(h.c.arrangementRef.current,{});assert.equal(h.store.get('landscape'),JSON.stringify(h.initial));h.c.cancelLayoutPreview();assert.deepEqual(h.c.arrangementRef.current,h.initial);
});
test('actual source fences recording before capture and cancels before orientation cache write',()=>{
 const record=source.slice(source.indexOf(' async function startRecording(){'),source.indexOf(' function stopRecording('));assert.ok(record.indexOf('layoutTransactionsRef.current.active')<record.indexOf('canvas.captureStream'));
 assert.match(source,/if\(layoutTransactionsRef.current.active\)cancelLayoutPreview\(\);layoutCacheRef.current/);
 assert.match(source,/const visibility=\(\)=>\{[^\n]*?if\(document.hidden&&layoutTransactionsRef.current.active\)cancelLayoutPreview\(\)/);
 assert.match(source,/const pageHide=\(\)=>\{[^\n]*?if\(layoutTransactionsRef.current.active\)cancelLayoutPreview\(\)/);
});
test('actual editor Escape cancels transaction and gesture Escape only rolls back that gesture',async()=>{
 const editor=await readFile(new URL('../components/LayoutEditor.tsx',import.meta.url),'utf8');assert.match(editor,/if\(gesture.current\)\{update\(gesture.current.before\);gesture.current=null;setAnnouncement\(t\('layoutEditor.gestureCancel'\)\)\}else onCancel\(\)/);assert.match(editor,/>\{t\('layout.cancel'\)\}<\/button>/);assert.match(editor,/>\{t\('layout.apply'\)\}<\/button>/);assert.doesNotMatch(editor,/Esc完成|完成布局/);assert.match(editor,/layoutEditor\.title/);assert.match(editor,/useStudioLocale/);
});
test('apply rejects synchronous viewport changes before React cancellation effect, without persisting stale geometry',()=>{
 for(const change of ['orientation','height']){const h=harness();h.c.portraitRef.current=change==='height';h.c.startLayoutPreview();h.c.previewLayout({inset:{x:10,y:10,w:180,h:114}});if(change==='height')h.c.portraitHeightRef.current=900;else h.c.portraitRef.current=true;h.c.finishLayout();assert.equal(h.c.layoutTransactionsRef.current.active,false);assert.deepEqual(h.c.arrangementRef.current,h.initial);assert.equal(h.calls.some(c=>c[0]==='persist'),false);assert.equal(h.store.get('landscape'),JSON.stringify(h.initial));}
});
test('file reading blocks apply and manual replacement without dropping current draft',()=>{const h=harness();h.c.startLayoutPreview();h.c.previewLayout({});h.c.setLayoutFileBusy(true);assert.equal(h.c.startLayoutPreview(),false);h.c.finishLayout();assert.equal(h.c.layoutTransactionsRef.current.active,true);assert.equal(h.calls.some(c=>c[0]==='persist'),false);h.c.setLayoutFileBusy(false);h.c.cancelLayoutPreview();assert.deepEqual(h.c.arrangementRef.current,h.initial)});
test('actual imported preview rechecks active transaction, direction, height, recorder and camera availability',()=>{for(const reason of ['closed','orientation','height','recording','camera','disposed']){const h=harness();h.c.portraitRef.current=reason==='height';h.c.startLayoutPreview();const context={portrait:h.c.portraitRef.current,height:1080};if(reason==='closed')h.c.cancelLayoutPreview();if(reason==='orientation')h.c.portraitRef.current=true;if(reason==='height')h.c.portraitHeightRef.current=940;if(reason==='recording')h.c.recordState='recording';if(reason==='disposed')h.c.disposed.current=true;assert.equal(h.c.importLayoutPreview({layout:reason==='camera'?'camera':'lesson',arrangement:{}},context),false);assert.equal(h.calls.some(c=>c[0]==='persist'),false)}});
test('camera import consults live stream synchronously rather than stale camera UI state',()=>{const h=harness();h.c.cameraState='on';h.c.startLayoutPreview();h.c.cameraStreamRef.current={getVideoTracks:()=>[{readyState:'ended'}]};assert.equal(h.c.importLayoutPreview({layout:'camera',arrangement:{}},{portrait:false,height:1080}),false);h.c.cameraStreamRef.current={getVideoTracks:()=>[{readyState:'live'}]};assert.equal(h.c.importLayoutPreview({layout:'camera',arrangement:{}},{portrait:false,height:1080}),true);h.c.cameraStreamRef.current=null;assert.equal(h.c.importLayoutPreview({layout:'split',arrangement:{}},{portrait:false,height:1080}),false)});
