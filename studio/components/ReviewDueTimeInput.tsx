'use client';

import {useStudioLocale} from '../i18n/react';
import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {formatReviewDueTime, resolveReviewLocalTime, validateReviewDueTime, type ReviewDueTime} from '../core/review-due-time';

export interface ReviewDueTimeInputProps {
  value: ReviewDueTime | null;
  onChange: (value: ReviewDueTime | null) => void;
  label?: string;
  disabled?: boolean;
}
interface Draft {localTime: string; timeZone: string; selectedInstant: string | null}
function fromValue(value: ReviewDueTime | null): Draft {
  return {localTime: value?.localTime ?? '', timeZone: value?.timeZone ?? 'UTC', selectedInstant: value?.instant ?? null};
}
function valueKey(value: ReviewDueTime | null): string | null {
  return value ? JSON.stringify([value.instant, value.localTime, value.timeZone, value.offsetMinutes]) : null;
}
function resolveDraft(draft: Draft): {candidates: ReviewDueTime[]; error: string | null} {
  if (!draft.localTime) return {candidates: [], error: null};
  try {return {candidates: resolveReviewLocalTime(draft.localTime, draft.timeZone), error: null};}
  catch (error) {return {candidates: [], error: error instanceof Error ? error.message : '日期或时区无效。'};}
}

/** A manual form control only. It never creates a plan, reads history or chooses an interval. */
export function ReviewDueTimeInput({value, onChange, label, disabled = false}: ReviewDueTimeInputProps) {
  const {t, ui} = useStudioLocale();
  const id = useId();
  const checked = useMemo(() => {
    try {return {value: value === null ? null : validateReviewDueTime(value), error: null};}
    catch {return {value: null, error: '传入的到期时间无法核验，请重新选择明确的日期和时区。'};}
  }, [value]);
  const [draft, setDraft] = useState<Draft>(() => fromValue(checked.value));
  const [localZone, setLocalZone] = useState<string | null>(null);
  const emittedKey = useRef(valueKey(checked.value));
  const incomingKey = valueKey(checked.value);
  useEffect(() => {
    // Keep unfinished input when the parent echoes our null/valid output, but
    // accept an independently loaded or cleared parent value without emitting.
    if (incomingKey !== emittedKey.current) setDraft(fromValue(checked.value));
    emittedKey.current = incomingKey;
  }, [incomingKey, checked.value]);
  useEffect(() => {
    try {setLocalZone(Intl.DateTimeFormat().resolvedOptions().timeZone);} catch {/* UTC stays explicit. */}
  }, []);
  const result = useMemo(() => resolveDraft(draft), [draft]);
  const selected = result.candidates.find(candidate => candidate.instant === draft.selectedInstant) ?? null;
  const ambiguous = result.candidates.length > 1;
  const gap = !!draft.localTime && !result.error && !result.candidates.length;
  const options = Array.from(new Set(['UTC', localZone, 'Asia/Shanghai', 'America/Los_Angeles'].filter((zone): zone is string => !!zone)));

  function emit(next: ReviewDueTime | null) {
    emittedKey.current = valueKey(next);
    onChange(next);
  }
  function edit(next: Draft) {
    if (disabled) return;
    const nextResult = resolveDraft(next);
    const candidate = nextResult.candidates.length === 1 ? nextResult.candidates[0] : null;
    setDraft({...next, selectedInstant: candidate?.instant ?? null});
    emit(candidate);
  }
  function choose(candidate: ReviewDueTime) {
    if (disabled) return;
    setDraft({...draft, selectedInstant: candidate.instant});
    emit(candidate);
  }
  function clear() {
    if (disabled) return;
    setDraft({...draft, localTime: '', selectedInstant: null});
    emit(null);
  }

  return <fieldset disabled={disabled} aria-describedby={`${id}-help ${id}-status`}>
    <legend>{label ?? t('reviewDue.label')}</legend>
    <label htmlFor={`${id}-local`}>{t('reviewDue.localDateTime')}</label>
    <input id={`${id}-local`} type="datetime-local" step={60} value={draft.localTime}
      aria-invalid={!!result.error || gap} aria-describedby={`${id}-status`}
      onChange={event => edit({...draft, localTime: event.target.value, selectedInstant: null})}/>
    <label htmlFor={`${id}-zone`}>{t('reviewDue.timeZone')}</label>
    <input id={`${id}-zone`} type="text" list={`${id}-zones`} value={draft.timeZone} autoComplete="off" spellCheck={false}
      aria-invalid={!!result.error} aria-describedby={`${id}-status`}
      onChange={event => edit({...draft, timeZone: event.target.value, selectedInstant: null})}/>
    <datalist id={`${id}-zones`}>{options.map(zone => <option key={zone} value={zone}/>)}</datalist>
    <p id={`${id}-help`} className="note">{t('reviewDue.help')}</p>
    {ambiguous && <fieldset>
      <legend>{t('reviewDue.repeatedTime')}</legend>
      {result.candidates.map((candidate, index) => <label key={candidate.instant}>
        <input type="radio" name={`${id}-offset`} value={candidate.instant} checked={selected?.instant === candidate.instant}
          onChange={() => choose(candidate)}/>
        {t('reviewDue.occurrence', {number: index + 1, time: formatReviewDueTime(candidate), instant: candidate.instant})}
      </label>)}
    </fieldset>}
    <p id={`${id}-status`} role="status" aria-live="polite" className="note">
      {(checked.error ? ui(checked.error) : result.error ? ui(result.error) : null) || (gap ? t('reviewDue.skippedTime')
        : selected ? `${formatReviewDueTime(selected)}${Date.parse(selected.instant) <= Date.now() ? t('reviewDue.overdue') : ''}`
          : ambiguous ? t('reviewDue.offsetUnselected') : t('reviewDue.unselected'))}
    </p>
    <button type="button" onClick={clear}>{t('reviewDue.clear')}</button>
  </fieldset>;
}

export default ReviewDueTimeInput;
