import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDBTrainingRepository, TRAINING_HISTORY_SEGMENT_KEY_PREFIX } from './repository';
import { RecordCalendarReader, type RecordCalendarAccess } from './record-calendar-reader';
import { readLegacyHistoryRecord, type LegacyHistoryCursor, type LegacyHistoryList, type LegacyHistorySession } from './legacy-history';
import type { TrainingHistorySegmentCursor, TrainingHistorySegmentList, TrainingHistorySegmentSummary } from './repository';
import { TrainingEngine, SCHEMA_VERSION, RULE_VERSION, PACE_RULE_VERSION } from './training';
import { TRAINING_HISTORY_SEGMENT_VERSION, type TrainingHistorySegment } from './training-history-segment';
import { recordCalendarMonth } from './record-calendar';

function deferred<T>() { let resolve!: (value:T)=>void, reject!: (reason:unknown)=>void; const promise = new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; }
function legacy(id='one', wallTime='2026-02-28T23:30:00Z', answer='private original answer'):LegacyHistorySession {
  let serial=0;
  const engine=new TrainingEngine({sessionId:id,clock:{now:()=>0,wallTime:()=>wallTime,id:()=>`${id}-event-${++serial}`}});engine.input(answer);
  const snapshot=engine.getSnapshot();
  return readLegacyHistoryRecord({sessionId:id,sequence:snapshot.sequence,updatedAt:'2026-10-09T00:00:00Z',snapshot},id);
}
function segment(id='one',wallTimes=['2026-03-01T00:30:00Z']):TrainingHistorySegment {
  return {schemaVersion:TRAINING_HISTORY_SEGMENT_VERSION,segmentId:id,sessionId:'source-session',writerInstanceId:'writer-one',generation:1,
    material:{id:'material',version:'v1'},rules:{trainingSchemaVersion:SCHEMA_VERSION,ruleVersion:RULE_VERSION,paceRuleVersion:PACE_RULE_VERSION},
    startedAt:'2025-01-01T00:00:00Z',endedAt:'2026-10-09T00:00:00Z',coverage:'partial',replayable:false,
    facts:wallTimes.map((wallTime,index)=>({sourceEventId:`fact-${index}`,ordinal:index+1,wallTime,cueId:'cue',type:'inputCommitted',source:'typed',retention:'recorded',text:'private partial answer'}))};
}
function summary(value:TrainingHistorySegment):TrainingHistorySegmentSummary{return {segmentId:value.segmentId,sessionId:value.sessionId,generation:value.generation,startedAt:value.startedAt,endedAt:value.endedAt,updatedAt:'2026-10-09T00:00:00Z',factCount:value.facts.length,coverage:'partial',replayable:false};}
const emptyLegacy:LegacyHistoryList={source:'legacy-training-v1',entries:[],limit:100,hasMore:false,nextCursor:null};
const emptySegments:TrainingHistorySegmentList={entries:[],limit:100,hasMore:false,nextCursor:null};
function access(full:LegacyHistorySession[]=[],parts:TrainingHistorySegment[]=[],overrides:Partial<RecordCalendarAccess>={}):RecordCalendarAccess {
  const fullSorted=[...full].sort((a,b)=>Date.parse(b.summary.updatedAt)-Date.parse(a.summary.updatedAt)||a.summary.sessionId.localeCompare(b.summary.sessionId));
  const partSorted=[...parts].sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)||a.segmentId.localeCompare(b.segmentId));
  return {
    listHistory:async options=>{
      const after=options?.after, start=after?fullSorted.findIndex(value=>value.summary.sessionId===after.key)+1:0, values=fullSorted.slice(start,start+100),hasMore=start+100<fullSorted.length,last=values.at(-1);
      return {...emptyLegacy,entries:values.map(value=>({status:'ready' as const,summary:value.summary})),hasMore,nextCursor:hasMore?{version:1,updatedAtMs:Date.parse(last!.summary.updatedAt),key:last!.summary.sessionId}:null};
    },
    loadHistorySession:async id=>full.find(value=>value.summary.sessionId===id)??null,
    listTrainingHistorySegments:async options=>{
      const after=options?.after,start=after?partSorted.findIndex(value=>value.segmentId===after.segmentId)+1:0,values=partSorted.slice(start,start+100),hasMore=start+100<partSorted.length,last=values.at(-1);
      return {...emptySegments,entries:values.map(summary),hasMore,nextCursor:hasMore?{version:1,startedAtMs:Date.parse(last!.startedAt),segmentId:last!.segmentId}:null};
    },
    loadTrainingHistorySegment:async id=>parts.find(value=>value.segmentId===id)??null,
    listListeningSessions:async()=>[],loadListeningSession:async()=>null,...overrides,
  };
}
const fast={yieldControl:async()=>{}};

test('scans all pages of BOTH source families beyond 100, independent of metadata month',async()=>{
  const full=Array.from({length:107},(_,i)=>legacy(`full-${String(i).padStart(3,'0')}`));
  const parts=Array.from({length:103},(_,i)=>segment(`part-${String(i).padStart(3,'0')}`));
  const base=access(full,parts),fullPages:(LegacyHistoryCursor|null)[]=[],partPages:(TrainingHistorySegmentCursor|null)[]=[];
  let loads=0,yields=0;
  const reader=new RecordCalendarReader({...base,
    listHistory:async options=>{fullPages.push(options?.after??null);return base.listHistory(options);},
    listTrainingHistorySegments:async options=>{partPages.push(options?.after??null);return base.listTrainingHistorySegments(options);},
    loadHistorySession:async id=>{loads++;return base.loadHistorySession(id);},loadTrainingHistorySegment:async id=>{loads++;return base.loadTrainingHistorySegment(id);},
  },{yieldEvery:8,yieldControl:async()=>{yields++;}});
  await reader.refresh('UTC');const state=reader.getSnapshot();
  assert.equal(state.status,'loaded');assert.equal(state.records.length,210);assert.equal(loads,210);assert.equal(fullPages.length,2);assert.equal(partPages.length,2);assert.ok(yields>=26);
  assert.equal(recordCalendarMonth(state.records,'2026-02').at(-1)?.records.length,107);
  assert.equal(recordCalendarMonth(state.records,'2026-03')[0].records.length,103);
  const index=JSON.stringify(state.records);for(const forbidden of ['private original','private partial','snapshot','activeMs','earnedWords','alignment','attempts'])assert.equal(index.includes(forbidden),false,forbidden);
  assert.ok(state.records.every(Object.isFrozen));assert.ok(state.records.every(value=>Object.isFrozen(value.days)));
});

test('a completed scan with no retained sources leaves every date unknown, with no zero or complete claims',async()=>{
  const reader=new RecordCalendarReader(access(),fast);await reader.refresh('UTC');assert.equal(reader.getSnapshot().status,'loaded');
  assert.ok(recordCalendarMonth(reader.getSnapshot().records,'2026-10').every(day=>day.coverage==='unknown'&&day.records.length===0));
});

test('partial/off gaps never become dates, empty segments and invalid times remain visibly unclassified',async()=>{
  const mixed=segment('mixed',['2026-02-28T23:59:59Z','2026-03-02T00:00:00Z','2026-02-30T00:00:00Z','2026-03-03T12:00:00']);
  const reader=new RecordCalendarReader(access([legacy('naive','2026-04-01T00:00:00')],[mixed,segment('empty',[])]),fast);
  await reader.refresh('UTC');const state=reader.getSnapshot();assert.equal(state.status,'partial');assert.equal(state.undatedEventCount,4);assert.equal(state.undatedRecordCount,2);assert.equal(state.unreadableCount,0);
  assert.deepEqual(state.records.find(value=>value.recordId==='mixed')?.days,['2026-02-28','2026-03-02']);assert.equal(recordCalendarMonth(state.records,'2026-03')[0].coverage,'unknown');assert.match(state.error!,/不完整/);
});

test('missing, invalid, mismatched and stale detail reads cannot create an index entry',async()=>{
  const original=legacy();
  for(const loaded of [null,legacy('wrong'),legacy('one','2026-02-28T23:30:00Z','changed')]) {
    // Same-sequence changed content can be current at scan time; stale metadata is separately refused below.
    if(loaded?.summary.sessionId==='one')continue;
    const reader=new RecordCalendarReader(access([original],[segment()],{loadHistorySession:async()=>loaded}),fast);await reader.refresh('UTC');
    assert.equal(reader.getSnapshot().status,'partial');assert.equal(reader.getSnapshot().records.length,1);assert.equal(reader.getSnapshot().unreadableCount,1);
  }
  const changed=legacy('one');const stale={...changed,summary:{...changed.summary,updatedAt:'2026-10-10T00:00:00Z'}};
  const reader=new RecordCalendarReader(access([original],[],{loadHistorySession:async()=>stale}),fast);await reader.refresh('UTC');assert.equal(reader.getSnapshot().status,'failed');assert.equal(reader.getSnapshot().records.length,0);
  const wrongSegment=new RecordCalendarReader(access([], [segment()], {loadTrainingHistorySegment:async()=>segment('wrong')}),fast);await wrongSegment.refresh('UTC');assert.equal(wrongSegment.getSnapshot().status,'failed');
});

test('one corrupt list family does not prevent the other family and never claims a complete empty result',async()=>{
  for(const source of ['legacy','segment'] as const){
    const reader=new RecordCalendarReader(access([legacy()],[segment()],source==='legacy'?{listHistory:async()=>{throw Error('corrupt');}}:{listTrainingHistorySegments:async()=>{throw Error('corrupt');}}),fast);
    await reader.refresh('UTC');assert.equal(reader.getSnapshot().status,'partial');assert.equal(reader.getSnapshot().records.length,1);assert.equal(reader.getSnapshot().unreadableCount,1);
  }
  const reader=new RecordCalendarReader(access([],[],{listHistory:async()=>{throw Error('blocked');}}),fast);await reader.refresh('UTC');assert.equal(reader.getSnapshot().status,'failed');assert.notEqual(reader.getSnapshot().error,null);
});

test('malformed history entries remain explicit read issues and do not erase good sources',async()=>{
  const reader=new RecordCalendarReader(access([], [segment()],{listHistory:async()=>({...emptyLegacy,entries:[{status:'error',source:'legacy-training-v1',sessionId:null,updatedAt:null,error:{code:'invalid-record',message:'stored corruption'}}]})}),fast);
  await reader.refresh('UTC');assert.equal(reader.getSnapshot().status,'partial');assert.equal(reader.getSnapshot().unreadableCount,1);
});

test('repeated source pages/cursors and missing cursors terminate safely, never silently truncating',async()=>{
  const original=legacy();let calls=0;
  const reader=new RecordCalendarReader(access([original],[segment()],{listHistory:async()=>{calls++;return {...emptyLegacy,entries:[{status:'ready',summary:original.summary}],hasMore:true,nextCursor:{version:1,updatedAtMs:Date.parse(original.summary.updatedAt),key:'one'}};}}),fast);
  await reader.refresh('UTC');assert.equal(calls,2);assert.equal(reader.getSnapshot().status,'partial');assert.equal(reader.getSnapshot().records.length,2);
  const broken=new RecordCalendarReader(access([], [segment()],{listHistory:async()=>({...emptyLegacy,hasMore:true,nextCursor:null})}),fast);await broken.refresh('UTC');assert.equal(broken.getSnapshot().status,'partial');
  let partCalls=0;const part=segment();const repeat=new RecordCalendarReader(access([], [part],{listTrainingHistorySegments:async()=>{partCalls++;return {...emptySegments,entries:[summary(part)],hasMore:true,nextCursor:{version:1,startedAtMs:Date.parse(part.startedAt),segmentId:part.segmentId}};}}),fast);
  await repeat.refresh('UTC');assert.equal(partCalls,2);assert.equal(repeat.getSnapshot().status,'partial');
});

test('source selection rereads identical original data; same-sequence answer changes refuse old fallback',async()=>{
  let current=legacy();const base=access([current],[segment()]);
  const reader=new RecordCalendarReader({...base,loadHistorySession:async()=>current},fast);await reader.refresh('UTC');
  await reader.select('legacy-full:one');assert.equal(reader.getSnapshot().selected?.source,'legacy-full');
  current=legacy('one','2026-02-28T23:30:00Z','changed answer at same sequence');
  await reader.select('legacy-full:one');assert.equal(reader.getSnapshot().selected,null);assert.match(reader.getSnapshot().error!,/已更改/);
  await reader.select('partial-segment:one');assert.equal(reader.getSnapshot().selected?.source,'partial-segment');
});

test('segment generation, writer, fact text, existence and ID changes are refused on selection',async()=>{
  for(const transform of [
    (value:TrainingHistorySegment)=>({...value,generation:2}),
    (value:TrainingHistorySegment)=>({...value,writerInstanceId:'writer-two'}),
    (value:TrainingHistorySegment)=>({...value,facts:[{...value.facts[0],text:'changed text'}]} as TrainingHistorySegment),
    (value:TrainingHistorySegment)=>({...value,segmentId:'wrong'}),
    (_value:TrainingHistorySegment)=>null,
  ]){
    let current:TrainingHistorySegment|null=segment();const reader=new RecordCalendarReader(access([], [current], {loadTrainingHistorySegment:async()=>current}),fast);await reader.refresh('UTC');current=transform(current);
    await reader.select('partial-segment:one');assert.equal(reader.getSnapshot().selected,null);assert.match(reader.getSnapshot().error!,/安全核对/);
  }
});

test('later selection wins; back and dispose discard delayed success and failure',async()=>{
  for(const action of ['select','back','dispose'] as const){
    const full=legacy(),part=segment();let delayed=false;const gate=deferred<LegacyHistorySession|null>();
    const reader=new RecordCalendarReader(access([full],[part],{loadHistorySession:async()=>delayed?gate.promise:full}),fast);await reader.refresh('UTC');delayed=true;
    const old=reader.select('legacy-full:one');
    if(action==='select')await reader.select('partial-segment:one');else if(action==='back')reader.back();else reader.dispose();
    await old;gate.resolve(full);await Promise.resolve();
    assert.equal(reader.getSnapshot().selected?.source,action==='select'?'partial-segment':undefined);assert.equal(reader.getSnapshot().error,null);
  }
});

test('cancel returns while repository operation is pending and prevents later page or family reads',async()=>{
  const gate=deferred<LegacyHistoryList>();let reads=0,otherReads=0;
  const reader=new RecordCalendarReader(access([],[],{listHistory:async()=>{reads++;return gate.promise;},listTrainingHistorySegments:async()=>{otherReads++;return emptySegments;}}),fast);
  const work=reader.refresh('UTC');reader.cancel();await work;assert.equal(reader.getSnapshot().status,'cancelled');assert.equal(reads,1);assert.equal(otherReads,0);
  gate.reject(Error('late failure'));await Promise.resolve();assert.equal(reader.getSnapshot().status,'cancelled');
});

test('new time-zone refresh fences old pending results; back does not cancel a scan',async()=>{
  const gate=deferred<LegacyHistoryList>();const full=legacy();const base=access([full]);let calls=0;
  const reader=new RecordCalendarReader({...base,listHistory:async options=>++calls===1?gate.promise:base.listHistory(options)},fast);
  const old=reader.refresh('UTC');reader.back();assert.equal(reader.getSnapshot().status,'loading');
  await reader.refresh('Asia/Shanghai');await old;gate.resolve(emptyLegacy);await Promise.resolve();
  assert.equal(reader.getSnapshot().timeZone,'Asia/Shanghai');assert.deepEqual(reader.getSnapshot().records[0].days,['2026-03-01']);assert.equal(reader.getSnapshot().status,'loaded');
});

test('abort signals, reentrant listeners and development effect reconnect are fenced',async()=>{
  let reads=0;const base=access([legacy()]);const reader=new RecordCalendarReader({...base,listHistory:async options=>{reads++;return base.listHistory(options);}},fast);
  const stopped=new AbortController();stopped.abort();await reader.refresh('UTC',stopped.signal);assert.equal(reads,0);assert.equal(reader.getSnapshot().status,'cancelled');
  let once=true;reader.subscribe(()=>{if(once&&reader.getSnapshot().status==='loading'){once=false;reader.cancel();}});await reader.refresh('UTC');assert.equal(reads,0);
  reader.dispose();reader.activate();await reader.refresh('UTC');assert.equal(reader.getSnapshot().status,'loaded');assert.equal(reads,1);
});

test('large occurrence iteration yields and cancellation cannot retain a half-built raw source',async()=>{
  const part=segment('large',Array.from({length:200},()=> '2026-03-01T00:00:00Z'));let yields=0;
  let reader:RecordCalendarReader;reader=new RecordCalendarReader(access([], [part]),{yieldControl:async()=>{yields++;if(yields===2)reader.cancel();}});
  await reader.refresh('UTC');assert.equal(reader.getSnapshot().status,'cancelled');assert.equal(reader.getSnapshot().records.length,0);assert.equal(reader.getSnapshot().selected,null);assert.equal(yields,2);
});

test('invalid time zone fails without reads and readonly access invokes no mutation capability',async()=>{
  let reads=0;const base=access([legacy()]);
  const repository={...base,listHistory:async(options?:{limit?:number;after?:LegacyHistoryCursor|null})=>{reads++;return base.listHistory(options);},saveSession:()=>{throw Error('write forbidden');},reset:()=>{throw Error('engine forbidden');}};
  const reader=new RecordCalendarReader(repository,fast);await reader.refresh('bad-zone');assert.equal(reads,0);assert.equal(reader.getSnapshot().status,'failed');
  await reader.refresh('UTC');assert.equal(reader.getSnapshot().status,'loaded');await reader.select('legacy-full:one');assert.equal(reader.getSnapshot().selected?.source,'legacy-full');
});


test('production IndexedDB readers scan every page while OFF and leave all stores/settings byte-identical', async t => {
  const factory = new IDBFactory(), dbName = 'record-calendar-real-readonly';
  const full = Array.from({length: 102}, (_, i) => legacy(`full-${String(i).padStart(3, '0')}`));
  const parts = Array.from({length: 101}, (_, i) => segment(`part-${String(i).padStart(3, '0')}`));
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(dbName, 2);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('sessions', {keyPath: 'sessionId'});
      request.result.createObjectStore('events', {keyPath: 'eventId'});
      request.result.createObjectStore('meta', {keyPath: 'key'});
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  t.after(() => db.close());
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(['sessions', 'events', 'meta'], 'readwrite');
    for (const item of full) {
      transaction.objectStore('sessions').put({sessionId: item.snapshot.sessionId, sequence: item.snapshot.sequence, updatedAt: item.summary.updatedAt, snapshot: item.snapshot});
      for (const event of item.snapshot.events) transaction.objectStore('events').put(event);
    }
    for (const part of parts) transaction.objectStore('meta').put({key: `${TRAINING_HISTORY_SEGMENT_KEY_PREFIX}${part.segmentId}`, version: 1, segment: part, updatedAt: '2026-10-09T00:00:00Z'});
    transaction.objectStore('meta').put({key: 'automatic-history-control', version: 2, mode: 'segments', automaticHistoryEnabled: false, generation: 2});
    transaction.objectStore('meta').put({key: 'lastSessionId', value: 'full-101'});
    transaction.objectStore('meta').put({key: 'practice-canary', value: { untouched: true, score: 123 }});
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
  });
  const capture = () => new Promise<string>((resolve, reject) => {
    const stores = ['sessions', 'events', 'meta'], values: Record<string, unknown> = {};
    const transaction = db.transaction(stores, 'readonly');
    for (const store of stores) { const request = transaction.objectStore(store).getAll(); request.onsuccess = () => { values[store] = request.result; }; }
    transaction.oncomplete = () => resolve(JSON.stringify({version: db.version, stores: [...db.objectStoreNames], values})); transaction.onerror = () => reject(transaction.error);
  });
  const before = await capture();
  const repository = new IndexedDBTrainingRepository({indexedDB: factory, dbName}); t.after(() => repository.close());
  const reader = new RecordCalendarReader(repository, fast);
  await reader.refresh('UTC'); assert.equal(reader.getSnapshot().status, 'loaded'); assert.equal(reader.getSnapshot().records.length, 203);
  await reader.select('legacy-full:full-101'); assert.equal(reader.getSnapshot().selected?.source, 'legacy-full');
  await reader.select('partial-segment:part-100'); assert.equal(reader.getSnapshot().selected?.source, 'partial-segment');
  reader.back(); reader.dispose();
  assert.equal(await capture(), before); assert.equal(repository.getStatus().pendingWrites, 0);
});

test('readonly calendar of an absent database does not create schema or settings', async () => {
  const factory = new IDBFactory(), repository = new IndexedDBTrainingRepository({indexedDB: factory, dbName: 'absent-record-calendar'});
  const reader = new RecordCalendarReader(repository, fast);
  await reader.refresh('UTC'); assert.equal(reader.getSnapshot().status, 'loaded'); assert.deepEqual(await factory.databases(), []);
  reader.dispose(); repository.close();
});

test('selection fingerprint includes legacy saved metadata even when the snapshot is unchanged', async () => {
  let current = legacy();
  const reader = new RecordCalendarReader(access([current], [], {loadHistorySession: async () => current}), fast);
  await reader.refresh('UTC');
  current = {...current, summary: {...current.summary, updatedAt: '2026-10-10T00:00:00Z'}};
  await reader.select('legacy-full:one');
  assert.equal(reader.getSnapshot().selected, null); assert.match(reader.getSnapshot().error!, /已更改/);
});

test('changing time zone invalidates an in-flight original-record selection', async () => {
  const original = legacy(), gate = deferred<LegacyHistorySession | null>(); let delayed = false;
  const reader = new RecordCalendarReader(access([original], [], {loadHistorySession: async () => delayed ? gate.promise : original}), fast);
  await reader.refresh('UTC'); delayed = true;
  const selection = reader.select('legacy-full:one'); delayed = false;
  await reader.refresh('Asia/Shanghai'); await selection;
  gate.resolve(original); await Promise.resolve();
  assert.equal(reader.getSnapshot().selected, null); assert.equal(reader.getSnapshot().selecting, false);
  assert.equal(reader.getSnapshot().timeZone, 'Asia/Shanghai'); assert.deepEqual(reader.getSnapshot().records[0].days, ['2026-03-01']);
});

test('numeric submissions accumulate over source pages and a late conflicting event retracts earlier contribution',async()=>{
 const parts=Array.from({length:100},(_,i)=>{
  const p=segment(`part-${String(i).padStart(3,'0')}`);return {...p,sessionId:`session-${i}`,facts:[{sourceEventId:'request',ordinal:1,wallTime:'2026-03-01T00:30:00Z',cueId:'cue',type:'submitRequested' as const,attemptId:'attempt',retention:'recorded' as const,answer:'private submitted text'}]};
 });
 const conflict={...parts[0],segmentId:'zz-late-conflict',facts:parts[0].facts.map(f=>({...f,answer:'contradictory submitted text'}))};
 const reader=new RecordCalendarReader(access([],[...parts,conflict]),{...fast,yieldEvery:1});const values:number[]=[];
 reader.subscribe(()=>{const value=reader.getSnapshot().metrics.days.find(d=>d.day==='2026-03-01')?.submissions.value;if(value!==null&&value!==undefined)values.push(value)});
 await reader.refresh('UTC');const view=reader.getSnapshot();assert.equal(view.scannedRecords,101);assert.equal(view.status,'partial');assert.equal(view.metrics.conflictCount,1);assert.equal(view.metrics.days[0].submissions.value,99);assert.ok(values.includes(100));assert.doesNotMatch(JSON.stringify(view),/private submitted|contradictory submitted|answer|alignment/);
 reader.dispose();assert.deepEqual(reader.getSnapshot().metrics.days,[]);
});
test('numeric metrics merge full and partial identities while preserving safe source rereads',async()=>{
 let id=0;const engine=new TrainingEngine({sessionId:'metrics-full',clock:{now:()=>0,wallTime:()=> '2026-03-01T00:30:00Z',id:()=>`metrics-${++id}`}});engine.input('Could I have a coffee, please?');engine.submit();
 const snapshot=engine.getSnapshot(),full=readLegacyHistoryRecord({sessionId:snapshot.sessionId,sequence:snapshot.sequence,updatedAt:snapshot.createdAt,snapshot});
 const original=segment('partial-overlap'),request=snapshot.events.find(e=>e.type==='submitRequested')!;
 const partial={...original,sessionId:snapshot.sessionId,material:{id:snapshot.material.id,version:snapshot.material.version},facts:[{sourceEventId:request.eventId,ordinal:1,wallTime:request.wallTime,cueId:request.cueId,type:'submitRequested' as const,attemptId:request.type==='submitRequested'?request.attemptId:'',retention:'redacted' as const,redactionReason:'draft-predates-segment' as const}]};
 const reader=new RecordCalendarReader(access([full],[partial]),fast);await reader.refresh('UTC');const view=reader.getSnapshot(),day=view.metrics.days[0];
 assert.equal(view.status,'loaded');assert.equal(day.submissions.value,1);assert.equal(day.firstCompletions.value,1);assert.equal(day.matchedTerms.value,6);assert.equal(day.submissions.sourceEventIds[0].recordKeys.length,2);assert.doesNotMatch(JSON.stringify(view),/Could I|coffee|alignment/);
 await reader.select(day.submissions.sourceEventIds[0].recordKeys.find(key=>key.startsWith('partial-segment'))!);assert.equal(reader.getSnapshot().selected?.source,'partial-segment');
 await reader.refresh('America/Los_Angeles');assert.equal(reader.getSnapshot().metrics.days[0].day,'2026-02-28');assert.equal(reader.getSnapshot().selected,null);
});
