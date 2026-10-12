import {PracticeEngine,ORIGINAL_PRACTICE_MATERIAL,type PracticeSnapshot} from '../studio/core/practice';
import {FencedPracticeRepository} from '../studio/core/practice-fenced-repository';
import {canonicalJson} from '../studio/core/practice-repository';
import {exportPracticeSnapshot} from '../studio/core/practice-export';

function check(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(`Attempt erasure QA failed: ${message}`)}
async function rejects(work:Promise<unknown>){try{await work;return false}catch{return true}}
async function digest(snapshot:PracticeSnapshot){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(snapshot)));return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes});return{promise,resolve}}
function exercise(sessionId:string){let serial=0,now=0;const clock={now:()=>now,wallTime:()=>new Date(Date.UTC(2026,9,8)+now).toISOString(),id:()=>`${sessionId}-event-${++serial}`};return{engine:new PracticeEngine({sessionId,catalog:[ORIGINAL_PRACTICE_MATERIAL],clock}),clock,tick:(ms:number)=>{now+=ms}}}
async function inspect(databaseName:string){
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open(databaseName);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
 try{return await new Promise<Record<string,unknown[]>>((resolve,reject)=>{const names=Array.from(db.objectStoreNames),out:Record<string,unknown[]>={},tx=db.transaction(names,'readonly');for(const name of names){const read=tx.objectStore(name).getAll();read.onsuccess=()=>{out[name]=read.result}}tx.oncomplete=()=>resolve(out);tx.onabort=tx.onerror=()=>reject(tx.error)})}finally{db.close()}
}

/** Native-browser candidate. No production DB, device collection, or network. */
export async function runPracticeDataBatchTwoBQA(){
 check(!!globalThis.indexedDB&&!!globalThis.IDBObjectStore,'native IndexedDB required');
 const databaseName=`lingotrace-dev-fenced-redaction-${crypto.randomUUID()}`,repository=new FencedPracticeRepository({databaseName,initialRecordingEnabled:true});
 const originalPut=IDBObjectStore.prototype.put;let peer:FencedPracticeRepository|undefined;
 try{
  await repository.prepare();const{engine,clock,tick}=exercise('redaction-browser-session'),permit=await repository.beginRecordedSession(engine.getSnapshot());
  engine.startRound({materialId:ORIGINAL_PRACTICE_MATERIAL.materialId,practiceRoundId:'r1'});engine.startAttempt({unitId:'cafe-order',mode:'dictation',attemptId:'a1'});engine.exposeReference('hint');engine.input('REMOVE_PRIVATE_A1_BROWSER_CANARY','paste');tick(12007);engine.submit();engine.exposeReference('correction');engine.retryAttempt();const a2=engine.getSnapshot().projections.currentAttemptId!;engine.input('Could I have a coffee, please?');tick(5000);engine.submit();await repository.save(engine.getSnapshot(),permit);
  const durable=engine.getSnapshot(),beforeStores=await inspect(databaseName);peer=new FencedPracticeRepository({databaseName});await peer.prepare();
  IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='attemptTombstones')throw new DOMException('QA injected erasure transaction failure','QuotaExceededError');return originalPut.apply(this,args)};
  check(await rejects(peer.deleteAttempt({sessionId:durable.sessionId,attemptId:'a1',redactionId:'failed-redaction'})),'injected delete transaction rejects');IDBObjectStore.prototype.put=originalPut;
  check(canonicalJson(await inspect(databaseName))===canonicalJson(beforeStores),'every store rolls back on deletion failure');await peer.close();peer=undefined;
  const staleHandle=await repository.prepareHistoryExport(durable.sessionId,'2026-10-08T10:00:00.000Z');
  const receipt=await repository.deleteAttempt({sessionId:durable.sessionId,attemptId:'a1',redactionId:'successful-redaction',permit});check(receipt.snapshot&&receipt.permit&&!receipt.superseded,'committed erasure returns current sanitized state and continuation permit');
  const sanitized=receipt.snapshot;check(!Object.hasOwn(sanitized.projections.attempts,'a1'),'a1 absent from normal attempts');const survivor=sanitized.projections.attempts[a2];check(survivor.activeMs===5000&&survivor.firstSubmission?.targetMet===true,'a2 keeps its own measured duration and word result');check(canonicalJson(survivor.firstSubmission.exposureAtSubmission.map(item=>item.kind))===canonicalJson(['hint','correction']),'assistance survives as redacted summaries');
  let called=false;check(await rejects(repository.deliverHistoryExport(staleHandle,()=>{called=true}))&&!called,'prepared deleted history cannot be handed off');check(await rejects(repository.save(durable,permit)),'old save permit cannot resurrect a1');
  const raw=await inspect(databaseName);check(!JSON.stringify(raw).includes('REMOVE_PRIVATE_A1_BROWSER_CANARY'),'no persistent store contains the original answer');check(raw.attemptTombstones.length===1,'minimal attempt deletion lineage exists');
  const continuation=new PracticeEngine({snapshot:sanitized,clock});continuation.input('A2 browser draft retained after erasure');await repository.save(continuation.getSnapshot(),receipt.permit);const final=continuation.getSnapshot();
  const currentHandle=await repository.prepareHistoryExport(final.sessionId,'2026-10-08T10:00:00.000Z');let json='',csv='';await repository.deliverHistoryExport(currentHandle,payload=>{json=payload.json;csv=payload.csv});check(canonicalJson(JSON.parse(json).snapshot)===canonicalJson(final)&&!csv.includes('REMOVE_PRIVATE_A1_BROWSER_CANARY'),'authorized JSON/CSV contain only sanitized current history');check(await rejects(repository.deliverHistoryExport(currentHandle,()=>{})),'export handle is one-shot');

  // The asynchronous formatter owns only a fresh, separate fixture session.
  const started=deferred(),finish=deferred();peer=new FencedPracticeRepository({databaseName,exportFormatter:async(snapshot,at)=>{started.resolve();await finish.promise;const value=exportPracticeSnapshot(snapshot,at);return{json:value.json,csv:value.csv}}});await peer.prepare();
  const temporary=exercise('async-export-fixture'),temporaryPermit=await repository.beginRecordedSession(temporary.engine.getSnapshot());temporary.engine.startRound({materialId:ORIGINAL_PRACTICE_MATERIAL.materialId});temporary.engine.startAttempt({unitId:'cafe-choice',mode:'dictation',attemptId:'temporary-attempt'});temporary.engine.input('ASYNC PRIVATE FIXTURE');await repository.save(temporary.engine.getSnapshot(),temporaryPermit);
  const pending=peer.prepareHistoryExport(temporary.engine.getSnapshot().sessionId,'2026-10-08T10:00:00.000Z'),lateFailure=rejects(pending);await started.promise;await repository.deleteSession(temporary.engine.getSnapshot().sessionId);finish.resolve();check(await lateFailure,'remote deletion during async formatting rejects before publishing a handle');
  await peer.close();await repository.close();
  return{passed:true,databaseName,sessionId:final.sessionId,deletedAttemptId:'a1',survivingAttemptId:a2,snapshotSHA256:await digest(final),eventCount:final.events.length,attemptCount:Object.keys(final.projections.attempts).length,rollbackChecked:true,asyncExportRevocationChecked:true,allStoresInspected:Object.keys(raw),executionEnvironment:typeof window==='undefined'?'non-browser-harness':'browser',browser:typeof navigator==='undefined'?'unavailable':navigator.userAgent,boundary:'Original fixture commands and isolated IndexedDB only. Transaction failure is injected. No public UI, actual native typing, device collection, real disk failure, or independent external-copy erasure is implied.'};
 }finally{IDBObjectStore.prototype.put=originalPut;await peer?.close();await repository.close()}
}

export async function verifyPracticeRedactionReload(expected:{databaseName:string;sessionId:string;deletedAttemptId:string;survivingAttemptId:string;snapshotSHA256:string}){
 const repository=new FencedPracticeRepository({databaseName:expected.databaseName});try{
  await repository.prepare();const snapshot=await repository.load(expected.sessionId);check(snapshot,'sanitized session exists after actual page reload');check(await digest(snapshot)===expected.snapshotSHA256,'sanitized canonical snapshot digest survives reload');check(!Object.hasOwn(snapshot.projections.attempts,expected.deletedAttemptId)&&!!snapshot.projections.attempts[expected.survivingAttemptId],'deleted attempt stays absent and a2 remains');
  const all=await inspect(expected.databaseName);check(!JSON.stringify(all).includes('REMOVE_PRIVATE_A1_BROWSER_CANARY'),'no restored store recovers erased answer');return{passed:true,sessionId:snapshot.sessionId,snapshotSHA256:expected.snapshotSHA256,attemptCount:Object.keys(snapshot.projections.attempts).length};
 }finally{await repository.close()}
}
