import {useEffect,useRef,useState} from 'react';
import {contextBookmarkWords,type ContextBookmarkReference} from '../core/context-bookmark';
import type {ContextBookmarkSaveResult} from '../core/context-bookmark-repository';

/** Only rendered beneath a submitted reference; this component never reads a
 * draft, makes a Training event, or writes without the explicit Save button. */
export default function ContextBookmarkComposer({reference,disabledReason,onSave,onOpenLibrary}:{
 reference:ContextBookmarkReference|null; disabledReason:string|null;
 onSave:(start:number,end:number)=>Promise<ContextBookmarkSaveResult>;
 onOpenLibrary:()=>void;
}){
 const words=reference?contextBookmarkWords(reference):[];
 const[first,setFirst]=useState(0),[last,setLast]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const active=useRef(true),pending=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
 if(!reference||!words.length)return null;
 const start=words[Math.min(first,words.length-1)],end=words[Math.min(Math.max(last,first),words.length-1)];
 async function save(){
  if(disabledReason||pending.current)return;
  pending.current=true;setBusy(true);setMessage('');
  try{const result=await onSave(start.start,end.end);if(active.current)setMessage(result.disposition==='already-present'?'这段语境已在本机收藏，没有重复创建。':'已保存到本机收藏。');}
  catch(error){if(active.current)setMessage(error instanceof Error?error.message:'收藏未能保存，请重试；没有记作保存成功。');}
  finally{pending.current=false;if(active.current)setBusy(false)}
 }
 return <section aria-label={`收藏第 ${reference.cueId.split('-').at(-1)} 句语境`}>
  <h4>收藏参考中的词或短语</h4>
  <div className="button-row">
   <label>起始词 <select aria-label="收藏起始词" value={first} disabled={busy} onChange={e=>{const n=Number(e.target.value);setFirst(n);setLast(v=>Math.max(v,n));setMessage('')}}>{words.map((word,i)=><option value={i} key={word.start}>{i+1}. {word.text}</option>)}</select></label>
   <label>结束词 <select aria-label="收藏结束词" value={Math.max(first,last)} disabled={busy} onChange={e=>{setLast(Number(e.target.value));setMessage('')}}>{words.map((word,i)=>i>=first?<option value={i} key={word.start}>{i+1}. {word.text}</option>:null)}</select></label>
  </div>
  <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>所选：{reference.text.slice(start.start,end.end)}</p>
  <p className="note">主动保存原参考、选区和已核验课程片段到本机，不保存你的答案或草稿。与自动练习历史开关独立；不增加成绩、练习量或复习任务。</p>
  {disabledReason&&<p className="notice">{disabledReason}</p>}
  <div className="button-row"><button disabled={busy||!!disabledReason} onClick={()=>void save()}>{busy?'正在保存收藏…':'保存到本机收藏'}</button><button onClick={onOpenLibrary}>查看语境收藏</button></div>
  {message&&<p role="status" className="notice">{message}</p>}
 </section>;
}
