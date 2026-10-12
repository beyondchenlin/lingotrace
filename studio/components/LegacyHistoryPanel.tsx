'use client';
import { useStudioLocale } from '../i18n/react';
import { useLayoutEffect, useMemo, useState } from 'react';
import type {TrainingSnapshot} from '../core/training';
import { LegacyHistoryReader, supportsLegacyHistoryExport, type LegacyHistoryAccess } from '../core/legacy-history-reader';
import { deriveInputRateTimeline } from '../core/input-rate-timeline';
import PaceTimeline from './PaceTimeline';
import LegacyHistoryHud from './LegacyHistoryHud';
import LegacyResultCard from './LegacyResultCard';
import LegacyAttemptReview from './LegacyAttemptReview';
import HistoryReferenceImpact from './HistoryReferenceImpact';
import type {ReferenceRevisionImpactAccess} from '../core/reference-revision-impact';

export default function LegacyHistoryPanel({ repository, currentSessionId, download, initialSessionId, detailOnly=false, onContinue, continueDisabledReason=null, referenceRepository }: {
  repository: LegacyHistoryAccess; currentSessionId: string | null; download: (name: string, blob: Blob) => void; initialSessionId?:string; detailOnly?:boolean; onContinue?:(snapshot:TrainingSnapshot)=>Promise<void>; continueDisabledReason?:string|null; referenceRepository?:ReferenceRevisionImpactAccess|null;
}) {
  const {t, ui, locale} = useStudioLocale();
  const duration = (ms: number) => t('history.duration', {minutes: Math.floor(ms / 60000), seconds: Math.floor(ms / 1000 % 60)});
  const date = (value: string) => new Date(value).toLocaleString(locale);
  const [reader] = useState(() => new LegacyHistoryReader(repository));
  const [view, setView] = useState(reader.getSnapshot);
  const [continuing,setContinuing]=useState(false);
  useLayoutEffect(() => { reader.activate(); const unsubscribe = reader.subscribe(() => setView(reader.getSnapshot())); if(initialSessionId)void reader.select(initialSessionId);else void reader.refresh(); return () => { unsubscribe(); reader.dispose(); }; }, [reader,initialSessionId]);
  const selected = view.selected, snapshot = selected?.snapshot;
  const timelineAvailable = useMemo(() => { if (!snapshot) return false; try { deriveInputRateTimeline(snapshot); return true; } catch { return false; } }, [snapshot]);
  return <section aria-label={t('history.savedLabel')}>
    <p className="notice">{t('history.savedScope')}</p>
    <p className="note">{t('history.browserScope')}</p>
    <div className="button-row">{!detailOnly&&(selected || view.loading) ? <button onClick={() => {if(view.list)reader.back();else void reader.refresh()}}>{t('history.back')}</button> : null}{!detailOnly&&<button onClick={() => void reader.refresh()}>{t('history.refresh')}</button>}{view.canRetry && <button disabled={view.loading || view.paging || view.downloading} onClick={() => void reader.retry()}>{t('history.retry')}</button>}</div>
    {view.error && <p className="notice warn" role="alert">{ui(view.error)}</p>}
    {view.loading && <p role="status">{t('history.loading')}</p>}
    {!view.loading && !selected && view.list && <>
      {view.list.entries.length === 0 && <p className="empty">{view.page === 1 ? t('history.empty') : t('history.pageEmpty')}</p>}
      {view.list.entries.map((entry, index) => entry.status === 'error' ? <article className="record-card" key={`error-${index}`}><h2>{t('history.recordUnreadable')}</h2><p className="note">{t('history.recordUnreadableScope')}</p></article> : <article className="record-card" key={entry.summary.sessionId}>
        <h2>{entry.summary.materialTitle}</h2><p>{date(entry.summary.createdAt)}{entry.summary.sessionId === currentSessionId ? t('history.currentSaved') : ''}</p>
        <p>{t('history.summary', {words: entry.summary.earnedWords, sentences: entry.summary.completedCount, attempts: entry.summary.attemptCount, duration: duration(entry.summary.activeMs)})}</p>
        <p className="note">{t('history.recordVersions', {schema: entry.summary.schemaVersion, material: entry.summary.materialVersion, date: date(entry.summary.updatedAt)})}</p>
        <button onClick={() => void reader.select(entry.summary.sessionId)}>{t('history.open')}</button>
      </article>)}
      <div className="button-row" aria-label={t('history.pagination')}>
        <button disabled={view.paging || view.page === 1} onClick={() => void reader.changePage('previous')}>{t('history.previousBatch')}</button>
        <span role="status">{view.paging ? t('history.loadingBatch') : t('history.batchCount', {page: view.page, count: view.list.entries.length})}</span>
        <button disabled={view.paging || !view.list.hasMore} onClick={() => void reader.changePage('next')}>{t('history.earlierRecords')}</button>
      </div>
      <p className="note">{t('history.batchScope', {count: view.list.limit})}</p>
    </>}
    {!view.loading && selected && snapshot && <>
      <h2>{selected.summary.materialTitle}</h2><p>{date(selected.summary.createdAt)}</p>
      <div className="review-stats"><div><strong>{snapshot.earnedWords}</strong><span>{t('history.confirmedCorrectWords')}</span></div><div><strong>{snapshot.completedCueIds.length}<small>/{snapshot.material.cues.length}</small></strong><span>{t('history.completedSentences')}</span></div><div><strong>{duration(snapshot.activeMs)}</strong><span>{t('history.inputTime')}</span></div></div>
      <p className="note">{t('history.selectedVersions', {schema: selected.summary.schemaVersion, material: selected.summary.materialVersion, rules: selected.summary.ruleVersions.join(', ')})}</p>
      {referenceRepository && <HistoryReferenceImpact key={`references:${snapshot.sessionId}:${snapshot.sequence}`} material={snapshot.material} repository={referenceRepository}/>}
      <LegacyResultCard key={`card:${snapshot.sessionId}:${snapshot.sequence}`} session={selected} repository={repository} download={download}/>
      <LegacyHistoryHud key={`${snapshot.sessionId}:${snapshot.sequence}`} session={selected}/>
      {timelineAvailable ? <details><summary>{t('history.fullTimeline')}</summary><PaceTimeline key={snapshot.sessionId} snapshot={snapshot}/></details> : <p className="notice warn">{t('history.timelineUnavailable')}</p>}
      {onContinue&&<div className="notice"><p>{t('history.continueNotice')}</p><button disabled={continuing||view.downloading||!!continueDisabledReason||snapshot.sessionId===currentSessionId||!supportsLegacyHistoryExport(selected)} onClick={()=>{setContinuing(true);void onContinue(snapshot).finally(()=>setContinuing(false))}}>{continuing?t('history.verifying'):snapshot.sessionId===currentSessionId?t('history.currentPractice'):t('history.continue')}</button>{continueDisabledReason&&<p className="note">{ui(continueDisabledReason)}</p>}</div>}
      <h2>{t('history.originalSubmissions')}</h2>
      {snapshot.attempts.length === 0 ? <p className="empty">{t('history.noSubmissions')}</p> : <div className="attempt-list">{snapshot.attempts.map((attempt) => <details key={attempt.attemptId}><summary>{t('review.sentenceNumber', {number: snapshot.material.cues.findIndex(c => c.id === attempt.cueId) + 1})} · {attempt.accuracy}% · {attempt.conditions.exposure === 'first' ? t('history.firstAnswer') : t('history.retryAnswer')} · {t('history.wordsGained', {count: attempt.gain})}</summary><LegacyAttemptReview snapshot={snapshot} attempt={attempt}/><p className="note">{attempt.conditions.hinted ? t('review.hinted') : t('review.noHint')} · {attempt.conditions.revealed ? t('history.referenceExposed') : t('history.referenceNotExposed')} · {attempt.conditions.pasted ? t('review.pasted') : t('review.notPasted')} · {duration(attempt.activeMs)}</p></details>)}</div>}
      <details><summary>{t('history.savedDrafts')}</summary>{snapshot.material.cues.map(cue => Object.hasOwn(snapshot.drafts, cue.id) ? <p key={cue.id}>{snapshot.drafts[cue.id].text || t('history.emptyDraft')}</p> : null)}</details>
      <div className="button-row"><button disabled={view.downloading} onClick={() => void reader.download('json', download)}>{t('history.downloadJson')}</button><button disabled={view.downloading} onClick={() => void reader.download('csv', download)}>{t('history.downloadCsv')}</button></div>
      {!supportsLegacyHistoryExport(selected) && <p className="notice warn">{t('history.exportUnsupported')}</p>}
      <p className="note">{t('history.exportScope')}</p>
    </>}
  </section>;
}
