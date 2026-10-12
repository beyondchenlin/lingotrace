import {redactPracticeAttempt,replayPracticeEvents,validatePracticeSnapshot,type PracticeEvent,type PracticeSnapshot} from './practice';
import {canonicalJson,PracticeStorageConflict,type PracticeHead,type PracticeSaveReceipt} from './practice-repository';
import {exportPracticeSnapshot} from './practice-export';
import {normalizePracticeHistoryQuery,projectPracticeHistory,type PracticeHistoryQuery,type PracticeHistoryProjection} from './practice-history';

declare const permitBrand:unique symbol;
/** Opaque, immutable and owned by exactly one live repository instance. Never serialize. */
export type WritePermit=Readonly<{[permitBrand]:true}>;
declare const historyExportBrand:unique symbol;
/** Opaque, one-shot handle. The prepared JSON/CSV remains private to its repository. */
export type PreparedHistoryExport=Readonly<{[historyExportBrand]:true}>;
export interface HistoryExportPayload {readonly json:string;readonly csv:string}
export interface AttemptDeletionReceipt extends DeletionReceipt {attemptId:string;snapshot:PracticeSnapshot|null;permit:WritePermit|null;superseded:boolean}
export interface FencedPracticeStoreStatus {
  state:'idle'|'pending'|'saved'|'error';pending:number;error:string|null;readError:string|null;lastLoadedSequence:number|null;
  prepared:boolean;recordingEnabled:boolean;durableRecordingEnabled:boolean|null;
  settingsState:'unprepared'|'pending'|'persisted'|'not-persisted';settingsError:string|null;
  requiresNewRecordedSession:boolean;
}
export interface DeletionReceipt {sessionId:string;deleted:true;sessionGeneration:number;deletionWatermark:number}
export interface ClearReceipt {cleared:true;globalGeneration:number;clearWatermark:number}
interface Control {key:'recording';recordingEnabled:boolean;globalGeneration:number;deletionWatermark:number;clearWatermark:number}
interface Head extends PracticeHead {globalGeneration:number;sessionGeneration:number}
/** Minimal answer-free lineage. A deleted session ID can never be admitted again. */
interface Tombstone {sessionId:string;sessionGeneration:number;deletionWatermark:number}
/** Deliberately contains no original content, source, timing, or content hash. */
interface AttemptTombstone extends Tombstone {attemptId:string}
interface PermitContext {sessionId:string;pageEpoch:number;sessionEpoch:number;globalGeneration:number;sessionGeneration:number}
interface ExportBoundary {globalGeneration:number;deletionWatermark:number;clearWatermark:number;head:Head}
interface ExportContext {sessionId:string;epoch:number;sessionEpoch:number;valid:boolean;boundary:ExportBoundary|null;payload:HistoryExportPayload|null}
type Guard=(work:()=>void)=>void;
const legacyStores=['control','tombstones','heads','events'];
const allStores=[...legacyStores,'attemptTombstones'];
const message=(error:unknown)=>error instanceof Error?error.message:'Isolated practice storage failed.';
function devOnly(){if(process.env.NODE_ENV==='production')throw new Error('Practice data batch2A is disabled in production.');}
function stableId(id:string){if(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)||['constructor','prototype','__proto__'].includes(id))throw new Error('Invalid stable session ID.');}
function next(value:number){if(!Number.isSafeInteger(value)||value<0||value===Number.MAX_SAFE_INTEGER)throw new Error('Invalid or exhausted deletion generation.');return value+1;}
function controlValue(value:Control|undefined):Control {
  if(!value||value.key!=='recording'||typeof value.recordingEnabled!=='boolean'||![value.globalGeneration,value.deletionWatermark,value.clearWatermark].every(n=>Number.isSafeInteger(n)&&n>=0))throw new Error('Missing or invalid durable recording control.');
  return value;
}
export class PracticeWriteFenceError extends Error {
  constructor(message='Practice write permit was revoked; a new recorded session is required.'){super(message);this.name='PracticeWriteFenceError';}
}

/** Isolated development-only fences. Upgrades only this namespace's v1 schema;
 * there is no controller/engine subscription or legacy application migration. */
export class FencedPracticeRepository {
  readonly databaseName:string;
  private readonly factory:IDBFactory|undefined;
  private readonly initialRecordingEnabled:boolean;
  private readonly exportFormatter:(snapshot:PracticeSnapshot,exportedAt:string)=>Promise<HistoryExportPayload>;
  private database:Promise<IDBDatabase>|null=null;
  private preparation:Promise<FencedPracticeStoreStatus>|null=null;
  private tail:Promise<void>=Promise.resolve();
  private prepared=false;
  private closed=false;
  private pageEnabled=false;
  private pageEpoch=0;
  private settingOperation=0;
  private operation=0;
  private readonly sessionEpochs=new Map<string,number>();
  private readonly usedIds=new Set<string>();
  private readonly blockedIds=new Set<string>();
  private readonly permits=new WeakMap<object,PermitContext>();
  private readonly activeWrites=new Set<{tx:IDBTransaction;sessionId:string}>();
  private historyProjectionEpoch=0;
  private exportEpoch=0;
  private readonly sessionExportEpochs=new Map<string,number>();
  private readonly exportHandles=new WeakMap<object,ExportContext>();
  private readonly activeExports=new Set<ExportContext>();
  private readonly listeners=new Set<()=>void>();
  private state:FencedPracticeStoreStatus=Object.freeze({state:'idle',pending:0,error:null,readError:null,lastLoadedSequence:null,prepared:false,recordingEnabled:false,durableRecordingEnabled:null,settingsState:'unprepared',settingsError:null,requiresNewRecordedSession:true});
  constructor(options:{databaseName:string;indexedDB?:IDBFactory;initialRecordingEnabled?:boolean;exportFormatter?:(snapshot:PracticeSnapshot,exportedAt:string)=>Promise<HistoryExportPayload>}){
    devOnly();
    if(!options||!/^lingotrace-dev-fenced-[A-Za-z0-9_-]+$/.test(options.databaseName))throw new Error('An explicit isolated lingotrace-dev-fenced-* database is required.');
    if(options.initialRecordingEnabled!==undefined&&typeof options.initialRecordingEnabled!=='boolean')throw new Error('Initial recording preference must be boolean.');
    if(options.exportFormatter!==undefined&&typeof options.exportFormatter!=='function')throw new Error('Export formatter must be a function.');
    this.databaseName=options.databaseName;this.factory=options.indexedDB??globalThis.indexedDB;this.initialRecordingEnabled=options.initialRecordingEnabled===true;
    this.exportFormatter=options.exportFormatter??(async(snapshot,exportedAt)=>{const{json,csv}=exportPracticeSnapshot(snapshot,exportedAt);return{json,csv};});
  }
  getStatus=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private status(patch:Partial<FencedPracticeStoreStatus>){
    this.state=Object.freeze({...this.state,...patch});
    // Observer failures must never turn a committed transaction into an apparent failure.
    for(const listener of this.listeners){try{listener();}catch{/* Subscribers own their errors. */}}
  }
  private abortWrites(sessionId?:string){for(const item of this.activeWrites)if(sessionId===undefined||item.sessionId===sessionId){try{item.tx.abort();}catch{/* Already committed/aborted. */}}}
  private invalidateExports(sessionId?:string){
    this.historyProjectionEpoch++;
    if(sessionId===undefined)this.exportEpoch++;else this.sessionExportEpochs.set(sessionId,(this.sessionExportEpochs.get(sessionId)??0)+1);
    for(const context of this.activeExports)if(sessionId===undefined||context.sessionId===sessionId){context.valid=false;context.payload=null;context.boundary=null;this.activeExports.delete(context);}
  }
  private assertOpen(){devOnly();if(this.closed)throw new PracticeWriteFenceError('This repository is closed.');}
  private open():Promise<IDBDatabase>{
    try{this.assertOpen();}catch(error){return Promise.reject(error);}
    if(this.database)return this.database;
    this.database=new Promise<IDBDatabase>((resolve,reject)=>{
      if(!this.factory){reject(new Error('IndexedDB unavailable; no durable change occurred.'));return;}
      const request=this.factory.open(this.databaseName,2);let rejected=false;
      request.onupgradeneeded=event=>{try{
        if(rejected||this.closed)throw new Error('Isolated storage opening was canceled.');
        const db=request.result;
        if(event.oldVersion===0){
          const events=db.createObjectStore('events',{keyPath:['sessionId','sequence']});
          events.createIndex('bySession','sessionId');events.createIndex('byEventId',['sessionId','eventId'],{unique:true});
          db.createObjectStore('heads',{keyPath:'sessionId'});db.createObjectStore('tombstones',{keyPath:'sessionId'});
          db.createObjectStore('control',{keyPath:'key'}).add({key:'recording',recordingEnabled:this.initialRecordingEnabled,globalGeneration:0,deletionWatermark:0,clearWatermark:0} satisfies Control);
        }else if(event.oldVersion!==1||!legacyStores.every(name=>db.objectStoreNames.contains(name)))throw new Error('Unexpected fenced database schema.');
        // The upgrade transaction preserves every old fact in place; no second
        // database or answer-bearing migration copy is created.
        db.createObjectStore('attemptTombstones',{keyPath:['sessionId','attemptId']}).createIndex('bySession','sessionId');
      }catch(error){rejected=true;reject(error);request.transaction?.abort();}};
      request.onerror=()=>{rejected=true;reject(request.error??new Error('Could not open isolated storage.'));};
      request.onblocked=()=>{rejected=true;reject(new Error('Isolated database is blocked by another connection.'));};
      request.onsuccess=()=>{
        const db=request.result;if(rejected||this.closed){db.close();reject(new Error('Isolated storage opening was canceled.'));return;}
        if(!allStores.every(name=>db.objectStoreNames.contains(name))){db.close();reject(new Error('Unexpected fenced database schema.'));return;}
        db.onversionchange=()=>{db.close();this.database=null;this.pageEnabled=false;this.pageEpoch++;this.abortWrites();this.invalidateExports();this.status({recordingEnabled:false,requiresNewRecordedSession:true});};
        resolve(db);
      };
    }).catch(error=>{this.database=null;throw error;});
    return this.database;
  }
  private enqueue<T>(job:()=>Promise<T>,pendingStatus:Partial<FencedPracticeStoreStatus>={}):Promise<T>{
    const ticket=++this.operation;
    const work=this.tail.then(job).then(value=>{
      this.status({pending:Math.max(0,this.state.pending-1),...(ticket===this.operation?{state:'saved' as const,error:null}:{})});return value;
    },error=>{this.status({pending:Math.max(0,this.state.pending-1),...(ticket===this.operation?{state:'error' as const,error:message(error)}:{})});throw error;});
    // Reserve our durable order BEFORE notifying arbitrary, potentially reentrant
    // observers. A newer intent from a subscriber must queue after this operation.
    this.tail=work.then(()=>{},()=>{});
    this.status({pending:this.state.pending+1,state:'pending',error:null,...pendingStatus});return work;
  }
  private fail<T>(error:unknown):Promise<T>{++this.operation;this.status({state:'error',error:message(error)});return Promise.reject(error);}
  private transact<T>(db:IDBDatabase,stores:string[],mode:IDBTransactionMode,work:(tx:IDBTransaction,guard:Guard,result:(value:T)=>void)=>void,sessionId?:string):Promise<T>{
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(stores,mode);let failure:unknown,result:T,ready=false;
      const active=sessionId===undefined?null:{tx,sessionId};if(active)this.activeWrites.add(active);
      const cleanup=()=>{if(active)this.activeWrites.delete(active);};
      const guard:Guard=callback=>{try{callback();}catch(error){failure=error;try{tx.abort();}catch{/* Transaction already failed. */}}};
      tx.oncomplete=()=>{cleanup();if(ready)resolve(result);else reject(new Error('Transaction completed without a result.'));};
      tx.onabort=tx.onerror=()=>{cleanup();reject(failure??tx.error??new PracticeWriteFenceError('Practice transaction aborted; no durable change occurred.'));};
      guard(()=>work(tx,guard,value=>{result=value;ready=true;}));
    });
  }
  /** All these requests belong to the SAME transaction that will write the facts/head. */
  private boundary(tx:IDBTransaction,id:string,guard:Guard,ready:(control:Control,head:Head|undefined,tombstone:Tombstone|undefined,events:PracticeEvent[],attempts:AttemptTombstone[])=>void){
    const requests=[tx.objectStore('control').get('recording'),tx.objectStore('heads').get(id),tx.objectStore('tombstones').get(id),tx.objectStore('events').index('bySession').getAll(id),tx.objectStore('attemptTombstones').index('bySession').getAll(id)];
    let count=requests.length;
    for(const request of requests)request.onsuccess=()=>guard(()=>{if(--count===0)ready(controlValue(requests[0].result),requests[1].result,requests[2].result,requests[3].result.sort((a:PracticeEvent,b:PracticeEvent)=>a.sequence-b.sequence),requests[4].result);});
  }
  private assertPage(epoch:number,id:string,sessionEpoch:number){
    this.assertOpen();
    if(!this.prepared||!this.pageEnabled||epoch!==this.pageEpoch||sessionEpoch!==(this.sessionEpochs.get(id)??0)||this.blockedIds.has(id))throw new PracticeWriteFenceError();
  }
  private assertHead(id:string,head:Head|undefined,events:PracticeEvent[]):asserts head is Head {
    if(!head||head.sessionId!==id||head.eventCount!==events.length||head.sequence!==events.at(-1)?.sequence||!Number.isSafeInteger(head.sessionGeneration)||head.sessionGeneration<0||!Number.isSafeInteger(head.globalGeneration)||head.globalGeneration<0)throw new PracticeWriteFenceError('Missing or invalid session head; save cannot recreate a session.');
  }
  private canonicalSnapshot(id:string,head:Head|undefined,events:PracticeEvent[],attempts:AttemptTombstone[]):PracticeSnapshot{
    this.assertHead(id,head,events);const snapshot=replayPracticeEvents(events);
    if(snapshot.sessionId!==id||snapshot.sequence!==head.sequence||snapshot.schemaVersion!==head.schemaVersion)throw new Error('Practice head does not match its canonical facts.');
    const targets=snapshot.projections.redaction?.targets??[];
    if(targets.length!==attempts.length)throw new PracticeWriteFenceError('Attempt deletion lineage does not match canonical facts.');
    for(const row of attempts){
      if(canonicalJson(Object.keys(row).sort())!==canonicalJson(['attemptId','deletionWatermark','sessionGeneration','sessionId'])||row.sessionId!==id||!Number.isSafeInteger(row.sessionGeneration)||row.sessionGeneration<=0||row.sessionGeneration>head.sessionGeneration||!Number.isSafeInteger(row.deletionWatermark)||row.deletionWatermark<=0||!targets.some(target=>target.attemptId===row.attemptId))throw new PracticeWriteFenceError('Invalid attempt deletion lineage.');
    }
    return snapshot;
  }
  prepare():Promise<FencedPracticeStoreStatus>{
    if(this.prepared)return Promise.resolve(this.state);
    if(this.preparation)return this.preparation;
    const setting=++this.settingOperation;
    this.preparation=this.enqueue(async()=>{
      const db=await this.open();
      const control=await this.transact<Control>(db,['control'],'readonly',(tx,guard,result)=>{const read=tx.objectStore('control').get('recording');read.onsuccess=()=>guard(()=>result(controlValue(read.result)));});
      this.prepared=true;
      if(setting===this.settingOperation&&!this.closed){this.pageEnabled=control.recordingEnabled;this.status({prepared:true,recordingEnabled:this.pageEnabled,durableRecordingEnabled:control.recordingEnabled,settingsState:'persisted',settingsError:null});}
      else this.status({prepared:true});
      return this.state;
    }).then(()=>this.state).catch(error=>{this.preparation=null;throw error;});
    return this.preparation;
  }
  beginRecordedSession(initialSnapshot:PracticeSnapshot):Promise<WritePermit>{
    let captured:PracticeSnapshot;const epoch=this.pageEpoch;
    try{
      captured=validatePracticeSnapshot(initialSnapshot);stableId(captured.sessionId);
      const previouslyUsed=this.usedIds.has(captured.sessionId);this.usedIds.add(captured.sessionId);
      if(!this.pageEnabled)this.blockedIds.add(captured.sessionId);
      this.assertPage(epoch,captured.sessionId,this.sessionEpochs.get(captured.sessionId)??0);
      if(captured.sequence!==1||captured.events.length!==1||captured.events[0].payload.type!=='sessionStarted'||previouslyUsed)throw new PracticeWriteFenceError('A fresh sessionStarted-only snapshot with a never-used ID is required; off-period practice cannot be backfilled.');
    }catch(error){return this.fail(error);}
    const sessionEpoch=this.sessionEpochs.get(captured.sessionId)??0;
    return this.enqueue(async()=>{
      this.assertPage(epoch,captured.sessionId,sessionEpoch);const db=await this.open();this.assertPage(epoch,captured.sessionId,sessionEpoch);
      const context=await this.transact<PermitContext>(db,allStores,'readwrite',(tx,guard,result)=>{
        this.boundary(tx,captured.sessionId,guard,(control,head,tombstone,events,attempts)=>{
          this.assertPage(epoch,captured.sessionId,sessionEpoch);
          if(!control.recordingEnabled)throw new PracticeWriteFenceError('Durable recording is disabled.');
          if(head||tombstone||events.length||attempts.length)throw new PracticeWriteFenceError('Session ID already exists or was deleted; a new recorded session is required.');
          const context={sessionId:captured.sessionId,pageEpoch:epoch,sessionEpoch,globalGeneration:control.globalGeneration,sessionGeneration:0};
          tx.objectStore('events').add(captured.events[0]);
          tx.objectStore('heads').add({sessionId:captured.sessionId,schemaVersion:captured.schemaVersion,sequence:1,eventCount:1,globalGeneration:context.globalGeneration,sessionGeneration:0} satisfies Head);result(context);
        });
      },captured.sessionId);
      // Off/delete can run between commit and this callback. Never issue a renewed permit.
      this.assertPage(epoch,captured.sessionId,sessionEpoch);
      const permit=Object.freeze({}) as WritePermit;this.permits.set(permit,context);this.status({requiresNewRecordedSession:false});this.assertPage(epoch,captured.sessionId,sessionEpoch);return permit;
    });
  }
  save(snapshot:PracticeSnapshot,permit:WritePermit):Promise<PracticeSaveReceipt>{
    let captured:PracticeSnapshot,context:PermitContext;
    try{
      captured=validatePracticeSnapshot(snapshot);
      this.usedIds.add(captured.sessionId);if(!this.pageEnabled)this.blockedIds.add(captured.sessionId);
      const stored=permit&&typeof permit==='object'?this.permits.get(permit):undefined;
      if(!stored||stored.sessionId!==captured.sessionId)throw new PracticeWriteFenceError('Unknown or wrong-session write permit.');context=stored;
      this.assertPage(context.pageEpoch,context.sessionId,context.sessionEpoch);
    }catch(error){return this.fail(error);}
    return this.enqueue(async()=>{
      this.assertPage(context.pageEpoch,context.sessionId,context.sessionEpoch);const db=await this.open();this.assertPage(context.pageEpoch,context.sessionId,context.sessionEpoch);
      const receipt=await this.transact<PracticeSaveReceipt>(db,allStores,'readwrite',(tx,guard,result)=>{
        this.boundary(tx,captured.sessionId,guard,(control,head,tombstone,events,attempts)=>{
          this.assertPage(context.pageEpoch,context.sessionId,context.sessionEpoch);
          if(!control.recordingEnabled||control.globalGeneration!==context.globalGeneration||tombstone)throw new PracticeWriteFenceError('Durable recording or deletion generation revoked this permit.');
          this.assertHead(context.sessionId,head,events);
          if(head.globalGeneration!==context.globalGeneration||head.sessionGeneration!==context.sessionGeneration||head.schemaVersion!==captured.schemaVersion)throw new PracticeWriteFenceError('Session generation changed.');
          const durable=this.canonicalSnapshot(context.sessionId,head,events,attempts);
          if(canonicalJson(durable.projections.redaction?.targets??[])!==canonicalJson(captured.projections.redaction?.targets??[]))throw new PracticeWriteFenceError('Only deleteAttempt can change attempt deletion lineage.');
          for(let i=0;i<Math.min(events.length,captured.events.length);i++)if(canonicalJson(events[i])!==canonicalJson(captured.events[i]))throw new PracticeStorageConflict();
          if(events.length>=captured.events.length){result({sessionId:captured.sessionId,storedSequence:head.sequence,disposition:events.length===captured.events.length?'already-present':'newer-preserved'});return;}
          for(const event of captured.events.slice(events.length))tx.objectStore('events').add(event);
          tx.objectStore('heads').put({...head,sequence:captured.sequence,eventCount:captured.events.length});
          result({sessionId:captured.sessionId,storedSequence:captured.sequence,disposition:'appended'});
        });
      },captured.sessionId);
      this.assertPage(context.pageEpoch,context.sessionId,context.sessionEpoch);return receipt;
    });
  }
  setRecordingEnabled(enabled:boolean):Promise<FencedPracticeStoreStatus>{
    if(typeof enabled!=='boolean')return this.fail(new Error('Recording preference must be boolean.'));
    const setting=++this.settingOperation;
    // Synchronous page fence, before queued work, I/O or status listeners can run.
    this.pageEnabled=false;this.pageEpoch++;this.abortWrites();
    return this.enqueue(async()=>{
      try{
        if(!this.prepared)throw new PracticeWriteFenceError('Call prepare before changing recording preference.');
        const db=await this.open();
        const updated=await this.transact<Control>(db,['control'],'readwrite',(tx,guard,result)=>{
          const store=tx.objectStore('control'),read=store.get('recording');
          read.onsuccess=()=>guard(()=>{const before=controlValue(read.result);const after={...before,recordingEnabled:enabled,globalGeneration:next(before.globalGeneration)};store.put(after);result(after);});
        });
        if(setting===this.settingOperation&&!this.closed){this.pageEnabled=enabled;this.status({recordingEnabled:enabled,durableRecordingEnabled:updated.recordingEnabled,settingsState:'persisted',settingsError:null});}
        return this.state;
      }catch(error){
        if(setting===this.settingOperation){this.pageEnabled=false;this.status({recordingEnabled:false,settingsState:'not-persisted',settingsError:`Recording setting was not persisted; this page stays OFF. No other-tab or reload guarantee: ${message(error)}`});}
        throw error;
      }
    },{recordingEnabled:false,requiresNewRecordedSession:true,settingsState:'pending',settingsError:null}).then(()=>this.state);
  }
  deleteSession(sessionId:string):Promise<DeletionReceipt>{
    try{stableId(sessionId);}catch(error){return this.fail(error);}
    this.blockedIds.add(sessionId);this.sessionEpochs.set(sessionId,(this.sessionEpochs.get(sessionId)??0)+1);this.abortWrites(sessionId);this.invalidateExports(sessionId);
    return this.enqueue(async()=>{
      const db=await this.open();
      return this.transact<DeletionReceipt>(db,allStores,'readwrite',(tx,guard,result)=>{
        this.boundary(tx,sessionId,guard,(control,head,tombstone,events,attempts)=>{
          const deletionWatermark=next(control.deletionWatermark),sessionGeneration=next(tombstone?.sessionGeneration??head?.sessionGeneration??0);
          tx.objectStore('control').put({...control,deletionWatermark});
          for(const event of events)tx.objectStore('events').delete([sessionId,event.sequence]);
          for(const attempt of attempts)tx.objectStore('attemptTombstones').delete([sessionId,attempt.attemptId]);
          tx.objectStore('heads').delete(sessionId);
          tx.objectStore('tombstones').put({sessionId,sessionGeneration,deletionWatermark} satisfies Tombstone);
          result({sessionId,deleted:true,sessionGeneration,deletionWatermark});
        });
      });
    },{requiresNewRecordedSession:true});
  }
  /** Captured live facts may extend the durable prefix only under the permit
   * that was valid immediately BEFORE this synchronous deletion fence. */
  deleteAttempt(options:{sessionId:string;attemptId:string;redactionId:string;liveSnapshot?:PracticeSnapshot;permit?:WritePermit}):Promise<AttemptDeletionReceipt>{
    let sessionId:string,attemptId:string,redactionId:string;
    try{({sessionId,attemptId,redactionId}=options);stableId(sessionId);stableId(attemptId);stableId(redactionId);}catch(error){return this.fail(error);}
    const pageEpoch=this.pageEpoch,oldSessionEpoch=this.sessionEpochs.get(sessionId)??0;
    const previous=options.permit&&typeof options.permit==='object'?this.permits.get(options.permit):undefined;
    const context=previous?{...previous}:undefined;
    const wasWritable=this.prepared&&this.pageEnabled&&!this.closed&&!this.blockedIds.has(sessionId);
    const sessionEpoch=oldSessionEpoch+1;
    // Fence before validation, queue notifications, database work, or any await.
    this.sessionEpochs.set(sessionId,sessionEpoch);this.abortWrites(sessionId);this.invalidateExports(sessionId);
    const historyEpoch=this.exportEpoch,historySessionEpoch=this.sessionExportEpochs.get(sessionId)??0;
    let live:PracticeSnapshot|undefined;
    try{
      this.assertOpen();
      if(options.liveSnapshot!==undefined){live=validatePracticeSnapshot(options.liveSnapshot);if(live.sessionId!==sessionId)throw new PracticeWriteFenceError('Live snapshot belongs to another session.');}
    }catch(error){return this.fail(error);}
    return this.enqueue(async()=>{
      const db=await this.open();
      const committed=await this.transact<{snapshot:PracticeSnapshot;context:PermitContext;deletionWatermark:number;renewAllowed:boolean}>(db,allStores,'readwrite',(tx,guard,result)=>{
        this.boundary(tx,sessionId,guard,(control,head,tombstone,events,attempts)=>{
          this.assertOpen();
          if(tombstone)throw new PracticeWriteFenceError('Deleted parent session cannot be recreated.');
          this.assertHead(sessionId,head,events);
          let snapshot=this.canonicalSnapshot(sessionId,head,events,attempts);
          const permitContext={sessionId,pageEpoch,sessionEpoch,globalGeneration:control.globalGeneration,sessionGeneration:head.sessionGeneration};
          // Erasing saved history never admits that session for recording.
          // Continuation can only preserve authority from the caller's permit
          // that was valid immediately before this operation revoked it.
          const renewAllowed=wasWritable&&context!==undefined&&context.sessionId===sessionId&&context.pageEpoch===pageEpoch&&context.sessionEpoch===oldSessionEpoch&&context.globalGeneration===control.globalGeneration&&context.sessionGeneration===head.sessionGeneration&&head.globalGeneration===context.globalGeneration&&control.recordingEnabled;
          // A retry returns the current canonical state even if its old captured
          // input predates the first deletion. It never appends that input.
          if(attempts.some(row=>row.attemptId===attemptId)){
            result({snapshot,context:permitContext,deletionWatermark:control.deletionWatermark,renewAllowed});return;
          }
          if(live){
            for(let i=0;i<Math.min(events.length,live.events.length);i++)if(canonicalJson(events[i])!==canonicalJson(live.events[i]))throw new PracticeStorageConflict();
            if(live.events.length>events.length){
              this.assertPage(pageEpoch,sessionId,sessionEpoch);
              if(!renewAllowed)throw new PracticeWriteFenceError('The captured live tail has no current recorded-session permit.');
              if(canonicalJson(snapshot.projections.redaction?.targets??[])!==canonicalJson(live.projections.redaction?.targets??[]))throw new PracticeWriteFenceError('Captured live facts cannot introduce attempt deletion lineage.');
              const active={tx,sessionId};this.activeWrites.add(active);
              const cleanup=()=>this.activeWrites.delete(active);tx.addEventListener('complete',cleanup,{once:true});tx.addEventListener('abort',cleanup,{once:true});
              snapshot=live;
            }
            // An older exact prefix intentionally leaves all newer durable facts.
          }
          const occupied=new Set(snapshot.events.map(event=>event.eventId));
          const eventId=()=>{let id:string;do{id=`redaction-${globalThis.crypto?.randomUUID?.()??`${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`}`;}while(occupied.has(id));occupied.add(id);return id;};
          const redacted=redactPracticeAttempt(snapshot,{attemptId,redactionId,eventId});
          const sessionGeneration=next(head.sessionGeneration),deletionWatermark=next(control.deletionWatermark);
          const nextHead:Head={sessionId,schemaVersion:redacted.schemaVersion,sequence:redacted.sequence,eventCount:redacted.events.length,globalGeneration:control.globalGeneration,sessionGeneration};
          for(const event of events)tx.objectStore('events').delete([sessionId,event.sequence]);
          for(const event of redacted.events)tx.objectStore('events').add(event);
          tx.objectStore('heads').put(nextHead);
          tx.objectStore('attemptTombstones').put({sessionId,attemptId,sessionGeneration,deletionWatermark} satisfies AttemptTombstone);
          tx.objectStore('control').put({...control,deletionWatermark});
          result({snapshot:redacted,context:{...permitContext,sessionGeneration},deletionWatermark,renewAllowed});
        });
      });
      // A later OFF, delete, clear, or close must not turn a committed erasure
      // into a failed deletion. It only prevents issuing the continuation permit.
      const renewal=await this.renewAfterDeletion(db,committed.context,committed.renewAllowed);
      return{sessionId,attemptId,deleted:true as const,sessionGeneration:committed.context.sessionGeneration,deletionWatermark:committed.deletionWatermark,snapshot:renewal.superseded?null:committed.snapshot,permit:renewal.permit,superseded:renewal.superseded};
    },{requiresNewRecordedSession:true}).then(receipt=>{
      // Enqueue's completion notification can itself synchronously request a
      // later deletion. Check AFTER that notification before releasing facts.
      if(!this.historyCurrent(sessionId,historyEpoch,historySessionEpoch))return{...receipt,snapshot:null,permit:null,superseded:true};
      return receipt;
    });
  }
  private async renewAfterDeletion(db:IDBDatabase,context:PermitContext,renewAllowed:boolean):Promise<{permit:WritePermit|null;superseded:boolean}>{
    let current=false;
    try{
      this.assertOpen();
      const checked=await this.transact<{current:boolean;eligible:boolean}>(db,['control','heads','tombstones'],'readonly',(tx,guard,result)=>{
        const control=tx.objectStore('control').get('recording'),head=tx.objectStore('heads').get(context.sessionId),tombstone=tx.objectStore('tombstones').get(context.sessionId);let pending=3;
        const ready=()=>guard(()=>{if(--pending)return;
          const durable=controlValue(control.result),stored=head.result as Head|undefined;
          const unchanged=!tombstone.result&&stored?.sessionGeneration===context.sessionGeneration;
          result({current:unchanged,eligible:renewAllowed&&unchanged&&durable.recordingEnabled&&durable.globalGeneration===context.globalGeneration&&stored?.globalGeneration===context.globalGeneration});
        });control.onsuccess=head.onsuccess=tombstone.onsuccess=ready;
      });
      current=checked.current;if(!current)return{permit:null,superseded:true};
      this.assertPage(context.pageEpoch,context.sessionId,context.sessionEpoch);
      if(!checked.eligible)return{permit:null,superseded:false};
      const permit=Object.freeze({}) as WritePermit;this.permits.set(permit,context);
      this.status({requiresNewRecordedSession:false});this.assertPage(context.pageEpoch,context.sessionId,context.sessionEpoch);return{permit,superseded:false};
    }catch{return{permit:null,superseded:!current};}
  }
  clearPracticeData():Promise<ClearReceipt>{
    this.pageEpoch++;this.abortWrites();this.invalidateExports();
    return this.enqueue(async()=>{
      const db=await this.open();
      return this.transact<ClearReceipt>(db,allStores,'readwrite',(tx,guard,result)=>{
        const control=tx.objectStore('control').get('recording'),heads=tx.objectStore('heads').getAll(),tombstones=tx.objectStore('tombstones').getAll(),eventKeys=tx.objectStore('events').getAllKeys(),attemptKeys=tx.objectStore('attemptTombstones').getAllKeys();let count=5;
        const ready=()=>guard(()=>{if(--count)return;
          const before=controlValue(control.result),globalGeneration=next(before.globalGeneration),deletionWatermark=next(before.deletionWatermark),clearWatermark=next(before.clearWatermark);
          const prior=new Map<string,Tombstone>((tombstones.result as Tombstone[]).map(row=>[row.sessionId,row]));
          const generations=new Map<string,number>((heads.result as Head[]).map(head=>[head.sessionId,head.sessionGeneration]));
          for(const key of [...eventKeys.result,...attemptKeys.result]){
            if(!Array.isArray(key)||typeof key[0]!=='string')throw new Error('Unexpected practice fact key.');
            if(!generations.has(key[0]))generations.set(key[0],0);
          }
          for(const [sessionId,generation] of generations)tx.objectStore('tombstones').put({sessionId,sessionGeneration:next(Math.max(generation,prior.get(sessionId)?.sessionGeneration??0)),deletionWatermark} satisfies Tombstone);
          tx.objectStore('events').clear();tx.objectStore('heads').clear();tx.objectStore('attemptTombstones').clear();
          tx.objectStore('control').put({...before,globalGeneration,deletionWatermark,clearWatermark});
          result({cleared:true,globalGeneration,clearWatermark});
        });
        control.onsuccess=heads.onsuccess=tombstones.onsuccess=eventKeys.onsuccess=attemptKeys.onsuccess=ready;
      });
    },{requiresNewRecordedSession:true});
  }
  async load(sessionId:string):Promise<PracticeSnapshot|null>{
    const epoch=this.exportEpoch,sessionEpoch=this.sessionExportEpochs.get(sessionId)??0;
    const check=()=>{this.assertOpen();if(!this.historyCurrent(sessionId,epoch,sessionEpoch))throw new PracticeWriteFenceError('History read was invalidated by deletion, clear, or close.');};
    try{
      stableId(sessionId);check();await this.tail;check();const db=await this.open();check();
      const snapshot=await this.transact<PracticeSnapshot|null>(db,allStores,'readonly',(tx,guard,result)=>{
        this.boundary(tx,sessionId,guard,(_control,head,tombstone,events,attempts)=>{
          if(tombstone){if(head||events.length||attempts.length)throw new Error('Deleted session still contains facts.');result(null);return;}
          if(!head&&!events.length&&!attempts.length){result(null);return;}
          result(this.canonicalSnapshot(sessionId,head,events,attempts));
        });
      });
      check();this.status({readError:null,lastLoadedSequence:snapshot?.sequence??null});check();return snapshot;
    }catch(error){this.status({readError:message(error)});throw error;}
  }
  private historyCurrent(sessionId:string,epoch:number,sessionEpoch:number){return!this.closed&&epoch===this.exportEpoch&&sessionEpoch===(this.sessionExportEpochs.get(sessionId)??0);}
  private assertExport(context:ExportContext){
    this.assertOpen();
    if(!context.valid||!this.historyCurrent(context.sessionId,context.epoch,context.sessionEpoch))throw new PracticeWriteFenceError('Prepared history export was invalidated by deletion, clear, or close.');
  }
  private exportCheck(tx:IDBTransaction,context:ExportContext,guard:Guard,ready:()=>void){
    const control=tx.objectStore('control').get('recording'),head=tx.objectStore('heads').get(context.sessionId),tombstone=tx.objectStore('tombstones').get(context.sessionId);let pending=3;
    const checked=()=>guard(()=>{if(--pending)return;
      this.assertExport(context);const current=controlValue(control.result),boundary=context.boundary;
      if(!boundary||tombstone.result||!head.result||current.globalGeneration!==boundary.globalGeneration||current.deletionWatermark!==boundary.deletionWatermark||current.clearWatermark!==boundary.clearWatermark||canonicalJson(head.result)!==canonicalJson(boundary.head))throw new PracticeWriteFenceError('Durable history changed after export preparation.');
      ready();
    });control.onsuccess=head.onsuccess=tombstone.onsuccess=checked;
  }
  /** Prepare from current repository facts, never from a caller-owned snapshot.
   * Formatting is outside the queue so deletion can proceed while it is pending. */
  async prepareHistoryExport(sessionId:string,exportedAt:string):Promise<PreparedHistoryExport>{
    this.assertOpen();stableId(sessionId);
    if(typeof exportedAt!=='string'||!Number.isFinite(Date.parse(exportedAt)))throw new Error('An explicit valid export timestamp is required.');
    const context:ExportContext={sessionId,epoch:this.exportEpoch,sessionEpoch:this.sessionExportEpochs.get(sessionId)??0,valid:true,boundary:null,payload:null};
    this.activeExports.add(context);
    let snapshot:PracticeSnapshot|null=null,payload:HistoryExportPayload|null=null;
    try{
      await this.tail;this.assertExport(context);const db=await this.open();this.assertExport(context);
      snapshot=await this.transact<PracticeSnapshot>(db,allStores,'readonly',(tx,guard,result)=>{
        this.boundary(tx,sessionId,guard,(control,head,tombstone,events,attempts)=>{
          this.assertExport(context);if(tombstone)throw new PracticeWriteFenceError('Deleted history cannot be exported.');
          const canonical=this.canonicalSnapshot(sessionId,head,events,attempts);
          context.boundary={globalGeneration:control.globalGeneration,deletionWatermark:control.deletionWatermark,clearWatermark:control.clearWatermark,head:{...head!}};result(canonical);
        });
      });
      this.assertExport(context);
      const formatting=this.exportFormatter(snapshot,exportedAt);snapshot=null;
      payload=await formatting;this.assertExport(context);
      // Capture each formatter property once: an injected formatter may return
      // accessors that reenter deletion when read. Never invoke them after the
      // final database check, and never retain the formatter-owned object.
      const json=payload?.json,csv=payload?.csv;payload=null;this.assertExport(context);
      if(typeof json!=='string'||typeof csv!=='string')throw new Error('History formatter must return JSON and CSV strings.');
      // Also reject remote deletions during asynchronous formatting before a
      // handle is published. No raw snapshot is retained in the handle cache.
      await this.transact<void>(db,allStores,'readonly',(tx,guard,result)=>this.exportCheck(tx,context,guard,()=>result(undefined)));
      this.assertExport(context);context.payload=Object.freeze({json,csv});
      const handle=Object.freeze({}) as PreparedHistoryExport;this.exportHandles.set(handle,context);return handle;
    }catch(error){context.valid=false;context.payload=null;context.boundary=null;this.activeExports.delete(context);throw error;}
    finally{snapshot=null;payload=null;}
  }
  /** The sink MUST synchronously consume/copy JSON and CSV. The final check and
   * handoff share one readonly transaction, locking out foreign deletion commits.
   * Already handed-off bytes/external downloads cannot subsequently be revoked. */
  async deliverHistoryExport(handle:PreparedHistoryExport,synchronousSink:(payload:HistoryExportPayload)=>void):Promise<void>{
    const context=handle&&typeof handle==='object'?this.exportHandles.get(handle):undefined;
    if(!context)throw new PracticeWriteFenceError('Unknown, foreign, or already-used history export handle.');
    this.exportHandles.delete(handle); // One attempt only, including a failed sink.
    try{
      this.assertExport(context);
      if(typeof synchronousSink!=='function'||Object.prototype.toString.call(synchronousSink)==='[object AsyncFunction]')throw new PracticeWriteFenceError('History export requires a synchronous sink; async sinks are not supported.');
      const db=await this.open();this.assertExport(context);
      await this.transact<void>(db,allStores,'readonly',(tx,guard,result)=>{
        this.exportCheck(tx,context,guard,()=>{
          const payload=context.payload;if(!payload)throw new PracticeWriteFenceError('History export payload is no longer available.');
          // No await, promise continuation, or status notification may appear
          // between the guarded request callback and this synchronous handoff.
          context.payload=null;context.valid=false;this.activeExports.delete(context);
          const returned=synchronousSink(payload) as unknown;
          if(returned!==null&&(typeof returned==='object'||typeof returned==='function')&&typeof(returned as {then?:unknown}).then==='function'){
            // An arbitrary wrapper can conceal a Promise-producing sink. Its
            // handoff cannot be undone; reject misuse and observe any rejection.
            void Promise.resolve(returned).catch(()=>{});throw new PracticeWriteFenceError('History export sink returned a Promise; it must complete synchronously.');
          }
          result(undefined);
        });
      });
    }finally{context.valid=false;context.payload=null;context.boundary=null;this.activeExports.delete(context);}
  }
  /** Development-only read model. No raw snapshots or reusable cached view are
   * returned. The synchronous sink runs inside one readonly transaction, after
   * all canonical data and deletion lineage checks. Consumers own invalidation
   * of copies already handed off; future UI/cache integration is not claimed. */
  async readHistoryProjection(query:PracticeHistoryQuery,synchronousSink:(projection:PracticeHistoryProjection)=>void):Promise<void>{
    const epoch=this.historyProjectionEpoch;
    const check=()=>{this.assertOpen();if(epoch!==this.historyProjectionEpoch)throw new PracticeWriteFenceError('History projection invalidated by deletion, clear, or close.');};
    check();
    if(!this.prepared)throw new PracticeWriteFenceError('Call prepare before querying isolated history.');
    if(typeof synchronousSink!=='function'||Object.prototype.toString.call(synchronousSink)==='[object AsyncFunction]')throw new PracticeWriteFenceError('History projection requires a synchronous sink.');
    const captured=normalizePracticeHistoryQuery(query);check();await this.tail;check();const db=await this.open();check();
    await this.transact<void>(db,allStores,'readonly',(tx,guard,result)=>{
      const requests=[tx.objectStore('control').get('recording'),tx.objectStore('heads').getAll(),tx.objectStore('events').getAll(),tx.objectStore('tombstones').getAll(),tx.objectStore('attemptTombstones').getAll()];let pending=requests.length;
      const ready=()=>guard(()=>{if(--pending)return;check();controlValue(requests[0].result);
        const heads=requests[1].result as Head[],events=requests[2].result as PracticeEvent[],tombstones=requests[3].result as Tombstone[],attemptTombstones=requests[4].result as AttemptTombstone[];
        const headMap=new Map(heads.map(h=>[h.sessionId,h])),deleted=new Set(tombstones.map(t=>t.sessionId));
        const grouped=new Map<string,PracticeEvent[]>(),attempts=new Map<string,AttemptTombstone[]>();
        for(const event of events){if(!headMap.has(event.sessionId)||deleted.has(event.sessionId))throw new PracticeWriteFenceError('Orphaned or deleted facts cannot be projected.');const rows=grouped.get(event.sessionId)??[];rows.push(event);grouped.set(event.sessionId,rows)}
        for(const row of attemptTombstones){if(!headMap.has(row.sessionId)||deleted.has(row.sessionId))throw new PracticeWriteFenceError('Orphaned attempt deletion lineage.');const rows=attempts.get(row.sessionId)??[];rows.push(row);attempts.set(row.sessionId,rows)}
        const snapshots:PracticeSnapshot[]=[];
        for(const head of heads){stableId(head.sessionId);if(deleted.has(head.sessionId))throw new PracticeWriteFenceError('Deleted session still has a head.');snapshots.push(this.canonicalSnapshot(head.sessionId,head,(grouped.get(head.sessionId)??[]).sort((a,b)=>a.sequence-b.sequence),attempts.get(head.sessionId)??[]))}
        const projection=projectPracticeHistory(snapshots,captured);check();
        // No await or subscriber notification between the fence and handoff.
        const returned=synchronousSink(projection) as unknown;
        if(returned!==null&&(typeof returned==='object'||typeof returned==='function')&&typeof(returned as {then?:unknown}).then==='function'){
          void Promise.resolve(returned).catch(()=>{});throw new PracticeWriteFenceError('History projection sink returned a Promise; synchronous consumption is required.');
        }
        result(undefined);
      });for(const request of requests)request.onsuccess=ready;
    });
  }
  async close():Promise<void>{
    this.closed=true;this.pageEnabled=false;this.pageEpoch++;this.abortWrites();this.invalidateExports();this.status({recordingEnabled:false,requiresNewRecordedSession:true});
    await this.tail;
    if(this.database){try{(await this.database).close();}finally{this.database=null;}}
  }
}
