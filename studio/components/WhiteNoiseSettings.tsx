'use client';
import {useStudioLocale} from '../i18n/react';
import {useEffect,useRef,useState} from 'react';
import {WhiteNoiseAudio,INITIAL_WHITE_NOISE_SNAPSHOT} from '../media/white-noise-audio';

/** Lives with Studio, not with the settings panel. Closing settings keeps listening. */
export function useWhiteNoiseAudio(reducedMotion:boolean){
 const audio=useRef<WhiteNoiseAudio|null>(null);
 const[state,setState]=useState(INITIAL_WHITE_NOISE_SNAPSHOT);
 useEffect(()=>{
  const current=new WhiteNoiseAudio();audio.current=current;
  const unsubscribe=current.subscribe(()=>setState(current.getSnapshot()));setState(current.getSnapshot());
  return()=>{unsubscribe();current.dispose();if(audio.current===current)audio.current=null};
 },[]);
 useEffect(()=>{if(reducedMotion)audio.current?.disable('reduced_motion')},[reducedMotion]);
 return {state,reducedMotion,setEnabled(enabled:boolean){
  if(!enabled){audio.current?.disable('user');return}
  if(reducedMotion)return;
  // No await before enable: audio unlock must remain inside this user gesture.
  void audio.current?.enable().catch(()=>{});
 },setVolume(volume:number){audio.current?.setVolume(volume)},setMonitorMuted(muted:boolean){audio.current?.setMonitorMuted(muted)}};
}

export default function WhiteNoiseSettings({control}:{control:ReturnType<typeof useWhiteNoiseAudio>}){
 const {t,ui,locale}=useStudioLocale();
 const{state,reducedMotion}=control;
 const stopped=state.disableReason==='hidden'||state.disableReason==='pagehide'||state.disableReason==='interrupted';
 return <section aria-label={t('noise.settings')}>
  <h2>{t('noise.title')}</h2>
  <label><input type="checkbox" checked={state.enabled||state.enabling} disabled={reducedMotion} onChange={e=>control.setEnabled(e.target.checked)}/>{t('noise.enable')}</label>
  <label className="field">{t('noise.volume')}<input aria-label={t('noise.volume')} type="range" min="0" max="1" step="0.05" value={state.volume} onChange={e=>control.setVolume(Number(e.target.value))}/><span>{Math.round(state.volume*100)}%</span></label>
  <p className="note" role="status">{reducedMotion?t('noise.reducedMotion'):state.enabling?t('noise.enabling'):state.enabled?t('noise.enabled'):stopped?t('noise.interrupted'):t('noise.disabled')}</p>
  {state.error&&<p className="notice warn" role="alert">{ui(state.error.message)}</p>}
  <p className="note">{t('noise.notice')}</p>
 </section>
}
