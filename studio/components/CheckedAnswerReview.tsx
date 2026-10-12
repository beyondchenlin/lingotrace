'use client';
import type {Attempt} from '../core/training';
import {useStudioLocale} from '../i18n/react';
/** Receives only getDraftFeedback's exact checked draft. It performs no scoring. */
export default function CheckedAnswerReview({attempt}:{attempt:Attempt}){
 const {t}=useStudioLocale();
 return <section className="checked-answer-review" aria-label={t('hud.reviewDifferences')}>
  <div className="checked-review-heading"><h2>{t('hud.reviewDifferences')}</h2><span className={attempt.errors?'checked-error-count':'checked-success-count'}>{attempt.errors?`! ${t('hud.errorCount',{count:attempt.errors})}`:t('hud.correct')}</span></div>
  <p className="note">{t('scene.checkedReview')}</p>
  <div className="token-list" aria-label={t('hud.reviewDifferences')}>{attempt.alignment.map((token,index)=><span key={index} className={token.kind}>
   <strong>{t(token.kind==='match'?'hud.correct':token.kind==='replace'?'hud.wrong':token.kind==='missing'?'hud.missing':'hud.extra')}: </strong>
   <span className="checked-token-text">{token.actual||token.expected}{token.kind==='replace'?` → ${token.expected}`:''}</span>
  </span>)}</div>
 </section>;
}
