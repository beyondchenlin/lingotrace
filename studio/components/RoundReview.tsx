import {useStudioLocale} from '../i18n/react';
import {projectAttemptReferenceExposure} from '../core/reference-exposure';
import {useMemo, useState,type ReactNode} from 'react';
import {projectRoundReview, type RoundReviewStatus} from '../core/round-review';
import type {Attempt, TrainingSnapshot} from '../core/training';
const statusKeys = {unsubmitted:'review.unsubmitted', 'needs-correction':'review.needsCorrection', matched:'review.latestMatched', unavailable:'review.notComparable'} as const satisfies Record<RoundReviewStatus, string>;
const textStyle = {whiteSpace:'pre-wrap', overflowWrap:'anywhere'} as const;
function Submission({attempt, title,snapshot,assistance}: {attempt: Attempt; title: string;snapshot:TrainingSnapshot;assistance?:(attempt:Attempt)=>string}) {
  const {t, ui} = useStudioLocale();
  return <div>
    <h4>{title} · {attempt.accuracy}%</h4>
    <p style={textStyle}>{attempt.answer}</p>
    <p className="note">{projectAttemptReferenceExposure(snapshot,attempt).status==='recorded'?t('review.referenceViewed'):''}{assistance?ui(assistance(attempt)):`${attempt.conditions.hinted?t('review.hinted'):t('review.noHint')} · ${attempt.conditions.revealed?t('review.subtitlesViewed'):t('review.subtitlesNotViewed')}`} · {attempt.conditions.pasted?t('review.pasted'):t('review.notPasted')} · {attempt.conditions.inputSource==='ime'?t('review.ime'):attempt.conditions.inputSource==='paste'?t('review.pasteInput'):t('review.keyboardInput')}</p>
  </div>;
}
export default function RoundReview({snapshot, disabledReason, onContinue, renderContextBookmark,assistance}: {
  assistance?:(attempt:Attempt)=>string; snapshot: TrainingSnapshot; disabledReason: string | null; onContinue: (cueId: string) => void; renderContextBookmark?: (cueId:string)=>ReactNode;
}) {
  const {t, ui} = useStudioLocale();
  const review = useMemo(() => projectRoundReview(snapshot), [snapshot]);
  const [onlyCorrections, setOnlyCorrections] = useState(false);
  const rows = onlyCorrections ? review.rows.filter(row => row.status === 'needs-correction') : review.rows;
  return <section className="round-review" aria-label={t('review.roundLabel')}>
    <h2>{t('review.heading')}</h2>
    <p className="note">{t('review.roundCounts', {corrections: review.needsCorrection, matched: review.matched, unsubmitted: review.unsubmitted})}</p>
    <label className="round-review-filter"><input type="checkbox" checked={onlyCorrections} onChange={event => setOnlyCorrections(event.target.checked)}/>{t('review.onlyCorrections')}</label>
    <p className="note">{t('review.roundScope')}</p>
    {disabledReason && <p className="notice">{ui(disabledReason)}</p>}
    {!rows.length && <p className="empty">{t('review.noCorrections')}</p>}
    <div className="attempt-list">{rows.map(row => <details key={row.cueId}>
      <summary>{t('review.sentenceNumber', {number: row.cueIndex + 1})} · {t(statusKeys[row.status])}{row.first && row.latest ? t('review.submissionChange', {first: row.first.accuracy, latest: row.latest.accuracy, count: row.submissions}) : ''}</summary>
      {row.first && row.latest ? <>
        <h4>{t('review.submittedReference')}</h4><p style={textStyle}>{row.latest.reference}</p>
        <Submission assistance={assistance} snapshot={snapshot} attempt={row.first} title={t('review.firstSubmission')}/>
        {row.latest !== row.first ? <Submission assistance={assistance} snapshot={snapshot} attempt={row.latest} title={t('review.latestSubmission')}/> : <p className="note">{t('review.singleSubmission')}</p>}
        <h4>{t('review.latestErrors')}</h4>
        {row.latest.errors === 0 ? <p>{t('review.noSavedErrors')}</p> : <ul>{row.latest.alignment.filter(token => token.kind !== 'match').map((token, i) => <li key={i} style={textStyle}>
          {token.kind === 'missing' ? t('review.missingWord', {word: token.expected}) : token.kind === 'extra' ? t('review.extraWord', {word: token.actual}) : t('review.wrongWord', {actual: token.actual, expected: token.expected})}
        </li>)}</ul>}
        <p className="note">{row.latest.ruleVersion} · {row.latest.materialVersion}</p>
        {renderContextBookmark?.(row.cueId)}
      </> : <p className="note">{row.status === 'unsubmitted' ? t('review.noSubmissionDetails') : t('review.associationUnavailable')}</p>}
      <button type="button" className="round-review-continue primary" disabled={!!disabledReason} onClick={() => onContinue(row.cueId)}>{t('review.continueSentence', {number: row.cueIndex + 1})}</button>
    </details>)}</div>
    <p className="note">{t('review.continueNotice')}</p>
  </section>;
}
