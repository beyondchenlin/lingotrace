import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { TrainingEngine, CAFE_MATERIAL, type TrainingSnapshot } from './training.ts';
import { IndexedDBTrainingRepository } from './repository.ts';
import { TrainingHistorySegmentProjector } from './training-history-segment.ts';
import { buildReviewTarget, type ReviewSourceLocator, type ReviewSessionBinding } from './review-tasks.ts';
import { LOCAL_REFERENCE_MEDIA_ID, LOCAL_REFERENCE_MEDIA_SHA256 } from './local-reference.ts';
import { resolveReviewLocalTime } from './review-due-time.ts';
import { REVIEW_TASK_PREFIX, REVIEW_INSTANCE_PREFIX, REVIEW_RESULT_PREFIX, REVIEW_BINDING_PREFIX } from './review-task-storage.ts';
const time='2026-10-10T10:00:00.000Z',name='review-storage-test';
const due=resolveReviewLocalTime('2026-10-12T10:00','UTC')[0],nextDue=resolveReviewLocalTime('2026-10-13T10:00','UTC')[0];
const media={id:LOCAL_REFERENCE_MEDIA_ID,sha256:LOCAL_REFERENCE_MEDIA_SHA256,durationSeconds:72};
function engine(prefix:string){let n=0;return new TrainingEngine({clock:{now:()=>0,wallTime:()=>time,id:()=>`${prefix}-${++n}`}});}
function answer(e:TrainingEngine,text='wrong but authentic'){e.input(text,'typed',{version:'dom-edit-v1',kind:'input',inputType:'insertText',data:text});e.submit();}
function full(s:TrainingSnapshot):ReviewSourceLocator{const a=s.attempts.at(-1)!;return {kind:'full',sessionId:s.sessionId,attemptId:a.attemptId,submitEventId:s.events.find(e=>e.type==='submitRequested'&&e.attemptId===a.attemptId)!.eventId,judgmentEventId:s.events.find(e=>e.type==='judgmentApplied'&&e.attemptId===a.attemptId)!.eventId};}
async function raw(factory:IDBFactory,fn:(tx:IDBTransaction)=>void,mode:IDBTransactionMode='readonly'){
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=factory.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction(['sessions','events','meta'],mode);fn(tx);tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error);});db.close();
}
async function rows(factory:IDBFactory){let result:any[]=[];await raw(factory,tx=>{const r=tx.objectStore('meta').getAll();r.onsuccess=()=>{result=r.result;};});return result;}
async function fixture(){const factory=new IDBFactory(),repo=new IndexedDBTrainingRepository({indexedDB:factory,dbName:name}),sourceEngine=engine('source');answer(sourceEngine);await repo.saveSession(sourceEngine.getSnapshot());
  const target=await buildReviewTarget(CAFE_MATERIAL,CAFE_MATERIAL.cues[0].id,media),source=full(sourceEngine.getSnapshot());
  const created=await repo.createReviewTask({requestId:'request-one',source,target,due});return {factory,repo,sourceEngine,target,source,created};}
async function started(){const f=await fixture(),plan=await f.repo.prepareReviewRetest({taskId:f.created.task.taskId,expectedRevision:1,nextDue}),retest=engine('retest');await f.repo.saveSession(retest.getSnapshot());
  const binding=await f.repo.bindReviewSession({taskId:plan.task.taskId,instanceId:plan.instance.instanceId,expectedRevision:plan.task.revision,session:{kind:'full',sessionId:retest.getSnapshot().sessionId,generation:0}});return {...f,plan,retest,binding};}

test('empty list creates no database; creation/reload/planning/cancel/reschedule have no Training side effects',async()=>{
  const factory=new IDBFactory(),empty=new IndexedDBTrainingRepository({indexedDB:factory,dbName:name});assert.deepEqual(await empty.listReviewTasks(),{entries:[],unreadableCount:0});assert.deepEqual(await factory.databases(),[]);await empty.close();
  const f=await fixture(),before=await f.repo.loadHistorySession(f.source.sessionId);assert.equal((await f.repo.listReviewTasks()).entries.length,1);
  const plan=await f.repo.prepareReviewRetest({taskId:f.created.task.taskId,expectedRevision:1,nextDue});
  assert.deepEqual(await f.repo.prepareReviewRetest({taskId:plan.task.taskId,expectedRevision:1,nextDue}),plan);
  await assert.rejects(f.repo.prepareReviewRetest({taskId:plan.task.taskId,expectedRevision:plan.task.revision,nextDue:due}),{code:'revision-conflict'});
  const moved=await f.repo.changeReviewTask({taskId:plan.task.taskId,expectedRevision:plan.task.revision,action:'reschedule',due:nextDue});
  assert.notEqual(moved.instance.instanceId,plan.instance.instanceId);const cancelled=await f.repo.changeReviewTask({taskId:moved.task.taskId,expectedRevision:moved.task.revision,action:'cancel'});
  const restored=await f.repo.changeReviewTask({taskId:cancelled.task.taskId,expectedRevision:cancelled.task.revision,action:'restore',due:nextDue});assert.notEqual(restored.instance.instanceId,cancelled.instance.instanceId);
  assert.deepEqual(await f.repo.loadHistorySession(f.source.sessionId),before);assert.equal((await f.repo.listHistory()).entries.length,1);
  await f.repo.close();const reopened=new IndexedDBTrainingRepository({indexedDB:f.factory,dbName:name});assert.deepEqual(await reopened.loadReviewTask(restored.task.taskId),restored.task);await reopened.close();
});
test('request idempotence and cross-tab active uniqueness require no BroadcastChannel; cancelled-source ABA is safe',async()=>{
  const f=await fixture(),other=new IndexedDBTrainingRepository({indexedDB:f.factory,dbName:name});
  const results=await Promise.all(Array.from({length:8},(_,i)=>(i%2?f.repo:other).createReviewTask({requestId:`concurrent-${i}`,source:f.source,target:f.target,due:nextDue})));
  assert.equal(new Set(results.map(r=>r.task.taskId)).size,1);assert.equal((await f.repo.listReviewTasks()).entries.length,1);
  const exact=await other.createReviewTask({requestId:'request-one',source:f.source,target:f.target,due});assert.equal(exact.task.taskId,f.created.task.taskId);
  await assert.rejects(other.createReviewTask({requestId:'request-one',source:f.source,target:f.target,due:nextDue}),{code:'request-conflict'});
  const cancelled=await f.repo.changeReviewTask({taskId:f.created.task.taskId,expectedRevision:1,action:'cancel'});
  const replacement=await other.createReviewTask({requestId:'new-after-cancel',source:f.source,target:f.target,due});assert.notEqual(replacement.task.taskId,cancelled.task.taskId);
  await assert.rejects(f.repo.changeReviewTask({taskId:cancelled.task.taskId,expectedRevision:cancelled.task.revision,action:'restore',due}),{code:'revision-conflict'});
  await assert.rejects(f.repo.changeReviewTask({taskId:cancelled.task.taskId,expectedRevision:1,action:'reschedule',due}),{code:'revision-conflict'});
  await f.repo.close();await other.close();
});
test('first real incorrect result wins; successor exact date; old-session corrections and duplicate cannot advance successor',async()=>{
  const f=await started();answer(f.retest);await f.repo.saveSession(f.retest.getSnapshot());const source=full(f.retest.getSnapshot());
  const won=await f.repo.commitReviewResult({binding:f.binding,source});assert.equal(won.disposition,'winner');assert.deepEqual(won.task.due,nextDue);assert.notEqual(won.task.currentInstanceId,f.binding.instanceId);
  const successor=await f.repo.loadReviewInstance(won.task.currentInstanceId);assert.equal(successor?.nextDue,null);assert.equal(successor?.winner,null);assert.equal(won.instance.winner?.source.attemptId,source.attemptId);
  const duplicate=await f.repo.commitReviewResult({binding:f.binding,source});assert.equal(duplicate.disposition,'duplicate');assert.equal(duplicate.task.revision,won.task.revision);
  f.retest.input('another wrong answer');f.retest.submit();await f.repo.saveSession(f.retest.getSnapshot());const later=await f.repo.commitReviewResult({binding:f.binding,source:full(f.retest.getSnapshot())});
  assert.equal(later.disposition,'later');assert.equal(later.instance.instanceId,f.binding.instanceId);assert.equal(later.task.currentInstanceId,successor?.instanceId);
  const exported=await f.repo.exportReviewTask(won.task.taskId);assert.equal(exported.relations.length,2);assert.equal(exported.instances.length,2);assert.equal(exported.evidence.every(e=>e.availability==='available'),true);
  for(const proof of exported.evidence){const actual=[...f.sourceEngine.getSnapshot().attempts,...f.retest.getSnapshot().attempts].find(a=>a.attemptId===proof.source.attemptId)!;assert.deepEqual(proof.result,{words:actual.words,errors:actual.errors,accuracy:actual.accuracy});}
  const retained=(await rows(f.factory)).filter(r=>String(r.key).startsWith('review-'));assert.doesNotMatch(JSON.stringify(retained),/wrong but authentic|another wrong answer|"accuracy"|"errors"|"alignment"/);
  await f.repo.close();
});
test('winner transaction rollback leaves no relation, successor, winner or partial due; old Training status stays persisted',async()=>{
  const f=await started();answer(f.retest);await f.repo.saveSession(f.retest.getSnapshot());const source=full(f.retest.getSnapshot()),before=await rows(f.factory),status=f.repo.getStatus();
  const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value:any,...args:any[]){if(this.name==='meta'&&String(value.key).startsWith(REVIEW_TASK_PREFIX))throw new DOMException('synthetic quota','QuotaExceededError');return original.call(this,value,...args);};
  try{await assert.rejects(f.repo.commitReviewResult({binding:f.binding,source}),/synthetic quota/);}finally{IDBObjectStore.prototype.put=original;}
  assert.deepEqual(await rows(f.factory),before);assert.deepEqual(f.repo.getStatus(),status);assert.equal((await f.repo.loadHistorySession(source.sessionId))!.snapshot.attempts.length,1);
  assert.equal((await f.repo.commitReviewResult({binding:f.binding,source})).disposition,'winner');await f.repo.close();
});
test('competing real sessions share original instance; exactly one winner and one loser with no BC',async()=>{
  const f=await started(),b=new IndexedDBTrainingRepository({indexedDB:f.factory,dbName:name}),second=engine('concurrent');await b.saveSession(second.getSnapshot());
  const binding=await b.bindReviewSession({taskId:f.plan.task.taskId,instanceId:f.plan.instance.instanceId,expectedRevision:f.plan.task.revision,session:{kind:'full',sessionId:second.getSnapshot().sessionId,generation:0}});
  answer(f.retest,'first mistake');answer(second,'second mistake');await Promise.all([f.repo.saveSession(f.retest.getSnapshot()),b.saveSession(second.getSnapshot())]);
  const results=await Promise.all([f.repo.commitReviewResult({binding:f.binding,source:full(f.retest.getSnapshot())}),b.commitReviewResult({binding,source:full(second.getSnapshot())})]);assert.deepEqual(results.map(r=>r.disposition).sort(),['later','winner']);
  assert.equal(new Set(results.map(r=>r.task.currentInstanceId)).size,1);assert.equal((await f.repo.exportReviewTask(f.plan.task.taskId)).relations.length,2);await f.repo.close();await b.close();
});
test('cancel/reschedule invalidates old capabilities and restore creates a fresh occurrence',async()=>{
  for(const action of ['cancel','reschedule'] as const){const f=await started();answer(f.retest);await f.repo.saveSession(f.retest.getSnapshot());await f.repo.changeReviewTask({taskId:f.plan.task.taskId,expectedRevision:f.plan.task.revision,action,...(action==='reschedule'?{due:nextDue}:{})});
    await assert.rejects(f.repo.commitReviewResult({binding:f.binding,source:full(f.retest.getSnapshot())}),e=>e instanceof Error&&['inactive-instance','invalid-binding'].includes((e as any).code));assert.equal(await f.repo.restoreReviewSessionBinding(f.binding.session.sessionId),null);await f.repo.close();}
});
test('binding requires clean saved new session; cloned capability, unsaved source and foreign attempt are rejected',async()=>{
  const f=await started();await assert.rejects(f.repo.commitReviewResult({binding:structuredClone(f.binding),source:f.source}),{code:'invalid-binding'});
  answer(f.retest);const source=full(f.retest.getSnapshot());await assert.rejects(f.repo.commitReviewResult({binding:f.binding,source}),{code:'invalid-source'});
  await f.repo.saveSession(f.retest.getSnapshot());await assert.rejects(f.repo.commitReviewResult({binding:f.binding,source:f.source}),{code:'invalid-binding'});
  const dirty=engine('dirty');answer(dirty);await f.repo.saveSession(dirty.getSnapshot());await assert.rejects(f.repo.bindReviewSession({taskId:f.plan.task.taskId,instanceId:f.plan.instance.instanceId,expectedRevision:f.plan.task.revision,session:{kind:'full',sessionId:dirty.getSnapshot().sessionId,generation:0}}),{code:'invalid-binding'});await f.repo.close();
});
test('full source strictly matches request-before-judgment, answer, cue, version, words and actual events without rescoring',async()=>{
  const changes:[string,(snapshot:any,source:any)=>void][]=[
    ['missing request',(s,l)=>{l.submitEventId='absent';}],['wrong judgment',(s,l)=>{l.judgmentEventId='absent';}],['wrong attempt',(s,l)=>{l.attemptId='absent';}],
    ['answer mismatch',s=>{s.attempts[0].answer='other';}],['words zero',s=>{s.attempts[0].words=0;}],['wrong cue',s=>{s.attempts[0].cueId=CAFE_MATERIAL.cues[1].id;}],
    ['wrong reference',s=>{s.attempts[0].reference='other';}],['request after judgment',s=>{const q=s.events.find((e:any)=>e.type==='submitRequested'),j=s.events.find((e:any)=>e.type==='judgmentApplied');const qi=s.events.indexOf(q),ji=s.events.indexOf(j);s.events[qi]={...j,sequence:qi+1};s.events[ji]={...q,sequence:ji+1};}],
  ];
  for(const [label,change] of changes){const f=await fixture(),s=structuredClone(f.sourceEngine.getSnapshot()),locator=structuredClone(f.source);change(s,locator);await raw(f.factory,tx=>{tx.objectStore('sessions').put({sessionId:s.sessionId,sequence:s.sequence,snapshot:s,updatedAt:time});for(const e of s.events)tx.objectStore('events').put(e);},'readwrite');
    await assert.rejects(f.repo.createReviewTask({requestId:`invalid-${label}`,source:locator,target:f.target,due,taskId:`invalid-task-${label}`}),label);await f.repo.close();}
});
test('local OFF before relationship commit and remote OFF without BC retain no result pointer; later ON cannot backfill',async()=>{
  for(const remote of [false,true]){const f=await started();answer(f.retest);await f.repo.saveSession(f.retest.getSnapshot());const source=full(f.retest.getSnapshot()),other=new IndexedDBTrainingRepository({indexedDB:f.factory,dbName:name});
    await (remote?other:f.repo).disableAutomaticHistory(0);await assert.rejects(f.repo.commitReviewResult({binding:f.binding,source}));const control=await f.repo.readAutomaticHistoryControl();await f.repo.enableAutomaticHistory(control.generation);
    await assert.rejects(f.repo.commitReviewResult({binding:f.binding,source}));assert.equal((await rows(f.factory)).filter(r=>String(r.key).startsWith(REVIEW_RESULT_PREFIX)).length,0);assert.equal((await f.repo.loadHistorySession(source.sessionId))!.snapshot.attempts.length,1);await f.repo.close();await other.close();}
});
test('OFF after automatic review transaction starts aborts all relation writes; page suspend revokes delayed promise',async()=>{
  for(const stop of ['off','suspend'] as const){const f=await started();answer(f.retest);await f.repo.saveSession(f.retest.getSnapshot());let stopped=false,off:Promise<unknown>|null=null;
    const original=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(value:any,...args:any[]){const result=original.call(this,value,...args);if(this.name==='meta'&&String(value.key).startsWith(REVIEW_RESULT_PREFIX)&&!stopped){stopped=true;if(stop==='off')off=f.repo.disableAutomaticHistory(0);else f.repo.revokeReviewSessionBindings();}return result;};
    try{await assert.rejects(f.repo.commitReviewResult({binding:f.binding,source:full(f.retest.getSnapshot())}));}finally{IDBObjectStore.prototype.add=original;}
    if(off)await off;assert.equal(stopped,true);assert.equal((await rows(f.factory)).filter(r=>String(r.key).startsWith(REVIEW_RESULT_PREFIX)).length,0);assert.equal((await f.repo.loadReviewInstance(f.plan.instance.instanceId))!.status,'pending');await f.repo.close();}
});
test('full restore uses exact persistent binding and retains won instance; partial or replaced practice does not restore',async()=>{
  const f=await started();answer(f.retest);await f.repo.saveSession(f.retest.getSnapshot());await f.repo.commitReviewResult({binding:f.binding,source:full(f.retest.getSnapshot())});await f.repo.close();
  const restored=new IndexedDBTrainingRepository({indexedDB:f.factory,dbName:name}),binding=await restored.restoreReviewSessionBinding(f.binding.session.sessionId);assert.ok(binding);assert.equal(binding.instanceId,f.binding.instanceId);
  assert.equal(await restored.restoreReviewSessionBinding(f.source.sessionId),null);assert.equal((await restored.commitReviewResult({binding,source:full(f.retest.getSnapshot())})).disposition,'duplicate');await restored.close();
});
test('partial same-attempt readback and active segment permit work; provenance stays unknown and facts stay exact',async()=>{
  const f=await fixture(),control=await f.repo.enableAutomaticHistory(0),retest=engine('partial'),projector=new TrainingHistorySegmentProjector(retest.getSnapshot(),{segmentId:'segment-one',writerInstanceId:'writer',generation:control.generation,startedAt:time});
  const admission=await f.repo.beginTrainingHistorySegment(projector.getSegment(),control.generation),plan=await f.repo.prepareReviewRetest({taskId:f.created.task.taskId,expectedRevision:1,nextDue});
  const session={kind:'partial' as const,sessionId:retest.getSnapshot().sessionId,segmentId:'segment-one',generation:control.generation};const binding=await f.repo.bindReviewSession({taskId:plan.task.taskId,instanceId:plan.instance.instanceId,expectedRevision:plan.task.revision,session});
  answer(retest);projector.observe(retest.getSnapshot());await f.repo.saveTrainingHistorySegment(admission.permit,projector.getSegment());const {kind:_,...locator}=full(retest.getSnapshot());const source={...locator,...session};
  const before=await f.repo.loadTrainingHistorySegment('segment-one');assert.equal((await f.repo.commitReviewResult({binding,source})).disposition,'winner');assert.deepEqual(await f.repo.loadTrainingHistorySegment('segment-one'),before);
  const exported=await f.repo.exportReviewTask(plan.task.taskId);const partialEvidence=exported.evidence.find(e=>e.source.kind==='partial')!;assert.equal(partialEvidence.assistance,'unknown');const actual=retest.getSnapshot().attempts[0];assert.deepEqual(partialEvidence.result,{words:actual.words,errors:actual.errors,accuracy:actual.accuracy});
  f.repo.revokeTrainingHistorySegment(admission.permit);await assert.rejects(f.repo.commitReviewResult({binding,source}));await f.repo.close();
  const reopened=new IndexedDBTrainingRepository({indexedDB:f.factory,dbName:name});assert.equal(await reopened.restoreReviewSessionBinding(session.sessionId),null);await reopened.close();
});
test('malformed review row is explicit unavailable while old full history remains untouched; exports show deleted evidence',async()=>{
  const f=await fixture();await raw(f.factory,tx=>{tx.objectStore('meta').put({key:REVIEW_TASK_PREFIX+'corrupt',value:{schemaVersion:'future'}});},'readwrite');
  const listed=await f.repo.listReviewTasks();assert.equal(listed.entries.length,1);assert.equal(listed.unreadableCount,1);await assert.rejects(f.repo.loadReviewTask('corrupt'));assert.equal((await f.repo.listHistory()).entries.length,1);assert.ok(await f.repo.loadLatest());
  await raw(f.factory,tx=>{tx.objectStore('sessions').delete(f.source.sessionId);},'readwrite');const unavailable=(await f.repo.exportReviewTask(f.created.task.taskId)).evidence[0];assert.equal(unavailable.availability,'unavailable');assert.equal(unavailable.result,null);await f.repo.close();
});

test('partial rejects all invalid request/judgment relations and neither copies nor promotes redacted facts',async()=>{
  const mutations:[string,(s:any,l:any)=>void][]=[
    ['missing request',(_,l)=>{l.submitEventId='missing';}],['wrong source event',(_,l)=>{l.judgmentEventId='missing';}],['wrong attempt',(_,l)=>{l.attemptId='other';}],
    ['wrong generation',(_,l)=>{l.generation++;}],['wrong segment',(_,l)=>{l.segmentId='other';}],['wrong session',(_,l)=>{l.sessionId='other';}],
    ['wrong cue',s=>{s.facts.find((f:any)=>f.type==='judgmentApplied').cueId=CAFE_MATERIAL.cues[1].id;}],
    ['wrong version',s=>{s.material.version='wrong';}],['answer mismatch',s=>{s.facts.find((f:any)=>f.type==='judgmentApplied').result.answer='not submitted';}],
    ['zero words',s=>{s.facts.find((f:any)=>f.type==='judgmentApplied').result.words=0;}],
    ['redacted request',s=>{const q=s.facts.find((f:any)=>f.type==='submitRequested');delete q.answer;q.retention='redacted';q.redactionReason='unknown-edit';}],
    ['unavailable result',s=>{const j=s.facts.find((f:any)=>f.type==='judgmentApplied');delete j.result;j.retention='unavailable';j.reason='judgment-not-applied';}],
    ['redacted result',s=>{const j=s.facts.find((f:any)=>f.type==='judgmentApplied');delete j.result;j.retention='redacted';j.redactionReason='unknown-edit';}],
    ['request after result',s=>{const q=s.facts.find((f:any)=>f.type==='submitRequested'),j=s.facts.find((f:any)=>f.type==='judgmentApplied'),qi=s.facts.indexOf(q),ji=s.facts.indexOf(j);s.facts[qi]={...j,ordinal:qi+1};s.facts[ji]={...q,ordinal:ji+1};}],
  ];
  for(const [label,mutate] of mutations){const f=await fixture(),control=await f.repo.enableAutomaticHistory(0),e=engine('partial-bad'),p=new TrainingHistorySegmentProjector(e.getSnapshot(),{segmentId:'bad-segment',writerInstanceId:'w',generation:control.generation,startedAt:time});
    const admission=await f.repo.beginTrainingHistorySegment(p.getSegment(),control.generation);answer(e);p.observe(e.getSnapshot());await f.repo.saveTrainingHistorySegment(admission.permit,p.getSegment());
    const {kind:_,...base}=full(e.getSnapshot()),locator:any={...base,kind:'partial',segmentId:'bad-segment',generation:control.generation},segment=structuredClone(p.getSegment());mutate(segment,locator);
    await raw(f.factory,tx=>{tx.objectStore('meta').put({key:'training-history-segment:bad-segment',version:1,segment,updatedAt:time});},'readwrite');
    await assert.rejects(f.repo.createReviewTask({requestId:`partial-invalid-${label}`,source:locator,target:f.target,due}),label);assert.equal((await f.repo.listReviewTasks()).entries.length,1);await f.repo.close();}
});
test('deleting original task source prevents launch/advance without inventing zero score or deleting the real new answer',async()=>{
  const f=await started();answer(f.retest);await f.repo.saveSession(f.retest.getSnapshot());await raw(f.factory,tx=>tx.objectStore('sessions').delete(f.source.sessionId),'readwrite');
  await assert.rejects(f.repo.commitReviewResult({binding:f.binding,source:full(f.retest.getSnapshot())}),{code:'unavailable'});assert.equal((await f.repo.loadReviewInstance(f.binding.instanceId))?.status,'pending');assert.equal((await f.repo.loadHistorySession(f.binding.session.sessionId))?.snapshot.attempts.length,1);await f.repo.close();
});
test('OFF before answer flush saves neither private answer nor review candidate, and delayed bind cannot retain a startup pointer',async()=>{
  const f=await started();await f.repo.disableAutomaticHistory(0);answer(f.retest,'private after off');await assert.rejects(f.repo.saveSession(f.retest.getSnapshot()));
  await assert.rejects(f.repo.commitReviewResult({binding:f.binding,source:full(f.retest.getSnapshot())}));let serialized='';await raw(f.factory,tx=>{for(const name of ['sessions','events','meta']){const r=tx.objectStore(name).getAll();r.onsuccess=()=>{serialized+=JSON.stringify(r.result);};}});assert.doesNotMatch(serialized,/private after off|pending-candidate/);await f.repo.close();
  const second=await fixture(),plan=await second.repo.prepareReviewRetest({taskId:second.created.task.taskId,expectedRevision:1,nextDue}),e=engine('late-bind');await second.repo.saveSession(e.getSnapshot());
  const binding=second.repo.bindReviewSession({taskId:plan.task.taskId,instanceId:plan.instance.instanceId,expectedRevision:plan.task.revision,session:{kind:'full',sessionId:e.getSnapshot().sessionId,generation:0}});const off=second.repo.disableAutomaticHistory(0);
  await assert.rejects(binding);await off;assert.equal((await rows(second.factory)).filter(r=>String(r.key).startsWith(REVIEW_BINDING_PREFIX)).length,0);await second.repo.close();
});
test('partial permit revocation during winner add aborts relations; close revokes in-flight work too',async()=>{
  const f=await fixture(),control=await f.repo.enableAutomaticHistory(0),e=engine('partial-revoke'),p=new TrainingHistorySegmentProjector(e.getSnapshot(),{segmentId:'revoke-segment',writerInstanceId:'w',generation:control.generation,startedAt:time}),admission=await f.repo.beginTrainingHistorySegment(p.getSegment(),control.generation);
  const plan=await f.repo.prepareReviewRetest({taskId:f.created.task.taskId,expectedRevision:1,nextDue}),session={kind:'partial' as const,sessionId:e.getSnapshot().sessionId,segmentId:'revoke-segment',generation:control.generation},binding=await f.repo.bindReviewSession({taskId:plan.task.taskId,instanceId:plan.instance.instanceId,expectedRevision:plan.task.revision,session});
  answer(e);p.observe(e.getSnapshot());await f.repo.saveTrainingHistorySegment(admission.permit,p.getSegment());const {kind:_,...base}=full(e.getSnapshot());const source={...base,...session};
  const original=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(value:any,...args:any[]){const result=original.call(this,value,...args);if(String(value.key).startsWith(REVIEW_RESULT_PREFIX))f.repo.revokeTrainingHistorySegment(admission.permit);return result;};
  try{await assert.rejects(f.repo.commitReviewResult({binding,source}));}finally{IDBObjectStore.prototype.add=original;}
  assert.equal((await rows(f.factory)).filter(r=>String(r.key).startsWith(REVIEW_RESULT_PREFIX)).length,0);await f.repo.close();
  const g=await started();answer(g.retest);await g.repo.saveSession(g.retest.getSnapshot());const pending=g.repo.commitReviewResult({binding:g.binding,source:full(g.retest.getSnapshot())}),closed=g.repo.close();await assert.rejects(pending);await closed;assert.equal((await rows(g.factory)).filter(r=>String(r.key).startsWith(REVIEW_RESULT_PREFIX)).length,0);
});
test('old revision with same next date cannot silently acquire a replacement occurrence',async()=>{
  const f=await started();const moved=await f.repo.changeReviewTask({taskId:f.plan.task.taskId,expectedRevision:f.plan.task.revision,action:'reschedule',due});const fresh=await f.repo.prepareReviewRetest({taskId:moved.task.taskId,expectedRevision:moved.task.revision,nextDue});
  assert.notEqual(fresh.instance.instanceId,f.plan.instance.instanceId);await assert.rejects(f.repo.prepareReviewRetest({taskId:fresh.task.taskId,expectedRevision:f.plan.task.revision,nextDue}),{code:'revision-conflict'});await f.repo.close();
});

test('creation failure rolls back request identity and active key; explicit retry creates the first task once',async()=>{
  const factory=new IDBFactory(),repo=new IndexedDBTrainingRepository({indexedDB:factory,dbName:name}),e=engine('creation-failure');answer(e);await repo.saveSession(e.getSnapshot());
  const target=await buildReviewTarget(CAFE_MATERIAL,CAFE_MATERIAL.cues[0].id,media),options={requestId:'rollback-request',source:full(e.getSnapshot()),target,due};
  const before=await rows(factory),status=repo.getStatus(),original=IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add=function(value:any,...args:any[]){if(this.name==='meta'&&String(value.key).startsWith('review-request-v1:'))throw new DOMException('request quota','QuotaExceededError');return original.call(this,value,...args);};
  try{await assert.rejects(repo.createReviewTask(options),/request quota/);}finally{IDBObjectStore.prototype.add=original;}
  assert.deepEqual(await rows(factory),before);assert.deepEqual(repo.getStatus(),status);assert.equal((await repo.createReviewTask(options)).disposition,'created');assert.equal((await repo.createReviewTask(options)).disposition,'duplicate');await repo.close();
});
test('missing/corrupt current instance and target digest cannot masquerade as an empty valid task library',async()=>{
  for(const corrupt of ['instance','digest']){const f=await fixture();await raw(f.factory,tx=>{if(corrupt==='instance')tx.objectStore('meta').delete(REVIEW_INSTANCE_PREFIX+f.created.instance.instanceId);else tx.objectStore('meta').put({key:REVIEW_TASK_PREFIX+f.created.task.taskId,value:{...f.created.task,target:{...f.target,materialDigest:'0'.repeat(64)}}});},'readwrite');
    assert.deepEqual(await f.repo.listReviewTasks(),{entries:[],unreadableCount:1});assert.equal((await f.repo.listHistory()).entries.length,1);await f.repo.close();}
});

test('restore without an explicitly selected date is rejected without changing metadata or Training',async()=>{
  const f=await fixture();const cancelled=await f.repo.changeReviewTask({taskId:f.created.task.taskId,expectedRevision:f.created.task.revision,action:'cancel'});
  const metadata=await rows(f.factory),history=await f.repo.loadHistorySession(f.source.sessionId),status=f.repo.getStatus();
  await assert.rejects(f.repo.changeReviewTask({taskId:cancelled.task.taskId,expectedRevision:cancelled.task.revision,action:'restore'}),{code:'invalid-record'});
  assert.deepEqual(await rows(f.factory),metadata);assert.deepEqual(await f.repo.loadHistorySession(f.source.sessionId),history);assert.deepEqual(f.repo.getStatus(),status);
  const restored=await f.repo.changeReviewTask({taskId:cancelled.task.taskId,expectedRevision:cancelled.task.revision,action:'restore',due:nextDue});
  assert.deepEqual(restored.task.due,nextDue);assert.deepEqual(restored.instance.due,nextDue);assert.notEqual(restored.instance.instanceId,cancelled.instance.instanceId);await f.repo.close();
});

test('partial fresh startup admits only non-answer setup facts and rejects input, exposure, navigation and composition',async()=>{
  const cases:[string,(e:TrainingEngine,tick:()=>void)=>void,boolean][]=[
    ['safe setup',(e,tick)=>{e.setFrozen('idle',false);tick();e.sampleClock();e.setFrozen('modal',true);e.setInputObservationFocused(false);},true],
    ['input',e=>e.input('unsubmitted'),false],['empty input',e=>e.input('','typed',{version:'dom-edit-v1',kind:'input',inputType:'insertText',data:''}),false],['answer',e=>answer(e),false],
    ['hint',e=>e.exposeHint('hint'),false],['reveal',e=>e.exposeHint('reveal'),false],['navigation',e=>e.nextCue(1),false],['composition',e=>e.beginComposition(),false],
  ];
  for(const [label,setup,allowed] of cases){const f=await fixture(),control=await f.repo.enableAutomaticHistory(0);let clock=0,sequence=0;
    const e=new TrainingEngine({clock:{now:()=>clock,wallTime:()=>time,id:()=>`setup-${label}-${++sequence}`},inputObservation:{runId:`setup-${label}`}}),p=new TrainingHistorySegmentProjector(e.getSnapshot(),{segmentId:'setup-segment',writerInstanceId:'writer',generation:control.generation,startedAt:time});
    const admission=await f.repo.beginTrainingHistorySegment(p.getSegment(),control.generation);setup(e,()=>{clock=1000;});p.observe(e.getSnapshot());await f.repo.saveTrainingHistorySegment(admission.permit,p.getSegment());
    const plan=await f.repo.prepareReviewRetest({taskId:f.created.task.taskId,expectedRevision:1,nextDue}),binding=f.repo.bindReviewSession({taskId:plan.task.taskId,instanceId:plan.instance.instanceId,expectedRevision:plan.task.revision,session:{kind:'partial',sessionId:e.getSnapshot().sessionId,segmentId:'setup-segment',generation:control.generation}});
    if(allowed){const savedBinding=await binding;assert.ok(p.getSegment().facts.some(f=>f.type==='freezeChanged'));assert.ok(p.getSegment().facts.some(f=>f.type==='timeAdvanced'));assert.equal(savedBinding.instanceId,plan.instance.instanceId);}
    else await assert.rejects(binding,{code:'invalid-binding'},label);await f.repo.close();
  }
});
test('full fresh startup accepts setup but rejects prior exposure/composition/input and a different current target cue',async()=>{
  const cases:[string,(e:TrainingEngine)=>void,boolean][]=[['setup',e=>e.setFrozen('modal',true),true],['input',e=>e.input('','typed',{version:'dom-edit-v1',kind:'input',inputType:'insertText',data:''}),false],['reveal',e=>e.exposeHint('reveal'),false],['hint',e=>e.exposeHint('hint'),false],['composition',e=>e.beginComposition(),false],['different cue',e=>e.nextCue(1),false]];
  for(const [label,setup,allowed] of cases){const f=await fixture(),e=engine(`full-setup-${label}`);setup(e);await f.repo.saveSession(e.getSnapshot());const plan=await f.repo.prepareReviewRetest({taskId:f.created.task.taskId,expectedRevision:1,nextDue});
    const binding=f.repo.bindReviewSession({taskId:plan.task.taskId,instanceId:plan.instance.instanceId,expectedRevision:plan.task.revision,session:{kind:'full',sessionId:e.getSnapshot().sessionId,generation:0}});
    if(allowed)assert.equal((await binding).instanceId,plan.instance.instanceId);else await assert.rejects(binding,{code:'invalid-binding'},label);await f.repo.close();}
});
