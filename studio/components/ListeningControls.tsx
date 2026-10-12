'use client';
import {useStudioLocale} from '../i18n/react';
import {useState,type CSSProperties} from 'react';
import {projectListeningHistory} from '../core/listening-history';
import type {ListeningControl} from './useListening';
import {HudGlyph,HudPopover} from './HudControls';

/** In-video entry and disclosure only. Player ownership and persistence stay in useListening. */
export default function ListeningControls({control,download,dockStyle}:{control:ListeningControl;download:(name:string,blob:Blob)=>void;dockStyle?:CSSProperties}){
 const {t,ui,locale}=useStudioLocale();
 const seconds=(ms:number)=>t('listening.seconds',{count:Math.floor(ms/1000)});
 const [repeats,setRepeats]=useState(1),[pause,setPause]=useState(0),[showHistory,setShowHistory]=useState(false),[open,setOpen]=useState(false);
 const s=control.state,p=control.playerRef.current;
 const history=()=>{setOpen(true);setShowHistory(v=>!v);if(!showHistory)void control.loadHistory()};
 const error=s?.error||control.error;
 const totals=s?.observation.totals;
 return <div className="listening-overlay">
  <nav style={dockStyle} className="listening-dock" aria-label={t('listening.dock')}>
   <button type="button" className="hud-glyph" aria-label={s?t('listening.controls'):t('listening.start')} title={s?t('listening.controls'):t('listening.listen')} aria-expanded={open} aria-controls="listening-panel" data-active={!!s} onClick={()=>{setOpen(v=>!v);if(!s)void control.start()}}><HudGlyph name="listen"/></button>
   <button type="button" className="hud-glyph" aria-label={t('listening.historyTitle')} title={t('listening.historyTitle')} aria-expanded={open&&showHistory} onClick={history}><HudGlyph name="history"/></button>
  </nav>
  {error&&!open&&<button className="hud-error-flag" type="button" onClick={()=>setOpen(true)} role="status">{ui(error)}</button>}
  {open&&<HudPopover label={t('listening.title')} onClose={()=>setOpen(false)} className="listening-controls"><div id="listening-panel">
  {!s?<button type="button" onClick={()=>void control.start()}>{t('listening.start')}</button>:<>
   <div className="button-row"><button onClick={()=>s.playing?p?.pause():void p?.play()}>{s.playing?t('listening.pause'):t('listening.resume')}</button><button onClick={()=>p?.repeatCurrent(repeats,pause)}>{t('listening.repeat')}</button><button onClick={()=>p?.continueAll()}>{t('listening.continuous')}</button>{s.mode==='listen'?<button onClick={()=>void control.finish(true).catch(()=>{})}>{t('listening.typeNow')}</button>:<button onClick={()=>void control.start()}>{t('listening.listen')}</button>}<button onClick={()=>void control.finish().catch(()=>{})}>{t('listening.finish')}</button></div>
   <div className="listening-options"><label>{t('listening.speed')}<select aria-label={t('listening.speedLabel')} value={s.rate} onChange={e=>p?.rate(Number(e.target.value))}>{[.5,.8,1,1.25,1.5,2].map(rate=><option key={rate} value={rate}>{rate}{t('listening.rateUnit')}</option>)}</select></label><label>{t('listening.repeats')}<select aria-label={t('listening.repeats')} value={repeats} onChange={e=>setRepeats(Number(e.target.value))}><option value={1}>{t('listening.once')}</option><option value={2}>{t('listening.twice')}</option><option value={3}>{t('listening.threeTimes')}</option><option value={Infinity}>{t('listening.infinite')}</option></select></label><label>{t('listening.repeatPause')}<select aria-label={t('listening.repeatPause')} value={pause} onChange={e=>setPause(Number(e.target.value))}>{[0,1,2,3,5].map(n=><option key={n} value={n}>{n}{t('common.seconds')}</option>)}</select></label></div>
   <div className="button-row"><button disabled={!control.referenceReady} aria-pressed={s.textVisible} onClick={()=>p?.showText(!s.textVisible)}>{s.textVisible?t('listening.hideText'):t('listening.showText')}</button><button onClick={()=>p?.help()}>{t('listening.help')}</button></div>
   <input type="range" aria-label={t('listening.seek')} min={0} max={s.duration||0} step={.05} value={Math.min(s.position,s.duration||0)} disabled={!s.duration} onChange={e=>p?.seek(Number(e.target.value))}/>
   {s.helpOpen&&<div className="notice"><p>{t('listening.noHelp')}</p><button onClick={()=>p?.closeHelp()}>{t('listening.closeHelp')}</button><button onClick={()=>void p?.play()}>{t('listening.resume')}</button></div>}
   {!control.referenceReady&&<p className="note">{t('listening.referenceBoundary')}</p>}
   <details className="listening-details"><summary>{t('listening.observation')}</summary>
   <p className="note" aria-live="off" data-listening-cadence-description="true">{s.mode==='listen'?(s.textVisible?t('listening.cadenceNotice'):t('listening.hiddenNotice')):t('listening.realInputNotice')}</p>
   <p aria-live="off">{totals?.observed?t('listening.totals',{listening:seconds(totals.listeningMs),typing:seconds(totals.typingMs),background:seconds(totals.backgroundMs),effective:seconds(totals.effectiveMs),coverage:totals.mediaCoverageSeconds.toFixed(1)}):t('listening.awaitingSamples')}{totals&&totals.gapCount>0?t('listening.gaps',{count:totals.gapCount}):''}</p>
   <p className="note">{ui(control.storage)}{t('listening.observationNotice')}</p>
   <div className="button-row"><button onClick={()=>void control.retry()}>{t('listening.retrySave')}</button><button onClick={()=>download(`lingotrace-listening-temporary-${s.observation.identity.runId}.json`,new Blob([JSON.stringify(s.observation,null,2)],{type:'application/json'}))}>{t('listening.exportTemporary')}</button></div></details>
  </>}
  {error&&<p role="alert">{ui(error)}</p>}
  <button type="button" aria-expanded={showHistory} onClick={history}>{t('listening.localRecords')}</button>
  {showHistory&&<div aria-label={t('listening.savedSegments')} className="listening-history">{control.historyError?<p role="alert">{ui(control.historyError)}</p>:control.history.length===0?<p>{t('listening.empty')}</p>:control.history.map(record=>{const summary=projectListeningHistory(record);return <div key={record.observationId}><p>{new Date(record.startedAt).toLocaleString(locale)} · {record.materialId}{t('listening.playbackPrefix')}{seconds(summary.listeningMs)}{t('listening.typingPrefix')}{seconds(summary.typingMs)}{t('listening.unionPrefix')}{seconds(summary.effectiveMs)}{t('listening.coveragePrefix')}{summary.mediaCoverageSeconds.toFixed(1)}{t('listening.secondsSeparator')}{record.sealed?t('listening.sealed'):t('listening.partialTail')}</p><button onClick={()=>void control.exportHistory(record,download)}>{t('listening.exportSaved')}</button></div>})}<p className="note">{t('listening.independentNotice')}</p></div>}
  </div></HudPopover>}
 </div>;
}
