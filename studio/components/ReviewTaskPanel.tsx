import {useStudioLocale} from '../i18n/react';
import {useEffect,useRef,useState} from 'react';
import {formatReviewDueTime,type ReviewDueTime} from '../core/review-due-time';
import ReviewDueTimeInput from './ReviewDueTimeInput';

/** Metadata and a result summary only. Never pass a reference or answer here. */
export type ReviewTaskRow={
 taskId:string;revision:number;status:'active'|'cancelled';
 materialTitle:string;materialVersion:string;cueNumber:number;
 due:ReviewDueTime;nextDue:ReviewDueTime|null;
 sourceCoverage:'complete'|'partial';referenceStatus:string;resultSummary:string;canStart:boolean;
};
export type ReviewTaskPanelProps={
 entries:readonly ReviewTaskRow[];unreadableCount:number;loading?:boolean;error?:string;blockedReason?:string|null;
 onReload:()=>Promise<void>;
 onStart:(row:ReviewTaskRow,nextDue:ReviewDueTime)=>Promise<void>;
 onChange:(row:ReviewTaskRow,action:'cancel'|'restore'|'reschedule',due?:ReviewDueTime)=>Promise<void>;
 onExport:(row:ReviewTaskRow)=>Promise<void>;
};
type ChangeMode='restore'|'reschedule';
type Operation='reload'|'start'|'cancel'|ChangeMode|'export';
type FeedbackKey = 'reviewTask.changedSelection' | 'reviewTask.started' | 'reviewTask.cancelled' | 'reviewTask.restored' | 'reviewTask.rescheduled' | 'reviewTask.reloaded' | 'reviewTask.exported' | 'reviewTask.reloadFailed' | 'reviewTask.startFailed' | 'reviewTask.exportFailed' | 'reviewTask.changeFailed';
const dueKey=(due:ReviewDueTime|null)=>due?JSON.stringify([due.instant,due.localTime,due.timeZone,due.offsetMinutes]):'';
// Include all displayed metadata, so even an unexpected same-revision change
// invalidates the selection rather than silently adopting a different target.
const rowKey=(row:ReviewTaskRow)=>JSON.stringify([row.taskId,row.revision,row.status,row.materialTitle,row.materialVersion,row.cueNumber,dueKey(row.due),dueKey(row.nextDue),row.sourceCoverage,row.referenceStatus,row.resultSummary,row.canStart]);

export default function ReviewTaskPanel(props:ReviewTaskPanelProps){
 const {t, ui} = useStudioLocale();
 const{entries,unreadableCount,loading=false,error='',blockedReason=null}=props;
 const[selectedKey,setSelectedKey]=useState<string|null>(null),[nextDue,setNextDue]=useState<ReviewDueTime|null>(null);
 const[mode,setMode]=useState<ChangeMode|null>(null),[changeDue,setChangeDue]=useState<ReviewDueTime|null>(null);
 const[busy,setBusy]=useState<Operation|null>(null),[feedback,setFeedback]=useState<{error:boolean;key:FeedbackKey;detail?:string}|null>(null);
 const alive=useRef(false),pending=useRef<symbol|null>(null),epoch=useRef(0),selection=useRef<string|null>(null);
 const nextChoice=useRef<ReviewDueTime|null>(null),changeChoice=useRef<ReviewDueTime|null>(null),changeMode=useRef<ChangeMode|null>(null);
 const ownChange=useRef<{generation:number;key:string}|null>(null);
 const[now,setNow]=useState(()=>Date.now());
 const latest=useRef(props);latest.current=props;
 const selected=entries.find(row=>rowKey(row)===selectedKey)??null;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;++epoch.current}},[]);
 useEffect(()=>{
  if(selectedKey&&!selected){
   // A successful local mutation refreshes its own revision before onChange
   // resolves. Keep its outcome separate from an unsolicited row replacement.
   if(ownChange.current?.generation===epoch.current&&ownChange.current.key===selectedKey)return;
   ++epoch.current;selection.current=null;nextChoice.current=null;changeChoice.current=null;changeMode.current=null;
   setSelectedKey(null);setNextDue(null);setChangeDue(null);setMode(null);
   setFeedback({error:true,key:'reviewTask.changedSelection'});
  }
 },[selectedKey,selected]);
 useEffect(()=>{
  if(typeof window==='undefined')return;
  let timer:number|undefined,disposed=false;
  const update=()=>{
   if(disposed)return;
   if(timer!==undefined){window.clearTimeout(timer);timer=undefined}
   const time=Date.now();setNow(time);
   if(document.hidden)return;
   let active=false,next=Infinity;
   for(const row of entries)if(row.status==='active'){active=true;const instant=Date.parse(row.due.instant);if(instant>time)next=Math.min(next,instant)}
   // Only repaint saved metadata. The bounded check also catches wall-clock
   // changes; it never reloads, creates, advances or notifies about a task.
   if(active)timer=window.setTimeout(update,Math.max(1,Math.min(60_000,next-time)));
  };
  window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);update();
  return()=>{disposed=true;if(timer!==undefined)window.clearTimeout(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update)};
 },[entries]);
 function choose(row:ReviewTaskRow){
  ++epoch.current;const key=rowKey(row);selection.current=key;setSelectedKey(key);
  nextChoice.current=row.nextDue;setNextDue(row.nextDue);changeChoice.current=null;setChangeDue(null);changeMode.current=null;setMode(null);setFeedback(null);
 }
 function isCurrent(row:ReviewTaskRow){return selection.current===rowKey(row)&&latest.current.entries.some(entry=>rowKey(entry)===rowKey(row))}
 async function run(operation:Operation,row:ReviewTaskRow|null,action:()=>Promise<void>,success:FeedbackKey){
  if(!alive.current||pending.current||latest.current.loading||(row&&!isCurrent(row)))return;
  if(operation!=='reload'&&operation!=='export'&&latest.current.error)return;
  const token=Symbol(operation),generation=epoch.current;
  const changesRow=operation==='cancel'||operation==='restore'||operation==='reschedule';
  if(changesRow&&row)ownChange.current={generation,key:rowKey(row)};
  const clearChangedSelection=()=>{
   if(!row||isCurrent(row))return;
   selection.current=null;nextChoice.current=null;changeChoice.current=null;changeMode.current=null;
   setSelectedKey(null);setNextDue(null);setChangeDue(null);setMode(null);
  };
  pending.current=token;setBusy(operation);setFeedback(null);
  try{
   await action();
   if(alive.current&&generation===epoch.current&&(changesRow||!row||isCurrent(row))){if(changesRow)clearChangedSelection();setFeedback({error:false,key:success})}
  }catch(cause){
   if(alive.current&&generation===epoch.current&&(changesRow||!row||isCurrent(row))){if(changesRow)clearChangedSelection();setFeedback({error:true,key:operation==='reload'?'reviewTask.reloadFailed':operation==='start'?'reviewTask.startFailed':operation==='export'?'reviewTask.exportFailed':'reviewTask.changeFailed',detail:cause instanceof Error?cause.message:undefined})}
  }finally{
   if(pending.current===token){pending.current=null;ownChange.current=null;if(alive.current)setBusy(null)}
  }
 }
 function chooseNext(value:ReviewDueTime|null){if(pending.current||selected?.nextDue)return;nextChoice.current=value;setNextDue(value);setFeedback(null)}
 function prepareChange(row:ReviewTaskRow,action:ChangeMode){
  if(pending.current||!isCurrent(row))return;
  changeMode.current=action;setMode(action);changeChoice.current=null;setChangeDue(null);setFeedback(null);
 }
 function start(row:ReviewTaskRow,due:ReviewDueTime|null){
  if(row.status!=='active'||!row.canStart||latest.current.blockedReason||!due||dueKey(due)!==dueKey(nextChoice.current))return;
  if(row.nextDue&&dueKey(due)!==dueKey(row.nextDue))return;
  void run('start',row,()=>latest.current.onStart(row,due),'reviewTask.started');
 }
 function change(row:ReviewTaskRow,action:'cancel'|ChangeMode,due?:ReviewDueTime){
  if(action==='cancel'&&row.status!=='active'||action==='restore'&&row.status!=='cancelled'||action==='reschedule'&&row.status!=='active')return;
  if(action!=='cancel'&&(!due||changeMode.current!==action||dueKey(due)!==dueKey(changeChoice.current)))return;
  void run(action,row,()=>latest.current.onChange(row,action,due),action==='cancel'?'reviewTask.cancelled':action==='restore'?'reviewTask.restored':'reviewTask.rescheduled');
 }
 const groups=[{id:'due',label:t('reviewTask.due'),rows:entries.filter(row=>row.status==='active'&&Date.parse(row.due.instant)<=now)},
  {id:'upcoming',label:t('reviewTask.upcoming'),rows:entries.filter(row=>row.status==='active'&&Date.parse(row.due.instant)>now)},
  {id:'cancelled',label:t('reviewTask.cancelledLabel'),rows:entries.filter(row=>row.status==='cancelled')}];
 return <section aria-label={t('reviewTask.panelLabel')}>
  <p className="note">{t('reviewTask.scope')}</p>
  <div className="button-row"><button disabled={loading||!!busy} onClick={()=>void run('reload',null,()=>latest.current.onReload(),'reviewTask.reloaded')}>{busy==='reload'?t('reviewTask.reloading'):t('reviewTask.reload')}</button></div>
  {loading&&<p role="status">{t('reviewTask.loading')}</p>}
  {error&&<p className="notice warn" role="alert">{t('reviewTask.readError', {error: ui(error)})}</p>}
  {blockedReason&&<p className="notice">{t('reviewTask.blocked', {reason: ui(blockedReason)})}</p>}
  {feedback&&<p className={feedback.error?'notice warn':'notice'} role={feedback.error?'alert':'status'}>{t(feedback.key)}{feedback.detail ? ` ${ui(feedback.detail)}` : ''}</p>}
  {unreadableCount>0&&<p className="notice warn">{t('reviewTask.unreadable', {count: unreadableCount})}</p>}
  {!loading&&!error&&!entries.length&&<p className="empty">{t('reviewTask.empty')}</p>}
  {groups.map(group=>group.rows.length>0&&<div key={group.id} aria-label={group.label}>
   <h3>{group.label}</h3>
   <div className="attempt-list">{group.rows.map(row=><article className="record-card" key={row.taskId}>
    <h4 style={{overflowWrap:'anywhere'}}>{t('reviewTask.rowTitle', {title: row.materialTitle, number: row.cueNumber})}</h4>
    <p className="note" style={{overflowWrap:'anywhere'}}>{t('reviewTask.identity', {version: row.materialVersion, id: row.taskId, revision: row.revision})}</p>
    <p>{t('reviewTask.scheduleStatus')}{row.status==='cancelled'?t('reviewTask.cancelledLabel'):Date.parse(row.due.instant)<=now?t('reviewTask.awaitingDue'):t('reviewTask.awaitingUpcoming')}</p>
    <p>{t('reviewTask.date', {time: formatReviewDueTime(row.due)})}</p>
    {row.nextDue&&<p className="note">{t('reviewTask.savedNextDate', {time: formatReviewDueTime(row.nextDue)})}</p>}
    <p className="note">{row.sourceCoverage==='partial'?t('reviewTask.partialSource'):t('reviewTask.completeSource')}</p>
    <p className="note">{t('reviewTask.referenceStatus', {status: ui(row.referenceStatus)})}</p>
    {row.resultSummary&&<p className="note">{t('reviewTask.resultSummary', {summary: ui(row.resultSummary)})}</p>}
    <div className="button-row"><button aria-pressed={selectedKey===rowKey(row)} onClick={()=>choose(row)}>{t('reviewTask.manage')}</button></div>
   </article>)}</div>
  </div>)}
  {selected&&<section aria-label={t('reviewTask.manageLabel', {number: selected.cueNumber})}>
   <h3>{t('reviewTask.selection', {title: selected.materialTitle, number: selected.cueNumber})}</h3>
   <p className="note">{t('reviewTask.fixedVersion', {version: selected.materialVersion})}</p>
   {selected.status==='active'&&<>
    {selected.nextDue?<p className="notice">{t('reviewTask.preservedNextDate', {time: formatReviewDueTime(selected.nextDue)})}</p>:<ReviewDueTimeInput key={`next:${selectedKey}`} value={nextDue} onChange={chooseNext} label={t('reviewTask.nextDate')} disabled={!!busy||loading||!selected.canStart||!!blockedReason}/>}
    {!selected.nextDue&&nextDue&&<p className="note">{t('reviewTask.chosenNextDate', {time: formatReviewDueTime(nextDue)})}</p>}
    <p className="note">{t('reviewTask.progressRule')}</p>
    {!selected.canStart&&<p className="notice">{t('reviewTask.unavailable')}</p>}
    <div className="button-row"><button disabled={!!busy||loading||!!error||!selected.canStart||!!blockedReason||!nextDue} onClick={()=>start(selected,nextDue)}>{busy==='start'?t('reviewTask.starting'):t('reviewTask.start')}</button></div>
    <p className="note">{t('reviewTask.startNotice')}</p>
   </>}
   <div className="button-row">
    {selected.status==='active'?<><button disabled={!!busy||loading||!!error} onClick={()=>prepareChange(selected,'reschedule')}>{t('reviewTask.chooseNewDate')}</button><button disabled={!!busy||loading||!!error} onClick={()=>change(selected,'cancel')}>{t('reviewTask.cancel')}</button></>:<button disabled={!!busy||loading||!!error} onClick={()=>prepareChange(selected,'restore')}>{t('reviewTask.chooseRestoreDate')}</button>}
    <button disabled={!!busy||loading} onClick={()=>void run('export',selected,()=>latest.current.onExport(selected),'reviewTask.exported')}>{t('reviewTask.export')}</button>
   </div>
   {mode&&<>
    <ReviewDueTimeInput key={`change:${selectedKey}:${mode}`} value={changeDue} onChange={value=>{if(!pending.current){changeChoice.current=value;setChangeDue(value);setFeedback(null)}}} label={mode==='restore'?t('reviewTask.restoreDate'):t('reviewTask.rescheduleDate')} disabled={!!busy||loading}/>
    {changeDue&&<p className="note">{t('reviewTask.confirmDate', {time: formatReviewDueTime(changeDue)})}</p>}
    <p className="note">{t('reviewTask.changeScope')}</p>
    <div className="button-row"><button disabled={!!busy||loading||!!error||!changeDue} onClick={()=>{if(changeDue)change(selected,mode,changeDue)}}>{mode==='restore'?t('reviewTask.confirmRestore'):t('reviewTask.confirmReschedule')}</button><button disabled={!!busy} onClick={()=>{if(!pending.current){changeMode.current=null;setMode(null);changeChoice.current=null;setChangeDue(null)}}}>{t('reviewTask.cancelDateChange')}</button></div>
   </>}
  </section>}
 </section>;
}
