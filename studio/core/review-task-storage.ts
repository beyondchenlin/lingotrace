/** Narrow same-database adapter. Existing Training facts remain unchanged. */
import { readLegacyHistoryRecord } from './legacy-history.ts';
import { AUTOMATIC_HISTORY_CONTROL_KEY, AutomaticHistoryWriteFenceError, readAutomaticHistoryControl } from './automatic-history-control.ts';
import { validateReviewDueTime } from './review-due-time.ts';
import { captureReviewTask, captureReviewInstance, captureReviewBinding, captureReviewRelation, captureReviewSource, captureReviewSession,
  validateReviewTarget, validateFullReviewSource, validatePartialReviewSource, reviewActiveKey, reviewCapture, reviewSame, reviewExact, reviewId,
  freshReviewInstance, ReviewTaskError,
  type ReviewTask, type ReviewInstance, type ReviewSessionBinding, type ReviewResultRelation, type ReviewSessionLocator, type ReviewTarget, type ReviewSourceLocator,
  type ReviewTaskList, type CreateReviewTaskOptions, type ReviewTaskCreation, type ChangeReviewTaskOptions, type PrepareReviewRetestOptions,
  type BindReviewSessionOptions, type CommitReviewResultOptions, type ReviewRetestPlan, type ReviewResultCommit, type ReviewTaskExport, type ReviewEvidenceAvailability, type ReviewEvidenceResult } from './review-tasks.ts';
import type { TrainingHistorySegment } from './training-history-segment.ts';

export const REVIEW_TASK_PREFIX = 'review-task-v1:';
export const REVIEW_INSTANCE_PREFIX = 'review-instance-v1:';
export const REVIEW_BINDING_PREFIX = 'review-binding-v1:';
export const REVIEW_RESULT_PREFIX = 'review-result-v1:';
export const REVIEW_REQUEST_PREFIX = 'review-request-v1:';
export const REVIEW_ACTIVE_PREFIX = 'review-active-v1:';
const SEGMENT_PREFIX='training-history-segment:';
export interface ReviewWriteGuard { check(): void; readonly session: ReviewSessionLocator }
export interface ReviewStorageHost {
  /** All source and control checks run under this one sessions/events/meta transaction. */
  run<T>(mode: IDBTransactionMode, work: (transaction: IDBTransaction) => Promise<T>, guard?: ReviewWriteGuard): Promise<T | null>;
  guard(session: ReviewSessionLocator,binding?: ReviewSessionBinding): ReviewWriteGuard;
  authorize(binding: ReviewSessionBinding,guard: ReviewWriteGuard): ReviewSessionBinding;
  readSegment(value: unknown,segmentId: string): TrainingHistorySegment;
}
function request<T=unknown>(value: IDBRequest<T>): Promise<T> { return new Promise((resolve,reject)=>{value.onsuccess=()=>resolve(value.result);value.onerror=()=>reject(value.error??new Error('复习事务请求失败。'));}); }
const now=()=>new Date().toISOString(), id=()=>crypto.randomUUID();
function missing(): never { throw new ReviewTaskError('unavailable','复习记录或其来源已不可用。'); }
function conflict(task:ReviewTask):never { throw new ReviewTaskError('revision-conflict','复习计划已在另一处更改，请刷新后确认。',task); }
function inactive():never { throw new ReviewTaskError('inactive-instance','这个复习实例已取消或替代，不能推进新计划。'); }
function envelope(key: string,value: unknown) {return {key,value};}
function unwrap(raw: unknown,key: string): unknown {
  if(raw===undefined)return undefined;
  const row=reviewExact(raw,['key','value']);if(row.key!==key)throw new ReviewTaskError('invalid-record','复习记录主键不匹配。');return row.value;
}
async function row<T>(tx:IDBTransaction,key:string,capture:(value:unknown)=>T):Promise<T|null>{const raw=await request(tx.objectStore('meta').get(key));return raw===undefined?null:capture(unwrap(raw,key));}
function put(tx:IDBTransaction,key:string,value:unknown,add=false):Promise<unknown>{const store=tx.objectStore('meta');return request(add?store.add(envelope(key,value)):store.put(envelope(key,value)));}
function taskRow(tx:IDBTransaction,taskId:string){return row(tx,REVIEW_TASK_PREFIX+taskId,captureReviewTask);}
function instanceRow(tx:IDBTransaction,instanceId:string){return row(tx,REVIEW_INSTANCE_PREFIX+instanceId,captureReviewInstance);}
function bindingKey(sessionId:string){return REVIEW_BINDING_PREFIX+sessionId;}
function assertPair(task:ReviewTask,instance:ReviewInstance){if(task.currentInstanceId!==instance.instanceId||instance.taskId!==task.taskId||instance.taskRevision!==task.revision||!reviewSame(task.due,instance.due))throw new ReviewTaskError('invalid-record','复习当前实例与计划不一致。');}
function pointer(value:unknown):{taskId:string}{const d=reviewExact(value,['taskId']);reviewId(d.taskId);return reviewCapture(value) as {taskId:string};}
function requestRecord(value:unknown):{taskId:string;intent:string}{const d=reviewExact(value,['taskId','intent']);reviewId(d.taskId);if(typeof d.intent!=='string')throw new ReviewTaskError('invalid-record','保存请求无效。');return reviewCapture(value) as {taskId:string;intent:string};}
async function permission(tx:IDBTransaction,guard:ReviewWriteGuard):Promise<void>{
  guard.check();const control=readAutomaticHistoryControl(await request(tx.objectStore('meta').get(AUTOMATIC_HISTORY_CONTROL_KEY)));guard.check();
  if(guard.session.kind==='full'){if(control.state!=='legacy-default'||control.generation!==0)throw new AutomaticHistoryWriteFenceError('persisted-off');}
  else if(control.state!=='segment-on'||control.generation!==guard.session.generation)throw new AutomaticHistoryWriteFenceError('stale-generation');
}
async function sourceProof(host:ReviewStorageHost,tx:IDBTransaction,source:ReviewSourceLocator,target:ReviewTarget):Promise<ReviewEvidenceResult>{
  if(source.kind==='full'){
    const raw=await request(tx.objectStore('sessions').get(source.sessionId));if(raw===undefined)missing();
    const saved=readLegacyHistoryRecord(raw,source.sessionId).snapshot,result=validateFullReviewSource(saved,source,target);
    for(const eventId of [source.submitEventId,source.judgmentEventId]){
      const actual=await request(tx.objectStore('events').get([source.sessionId,eventId]));
      if(actual===undefined||!reviewSame(actual,saved.events.find(e=>e.eventId===eventId)))throw new ReviewTaskError('invalid-source','原始事件与已存会话不一致。');
    }
    return {words:result.words,errors:result.errors,accuracy:result.accuracy};
  }else{
    const raw=await request(tx.objectStore('meta').get(SEGMENT_PREFIX+source.segmentId));if(raw===undefined)missing();
    const result=validatePartialReviewSource(host.readSegment(raw,source.segmentId),source,target);
    return {words:result.words,errors:result.errors,accuracy:result.accuracy};
  }
}
async function checkedTask(host:ReviewStorageHost,taskId:string):Promise<ReviewTask>{const task=await loadReviewTask(host,taskId);return task??missing();}
function unchanged(task:ReviewTask,prior:ReviewTask){if(!reviewSame(task,prior))conflict(task);}
async function currentPair(tx:IDBTransaction,taskId:string):Promise<ReviewRetestPlan>{
  const task=await taskRow(tx,taskId);if(!task)missing();const instance=await instanceRow(tx,task.currentInstanceId);if(!instance)missing();assertPair(task,instance);return {task,instance};
}
export async function listReviewTasks(host:ReviewStorageHost):Promise<ReviewTaskList>{
  const raw=await host.run('readonly',tx=>request(tx.objectStore('meta').getAll()));const entries:ReviewTask[]=[];let unreadableCount=0;
  for(const item of raw??[]){if(!item||typeof item.key!=='string'||!item.key.startsWith(REVIEW_TASK_PREFIX))continue;
    try{const task=captureReviewTask(unwrap(item,item.key));if(item.key!==REVIEW_TASK_PREFIX+task.taskId)throw new Error('key');
      const head=(raw??[]).find(row=>row?.key===REVIEW_INSTANCE_PREFIX+task.currentInstanceId);if(!head)missing();
      assertPair(task,captureReviewInstance(unwrap(head,head.key)));await validateReviewTarget(task.target);entries.push(task);
    }catch{unreadableCount++;}}
  entries.sort((a,b)=>Date.parse(a.due.instant)-Date.parse(b.due.instant)||a.taskId.localeCompare(b.taskId));return reviewCapture({entries,unreadableCount});
}
export async function loadReviewTask(host:ReviewStorageHost,taskId:string):Promise<ReviewTask|null>{reviewId(taskId);const task=await host.run('readonly',tx=>taskRow(tx,taskId));if(task)await validateReviewTarget(task.target);return task;}
export async function loadReviewInstance(host:ReviewStorageHost,instanceId:string):Promise<ReviewInstance|null>{reviewId(instanceId);return host.run('readonly',tx=>instanceRow(tx,instanceId));}
export async function createReviewTask(host:ReviewStorageHost,options:CreateReviewTaskOptions):Promise<ReviewTaskCreation>{
  const captured=reviewCapture(options);reviewId(captured.requestId);const source=captureReviewSource(captured.source),target=await validateReviewTarget(captured.target);validateReviewDueTime(captured.due);
  const taskId=captured.taskId??id(),instanceId=captured.instanceId??id();reviewId(taskId);reviewId(instanceId);
  const activeKey=reviewActiveKey(source,target),intent=JSON.stringify({source,target,due:captured.due});
  const output=await host.run('readwrite',async tx=>{
    const retry=await row(tx,REVIEW_REQUEST_PREFIX+captured.requestId,requestRecord);
    if(retry){if(retry.intent!==intent)throw new ReviewTaskError('request-conflict','同一保存请求不能改为其他来源或日期。');return {disposition:'duplicate' as const,...await currentPair(tx,retry.taskId)};}
    await sourceProof(host,tx,source,target);
    const existing=await row(tx,REVIEW_ACTIVE_PREFIX+activeKey,pointer);
    if(existing){const pair=await currentPair(tx,existing.taskId);if(pair.task.status!=='active')throw new ReviewTaskError('invalid-record','活动任务索引不一致。');
      if(pair.task.activeKey!==activeKey)throw new ReviewTaskError('invalid-record','任务来源索引不一致。');
      await put(tx,REVIEW_REQUEST_PREFIX+captured.requestId,{taskId:pair.task.taskId,intent},true);return {disposition:'duplicate' as const,...pair};}
    const createdAt=now();
    const task=captureReviewTask({schemaVersion:'review-task-v1',taskId,requestId:captured.requestId,activeKey,source,target,due:captured.due,status:'active',revision:1,currentInstanceId:instanceId,createdAt,updatedAt:createdAt});
    const instance=freshReviewInstance(task,instanceId,createdAt);
    await put(tx,REVIEW_TASK_PREFIX+taskId,task,true);await put(tx,REVIEW_INSTANCE_PREFIX+instanceId,instance,true);
    await put(tx,REVIEW_ACTIVE_PREFIX+activeKey,{taskId},true);await put(tx,REVIEW_REQUEST_PREFIX+captured.requestId,{taskId,intent},true);
    return {disposition:'created' as const,task,instance};
  });return output??missing();
}
export async function changeReviewTask(host:ReviewStorageHost,options:ChangeReviewTaskOptions):Promise<ReviewRetestPlan>{
  const o=reviewCapture(options),prior=await checkedTask(host,o.taskId);if(o.due)validateReviewDueTime(o.due);
  if(!['cancel','restore','reschedule'].includes(o.action)||!Number.isSafeInteger(o.expectedRevision))throw new ReviewTaskError('invalid-record','无效的复习计划操作。');
  if((o.action==='reschedule'||o.action==='restore')&&!o.due)throw new ReviewTaskError('invalid-record','改期或恢复需要明确选择日期。');
  const nextId=id();return await host.run('readwrite',async tx=>{
    const {task,instance}=await currentPair(tx,o.taskId);unchanged(task,prior);if(task.revision!==o.expectedRevision)conflict(task);
    if(o.action==='cancel'&&task.status!=='active'||o.action==='restore'&&task.status!=='cancelled'||o.action==='reschedule'&&task.status!=='active')conflict(task);
    const at=now(),revision=task.revision+1;
    if(o.action==='cancel'){
      const nextTask=captureReviewTask({...task,status:'cancelled',revision,updatedAt:at}),nextInstance=captureReviewInstance({...instance,status:'cancelled',taskRevision:revision,updatedAt:at});
      await put(tx,REVIEW_TASK_PREFIX+task.taskId,nextTask);await put(tx,REVIEW_INSTANCE_PREFIX+instance.instanceId,nextInstance);
      const active=await row(tx,REVIEW_ACTIVE_PREFIX+task.activeKey,pointer);if(!active||active.taskId!==task.taskId)throw new ReviewTaskError('invalid-record','活动任务索引缺失。');
      await request(tx.objectStore('meta').delete(REVIEW_ACTIVE_PREFIX+task.activeKey));return {task:nextTask,instance:nextInstance};
    }
    const active=await row(tx,REVIEW_ACTIVE_PREFIX+task.activeKey,pointer);if(active&&active.taskId!==task.taskId)conflict((await taskRow(tx,active.taskId))??task);
    const nextTask=captureReviewTask({...task,status:'active',revision,due:o.due,currentInstanceId:nextId,updatedAt:at});
    const nextInstance=freshReviewInstance(nextTask,nextId,at),old=captureReviewInstance({...instance,status:o.action==='restore'?'cancelled':'rescheduled',successorInstanceId:nextId,updatedAt:at});
    await put(tx,REVIEW_INSTANCE_PREFIX+instance.instanceId,old);await put(tx,REVIEW_INSTANCE_PREFIX+nextId,nextInstance,true);await put(tx,REVIEW_TASK_PREFIX+task.taskId,nextTask);await put(tx,REVIEW_ACTIVE_PREFIX+task.activeKey,{taskId:task.taskId});
    return {task:nextTask,instance:nextInstance};
  })??missing();
}
export async function prepareReviewRetest(host:ReviewStorageHost,options:PrepareReviewRetestOptions):Promise<ReviewRetestPlan>{
  const o=reviewCapture(options);validateReviewDueTime(o.nextDue);const prior=await checkedTask(host,o.taskId);
  return await host.run('readwrite',async tx=>{const {task,instance}=await currentPair(tx,o.taskId);if(!reviewSame(task.target,prior.target))conflict(task);
    if(task.status!=='active'||instance.status!=='pending')inactive();
    await sourceProof(host,tx,task.source,task.target);
    if(instance.nextDue!==null){if(reviewSame(instance.nextDue,o.nextDue)&&(o.expectedRevision===task.revision||o.expectedRevision===task.revision-1))return {task,instance};conflict(task);}
    if(task.revision!==o.expectedRevision)conflict(task);
    const at=now(),nextTask=captureReviewTask({...task,revision:task.revision+1,updatedAt:at}),nextInstance=captureReviewInstance({...instance,taskRevision:nextTask.revision,nextDue:o.nextDue,updatedAt:at});
    await put(tx,REVIEW_TASK_PREFIX+task.taskId,nextTask);await put(tx,REVIEW_INSTANCE_PREFIX+instance.instanceId,nextInstance);return {task:nextTask,instance:nextInstance};
  })??missing();
}
/** Fresh startup may contain passive host freeze/clock observations, but no
 * input, exposure, composition, submission or result. Partial navigation is not
 * setup: the host selects the fixed cue before admitting the new segment. */
async function bindingHead(host:ReviewStorageHost,tx:IDBTransaction,session:ReviewSessionLocator,target:ReviewTarget,fresh:boolean):Promise<void>{
  if(session.kind==='full'){
    const raw=await request(tx.objectStore('sessions').get(session.sessionId));if(raw===undefined)missing();const s=readLegacyHistoryRecord(raw,session.sessionId).snapshot;
    if(!reviewSame(s.material,target.material)|| (fresh&&(s.attempts.length||Object.keys(s.pendingAttempts).length||s.material.cues[s.cueIndex]?.id!==target.cueId
      ||s.events.some(e=>!['sessionStarted','freezeChanged','timeAdvanced','inputObservationSampled','cueChanged'].includes(e.type)))))throw new ReviewTaskError('invalid-binding','只能绑定已保存、尚未作答的固定版本新轮。');
    const started=s.events[0],event=await request(tx.objectStore('events').get([s.sessionId,started.eventId]));if(event===undefined||!reviewSame(event,started))throw new ReviewTaskError('invalid-binding','新会话起始事实不可用。');
  }else{
    const raw=await request(tx.objectStore('meta').get(SEGMENT_PREFIX+session.segmentId));if(raw===undefined)missing();const s=host.readSegment(raw,session.segmentId);
    if(s.sessionId!==session.sessionId||s.generation!==session.generation||s.material.id!==target.material.id||s.material.version!==target.material.version||s.endedAt!==null
      ||(fresh&&s.facts.some(f=>!['freezeChanged','timeAdvanced','inputObservationSampled'].includes(f.type)||f.cueId!==target.cueId)))throw new ReviewTaskError('invalid-binding','只能绑定有效许可下新准入且尚未作答的片段。');
  }
}
function validateBindingPair(binding:ReviewSessionBinding,task:ReviewTask,instance:ReviewInstance){
  if(binding.taskId!==task.taskId||binding.instanceId!==instance.instanceId||instance.taskId!==task.taskId||binding.materialDigest!==task.target.materialDigest||binding.cueId!==task.target.cueId||binding.taskRevision!==instance.taskRevision)throw new ReviewTaskError('invalid-binding','复测关联与固定实例不一致。');
  if(instance.status!=='pending'&&instance.status!=='won')inactive();
  if(instance.status==='pending'&&(task.status!=='active'||task.currentInstanceId!==instance.instanceId||task.revision!==binding.taskRevision))inactive();
}
export async function bindReviewSession(host:ReviewStorageHost,options:BindReviewSessionOptions):Promise<ReviewSessionBinding>{
  const o=reviewCapture(options),session=captureReviewSession(o.session),guard=host.guard(session),prior=await checkedTask(host,o.taskId);
  const output=await host.run('readwrite',async tx=>{
    await permission(tx,guard);const {task,instance}=await currentPair(tx,o.taskId);unchanged(task,prior);
    if(task.revision!==o.expectedRevision)conflict(task);if(task.status!=='active'||instance.status!=='pending'||instance.instanceId!==o.instanceId||!instance.nextDue)inactive();
    await sourceProof(host,tx,task.source,task.target);
    if(session.sessionId===task.source.sessionId)throw new ReviewTaskError('invalid-binding','复测必须另开真实新轮，不能绑定来源会话。');
    const key=bindingKey(session.sessionId),priorBinding=await row(tx,key,captureReviewBinding);
    if(priorBinding){validateBindingPair(priorBinding,task,instance);if(!reviewSame(priorBinding.session,session))throw new ReviewTaskError('invalid-binding','会话已经关联另一个片段。');await bindingHead(host,tx,session,task.target,false);guard.check();return priorBinding;}
    await bindingHead(host,tx,session,task.target,true);guard.check();
    const binding=captureReviewBinding({schemaVersion:'review-binding-v1',bindingId:id(),taskId:task.taskId,instanceId:instance.instanceId,taskRevision:task.revision,session,materialDigest:task.target.materialDigest,cueId:task.target.cueId,createdAt:now()});
    await put(tx,key,binding,true);guard.check();return binding;
  },guard);return host.authorize(output??missing(),guard);
}
export async function commitReviewResult(host:ReviewStorageHost,options:CommitReviewResultOptions):Promise<ReviewResultCommit>{
  const binding=options.binding,source=captureReviewSource(options.source),guard=host.guard(binding.session,binding),prior=await checkedTask(host,binding.taskId);
  if(source.sessionId!==binding.session.sessionId||source.kind!==binding.session.kind||(source.kind==='partial'&&(binding.session.kind!=='partial'||source.segmentId!==binding.session.segmentId||source.generation!==binding.session.generation)))throw new ReviewTaskError('invalid-binding','判定不属于这个复测会话。');
  const successorId=id();return await host.run('readwrite',async tx=>{
    await permission(tx,guard);const saved=await row(tx,bindingKey(source.sessionId),captureReviewBinding);if(!saved||!reviewSame(saved,binding))throw new ReviewTaskError('invalid-binding','持久复测关系不可用。');
    const task=await taskRow(tx,binding.taskId);if(!task)missing();if(!reviewSame(task.target,prior.target)||!reviewSame(task.source,prior.source))conflict(task);const instance=await instanceRow(tx,binding.instanceId);if(!instance)missing();validateBindingPair(binding,task,instance);
    await sourceProof(host,tx,task.source,task.target);await sourceProof(host,tx,source,task.target);guard.check();
    // One attempt can be associated once. Both locators' event IDs remain verifiable.
    const key=REVIEW_RESULT_PREFIX+JSON.stringify([source.sessionId,source.attemptId]),existing=await row(tx,key,captureReviewRelation);
    if(existing){if(existing.bindingId!==binding.bindingId||!reviewSame(existing.source,source))throw new ReviewTaskError('invalid-binding','真实尝试已经关联另一复测。');return {disposition:'duplicate' as const,task,instance,relation:existing};}
    const at=now(),wins=instance.status==='pending';
    const relation=captureReviewRelation({schemaVersion:'review-result-v1',relationId:id(),bindingId:binding.bindingId,taskId:task.taskId,instanceId:instance.instanceId,source,disposition:wins?'winner':'later',committedAt:at});
    await put(tx,key,relation,true);
    if(!wins){guard.check();return {disposition:'later' as const,task,instance,relation};}
    if(!instance.nextDue)throw new ReviewTaskError('invalid-record','尚未明确选择下一次日期。');
    const nextTask=captureReviewTask({...task,due:instance.nextDue,revision:task.revision+1,currentInstanceId:successorId,updatedAt:at});
    const winner=captureReviewInstance({...instance,status:'won',winner:relation,successorInstanceId:successorId,updatedAt:at}),successor=freshReviewInstance(nextTask,successorId,at);
    await put(tx,REVIEW_INSTANCE_PREFIX+instance.instanceId,winner);await put(tx,REVIEW_INSTANCE_PREFIX+successorId,successor,true);await put(tx,REVIEW_TASK_PREFIX+task.taskId,nextTask);guard.check();
    return {disposition:'winner' as const,task:nextTask,instance:winner,relation};
  },guard)??missing();
}
export async function restoreReviewSessionBinding(host:ReviewStorageHost,sessionId:string):Promise<ReviewSessionBinding|null>{
  reviewId(sessionId);const session={kind:'full',sessionId,generation:0} as const;const guard=host.guard(session);
  const candidate=await host.run('readonly',async tx=>row(tx,bindingKey(sessionId),captureReviewBinding));if(!candidate||candidate.session.kind!=='full')return null;
  const prior=await checkedTask(host,candidate.taskId);
  const result=await host.run('readonly',async tx=>{await permission(tx,guard);const binding=await row(tx,bindingKey(sessionId),captureReviewBinding);if(!binding||!reviewSame(binding,candidate))return null;
    const task=await taskRow(tx,binding.taskId),instance=await instanceRow(tx,binding.instanceId);if(!task||!instance)return null;unchanged(task,prior);
    if(instance.status!=='pending'&&instance.status!=='won')return null;validateBindingPair(binding,task,instance);await sourceProof(host,tx,task.source,task.target);await bindingHead(host,tx,session,task.target,false);guard.check();return binding;
  },guard);return result?host.authorize(result,guard):null;
}
type ExportRow = { key: string; value: Record<string, unknown>; owner: string };
function exportField(value: unknown,key: string): unknown {
  return value && typeof value==='object' && !Array.isArray(value) ? Object.getOwnPropertyDescriptor(value,key)?.value : undefined;
}
/** Ownership is the only required field before routing. A different task's
 * unsupported schema is isolated; unknown ownership or a link to the requested
 * task must still fail closed. Never repair or discard persisted rows. */
function exportRow(item: unknown,taskId:string): ExportRow {
  const outer=reviewExact(item,['key','value']),key=outer.key;
  if(typeof key!=='string')throw new ReviewTaskError('invalid-record','复习记录主键无效。');
  const value=unwrap(item,key);
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new ReviewTaskError('invalid-record','复习记录归属无法核验。');
  const owner=exportField(value,'taskId');reviewId(owner);
  if(owner!==taskId)return {key,value:value as Record<string,unknown>,owner};
  // Owned records require exact storage identity as well as full capture below.
  // Binding and result keys use session/attempt identities, not UUIDs.
  let expected: string|undefined;
  if(key.startsWith(REVIEW_INSTANCE_PREFIX)){
    const instanceId=exportField(value,'instanceId');if(instanceId!==undefined){reviewId(instanceId);expected=REVIEW_INSTANCE_PREFIX+instanceId;}
  }else if(key.startsWith(REVIEW_BINDING_PREFIX)){
    const sessionId=exportField(exportField(value,'session'),'sessionId');if(sessionId!==undefined){reviewId(sessionId);expected=bindingKey(sessionId);}
  }else{
    const source=exportField(value,'source'),sessionId=exportField(source,'sessionId'),attemptId=exportField(source,'attemptId');
    if(sessionId!==undefined)reviewId(sessionId);if(attemptId!==undefined)reviewId(attemptId);
    if(sessionId!==undefined&&attemptId!==undefined)expected=REVIEW_RESULT_PREFIX+JSON.stringify([sessionId,attemptId]);
  }
  if(expected!==undefined&&key!==expected)throw new ReviewTaskError('invalid-record','复习记录主键与标识不一致。');
  return {key,value:value as Record<string,unknown>,owner};
}
function assertForeignExportRows(foreign:ExportRow[],task:ReviewTask,instances:ReviewInstance[],bindings:ReviewSessionBinding[],relations:ReviewResultRelation[]):void {
  const instanceIds=new Set([task.currentInstanceId]),bindingIds=new Set<string>(),relationIds=new Set<string>(),sessionIds=new Set<string>(),keys=new Set<string>();
  const addRelation=(relation:ReviewResultRelation)=>{
    instanceIds.add(relation.instanceId);bindingIds.add(relation.bindingId);relationIds.add(relation.relationId);sessionIds.add(relation.source.sessionId);
    keys.add(REVIEW_RESULT_PREFIX+JSON.stringify([relation.source.sessionId,relation.source.attemptId]));
  };
  for(const instance of instances){instanceIds.add(instance.instanceId);if(instance.successorInstanceId)instanceIds.add(instance.successorInstanceId);if(instance.winner)addRelation(instance.winner);}
  for(const binding of bindings){instanceIds.add(binding.instanceId);bindingIds.add(binding.bindingId);sessionIds.add(binding.session.sessionId);}
  relations.forEach(addRelation);instanceIds.forEach(id=>keys.add(REVIEW_INSTANCE_PREFIX+id));sessionIds.forEach(id=>keys.add(bindingKey(id)));
  const pointsToTarget=(value:unknown):boolean=>{
    const has=(ids:Set<string>,field:unknown)=>typeof field==='string'&&ids.has(field);
    return exportField(value,'taskId')===task.taskId||has(instanceIds,exportField(value,'instanceId'))||has(instanceIds,exportField(value,'successorInstanceId'))
      ||has(bindingIds,exportField(value,'bindingId'))||has(relationIds,exportField(value,'relationId'))
      ||has(sessionIds,exportField(exportField(value,'session'),'sessionId'))||has(sessionIds,exportField(exportField(value,'source'),'sessionId'));
  };
  const keyNamesTargetSession=(key:string):boolean=>{
    if(!key.startsWith(REVIEW_RESULT_PREFIX))return false;
    try{const identity:unknown=JSON.parse(key.slice(REVIEW_RESULT_PREFIX.length));
      // A damaged attempt/tuple cannot erase a recognizable target session.
      return Array.isArray(identity)&&typeof identity[0]==='string'&&sessionIds.has(identity[0]);
    }catch{return false;}
  };
  for(const row of foreign)if(keys.has(row.key)||keyNamesTargetSession(row.key)||pointsToTarget(row.value)||pointsToTarget(exportField(row.value,'winner')))
    throw new ReviewTaskError('invalid-record','复习记录归属与关联标识不一致。');
}
export async function exportReviewTask(host:ReviewStorageHost,taskId:string):Promise<ReviewTaskExport>{
  const prior=await checkedTask(host,taskId);
  return await host.run('readonly',async tx=>{
    const {task,instance}=await currentPair(tx,taskId);unchanged(task,prior);const raw=await request(tx.objectStore('meta').getAll());
    if(task.taskId!==taskId)throw new ReviewTaskError('invalid-record','复习计划主键与标识不一致。');
    const instances:ReviewInstance[]=[],bindings:ReviewSessionBinding[]=[],relations:ReviewResultRelation[]=[],foreign:ExportRow[]=[];
    for(const item of raw){if(!item||typeof item.key!=='string'||![REVIEW_INSTANCE_PREFIX,REVIEW_BINDING_PREFIX,REVIEW_RESULT_PREFIX].some(prefix=>item.key.startsWith(prefix)))continue;
      const entry=exportRow(item,taskId);if(entry.owner!==taskId){foreign.push(entry);continue;}
      if(entry.key.startsWith(REVIEW_INSTANCE_PREFIX))instances.push(captureReviewInstance(entry.value));
      if(entry.key.startsWith(REVIEW_BINDING_PREFIX))bindings.push(captureReviewBinding(entry.value));
      if(entry.key.startsWith(REVIEW_RESULT_PREFIX))relations.push(captureReviewRelation(entry.value));
    }
    assertForeignExportRows(foreign,task,instances,bindings,relations);
    const evidence:ReviewEvidenceAvailability[]=[];
    for(const source of [task.source,...relations.map(r=>r.source)]){let error:string|null=null,result:ReviewEvidenceResult|null=null;try{result=await sourceProof(host,tx,source,task.target);}catch(e){error=e instanceof Error?e.message:String(e);}
      evidence.push({source,availability:error?'unavailable':'available',coverage:source.kind,assistance:source.kind==='partial'?'unknown':'recorded',result,error});}
    return reviewCapture({schemaVersion:'review-task-export-v1' as const,task,instance,instances,bindings,relations,evidence});
  })??missing();
}
