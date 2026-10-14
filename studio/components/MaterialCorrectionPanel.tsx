import {useEffect,useRef,useState,type RefObject} from 'react';
import {hasScorableReference,type Material} from '../core/training';
import {useStudioLocale} from '../i18n/react';
import {
 createContextBookmarkPreviewController,ORIGINAL_COURSE_MEDIA,
 type ContextBookmarkMediaReference,type ContextBookmarkMonitor,
 type OriginalCourseMediaLease,type OriginalCourseMediaPool,
} from '../media/context-bookmark-media';

export type MaterialCorrectionPreviewController=ReturnType<typeof createContextBookmarkPreviewController>;
type PreviewState=ReturnType<MaterialCorrectionPreviewController['getState']>;
/** Supplied only after the host verifies this exact material and records the
 * actual current-cue reveal. A matching version name alone is not verification. */
export type MaterialCorrectionTarget=Readonly<{
 material:Material;cueId:string;mediaId:string;mediaSha256:string;expectedDurationSeconds?:number;
}>;
/** The list consumes metadata only. Extra receipt fields are never rendered. */
export type MaterialCorrectionEntry=Readonly<{
 key:string;material:Readonly<{id:string;version:string;localReference?:Readonly<{lineage?:Readonly<{operation:'merge'|'split';parentUnitIds:readonly string[];unitIds:readonly string[]}>}>}>;parent:Readonly<{version:string}>;
 change:Readonly<{cueId:string}>;createdAt:string;
}>;
export type MaterialCorrectionSaveInput=Readonly<{
 text:string;start:number;end:number;verifiedDurationSeconds:number;saveRequestId:string;
 structure?:Readonly<{operation:'merge'|'split';firstText:string;secondText?:string;splitAt?:number;confirmed:true}>;
}>;
export type MaterialCorrectionPanelProps<Entry extends MaterialCorrectionEntry=MaterialCorrectionEntry>={
 current:MaterialCorrectionTarget|null;entries:readonly Entry[];pool:OriginalCourseMediaPool;
 controllerRef:RefObject<MaterialCorrectionPreviewController|null>;monitor:ContextBookmarkMonitor;
 recordingBlocked:boolean;isRecordingBlocked:()=>boolean;onBeforePreview:()=>boolean;
 onSave:(input:MaterialCorrectionSaveInput)=>Promise<{entry:Entry;disposition:'saved'|'already-present'}>;
 onStart:(entry:Entry)=>Promise<void>;onReload:()=>Promise<void>;onCancel:()=>void;
 disabledReason?:string|null;transitionBusy?:boolean;unreadableCount?:number;
};
type Edit={identity:string;text:string;start:string;end:string;mode:'edit'|'merge'|'split';secondText:string;splitAt:string;confirmed:boolean};
const fields=['materialId','materialVersion','cueId','text','startSeconds','endSeconds','mediaId','mediaSha256'] as const;
const sameReference=(a:ContextBookmarkMediaReference|null,b:ContextBookmarkMediaReference|null)=>!!a&&!!b&&fields.every(key=>a[key]===b[key]);
const sameEntry=(a:MaterialCorrectionEntry,b:MaterialCorrectionEntry)=>a.key===b.key&&JSON.stringify(a)===JSON.stringify(b);
const hidden=()=>typeof document!=='undefined'&&document.hidden;
const errorMessage=(error:unknown,fallback:string)=>error instanceof Error?error.message:fallback;
const seconds=(value:string)=>value.trim()===''?NaN:Number(value);

/** No Training command, automatic adoption, recording track, source upload, or
 * reference-list rendering lives here. Saving and starting are separate actions. */
export default function MaterialCorrectionPanel<Entry extends MaterialCorrectionEntry>(props:MaterialCorrectionPanelProps<Entry>){
 const {t,ui}=useStudioLocale();
 const {current,entries,pool,controllerRef,monitor,recordingBlocked,transitionBusy=false,disabledReason=null,unreadableCount=0}=props;
 const identity=current?JSON.stringify(current):'';
 const cue=current?.material.cues.find(value=>value.id===current.cueId)??null;
 const index=current?.material.cues.findIndex(value=>value.id===current.cueId)??-1;
 const previous=index>0?current?.material.cues[index-1]:null,next=index>=0?current?.material.cues[index+1]:null;
 const initial:Edit={identity,text:cue?.text??'',start:cue?String(cue.start):'',end:cue?String(cue.end):'',mode:'edit',secondText:'',splitAt:'',confirmed:false};
 const[storedEdit,setEdit]=useState<Edit>(initial),[preview,setPreview]=useState<PreviewState|null>(null);
 const[message,setMessage]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState<'save'|'start'|'reload'|null>(null);
 const[selected,setSelected]=useState<Entry|null>(null),[preparing,setPreparing]=useState(false);
 const edit=storedEdit.identity===identity?storedEdit:initial;
 const start=seconds(edit.start),end=seconds(edit.end),splitAt=seconds(edit.splitAt);
 const previewText=edit.mode==='split'?`${edit.text} ${edit.secondText}`:edit.text;
 const reference:ContextBookmarkMediaReference|null=current&&cue?{
  materialId:current.material.id,materialVersion:current.material.version,cueId:cue.id,text:previewText,
  startSeconds:start,endSeconds:end,mediaId:current.mediaId,mediaSha256:current.mediaSha256,
 }:null;
 const latest=useRef(props),editRef=useRef(edit),referenceRef=useRef(reference),identityRef=useRef(identity);
 latest.current=props;editRef.current=edit;referenceRef.current=reference;identityRef.current=identity;
 const video=useRef<HTMLVideoElement>(null),alive=useRef(false),previewEpoch=useRef(0),leaseEpoch=useRef(0);
 const activeLease=useRef<OriginalCourseMediaLease|null>(null),operation=useRef<'save'|'start'|'reload'|null>(null);
 const saveRequest=useRef<{identity:string;id:string}|null>(null),selection=useRef<Entry|null>(selected);
 selection.current=selected&&entries.some(row=>sameEntry(row,selected))?selected:null;
 const invalidText=!edit.text.trim()||!hasScorableReference(edit.text);
 const invalidRange=!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start;
 const structural=edit.mode!=='edit';
 const following=edit.mode==='merge'?current?.material.cues[index+2]:next;
 const invalidStructure=structural&&(!cue||(!!previous&&start<previous.end)||(!!following&&end>following.start)
  ||(edit.mode==='merge'&&(!next||cue.end>next.start||edit.text===cue.text))
  ||(edit.mode==='split'&&(!hasScorableReference(edit.secondText)||!Number.isFinite(splitAt)||splitAt<=start||splitAt>=end)));
 const changed=structural||!!cue&&(edit.text!==cue.text||start!==cue.start||end!==cue.end);
 const busy=!!pending||transitionBusy;
 const blocked=()=>!!latest.current.transitionBusy||!!latest.current.recordingBlocked||latest.current.isRecordingBlocked()||hidden();
 function invalidatePreview(clearMessage=true){
  ++previewEpoch.current;++leaseEpoch.current;controllerRef.current?.close();
  if(alive.current){setPreparing(false);if(clearMessage)setMessage('')}
 }
 function cancel(){if(operation.current||latest.current.transitionBusy)return;invalidatePreview();latest.current.onCancel()}
 function change(field:'text'|'start'|'end'|'secondText'|'splitAt',value:string){
  if(operation.current||blocked()||latest.current.disabledReason||(editRef.current.mode!=='edit'&&(field==='start'||field==='end')))return;
  invalidatePreview();saveRequest.current=null;setError('');
  const next={...editRef.current,[field]:value,confirmed:false};editRef.current=next;setEdit(next);
  // Invalidate the exact-reference closure before a possible late native event.
  referenceRef.current=null;
 }
 function chooseMode(mode:Edit['mode']){
  if(!alive.current||operation.current||blocked()||latest.current.disabledReason||identityRef.current!==identity||!cue||mode===editRef.current.mode||(mode==='merge'&&!next))return;
  const active=editRef.current,initialEnd=active.mode==='merge'?String(next?.end??cue.end):initial.end;
  // Compare raw inputs so incomplete and invalid drafts are protected too.
  const hasDraft=active.text!==initial.text||active.start!==initial.start||active.end!==initialEnd||active.secondText!==''||active.splitAt!=='';
  if(hasDraft){
   // Native dialogs block boundary timers; pause and fence pending play first.
   const controller=controllerRef.current,phase=controller?.getState().phase;
   if(phase==='ready'||phase==='playing')controller?.pause();
   if(!window.confirm(t('reference.modeResetWarning')))return;
  }
  // A native confirmation must not authorize a changed target or a new lock.
  if(!alive.current||operation.current||blocked()||latest.current.disabledReason||identityRef.current!==identity||editRef.current!==active)return;
  invalidatePreview();saveRequest.current=null;setError('');
  const draft={...initial,mode,end:mode==='merge'?String(next!.end):String(cue.end)};
  editRef.current=draft;setEdit(draft);referenceRef.current=null;
 }
 function confirmStructure(){
  if(operation.current||blocked()||latest.current.disabledReason||invalidText||invalidRange||invalidStructure||!structural)return;
  const draft={...editRef.current,confirmed:true};editRef.current=draft;setEdit(draft);
 }
 function proof():{duration:number;reference:ContextBookmarkMediaReference}|null{
  const state=controllerRef.current?.getState(),lease=activeLease.current,element=video.current,target=latest.current.current,expected=referenceRef.current;
  if(!target||!state||state.phase!=='ready'||state.recordingBlocked||!lease||!element||!expected||blocked()||latest.current.disabledReason)return null;
  if(!sameReference(state.reference,expected)||!lease.verified||lease.actualSha256!==target.mediaSha256||lease.mediaSha256!==target.mediaSha256||lease.mediaId!==target.mediaId)return null;
  if(element.src!==lease.url||(element.currentSrc&&element.currentSrc!==lease.url)||element.readyState<1)return null;
  const duration=state.duration;
  if(duration===null||!Number.isFinite(duration)||duration<=0||element.duration!==duration||expected.startSeconds<0||expected.endSeconds<=expected.startSeconds||expected.endSeconds>duration)return null;
  if(target.expectedDurationSeconds!==undefined&&target.expectedDurationSeconds!==duration)return null;
  return{duration,reference:expected};
 }
 useEffect(()=>{
  alive.current=true;
  const onHidden=()=>{if(hidden())invalidatePreview()},onPageHide=()=>invalidatePreview();
  document.addEventListener('visibilitychange',onHidden);window.addEventListener('pagehide',onPageHide);
  return()=>{alive.current=false;++previewEpoch.current;++leaseEpoch.current;document.removeEventListener('visibilitychange',onHidden);window.removeEventListener('pagehide',onPageHide)};
 },[]);
 useEffect(()=>{
  if(!video.current)return;
  const trackedPool:OriginalCourseMediaPool={async acquire(options){
   const generation=++leaseEpoch.current;
   const acquired=await pool.acquire(options);
   if(!alive.current||generation!==leaseEpoch.current||options?.signal?.aborted){acquired.release();throw new Error(t('correction.previewCanceled'))}
   let released=false;
   const tracked:OriginalCourseMediaLease={...acquired,release(){if(released)return;released=true;if(activeLease.current===tracked)activeLease.current=null;acquired.release()}};
   activeLease.current=tracked;return tracked;
  }};
  const controller=createContextBookmarkPreviewController({video:video.current,pool:trackedPool,monitor,
   validateReference:value=>sameReference(value,referenceRef.current)&&latest.current.current?.mediaId===ORIGINAL_COURSE_MEDIA.mediaId&&latest.current.current?.mediaSha256===ORIGINAL_COURSE_MEDIA.mediaSha256?null:t('correction.referenceChanged'),
   isRecordingBlocked:()=>!!latest.current.recordingBlocked||latest.current.isRecordingBlocked(),
  });
  controllerRef.current=controller;setPreview(controller.getState());
  const unsubscribe=controller.subscribe(()=>{if(alive.current)setPreview(controller.getState())});
  return()=>{++previewEpoch.current;++leaseEpoch.current;unsubscribe();controller.dispose();if(controllerRef.current===controller)controllerRef.current=null};
 },[pool,controllerRef]);
 useEffect(()=>{invalidatePreview();saveRequest.current=null;setError('');setEdit(initial)},[identity]);
 useEffect(()=>{controllerRef.current?.setMonitor(monitor)},[monitor.volume,monitor.courseMuted,monitor.allMuted]);
 useEffect(()=>{controllerRef.current?.setRecordingBlocked(recordingBlocked);if(recordingBlocked)invalidatePreview()},[recordingBlocked]);
 useEffect(()=>{if(transitionBusy)invalidatePreview()},[transitionBusy]);
 useEffect(()=>{if(disabledReason)invalidatePreview()},[disabledReason]);
 useEffect(()=>{if(selected&&!entries.some(row=>sameEntry(row,selected))){selection.current=null;setSelected(null);setMessage(t('correction.selectionGone'))}},[entries,selected]);
 async function prepare(){
  const controller=controllerRef.current,expected=referenceRef.current;
  if(!expected||!controller||operation.current||blocked()||latest.current.disabledReason||!hasScorableReference(expected.text)||!Number.isFinite(expected.startSeconds)||!Number.isFinite(expected.endSeconds)||expected.startSeconds<0||expected.endSeconds<=expected.startSeconds)return;
  const retry=controller.getState().phase==='error';invalidatePreview();setError('');
  if(!latest.current.onBeforePreview())return;
  const generation=++previewEpoch.current,targetIdentity=identityRef.current;setPreparing(true);
  controller.select(expected);
  try{
   await controller.load({retry});
   if(!alive.current||generation!==previewEpoch.current||targetIdentity!==identityRef.current||blocked())return;
   const verified=proof();
   if(verified)setMessage(t('correction.verifiedDuration',{duration:verified.duration}));
   else if(controller.getState().phase==='ready'){controller.close();setError(t('correction.sourceMismatch'))}
  }catch(e){if(alive.current&&generation===previewEpoch.current)setError(errorMessage(e,t('correction.prepareFailed')))}
  finally{if(alive.current&&generation===previewEpoch.current)setPreparing(false)}
 }
 function play(){
  if(operation.current||!proof()||!latest.current.onBeforePreview())return;
  setMessage('');void controllerRef.current?.play();
 }
 async function save(){
  if(operation.current||blocked()||latest.current.disabledReason)return;
  const verified=proof(),draft=editRef.current,target=latest.current.current,original=target?.material.cues.find(value=>value.id===target.cueId);
  if(invalidStructure||(draft.mode!=='edit'&&!draft.confirmed)||!verified||!original||!draft.text.trim()||!hasScorableReference(draft.text))return;
  if(draft.mode==='edit'&&draft.text===original.text&&verified.reference.startSeconds===original.start&&verified.reference.endSeconds===original.end)return;
  const requestIdentity=JSON.stringify([identityRef.current,draft,verified.duration]);
  try{if(saveRequest.current?.identity!==requestIdentity)saveRequest.current={identity:requestIdentity,id:crypto.randomUUID()}}
  catch{setError(t('correction.saveIdFailed'));return}
  const structure=draft.mode==='edit'?{}:{structure:{operation:draft.mode,firstText:draft.text,...(draft.mode==='split'?{secondText:draft.secondText,splitAt:seconds(draft.splitAt)}:{}),confirmed:true as const}};
  const input={...structure,text:verified.reference.text,start:verified.reference.startSeconds,end:verified.reference.endSeconds,verifiedDurationSeconds:verified.duration,saveRequestId:saveRequest.current.id};
  operation.current='save';setPending('save');setError('');setMessage('');const targetIdentity=identityRef.current;
  try{
   const result=await latest.current.onSave(input);
   if(alive.current&&targetIdentity===identityRef.current)setMessage(result.disposition==='already-present'?t('correction.alreadyPresent'):t('correction.saved'));
  }catch(e){if(alive.current&&targetIdentity===identityRef.current)setError(errorMessage(e,t('correction.saveFailed')))}
  finally{operation.current=null;if(alive.current)setPending(null)}
 }
 function choose(row:Entry){
  if(operation.current||latest.current.transitionBusy)return;
  const exact=latest.current.entries.find(value=>sameEntry(value,row));if(!exact)return;
  invalidatePreview();selection.current=exact;setSelected(exact);setError('');
 }
 async function startSelected(){
  const chosen=selection.current;
  if(!chosen||operation.current||blocked()||!latest.current.entries.some(row=>sameEntry(row,chosen)))return;
  invalidatePreview();operation.current='start';setPending('start');setError('');
  try{await latest.current.onStart(chosen)}
  catch(e){if(alive.current)setError(errorMessage(e,t('correction.startFailed')))}
  finally{operation.current=null;if(alive.current)setPending(null)}
 }
 async function reload(){
  if(operation.current||latest.current.transitionBusy)return;
  invalidatePreview();operation.current='reload';setPending('reload');setError('');
  try{await latest.current.onReload()}
  catch(e){if(alive.current)setError(errorMessage(e,t('correction.reloadFailed')))}
  finally{operation.current=null;if(alive.current)setPending(null)}
 }
 const availableProof=proof();
 const splitLabel=Number.isFinite(splitAt)?String(splitAt):t('correction.pending');
 return <section aria-label={t('correction.sectionLabel')}>
  <p className="note">{t('correction.lede')}</p>
  {current&&cue&&<section aria-label={t('correction.currentSection')}>
   <h3>{t('correction.currentHeading',{id:cue.id})}</h3>
   <p className="notice">{t('correction.viewedNotice')}</p>
   <div className="button-row" aria-label={t('correction.editModesAria')}>
    <button disabled={busy||recordingBlocked||!!disabledReason} aria-pressed={edit.mode==='edit'} onClick={()=>chooseMode('edit')}>{t('correction.modeEdit')}</button>
    <button disabled={busy||recordingBlocked||!!disabledReason||!next} aria-pressed={edit.mode==='merge'} onClick={()=>chooseMode('merge')}>{t('correction.modeMerge')}</button>
    <button disabled={busy||recordingBlocked||!!disabledReason} aria-pressed={edit.mode==='split'} onClick={()=>chooseMode('split')}>{t('correction.modeSplit')}</button>
   </div>
   {structural&&<p className="note">{t('correction.originalCue',{text:cue.text})}</p>}
   {edit.mode==='merge'&&next&&<p className="notice">{t('correction.mergeNotice',{a:cue.id,b:next.id,start:next.start,end:next.end})}</p>}
   <label>{t('correction.textLabel')}<textarea aria-label={t('correction.textAria')} value={edit.text} disabled={busy||recordingBlocked||!!disabledReason} onChange={event=>change('text',event.target.value)} style={{width:'100%',minHeight:90}}/></label>
   <div className="button-row">
    <label>{t('correction.startLabel')} <input aria-label={t('correction.startAria')} readOnly={structural} type="number" step="any" min="0" value={edit.start} disabled={busy||recordingBlocked||!!disabledReason} onChange={event=>change('start',event.target.value)}/></label>
    <label>{t('correction.endLabel')} <input aria-label={t('correction.endAria')} readOnly={structural} type="number" step="any" min="0" value={edit.end} disabled={busy||recordingBlocked||!!disabledReason} onChange={event=>change('end',event.target.value)}/></label>
   </div>
   {edit.mode==='split'&&<>
    <label>{t('correction.secondTextLabel')}<textarea aria-label={t('correction.secondTextAria')} value={edit.secondText} disabled={busy||recordingBlocked||!!disabledReason} onChange={event=>change('secondText',event.target.value)} style={{width:'100%',minHeight:70}}/></label>
    <label>{t('correction.splitAtLabel')}<input aria-label={t('correction.splitAtAria')} type="number" step="any" value={edit.splitAt} disabled={busy||recordingBlocked||!!disabledReason} onChange={event=>change('splitAt',event.target.value)}/></label>
    <p className="note">{t('correction.splitNote',{start,split:splitLabel,end})}</p>
   </>}
   {invalidStructure&&<p className="notice warn">{t('correction.structureIncomplete')}</p>}
   {structural&&<button disabled={busy||recordingBlocked||!!disabledReason||invalidText||invalidRange||invalidStructure} aria-pressed={edit.confirmed} onClick={confirmStructure}>{edit.confirmed?t('correction.structureConfirmed'):t('correction.confirmStructure')}</button>}
   {invalidText&&<p className="notice warn">{t('correction.needScorable')}</p>}
   {invalidRange&&<p className="notice warn">{t('correction.needRange')}</p>}
   {!invalidRange&&previous&&start!==previous.end&&<p className="note">{(start<previous.end?t('correction.overlapPrev'):t('correction.gapPrev'))}{t('correction.boundaryHint',{end:previous.end})}</p>}
   {!invalidRange&&following&&end!==following.start&&<p className="note">{(end>following.start?t('correction.overlapNext'):t('correction.gapNext'))}{t('correction.boundaryHintNext',{start:following.start})}</p>}
   {disabledReason&&<p className="notice warn">{ui(disabledReason)}</p>}
   <p className="note">{availableProof?t('correction.proofReady',{duration:availableProof.duration}):t('correction.proofNeeded')}</p>
  </section>}
  <video ref={video} playsInline preload="metadata" hidden={!current} aria-label={t('correction.previewAria')} style={{width:'100%',maxHeight:280,background:'#111'}}/>
  {current&&cue&&<>
   <div className="button-row">
    <button disabled={busy||recordingBlocked||!!disabledReason||preparing||invalidText||invalidRange} onClick={()=>void prepare()}>{preparing?t('correction.verifying'):t('correction.verify')}</button>
    <button disabled={busy||recordingBlocked||!availableProof} onClick={play}>{t('correction.preview')}</button>
    <button disabled={preview?.phase!=='playing'} onClick={()=>controllerRef.current?.pause()}>{t('correction.pausePreview')}</button>
    <button disabled={busy||recordingBlocked||!changed||invalidText||invalidRange||invalidStructure||(structural&&!edit.confirmed)||!availableProof} onClick={()=>void save()}>{pending==='save'?t('correction.saving'):t('correction.save')}</button>
   </div>
   {preview?.error&&<p className="notice warn" role="alert">{ui(preview.error)}</p>}
   {recordingBlocked&&<p className="notice">{t('correction.recordingBlocked')}</p>}
   <p className="note">{t('correction.previewMonitorNote')}</p>
  </>}
  <div className="button-row"><button disabled={busy} onClick={cancel}>{current?t('correction.cancelEdit'):t('correction.closeList')}</button><button disabled={busy} onClick={()=>void reload()}>{pending==='reload'?t('correction.refreshing'):t('correction.refresh')}</button></div>
  {error&&<p className="notice warn" role="alert">{ui(error)}</p>}
  {message&&<p className="notice" role="status">{ui(message)}</p>}
  <h3>{t('correction.savedHeading')}</h3>
  <p className="note">{t('correction.listNote')}</p>
  {unreadableCount>0&&<p className="notice warn">{t('correction.unreadable',{count:unreadableCount})}</p>}
  {!entries.length&&<p className="empty">{t('correction.empty')}</p>}
  <div className="attempt-list">{entries.map(row=><article className="record-card" key={row.key}>
   <h4 style={{overflowWrap:'anywhere'}}>{row.material.version}</h4>
   {row.material.localReference?.lineage&&<p className="note" style={{overflowWrap:'anywhere'}}>{row.material.localReference.lineage.operation==='merge'?t('correction.lineageMerge'):t('correction.lineageSplit')}{t('correction.lineageParents',{ids:row.material.localReference.lineage.parentUnitIds.join('、')})}{t('correction.lineageUnits',{ids:row.material.localReference.lineage.unitIds.join('、')})}</p>}
   <p className="note">{t('correction.rowMeta',{cue:row.change.cueId,parent:row.parent.version,createdAt:row.createdAt})}</p>
   <button disabled={busy} aria-pressed={selection.current?.key===row.key} onClick={()=>choose(row)}>{t('correction.selectVersion')}</button>
  </article>)}</div>
  {selection.current&&<div aria-label={t('correction.selectedAria')}>
   <p className="note">{t('correction.selectedNote',{version:selection.current.material.version,cue:selection.current.change.cueId})}</p>
   <button disabled={busy||recordingBlocked} onClick={()=>void startSelected()}>{pending==='start'?t('correction.starting'):t('correction.startNew')}</button>
  </div>}
  <p className="note">{t('correction.bookmarkLimit')}</p>
  <p className="note">{t('correction.historyIndependence')}</p>
 </section>;
}
