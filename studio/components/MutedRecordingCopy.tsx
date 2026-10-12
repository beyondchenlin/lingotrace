'use client';
import {useEffect,useRef,useState} from 'react';
import {createMutedCopyController,type MutedCopyState} from '../media/muted-copy-controller';
import type {RecordMeta} from '../media/scene-recorder';

/** An isolated, memory-only export view. It never owns live training media. */
export default function MutedRecordingCopy({record,load,onClose,blocked=false}:{record:RecordMeta;load:(id:string)=>Promise<Blob>;onClose:()=>void;blocked?:boolean}){
 const controller=useRef<ReturnType<typeof createMutedCopyController>|null>(null);
 const loadRef=useRef(load);loadRef.current=load;
 const[state,setState]=useState<MutedCopyState|null>(null);
 useEffect(()=>{
  const current=createMutedCopyController({load:id=>loadRef.current(id)});controller.current=current;
  const unsubscribe=current.subscribe(()=>setState(current.getState()));current.select(record);setState(current.getState());
  const hide=()=>{if(document.hidden)current.background()};const leave=()=>current.background();
  document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);
  return()=>{unsubscribe();document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);current.dispose();if(controller.current===current)controller.current=null};
 },[record]);
 useEffect(()=>{if(blocked)controller.current?.cancel()},[blocked]);
 const busy=state?.phase==='generating';
 return <section className="record-card" aria-label="生成录像静音副本">
  <h2>录像静音副本</h2>
  <p>原件：{new Date(record.startedAt).toLocaleString()}</p>
  <p className="notice">将去除整条混音，包括课程声音、麦克风和环境声。画面、已烧录字幕、人脸与输入内容全部保留；这不是脱敏处理。</p>
  <p className="note">原件不变。副本只在本页临时生成，不会自动保存到录像库或发送出去。当前支持可验证的 WebM VP8 / VP9 录像，最多 256 MB；不支持的文件会明确拒绝。</p>
  <label><input type="checkbox" checked={state?.consent??false} disabled={busy||blocked||!state} onChange={e=>controller.current?.setConsent(e.target.checked)}/>我选择去除全部声音，并知晓上述画面内容仍然保留</label>
  {blocked&&<p className="notice warn" role="status">请先结束当前录制，再生成副本。</p>}
  {state?.error&&<p className="notice warn" role="alert">{state.error}</p>}
  <div className="button-row">
   <button disabled={!state?.consent||busy||blocked||state?.phase==='ready'} onClick={()=>void controller.current?.generate()}>{busy?'正在生成并检查…':'生成静音副本'}</button>
   <button onClick={()=>controller.current?.cancel()}>取消并丢弃副本</button>
   <button onClick={()=>{controller.current?.close();onClose()}}>返回录像列表</button>
  </div>
  {state?.previewUrl&&<>
   <video key={state.previewUrl} className="record-preview" aria-label="静音副本预览" src={state.previewUrl} controls playsInline preload="metadata" onPlaying={e=>controller.current?.markPreviewed(e.currentTarget.getAttribute('src')??'')} onError={e=>controller.current?.previewFailed(e.currentTarget.getAttribute('src')??'')}/>
   <p className="note" role="status">音轨已移除，视频帧与时间戳保留。{state.info&&<>已检查 {state.info.width} × {state.info.height}；原件 {state.info.sourceDurationSeconds.toFixed(2)} 秒，副本 {state.info.durationSeconds.toFixed(2)} 秒。去掉末尾纯音频时，总播放时长可能缩短。</>}请先播放检查画面，再主动下载。</p>
   <button disabled={!state.previewed||blocked} onClick={()=>controller.current?.download()}>下载静音副本</button>
  </>}
 </section>
}
