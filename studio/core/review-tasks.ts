/** Manual plans and evidence locators only. No scoring, replay, answer copies or engine commands. */
import { CAFE_MATERIAL, type Material, type TrainingSnapshot, type Attempt } from './training.ts';
import { canonicalLocalReferenceJSON, captureLocalReference, canonicalMaterialDigest, validateOptionalLocalReference,
  LOCAL_REFERENCE_MEDIA_ID, LOCAL_REFERENCE_MEDIA_SHA256, type LocalReferenceMedia } from './local-reference.ts';
import { BUILTIN_TRAINING_SCHEMA, builtinCourseForMaterial } from './builtin-material.ts';
import { validateReviewDueTime, type ReviewDueTime } from './review-due-time.ts';
import type { TrainingHistorySegment, TrainingHistoryResult } from './training-history-segment.ts';
export type { ReviewDueTime } from './review-due-time.ts';

export type ReviewSourceLocator = Readonly<{ kind: 'full'; sessionId: string; attemptId: string; submitEventId: string; judgmentEventId: string }>
  | Readonly<{ kind: 'partial'; sessionId: string; segmentId: string; generation: number; attemptId: string; submitEventId: string; judgmentEventId: string }>;
export type ReviewSessionLocator = Readonly<{ kind: 'full'; sessionId: string; generation: 0 }>
  | Readonly<{ kind: 'partial'; sessionId: string; segmentId: string; generation: number }>;
export interface ReviewTarget { readonly material: Material; readonly cueId: string; readonly materialDigest: string; readonly media: LocalReferenceMedia }
export interface ReviewTask {
  readonly schemaVersion: 'review-task-v1'; readonly taskId: string; readonly requestId: string; readonly activeKey: string;
  readonly source: ReviewSourceLocator; readonly target: ReviewTarget; readonly due: ReviewDueTime;
  readonly status: 'active' | 'cancelled'; readonly revision: number; readonly currentInstanceId: string;
  readonly createdAt: string; readonly updatedAt: string;
}
export interface ReviewInstance {
  readonly schemaVersion: 'review-instance-v1'; readonly instanceId: string; readonly taskId: string; readonly taskRevision: number;
  readonly status: 'pending' | 'won' | 'cancelled' | 'rescheduled'; readonly due: ReviewDueTime; readonly nextDue: ReviewDueTime | null;
  readonly winner: ReviewResultRelation | null; readonly successorInstanceId: string | null;
  readonly createdAt: string; readonly updatedAt: string;
}
/** Returned objects are live capabilities in their repository; deserializing one does not authorize writes. */
export interface ReviewSessionBinding {
  readonly schemaVersion: 'review-binding-v1'; readonly bindingId: string; readonly taskId: string; readonly instanceId: string;
  readonly taskRevision: number; readonly session: ReviewSessionLocator; readonly materialDigest: string; readonly cueId: string; readonly createdAt: string;
}
export interface ReviewResultRelation {
  readonly schemaVersion: 'review-result-v1'; readonly relationId: string; readonly bindingId: string; readonly taskId: string;
  readonly instanceId: string; readonly source: ReviewSourceLocator; readonly disposition: 'winner' | 'later'; readonly committedAt: string;
}
export interface ReviewTaskList { readonly entries: readonly ReviewTask[]; readonly unreadableCount: number }
export interface CreateReviewTaskOptions { readonly requestId: string; readonly source: ReviewSourceLocator; readonly target: ReviewTarget; readonly due: ReviewDueTime; readonly taskId?: string; readonly instanceId?: string }
export interface ReviewTaskCreation { readonly disposition: 'created' | 'duplicate'; readonly task: ReviewTask; readonly instance: ReviewInstance }
export interface ReviewRetestPlan { readonly task: ReviewTask; readonly instance: ReviewInstance }
export interface ChangeReviewTaskOptions { readonly taskId: string; readonly expectedRevision: number; readonly action: 'cancel' | 'restore' | 'reschedule'; readonly due?: ReviewDueTime }
export interface PrepareReviewRetestOptions { readonly taskId: string; readonly expectedRevision: number; readonly nextDue: ReviewDueTime }
export interface BindReviewSessionOptions { readonly taskId: string; readonly instanceId: string; readonly expectedRevision: number; readonly session: ReviewSessionLocator }
export interface CommitReviewResultOptions { readonly binding: ReviewSessionBinding; readonly source: ReviewSourceLocator }
export interface ReviewResultCommit extends ReviewRetestPlan { readonly disposition: 'winner' | 'later' | 'duplicate'; readonly relation: ReviewResultRelation }
export interface ReviewEvidenceResult { readonly words: number; readonly errors: number; readonly accuracy: number }
export interface ReviewEvidenceAvailability { readonly source: ReviewSourceLocator; readonly availability: 'available' | 'unavailable'; readonly coverage: 'full' | 'partial'; readonly assistance: 'recorded' | 'unknown'; readonly result: ReviewEvidenceResult | null; readonly error: string | null }
export interface ReviewTaskExport extends ReviewRetestPlan { readonly schemaVersion: 'review-task-export-v1'; readonly instances: readonly ReviewInstance[]; readonly bindings: readonly ReviewSessionBinding[]; readonly relations: readonly ReviewResultRelation[]; readonly evidence: readonly ReviewEvidenceAvailability[] }
export class ReviewTaskError extends Error {
  constructor(readonly code: 'invalid-record' | 'invalid-source' | 'unavailable' | 'revision-conflict' | 'request-conflict' | 'inactive-instance' | 'invalid-binding' | 'storage-failed', message: string, readonly current: ReviewTask | null = null) { super(message); this.name = 'ReviewTaskError'; }
}
export function reviewFail(message = '复习记录结构无法核验。'): never { throw new ReviewTaskError('invalid-record', message); }
export function reviewId(value: unknown): asserts value is string { if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 1024 || /[\u0000-\u001f]/.test(value)) reviewFail('复习标识无效。'); }
export function reviewExact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) reviewFail();
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key) || !Object.getOwnPropertyDescriptor(value,key)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)!, 'value'))) reviewFail();
  return value as Record<string, unknown>;
}
export const reviewCapture = captureLocalReference;
export const reviewSame = (a: unknown,b: unknown): boolean => canonicalLocalReferenceJSON(a) === canonicalLocalReferenceJSON(b);
function positive(value: unknown): void { if (!Number.isSafeInteger(value) || (value as number) < 1) reviewFail(); }
function timestamp(value: unknown): void { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) reviewFail(); }
export function captureReviewSource(value: unknown): ReviewSourceLocator {
  const kind = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'kind')?.value : null;
  const data = reviewExact(value, kind === 'full' ? ['kind','sessionId','attemptId','submitEventId','judgmentEventId'] : ['kind','sessionId','segmentId','generation','attemptId','submitEventId','judgmentEventId']);
  if (kind !== 'full' && kind !== 'partial') reviewFail();
  for (const key of ['sessionId','attemptId','submitEventId','judgmentEventId']) reviewId(data[key]);
  if (data.submitEventId === data.judgmentEventId) reviewFail();
  if (kind === 'partial') { reviewId(data.segmentId); positive(data.generation); }
  return reviewCapture(value) as ReviewSourceLocator;
}
export function captureReviewSession(value: unknown): ReviewSessionLocator {
  const kind = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'kind')?.value : null;
  const data = reviewExact(value, kind === 'full' ? ['kind','sessionId','generation'] : ['kind','sessionId','segmentId','generation']); reviewId(data.sessionId);
  if (kind === 'partial') { reviewId(data.segmentId); positive(data.generation); }
  else if (kind !== 'full' || data.generation !== 0) reviewFail();
  return reviewCapture(value) as ReviewSessionLocator;
}
export function captureReviewTarget(value: unknown): ReviewTarget {
  const data = reviewExact(value,['material','cueId','materialDigest','media']); reviewId(data.cueId);
  if (typeof data.materialDigest !== 'string' || !/^[a-f0-9]{64}$/.test(data.materialDigest)) reviewFail();
  const captured = reviewCapture(value) as ReviewTarget, material = captured.material;
  let builtin: ReturnType<typeof builtinCourseForMaterial>;
  try { builtin = builtinCourseForMaterial(material); } catch { reviewFail('内置参考与登记来源不一致。'); }
  if (!builtin) {
    if (!material || material.id !== CAFE_MATERIAL.id || !Array.isArray(material.cues)) reviewFail('仅支持固定咖啡馆或已登记 NPS 参考。');
    if (material.version === CAFE_MATERIAL.version) { if (!reviewSame(material,CAFE_MATERIAL)) reviewFail('原版完整内容不一致。'); }
    else { validateOptionalLocalReference(material); if (!material.localReference) reviewFail('校正版缺少固定来源。'); }
  }
  const media = reviewExact(captured.media,['id','sha256','durationSeconds']);
  if (media.id !== (builtin?.mediaId ?? LOCAL_REFERENCE_MEDIA_ID) || media.sha256 !== (builtin?.mediaSha256 ?? LOCAL_REFERENCE_MEDIA_SHA256) || typeof media.durationSeconds !== 'number' || !Number.isFinite(media.durationSeconds) || media.durationSeconds <= 0) reviewFail('需要核验原片哈希与实际时长。');
  // A browser may expose sub-millisecond metadata precision differences; no estimated fallback.
  if (builtin && Math.abs(media.durationSeconds - builtin.durationSeconds) > 0.001) reviewFail('NPS 实际时长与登记原片不一致。');
  if (material.localReference && !reviewSame(material.localReference.media,media)) reviewFail('固定参考的媒体绑定不一致。');
  const cue = material.cues.find(cue => cue.id === captured.cueId);
  if (!cue || !cue.text.trim() || !/[a-z0-9]/i.test(cue.text.normalize('NFKC')) || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start || cue.end > media.durationSeconds) reviewFail('复习目标句或时间范围无效。');
  return captured;
}
export async function validateReviewTarget(value: unknown): Promise<ReviewTarget> {
  const target = captureReviewTarget(value);
  if (target.materialDigest !== await canonicalMaterialDigest(target.material)) reviewFail('完整素材摘要不一致。');
  return target;
}
export async function buildReviewTarget(material: Material,cueId: string,media: LocalReferenceMedia): Promise<ReviewTarget> {
  const captured = reviewCapture({material,cueId,media});
  return validateReviewTarget({...captured,materialDigest:await canonicalMaterialDigest(captured.material)});
}
export function reviewActiveKey(source: ReviewSourceLocator,target: ReviewTarget): string {
  return canonicalLocalReferenceJSON({source: captureReviewSource(source),materialDigest:target.materialDigest,cueId:target.cueId,media:target.media});
}
export function captureReviewTask(value: unknown): ReviewTask {
  const d = reviewExact(value,['schemaVersion','taskId','requestId','activeKey','source','target','due','status','revision','currentInstanceId','createdAt','updatedAt']);
  if (d.schemaVersion !== 'review-task-v1' || !['active','cancelled'].includes(d.status as string)) reviewFail();
  for (const k of ['taskId','requestId','currentInstanceId']) reviewId(d[k]); positive(d.revision); timestamp(d.createdAt); timestamp(d.updatedAt);
  const source=captureReviewSource(d.source),target=captureReviewTarget(d.target); validateReviewDueTime(d.due as ReviewDueTime);
  if (d.activeKey !== reviewActiveKey(source,target)) reviewFail(); return reviewCapture(value) as ReviewTask;
}
export function captureReviewRelation(value: unknown): ReviewResultRelation {
  const d=reviewExact(value,['schemaVersion','relationId','bindingId','taskId','instanceId','source','disposition','committedAt']);
  if (d.schemaVersion!=='review-result-v1'||!['winner','later'].includes(d.disposition as string)) reviewFail();
  for(const k of ['relationId','bindingId','taskId','instanceId']) reviewId(d[k]); captureReviewSource(d.source); timestamp(d.committedAt);
  return reviewCapture(value) as ReviewResultRelation;
}
export function captureReviewInstance(value: unknown): ReviewInstance {
  const d=reviewExact(value,['schemaVersion','instanceId','taskId','taskRevision','status','due','nextDue','winner','successorInstanceId','createdAt','updatedAt']);
  if(d.schemaVersion!=='review-instance-v1'||!['pending','won','cancelled','rescheduled'].includes(d.status as string))reviewFail();
  reviewId(d.instanceId);reviewId(d.taskId);positive(d.taskRevision);timestamp(d.createdAt);timestamp(d.updatedAt);validateReviewDueTime(d.due as ReviewDueTime);
  if(d.nextDue!==null)validateReviewDueTime(d.nextDue as ReviewDueTime);
  if(d.successorInstanceId!==null)reviewId(d.successorInstanceId);
  if(d.winner!==null){const w=captureReviewRelation(d.winner);if(w.instanceId!==d.instanceId||w.taskId!==d.taskId||w.disposition!=='winner')reviewFail();}
  if((d.status==='won')!==(d.winner!==null)|| (d.status==='won' && (d.nextDue===null||d.successorInstanceId===null)) || (d.status==='pending'&&d.successorInstanceId!==null)) reviewFail();
  return reviewCapture(value) as ReviewInstance;
}
export function captureReviewBinding(value: unknown): ReviewSessionBinding {
  const d=reviewExact(value,['schemaVersion','bindingId','taskId','instanceId','taskRevision','session','materialDigest','cueId','createdAt']);
  if(d.schemaVersion!=='review-binding-v1')reviewFail();for(const k of ['bindingId','taskId','instanceId','cueId'])reviewId(d[k]);positive(d.taskRevision);timestamp(d.createdAt);captureReviewSession(d.session);
  if(typeof d.materialDigest!=='string'||!/^[a-f0-9]{64}$/.test(d.materialDigest))reviewFail();return reviewCapture(value) as ReviewSessionBinding;
}
export function freshReviewInstance(task: Pick<ReviewTask,'taskId'|'revision'|'due'>,instanceId: string,now: string): ReviewInstance {
  return captureReviewInstance({schemaVersion:'review-instance-v1',instanceId,taskId:task.taskId,taskRevision:task.revision,status:'pending',due:task.due,nextDue:null,winner:null,successorInstanceId:null,createdAt:now,updatedAt:now});
}
const sourceError = (): never => { throw new ReviewTaskError('invalid-source','缺少同一次真实、已保存且可评分的提交与判定；未更新复习。'); };
/** Read actual historical values. This deliberately never calls align/score/replay. */
export function validateFullReviewSource(snapshot: TrainingSnapshot,source: ReviewSourceLocator,target: ReviewTarget): Attempt {
  if(source.kind!=='full'||source.sessionId!==snapshot.sessionId||!reviewSame(snapshot.material,target.material))return sourceError();
  if(builtinCourseForMaterial(target.material) && (snapshot.schemaVersion!==BUILTIN_TRAINING_SCHEMA || snapshot.events.some(event=>event.schemaVersion!==BUILTIN_TRAINING_SCHEMA)))return sourceError();
  const request=snapshot.events.find(e=>e.eventId===source.submitEventId),judgment=snapshot.events.find(e=>e.eventId===source.judgmentEventId),attempt=snapshot.attempts.find(a=>a.attemptId===source.attemptId);
  if(!request||!judgment||!attempt||request.type!=='submitRequested'||judgment.type!=='judgmentApplied'||request.sequence>=judgment.sequence
    ||request.attemptId!==source.attemptId||judgment.attemptId!==source.attemptId||request.cueId!==target.cueId||judgment.cueId!==target.cueId
    ||attempt.cueId!==target.cueId||attempt.sessionId!==source.sessionId||attempt.materialId!==target.material.id||attempt.materialVersion!==target.material.version
    ||request.sessionId!==source.sessionId||judgment.sessionId!==source.sessionId||request.materialId!==target.material.id||judgment.materialId!==target.material.id
    ||request.materialVersion!==target.material.version||judgment.materialVersion!==target.material.version||attempt.reference!==target.material.cues.find(c=>c.id===target.cueId)!.text
    ||snapshot.events.filter(e=>e.type==='submitRequested'&&e.attemptId===source.attemptId).length!==1
    ||snapshot.events.filter(e=>e.type==='judgmentApplied'&&e.attemptId===source.attemptId).length!==1
    ||request.inputVersion!==attempt.inputVersion||judgment.ruleVersion!==attempt.ruleVersion
    ||judgment.wallTime!==attempt.wallTime||request.answer!==attempt.answer||!attempt.answer.trim()||attempt.words<=0||request.draftVersion!==attempt.inputVersion||judgment.inputVersion!==attempt.inputVersion) return sourceError();
  return attempt;
}
export function validatePartialReviewSource(segment: TrainingHistorySegment,source: ReviewSourceLocator,target: ReviewTarget): TrainingHistoryResult {
  if(source.kind!=='partial'||source.sessionId!==segment.sessionId||source.segmentId!==segment.segmentId||source.generation!==segment.generation
    ||segment.material.id!==target.material.id||segment.material.version!==target.material.version)return sourceError();
  if(builtinCourseForMaterial(target.material) && segment.rules.trainingSchemaVersion!==BUILTIN_TRAINING_SCHEMA)return sourceError();
  const request=segment.facts.find(f=>f.sourceEventId===source.submitEventId),judgment=segment.facts.find(f=>f.sourceEventId===source.judgmentEventId);
  if(!request||!judgment||request.type!=='submitRequested'||judgment.type!=='judgmentApplied'||request.retention!=='recorded'||judgment.retention!=='recorded'
    ||request.ordinal>=judgment.ordinal||request.attemptId!==source.attemptId||judgment.attemptId!==source.attemptId||request.cueId!==target.cueId||judgment.cueId!==target.cueId
    ||request.answer!==judgment.result.answer||!request.answer.trim()||judgment.result.words<=0)return sourceError();return judgment.result;
}
