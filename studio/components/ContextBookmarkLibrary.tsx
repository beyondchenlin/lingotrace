import {useEffect,useRef,useState,type RefObject} from 'react';
import {useStudioLocale} from '../i18n/react';
import {isCurrentBookmarkReference,type ContextBookmark} from '../core/context-bookmark';
import type {IndexedDBContextBookmarkRepository} from '../core/context-bookmark-repository';
import {createContextBookmarkPreviewController,createOriginalCourseMediaPool} from '../media/context-bookmark-media';

type PreviewController=ReturnType<typeof createContextBookmarkPreviewController>;
type PreviewState=ReturnType<PreviewController['getState']>;
type MediaPool=ReturnType<typeof createOriginalCourseMediaPool>;
type Monitor={volume:number;courseMuted:boolean;allMuted:boolean};
const sameSaved=(a:ContextBookmark,b:ContextBookmark)=>a.key===b.key&&a.saveId===b.saveId&&JSON.stringify(a)===JSON.stringify(b);

/** Separate local library and player. It cannot call the Training engine or the
 * stage recorder; source identity is reread before every explicit playback. */
export default function ContextBookmarkLibrary({repository,pool,controllerRef,monitor,recordingBlocked,isRecordingBlocked,onBeforePlay}:{
 repository:IndexedDBContextBookmarkRepository;pool:MediaPool;controllerRef:RefObject<PreviewController|null>;
 monitor:Monitor;recordingBlocked:boolean;isRecordingBlocked:()=>boolean;onBeforePlay:()=>boolean;
}){
 const {t,ui}=useStudioLocale();
 const video=useRef<HTMLVideoElement>(null),alive=useRef(false),listEpoch=useRef(0),playEpoch=useRef(0);
 const selectedRef=useRef<ContextBookmark|null>(null),guard=useRef(isRecordingBlocked),beforePlay=useRef(onBeforePlay);
 guard.current=isRecordingBlocked;beforePlay.current=onBeforePlay;
 const[entries,setEntries]=useState<readonly ContextBookmark[]>([]),[unreadable,setUnreadable]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const[selected,setSelected]=useState<ContextBookmark|null>(null),[preview,setPreview]=useState<PreviewState|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const writeBusy=useRef(false),preparedRef=useRef<ContextBookmark|null>(null);
 const[preparing,setPreparing]=useState(false),[prepared,setPrepared]=useState(false);
 function invalidatePrepared(){++playEpoch.current;preparedRef.current=null;setPrepared(false);setPreparing(false);setMessage('');controllerRef.current?.close()}
 function clearSelection(){invalidatePrepared();controllerRef.current?.select(null);selectedRef.current=null;setSelected(null);setMessage('')}
 async function refresh(failure?:string){
  const token=++listEpoch.current;setLoading(true);setError(failure??'');
  try{const list=await repository.list();if(!alive.current||token!==listEpoch.current)return;
   setEntries(list.entries);setUnreadable(list.unreadableCount);
   const prior=selectedRef.current;if(prior&&!list.entries.some(row=>sameSaved(row,prior))){clearSelection();setMessage(t('library.reselect'))}
  }catch(e){if(alive.current&&token===listEpoch.current){const detail=e instanceof Error?e.message:t('library.readFailed');setError(failure?t('library.listRefreshFailed',{failure,details:detail}):detail);clearSelection();}}
  finally{if(alive.current&&token===listEpoch.current)setLoading(false)}
 }
 useEffect(()=>{
  alive.current=true;
  const changed=()=>{invalidatePrepared();void refresh()};
  const unsubscribe=repository.subscribe(changed);
  const hidden=()=>{if(document.hidden)invalidatePrepared()};
  window.addEventListener('focus',changed);window.addEventListener('pagehide',invalidatePrepared);document.addEventListener('visibilitychange',hidden);void refresh();
  return()=>{alive.current=false;++listEpoch.current;++playEpoch.current;unsubscribe();window.removeEventListener('focus',changed);window.removeEventListener('pagehide',invalidatePrepared);document.removeEventListener('visibilitychange',hidden)};
 },[repository]);
 useEffect(()=>{
  if(!video.current)return;
  const controller=createContextBookmarkPreviewController({video:video.current,pool,
   validateReference:reference=>isCurrentBookmarkReference(reference)?null:t('library.invalidReference'),
   monitor,isRecordingBlocked:()=>guard.current(),
  });
  controllerRef.current=controller;setPreview(controller.getState());
  const unsubscribe=controller.subscribe(()=>setPreview(controller.getState()));
  return()=>{++playEpoch.current;unsubscribe();controller.dispose();if(controllerRef.current===controller)controllerRef.current=null};
 },[pool,controllerRef]);
 useEffect(()=>{controllerRef.current?.setMonitor(monitor)},[monitor.volume,monitor.courseMuted,monitor.allMuted]);
 useEffect(()=>{controllerRef.current?.setRecordingBlocked(recordingBlocked);if(recordingBlocked){++playEpoch.current;preparedRef.current=null;setPrepared(false);setPreparing(false);setMessage('')}},[recordingBlocked]);
 function choose(row:ContextBookmark){invalidatePrepared();controllerRef.current?.select(row.reference);selectedRef.current=row;setSelected(row);setError('');setMessage('')}
 async function prepare(){
  const row=selectedRef.current,controller=controllerRef.current;
  if(!row||!controller||guard.current()||preparing)return;
  const retry=controller.getState().phase==='error';controller.close();
  preparedRef.current=null;setPrepared(false);setPreparing(true);
  const token=++playEpoch.current;setError('');setMessage('');
  try{
   const reread=await repository.load(row.key);
   if(!alive.current||token!==playEpoch.current)return;
   if(!reread||!sameSaved(row,reread)){clearSelection();setError(t('library.changedReselect'));return}
   controller.select(reread.reference);await controller.load({retry});
   if(!alive.current||token!==playEpoch.current||guard.current())return;
   const finalRead=await repository.load(row.key);
   if(!alive.current||token!==playEpoch.current)return;
   if(!finalRead||!sameSaved(reread,finalRead)){clearSelection();setError(t('library.changedNoPlay'));return}
   if(controller.getState().phase!=='ready'||guard.current())return;
   preparedRef.current=finalRead;setPrepared(true);setMessage(t('library.verifiedReady'));
  }catch(e){if(alive.current&&token===playEpoch.current)setError(e instanceof Error?e.message:t('library.prepareFailed'))}
  finally{if(alive.current&&token===playEpoch.current)setPreparing(false)}
 }
 function play(){
  const row=selectedRef.current,controller=controllerRef.current,preparedRow=preparedRef.current;
  if(!row||!preparedRow||!sameSaved(row,preparedRow)||!controller||controller.getState().phase!=='ready'||guard.current()||!beforePlay.current())return;
  setMessage('');void controller.play();
 }
 async function remove(row:ContextBookmark){
  if(writeBusy.current)return;writeBusy.current=true;setBusy(true);setError('');
  if(selectedRef.current?.key===row.key)clearSelection();else invalidatePrepared();
  try{await repository.remove(row.key,row.saveId);if(!alive.current)return;setMessage(t('library.removed'));await refresh()}
  catch(e){if(alive.current)await refresh(e instanceof Error?e.message:t('library.removeFailed'))}
  finally{writeBusy.current=false;if(alive.current)setBusy(false)}
 }
 const statusNote=preview?.error?ui(preview.error):(preview?.phase==='playing'?t('library.playing'):preview?.phase==='loading'?t('library.loadingClip'):t('library.playHint'));
 return <section aria-label={t('library.title')}>
  <p className="note">{t('library.description')}</p>
  <div className="button-row"><button disabled={loading} onClick={()=>{invalidatePrepared();void refresh()}}>{t('library.refresh')}</button></div>
  {loading&&<p role="status">{t('library.loading')}</p>}
  {error&&<p className="notice warn" role="alert">{ui(error)}</p>}
  {message&&<p className="notice" role="status">{ui(message)}</p>}
  {unreadable>0&&<p className="notice warn">{t('library.unreadable',{count:unreadable})}</p>}
  {!loading&&!error&&!entries.length&&<p className="empty">{t('library.empty')}</p>}
  <div className="attempt-list">{entries.map(row=><article className="record-card" key={row.key}>
   <h3 style={{overflowWrap:'anywhere'}}>{row.selection.text}</h3>
   <p className="note">{t('library.range',{version:row.reference.materialVersion,cueId:row.reference.cueId,start:row.reference.startSeconds,end:row.reference.endSeconds})}</p>
   <div className="button-row"><button aria-pressed={selected?.key===row.key} onClick={()=>choose(row)}>{t('library.view')}</button><button disabled={busy} onClick={()=>void remove(row)}>{t('library.remove')}</button></div>
  </article>)}</div>
  {selected&&<div aria-label={t('library.detail')}>
   <h3>{selected.selection.text}</h3><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{selected.reference.text}</p>
   <p className="note">{t('library.boundCourse',{start:selected.reference.startSeconds,end:selected.reference.endSeconds})}</p>
  </div>}
  <video ref={video} playsInline preload="metadata" hidden={!selected} aria-label={t('library.previewAria')} style={{width:'100%',maxHeight:280,background:'#111'}}/>
  {selected&&<>
   <div className="button-row"><button disabled={recordingBlocked||busy||preparing||preview?.phase==='loading'} onClick={()=>void prepare()}>{preparing?t('library.preparing'):t('library.prepare')}</button><button disabled={recordingBlocked||!prepared||preview?.phase!=='ready'} onClick={play}>{t('library.play')}</button><button disabled={preview?.phase!=='playing'} onClick={()=>{++playEpoch.current;controllerRef.current?.pause()}}>{t('library.pause')}</button></div>
   <p className="note" role="status">{statusNote}</p>
   {recordingBlocked&&<p className="notice">{t('library.recordingBlocked')}</p>}
   <p className="note">{t('library.monitorNote')}</p>
  </>}
 </section>;
}
