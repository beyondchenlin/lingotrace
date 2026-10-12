import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
import * as training from './training.ts';
import * as legacy from './legacy-history.ts';
import {IndexedDBTrainingRepository} from './repository.ts';
import {AUTOMATIC_HISTORY_CONTROL_KEY} from './automatic-history-control.ts';

// Frozen exact published v41 source; no substitute old-writer implementation.
const oldSource=await readFile(new URL('./fixtures/repository-v41-source.txt',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(oldSource).digest('hex'),'d2753234f4a8db6bc6aec02107375b421245af06032afbd80e6027a08483a26e');
const swc=createRequire(import.meta.url)('next/dist/build/swc');await swc.loadBindings();
const {code}=await swc.transform(oldSource,{jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}});
const oldExports:any={};vm.runInNewContext(code,{exports:oldExports,require:(name:string)=>name==='./training.ts'?training:name==='./legacy-history.ts'?legacy:null,structuredClone,console});
const OldRepository=oldExports.IndexedDBTrainingRepository;
const open=(factory:IDBFactory,name:string,version?:number)=>new Promise<IDBDatabase>((resolve,reject)=>{const r=version===undefined?factory.open(name):factory.open(name,version);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
async function stored(factory:IDBFactory,name:string){const db=await open(factory,name);const result:any={version:db.version};try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(['sessions','events','meta'],'readonly');for(const name of ['sessions','events','meta']){const r=tx.objectStore(name).getAll();r.onsuccess=()=>{result[name]=r.result}}tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error)});return result}finally{db.close()}}
const retained=(value:any)=>({sessions:value.sessions,events:value.events,meta:value.meta.filter((r:any)=>r.key!==AUTOMATIC_HISTORY_CONTROL_KEY)});
const setup=()=>{const factory=new IDBFactory(),name=`barrier-${crypto.randomUUID()}`,options={indexedDB:factory,dbName:name};return{factory,name,options,repo:new IndexedDBTrainingRepository(options),engine:new training.TrainingEngine()}};

test('actual published v41 connection closes and every later old-writer save or reopen is refused after OFF succeeds',async()=>{
 const f=setup(),old=new OldRepository(f.options);f.engine.input('legacy retained');await old.saveSession(f.engine.getSnapshot());const before=await stored(f.factory,f.name);
 await f.repo.disableAutomaticHistory(0);assert.equal((await stored(f.factory,f.name)).version,2);assert.deepEqual(retained(await stored(f.factory,f.name)),retained(before));
 f.engine.input('OLD_WRITER_AFTER_OFF_SENTINEL');await assert.rejects(old.saveSession(f.engine.getSnapshot()),(e:any)=>e.name==='VersionError');
 const reopen=new OldRepository(f.options);await assert.rejects(reopen.saveSession(f.engine.getSnapshot()),(e:any)=>e.name==='VersionError');
 assert.ok(!JSON.stringify(await stored(f.factory,f.name)).includes('OLD_WRITER_AFTER_OFF_SENTINEL'));
 const list=await f.repo.listHistory();assert.equal(list.entries.length,1);const preserved=await f.repo.loadHistorySession(before.sessions[0].sessionId);assert.ok(preserved);let delivered=false;await f.repo.deliverHistorySession(preserved.summary.sessionId,preserved.snapshot,()=>{delivered=true});assert.equal(delivered,true);
 await old.close();await reopen.close();await f.repo.close();
});
test('blocked upgrade reports failure, never upgrades later without retry, and repeat retries do not queue a hidden activation',async()=>{
 const f=setup();await f.repo.saveSession(f.engine.getSnapshot());const before=await stored(f.factory,f.name);const blocker=await open(f.factory,f.name,1);blocker.onversionchange=()=>{};
 await assert.rejects(f.repo.disableAutomaticHistory(0),/block/);assert.equal(f.repo.getAutomaticHistoryStatus().settingsState,'not-persisted');assert.equal(f.repo.getAutomaticHistoryStatus().locallyStopped,true);
 await assert.rejects(f.repo.retryDisableAutomaticHistory(),/block/);await assert.rejects(f.repo.readAutomaticHistoryControl(),/blocking/);blocker.close();
 // This read waits behind the canceled request's eventual abort.
 const after=await stored(f.factory,f.name);assert.equal(after.version,1);assert.deepEqual(after,before);
 await f.repo.retryDisableAutomaticHistory();assert.equal((await stored(f.factory,f.name)).version,2);assert.equal(f.repo.getAutomaticHistoryStatus().settingsState,'persisted');await f.repo.close();
});
test('failed control write after upgrade keeps DB2 and exact old facts, and explicit retry succeeds without downgrade',async()=>{
 const f=setup();await f.repo.saveSession(f.engine.getSnapshot());const before=await stored(f.factory,f.name);const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(value,key){if(this.name==='meta'&&value?.key===AUTOMATIC_HISTORY_CONTROL_KEY)throw new DOMException('quota','QuotaExceededError');return put.call(this,value,key)};
 try{await assert.rejects(f.repo.disableAutomaticHistory(0));}finally{IDBObjectStore.prototype.put=put}
 const failed=await stored(f.factory,f.name);assert.equal(failed.version,2);assert.deepEqual(retained(failed),retained(before));assert.ok(!failed.meta.some((r:any)=>r.key===AUTOMATIC_HISTORY_CONTROL_KEY));assert.equal(f.repo.getAutomaticHistoryStatus().settingsState,'not-persisted');
 await f.repo.retryDisableAutomaticHistory();assert.deepEqual(retained(await stored(f.factory,f.name)),retained(before));await f.repo.close();
});
test('first OFF on absent database creates no practice facts; untouched normal sessions remain version1',async()=>{
 const f=setup();await f.repo.disableAutomaticHistory(0);const data=await stored(f.factory,f.name);assert.equal(data.version,2);assert.deepEqual(data.sessions,[]);assert.deepEqual(data.events,[]);assert.equal(data.meta.length,1);await f.repo.close();
 const normal=setup();await normal.repo.saveSession(normal.engine.getSnapshot());assert.equal((await stored(normal.factory,normal.name)).version,1);await normal.repo.close();
});
test('unknown future database is neither used for writes nor downgraded',async()=>{
 const f=setup();await f.repo.saveSession(f.engine.getSnapshot());await f.repo.close();const db=await open(f.factory,f.name,3);db.close();const repo=new IndexedDBTrainingRepository(f.options);
 await assert.rejects(repo.saveSession(f.engine.getSnapshot()));await assert.rejects(repo.listHistory());await assert.rejects(repo.disableAutomaticHistory(0));assert.deepEqual(await f.factory.databases(),[{name:f.name,version:3}]);await repo.close();
});
