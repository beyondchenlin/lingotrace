import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HudCanvas } from '../HudCanvas.tsx';
import type { DataState, InputPulseEvent } from '../schema.ts';
import { COMPONENT_TYPES, fixtureScene } from './fixtures.ts';
import { classifyInputType, commitInput, emptyInputSample, inputScene, setInputPaused } from './input-model.ts';
import { HUD_PREVIEW_PATHS } from './preview-paths.ts';
import './style.css';
function App(){
  const [mode,setMode]=useState<'fixture'|'input'>('fixture'),[state,setState]=useState<DataState['status']>('ready');
  const [reduced,setReduced]=useState(false),[staticMotion,setStaticMotion]=useState(false),[backplate,setBackplate]=useState(0),[outline,setOutline]=useState(0);
  const [now,setNow]=useState(0),[sample,setSample]=useState(()=>emptyInputSample(0)),[notice,setNotice]=useState('');
  const origin=useRef<number|null>(null),compose=useRef(false),pendingSource=useRef<InputPulseEvent['source']>('other');
  const nowRef=useRef(0),sampleRef=useRef(sample);sampleRef.current=sample;
  useEffect(()=>{let id=0;const tick=(timestamp:number)=>{origin.current??=timestamp;nowRef.current=timestamp-origin.current;setNow(nowRef.current);id=requestAnimationFrame(tick);};id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id);},[]);
  useEffect(()=>{const mq=matchMedia('(prefers-reduced-motion: reduce)');setReduced(mq.matches);const changed=()=>setReduced(mq.matches);mq.addEventListener('change',changed);return()=>mq.removeEventListener('change',changed);},[]);
  const commit=(value:string,source:InputPulseEvent['source'])=>{try{const next=commitInput(sampleRef.current,value,source,nowRef.current);sampleRef.current=next;setSample(next);setNotice('');}catch(e){setNotice(e instanceof Error?e.message:String(e));}};
  const pause=()=>{const next=setInputPaused(sampleRef.current,sampleRef.current.pausedAtMs===null,nowRef.current);sampleRef.current=next;setSample(next);};
  const fixtureState:DataState=state==='paused'?{status:'paused',frozenAtMs:30000}:state==='error'?{status:'error',message:'Demonstration: source unavailable'}:state==='no-data'?{status:'no-data',message:'Demonstration: no observations'}:{status:'ready'};
  return <main>
    <header className="intro"><p className="eyebrow">LINGOTRACE · DISPLAY INSTRUMENTS / v0.1</p><h1>Small instruments.<br/><span>Honest signals.</span></h1><p className="intro-copy">独立的数据展示构件。统一字段、明确状态、透明合成。<br/>这是开发样本库，不是训练界面，也不连接用户数据库。</p></header>
    <section className="controls" aria-label="Showcase controls"><div className="switch" role="group" aria-label="Data source"><button aria-pressed={mode==='fixture'} onClick={()=>setMode('fixture')}>固定演示数据</button><button aria-pressed={mode==='input'} onClick={()=>setMode('input')}>本页真实输入</button></div>
      {mode==='fixture'?<label>状态<select value={state} onChange={e=>setState(e.target.value as DataState['status'])}><option value="ready">正常</option><option value="no-data">无数据</option><option value="paused">暂停</option><option value="error">错误</option></select></label>:<button onClick={pause}>{sample.pausedAtMs===null?'暂停输入':'继续输入'}</button>}
      <label className="checkbox"><input type="checkbox" checked={reduced} onChange={e=>setReduced(e.target.checked)}/>低动态</label><label className="checkbox"><input type="checkbox" checked={staticMotion} onChange={e=>setStaticMotion(e.target.checked)}/>静态</label>
      <label>局部底色<input type="range" min="0" max="0.9" step="0.1" value={backplate} onChange={e=>setBackplate(Number(e.target.value))}/></label><label>文字描边<input type="range" min="0" max="2" step="0.5" value={outline} onChange={e=>setOutline(Number(e.target.value))}/></label>
    </section>
    <p className="source-note" data-testid="source-note">{mode==='fixture'?'FIXTURE / 以下数字和事件均为演示数据，不是用户训练结果。':'LIVE INPUT / 只统计本页提交的输入事件；不评分、不保存、刷新清空。'}</p>
    {mode==='input'&&<section className="input-lab"><label htmlFor="sample-input">试着输入英文或用输入法提交文字</label><textarea id="sample-input" placeholder="Type here to drive the four instruments…" disabled={sample.pausedAtMs!==null} defaultValue={sample.text} maxLength={10000}
      onBeforeInput={e=>{const type=(e.nativeEvent as InputEvent).inputType??'';pendingSource.current=classifyInputType(type);}}
      onPaste={()=>{pendingSource.current='paste';}}
      onCompositionStart={()=>{compose.current=true;}}
      onCompositionEnd={e=>{compose.current=false;commit(e.currentTarget.value,'ime');}}
      onInput={e=>{if(!compose.current){const native=e.nativeEvent as InputEvent;const source=native.inputType?classifyInputType(native.inputType):pendingSource.current;commit(e.currentTarget.value,source);pendingSource.current='other';}}}/>
      <p>仅键入和已提交的 IME 字素推动脉冲。粘贴、删除不增加输入付出；输入量不代表正确率或掌握度。</p><p role="status">{notice}</p></section>}
    <section className="gallery" aria-label="Independent display components">{COMPONENT_TYPES.map((type,i)=>{
      const scene=mode==='fixture'?fixtureScene(type,fixtureState):inputScene(type,sample,now,{freezeTimeline:reduced||staticMotion});
      const configured={...scene,nodes:scene.nodes.map(node=>({...node,motion:staticMotion?'none' as const:node.motion,style:{...node.style,backplate:{color:'#071011',opacity:backplate},textOutline:{color:'#071011',width:outline}}}))};
      return <article className="specimen" key={type}><div className="component-meta"><span>{String(i+1).padStart(2,'0')} / {type}</span><span>CANVAS 2D</span></div><div className="canvas-field"><HudCanvas scene={configured} clock={{nowMs:mode==='fixture'?30000:now,reducedMotion:reduced}} pixelRatio={Math.min(devicePixelRatio,2)}/></div><p className="component-rule">{['明确供应的数字，保留单位与来源。','缺失与暂停留白，禁止补成 0。','输入触发短波，低动态改为事件茎线。','明确分子 / 分母，未知总数不显示 0%。'][i]}</p></article>;
    })}</section>
    <footer><p>扩展 / {'后续扩展按实际数据需求登记'} <a href={HUD_PREVIEW_PATHS.groups}>第二批构件演示</a> <a href={HUD_PREVIEW_PATHS.variants}>同指标样式实验</a></p><p>Display-only contract · read-only scene + explicit clock · no database · no paid assets</p></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
