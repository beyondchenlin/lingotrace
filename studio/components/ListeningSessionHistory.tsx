'use client';
import {useStudioLocale} from '../i18n/react';
import type { MessageKey } from '../i18n/locale';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { IndexedDBTrainingRepository } from '../core/repository';
import type { ListeningSessionRecord, PartialListeningScope } from '../core/listening-session';
import { readPartialListeningScope } from '../core/listening-session';
import { listeningSessionExport, projectListeningSessionHistory } from '../core/listening-session-export';
import type { Assistance, AssistanceCoverage } from '../core/listening-flow';

type Access = Pick<IndexedDBTrainingRepository, 'listListeningSessions' | 'deliverListeningSession'>;
type HistoryProps = {
  repository: Access;
  download: (name: string, blob: Blob) => void;
  initialSessionId?: string;
  detailOnly?: boolean;
};
type HistoryRead = {
  records: readonly ListeningSessionRecord[];
  repository: Access;
  initialSessionId: string | undefined;
  detailOnly: boolean;
};
const assistanceKeys: Record<Assistance, MessageKey> = { 'known-assisted': 'listeningHistory.assisted', 'no-observed-assistance': 'listeningHistory.noObservedAssistance', unknown: 'listeningHistory.unknownAssistance' };
const coverageKeys: Record<AssistanceCoverage, MessageKey> = { 'complete-to-submit': 'listeningHistory.completeCoverage', partial: 'listeningHistory.partialCoverage', unavailable: 'listeningHistory.unknownCoverage' };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Read-only B history. No restore, migration or same-round clean recovery action. */
export default function ListeningSessionHistory({ repository, download, initialSessionId, detailOnly = false }: HistoryProps) {
  const {t,ui,locale}=useStudioLocale();
  const [read, setRead] = useState<HistoryRead | null>(null);
  const [selection, setSelection] = useState({ initialSessionId, id: initialSessionId ?? null });
  const [loading, setLoading] = useState(false), [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const readToken = useRef(0), exportToken = useRef(0), mounted = useRef(true), exporting = useRef(false);
  const activeRecord = useRef<ListeningSessionRecord | null>(null);
  const refresh = useCallback(async () => {
    const token = ++readToken.current; ++exportToken.current; exporting.current = false; activeRecord.current = null;
    // Clear the old payload before clearing errors: a pending/failed read must
    // never re-enable export of the previously selected calendar identity.
    setRead(null); setDownloading(false); setLoading(true); setError(null); setNotice(null);
    try {
      const records = await repository.listListeningSessions();
      if (mounted.current && token === readToken.current) setRead({ records, repository, initialSessionId, detailOnly });
    } catch (error) { if (mounted.current && token === readToken.current) setError(t('listeningHistory.readFailed', { details: errorText(error) })); }
    finally { if (mounted.current && token === readToken.current) setLoading(false); }
  }, [repository, initialSessionId, detailOnly, t]);
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; ++readToken.current; ++exportToken.current; exporting.current = false; activeRecord.current = null; }; }, [refresh]);
  // A new repository/target must not expose the previous render's payload while
  // its effect is waiting to run. detailOnly always follows the exact supplied ID.
  const records = read?.repository === repository && read.initialSessionId === initialSessionId && read.detailOnly === detailOnly ? read.records : null;
  const selectedId = detailOnly || selection.initialSessionId !== initialSessionId ? initialSessionId ?? null : selection.id;
  const selected = records?.find(record => record.sessionId === selectedId) ?? null;
  activeRecord.current = selected;
  const selectionReadToken = readToken.current;
  const projected = selected ? projectListeningSessionHistory(selected) : null;
  const choose = (id: string | null) => { ++exportToken.current; exporting.current = false; activeRecord.current = null; setDownloading(false); setSelection({ initialSessionId, id }); setNotice(null); };
  const exportRecord = async (format: 'json' | 'csv') => {
    if (!mounted.current || !selected || loading || exporting.current || activeRecord.current !== selected || selectionReadToken !== readToken.current) return;
    const token = ++exportToken.current; exporting.current = true; setDownloading(true); setError(null); setNotice(null);
    try {
      const artifact = listeningSessionExport(selected, format);
      await repository.deliverListeningSession(selected.sessionId, selected, () => {
        if (!mounted.current || token !== exportToken.current || activeRecord.current !== selected || selectionReadToken !== readToken.current) throw new Error(t('listeningHistory.changedExport'));
        download(artifact.name, new Blob([artifact.text], { type: artifact.mime }));
      });
      if (mounted.current && token === exportToken.current) setNotice(t('listeningHistory.downloadStarted'));
    } catch (error) { if (mounted.current && token === exportToken.current) setError(t('listeningHistory.exportFailed', { details: errorText(error) })); }
    finally { if (mounted.current && token === exportToken.current) { exporting.current = false; setDownloading(false); } }
  };
  return <section className="listening-session-history" aria-label={t('listeningHistory.title')}>
    <h3>{t('listeningHistory.title')}</h3>
    <p className="note">{t('listeningHistory.description')}</p>
    <div className="button-row"><button disabled={loading} onClick={() => void refresh()}>{loading ? t('listeningHistory.reading') : t('listeningHistory.refresh')}</button>{!detailOnly && selectedId && <button onClick={() => choose(null)}>{t('listeningHistory.back')}</button>}</div>
    {error && <p role="alert" className="notice">{ui(error)}</p>}
    {notice && <p role="status">{ui(notice)}</p>}
    {!detailOnly && !loading && !error && records?.length === 0 && <p className="note">{t('listeningHistory.empty')}</p>}
    {(detailOnly || selectedId) && !selected && !loading && !error && records && <p className="notice">{t('listeningHistory.selectionMissing')}</p>}
    {!detailOnly && !selected && records?.map(record => <div className="history-entry" key={record.sessionId}><button onClick={() => choose(record.sessionId)}>{record.trainingSnapshot.material.title} · {new Date(record.updatedAt).toLocaleString(locale)}</button><p className="note">{t('listeningHistory.actualAttempts')}{record.trainingSnapshot.attempts.length}{t('listeningHistory.conditionRevision')}{record.scope.revision}</p></div>)}
    {selected && projected && <>
      <h4>{selected.trainingSnapshot.material.title}</h4>
      <p className="note">{t('listeningHistory.originalRound')}{selected.trainingSnapshot.roundId}{t('listeningHistory.attemptSeparator')}{projected.attempts.length}{t('listeningHistory.pendingSeparator')}{projected.pending.length}{t('listeningHistory.discardedSeparator')}{projected.discarded.length}{t('listeningHistory.countUnit')}</p>
      <p className="note">{t('listeningHistory.legacyTime')}{(selected.trainingSnapshot.activeMs / 1000).toFixed(1)}{t('listeningHistory.separateDuration')}</p>
      {projected.attempts.length === 0 && <p>{t('listeningHistory.noAttempts')}</p>}
      <ol>{projected.attempts.map(({ attempt, assistance, coverage, boundaryRecorded }) => <li key={attempt.attemptId}>
        <p><strong>{attempt.conditions.exposure === 'first' ? t('listeningHistory.firstAttempt') : t('review.retry')}</strong>{t('listeningHistory.accuracy')}{attempt.accuracy.toFixed(1)}{t('listeningHistory.originalGain')}{attempt.gain} · {t(assistanceKeys[assistance])} · {t(coverageKeys[coverage])}</p>
        {!boundaryRecorded && <p className="note">{t('listeningHistory.noBoundary')}</p>}
        <p>{t('listeningHistory.answer')}{attempt.answer}</p><p>{t('listeningHistory.reference')}{attempt.reference}</p>
      </li>)}</ol>
      {(projected.pending.length > 0 || projected.discarded.length > 0) && <details><summary>{t('listeningHistory.unscoredFacts')}</summary><ul>{[...projected.pending, ...projected.discarded].map(boundary => <li key={boundary.eventId}>{boundary.disposition === 'pending' ? t('listeningHistory.pending') : t('listeningHistory.discarded')}{t('listeningHistory.cueSeparator')}{boundary.cueId} · {t(assistanceKeys[boundary.assistance])} · {t(coverageKeys[boundary.coverage])}</li>)}</ul></details>}
      <details><summary>{t('listeningHistory.oldReceipt')}</summary>{selected.preBRecord ? <p>{t('listeningHistory.originalSequence')}{selected.preBRecord.sequence}{t('listeningHistory.originalAttempts')}{selected.preBRecord.snapshot.attempts.length}{t('listeningHistory.savedAt')}{new Date(selected.preBRecord.updatedAt).toLocaleString(locale)}{t('listeningHistory.receiptExport')}</p> : <p>{t('listeningHistory.noReceipt')}</p>}<p className="note">{t('listeningHistory.receiptNotice')}</p></details>
      <div className="button-row"><button disabled={downloading || loading} onClick={() => void exportRecord('json')}>{t('listeningHistory.json')}</button><button disabled={downloading || loading} onClick={() => void exportRecord('csv')}>{t('listeningHistory.csv')}</button></div>
      <p className="note">{t('listeningHistory.csvNotice')}</p>
    </>}
  </section>;
}

/** Parent supplies a validated marker alongside its original partial record/export. */
export function PartialListeningScopeNotice({ scope }: { scope: PartialListeningScope | null }) {
  const {t}=useStudioLocale();
  if (!scope) return null;
  const valid = readPartialListeningScope(scope);
  return <p className="notice" data-listening-coverage={valid.coverage}>{t('listeningHistory.partialNotice')}</p>;
}
