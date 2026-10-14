'use client';
import{useStudioLocale}from'../i18n/react';
import{useMemo,useState}from'react';
import{deriveInputRateTimeline,type InputRatePoint}from'../core/input-rate-timeline';
import type{TrainingSnapshot}from'../core/training';
const reasonKeys={idle:'pace.idle',paused:'pace.paused',listening:'pace.listening',composition:'pace.composition',background:'pace.background',modal:'pace.modal',checking:'pace.checking',review:'pace.review','input-blur':'pace.blur'} as const;
const time=(ms:number)=>`${Math.floor(Math.max(0,ms)/60000).toString().padStart(2,'0')}:${Math.floor(Math.max(0,ms)/1000%60).toString().padStart(2,'0')}`;
export default function PaceTimeline({snapshot}:{snapshot:TrainingSnapshot}){
 const {t} = useStudioLocale();
 const reason=(value:string)=>Object.hasOwn(reasonKeys,value)?t(reasonKeys[value as keyof typeof reasonKeys]):value;
 const chart=useMemo(()=>deriveInputRateTimeline(snapshot),[snapshot]),[selected,setSelected]=useState<number|null>(null),[expanded,setExpanded]=useState(false);
 if(!chart.sampleCount||!chart.domain)return <div className="empty">{t('pace.noSamples')}</div>;
 let maxCpm=-Infinity;
 for(const point of chart.points)maxCpm=Math.max(maxCpm,point.cpm??0);
 const min=chart.domain.minWallTimeMs,max=chart.domain.maxWallTimeMs,span=Math.max(1000,max-min),peak=Math.max(100,Math.ceil(maxCpm/50)*50);
 const width=expanded?960:680,height=expanded?320:226,plotW=expanded?860:600,plotH=expanded?230:156,left=48,top=expanded?42:27,bottom=height-36;
 const x=(ms:number)=>left+(ms-min)/span*plotW,y=(v:number)=>bottom-v/peak*plotH;
 const choose=(point:InputRatePoint)=>setSelected(chart.points.indexOf(point));const index=Math.min(selected??chart.points.length-1,chart.points.length-1),point=chart.points[index];
 const value=(p:InputRatePoint)=>p.state==='measured'?t('pace.measuredValue', {cpm: p.cpm ?? t('historyHud.notApplicable'), wpm: p.wpmEquivalent ?? t('historyHud.notApplicable')}):p.state==='sampling'?t('pace.sampling'):p.state==='frozen'?t('pace.frozen'):p.unavailableReason==='grapheme-segmentation-unavailable'?t('pace.segmentationUnavailable'):t('pace.legacyUnavailable');
 return <section className={`pace-timeline${expanded?' is-expanded':''}`} aria-label={t('pace.label')} data-expanded={expanded||undefined}>
  <div className="chart-labels"><span>{t('pace.heading')}</span><button type="button" className="pace-expand-toggle" aria-pressed={expanded} onClick={()=>setExpanded(v=>!v)}>{t(expanded?'pace.collapse':'pace.expand')}</button><span>{t('pace.axis')}</span></div>
  <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('pace.chartLabel')}><defs><pattern id="pause-hatch" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M-2 2 2-2M0 7 7 0M5 9 9 5" stroke="#a6b2a0" strokeWidth=".7" opacity=".25"/></pattern></defs>
  {[0,.5,1].map(n=><g key={n}><line x1={left} x2={left+plotW} y1={y(peak*n)} y2={y(peak*n)} stroke="#a9c09a33"/><text x={left-9} y={y(peak*n)+4} textAnchor="end">{Math.round(peak*n)}</text></g>)}
  {chart.gaps.map(g=><rect key={g.id} x={x(Math.min(g.from.wallTimeMs,g.to.wallTimeMs))} y={top} width={Math.max(2,Math.abs(x(g.to.wallTimeMs)-x(g.from.wallTimeMs)))} height={plotH+7} fill="url(#pause-hatch)"><title>{g.kind==='frozen'?g.reasons.map(reason).join(', '):g.kind==='unobserved'?t('pace.unobserved'):t('pace.clockChange')}{g.open?t('pace.openEnd'):''}, {g.observedWallMs===null?t('pace.clockBackward'):t('pace.seconds', {seconds: (g.observedWallMs/1000).toFixed(1)})}</title></rect>)}
  {chart.segments.map(s=><path key={s.id} d={s.points.map((p,i)=>`${i?'L':'M'}${x(p.wallTimeMs)},${y(p.cpm??0)}`).join(' ')} fill="none" stroke="#c4fc57" strokeWidth={expanded?2.6:2}/>)}
  {chart.points.filter(p=>p.cpm!==null).map(p=><circle key={p.eventId} cx={x(p.wallTimeMs)} cy={y(p.cpm??0)} r={point.eventId===p.eventId?(expanded?7:4.5):(expanded?3.6:2.3)} fill={point.eventId===p.eventId?'#fff':'#c4fc57'} onMouseEnter={()=>choose(p)} onClick={()=>choose(p)}><title>{t('pace.pointLabel', {time: time(p.wallTimeMs-min), cpm: p.cpm ?? t('historyHud.notApplicable'), sequence: p.sequence})}</title></circle>)}
  {[0,.5,1].map(n=><text key={n} x={left+plotW*n} y={height-12} textAnchor={n===0?'start':n===1?'end':'middle'}>{time(span*n)}</text>)}
  </svg>
  <label className="pace-point-picker">{t('pace.pointPicker')}<input type="range" min="0" max={chart.points.length-1} value={index} onChange={e=>setSelected(Number(e.target.value))}/></label>
  <output className="pace-point-detail">{time(point.wallTimeMs-min)} · {value(point)} · {point.metricVersion==='input.cpm.5s.v2'?t('pace.foregroundV2'):t('pace.legacyV1')} · {t('pace.event', {sequence: point.sequence})} · {point.kind==='input'?t('pace.actualInput'):point.kind==='sample'?t('pace.clockSample'):t('pace.pauseBoundary')}</output>
  <p className="note">{t('pace.scope')}</p>
  {chart.gaps.length>0&&<details className="pace-gap-list"><summary>{t('pace.gapCount', {count: chart.gaps.length})}</summary>{chart.gaps.map(g=><p key={g.id}>{time(g.from.wallTimeMs-min)} → {time(g.to.wallTimeMs-min)} · {g.kind==='frozen'?g.reasons.map(reason).join(' / '):g.kind==='unobserved'?t('pace.unknownGap'):t('pace.clockChange')}{g.open?t('pace.stillPaused'):''}</p>)}</details>}
  {chart.issues.length>0&&<p className="notice warn">{t('pace.clockIssues', {count: chart.issues.length})}</p>}
 </section>
}
