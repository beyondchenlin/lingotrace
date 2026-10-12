import type {TrainingSnapshot} from './training.ts';
import type {TrainingHistoryRecorder, TrainingHistoryRecorderStatus} from './training-history-recorder.ts';
import type {AutomaticHistoryControl} from './automatic-history-control.ts';
import {canonicalMaterialDigest} from './local-reference.ts';

/** An explicit new-version transition, never a migration or an overwrite path. */
export interface ReferenceTransitionBoundary {
 readonly sessionId:string; readonly sequence:number; readonly cueIndex:number;
 readonly materialIdentity:string; readonly lastEventId:string|null;
 readonly mode:TrainingHistoryRecorderStatus['mode']; readonly control:AutomaticHistoryControl;
}
const changed=()=>new Error('当前练习、版本选择或历史许可已变化，本次没有切换。请核对后重试；原练习仍保留。');
export function captureReferenceTransitionBoundary(snapshot:TrainingSnapshot,status:TrainingHistoryRecorderStatus):ReferenceTransitionBoundary{
 if(!status.control||!['legacy','segment','off','awaiting-segment'].includes(status.mode)||status.error||status.pendingWrites)
  throw new Error('请先等待或重试当前允许内容的保存与历史设置，再切换素材版本。');
 return Object.freeze({sessionId:snapshot.sessionId,sequence:snapshot.sequence,cueIndex:snapshot.cueIndex,
  materialIdentity:JSON.stringify(snapshot.material),lastEventId:snapshot.events.at(-1)?.eventId??null,mode:status.mode,control:{...status.control}});
}
export function assertReferenceTransitionBoundary(boundary:ReferenceTransitionBoundary,snapshot:TrainingSnapshot,status:TrainingHistoryRecorderStatus):void{
 if(snapshot.sessionId!==boundary.sessionId||snapshot.sequence!==boundary.sequence||snapshot.cueIndex!==boundary.cueIndex
  ||JSON.stringify(snapshot.material)!==boundary.materialIdentity||(snapshot.events.at(-1)?.eventId??null)!==boundary.lastEventId
  ||status.mode!==boundary.mode||status.control?.state!==boundary.control.state||status.control.generation!==boundary.control.generation)throw changed();
}
/** The caller holds a synchronous UI transition lock through this await and the
 * subsequent reset. Every async return rechecks identities; environmental or
 * peer events still abort safely rather than being swallowed by that lock. */
export async function flushReferenceTransition(options:{
 snapshot:()=>TrainingSnapshot; history:Pick<TrainingHistoryRecorder,'getSnapshot'|'flush'>;
 readControl:()=>Promise<AutomaticHistoryControl>; verifyTarget:()=>Promise<void>; isCurrent:()=>boolean;
}):Promise<ReferenceTransitionBoundary & {readonly materialDigest:string}>{
 const {history}=options,boundary=captureReferenceTransitionBoundary(options.snapshot(),history.getSnapshot());
 const check=()=>{if(!options.isCurrent())throw changed();assertReferenceTransitionBoundary(boundary,options.snapshot(),history.getSnapshot())};
 await options.verifyTarget();check();
 const materialDigest=await canonicalMaterialDigest(options.snapshot().material);check();
 await history.flush();check();
 const status=history.getSnapshot();
 if(status.error||status.pendingWrites||status.dirty)throw new Error('当前轮仍有尚未保存的内容，本次没有切换。请先重试保存或主动导出。');
 const control=await options.readControl();check();
 if(control.state!==boundary.control.state||control.generation!==boundary.control.generation)throw changed();
 // Promise return yields to the caller: it must recheck boundary and write status
 // synchronously once more immediately before starting the new session.
 return Object.freeze({...boundary,materialDigest});
}
