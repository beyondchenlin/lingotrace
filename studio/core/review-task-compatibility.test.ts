import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IDBFactory } from 'fake-indexeddb';
import { TrainingEngine, CAFE_MATERIAL } from './training.ts';
import { IndexedDBTrainingRepository } from './repository.ts';
import { TrainingHistorySegmentProjector } from './training-history-segment.ts';
import { exportStudioSession } from './session-export.ts';
import { exportTrainingHistorySegment } from './segment-history-reader.ts';
import { buildReviewTarget } from './review-tasks.ts';
import { resolveReviewLocalTime } from './review-due-time.ts';
import { LOCAL_REFERENCE_MEDIA_ID, LOCAL_REFERENCE_MEDIA_SHA256 } from './local-reference.ts';

const frozenCommit='0b5b8bac3c47e24f29c253224118f10dac4f0b82';
const time='2026-10-10T12:00:00.000Z';
function engine(prefix:string){let n=0;return new TrainingEngine({clock:{now:()=>0,wallTime:()=>time,id:()=>`${prefix}-${++n}`}});}

test('exact frozen v64 repository, full reader, partial paging and exports accept v65 tasks and ordinary reveal unchanged',async()=>{
  const root=mkdtempSync(join(tmpdir(),'lingotrace-frozen-v64-'));
  try{
    writeFileSync(join(root,'package.json'),'{"type":"module"}');mkdirSync(join(root,'studio/core'),{recursive:true});
    const paths=execFileSync('git',['ls-tree','-r','--name-only',frozenCommit,'studio/core'],{encoding:'utf8'}).trim().split('\n').filter(path=>path.endsWith('.ts')&&!path.endsWith('.test.ts'));
    for(const path of paths){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),execFileSync('git',['show',`${frozenCommit}:${path}`]));}
    const frozen=await import(pathToFileURL(join(root,'studio/core/repository.ts')).href);
    const frozenFull=await import(pathToFileURL(join(root,'studio/core/session-export.ts')).href);
    const frozenPartial=await import(pathToFileURL(join(root,'studio/core/segment-history-reader.ts')).href);
    const factory=new IDBFactory(),dbName='frozen-v64-review-read',repo=new IndexedDBTrainingRepository({indexedDB:factory,dbName}),old=new frozen.IndexedDBTrainingRepository({indexedDB:factory,dbName});
    const e=engine('frozen-full');e.exposeHint('reveal');e.input('authentic revealed answer');e.submit();await repo.saveSession(e.getSnapshot());
    const s=e.getSnapshot(),a=s.attempts[0],source={kind:'full' as const,sessionId:s.sessionId,attemptId:a.attemptId,submitEventId:s.events.find(e=>e.type==='submitRequested')!.eventId,judgmentEventId:s.events.find(e=>e.type==='judgmentApplied')!.eventId};
    const target=await buildReviewTarget(CAFE_MATERIAL,CAFE_MATERIAL.cues[0].id,{id:LOCAL_REFERENCE_MEDIA_ID,sha256:LOCAL_REFERENCE_MEDIA_SHA256,durationSeconds:72}),due=resolveReviewLocalTime('2026-10-15T12:00','UTC')[0];
    const before=await old.loadHistorySession(s.sessionId),beforeExport=frozenFull.exportStudioSession(before.snapshot,time),version=(await factory.databases())[0].version;
    await repo.createReviewTask({requestId:'frozen-compatibility',source,target,due});
    assert.equal((await factory.databases())[0].version,version);
    assert.deepEqual(await old.loadHistorySession(s.sessionId),before);assert.deepEqual(await old.loadLatest(),s);assert.equal((await old.listHistory()).entries.length,1);
    assert.deepEqual(exportStudioSession(s,time),beforeExport);assert.deepEqual(frozenFull.exportStudioSession((await old.loadHistorySession(s.sessionId)).snapshot,time),beforeExport);
    const control=await repo.enableAutomaticHistory(0);
    for(let index=0;index<2;index++){
      const pEngine=engine(`frozen-partial-${index}`),p=new TrainingHistorySegmentProjector(pEngine.getSnapshot(),{segmentId:`frozen-segment-${index}`,writerInstanceId:'writer',generation:control.generation,startedAt:time});
      const admission=await repo.beginTrainingHistorySegment(p.getSegment(),control.generation);
      pEngine.exposeHint('reveal');pEngine.input('real partial answer','typed',{version:'dom-edit-v1',kind:'input',inputType:'insertText',data:'real partial answer'});pEngine.submit();p.observe(pEngine.getSnapshot());await repo.saveTrainingHistorySegment(admission.permit,p.getSegment());
      const partial=p.getSegment(),snapshot=pEngine.getSnapshot(),attempt=snapshot.attempts[0];
      const partialSource={kind:'partial' as const,sessionId:partial.sessionId,segmentId:partial.segmentId,generation:partial.generation,attemptId:attempt.attemptId,submitEventId:snapshot.events.find(e=>e.type==='submitRequested')!.eventId,judgmentEventId:snapshot.events.find(e=>e.type==='judgmentApplied')!.eventId};
      await repo.createReviewTask({requestId:`frozen-partial-task-${index}`,source:partialSource,target,due});
      const oldRead=await old.loadTrainingHistorySegment(partial.segmentId);assert.deepEqual(oldRead,partial);assert.deepEqual(frozenPartial.exportTrainingHistorySegment(oldRead),exportTrainingHistorySegment(partial));
    }
    const first=await old.listTrainingHistorySegments({limit:1});assert.equal(first.entries.length,1);assert.equal(first.hasMore,true);const second=await old.listTrainingHistorySegments({limit:1,after:first.nextCursor});assert.equal(second.entries.length,1);assert.notEqual(first.entries[0].segmentId,second.entries[0].segmentId);
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=factory.open(dbName);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const afterBarrierVersion=db.version;
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction('meta','readwrite');tx.objectStore('meta').put({key:'review-task-v1:broken-future',value:{unsupported:true}});tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error);});db.close();
    assert.equal((await repo.listReviewTasks()).unreadableCount,1);assert.equal((await old.listTrainingHistorySegments()).entries.length,2);assert.deepEqual(await old.loadHistorySession(s.sessionId),before);assert.equal((await factory.databases())[0].version,afterBarrierVersion);
    await repo.close();await old.close();
  }finally{rmSync(root,{recursive:true,force:true});}
});
