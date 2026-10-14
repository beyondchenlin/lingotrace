'use client';
import {useEffect,useRef,useState} from 'react';
import {useStudioLocale} from '../i18n/react';
import {exportLayoutPlan,parseLayoutPlan,layoutPlanChanges,MAX_LAYOUT_PLAN_BYTES} from '../scene/layout-plan-file';
import type {LayoutConfiguration,LayoutContext} from '../scene/layout-transactions';
export default function LayoutPlanFiles({applied,context,onBegin,onPreview,onBusy,download}:{applied:LayoutConfiguration;context:LayoutContext;onBegin:()=>boolean;onPreview:(value:LayoutConfiguration,context:LayoutContext)=>boolean;onBusy:(busy:boolean)=>void;download:(name:string,blob:Blob)=>void}){
 const {t,ui,locale}=useStudioLocale();
 const request=useRef(0),alive=useRef(true),busyCallback=useRef(onBusy),previewCallback=useRef(onPreview);busyCallback.current=onBusy;previewCallback.current=onPreview;
 const[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current++;busyCallback.current(false)}},[]);
 async function readFile(file:File){if(!onBegin()){setMessage(t('layoutPlan.blocked'));return}const token=++request.current;setMessage('');setBusy(true);onBusy(true);
  try{if(file.size>MAX_LAYOUT_PLAN_BYTES)throw Error(t('layoutPlan.errSizeLimit'));const text=await file.text();if(!alive.current||token!==request.current)return;
   const value=parseLayoutPlan(text,context);if(!previewCallback.current(value,context))throw Error(t('layoutPlan.stale'));
   const changes=layoutPlanChanges(applied,value).map(label=>ui(label));
   const join=locale==='zh-CN'?'、':', ';
   setMessage(changes.length?t('layoutPlan.previewLoaded',{changes:changes.join(join)}):t('layoutPlan.unchanged'));
  }catch(error){if(alive.current&&token===request.current)setMessage(error instanceof Error?error.message:t('layoutPlan.readFailed'))}
  finally{if(alive.current&&token===request.current){setBusy(false);busyCallback.current(false)}}
 }
 return <section aria-label={t('layoutPlan.title')}><h3>{t('layoutPlan.heading')}</h3><p className="note">{t('layoutPlan.description')}</p>
  <div className="button-row"><button disabled={busy} onClick={()=>{try{download(`lingotrace-layout-${context.portrait?'portrait':'landscape'}.json`,new Blob([exportLayoutPlan(applied,context)],{type:'application/json'}));setMessage(t('layoutPlan.exportStarted'))}catch(error){setMessage(error instanceof Error?error.message:t('layoutPlan.exportFailed'))}}}>{t('layoutPlan.export')}</button>
  <label className="button" role="button" tabIndex={busy?-1:0} aria-disabled={busy} onKeyDown={event=>{if(!busy&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.currentTarget.querySelector<HTMLInputElement>('input')?.click()}}}>{busy?t('layoutPlan.reading'):t('layoutPlan.choose')}<input aria-label={t('layoutPlan.chooseAria')} type="file" tabIndex={-1} accept=".json,application/json" disabled={busy} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void readFile(file)}}/></label></div>
  {message&&<p role="status" className="notice">{ui(message)}</p>}
 </section>;
}
