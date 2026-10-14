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
   if(!alive.current||generation!==leaseEpoch.current||options?.signal?.aborted){acquired.release();throw new Error('校正预览已取消，请主动重新核验。')}
   let released=false;
   const tracked:OriginalCourseMediaLease={...acquired,release(){if(released)return;released=true;if(activeLease.current===tracked)activeLease.current=null;acquired.release()}};
   activeLease.current=tracked;return tracked;
  }};
  const controller=createContextBookmarkPreviewController({video:video.current,pool:trackedPool,monitor,
   validateReference:value=>sameReference(value,referenceRef.current)&&latest.current.current?.mediaId===ORIGINAL_COURSE_MEDIA.mediaId&&latest.current.current?.mediaSha256===ORIGINAL_COURSE_MEDIA.mediaSha256?null:'编辑内容、素材或片段范围已改变，请重新核验。',
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
 useEffect(()=>{if(selected&&!entries.some(row=>sameEntry(row,selected))){selection.current=null;setSelected(null);setMessage('所选版本已不可核验，请刷新后重新选择；没有自动改用其他版本。')}},[entries,selected]);
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
   if(verified)setMessage(`已核验原片实际时长 ${verified.duration} 秒；准备不会自动播放。`);
   else if(controller.getState().phase==='ready'){controller.close();setError('实际媒体来源或时长与所选版本不符，不能保存或预听。')}
  }catch(e){if(alive.current&&generation===previewEpoch.current)setError(errorMessage(e,'校正片段未能准备，请重新核验。'))}
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
  catch{setError('当前浏览器未能创建独立保存标识；没有保存新版本，请重试。');return}
  const structure=draft.mode==='edit'?{}:{structure:{operation:draft.mode,firstText:draft.text,...(draft.mode==='split'?{secondText:draft.secondText,splitAt:seconds(draft.splitAt)}:{}),confirmed:true as const}};
  const input={...structure,text:verified.reference.text,start:verified.reference.startSeconds,end:verified.reference.endSeconds,verifiedDurationSeconds:verified.duration,saveRequestId:saveRequest.current.id};
  operation.current='save';setPending('save');setError('');setMessage('');const targetIdentity=identityRef.current;
  try{
   const result=await latest.current.onSave(input);
   if(alive.current&&targetIdentity===identityRef.current)setMessage(result.disposition==='already-present'?'这次校正已保存，未重复创建版本。请显式选择版本后新开练习。':'已保存新的本机版本。当前轮未切换；请显式选择版本后新开练习。');
  }catch(e){if(alive.current&&targetIdentity===identityRef.current)setError(errorMessage(e,'新版本未能确认保存；原轮与编辑内容仍保留，可重试。'))}
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
  catch(e){if(alive.current)setError(errorMessage(e,'未能新开练习。已保存的版本仍保留，请查看当前轮的保存状态后重试。'))}
  finally{operation.current=null;if(alive.current)setPending(null)}
 }
 async function reload(){
  if(operation.current||latest.current.transitionBusy)return;
  invalidatePreview();operation.current='reload';setPending('reload');setError('');
  try{await latest.current.onReload()}
  catch(e){if(alive.current)setError(errorMessage(e,'本机版本列表未能刷新，请重试。'))}
  finally{operation.current=null;if(alive.current)setPending(null)}
 }
 const availableProof=proof();
 return <section aria-label="当前句校正与本机版本">
  <p className="note">校正生成独立的本机参考版本，不改旧答案、旧分数或已提交记录。保存版本不会结束当前轮，也不会增加练习量。</p>
  {current&&cue&&<section aria-label="当前句参考校正">
   <h3>校正当前句 · {cue.id}</h3>
   <p className="notice">校正时已查看参考。取消只撤销编辑，已发生的本轮参考展示不会清除。</p>
   <div className="button-row" aria-label="字幕编辑方式">
    <button disabled={busy||recordingBlocked||!!disabledReason} aria-pressed={edit.mode==='edit'} onClick={()=>chooseMode('edit')}>仅校正文字与时间</button>
    <button disabled={busy||recordingBlocked||!!disabledReason||!next} aria-pressed={edit.mode==='merge'} onClick={()=>chooseMode('merge')}>合并当前与后一句</button>
    <button disabled={busy||recordingBlocked||!!disabledReason} aria-pressed={edit.mode==='split'} onClick={()=>chooseMode('split')}>拆分当前句</button>
   </div>
   {structural&&<p className="note">原当前句：{cue.text}。合并／拆分将生成新句标识并保留父子关系；原句标识不复用。请明确填写新句文字并预听核对，多人对白或错位请勿直接合并。</p>}
   {edit.mode==='merge'&&next&&<p className="notice">合并 {cue.id} 与 {next.id}（{next.start}–{next.end} 秒）。后一句参考不会自动展示；请根据原片完整填写合并文字，并确认两句适合合并。</p>}
   <label>当前句参考文字<textarea aria-label="当前句参考文字" value={edit.text} disabled={busy||recordingBlocked||!!disabledReason} onChange={event=>change('text',event.target.value)} style={{width:'100%',minHeight:90}}/></label>
   <div className="button-row">
    <label>开始秒数 <input aria-label="校正开始秒数" readOnly={structural} type="number" step="any" min="0" value={edit.start} disabled={busy||recordingBlocked||!!disabledReason} onChange={event=>change('start',event.target.value)}/></label>
    <label>结束秒数 <input aria-label="校正结束秒数" readOnly={structural} type="number" step="any" min="0" value={edit.end} disabled={busy||recordingBlocked||!!disabledReason} onChange={event=>change('end',event.target.value)}/></label>
   </div>
   {edit.mode==='split'&&<>
    <label>拆分后第二句文字<textarea aria-label="拆分后第二句文字" value={edit.secondText} disabled={busy||recordingBlocked||!!disabledReason} onChange={event=>change('secondText',event.target.value)} style={{width:'100%',minHeight:70}}/></label>
    <label>拆分时间点秒数<input aria-label="拆分时间点秒数" type="number" step="any" value={edit.splitAt} disabled={busy||recordingBlocked||!!disabledReason} onChange={event=>change('splitAt',event.target.value)}/></label>
    <p className="note">第一句 {start}–{Number.isFinite(splitAt)?splitAt:'待填'} 秒；第二句 {Number.isFinite(splitAt)?splitAt:'待填'}–{end} 秒。两句文字与分界必须由你确认，不自动断句。</p>
   </>}
   {invalidStructure&&<p className="notice warn">请完整填写新句文字与内部拆分点。合并需修改为完整文字；原边界必须保留，且不能与相邻句重叠。</p>}
   {structural&&<button disabled={busy||recordingBlocked||!!disabledReason||invalidText||invalidRange||invalidStructure} aria-pressed={edit.confirmed} onClick={confirmStructure}>{edit.confirmed?'已确认新句结构':'确认新句结构'}</button>}
   {invalidText&&<p className="notice warn">参考文字须含可评分的英文单词或数字。</p>}
   {invalidRange&&<p className="notice warn">请输入有限秒数，并满足 0 ≤ 开始 &lt; 结束；不会自动裁剪或修正。</p>}
   {!invalidRange&&previous&&start!==previous.end&&<p className="note">{start<previous.end?'与前一句时间有重叠':'与前一句时间有间隔'}，请预听确认。前一句结束于 {previous.end} 秒。</p>}
   {!invalidRange&&following&&end!==following.start&&<p className="note">{end>following.start?'与后一句时间有重叠':'与后一句时间有间隔'}，请预听确认。后一句开始于 {following.start} 秒。</p>}
   {disabledReason&&<p className="notice warn">{ui(disabledReason)}</p>}
   <p className="note">{availableProof?`实际已核验时长：${availableProof.duration} 秒。`:'实际时长与原片来源尚未完成当前编辑范围的核验；不能保存。'}</p>
  </section>}
  <video ref={video} playsInline preload="metadata" hidden={!current} aria-label="校正原片段预览" style={{width:'100%',maxHeight:280,background:'#111'}}/>
  {current&&cue&&<>
   <div className="button-row">
    <button disabled={busy||recordingBlocked||!!disabledReason||preparing||invalidText||invalidRange} onClick={()=>void prepare()}>{preparing?'正在核验校正片段…':'核验校正片段'}</button>
    <button disabled={busy||recordingBlocked||!availableProof} onClick={play}>预听校正片段</button>
    <button disabled={preview?.phase!=='playing'} onClick={()=>controllerRef.current?.pause()}>暂停校正片段</button>
    <button disabled={busy||recordingBlocked||!changed||invalidText||invalidRange||invalidStructure||(structural&&!edit.confirmed)||!availableProof} onClick={()=>void save()}>{pending==='save'?'正在保存新版本…':'保存为新的本机版本'}</button>
   </div>
   {preview?.error&&<p className="notice warn" role="alert">{preview.error}</p>}
   {recordingBlocked&&<p className="notice">录制准备、进行或收尾期间不能核验或预听；结束后须主动重新核验。</p>}
   <p className="note">预听遵守课程音量、课程静音与全部监听静音，不加入舞台录像音轨。关闭、切后台或开始录制会停止并释放预览；返回不会自动续播。</p>
  </>}
  <div className="button-row"><button disabled={busy} onClick={cancel}>{current?'取消编辑并关闭':'关闭版本列表'}</button><button disabled={busy} onClick={()=>void reload()}>{pending==='reload'?'正在刷新版本…':'刷新本机版本'}</button></div>
  {error&&<p className="notice warn" role="alert">{error}</p>}
  {message&&<p className="notice" role="status">{message}</p>}
  <h3>已保存的本机版本</h3>
  <p className="note">列表只展示版本信息；选择不会展示其他句参考或自动采用最新版本。新开练习后会再次明确展示所选版本的目标句参考。</p>
  {unreadableCount>0&&<p className="notice warn">有 {unreadableCount} 条版本无法安全读取，原数据未改写。</p>}
  {!entries.length&&<p className="empty">还没有已保存的校正版本。</p>}
  <div className="attempt-list">{entries.map(row=><article className="record-card" key={row.key}>
   <h4 style={{overflowWrap:'anywhere'}}>{row.material.version}</h4>
   {row.material.localReference?.lineage&&<p className="note" style={{overflowWrap:'anywhere'}}>{row.material.localReference.lineage.operation==='merge'?'合并 2 句为 1 句':'拆分 1 句为 2 句'} · 父句 {row.material.localReference.lineage.parentUnitIds.join('、')} · 新句 {row.material.localReference.lineage.unitIds.join('、')}</p>}
   <p className="note">目标句 {row.change.cueId} · 父版本 {row.parent.version} · {row.createdAt}</p>
   <button disabled={busy} aria-pressed={selection.current?.key===row.key} onClick={()=>choose(row)}>选择此版本</button>
  </article>)}</div>
  {selection.current&&<div aria-label="所选校正版本">
   <p className="note">已选择 {selection.current.material.version} · {selection.current.change.cueId}。将先安全保存允许保留的当前轮，再按所选版本开始新轮。</p>
   <button disabled={busy||recordingBlocked} onClick={()=>void startSelected()}>{pending==='start'?'正在安全切换练习…':'结束当前轮，使用此版本新开练习'}</button>
  </div>}
  <p className="note">校正版本暂不支持语境书签；不会把它的文字或时间冒充原版书签。</p>
  <p className="note">本机版本库与自动练习历史独立。只有获准保存的完整 Training 会话可恢复整轮；历史关闭或仅保存片段时，刷新不会恢复被排除的练习，可从已保存版本显式新开。</p>
 </section>;
}
