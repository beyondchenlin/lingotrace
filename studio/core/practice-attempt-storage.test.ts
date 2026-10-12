import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
import {PracticeEngine,ORIGINAL_PRACTICE_MATERIAL,type PracticeSnapshot} from './practice';
import {FencedPracticeRepository,PracticeWriteFenceError,type WritePermit} from './practice-fenced-repository';
import {exportPracticeSnapshot} from './practice-export';

function fresh(sessionId:string){let serial=0,now=0;const clock={now:()=>now,wallTime:()=>new Date(Date.UTC(2026,9,8)+now).toISOString(),id:()=>`${sessionId}-event-${++serial}`};return{engine:new PracticeEngine({sessionId,catalog:[ORIGINAL_PRACTICE_MATERIAL],clock}),clock,tick:(ms:number)=>{now+=ms}}}
async function setup(name:string,options:Record<string,unknown>={}){
 const factory=new IDBFactory(),config={databaseName:`lingotrace-dev-fenced-2b-${name}`,indexedDB:factory,initialRecordingEnabled:true,...options};const repository=new FencedPracticeRepository(config);await repository.prepare();const fixture=fresh(`2b-${name}`),permit=await repository.beginRecordedSession(fixture.engine.getSnapshot());
 fixture.engine.startRound({materialId:ORIGINAL_PRACTICE_MATERIAL.materialId,practiceRoundId:'r1'});fixture.engine.startAttempt({unitId:'cafe-order',mode:'dictation',attemptId:'a1'});fixture.engine.exposeReference('hint');fixture.engine.input('DELETE_A1_PRIVATE_STORAGE_CANARY','paste');fixture.tick(13007);fixture.engine.submit();fixture.engine.exposeReference('correction');fixture.engine.retryAttempt();const a2=fixture.engine.getSnapshot().projections.currentAttemptId!;fixture.engine.input('Could I have a coffee, please?');fixture.tick(5000);fixture.engine.submit();await repository.save(fixture.engine.getSnapshot(),permit);
 return{...fixture,factory,config,repository,permit,a2};
}
async function stores(factory:IDBFactory,name:string){const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=factory.open(name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});try{return await new Promise<Record<string,unknown[]>>((resolve,reject)=>{const names=Array.from(db.objectStoreNames),rows:Record<string,unknown[]>={},tx=db.transaction(names,'readonly');for(const name of names){const read=tx.objectStore(name).getAll();read.onsuccess=()=>{rows[name]=read.result}}tx.oncomplete=()=>resolve(rows);tx.onabort=tx.onerror=()=>reject(tx.error)})}finally{db.close()}}
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
const deleteA1=(repository:FencedPracticeRepository,sessionId:string,extra:Record<string,unknown>={})=>repository.deleteAttempt({sessionId,attemptId:'a1',redactionId:'delete-a1',...extra});

test('2B attempt deletion rewrites every persistent store and scoped export without deleting a2',async()=>{
 const{repository,engine,permit,factory,config,a2,clock}=await setup('physical');const before=engine.getSnapshot(),receipt=await deleteA1(repository,before.sessionId,{permit});assert.equal(receipt.deleted,true);assert.ok(receipt.snapshot);assert.ok(receipt.permit);assert.equal(receipt.snapshot.projections.attempts[a2].activeMs,5000);assert.equal(Object.hasOwn(receipt.snapshot.projections.attempts,'a1'),false);
 const raw=await stores(factory,config.databaseName);assert.ok(Object.hasOwn(raw,'attemptTombstones'));assert.equal(JSON.stringify(raw).includes('DELETE_A1_PRIVATE_STORAGE_CANARY'),false);assert.equal(JSON.stringify(raw).includes('13007'),false);assert.deepEqual(Object.keys(raw.attemptTombstones[0] as object).sort(),['attemptId','deletionWatermark','sessionGeneration','sessionId']);
 await assert.rejects(repository.save(before,permit),PracticeWriteFenceError);const handle=await repository.prepareHistoryExport(before.sessionId,'2026-10-08T10:00:00.000Z');let delivered:{json:string;csv:string}|undefined;await repository.deliverHistoryExport(handle,data=>{delivered=data});assert.ok(delivered);assert.equal(delivered.json.includes('DELETE_A1_PRIVATE_STORAGE_CANARY'),false);assert.equal(delivered.csv.includes('DELETE_A1_PRIVATE_STORAGE_CANARY'),false);assert.deepEqual(JSON.parse(delivered.json).snapshot,receipt.snapshot);
 const continuation=new PracticeEngine({snapshot:receipt.snapshot,clock});continuation.input('A2 new retained draft');await repository.save(continuation.getSnapshot(),receipt.permit!);assert.equal((await repository.load(before.sessionId))!.projections.attempts[a2].draft.text,'A2 new retained draft');await repository.close();const reopened=new FencedPracticeRepository(config);await reopened.prepare();assert.equal(Object.hasOwn((await reopened.load(before.sessionId))!.projections.attempts,'a1'),false);await reopened.close();
});

test('2B valid captured live tail preserves unsaved a2 while deletion removes only a1',async()=>{
 const{repository,engine,permit,a2}=await setup('live-tail');engine.input('UNSAVED A2 MUST SURVIVE');const live=engine.getSnapshot();const receipt=await deleteA1(repository,live.sessionId,{liveSnapshot:live,permit});assert.ok(receipt.snapshot);assert.equal(receipt.snapshot.projections.attempts[a2].draft.text,'UNSAVED A2 MUST SURVIVE');assert.equal(Object.hasOwn(receipt.snapshot.projections.attempts,'a1'),false);assert.deepEqual(await repository.load(live.sessionId),receipt.snapshot);await assert.rejects(repository.save(live,permit),PracticeWriteFenceError);await repository.close();
});

test('2B OFF forbids backfilling a captured live tail but still permits deleting durable a1 history',async()=>{
 const{repository,engine,permit,a2}=await setup('off-live-tail');const durable=engine.getSnapshot();await repository.setRecordingEnabled(false);engine.input('OFF PRIVATE A2 TAIL');const off=engine.getSnapshot();await assert.rejects(deleteA1(repository,off.sessionId,{liveSnapshot:off,permit}));assert.deepEqual(await repository.load(durable.sessionId),durable);
 const receipt=await deleteA1(repository,durable.sessionId);assert.equal(receipt.permit,null);assert.ok(receipt.snapshot);assert.equal(receipt.snapshot.projections.attempts[a2].draft.text,durable.projections.attempts[a2].draft.text);assert.equal(JSON.stringify(receipt.snapshot).includes('OFF PRIVATE A2 TAIL'),false);assert.deepEqual(engine.getSnapshot(),off,'repository does not silently reset a temporary engine');await repository.close();
});

test('2B another instance rejects stale session permits after attempt deletion',async()=>{
 const{repository,engine,permit,config}=await setup('remote-delete');const peer=new FencedPracticeRepository(config);await peer.prepare();const receipt=await deleteA1(peer,engine.getSnapshot().sessionId);engine.input('late old callback');await assert.rejects(repository.save(engine.getSnapshot(),permit),PracticeWriteFenceError);assert.deepEqual(await repository.load(engine.getSnapshot().sessionId),receipt.snapshot);await peer.close();await repository.close();
});

test('2B a failed attempt rewrite rolls back all stores and leaves local old permits revoked',async()=>{
 const{repository,engine,permit,factory,config}=await setup('rollback');const before=await stores(factory,config.databaseName),original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='attemptTombstones')throw new DOMException('Injected attempt delete quota','QuotaExceededError');return original.apply(this,args)};
 try{await assert.rejects(deleteA1(repository,engine.getSnapshot().sessionId),{name:'QuotaExceededError'})}finally{IDBObjectStore.prototype.put=original}
 assert.deepEqual(await stores(factory,config.databaseName),before);assert.equal(repository.getStatus().state,'error');await assert.rejects(repository.save(engine.getSnapshot(),permit),PracticeWriteFenceError);const receipt=await deleteA1(repository,engine.getSnapshot().sessionId);assert.ok(receipt.snapshot);assert.equal(Object.hasOwn(receipt.snapshot.projections.attempts,'a1'),false);await repository.close();
});

test('2B repeating a deletion cannot add redaction events or advance the committed deletion watermark',async()=>{
 const{repository,engine}=await setup('idempotent');const first=await deleteA1(repository,engine.getSnapshot().sessionId);const second=await deleteA1(repository,engine.getSnapshot().sessionId);assert.deepEqual(second.snapshot,first.snapshot);assert.equal(second.deletionWatermark,first.deletionWatermark);assert.equal(second.sessionGeneration,first.sessionGeneration);await repository.close();
});

test('2B a prepared export cannot be delivered after attempt deletion or reused after delivery',async()=>{
 const{repository,engine}=await setup('export-delete');const sessionId=engine.getSnapshot().sessionId,old=await repository.prepareHistoryExport(sessionId,'2026-10-08T10:00:00.000Z');assert.deepEqual(Object.keys(old),[],'the prepared handle exposes no data');await deleteA1(repository,sessionId);let delivered=0;await assert.rejects(repository.deliverHistoryExport(old,()=>{delivered++}));assert.equal(delivered,0);
 const current=await repository.prepareHistoryExport(sessionId,'2026-10-08T10:00:00.000Z');await repository.deliverHistoryExport(current,()=>{delivered++});assert.equal(delivered,1);await assert.rejects(repository.deliverHistoryExport(current,()=>{delivered++}));assert.equal(delivered,1);await repository.close();
});

test('2B deletion during asynchronous export formatting rejects its late completion before a handle is exposed',async()=>{
 const started=deferred<void>(),finish=deferred<void>();const{repository,engine}=await setup('export-during-format',{exportFormatter:async(snapshot:PracticeSnapshot,at:string)=>{started.resolve();await finish.promise;const output=exportPracticeSnapshot(snapshot,at);return{json:output.json,csv:output.csv}}});
 const pending=repository.prepareHistoryExport(engine.getSnapshot().sessionId,'2026-10-08T10:00:00.000Z'),rejection=assert.rejects(pending);await started.promise;await deleteA1(repository,engine.getSnapshot().sessionId);finish.resolve();await rejection;await repository.close();
});

test('2B clear during asynchronous export formatting rejects its late completion before delivery',async()=>{
 const started=deferred<void>(),finish=deferred<void>();const{repository,engine}=await setup('export-during-clear',{exportFormatter:async(snapshot:PracticeSnapshot,at:string)=>{started.resolve();await finish.promise;const output=exportPracticeSnapshot(snapshot,at);return{json:output.json,csv:output.csv}}});
 const pending=repository.prepareHistoryExport(engine.getSnapshot().sessionId,'2026-10-08T10:00:00.000Z'),rejection=assert.rejects(pending);await started.promise;await repository.clearPracticeData();finish.resolve();await rejection;await repository.close();
});

test('2B final delivery rechecks remote deletion generation rather than trusting the preparation snapshot',async()=>{
 const{repository,engine,config}=await setup('remote-export');const sessionId=engine.getSnapshot().sessionId,prepared=await repository.prepareHistoryExport(sessionId,'2026-10-08T10:00:00.000Z');const other=new FencedPracticeRepository(config);await other.prepare();await deleteA1(other,sessionId);let called=false;await assert.rejects(repository.deliverHistoryExport(prepared,()=>{called=true}));assert.equal(called,false);await other.close();await repository.close();
});

test('2B scoped export remains available for saved history while recording is OFF',async()=>{
 const{repository,engine}=await setup('export-while-off');await repository.setRecordingEnabled(false);const prepared=await repository.prepareHistoryExport(engine.getSnapshot().sessionId,'2026-10-08T10:00:00.000Z');let value='';await repository.deliverHistoryExport(prepared,data=>{value=data.json});assert.equal(JSON.parse(value).snapshot.sessionId,engine.getSnapshot().sessionId);await repository.close();
});

test('2B a closed repository and foreign handles cannot deliver cached history',async()=>{
 const{repository,engine,config}=await setup('export-ownership');const prepared=await repository.prepareHistoryExport(engine.getSnapshot().sessionId,'2026-10-08T10:00:00.000Z');const other=new FencedPracticeRepository(config);await other.prepare();await assert.rejects(other.deliverHistoryExport(prepared,()=>{}));await repository.close();await assert.rejects(repository.deliverHistoryExport(prepared,()=>{}));await other.close();
});

test('2B a delete request after delivery starts still prevents its pending final handoff',async()=>{
 const{repository,engine}=await setup('delivery-race');const sessionId=engine.getSnapshot().sessionId,prepared=await repository.prepareHistoryExport(sessionId,'2026-10-08T10:00:00.000Z');let delivered=false;
 const handoff=repository.deliverHistoryExport(prepared,()=>{delivered=true}),rejection=assert.rejects(handoff);const deletion=deleteA1(repository,sessionId);await rejection;await deletion;assert.equal(delivered,false);await repository.close();
});

test('2B an explicitly async sink is rejected before it can retain or later deliver the payload',async()=>{
 const{repository,engine}=await setup('async-sink');const prepared=await repository.prepareHistoryExport(engine.getSnapshot().sessionId,'2026-10-08T10:00:00.000Z');let called=false;await assert.rejects(repository.deliverHistoryExport(prepared,async()=>{called=true;await Promise.resolve()}));assert.equal(called,false);await repository.close();
});

test('2B a divergent captured live tail cannot overwrite newer durable history while deleting',async()=>{
 const{repository,engine,permit,clock}=await setup('live-conflict');const base=engine.getSnapshot();engine.input('newer durable branch');await repository.save(engine.getSnapshot(),permit);const durable=engine.getSnapshot();let id=0;const other=new PracticeEngine({snapshot:base,clock:{...clock,id:()=>`conflict-${++id}`}});other.input('divergent current tail');await assert.rejects(deleteA1(repository,base.sessionId,{liveSnapshot:other.getSnapshot(),permit}));assert.deepEqual(await repository.load(base.sessionId),durable);await repository.close();
});

test('2B opens a version1 isolated database in place and preserves its exact v1 facts before deletion',async()=>{
 const factory=new IDBFactory(),name='lingotrace-dev-fenced-upgrade-v1',fixture=fresh('upgrade-session');fixture.engine.startRound({materialId:ORIGINAL_PRACTICE_MATERIAL.materialId});fixture.engine.startAttempt({unitId:'cafe-order',mode:'dictation',attemptId:'a1'});fixture.engine.input('legacy isolated v1 answer');fixture.engine.submit();const before=fixture.engine.getSnapshot();
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=factory.open(name,1);request.onupgradeneeded=()=>{const db=request.result,events=db.createObjectStore('events',{keyPath:['sessionId','sequence']});events.createIndex('bySession','sessionId');events.createIndex('byEventId',['sessionId','eventId'],{unique:true});db.createObjectStore('heads',{keyPath:'sessionId'});db.createObjectStore('tombstones',{keyPath:'sessionId'});db.createObjectStore('control',{keyPath:'key'})};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
 await new Promise<void>((resolve,reject)=>{const tx=db.transaction(['events','heads','control'],'readwrite');for(const event of before.events)tx.objectStore('events').add(event);tx.objectStore('heads').add({sessionId:before.sessionId,schemaVersion:before.schemaVersion,sequence:before.sequence,eventCount:before.events.length,globalGeneration:0,sessionGeneration:0});tx.objectStore('control').add({key:'recording',recordingEnabled:true,globalGeneration:0,deletionWatermark:0,clearWatermark:0});tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error)});db.close();
 const repository=new FencedPracticeRepository({databaseName:name,indexedDB:factory});await repository.prepare();assert.deepEqual(await repository.load(before.sessionId),before);const after=await deleteA1(repository,before.sessionId);assert.ok(after.snapshot);assert.equal(after.snapshot.schemaVersion,'lingotrace-practice-v2');const raw=await stores(factory,name);assert.equal(JSON.stringify(raw).includes('legacy isolated v1 answer'),false);await repository.close();
});

for(const mode of ['clear','session-delete'] as const)test(`2B a later ${mode} request suppresses an earlier attempt-deletion snapshot handoff`,async()=>{
 const{repository,engine}=await setup(`deletion-receipt-${mode}`);const sessionId=engine.getSnapshot().sessionId,deletion=deleteA1(repository,sessionId);const superseding=mode==='clear'?repository.clearPracticeData():repository.deleteSession(sessionId);const receipt=await deletion;await superseding;
 assert.equal(receipt.deleted,true,'a committed erasure is still successful');assert.ok(receipt.snapshot===null,'the controller must not receive an obsolete snapshot that could repopulate its cache');assert.equal(receipt.permit,null);assert.equal(receipt.superseded,true);assert.equal(await repository.load(sessionId),null);await repository.close();
});

test('2B a read whose final status observer requests deletion cannot hand out its old snapshot',async()=>{
 const{repository,engine}=await setup('late-load');let triggered=false,deletion:Promise<unknown>|undefined;
 const unsubscribe=repository.subscribe(()=>{if(!triggered&&repository.getStatus().lastLoadedSequence!==null){triggered=true;deletion=deleteA1(repository,engine.getSnapshot().sessionId);void deletion.catch(()=>{})}});
 await assert.rejects(repository.load(engine.getSnapshot().sessionId));await deletion;unsubscribe();assert.ok(triggered);const current=await repository.load(engine.getSnapshot().sessionId);assert.ok(current);assert.equal(Object.hasOwn(current.projections.attempts,'a1'),false);await repository.close();
});

test('2B a caller-supplied redaction ID cannot retain an erased event ID in durable lineage',async()=>{
 const{repository,engine,factory,config}=await setup('redaction-id-collision');const before=await stores(factory,config.databaseName),old=engine.getSnapshot().events.find(event=>event.payload.type==='inputCommitted'&&event.payload.attemptId==='a1')!;
 await assert.rejects(deleteA1(repository,engine.getSnapshot().sessionId,{redactionId:old.eventId}));assert.deepEqual(await stores(factory,config.databaseName),before);await repository.close();
});

test('2B OFF during a live-tail rewrite rolls back the unsaved tail and the attempted erasure',async()=>{
 const{repository,engine,permit,factory,config}=await setup('off-during-rewrite');const before=await stores(factory,config.databaseName);engine.input('PRIVATE UNSAVED TAIL BEFORE OFF');const live=engine.getSnapshot(),original=IDBObjectStore.prototype.put;let off:Promise<unknown>|undefined,triggered=false;
 IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){const request=original.apply(this,args);if(this.name==='heads'&&!triggered){triggered=true;request.addEventListener('success',()=>{off=repository.setRecordingEnabled(false);void off.catch(()=>{})})}return request};
 try{await assert.rejects(deleteA1(repository,live.sessionId,{liveSnapshot:live,permit}));await off}finally{IDBObjectStore.prototype.put=original}
 const after=await stores(factory,config.databaseName);assert.ok(triggered);assert.deepEqual(after.events,before.events);assert.deepEqual(after.heads,before.heads);assert.deepEqual(after.attemptTombstones,before.attemptTombstones);assert.equal(repository.getStatus().recordingEnabled,false);await repository.close();
});

test('2B OFF after the erasure commit reports successful deletion without a continuation permit',async()=>{
 const{repository,engine}=await setup('off-after-commit');const original=IDBObjectStore.prototype.put;let off:Promise<unknown>|undefined,triggered=false;
 IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){const request=original.apply(this,args);if(this.name==='heads'&&!triggered){triggered=true;this.transaction.addEventListener('complete',()=>{off=repository.setRecordingEnabled(false);void off.catch(()=>{})})}return request};
 try{const receipt=await deleteA1(repository,engine.getSnapshot().sessionId);await off;assert.ok(triggered);assert.equal(receipt.deleted,true);assert.equal(receipt.permit,null);assert.ok(receipt.snapshot);assert.equal(receipt.superseded,false);assert.equal(Object.hasOwn(receipt.snapshot.projections.attempts,'a1'),false)}finally{IDBObjectStore.prototype.put=original}
 await repository.close();
});

test('2B whole-session deletion removes its attempt tombstones as well as canonical facts',async()=>{
 const{repository,engine,factory,config}=await setup('session-after-attempt');await deleteA1(repository,engine.getSnapshot().sessionId);await repository.deleteSession(engine.getSnapshot().sessionId);const raw=await stores(factory,config.databaseName);assert.deepEqual(raw.events,[]);assert.deepEqual(raw.heads,[]);assert.deepEqual(raw.attemptTombstones,[]);assert.equal(raw.tombstones.length,1);await repository.close();
});

test('2B formatter result access is captured once and cannot refill an invalidated private payload',async()=>{
 let reads=0;const{repository,engine}=await setup('formatter-accessors',{exportFormatter:async(snapshot:PracticeSnapshot,at:string)=>{const output=exportPracticeSnapshot(snapshot,at);return{get json(){reads++;if(reads>1)throw new Error('JSON formatter getter must only be read once');return output.json},csv:output.csv}}});
 const handle=await repository.prepareHistoryExport(engine.getSnapshot().sessionId,'2026-10-08T10:00:00.000Z');let delivered=false;await repository.deliverHistoryExport(handle,()=>{delivered=true});assert.equal(reads,1);assert.equal(delivered,true);await repository.close();
});

test('2B a read-only new instance cannot gain recording permission by deleting historical practice',async()=>{
 const{repository,engine,config}=await setup('history-does-not-grant');const sessionId=engine.getSnapshot().sessionId;await repository.close();const reader=new FencedPracticeRepository(config);await reader.prepare();assert.ok(await reader.load(sessionId));const receipt=await deleteA1(reader,sessionId);assert.equal(receipt.deleted,true);assert.ok(receipt.snapshot);assert.equal(receipt.permit,null,'erasure is not an admission of an existing session for recording');const repeated=await deleteA1(reader,sessionId);assert.equal(repeated.permit,null);await reader.close();
});

test('2B OFF then ON cannot recover an old recording permit through attempt deletion',async()=>{
 const{repository,engine,permit}=await setup('off-on-does-not-grant');await repository.setRecordingEnabled(false);await repository.setRecordingEnabled(true);const receipt=await deleteA1(repository,engine.getSnapshot().sessionId,{permit});assert.equal(receipt.deleted,true);assert.ok(receipt.snapshot);assert.equal(receipt.permit,null);await assert.rejects(repository.save(receipt.snapshot,permit),PracticeWriteFenceError);await repository.close();
});

test('2B durable-only deletion can renew only a supplied, previously valid recording permit',async()=>{
 const{repository,engine,permit,a2,clock}=await setup('valid-permit-renewal');const receipt=await deleteA1(repository,engine.getSnapshot().sessionId,{permit});assert.ok(receipt.snapshot);assert.ok(receipt.permit);assert.notEqual(receipt.permit,permit);await assert.rejects(repository.save(receipt.snapshot,permit),PracticeWriteFenceError);
 const continuation=new PracticeEngine({snapshot:receipt.snapshot,clock});continuation.input('new a2 draft under renewed permission');await repository.save(continuation.getSnapshot(),receipt.permit);assert.equal((await repository.load(receipt.snapshot.sessionId))!.projections.attempts[a2].draft.text,'new a2 draft under renewed permission');await repository.close();
});

for(const source of ['other-session','other-instance','older-repeated-delete'] as const)test(`2B ${source} permits cannot authorize continuation after deletion`,async()=>{
 const{repository,engine,permit,config}=await setup(`permit-${source}`);let candidate=permit,peer:FencedPracticeRepository|undefined;
 if(source==='older-repeated-delete'){const first=await deleteA1(repository,engine.getSnapshot().sessionId,{permit});assert.ok(first.permit)}
 else{const other=fresh(`unrelated-${source}`);const owner=source==='other-instance'?(peer=new FencedPracticeRepository(config)):repository;if(peer)await peer.prepare();candidate=await owner.beginRecordedSession(other.engine.getSnapshot())}
 const receipt=await deleteA1(repository,engine.getSnapshot().sessionId,{permit:candidate});assert.equal(receipt.deleted,true);assert.ok(receipt.snapshot);assert.equal(receipt.permit,null);await peer?.close();await repository.close();
});

for(const remote of [false,true])test(`2B deletion at the final export read ${remote?'waits until synchronous handoff':'prevents the same-page handoff'}`,async()=>{
 const{repository,engine,config}=await setup(`final-read-${remote}`);const peer=remote?new FencedPracticeRepository(config):repository;if(remote)await peer.prepare();const prepared=await repository.prepareHistoryExport(engine.getSnapshot().sessionId,'2026-10-08T10:00:00.000Z');const order:string[]=[],original=IDBObjectStore.prototype.get;let triggered=false,deletion:Promise<unknown>|undefined;
 IDBObjectStore.prototype.get=function(...args:Parameters<IDBObjectStore['get']>){const request=original.apply(this,args);if(this.name==='heads'&&!triggered){triggered=true;request.addEventListener('success',()=>{order.push('delete-requested');deletion=deleteA1(peer,engine.getSnapshot().sessionId).then(()=>{order.push('delete-committed')});void deletion.catch(()=>{})})}return request};
 try{const delivery=repository.deliverHistoryExport(prepared,()=>{order.push('sink')});if(remote)await delivery;else await assert.rejects(delivery);await deletion}finally{IDBObjectStore.prototype.get=original}
 assert.deepEqual(order,remote?['delete-requested','sink','delete-committed']:['delete-requested','delete-committed']);if(remote)await peer.close();await repository.close();
});

test('2B a queued foreign deletion that commits before renewal suppresses the earlier snapshot receipt',async()=>{
 const{repository,engine,permit,a2,config}=await setup('foreign-receipt');const peer=new FencedPracticeRepository(config);await peer.prepare();const original=IDBObjectStore.prototype.put;let triggered=false,second:Promise<unknown>|undefined;
 IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){const request=original.apply(this,args);if(this.name==='heads'&&!triggered){triggered=true;request.addEventListener('success',()=>{second=peer.deleteAttempt({sessionId:engine.getSnapshot().sessionId,attemptId:a2,redactionId:'foreign-delete-a2'});void second.catch(()=>{})})}return request};
 try{const first=await deleteA1(repository,engine.getSnapshot().sessionId,{permit});await second;assert.ok(triggered);assert.equal(first.deleted,true);assert.equal(first.superseded,true);assert.ok(first.snapshot===null);assert.equal(first.permit,null)}finally{IDBObjectStore.prototype.put=original}
 await peer.close();await repository.close();
});
