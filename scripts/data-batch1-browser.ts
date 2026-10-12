import {PracticeEngine,ORIGINAL_PRACTICE_MATERIAL,type PracticeSnapshot} from '../studio/core/practice';
import {DevelopmentPracticeRepository,canonicalJson} from '../studio/core/practice-repository';
import {exportPracticeSnapshot} from '../studio/core/practice-export';
import {TrainingEngine} from '../studio/core/training';
import {IndexedDBTrainingRepository} from '../studio/core/repository';

function check(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(`Data QA failed: ${message}`)}
function current(snapshot:PracticeSnapshot){return snapshot.projections.attempts[snapshot.projections.currentAttemptId!]}
function parseCSV(input:string):string[][]{
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;const text=input.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++}else if(c==='"')quoted=false;else cell+=c}
 else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell=''}else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell=''}else cell+=c}
 if(cell||row.length){row.push(cell);rows.push(row)}return rows;
}
async function digest(snapshot:PracticeSnapshot){const bytes=new TextEncoder().encode(canonicalJson(snapshot));const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}

/** Run only in a clean, isolated QA browser context. Never touches v22 user DBs,
 * UI, media, network, camera/microphone or permission dialogs. */
export async function runPracticeDataBatchOneQA(){
 check(!!globalThis.indexedDB,'real browser IndexedDB required');
 const suffix=crypto.randomUUID(),databaseName=`lingotrace-dev-data-browser-${suffix}`,legacyName=`lingotrace-dev-data-legacy-${suffix}`;
 let now=0,serial=0;const clock={now:()=>now,wallTime:()=>new Date(Date.UTC(2026,9,8,8)+now).toISOString(),id:()=>`fixture-${++serial}`};
 const material=ORIGINAL_PRACTICE_MATERIAL,unitId=material.units[0].unitId,answerX='Could I have coffee, please?',answerY='Could I have a coffee, please?';
 const engine=new PracticeEngine({clock,sessionId:`fixture-session-${suffix}`,catalog:[material]});
 engine.startRound({materialId:material.materialId});engine.startAttempt({unitId,mode:'dictation',attemptId:'a1'});
 engine.input(answerX);now=10000;engine.sampleClock();engine.submit();
 engine.pausePractice();const paused=engine.getSnapshot(),frozenSequence=paused.sequence;now=30000;
 let inputRejected=false,submitRejected=false;try{engine.input('must not be accepted')}catch{inputRejected=true}try{engine.submit()}catch{submitRejected=true}
 check(inputRejected&&submitRejected,'manual pause rejects input and submission');check(engine.getSnapshot().sequence===frozenSequence,'paused callbacks cannot append facts');
 const repository=new DevelopmentPracticeRepository({databaseName});await repository.save(paused);await repository.close();
 const reopened=new DevelopmentPracticeRepository({databaseName}),storedPause=await reopened.load(paused.sessionId);
 check(storedPause&&canonicalJson(storedPause)===canonicalJson(paused),'closed/reopened real IDB restores paused snapshot');
 const restored=new PracticeEngine({snapshot:storedPause,clock});restored.resumePractice();restored.exposeReference('hint');now=35000;restored.sampleClock();restored.input(answerY);restored.submit();
 let state=restored.getSnapshot(),a1=state.projections.attempts.a1;
 check(a1.firstSubmission?.answer===answerX&&a1.revisions[0]?.answer===answerY,'first answer fixed, revision belongs to same attempt');
 check(a1.activeMs===15000,'20seconds manual pause excluded from10+5seconds practice');
 check(a1.firstSubmission.exposureAtSubmission.length===0&&a1.revisions[0].exposureAtSubmission.length===1,'post-answer hint cannot rewrite first-answer conditions');
 restored.setVideoPaused(true);now=37000;restored.sampleClock();check(current(restored.getSnapshot()).activeMs===17000,'video-only pause does not freeze practice');
 const updated={...material,units:material.units.map(unit=>unit.unitId===unitId?{...unit,references:[...unit.references,{referenceVersion:'v2',text:'Could I have some coffee, please?',startSeconds:0,endSeconds:6}]}:unit)};
 restored.registerMaterial(updated);check(restored.getSnapshot().projections.attempts.a1.reference.referenceVersion==='v1','reference update cannot retarget old attempt');
 const audioAttempt=restored.switchMode('recording-comparison');check(audioAttempt.relation?.attemptId==='a1'&&audioAttempt.reference.referenceVersion==='v1','mode switch is a related new fixed-reference attempt');
 let noFakeAudio=false;try{restored.submit()}catch{noFakeAudio=true}check(noFakeAudio,'text submission cannot fabricate audio evidence/completion');
 check(!current(restored.getSnapshot()).practiceComplete&&!current(restored.getSnapshot()).evaluationComplete&&current(restored.getSnapshot()).targetMet===null,'recording practice and evaluation remain uncompleted/unassessed');
 restored.switchMode('dictation');restored.input(answerY);const sameRound=restored.submit();check(sameRound.exposureAtSubmission.length===1,'exposure survives mode changes in same round');
 restored.endRound();restored.startRound({materialId:material.materialId});restored.startAttempt({unitId,mode:'dictation',referenceVersion:'v2'});restored.input('Could I have some coffee, please?');const freshRound=restored.submit();check(freshRound.exposureAtSubmission.length===0,'explicit next round clears only round-local exposure');
 state=restored.getSnapshot();await reopened.save(state);await reopened.close();const third=new DevelopmentPracticeRepository({databaseName});const read=await third.load(state.sessionId);check(read&&canonicalJson(read)===canonicalJson(state),'second save/reopen reconstructs exact final state');
 const exported=exportPracticeSnapshot(read,'2026-10-08T08:30:00.000Z'),json=JSON.parse(exported.json),csv=parseCSV(exported.csv),headers=csv.shift()!;
 const eventRows=csv.filter(row=>row[headers.indexOf('record_type')]==='event').map(row=>JSON.parse(row[headers.indexOf('payload_json')]));
 check(canonicalJson(eventRows)===canonicalJson(read.events)&&canonicalJson(json.snapshot)===canonicalJson(read),'CSV and JSON use same exact facts and projection boundary');
 const raw=await new Promise<{head:any;eventCount:number;stores:string[]}>((resolve,reject)=>{
  const open=indexedDB.open(databaseName,1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['heads','events'],'readonly');let head:any,eventCount=0;const h=tx.objectStore('heads').get(read.sessionId),c=tx.objectStore('events').index('bySession').count(read.sessionId);h.onsuccess=()=>{head=h.result};c.onsuccess=()=>{eventCount=c.result};tx.oncomplete=()=>{resolve({head,eventCount,stores:Array.from(db.objectStoreNames)});db.close()};tx.onerror=()=>{db.close();reject(tx.error)}};
 });
 check(raw.eventCount===read.events.length&&raw.head.sequence===read.sequence&&!('snapshot'in raw.head),'only one fact store; heads contain revision metadata only');
 const legacy=new TrainingEngine({clock,sessionId:'legacy-compatibility'});legacy.input('Could I have a coffee, please?');legacy.submit();const legacyBefore=legacy.getSnapshot();
 const oldWriter=new IndexedDBTrainingRepository({dbName:legacyName});await oldWriter.saveSession(legacyBefore);await oldWriter.close();await third.save(read);const oldReader=new IndexedDBTrainingRepository({dbName:legacyName});check(canonicalJson(await oldReader.loadLatest())===canonicalJson(legacyBefore),'old v22 format remains readable unchanged in isolated compatibility DB');await oldReader.close();await third.close();
 return{passed:true,sourceBaseline:'3921e15e2b43a02509c6f288b1099c0fe6982f1f',databaseName,legacyName,sessionId:read.sessionId,snapshotSHA256:await digest(read),eventCount:read.events.length,attemptCount:Object.keys(read.projections.attempts).length,firstAnswer:a1.firstSubmission.answer,revision:a1.revisions[0].answer,pausedMsExcluded:20000,practiceMsBeforeModeChange:17000,rawStores:raw.stores,browser:navigator.userAgent,executionEnvironment:typeof window==='undefined'?'non-browser-harness':'browser',boundary:'IndexedDB evidence depends on the reported execution environment. Deterministic fixture input commands are not a connected user UI, native keyboard or audio capture. Privacy/delete/review/regrade gates remain next batch.'};
}

/** Re-inject the same bundle after an actual page reload and call this function. */
export async function verifyPracticeDataReload(expected:{databaseName:string;sessionId:string;snapshotSHA256:string}){
 const repository=new DevelopmentPracticeRepository({databaseName:expected.databaseName});const snapshot=await repository.load(expected.sessionId);check(snapshot,'saved fixture survives actual page reload');
 const actual=await digest(snapshot);check(actual===expected.snapshotSHA256,'snapshot digest after reload');await repository.close();return{passed:true,sessionId:snapshot.sessionId,sequence:snapshot.sequence,snapshotSHA256:actual};
}
