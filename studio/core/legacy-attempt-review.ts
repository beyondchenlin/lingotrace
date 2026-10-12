/** A display-only projection of saved Training evidence. The read-only built-in
 * catalogue admits only its exact source profile; no engine, storage, media or scoring dependency. */
import { BUILTIN_TRAINING_SCHEMA, isBuiltinMaterial } from './builtin-material.ts';
export const LEGACY_ATTEMPT_REVIEW_VERSION = 'legacy-attempt-review-v1' as const;
export const LEGACY_ATTEMPT_MEDIA_UNAVAILABLE = '无法重听：Training v1 旧记录缺少可核验的原媒体关联（mediaId、内容哈希或来源绑定）。仅有素材版本和句子时间不能证明原媒体；不会用当前媒体补配。';

export type LegacyAttemptTokenKind = 'match' | 'missing' | 'extra' | 'replace';
export const LEGACY_ATTEMPT_TOKEN_LABELS: Readonly<Record<LegacyAttemptTokenKind, string>> = Object.freeze({
  match: '正确', missing: '漏词', extra: '多词', replace: '错词（替换）',
});
export type LegacyAttemptReviewToken =
  | { readonly status: 'saved'; readonly index: number; readonly kind: LegacyAttemptTokenKind; readonly label: string;
      readonly position: number | null; readonly expected: string; readonly actual: string }
  | { readonly status: 'unavailable'; readonly index: number; readonly expected: string | null; readonly actual: string | null; readonly message: string };
export interface LegacyAttemptReviewProjection {
  readonly version: typeof LEGACY_ATTEMPT_REVIEW_VERSION;
  readonly reference: string | null;
  readonly answer: string | null;
  readonly materialId: string | null;
  readonly materialVersion: string | null;
  readonly cueId: string | null;
  readonly ruleVersion: string | null;
  readonly cueInterval: Readonly<{ start: number; end: number }> | null;
  readonly alignment: Readonly<{
    status: 'saved' | 'partial' | 'empty' | 'unavailable';
    tokens: readonly LegacyAttemptReviewToken[];
    message: string;
  }>;
  readonly zeroWords: boolean;
  readonly issues: readonly string[];
  readonly media: Readonly<{ status: 'unavailable'; message: string }>;
}

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try { return Object.getPrototypeOf(value) === Object.prototype ? value as RecordValue : null; } catch { return null; }
}
/** Stored data must be own data properties. Never execute a supplied getter. */
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  try {
    const property = Object.getOwnPropertyDescriptor(value, key);
    return property && Object.hasOwn(property, 'value') ? property.value : undefined;
  } catch { return undefined; }
}
function entries(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  const length = own(value, 'length');
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return null;
  return Array.from({ length }, (_, index) => own(value, String(index)));
}
const text = (value: unknown): string | null => typeof value === 'string' ? value : null;
const identity = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;
const finiteTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const position = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const tokenKeys = ['kind', 'position', 'expected', 'actual'] as const;
const reviewKeys = ['attemptId', 'sessionId', 'roundId', 'materialId', 'materialVersion', 'cueId', 'reference', 'answer', 'ruleVersion', 'words'] as const;

/** Permit an equal copied attempt, but never join a different answer or cue by ID. */
function sameSavedAttempt(saved: RecordValue, supplied: RecordValue): boolean {
  if (saved === supplied) return true;
  if (!reviewKeys.every(key => Object.is(own(saved, key), own(supplied, key)))) return false;
  const a = own(saved, 'alignment'), b = own(supplied, 'alignment');
  if (a === b) return true;
  const left = entries(a), right = entries(b);
  return !!left && !!right && left.length === right.length && left.every((token, index) => {
    const other = right[index];
    return !!record(token) && !!record(other) && tokenKeys.every(key => Object.is(own(token, key), own(other, key)));
  });
}
function conflictingPositions(values: readonly unknown[], words: number): Set<number> {
  const invalid = new Set<number>(), positions: { index: number; at: number }[] = [], counts = new Map<number, number>();
  values.forEach((value, index) => {
    const token = record(value), kind = own(token, 'kind'), at = own(token, 'position');
    if ((kind === 'match' || kind === 'replace' || kind === 'missing') && position(at) && at < words) {
      positions.push({ index, at }); counts.set(at, (counts.get(at) ?? 0) + 1);
    }
  });
  let highest = -1;
  for (const { index, at } of positions) {
    if (at < highest || counts.get(at)! > 1) invalid.add(index);
    highest = Math.max(highest, at);
  }
  let lowest = Infinity;
  for (let i = positions.length - 1; i >= 0; i--) {
    const { index, at } = positions[i];
    if (at > lowest) invalid.add(index);
    lowest = Math.min(lowest, at);
  }
  return invalid;
}
function projectToken(value: unknown, index: number, words: number, conflicts: ReadonlySet<number>): LegacyAttemptReviewToken {
  const token = record(value), expected = text(own(token, 'expected')), actual = text(own(token, 'actual'));
  const kind = own(token, 'kind'), at = own(token, 'position');
  const nonempty = (value: string | null) => value !== null && value.trim().length > 0;
  const targetPosition = position(at) && at < words && !conflicts.has(index);
  const valid = kind === 'extra' ? at === null && expected === '' && nonempty(actual)
    : kind === 'missing' ? targetPosition && nonempty(expected) && actual === ''
    : (kind === 'match' || kind === 'replace') && targetPosition && nonempty(expected) && nonempty(actual);
  // Do not re-tokenize or reinterpret equality: historical rules may normalize
  // differently. The saved kind, spelling, order and position are the evidence.
  if (!valid) return Object.freeze({ status: 'unavailable', index, expected, actual, message: '此项保存的逐词字段缺失、非法或位置冲突，判定不可用；可读原文仍保留。' });
  return Object.freeze({ status: 'saved', index, kind: kind as LegacyAttemptTokenKind, label: LEGACY_ATTEMPT_TOKEN_LABELS[kind as LegacyAttemptTokenKind],
    position: at as number | null, expected: expected!, actual: actual! });
}

/** This is not a replacement record reader. The repository still rejects invalid
 * records. Unknown inputs are accepted only to make this UI boundary defensive:
 * retain safe stored text, mark missing/conflicting evidence, never repair it. */
export function projectLegacyAttemptReview(snapshot: unknown, attempt: unknown): LegacyAttemptReviewProjection {
  const s = record(snapshot), a = record(attempt), material = record(own(s, 'material'));
  const reference = text(own(a, 'reference')), answer = text(own(a, 'answer'));
  const materialId = identity(own(a, 'materialId')), materialVersion = identity(own(a, 'materialVersion'));
  const cueId = identity(own(a, 'cueId')), ruleVersion = identity(own(a, 'ruleVersion'));
  const issues: string[] = [];
  let associated = true;
  const conflict = (message: string) => { associated = false; issues.push(message); };
  let builtin = false;
  try { builtin = isBuiltinMaterial(material); }
  catch { conflict('内置素材与保存的来源绑定不一致，不能借用其他参考或媒体。'); }
  if (!s || !a || own(s, 'schemaVersion') !== (builtin ? BUILTIN_TRAINING_SCHEMA : 'lingotrace-session-v1')) conflict('保存快照或提交的数据结构无法核验。');
  if (builtin) {
    const events = entries(own(s, 'events')), first = events?.[0];
    let boundStart = false;
    try { boundStart = own(first, 'type') === 'sessionStarted' && isBuiltinMaterial(own(first, 'material')); } catch { /* Unavailable; never repair a source declaration. */ }
    if (!events?.length || !boundStart || events.some(event => own(event, 'schemaVersion') !== BUILTIN_TRAINING_SCHEMA
      || own(event, 'materialId') !== own(material, 'id') || own(event, 'materialVersion') !== own(material, 'version'))) conflict('保存事件与内置素材的版本或来源绑定不一致，逐词关联不可核验。');
  }
  for (const [key, label] of [['sessionId', '会话'], ['roundId', '轮次']] as const) {
    const saved = identity(own(s, key)), submitted = identity(own(a, key));
    if (!saved || !submitted || saved !== submitted) conflict(`提交与保存快照的${label}关联缺失或冲突。`);
  }
  if (!materialId || !materialVersion || materialId !== identity(own(material, 'id')) || materialVersion !== identity(own(material, 'version'))) {
    conflict('提交与嵌入素材的 ID 或版本缺失、冲突，不能借用其他素材。');
  }
  const attemptId = identity(own(a, 'attemptId')), attempts = entries(own(s, 'attempts'));
  const matches = attemptId && attempts ? attempts.map(record).filter(saved => saved && own(saved, 'attemptId') === attemptId) : [];
  if (!a || matches.length !== 1 || !sameSavedAttempt(matches[0]!, a)) conflict('无法确认这是该快照中唯一且未被替换的原提交。');
  const cues = entries(own(material, 'cues'));
  const matchingCues = cueId && cues ? cues.map(record).filter(cue => cue && own(cue, 'id') === cueId) : [];
  const cue = matchingCues.length === 1 ? matchingCues[0] : null;
  if (!cue) conflict('原句关联缺失、重复或冲突，句子时间和逐词关联不可核验。');
  if (reference === null) conflict('原参考文本未保存或格式非法，不能用素材中的句子补填。');
  else if (cue && reference !== text(own(cue, 'text'))) conflict('提交的原参考与嵌入素材原句不一致；保留提交原文，句子时间和逐词关联不可核验。');
  if (answer === null) issues.push('原答案未保存或格式非法，不能当作空答案。');
  if (ruleVersion === null) issues.push('原判定规则未保存或格式非法，逐词判定不可核验。');

  let cueInterval: LegacyAttemptReviewProjection['cueInterval'] = null;
  if (associated && cue) {
    const start = own(cue, 'start'), end = own(cue, 'end');
    if (finiteTime(start) && finiteTime(end) && end >= start) cueInterval = Object.freeze({ start, end });
    else issues.push('原句起止时间缺失或非法，不能用当前素材时间补填。');
  }
  const savedTokens = entries(own(a, 'alignment')), words = own(a, 'words');
  let alignment: LegacyAttemptReviewProjection['alignment'];
  if (!associated || answer === null || ruleVersion === null) {
    alignment = { status: 'unavailable', tokens: Object.freeze([]), message: '逐词判定不可用：原提交、原句或判定规则的关联无法核验。未重新计算。' };
  } else if (savedTokens === null) {
    alignment = { status: 'unavailable', tokens: Object.freeze([]), message: '原记录未保存可读取的逐词判定（alignment），不能据此判断全对或补算。' };
  } else if (!position(words)) {
    alignment = { status: 'unavailable', tokens: Object.freeze([]), message: '原记录的参考词数缺失或非法，无法核验逐词位置；未重新分词或补算。' };
  } else if (savedTokens.length === 0) {
    alignment = { status: 'empty', tokens: Object.freeze([]), message: '原记录的逐词判定为空，不能据此判断全对；未补算。' };
  } else {
    const conflicts = conflictingPositions(savedTokens, words);
    const tokens = Object.freeze(savedTokens.map((token, index) => projectToken(token, index, words, conflicts))), partial = tokens.some(token => token.status === 'unavailable');
    alignment = { status: partial ? 'partial' : 'saved', tokens,
      message: partial ? '部分原逐词判定不可用；其余按保存顺序展示，不补词、不重新评分。' : '以下为原规则保存的逐词判定，顺序、词形及结果均保留；未重新评分。' };
  }
  return Object.freeze({ version: LEGACY_ATTEMPT_REVIEW_VERSION, reference, answer, materialId, materialVersion, cueId, ruleVersion, cueInterval,
    alignment: Object.freeze(alignment), zeroWords: own(a, 'words') === 0, issues: Object.freeze(issues),
    media: Object.freeze({ status: 'unavailable', message: builtin ? '此逐次提交回看未载入并核验原媒体，因此这里不提供重听；已保存的来源绑定不是实际播放验证。' : LEGACY_ATTEMPT_MEDIA_UNAVAILABLE }) });
}
