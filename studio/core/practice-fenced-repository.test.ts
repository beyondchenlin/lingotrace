import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
import {PracticeEngine,ORIGINAL_PRACTICE_MATERIAL} from './practice';
import {FencedPracticeRepository,PracticeWriteFenceError,type WritePermit} from './practice-fenced-repository';
import {PracticeStorageConflict} from './practice-repository';
import {exportPracticeSnapshot} from './practice-export';

function exercise(sessionId:string){
 let now=0,id=0;const clock={now:()=>now,wallTime:()=>new Date(Date.UTC(2026,9,8)+now).toISOString(),id:()=>`${sessionId}-event-${++id}`};
 const engine=new PracticeEngine({clock,sessionId,catalog:[ORIGINAL_PRACTICE_MATERIAL]});
 return{engine,advance:(ms:number)=>{now+=ms},start:()=>{engine.startRound({materialId:ORIGINAL_PRACTICE_MATERIAL.materialId});engine.startAttempt({unitId:ORIGINAL_PRACTICE_MATERIAL.units[0].unitId,mode:'dictation'})}};
}
function setup(suffix:string,initialRecordingEnabled=true){
 const factory=new IDBFactory(),options={databaseName:`lingotrace-dev-fenced-${suffix}`,indexedDB:factory,initialRecordingEnabled};
 return{factory,options,repository:new FencedPracticeRepository(options)};
}
async function raw(factory:IDBFactory,name:string){
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=factory.open(name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
 try{return await new Promise<Record<string,unknown[]>>((resolve,reject)=>{
  const names=['control','heads','events','tombstones'],out:Record<string,unknown[]>={},tx=db.transaction(names,'readonly');
  for(const name of names){const request=tx.objectStore(name).getAll();request.onsuccess=()=>{out[name]=request.result}}
  tx.oncomplete=()=>resolve(out);tx.onabort=tx.onerror=()=>reject(tx.error);
 })}finally{db.close()}
}
async function admit(repository:FencedPracticeRepository,id:string){const item=exercise(id);const permit=await repository.beginRecordedSession(item.engine.getSnapshot());item.start();return{...item,permit}}

test('2A requires its explicit namespace, starts OFF by default and refuses production before database creation',async()=>{
 assert.throws(()=>new FencedPracticeRepository({databaseName:'lingotrace-studio-v1'}),/isolated/);
 assert.throws(()=>new FencedPracticeRepository({databaseName:'lingotrace-dev-data-batch1'}),/isolated/);
 const factory=new IDBFactory(),repository=new FencedPracticeRepository({databaseName:'lingotrace-dev-fenced-default',indexedDB:factory});
 await repository.prepare();assert.equal(repository.getStatus().recordingEnabled,false);
 await assert.rejects(repository.beginRecordedSession(exercise('off-session').engine.getSnapshot()),PracticeWriteFenceError);
 await repository.close();
 const clean=new IDBFactory(),before=new FencedPracticeRepository({databaseName:'lingotrace-dev-fenced-production',indexedDB:clean});
 const env=process.env as Record<string,string|undefined>,previous=env.NODE_ENV;
 try{env.NODE_ENV='production';assert.throws(()=>new FencedPracticeRepository({databaseName:'lingotrace-dev-fenced-production-new',indexedDB:clean}),/disabled in production/);await assert.rejects(before.prepare(),/disabled in production/);assert.deepEqual(await clean.databases(),[])}
 finally{if(previous===undefined)delete env.NODE_ENV;else env.NODE_ENV=previous}
});

test('2A writes a canonical prefix and preserves identical JSON/CSV facts after close and readback',async()=>{
 const{repository,options}=setup('roundtrip');await repository.prepare();const{engine,permit}=await admit(repository,'session-roundtrip');
 engine.input('Could I have coffee, please?');engine.submit();const first=engine.getSnapshot();await repository.save(first,permit);
 engine.exposeReference('hint');engine.input('Could I have a coffee, please?');engine.submit();const revised=engine.getSnapshot();await repository.save(revised,permit);
 assert.equal((await repository.save(first,permit)).disposition,'newer-preserved');await repository.close();
 const reopened=new FencedPracticeRepository(options);await reopened.prepare();assert.deepEqual(await reopened.load(revised.sessionId),revised);
 const time='2026-10-08T09:00:00.000Z',expected=exportPracticeSnapshot(revised,time),actual=exportPracticeSnapshot((await reopened.load(revised.sessionId))!,time);
 assert.equal(actual.json,expected.json);assert.equal(actual.csv,expected.csv);
 await assert.rejects(reopened.save(revised,permit),/Unknown or wrong-session/);await reopened.close();
});

test('2A permits are instance-owned and cannot admit an already practiced snapshot or forge a parent',async()=>{
 const{repository,options}=setup('permits');await repository.prepare();const{engine,permit}=await admit(repository,'session-permits');engine.input('draft');
 await assert.rejects(repository.save(engine.getSnapshot(),Object.freeze({}) as WritePermit),/Unknown or wrong-session/);
 const other=new FencedPracticeRepository(options);await other.prepare();await assert.rejects(other.save(engine.getSnapshot(),permit),/Unknown or wrong-session/);
 await assert.rejects(repository.beginRecordedSession(engine.getSnapshot()),/fresh sessionStarted-only/);
 await assert.rejects(repository.save(exercise('another-session').engine.getSnapshot(),permit),/wrong-session/);
 await repository.save(engine.getSnapshot(),permit);assert.equal((await repository.load(engine.getSnapshot().sessionId))!.sequence,engine.getSnapshot().sequence);
 await other.close();await repository.close();
});

test('2A OFF fences the current page synchronously, preserves readable history and never changes the engine',async()=>{
 const{repository}=setup('off');await repository.prepare();const{engine,permit}=await admit(repository,'session-off');engine.input('saved first draft');await repository.save(engine.getSnapshot(),permit);const saved=engine.getSnapshot();
 const off=repository.setRecordingEnabled(false);assert.equal(repository.getStatus().recordingEnabled,false);assert.equal(repository.getStatus().settingsState,'pending');
 engine.input('private off-period draft');const temporary=engine.getSnapshot();await assert.rejects(repository.save(temporary,permit),PracticeWriteFenceError);await off;
 assert.deepEqual(await repository.load(saved.sessionId),saved);assert.deepEqual(engine.getSnapshot(),temporary);
 await repository.setRecordingEnabled(true);assert.equal(repository.getStatus().requiresNewRecordedSession,true);assert.deepEqual(engine.getSnapshot(),temporary,'a record toggle must not submit, reset or replace practice');
 await assert.rejects(repository.save(temporary,permit),PracticeWriteFenceError);await assert.rejects(repository.beginRecordedSession(temporary),PracticeWriteFenceError);
 const fresh=exercise('explicit-new-record-segment');const nextPermit=await repository.beginRecordedSession(fresh.engine.getSnapshot());fresh.start();fresh.engine.input('new explicitly recorded draft');await repository.save(fresh.engine.getSnapshot(),nextPermit);
 const stored=await repository.load(fresh.engine.getSnapshot().sessionId);assert.ok(stored);assert.equal(JSON.stringify(stored).includes('private off-period draft'),false);assert.deepEqual(engine.getSnapshot(),temporary);await repository.close();
});

test('2A OFF aborts an active facts transaction even after a request succeeds',async()=>{
 const{repository}=setup('off-during-transaction');await repository.prepare();const{engine,permit}=await admit(repository,'session-active-off');await repository.save(engine.getSnapshot(),permit);const before=engine.getSnapshot();engine.input('must roll back');
 const original=IDBObjectStore.prototype.add;let off:Promise<unknown>|undefined,triggered=false;
 IDBObjectStore.prototype.add=function(...args:Parameters<IDBObjectStore['add']>){const request=original.apply(this,args);if(this.name==='events'&&!triggered){triggered=true;request.addEventListener('success',()=>{off=repository.setRecordingEnabled(false);void off.catch(()=>{})})}return request};
 try{await assert.rejects(repository.save(engine.getSnapshot(),permit));assert.ok(triggered);await off}finally{IDBObjectStore.prototype.add=original}
 assert.deepEqual(await repository.load(before.sessionId),before);assert.equal(repository.getStatus().recordingEnabled,false);await repository.close();
});

test('2A a setting write failure leaves this page OFF with an honest non-persisted status',async()=>{
 const{repository,options}=setup('setting-failure');await repository.prepare();const{engine,permit}=await admit(repository,'session-setting-failure');engine.input('durable draft');await repository.save(engine.getSnapshot(),permit);const before=engine.getSnapshot();
 const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='control')throw new DOMException('Injected settings failure','QuotaExceededError');return original.apply(this,args)};
 try{const result=repository.setRecordingEnabled(false);assert.equal(repository.getStatus().recordingEnabled,false);await assert.rejects(result,{name:'QuotaExceededError'})}finally{IDBObjectStore.prototype.put=original}
 const status=repository.getStatus();assert.equal(status.settingsState,'not-persisted');assert.equal(status.recordingEnabled,false);assert.equal(status.durableRecordingEnabled,true);assert.match(status.settingsError??'',/this page stays OFF/);assert.match(status.settingsError??'',/No other-tab or reload guarantee/);
 engine.input('unsaved current page draft');await assert.rejects(repository.save(engine.getSnapshot(),permit),PracticeWriteFenceError);assert.deepEqual(await repository.load(before.sessionId),before);
 const reloaded=new FencedPracticeRepository(options);await reloaded.prepare();assert.equal(reloaded.getStatus().recordingEnabled,true,'failed preference cannot be claimed persisted across pages');await reloaded.close();await repository.close();
});

test('2A another instance OFF then ON revokes every older permit using the durable generation',async()=>{
 const{repository,options}=setup('remote-control');await repository.prepare();const{engine,permit}=await admit(repository,'session-remote-control');engine.input('before off');await repository.save(engine.getSnapshot(),permit);const before=engine.getSnapshot();
 const other=new FencedPracticeRepository(options);await other.prepare();await other.setRecordingEnabled(false);engine.input('late request while remotely off');await assert.rejects(repository.save(engine.getSnapshot(),permit),PracticeWriteFenceError);
 await other.setRecordingEnabled(true);await assert.rejects(repository.save(engine.getSnapshot(),permit),PracticeWriteFenceError);assert.deepEqual(await repository.load(before.sessionId),before);
 const fresh=await admit(repository,'remote-control-new');fresh.engine.input('after explicit new segment');await repository.save(fresh.engine.getSnapshot(),fresh.permit);await other.close();await repository.close();
});

test('2A session deletion physically removes answers, retains only minimal lineage and rejects all late writes',async()=>{
 const{repository,options,factory}=setup('delete');await repository.prepare();const{engine,permit}=await admit(repository,'session-delete');engine.input('ANSWER-CANARY-PRIVATE');engine.submit();await repository.save(engine.getSnapshot(),permit);const stale=engine.getSnapshot();engine.input('late answer');
 const other=new FencedPracticeRepository(options);await other.prepare();const receipt=await other.deleteSession(stale.sessionId);assert.equal(receipt.deleted,true);assert.equal(receipt.sessionGeneration,1);
 await assert.rejects(repository.save(stale,permit),PracticeWriteFenceError);await assert.rejects(repository.save(engine.getSnapshot(),permit),PracticeWriteFenceError);assert.equal(await repository.load(stale.sessionId),null);
 const stores=await raw(factory,options.databaseName);assert.deepEqual(stores.events,[]);assert.deepEqual(stores.heads,[]);assert.deepEqual(Object.keys(stores.tombstones[0] as object).sort(),['deletionWatermark','sessionGeneration','sessionId']);assert.equal(JSON.stringify(stores).includes('ANSWER-CANARY-PRIVATE'),false);
 await assert.rejects(other.beginRecordedSession(exercise(stale.sessionId).engine.getSnapshot()),PracticeWriteFenceError);await other.close();await repository.close();
});

test('2A deletion requested inside an active save aborts all appended facts before its own commit',async()=>{
 const{repository}=setup('delete-during-save');await repository.prepare();const{engine,permit}=await admit(repository,'session-delete-active');await repository.save(engine.getSnapshot(),permit);engine.input('late transaction answer');
 const original=IDBObjectStore.prototype.put;let deletion:Promise<unknown>|undefined,triggered=false;
 IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){const request=original.apply(this,args);if(this.name==='heads'&&!triggered){triggered=true;request.addEventListener('success',()=>{deletion=repository.deleteSession(engine.getSnapshot().sessionId);void deletion.catch(()=>{})})}return request};
 try{await assert.rejects(repository.save(engine.getSnapshot(),permit));assert.ok(triggered);await deletion}finally{IDBObjectStore.prototype.put=original}
 assert.equal(await repository.load(engine.getSnapshot().sessionId),null);await assert.rejects(repository.save(engine.getSnapshot(),permit),PracticeWriteFenceError);await repository.close();
});

test('2A a rolled-back deletion reports failure, preserves durable facts and still blocks local late callbacks',async()=>{
 const{repository,options}=setup('delete-failure');await repository.prepare();const{engine,permit}=await admit(repository,'session-delete-failure');engine.input('durable before failed deletion');await repository.save(engine.getSnapshot(),permit);const before=engine.getSnapshot();
 const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='tombstones')throw new DOMException('Injected deletion failure','QuotaExceededError');return original.apply(this,args)};
 try{await assert.rejects(repository.deleteSession(before.sessionId),{name:'QuotaExceededError'});assert.equal(repository.getStatus().state,'error')}finally{IDBObjectStore.prototype.put=original}
 assert.deepEqual(await repository.load(before.sessionId),before);assert.equal(repository.getStatus().state,'error');engine.input('late callback after failed deletion');await assert.rejects(repository.save(engine.getSnapshot(),permit),PracticeWriteFenceError);
 await repository.close();const reopened=new FencedPracticeRepository(options);await reopened.prepare();assert.deepEqual(await reopened.load(before.sessionId),before);await reopened.deleteSession(before.sessionId);assert.equal(await reopened.load(before.sessionId),null);await reopened.close();
});

test('2A clearing all sessions preserves previous tombstones and invalidates local and remote permits',async()=>{
 const{repository,options,factory}=setup('clear');await repository.prepare();const a=await admit(repository,'session-clear-a'),b=await admit(repository,'session-clear-b');a.engine.input('private A');b.engine.input('private B');await repository.save(a.engine.getSnapshot(),a.permit);await repository.save(b.engine.getSnapshot(),b.permit);
 await repository.deleteSession('older-deleted-id');const other=new FencedPracticeRepository(options);await other.prepare();const receipt=await other.clearPracticeData();assert.equal(receipt.clearWatermark,1);assert.equal(receipt.globalGeneration,1);
 await assert.rejects(repository.save(a.engine.getSnapshot(),a.permit),PracticeWriteFenceError);await assert.rejects(repository.save(b.engine.getSnapshot(),b.permit),PracticeWriteFenceError);assert.equal(await repository.load('session-clear-a'),null);assert.equal(await repository.load('session-clear-b'),null);
 const stores=await raw(factory,options.databaseName);assert.deepEqual(stores.events,[]);assert.deepEqual(stores.heads,[]);assert.equal(stores.tombstones.length,3);assert.equal(JSON.stringify(stores).includes('private A'),false);
 await assert.rejects(other.beginRecordedSession(exercise('session-clear-a').engine.getSnapshot()),PracticeWriteFenceError);
 const fresh=await admit(other,'session-clear-new');fresh.engine.input('explicitly new');await other.save(fresh.engine.getSnapshot(),fresh.permit);await other.setRecordingEnabled(false);await other.clearPracticeData();assert.equal(other.getStatus().recordingEnabled,false);await other.close();await repository.close();
});

test('2A clear during a queued save does not resurrect its head and does not reset the practice engine',async()=>{
 const{repository}=setup('queued-clear');await repository.prepare();const{engine,permit}=await admit(repository,'session-queued-clear');engine.input('current temporary work');const snapshot=engine.getSnapshot();
 const save=repository.save(snapshot,permit);const rejected=assert.rejects(save,PracticeWriteFenceError);const clear=repository.clearPracticeData();await rejected;await clear;
 assert.equal(await repository.load(snapshot.sessionId),null);assert.deepEqual(engine.getSnapshot(),snapshot);await repository.close();
});

test('2A rapid OFF/ON/OFF keeps the latest page preference and never revives old permits',async()=>{
 const{repository}=setup('rapid');await repository.prepare();const{engine,permit}=await admit(repository,'session-rapid');await repository.save(engine.getSnapshot(),permit);
 const first=repository.setRecordingEnabled(false),second=repository.setRecordingEnabled(true),third=repository.setRecordingEnabled(false);
 assert.equal(repository.getStatus().recordingEnabled,false);await Promise.all([first,second,third]);assert.equal(repository.getStatus().recordingEnabled,false);assert.equal(repository.getStatus().durableRecordingEnabled,false);assert.equal(repository.getStatus().pending,0);
 await assert.rejects(repository.save(engine.getSnapshot(),permit),PracticeWriteFenceError);await repository.close();
});

test('2A appending conflicting facts remains rejected within the same guarded transaction',async()=>{
 const{repository}=setup('conflict');await repository.prepare();const{engine,permit}=await admit(repository,'session-conflict');await repository.save(engine.getSnapshot(),permit);const base=engine.getSnapshot();
 engine.input('winning draft');await repository.save(engine.getSnapshot(),permit);
 const alternative=new PracticeEngine({snapshot:base,clock:{now:()=>0,wallTime:()=>new Date(Date.UTC(2026,9,8)).toISOString(),id:()=> 'different-event'}});alternative.input('other draft');
 await assert.rejects(repository.save(alternative.getSnapshot(),permit),PracticeStorageConflict);assert.deepEqual(await repository.load(base.sessionId),engine.getSnapshot());assert.equal(repository.getStatus().state,'error');await repository.close();
});

test('2A a failed facts append is atomic and a read cannot hide its unsaved status',async()=>{
 const{repository}=setup('append-failure');await repository.prepare();const{engine,permit}=await admit(repository,'session-append-failure');await repository.save(engine.getSnapshot(),permit);const before=engine.getSnapshot();engine.input('not yet durable');
 const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='heads')throw new DOMException('Injected append failure','QuotaExceededError');return original.apply(this,args)};
 try{await assert.rejects(repository.save(engine.getSnapshot(),permit),{name:'QuotaExceededError'})}finally{IDBObjectStore.prototype.put=original}
 assert.deepEqual(await repository.load(before.sessionId),before);assert.equal(repository.getStatus().state,'error');await repository.save(engine.getSnapshot(),permit);assert.equal(repository.getStatus().state,'saved');await repository.close();
});

test('2A delete during admission prevents a successful request from issuing a live permit',async()=>{
 const{repository}=setup('delete-during-admission');await repository.prepare();const item=exercise('session-admission-deleted');
 const original=IDBObjectStore.prototype.add;let deletion:Promise<unknown>|undefined,triggered=false;
 IDBObjectStore.prototype.add=function(...args:Parameters<IDBObjectStore['add']>){const request=original.apply(this,args);if(this.name==='heads'&&!triggered){triggered=true;request.addEventListener('success',()=>{deletion=repository.deleteSession(item.engine.getSnapshot().sessionId);void deletion.catch(()=>{})})}return request};
 try{await assert.rejects(repository.beginRecordedSession(item.engine.getSnapshot()));assert.ok(triggered);await deletion}finally{IDBObjectStore.prototype.add=original}
 assert.equal(await repository.load(item.engine.getSnapshot().sessionId),null);await repository.close();
});

test('2A failed clear is fully rolled back and all old page permits remain revoked',async()=>{
 const{repository,options,factory}=setup('clear-failure');await repository.prepare();const a=await admit(repository,'clear-failure-a'),b=await admit(repository,'clear-failure-b');a.engine.input('keep A if clear fails');b.engine.input('keep B if clear fails');await repository.save(a.engine.getSnapshot(),a.permit);await repository.save(b.engine.getSnapshot(),b.permit);const before=await raw(factory,options.databaseName);
 const original=IDBObjectStore.prototype.clear;IDBObjectStore.prototype.clear=function(){const request=original.call(this);if(this.name==='heads')request.addEventListener('success',()=>this.transaction.abort());return request};
 try{await assert.rejects(repository.clearPracticeData());assert.equal(repository.getStatus().state,'error')}finally{IDBObjectStore.prototype.clear=original}
 assert.deepEqual(await raw(factory,options.databaseName),before,'control, tombstones, facts and heads roll back together');await assert.rejects(repository.save(a.engine.getSnapshot(),a.permit),PracticeWriteFenceError);await assert.rejects(repository.save(b.engine.getSnapshot(),b.permit),PracticeWriteFenceError);
 await repository.clearPracticeData();assert.equal(await repository.load('clear-failure-a'),null);assert.equal(await repository.load('clear-failure-b'),null);await repository.close();
});

test('2A clearing an orphan fact still leaves answer-free lineage and rejects admission with its ID',async()=>{
 const{repository,options,factory}=setup('orphan-clear');await repository.prepare();const{engine,permit}=await admit(repository,'orphan-parent');engine.input('orphan answer');await repository.save(engine.getSnapshot(),permit);
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const open=factory.open(options.databaseName);open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error)});
 await new Promise<void>((resolve,reject)=>{const tx=db.transaction('heads','readwrite');tx.objectStore('heads').delete('orphan-parent');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error)});db.close();
 await assert.rejects(repository.save(engine.getSnapshot(),permit),/cannot recreate/);await repository.clearPracticeData();const stored=await raw(factory,options.databaseName);assert.deepEqual(stored.events,[]);assert.deepEqual(stored.heads,[]);assert.equal((stored.tombstones[0] as {sessionId:string}).sessionId,'orphan-parent');
 const reopened=new FencedPracticeRepository(options);await reopened.prepare();await assert.rejects(reopened.beginRecordedSession(exercise('orphan-parent').engine.getSnapshot()),PracticeWriteFenceError);await reopened.close();await repository.close();
});

for(const latest of [false,true])test(`2A a reentrant subscriber's latest ${latest?'ON':'OFF'} intent also wins durable storage`,async()=>{
 const{repository,options}=setup(`reentrant-${latest?'on':'off'}`);await repository.prepare();let triggered=false,nested:Promise<unknown>|undefined;
 const unsubscribe=repository.subscribe(()=>{if(!triggered&&repository.getStatus().settingsState==='pending'){triggered=true;nested=repository.setRecordingEnabled(latest);void nested.catch(()=>{})}});
 await repository.setRecordingEnabled(!latest);await nested;unsubscribe();assert.ok(triggered);assert.equal(repository.getStatus().recordingEnabled,latest);assert.equal(repository.getStatus().durableRecordingEnabled,latest);assert.equal(repository.getStatus().settingsState,'persisted');
 const reopened=new FencedPracticeRepository(options);await reopened.prepare();assert.equal(reopened.getStatus().recordingEnabled,latest,'the persisted preference must match the latest acknowledged setting intent');await reopened.close();await repository.close();
});

test('2A a new explicit segment requested by a clear subscriber is admitted after the clear commits',async()=>{
 const{repository}=setup('reentrant-clear');await repository.prepare();await admit(repository,'before-reentrant-clear');const fresh=exercise('explicit-new-after-clear-request');let triggered=false,admission:Promise<WritePermit>|undefined;
 const unsubscribe=repository.subscribe(()=>{if(!triggered&&repository.getStatus().requiresNewRecordedSession){triggered=true;admission=repository.beginRecordedSession(fresh.engine.getSnapshot());void admission.catch(()=>{})}});
 await repository.clearPracticeData();const permit=await admission;unsubscribe();assert.ok(triggered&&permit);assert.deepEqual(await repository.load(fresh.engine.getSnapshot().sessionId),fresh.engine.getSnapshot());assert.equal(repository.getStatus().requiresNewRecordedSession,false);
 fresh.start();fresh.engine.input('recorded after the requested clear');await repository.save(fresh.engine.getSnapshot(),permit);assert.deepEqual(await repository.load(fresh.engine.getSnapshot().sessionId),fresh.engine.getSnapshot());await repository.close();
});
