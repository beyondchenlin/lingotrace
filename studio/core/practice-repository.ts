import {validatePracticeSnapshot,replayPracticeEvents,type PracticeSnapshot,type PracticeEvent} from './practice';

export interface PracticeHead {sessionId:string;schemaVersion:string;sequence:number;eventCount:number}
export interface PracticeSaveReceipt {sessionId:string;storedSequence:number;disposition:'appended'|'already-present'|'newer-preserved'}
/** state/error describe writes. A successful old read must not conceal an unsaved draft. */
export interface PracticeStoreStatus {state:'idle'|'pending'|'saved'|'error';pending:number;error:string|null;readError:string|null;lastLoadedSequence:number|null}

/** Order-independent object keys, ordered arrays. Used for exact fact comparison, not a score. */
export function canonicalJson(value:unknown):string {
  if(value===null||typeof value!=='object'){
    const encoded=JSON.stringify(value);if(encoded===undefined)throw new Error('Practice facts must contain JSON-safe values.');return encoded;
  }
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson((value as Record<string,unknown>)[key])}`).join(',')}}`;
}
export class PracticeStorageConflict extends Error {
  constructor(message='相同事件身份的内容不同，当前本机记录未被覆盖。'){super(message);this.name='PracticeStorageConflict'}
}

/** Development-only adapter. No default database and no migration of v22 user history.
 * events is the sole fact store. Heads contain only revision metadata; projections
 * are reconstructed on read. Never wire this adapter into production before the
 * record-off/delete fences and explicit integration review are complete. */
export class DevelopmentPracticeRepository {
  private database:Promise<IDBDatabase>|null=null;
  private tail:Promise<void>=Promise.resolve();
  private state:PracticeStoreStatus=Object.freeze({state:'idle',pending:0,error:null,readError:null,lastLoadedSequence:null});
  private readonly listeners=new Set<()=>void>();
  private readonly factory:IDBFactory|undefined;
  readonly databaseName:string;
  constructor(options:{databaseName:string;indexedDB?:IDBFactory}){
    if(process.env.NODE_ENV==='production')throw new Error('Practice data batch1 is disabled in production until privacy and deletion fences are accepted.');
    if(!/^lingotrace-dev-data-[a-zA-Z0-9_-]+$/.test(options.databaseName))throw new Error('This batch requires an explicit isolated lingotrace-dev-data-* database.');
    this.databaseName=options.databaseName;this.factory=options.indexedDB??globalThis.indexedDB;
  }
  getStatus=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}};
  private status(patch:Partial<PracticeStoreStatus>){this.state=Object.freeze({...this.state,...patch});for(const listener of this.listeners)listener()}
  private open():Promise<IDBDatabase>{
    if(process.env.NODE_ENV==='production')return Promise.reject(new Error('Practice data batch1 is disabled in production.'));
    if(this.database)return this.database;
    this.database=new Promise<IDBDatabase>((resolve,reject)=>{
      if(!this.factory){reject(new Error('IndexedDB unavailable; no durable save occurred.'));return}
      const request=this.factory.open(this.databaseName,1);let rejected=false;
      request.onupgradeneeded=()=>{const db=request.result;
        const events=db.createObjectStore('events',{keyPath:['sessionId','sequence']});
        events.createIndex('bySession','sessionId');events.createIndex('byEventId',['sessionId','eventId'],{unique:true});
        db.createObjectStore('heads',{keyPath:'sessionId'});
      };
      request.onerror=()=>{rejected=true;reject(request.error??new Error('Could not open isolated storage.'))};
      request.onblocked=()=>{rejected=true;reject(new Error('Isolated database is blocked by another connection.'))};
      request.onsuccess=()=>{if(rejected){request.result.close();return}const db=request.result;db.onversionchange=()=>{db.close();this.database=null};resolve(db)};
    }).catch(error=>{this.database=null;throw error});return this.database;
  }
  save(snapshot:PracticeSnapshot):Promise<PracticeSaveReceipt>{
    let captured:PracticeSnapshot;
    try{captured=validatePracticeSnapshot(snapshot)}catch(error){this.status({state:'error',error:error instanceof Error?error.message:'Invalid practice snapshot.'});return Promise.reject(error)}
    this.status({state:'pending',pending:this.state.pending+1,error:null});
    const write=this.tail.then(async()=>{
      const db=await this.open();
      return new Promise<PracticeSaveReceipt>((resolve,reject)=>{
        const tx=db.transaction(['events','heads'],'readwrite'),events=tx.objectStore('events'),heads=tx.objectStore('heads');
        let failure:unknown=null,receipt:PracticeSaveReceipt;
        const request=events.index('bySession').getAll(captured.sessionId);
        request.onsuccess=()=>{try{
          const previous=(request.result as PracticeEvent[]).sort((a,b)=>a.sequence-b.sequence);
          for(let i=0;i<Math.min(previous.length,captured.events.length);i++)if(canonicalJson(previous[i])!==canonicalJson(captured.events[i]))throw new PracticeStorageConflict();
          if(previous.length>=captured.events.length){receipt={sessionId:captured.sessionId,storedSequence:previous.at(-1)?.sequence??0,disposition:previous.length===captured.events.length?'already-present':'newer-preserved'};return}
          for(const event of captured.events.slice(previous.length))events.add(event);
          heads.put({sessionId:captured.sessionId,schemaVersion:captured.schemaVersion,sequence:captured.sequence,eventCount:captured.events.length} satisfies PracticeHead);
          receipt={sessionId:captured.sessionId,storedSequence:captured.sequence,disposition:'appended'};
        }catch(error){failure=error;tx.abort()}};
        tx.oncomplete=()=>resolve(receipt);
        tx.onerror=tx.onabort=()=>reject(failure??tx.error??new Error('Practice transaction did not commit.'));
      });
    }).then(receipt=>{this.status({pending:this.state.pending-1,state:this.state.pending>1?'pending':'saved',error:null});return receipt},error=>{
      this.status({pending:Math.max(0,this.state.pending-1),state:'error',error:error instanceof Error?error.message:'Practice save failed.'});throw error;
    });
    this.tail=write.then(()=>{},()=>{});return write;
  }
  async load(sessionId:string):Promise<PracticeSnapshot|null>{
    try{
    await this.tail;const db=await this.open();
    const stored=await new Promise<{events:PracticeEvent[];head:PracticeHead|undefined}>((resolve,reject)=>{
      const tx=db.transaction(['events','heads'],'readonly');let events:PracticeEvent[]=[],head:PracticeHead|undefined;
      const rows=tx.objectStore('events').index('bySession').getAll(sessionId),metadata=tx.objectStore('heads').get(sessionId);
      rows.onsuccess=()=>{events=rows.result};metadata.onsuccess=()=>{head=metadata.result};
      tx.oncomplete=()=>resolve({events,head});tx.onerror=tx.onabort=()=>reject(tx.error??new Error('Practice read failed.'));
    });
    if(!stored.head&&!stored.events.length)return null;
    if(!stored.head||stored.head.eventCount!==stored.events.length)throw new Error('Practice event/head count mismatch.');
    const snapshot=replayPracticeEvents(stored.events.sort((a,b)=>a.sequence-b.sequence));
    if(snapshot.sessionId!==sessionId||snapshot.sequence!==stored.head.sequence||snapshot.schemaVersion!==stored.head.schemaVersion)throw new Error('Practice head does not match its facts.');
    this.status({readError:null,lastLoadedSequence:snapshot.sequence});return snapshot;
    }catch(error){this.status({readError:error instanceof Error?error.message:'Practice read failed.'});throw error}
  }
  async close(){await this.tail;if(this.database){(await this.database).close();this.database=null}}
}
