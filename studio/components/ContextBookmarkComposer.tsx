import {useEffect,useRef,useState} from 'react';
import {contextBookmarkWords,type ContextBookmarkReference} from '../core/context-bookmark';
import type {ContextBookmarkSaveResult} from '../core/context-bookmark-repository';
import {useStudioLocale} from '../i18n/react';

/** Only rendered beneath a submitted reference; this component never reads a
 * draft, makes a Training event, or writes without the explicit Save button. */
export default function ContextBookmarkComposer({reference,disabledReason,onSave,onOpenLibrary}:{
 reference:ContextBookmarkReference|null; disabledReason:string|null;
 onSave:(start:number,end:number)=>Promise<ContextBookmarkSaveResult>;
 onOpenLibrary:()=>void;
}){
 const {t,ui}=useStudioLocale();
 const words=reference?contextBookmarkWords(reference):[];
 const[first,setFirst]=useState(0),[last,setLast]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const active=useRef(true),pending=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
 if(!reference||!words.length)return null;
 const start=words[Math.min(first,words.length-1)],end=words[Math.min(Math.max(last,first),words.length-1)];
 const cueNumber=reference.cueId.split('-').at(-1)??'';
 async function save(){
  if(disabledReason||pending.current)return;
  pending.current=true;setBusy(true);setMessage('');
  try{const result=await onSave(start.start,end.end);if(active.current)setMessage(result.disposition==='already-present'?t('bookmark.alreadyPresent'):t('bookmark.saved'));}
  catch(error){if(active.current)setMessage(error instanceof Error?error.message:t('bookmark.saveFailed'));}
  finally{pending.current=false;if(active.current)setBusy(false)}
 }
 return <section aria-label={t('bookmark.cueAria',{number:cueNumber})}>
  <h4>{t('bookmark.sectionLabel')}</h4>
  <div className="button-row">
   <label>{t('bookmark.startWord')} <select aria-label={t('bookmark.startAria')} value={first} disabled={busy} onChange={e=>{const n=Number(e.target.value);setFirst(n);setLast(v=>Math.max(v,n));setMessage('')}}>{words.map((word,i)=><option value={i} key={word.start}>{i+1}. {word.text}</option>)}</select></label>
   <label>{t('bookmark.endWord')} <select aria-label={t('bookmark.endAria')} value={Math.max(first,last)} disabled={busy} onChange={e=>{setLast(Number(e.target.value));setMessage('')}}>{words.map((word,i)=>i>=first?<option value={i} key={word.start}>{i+1}. {word.text}</option>:null)}</select></label>
  </div>
  <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{t('bookmark.selected')}{reference.text.slice(start.start,end.end)}</p>
  <p className="note">{t('bookmark.note')}</p>
  {disabledReason&&<p className="notice">{ui(disabledReason)}</p>}
  <div className="button-row"><button disabled={busy||!!disabledReason} onClick={()=>void save()}>{busy?t('bookmark.saving'):t('bookmark.save')}</button><button onClick={onOpenLibrary}>{t('bookmark.openLibrary')}</button></div>
  {message&&<p role="status" className="notice">{ui(message)}</p>}
 </section>;
}
