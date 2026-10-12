import test from 'node:test';
import assert from 'node:assert/strict';
import {PracticeEngine,ORIGINAL_PRACTICE_MATERIAL,PRACTICE_SCHEMA_VERSION,replayPracticeEvents,validatePracticeSnapshot,redactPracticeAttempt,type PracticeSnapshot} from './practice';
import {exportPracticeSnapshot} from './practice-export';

function fixture(){
 let now=0,serial=0,redactionSerial=0;const clock={now:()=>now,wallTime:()=>new Date(Date.UTC(2026,9,8)+now).toISOString(),id:()=>`privacy-event-${++serial}`};
 const engine=new PracticeEngine({clock,sessionId:'redaction-session',catalog:[ORIGINAL_PRACTICE_MATERIAL]});
 engine.startRound({materialId:ORIGINAL_PRACTICE_MATERIAL.materialId,practiceRoundId:'r1'});
 const tick=(ms:number)=>{now+=ms};
 const redact=(snapshot:PracticeSnapshot,attemptId='a1')=>redactPracticeAttempt(snapshot,{attemptId,redactionId:`redaction-${++redactionSerial}`,eventId:()=>`sanitized-event-${++serial}`});
 return{engine,tick,redact,clock};
}
function dependency(){
 const f=fixture();f.tick(137);f.engine.startAttempt({unitId:'cafe-order',mode:'dictation',attemptId:'a1'});
 f.tick(263);f.engine.exposeReference('hint');f.engine.input('PRIVATE_A1_FIRST_ANSWER_CANARY','paste');f.tick(10917);f.engine.sampleClock();f.engine.submit();
 f.tick(17);f.engine.exposeReference('correction');f.engine.input('PRIVATE_A1_REVISION_CANARY');f.engine.submit();f.engine.retryAttempt();const a2=f.engine.getSnapshot().projections.currentAttemptId!;
 f.engine.input('Could I have a coffee, please?');f.tick(5000);f.engine.sampleClock();f.engine.submit();f.engine.input('A2 pending draft, keep it');return{...f,a2};
}
const kinds=(snapshot:PracticeSnapshot,attemptId:string)=>snapshot.projections.attempts[attemptId].firstSubmission!.exposureAtSubmission.map(item=>item.kind);

test('2B deleting a1 preserves the surviving a2 answer, unsubmitted draft, alignment, assisted exposure and 5000ms',()=>{
 const{engine,redact,a2}=dependency(),before=engine.getSnapshot(),old=before.projections.attempts[a2];const after=redact(before);
 assert.equal(after.schemaVersion,'lingotrace-practice-v2');assert.equal(Object.hasOwn(after.projections.attempts,'a1'),false);
 const kept=after.projections.attempts[a2];assert.equal(kept.attemptId,old.attemptId);assert.deepEqual(kept.reference,old.reference);assert.deepEqual(kept.relation,old.relation);assert.deepEqual(kept.draft,old.draft);assert.equal(kept.activeMs,5000);assert.equal(kept.firstSubmission!.answer,old.firstSubmission!.answer);assert.deepEqual(kept.firstSubmission!.alignment,old.firstSubmission!.alignment);
 assert.equal(kept.evaluationComplete,false);assert.equal(kept.targetMet,null);assert.equal(kept.firstSubmission!.targetMet,true);assert.deepEqual(kinds(after,a2),['hint','correction']);assert.equal(after.projections.currentAttemptId,a2);assert.equal(after.projections.activeMs,5000);assert.equal(after.projections.rounds.r1.activeMs,5000);assert.deepEqual(after.projections.rounds.r1.attemptIds,[a2]);
 assert.deepEqual(replayPracticeEvents(JSON.parse(JSON.stringify(after.events))),after);assert.deepEqual(validatePracticeSnapshot(JSON.parse(JSON.stringify(after))),after);
});

test('2B rewritten events, projections and both export formats contain no deleted answer or original erased event identities',()=>{
 const{engine,redact}=dependency(),before=engine.getSnapshot(),after=redact(before);const output=exportPracticeSnapshot(after,'2026-10-08T10:00:00.000Z');
 for(const bytes of [JSON.stringify(after),output.json,output.csv]){
  assert.equal(bytes.includes('PRIVATE_A1_FIRST_ANSWER_CANARY'),false);assert.equal(bytes.includes('PRIVATE_A1_REVISION_CANARY'),false);assert.equal(bytes.includes('10917'),false);
 }
 for(let i=0;i<before.events.length;i++){
  const original=before.events[i],rewritten=after.events[i];
  if(rewritten.schemaVersion!==PRACTICE_SCHEMA_VERSION){assert.notEqual(rewritten.eventId,original.eventId);assert.equal(JSON.stringify(after).includes(`"${original.eventId}"`),false);assert.deepEqual(Object.keys(rewritten).sort(),['eventId','payload','schemaVersion','sequence','sessionId']);}
  else assert.deepEqual(rewritten,original,'surviving ordinary events keep their identity and every byte-shaped field');
 }
 assert.deepEqual(JSON.parse(output.json).snapshot,after);assert.equal(output.rows.filter(row=>row.recordType==='event').length,after.events.length);
});

test('2B deleting the current attempt leaves no current attempt and never jumps back to an older one',()=>{
 const{engine,tick,redact,clock}=fixture();engine.startAttempt({unitId:'cafe-thanks',mode:'dictation',attemptId:'retained'});engine.input('Thank you for your help today.');tick(3000);engine.submit();engine.startAttempt({unitId:'cafe-order',mode:'dictation',attemptId:'a1'});engine.input('DELETE_CURRENT_CANARY');tick(2000);engine.sampleClock();
 const after=redact(engine.getSnapshot());assert.equal(after.projections.currentAttemptId,null);assert.ok(after.projections.attempts.retained);assert.equal(after.projections.activeMs,3000);assert.equal(Object.hasOwn(after.projections.attempts,'a1'),false);
 const restored=new PracticeEngine({snapshot:after,clock});assert.throws(()=>restored.input('late a1 text'));assert.throws(()=>restored.submit());assert.throws(()=>restored.retryAttempt());const sequence=restored.getSnapshot().sequence;tick(5000);restored.sampleClock();assert.equal(restored.getSnapshot().sequence,sequence);
 assert.throws(()=>restored.startAttempt({unitId:'cafe-order',mode:'dictation',attemptId:'a1'}));
});

test('2B unsent or recording-mode parents can be removed without manufacturing a first submission',()=>{
 for(const mode of ['dictation','recording-comparison'] as const){const{engine,redact}=fixture();engine.startAttempt({unitId:'cafe-order',mode,attemptId:'a1'});if(mode==='dictation')engine.input('UNSUBMITTED_PRIVATE_CANARY');engine.exposeReference('translation');const next=mode==='dictation'?engine.retryAttempt():engine.switchMode('dictation');engine.input('Could I have a coffee, please?');engine.submit();const after=redact(engine.getSnapshot());
  assert.equal(after.projections.attempts[next.attemptId].firstSubmission!.targetMet,true);assert.deepEqual(kinds(after,next.attemptId),['translation']);assert.equal(after.events.some(event=>event.payload.type==='redactedFirstSubmissionBoundary'),false);assert.equal(JSON.stringify(after).includes('UNSUBMITTED_PRIVATE_CANARY'),false);
 }
});

test('2B parent removal retains only minimal pause state so later input and timing replay correctly',()=>{
 const{engine,tick,redact}=fixture();engine.startAttempt({unitId:'cafe-order',mode:'dictation',attemptId:'a1'});engine.input('PAUSED_A1_PRIVATE');tick(1700);engine.pausePractice();tick(20000);engine.resumePractice();engine.setVideoPaused(true);engine.retryAttempt();const a2=engine.getSnapshot().projections.currentAttemptId!;engine.input('Could I have a coffee, please?');tick(5000);engine.submit();
 const after=redact(engine.getSnapshot());assert.equal(after.projections.manualPaused,false);assert.equal(after.projections.videoPaused,true);assert.equal(after.projections.attempts[a2].activeMs,5000);assert.equal(after.projections.activeMs,5000);assert.equal(JSON.stringify(after).includes('PAUSED_A1_PRIVATE'),false);assert.deepEqual(replayPracticeEvents(after.events),after);
});

test('2B deleting an already deleted target is idempotent and sequential deletions cannot recover earlier facts',()=>{
 const{engine,redact,a2}=dependency();const after=redact(engine.getSnapshot());assert.deepEqual(redact(after),after);const both=redact(after,a2);
 assert.equal(Object.keys(both.projections.attempts).length,0);assert.equal(both.projections.currentAttemptId,null);assert.equal(both.projections.activeMs,0);assert.equal(JSON.stringify(both).includes('PRIVATE_A1'),false);assert.equal(JSON.stringify(both).includes('A2 pending draft'),false);assert.deepEqual(replayPracticeEvents(both.events),both);
});

test('2B a sanitized engine continues the surviving attempt without restoring its deleted parent',()=>{
 const{engine,redact,a2,clock}=dependency();const after=redact(engine.getSnapshot()),restored=new PracticeEngine({snapshot:after,clock});restored.input('Could I have a coffee, please?');const corrected=restored.submit();assert.equal(corrected.targetMet,true);assert.equal(restored.getSnapshot().projections.currentAttemptId,a2);assert.equal(Object.hasOwn(restored.getSnapshot().projections.attempts,'a1'),false);assert.deepEqual(validatePracticeSnapshot(JSON.parse(JSON.stringify(restored.getSnapshot()))),restored.getSnapshot());
});

test('2B validation rejects timestamp-bearing synthetic events, retained deleted input and missing terminal commit',()=>{
 const{engine,redact}=dependency(),original=engine.getSnapshot(),after=redact(original);const index=after.events.findIndex(event=>event.payload.type==='erasedSlot');assert.ok(index>=0);
 const timed=structuredClone(after.events) as unknown as Array<Record<string,unknown>>;timed[index].occurredAt='2026-10-08T00:00:00.000Z';assert.throws(()=>replayPracticeEvents(timed as unknown as typeof after.events));
 const smuggled=[...after.events];const privateIndex=original.events.findIndex(event=>event.payload.type==='inputCommitted'&&event.payload.attemptId==='a1');smuggled[privateIndex]=original.events[privateIndex];assert.throws(()=>replayPracticeEvents(smuggled));
 assert.throws(()=>replayPracticeEvents(after.events.slice(0,-1)));assert.throws(()=>validatePracticeSnapshot({...after,schemaVersion:PRACTICE_SCHEMA_VERSION}));
});

test('2B wrong parent lineage and duplicate event IDs cannot relabel deleted facts',()=>{
 const{engine,redact}=dependency(),after=redact(engine.getSnapshot());const wire=JSON.parse(JSON.stringify(after.events));const anchor=wire.find((event:{payload:{type:string}})=>event.payload.type==='redactedAttemptBoundary');anchor.payload.lineage.referenceVersion='not-the-frozen-reference';assert.throws(()=>replayPracticeEvents(wire));
 const conflicting=JSON.parse(JSON.stringify(after.events));conflicting.push({...conflicting.at(-1),payload:{type:'attemptRedactionCommitted',attemptId:'somebody-else',redactionId:'different'}});assert.throws(()=>replayPracticeEvents(conflicting));
 const restored=new PracticeEngine({snapshot:after});assert.throws(()=>restored.dispatch({...after.events.at(-1)!,eventId:'new-privileged-event',sequence:after.sequence+1}),'live dispatch must not accept privileged compaction markers');
});

test('2B ordinary v1 snapshots and exports remain unchanged without a deletion',()=>{
 const{engine}=fixture();engine.startAttempt({unitId:'cafe-order',mode:'dictation',attemptId:'ordinary'});engine.input('Could I have a coffee, please?');engine.submit();const before=engine.getSnapshot(),serialized=JSON.stringify(before),exported=exportPracticeSnapshot(before,'2026-10-08T10:00:00.000Z');
 assert.equal(before.schemaVersion,PRACTICE_SCHEMA_VERSION);assert.equal(JSON.stringify(replayPracticeEvents(before.events)),serialized);assert.equal(JSON.stringify(new PracticeEngine({snapshot:JSON.parse(serialized)}).getSnapshot()),serialized);assert.equal(exportPracticeSnapshot(before,'2026-10-08T10:00:00.000Z').json,exported.json);
 assert.throws(()=>redactPracticeAttempt(before,{attemptId:'missing',redactionId:'missing-redaction',eventId:()=> 'fresh-redaction-event'}));
});

test('2B all deletion orders in a three-attempt chain preserve each remaining attempt and prune unnecessary lineage',()=>{
 const orders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
 for(const order of orders){const{engine,tick,redact}=fixture();engine.startAttempt({unitId:'cafe-order',mode:'dictation',attemptId:'a1'});const ids=['a1'];for(let i=0;i<3;i++){if(i>0)ids.push(engine.retryAttempt().attemptId);engine.exposeReference(i%2?'correction':'hint');engine.input(`PRIVATE_CHAIN_${i}_CANARY`);tick((i+1)*1000);engine.submit()}const original=engine.getSnapshot();let next=original;const removed=new Set<string>();
  for(const index of order){const id=ids[index];removed.add(id);next=redact(next,id);assert.deepEqual(replayPracticeEvents(next.events),next);for(let n=0;n<3;n++){const kept=next.projections.attempts[ids[n]];if(removed.has(ids[n])){assert.equal(kept,undefined);assert.equal(JSON.stringify(next).includes(`PRIVATE_CHAIN_${n}_CANARY`),false)}else{assert.equal(kept.firstSubmission!.answer,original.projections.attempts[ids[n]].firstSubmission!.answer);assert.equal(kept.activeMs,original.projections.attempts[ids[n]].activeMs)}}}
  assert.equal(Object.keys(next.projections.attempts).length,0);assert.equal(next.projections.activeMs,0);
 }
});

test('2B a redaction operation ID cannot smuggle a removed original event identity into the result',()=>{
 const{engine}=dependency(),snapshot=engine.getSnapshot(),old=snapshot.events.find(event=>event.payload.type==='inputCommitted'&&event.payload.attemptId==='a1')!;let id=0;
 assert.throws(()=>redactPracticeAttempt(snapshot,{attemptId:'a1',redactionId:old.eventId,eventId:()=>`fresh-sanitized-${++id}`}));
});
