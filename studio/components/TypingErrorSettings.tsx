'use client';
import {useEffect,useRef,useState} from 'react';
import {useStudioLocale} from '../i18n/react';
import {TypingErrorFeedback,DEFAULT_TYPING_ERROR_PREFERENCES,parseTypingErrorPreferences,TYPING_ERROR_PREFERENCE_KEY,type TypingErrorPreferences} from '../media/typing-error-feedback';
import {INITIAL_SUBMISSION_AUDIO_SNAPSHOT} from '../media/submission-audio';
export function useTypingErrorFeedback(shake:(started:number|undefined)=>void,options:{muted:boolean;reduced:boolean;recording:boolean}){
 const callback=useRef(shake);callback.current=shake;
 const control=useRef<TypingErrorFeedback|null>(null);
 const [preferences,setPreferences]=useState<TypingErrorPreferences>({...DEFAULT_TYPING_ERROR_PREFERENCES});
 const preferenceRef=useRef<TypingErrorPreferences>({...DEFAULT_TYPING_ERROR_PREFERENCES});
 const [state,setState]=useState(INITIAL_SUBMISSION_AUDIO_SNAPSHOT),[storageError,setStorageError]=useState(false);
 useEffect(()=>{
  let prefs:TypingErrorPreferences;try{prefs=parseTypingErrorPreferences(localStorage.getItem(TYPING_ERROR_PREFERENCE_KEY))}catch{prefs={sound:false,motion:false};setStorageError(true)}
  preferenceRef.current=prefs;setPreferences(prefs);
  const current=new TypingErrorFeedback({shake:at=>callback.current(at),vibrate:typeof navigator.vibrate==='function'?duration=>navigator.vibrate(duration):undefined});
  control.current=current;current.configure(prefs,options);setState(current.audio.getSnapshot());
  const off=current.audio.subscribe(()=>setState(current.audio.getSnapshot()));
  const cancel=()=>current.cancel(),hide=()=>{if(document.hidden)current.suspend()},pagehide=()=>current.suspend();
  window.addEventListener('blur',cancel);window.addEventListener('pagehide',pagehide);document.addEventListener('visibilitychange',hide);
  return()=>{off();current.dispose();if(control.current===current)control.current=null;window.removeEventListener('blur',cancel);window.removeEventListener('pagehide',pagehide);document.removeEventListener('visibilitychange',hide)};
 },[]);
 useEffect(()=>{control.current?.configure(preferenceRef.current,options)},[preferences,options.muted,options.reduced,options.recording]);
 function choose(key:keyof TypingErrorPreferences,value:boolean,trusted:boolean){
  const next={...preferenceRef.current,[key]:value};preferenceRef.current=next;setPreferences(next);control.current?.configure(next,options);
  try{localStorage.setItem(TYPING_ERROR_PREFERENCE_KEY,JSON.stringify(next));setStorageError(false)}catch{setStorageError(true)}
  if(key==='sound'&&value)control.current?.retryFromGesture(trusted);
 }
 return{control,preferences,state,storageError,reduced:options.reduced,choose};
}
export default function TypingErrorSettings({feedback}:{feedback:ReturnType<typeof useTypingErrorFeedback>}){
 const {t}=useStudioLocale();const {preferences,state}=feedback;
 return <details className="display-settings"><summary>{t('typingError.title')}</summary>
  <label><input type="checkbox" checked={preferences.sound} onChange={e=>feedback.choose('sound',e.target.checked,e.nativeEvent.isTrusted)}/>{t('typingError.sound')}</label>
  <label><input type="checkbox" checked={preferences.motion} disabled={feedback.reduced} onChange={e=>feedback.choose('motion',e.target.checked,e.nativeEvent.isTrusted)}/>{t('typingError.motion')}</label>
  <p className="note">{t('typingError.notice')}</p>
  <p className="note" role="status">{!preferences.sound?t('typingError.off'):state.enabled?t('typingError.ready'):state.error||feedback.control.current?.failed?t('typingError.retry'):state.disableReason==='hidden'||state.disableReason==='pagehide'||state.disableReason==='interrupted'?t('typingError.resume'):t('typingError.gesture')}</p>
  {feedback.reduced&&<p className="note">{t('typingError.reduced')}</p>}
  {feedback.storageError&&<p className="note" role="status">{t('typingError.storage')}</p>}
 </details>;
}
