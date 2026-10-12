'use client';
import { useStudioLocale } from '../i18n/react';
import { PartialListeningScopeNotice } from './ListeningSessionHistory';
import { useLayoutEffect, useMemo, useState } from 'react';
import { SegmentHistoryReader, type SegmentHistoryAccess } from '../core/segment-history-reader';
import type { TrainingHistoryFact, TrainingHistoryRedactionReason } from '../core/training-history-segment';
import type { AlignmentToken, FreezeReason, InputSource } from '../core/training';

const factNames = {
  timeAdvanced: 'segment.timeObserved', inputObservationSampled: 'segment.inputSampled', compositionStarted: 'segment.compositionStarted', compositionEnded: 'segment.compositionEnded',
  inputCommitted: 'segment.inputChanged', freezeChanged: 'segment.freezeChanged', cueChanged: 'segment.cueChanged', hintExposed: 'segment.hintExposed', submitRequested: 'segment.submitRequested', judgmentApplied: 'segment.judgmentApplied',
} as const satisfies Record<TrainingHistoryFact['type'], string>;
const redactionNames = {
  'draft-predates-segment': 'segment.olderDraft', 'composition-crossed-boundary': 'segment.crossedComposition', 'unknown-edit': 'segment.unknownEdit',
  'undo-redo': 'segment.undoRedo', 'request-outside-segment': 'segment.outsideRequest', 'answer-provenance-unknown': 'segment.unknownAnswer',
} as const satisfies Record<TrainingHistoryRedactionReason, string>;
const sourceNames = { typed: 'segment.typed', paste: 'segment.pasted', ime: 'segment.ime' } as const satisfies Record<InputSource, string>;
const freezeNames = {
  idle: 'segment.idle', paused: 'segment.paused', listening: 'segment.listening', composition: 'segment.composition',
  background: 'segment.background', modal: 'segment.modal', checking: 'segment.checking', review: 'segment.review',
} as const satisfies Record<FreezeReason, string>;
const alignmentNames = { match: 'segment.correct', replace: 'segment.wrong', missing: 'segment.missing', extra: 'segment.extra' } as const satisfies Record<AlignmentToken['kind'], string>;

function FactContent({ fact }: { fact: TrainingHistoryFact }) {
  const {t} = useStudioLocale();
  if ('retention' in fact && fact.retention === 'redacted') return <p className="note">{t('segment.redacted', {reason: t(redactionNames[fact.redactionReason])})}</p>;
  switch (fact.type) {
    case 'inputCommitted': return fact.retention === 'recorded' ? <><p className="note">{t('segment.source', {source: t(sourceNames[fact.source])})}</p><p>{fact.text || t('segment.emptyInput')}</p></> : null;
    case 'submitRequested': return fact.retention === 'recorded' ? <p>{fact.answer || t('segment.emptyAnswer')}</p> : null;
    case 'judgmentApplied':
      if (fact.retention === 'unavailable') return <p className="note">{t('segment.judgmentUnavailable')}</p>;
      if (fact.retention !== 'recorded') return null;
      return <><p>{fact.result.answer || t('segment.emptyAnswer')}</p><p>{t('segment.judgment', {accuracy: fact.result.accuracy, words: fact.result.words, errors: fact.result.errors})}</p><p className="note">{t('segment.resultScope')}</p><details><summary>{t('segment.alignmentDetails')}</summary>{fact.result.alignment.length === 0 ? <p>{t('segment.emptyAlignment')}</p> : <ol>{fact.result.alignment.map((token, index) => <li key={index}>{t('segment.alignmentToken', {kind: t(alignmentNames[token.kind]), position: token.position ?? t('segment.notApplicable'), expected: token.expected || t('segment.emptyValue'), actual: token.actual || t('segment.emptyValue')})}</li>)}</ol>}</details></>;
    case 'timeAdvanced': return <p>{fact.durationCoverage === 'observed' && fact.deltaMs !== null ? t('segment.durationDelta', {milliseconds: fact.deltaMs}) : fact.durationCoverage !== 'frozen' ? t('segment.unknownDuration') : t('segment.frozenDuration')}</p>;
    case 'freezeChanged': return <p>{t(freezeNames[fact.reason])}: {fact.on ? t('segment.on') : t('segment.off')}</p>;
    case 'cueChanged': return <p>{t('segment.cueIndex', {index: fact.index})}</p>;
    case 'hintExposed': return <p>{fact.kind === 'hint' ? t('segment.hintShown') : t('segment.referenceShown')}</p>;
    default: return <p className="note">{t('segment.factOnly')}</p>;
  }
}

export default function SegmentHistoryPanel({ repository, currentSessionId = null, download, initialSegmentId, detailOnly=false }: {
  repository: SegmentHistoryAccess; currentSessionId?: string | null; download: (name: string, blob: Blob) => void; initialSegmentId?:string; detailOnly?:boolean;
}) {
  const {t, ui, locale} = useStudioLocale();
  const date = (value: string) => new Date(value).toLocaleString(locale);
  const reader = useMemo(() => new SegmentHistoryReader(repository), [repository]);
  const [view, setView] = useState(reader.getSnapshot);
  useLayoutEffect(() => {
    reader.activate(); setView(reader.getSnapshot());
    const unsubscribe = reader.subscribe(() => setView(reader.getSnapshot())); if(initialSegmentId)void reader.select(initialSegmentId);else void reader.refresh();
    return () => { unsubscribe(); reader.dispose(); };
  }, [reader,initialSegmentId]);
  const selected = view.selected;
  return <section aria-label={t('segment.panelLabel')} style={{ overflowWrap: 'anywhere' }}>
    <h2>{t('segment.heading')}</h2>
    <p className="notice">{t('segment.scope')}</p>
    <p className="note">{t('segment.browserScope')}</p>
    <div className="button-row">{!detailOnly&&(selected || view.loading || view.error) ? <button onClick={() => {if(view.list)reader.back();else void reader.refresh()}}>{t('segment.back')}</button> : null}{!detailOnly&&<button onClick={() => void reader.refresh()}>{t('segment.refresh')}</button>}{view.error ? <button disabled={view.loading || view.paging || view.downloading} onClick={() => void reader.retry()}>{t('history.retry')}</button> : null}</div>
    {view.error && <p className="notice warn" role="alert">{ui(view.error)}</p>}
    {view.loading && <p role="status">{t('segment.loading')}</p>}
    {!view.loading && !selected && view.list && <>
      {view.list.entries.length === 0 && <p className="empty">{view.page === 1 ? t('segment.empty') : t('segment.pageEmpty')}</p>}
      {view.list.entries.map(entry => <article className="record-card" key={entry.segmentId}>
        <h3>{t('segment.title', {date: date(entry.startedAt)})}</h3>
        <p>{t('segment.factCount', {count: entry.factCount})}{entry.sessionId === currentSessionId ? t('segment.fromCurrent') : ''}</p>
        <p className="note">{entry.endedAt ? t('segment.endedAt', {date: date(entry.endedAt)}) : t('segment.endTimeMissing')} · {t('segment.updatedAt', {date: date(entry.updatedAt)})}</p>
        <button disabled={view.paging} onClick={() => void reader.select(entry.segmentId)}>{t('segment.open')}</button>
        <details><summary>{t('segment.versions')}</summary><p className="note">{t('segment.entrySource', {session: entry.sessionId, segment: entry.segmentId, generation: entry.generation})}</p><p className="note">{t('segment.versionsHint')}</p></details>
      </article>)}
      <div className="button-row" aria-label={t('segment.pagination')}>
        <button disabled={view.paging || view.page === 1} onClick={() => void reader.changePage('previous')}>{t('segment.previousBatch')}</button>
        <span role="status">{view.paging ? t('history.loadingBatch') : t('segment.batchCount', {page: view.page, count: view.list.entries.length})}</span>
        <button disabled={view.paging || !view.list.hasMore} onClick={() => void reader.changePage('next')}>{t('segment.earlier')}</button>
      </div>
      <p className="note">{t('segment.batchScope', {count: view.list.limit})}</p>
    </>}
    {!view.loading && selected && <>
      <PartialListeningScopeNotice scope={view.listeningScope}/>
      <h3>{t('segment.startedAt', {date: date(selected.startedAt)})}</h3>
      <p>{selected.endedAt ? t('segment.endedAt', {date: date(selected.endedAt)}) : t('segment.endTimeMissing')} · {t('segment.selectedScope', {count: selected.facts.length})}</p>
      <details><summary>{t('segment.versions')}</summary>
        <p className="note">{t('segment.selectedSource', {session: selected.sessionId, segment: selected.segmentId, writer: selected.writerInstanceId, generation: selected.generation})}</p>
        <p className="note">{t('segment.selectedVersions', {schema: selected.schemaVersion, material: selected.material.id, version: selected.material.version, training: selected.rules.trainingSchemaVersion, rule: selected.rules.ruleVersion, pace: selected.rules.paceRuleVersion})}</p>
      </details>
      <h3>{t('segment.eventsHeading')}</h3>
      <p className="note">{t('segment.eventScope')}</p>
      {selected.facts.length === 0 ? <p className="empty">{t('segment.noEvents')}</p> : <details><summary>{t('segment.viewEvents', {count: selected.facts.length})}</summary><div className="attempt-list">{selected.facts.map(fact => <details key={fact.sourceEventId}>
        <summary>{t('segment.eventSummary', {number: fact.ordinal, type: t(factNames[fact.type]), date: date(fact.wallTime)})}</summary>
        <FactContent fact={fact}/>
        <details><summary>{t('segment.rawEvent')}</summary><p className="note">{t('segment.rawEventScope')}</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(fact, null, 2)}</pre></details>
      </details>)}</div></details>}
      <div className="button-row"><button disabled={view.downloading} onClick={() => void reader.download('json', download)}>{t('segment.downloadJson')}</button><button disabled={view.downloading} onClick={() => void reader.download('csv', download)}>{t('segment.downloadCsv')}</button></div>
      <p className="note">{view.listeningScope ? t('segment.listeningExport') : t('segment.exportScope')}</p>
      <details><summary>{t('segment.exportFormat')}</summary><p className="note">{view.listeningScope ? t('segment.listeningCsv') : t('segment.csv')}</p></details>
    </>}
  </section>;
}
