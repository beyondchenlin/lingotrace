'use client';
import { useStudioLocale } from '../i18n/react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LegacyHistorySession } from '../core/legacy-history';
import type { LegacyHistoryAccess } from '../core/legacy-history-reader';
import { LegacyResultCardDelivery } from '../core/legacy-result-card-delivery';
import { projectLegacyResultCard, renderLegacyResultCard, LEGACY_RESULT_CARD_WIDTH, LEGACY_RESULT_CARD_HEIGHT } from '../core/legacy-result-card';

type Props = { session: LegacyHistorySession; repository: LegacyHistoryAccess; download: (name: string, blob: Blob) => void };
function Preview({ session, repository, download, close }: Props & { close: () => void }) {
  const {t, ui} = useStudioLocale();
  const [words, setWords] = useState(true), [completion, setCompletion] = useState(true);
  const [ready, setReady] = useState(false), [drawFailed, setDrawFailed] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null), alive = useRef(false);
  const [delivery] = useState(() => new LegacyResultCardDelivery(repository));
  const result = useMemo(() => { try { return { model: projectLegacyResultCard(session, { words, completion }), error: false }; } catch { return { model: null, error: true }; } }, [session, words, completion]);
  useLayoutEffect(() => { alive.current = true; delivery.activate(); return () => { alive.current = false; delivery.dispose(); }; }, [delivery]);
  useLayoutEffect(() => {
    let cancelled = false; delivery.invalidate(); setReady(false); setDrawFailed(false); setMessage('');
    const paint = async () => {
      try {
        await document.fonts.ready;
        if (cancelled || !result.model || !canvas.current) return;
        const ctx = canvas.current.getContext('2d'); if (!ctx) throw Error('Canvas unavailable');
        renderLegacyResultCard(ctx, result.model);
        if (!cancelled) setReady(true);
      } catch { if (!cancelled) { setDrawFailed(true); setMessage(t('resultCard.generationFailed')); } }
    };
    void paint();
    return () => { cancelled = true; delivery.invalidate(); };
  }, [result.model, delivery]);
  const cancel = () => { delivery.dispose(); alive.current = false; close(); };
  const save = async () => {
    if (!ready || busy || !canvas.current || !result.model) return;
    setBusy(true); setMessage('');
    const target = canvas.current;
    try {
      const delivered = await delivery.download(session, () => new Promise<Blob>((resolve, reject) => {
        target.toBlob(blob => blob ? resolve(blob) : reject(Error('PNG unavailable')), 'image/png');
      }), download);
      if (alive.current && delivered) setMessage(t('resultCard.downloaded'));
    } catch { if (alive.current) setMessage(t('resultCard.downloadFailed')); }
    finally { if (alive.current) setBusy(false); }
  };
  return <section aria-label={t('resultCard.previewLabel')} style={{ marginBlock: 20, minWidth: 0 }}>
    <h3>{t('resultCard.heading')}</h3>
    <p className="note">{t('resultCard.imageLanguage')}</p>
    <p className="note">{t('resultCard.privacy')}</p>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      <legend>{t('resultCard.fields')}</legend>
      <label><input type="checkbox" checked={words} disabled={words && !completion} onChange={event => setWords(event.target.checked)}/>{t('resultCard.confirmedWords')}</label>
      <label><input type="checkbox" checked={completion} disabled={completion && !words} onChange={event => setCompletion(event.target.checked)}/>{t('resultCard.completion')}</label>
    </fieldset>
    {result.error ? <p className="notice warn" role="alert">{t('resultCard.insufficientEvidence')}</p> : <>
      <p className="note" data-card-values="true">{words ? t('resultCard.wordCount', {count: session.snapshot.earnedWords}) : t('resultCard.wordsHidden')} · {completion ? t('resultCard.sentenceCount', {done: session.snapshot.completedCueIds.length, total: session.snapshot.material.cues.length}) : t('resultCard.progressHidden')}{t('resultCard.metricScope')}</p>
      <canvas ref={canvas} width={LEGACY_RESULT_CARD_WIDTH} height={LEGACY_RESULT_CARD_HEIGHT} role="img" aria-label={t('resultCard.imageLabel', {words: words ? t('resultCard.wordCount', {count: session.snapshot.earnedWords}) : t('resultCard.wordsHidden'), completion: completion ? t('resultCard.sentenceCount', {done: session.snapshot.completedCueIds.length, total: session.snapshot.material.cues.length}) : t('resultCard.progressHidden')})} style={{ display: ready ? 'block' : 'none', width: '100%', height: 'auto', borderRadius: 12, marginBlock: 12 }}/>
      {!ready && !drawFailed && <p role="status">{t('resultCard.generating')}</p>}
    </>}
    <div className="button-row"><button disabled={!ready || busy || result.error} onClick={() => void save()}>{busy ? t('resultCard.downloading') : t('resultCard.download')}</button><button onClick={cancel}>{t('resultCard.cancel')}</button></div>
    {message && <p className="notice" role="status">{ui(message)}</p>}
    <p className="note">{t('resultCard.exportScope')}</p>
  </section>;
}
export default function LegacyResultCard(props: Props) {
  const {t} = useStudioLocale();
  const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null), restoreFocus = useRef(false);
  useLayoutEffect(() => { if (!open && restoreFocus.current) { restoreFocus.current = false; trigger.current?.focus(); } }, [open]);
  return open ? <Preview {...props} close={() => { restoreFocus.current = true; setOpen(false); }}/> : <div className="button-row"><button ref={trigger} onClick={() => setOpen(true)}>{t('resultCard.open')}</button></div>;
}
