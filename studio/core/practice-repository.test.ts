import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
import {PracticeEngine,ORIGINAL_PRACTICE_MATERIAL,replayPracticeEvents} from './practice';
import {DevelopmentPracticeRepository,PracticeStorageConflict,canonicalJson} from './practice-repository';
import {exportPracticeSnapshot} from './practice-export';
import {TrainingEngine} from './training';
import {IndexedDBTrainingRepository} from './repository';

function exercise(){
 let now=0,id=0;const clock={now:()=>now,wallTime:()=>new Date(Date.UTC(2026,9,8)+now).toISOString(),id:()=>`data-test-${++id}`};
 const engine=new PracticeEngine({clock,sessionId:'data-test-session',catalog:[ORIGINAL_PRACTICE_MATERIAL]});
 engine.startRound({materialId:ORIGINAL_PRACTICE_MATERIAL.materialId});
 engine.startAttempt({unitId:ORIGINAL_PRACTICE_MATERIAL.units[0].unitId,mode:'dictation'});
 return{engine,advance:(ms:number)=>{now+=ms}};
}

test('isolated adapter commits facts, closes, reopens, restores exact projections and same export boundary',async()=>{
 const factory=new IDBFactory(),options={databaseName:'lingotrace-dev-data-roundtrip',indexedDB:factory};
 const first=new DevelopmentPracticeRepository(options),{engine,advance}=exercise();
 engine.input('Could I have coffee, please?');advance(10000);engine.sampleClock();engine.submit();
 const firstAnswer=engine.getSnapshot();await first.save(firstAnswer);
 engine.pausePractice();advance(20000);engine.resumePractice();
 engine.exposeReference('hint');engine.input('Could I have a coffee, please?');advance(5000);engine.sampleClock();engine.submit();
 const revised=engine.getSnapshot();await first.save(revised);assert.equal(first.getStatus().state,'saved');
 await first.close();const reopened=new DevelopmentPracticeRepository(options),read=await reopened.load(revised.sessionId);
 assert.ok(read);assert.deepEqual(read,revised);assert.deepEqual(new PracticeEngine({snapshot:read}).getSnapshot(),revised);
 const output=exportPracticeSnapshot(read,'2026-10-08T12:00:00.000Z');
 assert.deepEqual(JSON.parse(output.json).snapshot,revised);
 assert.equal(output.rows.filter(row=>row.recordType==='event').length,revised.events.length);
 assert.ok(output.csv.startsWith('\uFEFF'));assert.ok(output.csv.includes('payload_json'));
 const stale=await reopened.save(firstAnswer);assert.equal(stale.disposition,'newer-preserved');
 assert.deepEqual(await reopened.load(revised.sessionId),revised);await reopened.close();
});

test('concurrent saves of exact same facts are idempotent and a divergent valid history cannot overwrite',async()=>{
 const factory=new IDBFactory(),options={databaseName:'lingotrace-dev-data-conflict',indexedDB:factory};
 const a=new DevelopmentPracticeRepository(options),b=new DevelopmentPracticeRepository(options),{engine}=exercise();
 engine.input('first answer');const initial=engine.getSnapshot();
 await Promise.all([a.save(initial),b.save(initial)]);
 engine.input('left branch');const left=engine.getSnapshot();await a.save(left);
 const alternative=new PracticeEngine({snapshot:initial,clock:{now:()=>0,wallTime:()=>new Date(Date.UTC(2026,9,8)).toISOString(),id:()=> 'conflicting-event'}});
 alternative.input('right branch');
 await assert.rejects(b.save(alternative.getSnapshot()),PracticeStorageConflict);
 assert.equal(b.getStatus().state,'error');assert.equal(b.getStatus().pending,0);
 assert.deepEqual(await a.load(left.sessionId),left);
 assert.equal((await b.save(left)).disposition,'already-present');
 await a.close();await b.close();
});

test('old v22 repository history remains readable and unchanged in its isolated compatibility database',async()=>{
 const factory=new IDBFactory();
 const oldOptions={dbName:'lingotrace-dev-data-legacy-v22-compatibility',indexedDB:factory};
 const old=new IndexedDBTrainingRepository(oldOptions),legacy=new TrainingEngine({sessionId:'legacy-v22'});
 legacy.input('Could I have a coffee, please?');legacy.submit();const expected=legacy.getSnapshot();await old.saveSession(expected);await old.close();
 const next=new DevelopmentPracticeRepository({databaseName:'lingotrace-dev-data-separate-new-contract',indexedDB:factory}),{engine}=exercise();
 engine.input('new independent development session');await next.save(engine.getSnapshot());await next.close();
 const restored=new IndexedDBTrainingRepository(oldOptions);assert.deepEqual(await restored.loadLatest(),expected);await restored.close();
});

test('development adapter cannot silently target production or report failed opening as saved',async()=>{
 assert.throws(()=>new DevelopmentPracticeRepository({databaseName:'lingotrace-studio-v1'}),/isolated/);
 const repository=new DevelopmentPracticeRepository({databaseName:'lingotrace-dev-data-unavailable'}),{engine}=exercise();
 await assert.rejects(repository.save(engine.getSnapshot()),/IndexedDB unavailable/);
 assert.equal(repository.getStatus().state,'error');assert.equal(repository.getStatus().pending,0);
});

test('production mode refuses both new adapters and previously constructed adapters without writing',async()=>{
 const factory=new IDBFactory(),repository=new DevelopmentPracticeRepository({databaseName:'lingotrace-dev-data-prod-guard',indexedDB:factory}),{engine}=exercise();
 const env=process.env as Record<string,string|undefined>,previous=env.NODE_ENV;
 try{
  env.NODE_ENV='production';
  assert.throws(()=>new DevelopmentPracticeRepository({databaseName:'lingotrace-dev-data-prod-repro',indexedDB:factory}),/disabled in production/);
  await assert.rejects(repository.save(engine.getSnapshot()),/disabled in production/);
  assert.deepEqual(await factory.databases(),[],'production refusal must not even create a database');
 }finally{if(previous===undefined)delete env.NODE_ENV;else env.NODE_ENV=previous}
});

test('export facts remain deterministic after persistence-shaped serialization and property order changes',()=>{
 const{engine}=exercise();engine.input('line one, "quoted"\n=not-a-formula');engine.submit();
 const snapshot=engine.getSnapshot(),restored=replayPracticeEvents(JSON.parse(JSON.stringify(snapshot.events)));
 const time='2026-10-08T12:00:00.000Z',first=exportPracticeSnapshot(snapshot,time),second=exportPracticeSnapshot(restored,time);
 assert.equal(first.json,second.json);assert.equal(first.csv,second.csv);
 assert.equal(canonicalJson({b:2,a:1}),canonicalJson({a:1,b:2}));
});

test('a failed metadata write rolls back appended facts and a later explicit save can recover',async()=>{
 const factory=new IDBFactory(),options={databaseName:'lingotrace-dev-data-atomic-failure',indexedDB:factory};
 const repository=new DevelopmentPracticeRepository(options),{engine}=exercise();engine.input('first');const before=engine.getSnapshot();await repository.save(before);
 engine.input('second');const after=engine.getSnapshot(),original=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='heads')throw new DOMException('Injected test quota','QuotaExceededError');return original.apply(this,args)};
 try{await assert.rejects(repository.save(after),{name:'QuotaExceededError'});assert.equal(repository.getStatus().state,'error');assert.equal(repository.getStatus().pending,0)}finally{IDBObjectStore.prototype.put=original}
 assert.deepEqual(await repository.load(before.sessionId),before,'transaction rollback prevents orphan input events');
 assert.equal(repository.getStatus().state,'error','reading an older saved state cannot claim the new draft was saved');
 assert.match(repository.getStatus().error??'',/quota/i);assert.equal(repository.getStatus().lastLoadedSequence,before.sequence);
 await repository.save(after);await repository.close();const reopened=new DevelopmentPracticeRepository(options);assert.deepEqual(await reopened.load(after.sessionId),after);await reopened.close();
});
