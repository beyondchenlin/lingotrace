'use client';
import {useEffect,useRef,useState} from 'react';
import {exportLayoutPlan,parseLayoutPlan,layoutPlanChanges,MAX_LAYOUT_PLAN_BYTES} from '../scene/layout-plan-file';
import type {LayoutConfiguration,LayoutContext} from '../scene/layout-transactions';
export default function LayoutPlanFiles({applied,context,onBegin,onPreview,onBusy,download}:{applied:LayoutConfiguration;context:LayoutContext;onBegin:()=>boolean;onPreview:(value:LayoutConfiguration,context:LayoutContext)=>boolean;onBusy:(busy:boolean)=>void;download:(name:string,blob:Blob)=>void}){
 const request=useRef(0),alive=useRef(true),busyCallback=useRef(onBusy),previewCallback=useRef(onPreview);busyCallback.current=onBusy;previewCallback.current=onPreview;
 const[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current++;busyCallback.current(false)}},[]);
 async function readFile(file:File){if(!onBegin()){setMessage('当前不能预览布局，请先退出录制或其他预览。');return}const token=++request.current;setMessage('');setBusy(true);onBusy(true);
  try{if(file.size>MAX_LAYOUT_PLAN_BYTES)throw Error('布局文件不能超过 64 KiB。');const text=await file.text();if(!alive.current||token!==request.current)return;
   const value=parseLayoutPlan(text,context);if(!previewCallback.current(value,context))throw Error('当前状态已变化，未载入布局；请重新选择文件。');
   const changes=layoutPlanChanges(applied,value);setMessage(changes.length?`已载入预览：${changes.join('、')}。选择“应用布局”后才保存。`:'文件与已应用布局相同，无需更改。');
  }catch(error){if(alive.current&&token===request.current)setMessage(error instanceof Error?error.message:'无法读取布局文件。')}
  finally{if(alive.current&&token===request.current){setBusy(false);busyCallback.current(false)}}
 }
 return <section aria-label="布局方案文件"><h3>保存与恢复布局</h3><p className="note">仅含当前方向的几何和主次；不含草稿、成绩或媒体。文件在此浏览器读取，不上传。</p>
  <div className="button-row"><button disabled={busy} onClick={()=>{try{download(`lingotrace-layout-${context.portrait?'portrait':'landscape'}.json`,new Blob([exportLayoutPlan(applied,context)],{type:'application/json'}));setMessage('已发起已应用布局下载，请检查浏览器下载列表。')}catch(error){setMessage(error instanceof Error?error.message:'无法导出布局。')}}}>导出已应用布局</button>
  <label className="button" role="button" tabIndex={busy?-1:0} aria-disabled={busy} onKeyDown={event=>{if(!busy&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.currentTarget.querySelector<HTMLInputElement>('input')?.click()}}}>{busy?'正在读取…':'选择布局 JSON 预览'}<input aria-label="选择布局 JSON 预览" type="file" tabIndex={-1} accept=".json,application/json" disabled={busy} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void readFile(file)}}/></label></div>
  {message&&<p role="status" className="notice">{message}</p>}
 </section>;
}
