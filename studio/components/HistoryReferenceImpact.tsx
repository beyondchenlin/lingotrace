'use client';
import {useLayoutEffect, useMemo, useState} from 'react';
import {useStudioLocale} from '../i18n/react';
import type {LocalReferenceMaterial} from '../core/local-reference';
import {ReferenceRevisionImpactReader, type ReferenceRevisionImpactAccess, type ReferenceRevisionImpactView, type ReferenceRevisionKind} from '../core/reference-revision-impact';

const kindKeys = {
  text: 'referenceImpact.text', timing: 'referenceImpact.timing', 'text-and-timing': 'referenceImpact.textAndTiming',
  merge: 'referenceImpact.merge', split: 'referenceImpact.split',
} as const satisfies Record<ReferenceRevisionKind, string>;

/** A separate, read-only observer. It cannot adopt references, expose corrected
 * text, rescore attempts, alter exports, or write to a training/task repository. */
export default function HistoryReferenceImpact({material, repository}: {material: LocalReferenceMaterial; repository: ReferenceRevisionImpactAccess}) {
  const {t} = useStudioLocale();
  const reader = useMemo(() => new ReferenceRevisionImpactReader(repository, material), [repository, material]);
  const [observed, setObserved] = useState<{reader: ReferenceRevisionImpactReader; view: ReferenceRevisionImpactView}>(() => ({reader, view: reader.getSnapshot()}));
  // New props never render the previous material's evidence, even before effects.
  const view = observed.reader === reader ? observed.view : reader.getSnapshot();
  useLayoutEffect(() => {
    const unsubscribe = reader.subscribe(() => setObserved({reader, view: reader.getSnapshot()}));
    reader.activate();
    const refresh = () => {if (!document.hidden) void reader.refresh();};
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => {unsubscribe(); reader.dispose(); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh);};
  }, [reader]);
  const result = view.result;
  return <section aria-label={t('referenceImpact.heading')} data-reference-revision-status={view.status}>
    <h3>{t('referenceImpact.heading')}</h3>
    <p className="note">{t('referenceImpact.scope')}</p>
    {(view.status === 'idle' || view.status === 'loading') && <p role="status">{t('referenceImpact.loading')}</p>}
    {view.status === 'unavailable' && <p className="notice warn" role="status">{t('referenceImpact.unavailable')}</p>}
    {result && <>
      {result.unreadableCount > 0 && <p className="notice warn" role="status">{t('referenceImpact.partial', {count: result.unreadableCount})}</p>}
      {result.status === 'no-match' ? <p className="note">{t('referenceImpact.noMatch')}</p> : <ul>{result.revisions.map(revision => <li key={revision.key}>
        <p><strong>{t(revision.relation === 'direct' ? 'referenceImpact.direct' : 'referenceImpact.subsequent')}</strong> · {t(kindKeys[revision.kind])}</p>
        <p className="note">{t('referenceImpact.sentences', {numbers: revision.affectedHistoricalUnitIds.map(id => material.cues.findIndex(cue => cue.id === id) + 1).join(', ')})} · {t('referenceImpact.version', {version: revision.materialVersion})}</p>
      </li>)}</ul>}
    </>}
    <button disabled={view.status === 'loading'} onClick={() => void reader.refresh()}>{t('referenceImpact.refresh')}</button>
  </section>;
}
