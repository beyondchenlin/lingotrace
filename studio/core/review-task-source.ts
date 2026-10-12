import type {Attempt,TrainingSnapshot} from './training';
import {ReviewTaskError,type ReviewSourceLocator} from './review-tasks';
import type {TrainingHistoryRecorder} from './training-history-recorder';
export type CommittedReviewSession=NonNullable<ReturnType<TrainingHistoryRecorder['getCommittedReviewSession']>>;
/** Locate a real engine result only; the repository must still prove its saved
 * request/result and current permission. No answer or score is copied here. */
export function reviewAttemptSource(snapshot:TrainingSnapshot,attempt:Attempt,session:CommittedReviewSession):ReviewSourceLocator{
 const bad=()=>new ReviewTaskError('invalid-source','本次提交与已保存的练习来源不能对应，复习任务或排期尚未提交。');
 if(session.sessionId!==snapshot.sessionId||attempt.sessionId!==snapshot.sessionId||attempt.roundId!==snapshot.roundId
  ||attempt.materialId!==snapshot.material.id||attempt.materialVersion!==snapshot.material.version||attempt.words<=0
  ||!snapshot.attempts.includes(attempt))throw bad();
 const cue=snapshot.material.cues.find(value=>value.id===attempt.cueId);
 if(!cue||cue.text!==attempt.reference)throw bad();
 const requests=snapshot.events.filter(event=>event.type==='submitRequested'&&event.attemptId===attempt.attemptId);
 const judgments=snapshot.events.filter(event=>event.type==='judgmentApplied'&&event.attemptId===attempt.attemptId);
 if(requests.length!==1||judgments.length!==1)throw bad();
 const request=requests[0],judgment=judgments[0];
 if(request.type!=='submitRequested'||request.sequence>=judgment.sequence||request.answer!==attempt.answer
  ||request.cueId!==attempt.cueId||judgment.cueId!==attempt.cueId||request.sessionId!==snapshot.sessionId
  ||judgment.sessionId!==snapshot.sessionId||request.materialId!==attempt.materialId||request.materialVersion!==attempt.materialVersion
  ||judgment.materialId!==attempt.materialId||judgment.materialVersion!==attempt.materialVersion)throw bad();
 return Object.freeze({kind:session.kind,sessionId:session.sessionId,...(session.kind==='partial'?{segmentId:session.segmentId,generation:session.generation}:{}),attemptId:attempt.attemptId,submitEventId:request.eventId,judgmentEventId:judgment.eventId}) as ReviewSourceLocator;
}
