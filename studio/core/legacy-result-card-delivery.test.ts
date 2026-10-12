import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { TrainingEngine } from './training';
import { IndexedDBTrainingRepository } from './repository';
import { readLegacyHistoryRecord } from './legacy-history';
import { LegacyResultCardDelivery } from './legacy-result-card-delivery';
const png=()=>new Blob(['pixel-sample'],{type:'image/png'});
function pending<T>() { let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject}; }
function example(){const engine=new TrainingEngine({sessionId:'private-card-test'});const snapshot=engine.getSnapshot();return{engine,session:readLegacyHistoryRecord({sessionId:snapshot.sessionId,sequence:snapshot.sequence,snapshot,updatedAt:snapshot.createdAt},snapshot.sessionId)};}
test('PNG encodes first then existing repository final check hands off fixed generic filename',async()=>{
 const{session}=example(),steps:string[]=[];const delivery=new LegacyResultCardDelivery({deliverHistorySession:async(id,snapshot,sink)=>{assert.equal(id,session.snapshot.sessionId);assert.equal(snapshot,session.snapshot);steps.push('check');sink();}});
 assert.equal(await delivery.download(session,async()=>{steps.push('encode');return png();},(name,b)=>{assert.equal(name,'lingotrace-practice-card.png');assert.equal(b.type,'image/png');steps.push('sink');}),true);assert.deepEqual(steps,['encode','check','sink']);
});
test('cancel or fields change during encoding never reaches durable check/download',async()=>{
 for(const action of ['dispose','invalidate'] as const){const{session}=example(),blob=pending<Blob>();let checks=0,sinks=0;const delivery=new LegacyResultCardDelivery({deliverHistorySession:async()=>{checks++;}});const task=delivery.download(session,()=>blob.promise,()=>sinks++);delivery[action]();blob.resolve(png());assert.equal(await task,false);assert.equal(checks,0);assert.equal(sinks,0);}
});
test('close after encoding but before final handoff still blocks the download',async()=>{
 const{session}=example(),gate=pending<void>();let calls=0;const delivery=new LegacyResultCardDelivery({deliverHistorySession:async(_id,_s,sink)=>{await gate.promise;sink();}});const task=delivery.download(session,async()=>png(),()=>calls++);await Promise.resolve();delivery.dispose();gate.resolve();assert.equal(await task,false);assert.equal(calls,0);
});
test('repeat click while busy encodes once; retry after failure is available',async()=>{
 const{session}=example(),gate=pending<Blob>();let encodes=0,calls=0;const delivery=new LegacyResultCardDelivery({deliverHistorySession:async(_id,_s,sink)=>sink()});const first=delivery.download(session,()=>{encodes++;return gate.promise;},()=>calls++);assert.equal(await delivery.download(session,async()=>{encodes++;return png();},()=>calls++),false);gate.reject(Error('encode failed'));await assert.rejects(first);assert.equal(await delivery.download(session,async()=>png(),()=>calls++),true);assert.equal(encodes,1);assert.equal(calls,1);
});
test('invalid/empty image is not delivered and late failure after close is silent',async()=>{
 const{session}=example();let calls=0;const delivery=new LegacyResultCardDelivery({deliverHistorySession:async()=>{calls++;}});for(const blob of [new Blob([],{type:'image/png'}),new Blob(['text'],{type:'text/plain'})])await assert.rejects(delivery.download(session,async()=>blob,()=>{}));assert.equal(calls,0);const gate=pending<Blob>();const task=delivery.download(session,()=>gate.promise,()=>{});delivery.dispose();gate.reject(Error('late'));assert.equal(await task,false);
});
test('real isolated IDB read boundary rejects updated snapshot after encoding; delivery leaves the stored snapshot unchanged',async()=>{
 const {engine}=example();const repo=new IndexedDBTrainingRepository({indexedDB:new IDBFactory(),dbName:'private-card-isolated'});await repo.saveSession(engine.getSnapshot());const selected=(await repo.loadHistorySession(engine.getSnapshot().sessionId))!;const before=JSON.stringify(selected.snapshot);const delivery=new LegacyResultCardDelivery(repo);let calls=0;assert.equal(await delivery.download(selected,async()=>png(),()=>calls++),true);assert.equal(JSON.stringify((await repo.loadHistorySession(selected.snapshot.sessionId))!.snapshot),before);const gate=pending<Blob>();const task=delivery.download(selected,()=>gate.promise,()=>calls++);engine.input('new visible draft');await repo.saveSession(engine.getSnapshot());gate.resolve(png());await assert.rejects(task);assert.equal(calls,1);assert.equal((await repo.loadHistorySession(selected.snapshot.sessionId))!.snapshot.sequence,engine.getSnapshot().sequence);await repo.close();
});
test('effect reconnect works and cannot revive earlier deliveries',async()=>{
 const{session}=example(),old=pending<Blob>();let calls=0;const delivery=new LegacyResultCardDelivery({deliverHistorySession:async(_id,_s,sink)=>sink()});const task=delivery.download(session,()=>old.promise,()=>calls++);delivery.dispose();delivery.activate();assert.equal(await delivery.download(session,async()=>png(),()=>calls++),true);old.resolve(png());assert.equal(await task,false);assert.equal(calls,1);
});
