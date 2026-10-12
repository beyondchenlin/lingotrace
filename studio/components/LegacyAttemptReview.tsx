import { useStudioLocale } from '../i18n/react';
import { projectLegacyAttemptReview, type LegacyAttemptReviewToken } from '../core/legacy-attempt-review';

const rawTextStyle = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const;
function SavedToken({ token }: { token: LegacyAttemptReviewToken }) {
  const {t, ui} = useStudioLocale();
  if (token.status === 'unavailable') return <li className="notice warn">
    <strong>{t('review.tokenUnavailable', {number: token.index + 1})}</strong>
    <p style={rawTextStyle}>{t('review.savedReferenceWord')}{token.expected === null ? t('review.unsavedOrInvalid') : token.expected === '' ? t('review.savedEmpty') : token.expected}</p>
    <p style={rawTextStyle}>{t('review.savedAnswerWord')}{token.actual === null ? t('review.unsavedOrInvalid') : token.actual === '' ? t('review.savedEmpty') : token.actual}</p>
    <p className="note">{ui(token.message)}</p>
  </li>;
  return <li className={`legacy-attempt-token ${token.kind}`} data-kind={token.kind} style={rawTextStyle}>
    <strong>{token.kind === 'match' ? t('review.tokenCorrect') : token.kind === 'replace' ? t('review.tokenWrong') : token.kind === 'missing' ? t('review.tokenMissing') : t('review.tokenExtra')} ({token.kind})</strong>
    {t('review.originalReferenceWord')}{token.expected === '' ? t('review.noReferenceWord') : token.expected}
    {t('review.originalAnswerWord')}{token.actual === '' ? t('review.unanswered') : token.actual}
  </li>;
}

/** Static saved-data view. No player, actions, lifecycle hooks or persistence. */
export default function LegacyAttemptReview({ snapshot, attempt }: { snapshot: unknown; attempt: unknown }) {
  const {t, ui} = useStudioLocale();
  const review = projectLegacyAttemptReview(snapshot, attempt);
  return <section className="legacy-attempt-review" aria-label={t('review.savedAttemptLabel')}>
    <p className="note">{t('review.originalReadOnly')}</p>
    <h3>{t('review.originalReference')}</h3>
    <p style={rawTextStyle}>{review.reference === null ? t('review.referenceUnavailable') : review.reference === '' ? t('review.emptyReference') : review.reference}</p>
    <h3>{t('review.originalAnswer')}</h3>
    <p style={rawTextStyle}>{review.answer === null ? t('review.answerUnavailable') : review.answer === '' ? t('review.emptyAnswer') : review.answer}</p>
    <p className="note" style={rawTextStyle}>{t('review.savedMaterial')}{review.materialId ?? t('review.unsavedOrInvalid')}{t('review.materialVersion')}{review.materialVersion ?? t('review.unsavedOrInvalid')}{t('review.cueId')}{review.cueId ?? t('review.unsavedOrInvalid')}</p>
    <p className="note">{t('review.cueTimes')}{review.cueInterval ? t('review.cueInterval', {start: review.cueInterval.start, end: review.cueInterval.end}) : t('review.cueTimeUnavailable')}</p>
    <p className="note" style={rawTextStyle}>{t('review.originalRule')}{review.ruleVersion ?? t('review.unsavedOrInvalid')}{t('review.noRecalculation')}</p>
    {review.issues.length > 0 && <ul className="notice warn" aria-label={t('review.recordAvailability')}>{review.issues.map((issue, index) => <li key={index}>{ui(issue)}</li>)}</ul>}
    <h3>{t('review.originalAlignment')}</h3>
    <p className={review.alignment.status === 'saved' ? 'note' : 'notice warn'}>{ui(review.alignment.message)}</p>
    {review.zeroWords && <p className="note">{t('review.zeroReferenceWords')}</p>}
    {review.alignment.tokens.length > 0 && <ol aria-label={t('review.savedAlignment')} className="legacy-attempt-token-list">{review.alignment.tokens.map(token => <SavedToken key={token.index} token={token}/>)}</ol>}
    <p className="notice" aria-label={t('review.originalReplayStatus')}>{ui(review.media.message)}</p>
  </section>;
}
