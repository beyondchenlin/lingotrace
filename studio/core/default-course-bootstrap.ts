import type {AutomaticHistoryControl} from './automatic-history-control';
import {isBuiltinMaterial,NPS_MATERIAL} from './builtin-material';
import type {LegacyHistoryAccess} from './legacy-history-reader';
import type {LegacyHistoryCursor} from './legacy-history';
import type {ListeningSessionRecord} from './listening-session';
import type {TrainingSnapshot} from './training';
import type {TrainingTabSelection} from './training-tab-recovery';
import {readTrainingHistoryBootstrap} from './training-history-bootstrap';

type Access=Pick<LegacyHistoryAccess,'listHistory'|'loadHistorySession'>&{readAutomaticHistoryControl():Promise<AutomaticHistoryControl>;loadLatest():Promise<TrainingSnapshot|null>;loadLatestListeningSession?():Promise<ListeningSessionRecord|null>;loadListeningSession?(id:string):Promise<ListeningSessionRecord|null>};
export interface DefaultCourseBootstrap {control:AutomaticHistoryControl;saved:TrainingSnapshot|null;temporary:boolean;preview:boolean;listeningSession?:ListeningSessionRecord}
const changed=()=>new Error('已保存练习或历史许可已变化。原记录保留，请重新打开后重试。');
/** Ordinary entry chooses the most recently saved exact NPS course. This only
 * reads history: it never rewrites latest, migrates material or persists a blank
 * replacement. An explicit resume wins over a current-tab committed locator. */
export async function readDefaultCourseBootstrap(repository:Access,resumeSessionId:string|null=null,resumeSequence:string|null=null,readTabSelection?:()=>TrainingTabSelection|null):Promise<DefaultCourseBootstrap>{
 if(resumeSessionId!==null&&(!resumeSessionId.trim()||resumeSessionId.length>256))throw Error('继续练习的记录标识无效，未切换到其他记录。');
 if(resumeSequence!==null&&(resumeSessionId===null||!/^\d+$/.test(resumeSequence)||!Number.isSafeInteger(Number(resumeSequence))||Number(resumeSequence)<1))throw Error('继续练习的版本标识无效，原记录保留。');
 const tab=resumeSessionId===null?readTabSelection?.():null;
 const selectedId=resumeSessionId??tab?.sessionId??null;
 if(selectedId!==null){
  const control=await repository.readAutomaticHistoryControl();
  if(control.state!=='legacy-default')throw Error('历史许可已有缺口，不能恢复为完整旧轮。可在历史中查看或导出原记录。');
  const wrapped=await repository.loadListeningSession?.(selectedId);
  const saved=wrapped?.trainingSnapshot??(await repository.loadHistorySession(selectedId))?.snapshot;
  if(!saved||saved.sessionId!==selectedId||(resumeSequence!==null&&saved.sequence!==Number(resumeSequence))||(tab&&saved.sequence<tab.sequence))throw changed();
  const recheck=await repository.readAutomaticHistoryControl();
  if(recheck.state!=='legacy-default'||recheck.generation!==control.generation)throw changed();
  return{control:recheck,saved,temporary:false,preview:false,...(wrapped?{listeningSession:wrapped}:{})};
 }
 // B envelopes are restored with their immutable assistance record. The old
 // Training-only loader intentionally refuses them for compatibility safety.
 if(repository.loadLatestListeningSession){const control=await repository.readAutomaticHistoryControl();if(control.state==='legacy-default'){const wrapped=await repository.loadLatestListeningSession();if(wrapped){if(resumeSequence!==null&&wrapped.sequence!==Number(resumeSequence))throw changed();const recheck=await repository.readAutomaticHistoryControl();if(recheck.state!=='legacy-default'||recheck.generation!==control.generation)throw changed();return{control:recheck,saved:wrapped.trainingSnapshot,temporary:false,preview:false,listeningSession:wrapped}}}}
 const initial=await readTrainingHistoryBootstrap(repository);
 if(initial.temporary)return{...initial,preview:true};
 let saved:TrainingSnapshot|null=null;
 if(initial.saved&&isBuiltinMaterial(initial.saved.material))saved=initial.saved;
 else{
  let after:LegacyHistoryCursor|null=null;const seen=new Set<string>();
  for(;;){
   const page=await repository.listHistory({limit:100,after});
   for(const entry of page.entries){
    if(entry.status==='error')throw Error('已保存历史包含无法核验的记录，默认练习尚未切换。原记录未更改。');
    if(entry.summary.materialId!==NPS_MATERIAL.id&&entry.summary.materialVersion!==NPS_MATERIAL.version)continue;
    const selected=await repository.loadHistorySession(entry.summary.sessionId);
    if(!selected||selected.summary.sequence!==entry.summary.sequence||selected.summary.updatedAt!==entry.summary.updatedAt||!isBuiltinMaterial(selected.snapshot.material))throw changed();
    saved=selected.snapshot;break;
   }
   if(saved||!page.hasMore)break;
   if(!page.nextCursor)throw changed();const key=JSON.stringify(page.nextCursor);if(seen.has(key))throw changed();seen.add(key);after=page.nextCursor;
  }
 }
 const control=await repository.readAutomaticHistoryControl();
 if(control.state!=='legacy-default'||control.generation!==initial.control.generation){return{control,saved:null,temporary:true,preview:true}}
 return{control,saved,temporary:false,preview:saved===null};
}
