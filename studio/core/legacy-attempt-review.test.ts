import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrainingEngine, CAFE_MATERIAL } from './training';
import { readLegacyHistoryRecord } from './legacy-history';
import { projectLegacyAttemptReview, LEGACY_ATTEMPT_MEDIA_UNAVAILABLE, LEGACY_ATTEMPT_TOKEN_LABELS } from './legacy-attempt-review';
import LegacyAttemptReview from '../components/LegacyAttemptReview';

// Deterministic synthetic records, never represented as real user history.
function fixture() {
  let nextId = 0;
  const material = { id: CAFE_MATERIAL.id, version: 'saved-material-2019', title: 'Original saved material', rights: 'Unit-test text',
    cues: [{ id: 'original-cue', text: 'One cup, please.\n', start: 1.125, end: 4.875 }] };
  const engine = new TrainingEngine({ sessionId: 'review-unit-session', material,
    clock: { now: () => 0, wallTime: () => '2026-10-09T12:00:00.000Z', id: () => `review-unit-${++nextId}` } });
  engine.input('One tea now'); engine.submit();
  const snapshot = structuredClone(engine.getSnapshot()) as any;
  const attempt = snapshot.attempts[0];
  attempt.alignment = [
    { kind: 'match', position: 0, expected: 'one', actual: 'one' },
    { kind: 'replace', position: 1, expected: 'cup', actual: 'tea' },
    { kind: 'missing', position: 2, expected: 'please', actual: '' },
    { kind: 'extra', position: null, expected: '', actual: 'now' },
  ];
  // Historical scalar facts intentionally do not equal today's derived result.
  attempt.accuracy = 13; attempt.errors = 19; attempt.gain = 7; snapshot.earnedWords = 72;
  return { snapshot, attempt };
}
const html = (snapshot: unknown, attempt: unknown) => renderToStaticMarkup(createElement(LegacyAttemptReview, { snapshot, attempt }));

test('retains exact saved reference, answer, version and cue times without today’s catalog', () => {
  const { snapshot, attempt } = fixture();
  const saved = readLegacyHistoryRecord({ sessionId: snapshot.sessionId, sequence: snapshot.sequence, snapshot, updatedAt: snapshot.createdAt });
  const review = projectLegacyAttemptReview(saved.snapshot, saved.snapshot.attempts[0]);
  assert.equal(review.reference, 'One cup, please.\n'); assert.equal(review.answer, 'One tea now');
  assert.equal(review.materialId, CAFE_MATERIAL.id); assert.equal(review.materialVersion, 'saved-material-2019');
  assert.notEqual(review.materialVersion, CAFE_MATERIAL.version);
  assert.notEqual(review.reference, CAFE_MATERIAL.cues[0].text);
  assert.deepEqual(review.cueInterval, { start: 1.125, end: 4.875 }); assert.deepEqual(review.issues, []);
  const changedCurrentCatalog = structuredClone(CAFE_MATERIAL) as any;
  changedCurrentCatalog.version = 'new-version'; changedCurrentCatalog.cues[0].text = 'Changed current reference';
  assert.deepEqual(projectLegacyAttemptReview(snapshot, attempt), review);
});

test('displays all four saved alignment kinds in original order with explicit English labels and both words', () => {
  const { snapshot, attempt } = fixture(), review = projectLegacyAttemptReview(snapshot, attempt);
  assert.equal(review.alignment.status, 'saved');
  assert.deepEqual(review.alignment.tokens, attempt.alignment.map((token: any, index: number) => ({ status: 'saved', index, ...token, label: LEGACY_ATTEMPT_TOKEN_LABELS[token.kind as keyof typeof LEGACY_ATTEMPT_TOKEN_LABELS] })));
  const rendered = html(snapshot, attempt);
  for (const label of ['Correct (match)', 'Wrong (replace)', 'Missing (missing)', 'Extra (extra)', 'Original reference: cup', 'Original answer: tea', 'No answer (original record)', 'No corresponding word (original record)']) assert.ok(rendered.includes(label), label);
  assert.match(rendered, /1\.125s to 4\.875s/); assert.match(rendered, /Original judgment rule: word-alignment-v3/);
});

test('an unknown historical rule preserves saved alignment without enforcing current normalization or scores', () => {
  const { snapshot, attempt } = fixture(); attempt.ruleVersion = 'historical-rule-2018';
  attempt.alignment[0] = { kind: 'match', position: 0, expected: 'ONE', actual: 'one' };
  const before = JSON.stringify(snapshot), review = projectLegacyAttemptReview(snapshot, attempt);
  assert.equal(review.ruleVersion, 'historical-rule-2018'); assert.equal(review.alignment.status, 'saved');
  assert.equal(review.alignment.tokens[0].status, 'saved');
  assert.deepEqual(review.alignment.tokens[0], { status: 'saved', index: 0, kind: 'match', label: '正确', position: 0, expected: 'ONE', actual: 'one' });
  assert.match(html(snapshot, attempt), /Original judgment rule: historical-rule-2018/);
  assert.equal(JSON.stringify(snapshot), before); assert.equal(snapshot.earnedWords, 72); assert.equal(attempt.accuracy, 13); assert.equal(attempt.errors, 19); assert.equal(attempt.gain, 7);
});

test('missing original text is never filled from cues, drafts or current material', () => {
  for (const key of ['reference', 'answer']) {
    const { snapshot, attempt } = fixture(); delete attempt[key];
    snapshot.drafts[attempt.cueId] = { text: 'DO NOT FILL THIS DRAFT' };
    const review = projectLegacyAttemptReview(snapshot, attempt);
    assert.equal(review[key as 'reference' | 'answer'], null); assert.equal(review.alignment.status, 'unavailable');
    assert.equal(key === 'reference' ? review.answer : review.reference, key === 'reference' ? 'One tea now' : 'One cup, please.\n');
    assert.ok(review.issues.some(issue => issue.includes(key === 'reference' ? '原参考' : '原答案')));
    assert.ok(!html(snapshot, attempt).includes('DO NOT FILL THIS DRAFT'));
  }
});

test('missing rule, material/version, cue and attempt identity are explicit rather than guessed', () => {
  for (const key of ['ruleVersion', 'materialId', 'materialVersion', 'cueId', 'attemptId', 'sessionId', 'roundId']) {
    const { snapshot, attempt } = fixture(); delete attempt[key];
    const review = projectLegacyAttemptReview(snapshot, attempt);
    assert.equal(review.reference, 'One cup, please.\n'); assert.equal(review.answer, 'One tea now');
    assert.equal(review.alignment.status, 'unavailable', key); assert.ok(review.issues.length > 0, key);
  }
  const { snapshot, attempt } = fixture(); delete snapshot.material.version;
  assert.equal(projectLegacyAttemptReview(snapshot, attempt).cueInterval, null);
});

test('invalid token fields are unavailable individually while reliable words and neighboring results remain', () => {
  const invalidTokens = [null, 'match', {},
    { kind: 'unknown', position: 0, expected: 'kept', actual: 'answer' },
    { kind: 'match', position: -1, expected: 'kept', actual: 'answer' },
    { kind: 'match', position: 0.5, expected: 'kept', actual: 'answer' },
    { kind: 'match', position: Infinity, expected: 'kept', actual: 'answer' },
    { kind: 'replace', position: null, expected: 'kept', actual: 'answer' },
    { kind: 'match', position: 1, expected: {}, actual: 'answer' },
    { kind: 'missing', position: 1, expected: 'kept', actual: 'not empty' },
    { kind: 'missing', position: 1, expected: '', actual: '' },
    { kind: 'extra', position: 0, expected: '', actual: 'answer' },
    { kind: 'extra', position: null, expected: 'not empty', actual: 'answer' },
    { kind: 'extra', position: null, expected: '', actual: '' },
    { kind: 'match', position: 1, expected: ' ', actual: 'answer' },
  ];
  for (const token of invalidTokens) {
    const { snapshot, attempt } = fixture(); attempt.alignment[1] = token;
    const review = projectLegacyAttemptReview(snapshot, attempt);
    assert.equal(review.alignment.status, 'partial', JSON.stringify(token));
    assert.equal(review.alignment.tokens[0].status, 'saved'); assert.equal(review.alignment.tokens[1].status, 'unavailable');
    assert.equal(review.alignment.tokens[2].status, 'saved'); assert.equal(review.alignment.tokens.length, 4);
    if (token && typeof token === 'object' && 'expected' in token && token.expected === 'kept') assert.equal(review.alignment.tokens[1].expected, 'kept');
  }
});

test('cross-session, round, material, version, cue and reference conflicts cannot lend sentence time or alignment', () => {
  const changes: ((s: any, a: any) => void)[] = [
    (_s, a) => { a.sessionId = 'other-session'; }, (_s, a) => { a.roundId = 'other-round'; },
    (_s, a) => { a.materialId = 'other-material'; }, (_s, a) => { a.materialVersion = 'other-version'; },
    (_s, a) => { a.cueId = 'other-cue'; }, (s) => { s.material.cues[0].text = 'Different sentence'; },
    (s) => { s.material.cues.push({ ...s.material.cues[0] }); }, (s) => { delete s.material.cues; },
    (s) => { s.attempts.push({ ...s.attempts[0] }); }, (s) => { s.attempts = []; },
    (s) => { s.schemaVersion = 'future-schema'; },
  ];
  for (const change of changes) {
    const { snapshot, attempt } = fixture(); change(snapshot, attempt);
    const review = projectLegacyAttemptReview(snapshot, attempt);
    assert.equal(review.reference, 'One cup, please.\n'); assert.equal(review.answer, 'One tea now');
    assert.equal(review.cueInterval, null); assert.equal(review.alignment.status, 'unavailable'); assert.ok(review.issues.length > 0);
  }
  const { snapshot, attempt } = fixture(); snapshot.material.cues.push({ id: 'other-cue', text: 'Other sentence', start: 40, end: 50 }); attempt.cueId = 'other-cue';
  assert.equal(projectLegacyAttemptReview(snapshot, attempt).alignment.status, 'unavailable');
});

test('saved target positions must be within saved words, unique and ordered without recalculating words', () => {
  for (const positions of [[999, 999, 2], [0, 0, 2], [2, 0, 1], [0, 2, 1]]) {
    const { snapshot, attempt } = fixture();
    positions.forEach((at, index) => { attempt.alignment[index].position = at; });
    const review = projectLegacyAttemptReview(snapshot, attempt);
    assert.equal(review.alignment.status, 'partial');
    assert.equal(review.alignment.tokens[3].status, 'saved', 'an unrelated extra word remains readable');
    for (let index = 0; index < positions.length; index++) {
      const at = positions[index], conflicts = at >= attempt.words || positions.filter(other => other === at).length > 1
        || positions.slice(0, index).some(other => other < attempt.words && other > at)
        || positions.slice(index + 1).some(other => other < attempt.words && other < at);
      assert.equal(review.alignment.tokens[index].status, conflicts ? 'unavailable' : 'saved', `${positions}: ${index}`);
      assert.equal(review.alignment.tokens[index].expected, attempt.alignment[index].expected);
    }
  }
  const { snapshot, attempt } = fixture(); attempt.words = 0;
  const zero = projectLegacyAttemptReview(snapshot, attempt);
  assert.equal(zero.zeroWords, true); assert.equal(zero.alignment.status, 'partial');
  assert.ok(zero.alignment.tokens.slice(0, 3).every(token => token.status === 'unavailable'));
  assert.equal(zero.alignment.tokens[3].status, 'saved');
  for (const words of [undefined, null, '3', -1, NaN, Infinity, 1.5]) {
    attempt.words = words;
    const review = projectLegacyAttemptReview(snapshot, attempt);
    assert.equal(review.alignment.status, 'unavailable'); assert.match(review.alignment.message, /参考词数缺失或非法/);
    assert.equal(review.reference, attempt.reference); assert.equal(review.answer, attempt.answer);
  }
});

test('an equal copied saved attempt is allowed, but changed data with the same ID is not joined', () => {
  const { snapshot, attempt } = fixture(), copied = structuredClone(attempt);
  assert.equal(projectLegacyAttemptReview(snapshot, copied).alignment.status, 'saved');
  for (const change of [(a: any) => { a.answer = 'substituted answer'; }, (a: any) => { a.alignment[0].actual = 'substituted word'; }, (a: any) => { a.ruleVersion = 'substituted rule'; }]) {
    const changed = structuredClone(attempt); change(changed);
    assert.equal(projectLegacyAttemptReview(snapshot, changed).alignment.status, 'unavailable');
    assert.equal(projectLegacyAttemptReview(snapshot, changed).cueInterval, null);
  }
});

test('invalid or missing cue interval affects only the unavailable times, never backfills current time', () => {
  for (const interval of [{ start: -1, end: 4 }, { start: 4, end: 2 }, { start: NaN, end: 4 }, { start: 1, end: Infinity }, { start: '1', end: 4 }, {}]) {
    const { snapshot, attempt } = fixture(); snapshot.material.cues[0] = { id: attempt.cueId, text: attempt.reference, ...interval };
    const review = projectLegacyAttemptReview(snapshot, attempt);
    assert.equal(review.cueInterval, null); assert.equal(review.alignment.status, 'saved'); assert.ok(review.issues.some(issue => issue.includes('起止时间')));
  }
});

test('zero words, empty alignment, absent alignment and saved empty text do not become a full-correct result', () => {
  const { snapshot, attempt } = fixture(); attempt.words = 0; attempt.alignment = [];
  let review = projectLegacyAttemptReview(snapshot, attempt);
  assert.equal(review.zeroWords, true); assert.equal(review.alignment.status, 'empty'); assert.deepEqual(review.alignment.tokens, []);
  assert.match(html(snapshot, attempt), /original record has 0 reference words/); assert.match(review.alignment.message, /不能据此判断全对/);
  for (const value of [undefined, null, 'not-an-array', {}]) {
    attempt.alignment = value; review = projectLegacyAttemptReview(snapshot, attempt);
    assert.equal(review.alignment.status, 'unavailable'); assert.deepEqual(review.alignment.tokens, []);
  }
  attempt.alignment = []; attempt.reference = ''; attempt.answer = ''; snapshot.material.cues[0].text = '';
  review = projectLegacyAttemptReview(snapshot, attempt);
  assert.equal(review.reference, ''); assert.equal(review.answer, ''); assert.equal(review.alignment.status, 'empty');
  assert.match(html(snapshot, attempt), /Saved empty reference text/); assert.match(html(snapshot, attempt), /Saved empty answer/);
});

test('projection is immutable, repeatable and leaves saved scalar results, events and live data untouched', () => {
  const { snapshot, attempt } = fixture(), before = structuredClone(snapshot);
  const first = projectLegacyAttemptReview(snapshot, attempt), second = projectLegacyAttemptReview(snapshot, attempt);
  assert.deepEqual(first, second); assert.deepEqual(snapshot, before); assert.equal(Object.isFrozen(snapshot), false); assert.equal(Object.isFrozen(attempt.alignment[0]), false);
  assert.ok(Object.isFrozen(first)); assert.ok(Object.isFrozen(first.alignment)); assert.ok(Object.isFrozen(first.alignment.tokens)); assert.ok(Object.isFrozen(first.alignment.tokens[0]));
  assert.ok(Object.isFrozen(first.cueInterval)); assert.ok(Object.isFrozen(first.issues)); assert.ok(Object.isFrozen(first.media));
  assert.throws(() => { (first.alignment.tokens[0] as any).actual = 'edited'; }, TypeError);
  for (const key of ['earnedWords', 'confirmedPositions', 'completedCueIds', 'events', 'drafts', 'pendingAttempts']) Object.defineProperty(snapshot, key, { get() { throw new Error(`Read unrelated ${key}`); } });
  for (const key of ['accuracy', 'gain', 'errors', 'firstCompletion']) Object.defineProperty(attempt, key, { get() { throw new Error(`Read score ${key}`); } });
  assert.deepEqual(projectLegacyAttemptReview(snapshot, attempt), first);
});

test('malformed inputs and accessors never execute stored code or synthesize original text', () => {
  for (const value of [undefined, null, 0, [], 'snapshot', new Date(), Object.create({ reference: 'inherited' })]) {
    const review = projectLegacyAttemptReview(value, value);
    assert.equal(review.reference, null); assert.equal(review.answer, null); assert.equal(review.alignment.status, 'unavailable');
    assert.doesNotThrow(() => html(value, value));
  }
  const { snapshot, attempt } = fixture();
  Object.defineProperty(attempt, 'reference', { get() { throw new Error('must not execute getter'); } });
  assert.equal(projectLegacyAttemptReview(snapshot, attempt).reference, null);
  const next = fixture(); Object.defineProperty(next.attempt.alignment[1], 'expected', { get() { throw new Error('must not execute token getter'); } });
  assert.equal(projectLegacyAttemptReview(next.snapshot, next.attempt).alignment.tokens[1].status, 'unavailable');
});

test('all stored strings render escaped, including reference, answer, version, rule and token text', () => {
  const { snapshot, attempt } = fixture(), unsafe = '<img src=x onerror="alert(1)"><script>bad()</script>';
  attempt.reference = unsafe; snapshot.material.cues[0].text = unsafe; attempt.answer = unsafe;
  attempt.ruleVersion = unsafe; attempt.materialVersion = unsafe; snapshot.material.version = unsafe;
  attempt.alignment[0].expected = unsafe; attempt.alignment[0].actual = unsafe;
  const rendered = html(snapshot, attempt);
  assert.ok(rendered.includes('&lt;img')); assert.ok(rendered.includes('&lt;script&gt;'));
  assert.ok(!rendered.includes('<img')); assert.ok(!rendered.includes('<script')); assert.ok(!rendered.includes('dangerouslySetInnerHTML'));
});

test('original media is always unavailable even with injected URLs; there are no fake controls or media requests', () => {
  const { snapshot, attempt } = fixture(); snapshot.material.mediaId = 'invented-media-id'; snapshot.material.source = '/media/06-cafe.mp4'; attempt.mediaId = 'invented-media-id';
  const review = projectLegacyAttemptReview(snapshot, attempt), rendered = html(snapshot, attempt);
  assert.deepEqual(review.media, { status: 'unavailable', message: LEGACY_ATTEMPT_MEDIA_UNAVAILABLE });
  assert.match(rendered, /lacks a verifiable original-media association/); assert.match(rendered, /mediaId, content hash or source binding/);
  assert.doesNotMatch(rendered, /<audio|<video|<button|<a\s|<iframe|06-cafe\.mp4|invented-media-id/);
  const core = readFileSync(new URL('./legacy-attempt-review.ts', import.meta.url), 'utf8');
  const component = readFileSync(new URL('../components/LegacyAttemptReview.tsx', import.meta.url), 'utf8');
  assert.deepEqual(core.match(/^import\s.*$/gm), ["import { BUILTIN_TRAINING_SCHEMA, isBuiltinMaterial } from './builtin-material.ts';"], 'projection may only depend on exact read-only built-in admission, never engine, scoring or storage');
  for (const source of [core, component]) {
    assert.doesNotMatch(source, /\b(?:align|replay|reduceTraining|validateSnapshot|fetch|XMLHttpRequest|Audio|saveSession)\s*\(/);
    assert.doesNotMatch(source, /\b(?:localStorage|indexedDB|sessionStorage|dangerouslySetInnerHTML|useEffect|useLayoutEffect|useState)\b/);
    assert.doesNotMatch(source, /\b(?:onClick|onLoad|onError|src)\s*=/);
  }
});
