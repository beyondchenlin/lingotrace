import {useEffect,useRef,useState,type RefObject} from 'react';
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
   const prior=selectedRef.current;if(prior&&!list.entries.some(row=>sameSaved(row,prior))){clearSelection();setMessage('所选收藏已被取消、更改或不可读取，请重新选择。')}
  }catch(e){if(alive.current&&token===listEpoch.current){const detail=e instanceof Error?e.message:'语境收藏读取失败，请重试。';setError(failure?`${failure} 列表也未能刷新：${detail}`:detail);clearSelection();}}
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
   validateReference:reference=>isCurrentBookmarkReference(reference)?null:'收藏的素材版本、参考或片段关联无法核验。',
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
   if(!reread||!sameSaved(row,reread)){clearSelection();setError('收藏已被取消或更改，请刷新后重新选择。');return}
   controller.select(reread.reference);await controller.load({retry});
   if(!alive.current||token!==playEpoch.current||guard.current())return;
   const finalRead=await repository.load(row.key);
   if(!alive.current||token!==playEpoch.current)return;
   if(!finalRead||!sameSaved(reread,finalRead)){clearSelection();setError('加载期间收藏已改变，本次没有播放。');return}
   if(controller.getState().phase!=='ready'||guard.current())return;
   preparedRef.current=finalRead;setPrepared(true);setMessage('原片与保存来源已核验，请主动点击播放。');
  }catch(e){if(alive.current&&token===playEpoch.current)setError(e instanceof Error?e.message:'收藏片段未能准备；未替换为其他素材。')}
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
  try{await repository.remove(row.key,row.saveId);if(!alive.current)return;setMessage('已取消这条本机收藏。');await refresh()}
  catch(e){if(alive.current)await refresh(e instanceof Error?e.message:'取消收藏未成功，请核对刷新后的实际记录。')}
  finally{writeBusy.current=false;if(alive.current)setBusy(false)}
 }
 return <section aria-label="本机语境收藏">
  <p className="note">仅保存你主动选定的原参考与片段绑定，不是成绩、练习次数或到期复习任务。自动练习历史关闭也不会自动收集收藏。</p>
  <div className="button-row"><button disabled={loading} onClick={()=>{invalidatePrepared();void refresh()}}>刷新语境收藏</button></div>
  {loading&&<p role="status">正在读取本机收藏…</p>}
  {error&&<p className="notice warn" role="alert">{error}</p>}
  {message&&<p className="notice" role="status">{message}</p>}
  {unreadable>0&&<p className="notice warn">有 {unreadable} 条收藏无法安全读取，原数据未改写；没有替它们补造来源或成绩。</p>}
  {!loading&&!error&&!entries.length&&<p className="empty">还没有可查看的语境收藏。在本轮逐句复盘中，提交后选择词或短语，再主动保存到本机。</p>}
  <div className="attempt-list">{entries.map(row=><article className="record-card" key={row.key}>
   <h3 style={{overflowWrap:'anywhere'}}>{row.selection.text}</h3>
   <p className="note">{row.reference.materialVersion} · {row.reference.cueId} · {row.reference.startSeconds}–{row.reference.endSeconds} 秒</p>
   <div className="button-row"><button aria-pressed={selected?.key===row.key} onClick={()=>choose(row)}>查看收藏语境</button><button disabled={busy} onClick={()=>void remove(row)}>取消这条收藏</button></div>
  </article>)}</div>
  {selected&&<div aria-label="收藏语境详情">
   <h3>{selected.selection.text}</h3><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{selected.reference.text}</p>
   <p className="note">收藏时绑定的原创课程 · {selected.reference.startSeconds}–{selected.reference.endSeconds} 秒。只按保存的版本和媒体内容校验；旧练习的原媒体仍不据此补配。</p>
  </div>}
  <video ref={video} playsInline preload="metadata" hidden={!selected} aria-label="收藏原片段预览" style={{width:'100%',maxHeight:280,background:'#111'}}/>
  {selected&&<>
   <div className="button-row"><button disabled={recordingBlocked||busy||preparing||preview?.phase==='loading'} onClick={()=>void prepare()}>{preparing?'正在核验片段…':'核验并准备片段'}</button><button disabled={recordingBlocked||!prepared||preview?.phase!=='ready'} onClick={play}>播放收藏片段</button><button disabled={preview?.phase!=='playing'} onClick={()=>{++playEpoch.current;controllerRef.current?.pause()}}>暂停收藏片段</button></div>
   <p className="note" role="status">{preview?.error??(preview?.phase==='playing'?'正在回听已核验的收藏片段。':preview?.phase==='loading'?'正在核验并加载原片段…':'仅在主动点击后播放；到片段结尾停止。')}</p>
   {recordingBlocked&&<p className="notice">录制准备、进行或收尾期间不能回听收藏；结束后可主动播放。</p>}
   <p className="note">遵守课程音量、课程静音和全部监听静音。专用预览不加入任何舞台录像音轨；离开或切后台会停播，返回不会自动续播。</p>
  </>}
 </section>;
}
