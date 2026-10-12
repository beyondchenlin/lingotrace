import {PracticeEngine,ORIGINAL_PRACTICE_MATERIAL,type PracticeSnapshot} from '../studio/core/practice';
import {FencedPracticeRepository} from '../studio/core/practice-fenced-repository';
import {canonicalJson} from '../studio/core/practice-repository';
import {exportPracticeSnapshot} from '../studio/core/practice-export';

function check(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(`Data fence QA failed: ${message}`)}
async function rejected(work:Promise<unknown>){try{await work;return false}catch{return true}}
function fixture(sessionId:string){
 let id=0;const engine=new PracticeEngine({sessionId,catalog:[ORIGINAL_PRACTICE_MATERIAL],clock:{now:()=>0,wallTime:()=> '2026-10-08T09:00:00.000Z',id:()=>`${sessionId}-event-${++id}`}});
 return{engine,start:()=>{engine.startRound({materialId:ORIGINAL_PRACTICE_MATERIAL.materialId});engine.startAttempt({unitId:ORIGINAL_PRACTICE_MATERIAL.units[0].unitId,mode:'dictation'})}};
}
async function digest(snapshot:PracticeSnapshot){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(snapshot)));return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function raw(databaseName:string){
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open(databaseName);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
 try{return await new Promise<Record<string,unknown[]>>((resolve,reject)=>{const stores=['events','heads','tombstones','control'],rows:Record<string,unknown[]>={},tx=db.transaction(stores,'readonly');for(const name of stores){const request=tx.objectStore(name).getAll();request.onsuccess=()=>{rows[name]=request.result}}tx.oncomplete=()=>resolve(rows);tx.onabort=tx.onerror=()=>reject(tx.error)})}finally{db.close()}
}

/** Explicit button-run QA. Native IDB only in a real browser; no production DB,
 * capture, networking, permissions, controller subscription or user history. */
export async function runPracticeDataBatchTwoAQA(){
 check(!!globalThis.indexedDB&&!!globalThis.IDBObjectStore,'IndexedDB required');
 const databaseName=`lingotrace-dev-fenced-browser-${crypto.randomUUID()}`,repository=new FencedPracticeRepository({databaseName,initialRecordingEnabled:true});
 const peer=new FencedPracticeRepository({databaseName});let requestAbortChecked=false,settingsFailureChecked=false;
 const originalAdd=IDBObjectStore.prototype.add,originalPut=IDBObjectStore.prototype.put;
 try{
  await repository.prepare();await peer.prepare();const first=fixture('first-recorded-session');const permit=await repository.beginRecordedSession(first.engine.getSnapshot());first.start();first.engine.input('Could I have coffee, please?');first.engine.submit();await repository.save(first.engine.getSnapshot(),permit);const saved=first.engine.getSnapshot();
  const off=repository.setRecordingEnabled(false);check(!repository.getStatus().recordingEnabled,'OFF acts synchronously');first.engine.input('QA PRIVATE OFF-PERIOD ANSWER');const temporary=first.engine.getSnapshot();check(await rejected(repository.save(temporary,permit)),'OFF rejects late autosave');await off;check(canonicalJson(await repository.load(saved.sessionId))===canonicalJson(saved),'OFF preserves prior history');
  await repository.setRecordingEnabled(true);check(repository.getStatus().requiresNewRecordedSession,'ON requires an explicit new recording boundary');check(canonicalJson(first.engine.getSnapshot())===canonicalJson(temporary),'ON does not mutate practice');check(await rejected(repository.save(temporary,permit))&&await rejected(repository.beginRecordedSession(temporary)),'ON never re-admits practiced off-period content');
  const active=fixture('transaction-abort-session');const activePermit=await repository.beginRecordedSession(active.engine.getSnapshot());active.start();await repository.save(active.engine.getSnapshot(),activePermit);const before=active.engine.getSnapshot();active.engine.input('QA ABORT THIS PENDING FACT');let triggered=false,lateOff:Promise<unknown>|undefined;
  IDBObjectStore.prototype.add=function(...args:Parameters<IDBObjectStore['add']>){const request=originalAdd.apply(this,args);if(this.name==='events'&&!triggered){triggered=true;request.addEventListener('success',()=>{lateOff=repository.setRecordingEnabled(false);void lateOff.catch(()=>{})})}return request};
  check(await rejected(repository.save(active.engine.getSnapshot(),activePermit)),'OFF during request success aborts facts transaction');await lateOff;IDBObjectStore.prototype.add=originalAdd;check(triggered&&canonicalJson(await repository.load(before.sessionId))===canonicalJson(before),'request success was not mistaken for commit');requestAbortChecked=true;
  await repository.setRecordingEnabled(true);
  IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='control')throw new DOMException('QA injected setting failure','QuotaExceededError');return originalPut.apply(this,args)};
  const failedOff=repository.setRecordingEnabled(false);check(!repository.getStatus().recordingEnabled,'failed preference still immediately fences page');check(await rejected(failedOff),'injected setting failure reported');IDBObjectStore.prototype.put=originalPut;
  const status=repository.getStatus();check(status.settingsState==='not-persisted'&&!status.recordingEnabled&&status.durableRecordingEnabled===true,'setting status distinguishes page OFF from unpersisted preference');check((status.settingsError??'').includes('No other-tab or reload guarantee'),'no false cross-page privacy promise');settingsFailureChecked=true;
  await repository.setRecordingEnabled(true);const remote=fixture('cross-instance-session');const remotePermit=await repository.beginRecordedSession(remote.engine.getSnapshot());remote.start();remote.engine.input('cross-instance saved draft');await repository.save(remote.engine.getSnapshot(),remotePermit);
  await peer.setRecordingEnabled(false);await peer.setRecordingEnabled(true);remote.engine.input('stale generation callback');check(await rejected(repository.save(remote.engine.getSnapshot(),remotePermit)),'remote OFF/ON revokes old generation');
  await peer.deleteSession(saved.sessionId);check(await repository.load(saved.sessionId)===null,'session deletion reads null');check(await rejected(repository.save(saved,permit)),'deleted old snapshot cannot return');let stores=await raw(databaseName);check(!JSON.stringify(stores).includes('QA PRIVATE OFF-PERIOD ANSWER'),'off-period input never persisted');check(!JSON.stringify(stores).includes('QA ABORT THIS PENDING FACT'),'aborted transaction left no answer');
  await peer.clearPracticeData();stores=await raw(databaseName);check(stores.events.length===0&&stores.heads.length===0&&stores.tombstones.length===3,'clear removes facts and retains answer-free IDs');check(stores.tombstones.every(row=>Object.keys(row as object).sort().join(',')==='deletionWatermark,sessionGeneration,sessionId'),'minimal deletion lineage only');check(await rejected(peer.beginRecordedSession(fixture(saved.sessionId).engine.getSnapshot())),'clear cannot re-admit deleted IDs');
  for(const latest of [false,true]){
   let entered=false,nested:Promise<unknown>|undefined;const unsubscribe=peer.subscribe(()=>{if(!entered&&peer.getStatus().settingsState==='pending'){entered=true;nested=peer.setRecordingEnabled(latest);void nested.catch(()=>{})}});
   await peer.setRecordingEnabled(!latest);await nested;unsubscribe();const verify=new FencedPracticeRepository({databaseName});await verify.prepare();check(entered&&peer.getStatus().recordingEnabled===latest&&verify.getStatus().recordingEnabled===latest,'reentrant latest preference matches actual durable state');await verify.close();
  }
  const final=fixture('reload-surviving-session');const finalPermit=await peer.beginRecordedSession(final.engine.getSnapshot());final.start();final.engine.input('Could I have a coffee, please?');final.engine.submit();const snapshot=final.engine.getSnapshot();await peer.save(snapshot,finalPermit);const exported=exportPracticeSnapshot(snapshot,'2026-10-08T09:00:00.000Z');check(canonicalJson(JSON.parse(exported.json).snapshot)===canonicalJson(snapshot),'export has exact committed snapshot');
  await repository.close();await peer.close();
  return{passed:true,databaseName,sessionId:snapshot.sessionId,snapshotSHA256:await digest(snapshot),eventCount:snapshot.events.length,deletedSessionIds:[saved.sessionId,active.engine.getSnapshot().sessionId,remote.engine.getSnapshot().sessionId],requestAbortChecked,settingsFailureChecked,reentrantSettingsChecked:true,browser:typeof navigator==='undefined'?'unavailable':navigator.userAgent,executionEnvironment:typeof window==='undefined'?'non-browser-harness':'browser',boundary:'Whole-session fences only in random development databases. Quota and transaction faults are injected. No product UI, native typing, real capacity failure, capture, per-attempt deletion or production integration is implied.'};
 }finally{IDBObjectStore.prototype.add=originalAdd;IDBObjectStore.prototype.put=originalPut;await repository.close();await peer.close()}
}

export async function verifyPracticeFencesReload(expected:{databaseName:string;sessionId:string;snapshotSHA256:string;deletedSessionIds:string[]}){
 const repository=new FencedPracticeRepository({databaseName:expected.databaseName});try{
  await repository.prepare();const snapshot=await repository.load(expected.sessionId);check(snapshot,'explicit final recorded session survived reload');const actual=await digest(snapshot);check(actual===expected.snapshotSHA256,'exact snapshot digest after reload');
  for(const id of expected.deletedSessionIds){check(await repository.load(id)===null,'deleted session remains absent after reload');check(await rejected(repository.beginRecordedSession(fixture(id).engine.getSnapshot())),'durable tombstone prevents old ID reuse after reload')}
  return{passed:true,sessionId:snapshot.sessionId,snapshotSHA256:actual,deletedSessionCount:expected.deletedSessionIds.length};
 }finally{await repository.close()}
}
