import {useStudioLocale} from '../i18n/react';
import {useEffect,useRef,useState} from 'react';
import {formatReviewDueTime,type ReviewDueTime} from '../core/review-due-time';
import ReviewDueTimeInput from './ReviewDueTimeInput';

export type ReviewTaskComposerProps={
 cueNumber:number;
 disabledReason:string|null;
 onSave:(due:ReviewDueTime,requestId:string)=>Promise<{disposition:'saved'|'already-present'}>;
 onOpenLibrary:()=>void;
};
const dueKey=(due:ReviewDueTime|null)=>due?JSON.stringify([due.instant,due.localTime,due.timeZone,due.offsetMinutes]):'';

/** The host keys this form by the durable source attempt and fixed target.
 * Neither reference text nor the user's answer is accepted by this view. */
export default function ReviewTaskComposer(props:ReviewTaskComposerProps){
 return <ComposerForm key={props.cueNumber} {...props}/>;
}

function ComposerForm({cueNumber,disabledReason,onSave,onOpenLibrary}:ReviewTaskComposerProps){
 const {t, ui} = useStudioLocale();
 const[due,setDue]=useState<ReviewDueTime|null>(null),[busy,setBusy]=useState(false);
 const[feedback,setFeedback]=useState<{error:boolean;key:'reviewTask.alreadySaved'|'reviewTask.saved'|'reviewTask.saveFailed';detail?:string}|null>(null);
 const alive=useRef(false),pending=useRef(false),epoch=useRef(0);
 const selected=useRef<ReviewDueTime|null>(null),request=useRef<{key:string;id:string}|null>(null);
 const latest=useRef({disabledReason,onSave});latest.current={disabledReason,onSave};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;++epoch.current}},[]);
 function choose(value:ReviewDueTime|null){
  if(pending.current)return;
  if(dueKey(selected.current)!==dueKey(value)){request.current=null;++epoch.current;setFeedback(null)}
  selected.current=value;setDue(value);
 }
 async function save(value:ReviewDueTime|null){
  if(!alive.current||pending.current||latest.current.disabledReason||!value||dueKey(value)!==dueKey(selected.current))return;
  const key=dueKey(value),token=epoch.current;
  if(!request.current||request.current.key!==key)request.current={key,id:globalThis.crypto.randomUUID()};
  pending.current=true;setBusy(true);setFeedback(null);
  try{
   const result=await latest.current.onSave(value,request.current.id);
   if(alive.current&&token===epoch.current)setFeedback({error:false,key:result.disposition==='already-present'?'reviewTask.alreadySaved':'reviewTask.saved'});
  }catch(error){
   if(alive.current&&token===epoch.current)setFeedback({error:true,key:'reviewTask.saveFailed',detail:error instanceof Error?error.message:undefined});
  }finally{pending.current=false;if(alive.current&&token===epoch.current)setBusy(false)}
 }
 return <section aria-label={t('reviewTask.createLabel', {number: cueNumber})}>
  <h4>{t('reviewTask.createHeading', {number: cueNumber})}</h4>
  <p className="note">{t('reviewTask.composerScope')}</p>
  <ReviewDueTimeInput value={due} onChange={choose} label={t('reviewTask.firstDate')} disabled={busy||!!disabledReason}/>
  {due&&<p className="note">{t('reviewTask.scheduledFor', {time: formatReviewDueTime(due)})}</p>}
  {disabledReason&&<p className="notice">{ui(disabledReason)}</p>}
  <div className="button-row">
   <button disabled={busy||!!disabledReason||!due} onClick={()=>void save(due)}>{busy?t('reviewTask.saving'):t('reviewTask.save')}</button>
   <button disabled={busy} onClick={()=>{if(!pending.current)onOpenLibrary()}}>{t('reviewTask.openLibrary')}</button>
  </div>
  {feedback&&<p className={feedback.error?'notice warn':'notice'} role={feedback.error?'alert':'status'}>{t(feedback.key)}{feedback.detail ? ` ${ui(feedback.detail)}` : ''}</p>}
 </section>;
}
