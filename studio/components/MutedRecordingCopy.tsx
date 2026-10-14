'use client';
import {useEffect,useRef,useState} from 'react';
import {createMutedCopyController,type MutedCopyState} from '../media/muted-copy-controller';
import type {RecordMeta} from '../media/scene-recorder';
import {useStudioLocale} from '../i18n/react';

/** An isolated, memory-only export view. It never owns live training media. */
export default function MutedRecordingCopy({record,load,onClose,blocked=false}:{record:RecordMeta;load:(id:string)=>Promise<Blob>;onClose:()=>void;blocked?:boolean}){
 const {locale,t,ui}=useStudioLocale();
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
 const checked=state?.info?t('mutedCopy.checked',{width:state.info.width,height:state.info.height,source:state.info.sourceDurationSeconds.toFixed(2),copy:state.info.durationSeconds.toFixed(2)}):'';
 return <section className="record-card" aria-label={t('mutedCopy.aria')}>
  <h2>{t('mutedCopy.title')}</h2>
  <p>{t('mutedCopy.original',{when:new Date(record.startedAt).toLocaleString(locale)})}</p>
  <p className="notice">{t('mutedCopy.notice')}</p>
  <p className="note">{t('mutedCopy.note')}</p>
  <label><input type="checkbox" checked={state?.consent??false} disabled={busy||blocked||!state} onChange={e=>controller.current?.setConsent(e.target.checked)}/>{t('mutedCopy.consent')}</label>
  {blocked&&<p className="notice warn" role="status">{t('mutedCopy.blocked')}</p>}
  {state?.error&&<p className="notice warn" role="alert">{ui(state.error)}</p>}
  <div className="button-row">
   <button disabled={!state?.consent||busy||blocked||state?.phase==='ready'} onClick={()=>void controller.current?.generate()}>{busy?t('mutedCopy.generating'):t('mutedCopy.generate')}</button>
   <button onClick={()=>controller.current?.cancel()}>{t('mutedCopy.cancel')}</button>
   <button onClick={()=>{controller.current?.close();onClose()}}>{t('mutedCopy.back')}</button>
  </div>
  {state?.previewUrl&&<>
   <video key={state.previewUrl} className="record-preview" aria-label={t('mutedCopy.previewAria')} src={state.previewUrl} controls playsInline preload="metadata" onPlaying={e=>controller.current?.markPreviewed(e.currentTarget.getAttribute('src')??'')} onError={e=>controller.current?.previewFailed(e.currentTarget.getAttribute('src')??'')}/>
   <p className="note" role="status">{t('mutedCopy.previewNote',{checked})}</p>
   <button disabled={!state.previewed||blocked} onClick={()=>controller.current?.download()}>{t('mutedCopy.download')}</button>
  </>}
 </section>
}
