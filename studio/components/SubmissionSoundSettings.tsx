'use client';
import {useStudioLocale} from '../i18n/react';
import {useEffect,useRef,useState} from 'react';
import {SubmissionAudio,INITIAL_SUBMISSION_AUDIO_SNAPSHOT} from '../media/submission-audio';
export function useSubmissionAudio(reducedMotion:boolean){
 const audio=useRef<SubmissionAudio|null>(null);
 const[state,setState]=useState(INITIAL_SUBMISSION_AUDIO_SNAPSHOT);
 useEffect(()=>{const current=new SubmissionAudio();audio.current=current;const off=current.subscribe(()=>setState(current.getSnapshot()));setState(current.getSnapshot());return()=>{off();current.dispose();if(audio.current===current)audio.current=null}},[]);
 useEffect(()=>{if(reducedMotion)audio.current?.disable()},[reducedMotion]);
 return{audio,state,reducedMotion,setEnabled(enabled:boolean){if(!enabled){audio.current?.disable();return}if(!reducedMotion)void audio.current?.enable().catch(()=>{})},setVolume(v:number){audio.current?.setVolume(v)}};
}
export default function SubmissionSoundSettings({control}:{control:ReturnType<typeof useSubmissionAudio>}){
 const {t,ui,locale}=useStudioLocale();
 const{state,reducedMotion}=control;
 return <section aria-label={t('sound.settings')}><h2>{t('sound.title')}</h2>
 <label><input type="checkbox" checked={state.enabled||state.enabling} disabled={reducedMotion} onChange={e=>control.setEnabled(e.target.checked)}/>{t('sound.enable')}</label>
 <label className="field">{t('sound.volume')}<input aria-label={t('sound.volumeLabel')} type="range" min="0" max="1" step="0.05" value={state.volume} onChange={e=>control.setVolume(Number(e.target.value))}/><span>{Math.round(state.volume*100)}%</span></label>
 <p role="status" className="note">{reducedMotion?t('sound.reducedMotion'):state.enabling?t('sound.enabling'):state.enabled?t('sound.enabled'):t('sound.disabled')}</p>
 {state.error&&<p role="alert" className="notice warn">{ui(state.error.message)}</p>}
 <p className="note">{t('sound.notice')}</p></section>;
}
