'use client';
import {useStudioLocale} from '../i18n/react';
import {useEffect,useMemo,useState} from 'react';
import {RecordCalendarReader} from '../core/record-calendar-reader';
import {recordCalendarWeek,type RecordCalendarMetricBucket,type RecordMetricValue} from '../core/record-calendar-metrics';
import {recordCalendarMonth,recordCalendarSourceIdentity} from '../core/record-calendar';
import {practiceDayKey,validatePracticeTimeZone} from '../core/practice-calendar';
import {LegacyHistoryError} from '../core/legacy-history';
import type {LegacyHistoryAccess} from '../core/legacy-history-reader';
import type {SegmentHistoryAccess} from '../core/segment-history-reader';
import LegacyHistoryPanel from './LegacyHistoryPanel';
import type {ReferenceRevisionImpactAccess} from '../core/reference-revision-impact';
import SegmentHistoryPanel from './SegmentHistoryPanel';
import ListeningSessionHistory from './ListeningSessionHistory';
import type {IndexedDBTrainingRepository} from '../core/repository';

function defaultZone(){try{return validatePracticeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)}catch{return 'UTC'}}
function shiftMonth(month:string,delta:number){const[y,m]=month.split('-').map(Number),n=y*12+m-1+delta,nextYear=Math.floor(n/12);return nextYear<1||nextYear>9999?month:`${String(nextYear).padStart(4,'0')}-${String(n%12+1).padStart(2,'0')}`}

export default function RecordCalendarPanel({repository,referenceRepository,currentSessionId,download,currentHistoryOff=false}:{repository:LegacyHistoryAccess&SegmentHistoryAccess&Pick<IndexedDBTrainingRepository,'listListeningSessions'|'loadListeningSession'|'deliverListeningSession'>;referenceRepository?:ReferenceRevisionImpactAccess;currentSessionId:string|null;download:(name:string,blob:Blob)=>void;currentHistoryOff?:boolean}){
 const {t, ui, locale} = useStudioLocale();
 const displayDay = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString(locale, {timeZone:'UTC', year:'numeric', month:'short', day:'numeric'});
 const[zone,setZone]=useState(defaultZone),[zoneInput,setZoneInput]=useState(zone),[zoneError,setZoneError]=useState('');
 const[month,setMonth]=useState(()=>practiceDayKey(Date.now(),zone).slice(0,7)),[day,setDay]=useState<string|null>(null);
 const[reader]=useState(()=>new RecordCalendarReader(repository));const[view,setView]=useState(reader.getSnapshot);
 useEffect(()=>{reader.activate();const unsubscribe=reader.subscribe(()=>setView(reader.getSnapshot()));void reader.refresh(zone);return()=>{unsubscribe();reader.dispose()}},[reader]);
 const metricDays=useMemo(()=>new Map(view.metrics.days.map(d=>[d.day,d])),[view.metrics]);
 const days=useMemo(()=>recordCalendarMonth(view.records,month).map(d=>{const metric=metricDays.get(d.day),keys=new Set(d.records.map(r=>r.key));if(metric)for(const name of ['submissions','firstCompletions','matchedTerms','inputActiveMs'] as const)for(const source of metric[name].sourceEventIds)source.recordKeys.forEach(key=>keys.add(key));const records=view.records.filter(r=>keys.has(r.key));return {...d,records,coverage:records.length?'partial' as const:'unknown' as const}}),[view.records,month,metricDays]);
 const selectedDay=days.find(d=>d.day===day),selected=view.selected;
 const week=useMemo(()=>{try{return day?recordCalendarWeek(day):null}catch{return null}},[day]);
 const selectedWeek=week?view.metrics.weeks.find(w=>w.day===week.from):undefined;
 const metricNames=['submissions','firstCompletions','matchedTerms','inputActiveMs'] as const;
 const metricLabels={submissions:'calendar.metricsSubmissions',firstCompletions:'calendar.metricsCompletions',matchedTerms:'calendar.metricsTerms',inputActiveMs:'calendar.metricsInputMinutes'} as const;
 const metricValue=(value:RecordMetricValue|undefined,minutes=false)=>value?.value===null||value?.value===undefined?t('calendar.unknown'):minutes?(value.value>0&&value.value<600?t('calendar.metricsMinuteSmall'):t('calendar.metricsMinutesValue',{count:new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(value.value/60000)})):new Intl.NumberFormat(locale).format(value.value);
 function metricCards(bucket:RecordCalendarMetricBucket|undefined){return <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:8}}>{metricNames.map(name=>{const value=bucket?.[name];return <article className="record-card" key={name}><p>{t(metricLabels[name])}</p><strong>{metricValue(value,name==='inputActiveMs')}</strong>{!!value?.unknownCount&&<p className="note">{t('calendar.metricsPartial',{count:value.unknownCount})}</p>}{!!value?.sourceEventIds.length&&<details><summary>{t('calendar.metricsSources',{count:value.sourceEventIds.length})}</summary>{value.sourceEventIds.map(source=><div key={`${source.sessionId}:${source.eventId}`}><p className="note">{t('calendar.metricsSource',{session:source.sessionId,event:source.eventId})}</p>{source.recordKeys.map(key=><button key={key} disabled={view.selecting} onClick={()=>void reader.select(key)}>{t('calendar.metricsOriginal')}</button>)}</div>)}</details>}</article>})}</div>}
 function dateLabel(date:string,status:string){const metric=metricDays.get(date);return t('calendar.metricsAria',{date:displayDay(date),status,submissions:metricValue(metric?.submissions),completions:metricValue(metric?.firstCompletions),terms:metricValue(metric?.matchedTerms),minutes:metricValue(metric?.inputActiveMs,true)})}
 const guarded=useMemo(()=>({
  listListeningSessions:async()=>{if(selected?.source!=='listening-session')return repository.listListeningSessions();const value=await repository.loadListeningSession(selected.record.recordId);if(!value||await recordCalendarSourceIdentity(value)!==selected.record.identity)throw new LegacyHistoryError('stale-record','听力条件记录已变化或无法核对，请返回日历刷新。');return[value]},
  deliverListeningSession:(id:string,expected:Parameters<IndexedDBTrainingRepository['deliverListeningSession']>[1],sink:()=>void)=>repository.deliverListeningSession(id,expected,sink),
  listHistory:(options:Parameters<LegacyHistoryAccess['listHistory']>[0])=>repository.listHistory(options),
  loadHistorySession:async(id:string)=>{const value=await repository.loadHistorySession(id);if(selected?.source==='legacy-full'&&id===selected.record.recordId&&(!value||await recordCalendarSourceIdentity(value)!==selected.record.identity))throw new LegacyHistoryError('stale-record','记录已变化，请返回日历刷新。');return value},
  deliverHistorySession:(id:string,expected:Parameters<LegacyHistoryAccess['deliverHistorySession']>[1],sink:()=>void)=>repository.deliverHistorySession(id,expected,sink),
  listTrainingHistorySegments:(options:Parameters<SegmentHistoryAccess['listTrainingHistorySegments']>[0])=>repository.listTrainingHistorySegments(options),
  loadTrainingHistorySegment:async(id:string)=>{const value=await repository.loadTrainingHistorySegment(id);if(selected?.source==='partial-segment'&&id===selected.record.recordId&&(!value||await recordCalendarSourceIdentity(value)!==selected.record.identity))throw new LegacyHistoryError('stale-record','片段已变化，请返回日历刷新。');return value},
  deliverTrainingHistorySegment:(id:string,expected:Parameters<SegmentHistoryAccess['deliverTrainingHistorySegment']>[1],sink:()=>void)=>repository.deliverTrainingHistorySegment(id,expected,sink),
 }),[repository,selected]);
 function chooseMonth(value:string){try{recordCalendarMonth([],value);reader.back();setMonth(value);setDay(null)}catch{}}
 function applyZone(){try{const next=validatePracticeTimeZone(zoneInput);setZoneError('');setZone(next);setZoneInput(next);setDay(null);void reader.refresh(next)}catch{setZoneError('请输入有效的 IANA 时区。')}}
 if(selected)return <section aria-label={t('calendar.detailLabel')}><div className="button-row"><button onClick={()=>reader.back()}>{t('calendar.back')}</button></div><p className="note">{t('calendar.metricsSourceDates', {date: selected.record.days.map(displayDay).join(' / '), zone})}</p>{selected.source==='legacy-full'?<LegacyHistoryPanel referenceRepository={referenceRepository} key={selected.record.key} repository={guarded} currentSessionId={currentSessionId} download={download} initialSessionId={selected.record.recordId} detailOnly/>:selected.source==='listening-session'?<ListeningSessionHistory key={selected.record.key} repository={guarded} download={download} initialSessionId={selected.record.recordId} detailOnly/>:<SegmentHistoryPanel key={selected.record.key} repository={guarded} currentSessionId={currentSessionId} download={download} initialSegmentId={selected.record.recordId} detailOnly/>}</section>;
 const firstDate=new Date(`${month}-01T12:00:00Z`),offset=(firstDate.getUTCDay()+6)%7;
 return <section aria-label={t('calendar.label')} style={{overflowWrap:'anywhere'}}>
  <p className="note">{t('calendar.coverage')}</p>
  {currentHistoryOff&&<p className="note">{t('calendar.historyOff')}</p>}
  <div className="button-row"><button onClick={()=>{const today=practiceDayKey(Date.now(),zone);chooseMonth(today.slice(0,7));setDay(today)}}>{t('calendar.metricsToday')}</button><button onClick={()=>chooseMonth(shiftMonth(month,-1))} aria-label={t('calendar.previousMonthLabel')}>{t('calendar.previousMonth')}</button><label>{t('calendar.month')}<input aria-label={t('calendar.monthLabel')} type="month" value={month} onChange={e=>chooseMonth(e.target.value)}/></label><button onClick={()=>chooseMonth(shiftMonth(month,1))} aria-label={t('calendar.nextMonthLabel')}>{t('calendar.nextMonth')}</button></div>
  <p className="note">{t('calendar.weekStart', {zone})}</p>
  <details><summary>{t('calendar.viewTimeZone')}</summary><div className="button-row"><label>{t('calendar.timeZone')}<input aria-label={t('calendar.timeZoneLabel')} value={zoneInput} onChange={e=>setZoneInput(e.target.value)} list="record-calendar-zones"/></label><datalist id="record-calendar-zones">{Array.from(new Set([defaultZone(),'UTC','Asia/Shanghai','America/New_York','Europe/London'])).map(z=><option value={z} key={z}/>)}</datalist><button onClick={applyZone}>{t('calendar.applyTimeZone')}</button></div><p className="note">{t('calendar.zoneScope')}</p>{zoneError&&<p role="alert">{ui(zoneError)}</p>}</details>
  <div className="button-row"><button onClick={()=>{setDay(null);void reader.refresh(zone)}}>{t('calendar.refresh')}</button>{view.status==='loading'&&<button onClick={()=>reader.cancel()}>{t('calendar.cancelRead')}</button>}</div>
  <p className="note" role="status">{view.status==='loading'?t('calendar.readingCount', {count: view.scannedRecords}):view.status==='loaded'?t('calendar.readCount', {count: view.scannedRecords}):view.status==='cancelled'?t('calendar.cancelled'):view.status==='failed'?t('calendar.failed'):view.status==='partial'?t('calendar.partial'):t('calendar.notRead')}</p>
  {view.error&&<p className="notice warn" role="alert">{ui(view.error)}</p>}
  {(view.undatedEventCount>0||view.undatedRecordCount>0)&&<details><summary>{t('calendar.undated')}</summary><p className="note">{t('calendar.undatedCounts', {events: view.undatedEventCount, records: view.undatedRecordCount})}</p></details>}
  <p className="note">{t('calendar.legend')}</p>
  <p className="note">{t('calendar.metricsScope')}</p>
  <p className="note">{t('calendar.listeningScope')}</p>
  {view.metrics.conflictCount>0&&<p className="notice warn" role="alert">{t('calendar.metricsConflicts',{count:view.metrics.conflictCount})}</p>}
  <details><summary>{t('calendar.metricsRules')}</summary><p className="note">{t('calendar.metricsCountRule')}</p><p className="note">{t('calendar.metricsTimeRule')}</p></details>
  <div style={{display:'grid',gridTemplateColumns:'repeat(7,minmax(0,1fr))',gap:4}} aria-label={t('calendar.monthGrid', {month: firstDate.toLocaleDateString(locale, {timeZone:'UTC', year:'numeric', month:'long'})})}>
   {Array.from({length:7},(_,index)=>new Date(Date.UTC(2024,0,1+index)).toLocaleDateString(locale,{timeZone:'UTC',weekday:'short'})).map((w,index)=><span key={index} style={{textAlign:'center'}} aria-hidden="true">{w}</span>)}
   {Array.from({length:offset},(_,i)=><span key={`pad-${i}`} aria-hidden="true"/>)}
   {days.map(d=>{const full=d.records.some(r=>r.source==='legacy-full'),partial=d.records.some(r=>r.source==='partial-segment'),listening=d.records.some(r=>r.source==='listening-session'),label=[full?t('calendar.fullMarker'):'',partial?t('calendar.partialMarker'):'',listening?t('calendar.listeningMarker'):''].filter(Boolean).join(' ')||'·';return <button key={d.day} aria-label={dateLabel(d.day,d.records.length?t('calendar.savedIncomplete'):t('calendar.unknown'))} aria-pressed={day===d.day} className={day===d.day?'selected':''} style={{padding:'7px 0',minWidth:0,minHeight:48,flexDirection:'column',gap:0}} onFocus={()=>{reader.back();setDay(d.day)}} onClick={()=>{reader.back();setDay(d.day)}}><span>{Number(d.day.slice(-2))}</span><small style={{display:'block',fontSize:10}}>{label}</small></button>})}
  </div>
  <h3>{day ? displayDay(day) : t('calendar.selectDate')}</h3>
  {day&&<><h4>{t('calendar.metricsDay')}</h4>{metricCards(metricDays.get(day))}{week&&<><h4>{t('calendar.metricsWeek',{from:displayDay(week.from),to:displayDay(week.to)})}</h4>{metricCards(selectedWeek)}</>}</>}
  {selectedDay&&<>{selectedDay.records.length===0?<p className="note">{t('calendar.noDayRecords')}</p>:<div>{selectedDay.records.map(r=><article className="record-card" key={r.key}><p>{r.source==='legacy-full'?t('calendar.fullRecord'):r.source==='listening-session'?t('calendar.listeningRecord'):t('calendar.partialRecord')} · {r.materialId} / {r.materialVersion}</p><button disabled={view.selecting} onClick={()=>void reader.select(r.key)}>{t('calendar.openOriginal')}</button></article>)}</div>}</>}
  {view.selecting&&<p role="status">{t('calendar.rereading')}</p>}
  <details><summary>{t('calendar.dateList')}</summary>{days.map(d=><p key={d.day}><button aria-label={dateLabel(d.day,d.records.length?t('calendar.savedIncomplete'):t('calendar.unknown'))} onClick={()=>{reader.back();setDay(d.day)}}>{displayDay(d.day)}</button> · {d.records.length?t('calendar.recordsIncomplete'):t('calendar.unknown')}</p>)}</details>
 </section>;
}
