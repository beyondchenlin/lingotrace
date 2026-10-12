import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedPaceFinishObserver, type FixedPaceFinishIdentity, type FixedPaceFinishMedia, type FixedPaceFinishBegin, type FixedPaceFinishCheck } from './fixed-pace-finish.ts';
import { TrainingEngine, exportSession, type Attempt, type Material } from './training.ts';
import type { TypingFollowAppend } from './typing-follow-policy.ts';

// Authored monotonic/native readback fixtures, not a browser/audio/physical typing claim.
const identity = (): FixedPaceFinishIdentity => ({ engine: {}, sessionId: 'session', roundId: 'round',
  ownerId: 'owner', sourceUrl: 'blob:verified-source', courseId: 'material', courseVersion: 'version',
  mediaId: 'media', mediaSha256: 'sha', sentenceMapVersion: 'map', sentenceMapSha256: 'map-sha',
  cueId: 'cue', cueStartSeconds: 10, cueEndSeconds: 11 });
const edit = (before = '', data = 'hello', beforeRevision = 0): TypingFollowAppend => ({
  before, after: before + data, beforeRevision, afterRevision: beforeRevision + 1,
  selectionBefore: { start: before.length, end: before.length }, source: 'typed', kind: 'input',
  inputType: 'insertText', data, isTrusted: true, isComposing: false,
});
function fixture(beginPatch: Partial<FixedPaceFinishBegin> = {}) {
  const observer = new FixedPaceFinishObserver(), id = beginPatch.identity ?? identity();
  const frame = { identity: id, eligible: true, referenceShown: true };
  const begin: FixedPaceFinishBegin = { ...frame, nowMs: 0, rate: 1, draft: '', draftRevision: 0, inputVersion: 0, ...beginPatch };
  observer.begin(begin);
  const sample = (nowMs: number, positionSeconds = 10 + (nowMs - 100) / 1000, patch: Partial<FixedPaceFinishMedia> = {}) =>
    observer.observeMedia({ ...frame, nowMs, positionSeconds, rate: 1, paused: false, seeking: false, ready: true, successfullyPlaying: true, ...patch });
  const append = (nowMs = 700, value = edit(), inputVersion = value.afterRevision) => observer.append({ ...frame, nowMs, edit: value, inputVersion });
  const attempt = (patch: Partial<Attempt> = {}): Attempt => ({ attemptId: 'attempt', sessionId: id.sessionId,
    roundId: id.roundId, cueId: id.cueId, materialId: id.courseId, materialVersion: id.courseVersion,
    ruleVersion: 'existing-rule', reference: 'hello', answer: 'hello', inputVersion: 1,
    conditions: { exposure: 'first', hinted: false, revealed: true, pasted: false, inputSource: 'typed' },
    words: 1, errors: 0, accuracy: 100, alignment: [], gain: 1, firstCompletion: true, activeMs: 0,
    wallTime: '2026-10-12T00:00:00Z', dataset: 'local_interactive', ...patch });
  const check = (patch: Partial<FixedPaceFinishCheck> = {}) => observer.check({ ...frame, nowMs: 1200,
    explicit: true, currentAnswer: 'hello', draftRevision: 1, inputVersion: 1, attempt: attempt(), ...patch });
  const playUntilInput = () => { sample(100); sample(350); sample(600); append(); };
  const finish = () => { playUntilInput(); sample(850); sample(1100); };
  return { observer, id, frame, sample, append, attempt, check, playUntilInput, finish };
}

test('empty observer exposes no result; begin and media alone cannot judge or complete typing', () => {
  const empty = new FixedPaceFinishObserver();
  assert.deepEqual(empty.snapshot, { phase: 'idle', reason: null, result: null });
  const f = fixture(); f.sample(100); f.sample(600); f.sample(1100);
  assert.equal(f.observer.snapshot.phase, 'ended'); assert.equal(f.observer.snapshot.result, null);
  assert.equal(f.check({ currentAnswer: '', draftRevision: 0, inputVersion: 0, attempt: null }), null);
});
test('Check returns signed early finish from final trusted commit to actual observed boundary', () => {
  const f = fixture(); f.finish(); assert.equal(f.observer.snapshot.result, null);
  assert.deepEqual(f.check(), { deltaMs: -400, reason: null, rate: 1, referenceAssisted: true, attemptId: 'attempt', accuracy: 100, errors: 0 });
});
test('trusted append after playback ends remains observable without restarting media', () => {
  const f = fixture(); f.sample(100); f.sample(600); f.sample(1100); f.append(1600);
  assert.equal(f.check({ nowMs: 2000 })?.deltaMs, 500);
});
test('the final trusted append matters, including punctuation accepted by existing scoring', () => {
  const f = fixture(); f.finish(); f.append(1550, edit('hello', '!', 1), 2);
  assert.equal(f.check({ nowMs: 1600, currentAnswer: 'hello!', draftRevision: 2, inputVersion: 2,
    attempt: f.attempt({ answer: 'hello!', inputVersion: 2 }) })?.deltaMs, 450);
});
test('first trusted gesture may precede native successful play without losing its timestamp', () => {
  const first = edit(); const f = fixture({ draft: first.after, initialEdit: first, draftRevision: 1, inputVersion: 1 });
  f.sample(100); f.sample(600); f.sample(1100); assert.equal(f.check()?.deltaMs, -1100);
});
test('zero signed difference is valid and does not introduce a pass threshold', () => {
  const f = fixture(); f.sample(100); f.sample(600); f.sample(1100); f.append(1100);
  assert.equal(f.check()?.deltaMs, 0);
});
test('exact fixed rate is returned and native elapsed observations support a slower run', () => {
  const f = fixture({ rate: 0.5 });
  f.sample(100, 10, { rate: 0.5 }); f.sample(600, 10.25, { rate: 0.5 }); f.append(700);
  f.sample(1100, 10.5, { rate: 0.5 }); f.sample(1600, 10.75, { rate: 0.5 }); f.sample(2100, 11, { rate: 0.5 });
  assert.deepEqual(f.check({ nowMs: 2200 }), { deltaMs: -1400, reason: null, rate: 0.5, referenceAssisted: true, attemptId: 'attempt', accuracy: 100, errors: 0 });
});
test('native final-media ended may be paused, but must follow successful continuous play', () => {
  const f = fixture(); f.playUntilInput(); f.sample(850); f.sample(1100, 11, { paused: true, ended: true, successfullyPlaying: false });
  assert.equal(f.check()?.deltaMs, -400);
  const missingStart = fixture(); missingStart.append(700); missingStart.sample(1100, 11, { paused: true, ended: true, successfullyPlaying: false });
  assert.equal(missingStart.check()?.deltaMs, null); assert.equal(missingStart.observer.snapshot.reason, 'playback-unobserved');
});
test('controller-ended or duration arithmetic without actual endpoint observation is unknown', () => {
  const f = fixture(); f.playUntilInput(); f.sample(850);
  const result = f.check({ nowMs: 9000 });
  assert.equal(result?.deltaMs, null); assert.equal(result?.reason, 'cue-end-unobserved');
});
test('an endpoint observed with overshoot uses its real observation timestamp, never interpolation', () => {
  const f = fixture(); f.playUntilInput(); f.sample(850); f.sample(1200, 11.1);
  assert.equal(f.check({ nowMs: 1250 })?.deltaMs, -500);
});
for (const patch of [
  { draft: 'hello', draftRevision: 1, inputVersion: 1 }, { draft: '', draftRevision: 2, inputVersion: 2 },
  { draft: 'hello', draftRevision: 1, inputVersion: 3, initialEdit: edit() },
  { draft: 'hello', draftRevision: 1, inputVersion: 1, initialEdit: { ...edit(), isTrusted: false } },
  { draft: 'hello', draftRevision: 1, inputVersion: 1, initialEdit: edit('h', 'ello') },
]) test(`nonfresh or untrusted begin stays unknown ${JSON.stringify(patch)}`, () => {
  const f = fixture(patch); f.sample(100); f.sample(600); f.sample(1100);
  assert.equal(f.observer.snapshot.phase, 'unknown'); assert.equal(f.observer.snapshot.reason, 'nonempty-or-untrusted-start');
});
for (const rate of [0, -1, NaN, Infinity]) test(`invalid initial rate ${rate} fails closed`, () => {
  assert.equal(fixture({ rate }).observer.snapshot.reason, 'invalid-rate');
});
for (const field of ['engine', 'sessionId', 'roundId', 'ownerId', 'sourceUrl', 'courseId', 'courseVersion', 'mediaId', 'mediaSha256',
  'sentenceMapVersion', 'sentenceMapSha256', 'cueId', 'cueStartSeconds', 'cueEndSeconds'] as const) {
  test(`current ${field} identity changes invalidate measurement`, () => {
    const f = fixture(); f.playUntilInput();
    const changed = { ...f.id, [field]: field === 'engine' ? {} : typeof f.id[field] === 'number' ? Number(f.id[field]) + 1 : `${f.id[field]}-new` };
    f.sample(850, 10.75, { identity: changed }); assert.equal(f.observer.snapshot.reason, 'identity-changed');
  });
}
for (const reason of ['manual-pause', 'manual-play', 'manual-seek', 'manual-replay', 'manual-rate', 'waiting', 'stalled',
  'background', 'blur', 'modal', 'recording', 'reference-hidden', 'cue-change', 'source-change', 'composition-start', 'composition-cancel']) {
  test(`${reason} invalidates both ongoing and endpoint-observed unsealed measurement`, () => {
    for (const ended of [false, true]) {
      const f = fixture(); if (ended) f.finish(); else f.playUntilInput();
      f.observer.invalidate(reason); f.sample(1100, 11);
      assert.equal(f.check()?.deltaMs, null); assert.equal(f.observer.snapshot.reason, reason);
    }
  });
}
for (const kind of ['paste', 'deletion', 'replacement', 'programmatic', 'untrusted', 'selection', 'preedit', 'revision-gap']) {
  test(`${kind} cannot manufacture a finish timestamp`, () => {
    const f = fixture(); f.sample(100);
    const patches: Record<string, Partial<TypingFollowAppend>> = {
      paste: { source: 'paste', inputType: 'insertFromPaste' }, deletion: { inputType: 'deleteContentBackward' },
      replacement: { inputType: 'insertReplacementText' }, programmatic: { source: 'programmatic' },
      untrusted: { isTrusted: false }, selection: { selectionBefore: { start: 0, end: 1 } },
      preedit: { isComposing: true }, 'revision-gap': { beforeRevision: 2, afterRevision: 3 },
    };
    f.append(200, { ...edit(), ...patches[kind] }); f.sample(600); f.sample(1100);
    assert.equal(f.check()?.deltaMs, null); assert.equal(f.observer.snapshot.result?.accuracy, 100);
  });
}
test('an uninterrupted trusted IME final commit qualifies, while preedit/cancellation never does', () => {
  const f = fixture(); f.sample(100);
  f.append(200, { ...edit(), source: 'ime', kind: 'compositionend', inputType: null, compositionId: 7 });
  f.sample(600); f.sample(1100); assert.equal(f.check()?.deltaMs, -900);
  const cancelled = fixture(); cancelled.sample(100); cancelled.observer.invalidate('composition-cancel'); cancelled.append(200);
  cancelled.sample(600); cancelled.sample(1100); assert.equal(cancelled.check()?.deltaMs, null);
});
for (const patch of [ { paused: true }, { seeking: true }, { ready: false }, { successfullyPlaying: false }, { rate: 0.8 },
  { positionSeconds: NaN }, { positionSeconds: 9 }, { positionSeconds: 11.3 }, { referenceShown: false }, { eligible: false } ]) {
  test(`invalid native sample is unknown ${JSON.stringify(patch)}`, () => {
    const f = fixture(); f.playUntilInput(); f.sample(850, 10.75, patch); assert.equal(f.check()?.deltaMs, null);
  });
}
test('late or endpoint-first play settlement cannot fabricate observation of the whole sentence', () => {
  for (const [now, position] of [[1600, 10], [100, 11], [100, 10.2]]) {
    const f = fixture(); f.sample(now, position); assert.equal(f.observer.snapshot.reason, 'play-start-unobserved');
  }
});
test('clock regression, a long sampling gap, rate-inconsistent movement and accumulated stall fail closed', () => {
  const regression = fixture(); regression.sample(100); regression.sample(99, 10); assert.equal(regression.observer.snapshot.reason, 'clock-discontinuity');
  const gap = fixture(); gap.sample(100); gap.sample(1101, 11.001); assert.equal(gap.observer.snapshot.reason, 'media-observation-gap');
  const seek = fixture(); seek.sample(100); seek.sample(110, 10.8); assert.equal(seek.observer.snapshot.reason, 'media-clock-discontinuity');
  const reverse = fixture(); reverse.sample(100); reverse.sample(200, 10.1); reverse.sample(300, 10.05); assert.equal(reverse.observer.snapshot.reason, 'media-clock-discontinuity');
  const zeroClock = fixture(); zeroClock.sample(100); zeroClock.sample(100, 10.1); assert.equal(zeroClock.observer.snapshot.reason, 'media-clock-discontinuity');
  const stall = fixture(); stall.sample(100); stall.sample(150, 10); stall.sample(200, 10); stall.sample(250, 10); assert.equal(stall.observer.snapshot.reason, 'media-clock-discontinuity');
});
test('native currentTime quantization does not manufacture a synthetic endpoint', () => {
  const f = fixture(); f.sample(100); f.sample(150, 10); f.sample(200, 10.1); f.append(250);
  for (let now = 300; now <= 1000; now += 100) f.sample(now, 10 + (now - 100) / 1000);
  assert.equal(f.observer.snapshot.phase, 'observing'); f.sample(1100, 11); assert.equal(f.check()?.deltaMs, -850);
});
test('Check seals early unknown and later media completion cannot backfill it', () => {
  const f = fixture(); f.playUntilInput(); const result = f.check({ nowMs: 750 });
  assert.equal(result?.reason, 'cue-end-unobserved'); f.sample(850); f.sample(1100);
  assert.equal(f.check(), result); assert.equal(f.observer.snapshot.result?.deltaMs, null);
});
test('Check cleanup preserves an observed endpoint and sealed result but invalidates unfinished playback', () => {
  const f = fixture(); f.finish(); f.observer.invalidate('check'); assert.equal(f.check()?.deltaMs, -400);
  const saved = f.observer.snapshot.result; f.observer.invalidate('check'); f.sample(1500, 11, { paused: true, rate: 1.25 });
  assert.equal(f.observer.snapshot.result, saved);
  const early = fixture(); early.playUntilInput(); early.observer.invalidate('check');
  assert.equal(early.check()?.reason, 'checked-before-cue-end');
});
test('editing a checked answer invalidates the result without starting another cycle', () => {
  const f = fixture(); f.finish(); assert.equal(f.check()?.deltaMs, -400);
  f.append(1300, edit('hello', '!', 1), 2); assert.equal(f.observer.snapshot.phase, 'unknown'); assert.equal(f.observer.snapshot.result, null);
  const second = f.check({ nowMs: 1400, currentAnswer: 'hello!', draftRevision: 2, inputVersion: 2, attempt: f.attempt({ attemptId: 'second', answer: 'hello!', inputVersion: 2 }) });
  assert.equal(second?.deltaMs, null); assert.equal(second?.reason, 'edited-after-check');
});
test('a second explicit begin clears all old timing evidence and result', () => {
  const f = fixture(); f.finish(); f.check();
  f.observer.begin({ ...f.frame, nowMs: 2000, rate: 1, draft: '', draftRevision: 0, inputVersion: 0 });
  assert.deepEqual(f.observer.snapshot, { phase: 'observing', reason: null, result: null });
  f.observer.clear(); assert.deepEqual(f.observer.snapshot, { phase: 'idle', reason: null, result: null });
});
test('accuracy is exactly the existing judgment and imperfect answers have no finish difference', () => {
  for (const patch of [{ accuracy: 50, errors: 1 }, { accuracy: 100, errors: 1 }, { accuracy: 99.99, errors: 0 }]) {
    const f = fixture(); f.finish(); const result = f.check({ attempt: f.attempt(patch) });
    assert.equal(result?.deltaMs, null); assert.equal(result?.reason, 'answer-incomplete');
    assert.equal(result?.accuracy, patch.accuracy); assert.equal(result?.errors, patch.errors);
  }
});
for (const patch of [ { sessionId: 'other' }, { roundId: 'other' }, { materialId: 'other' }, { materialVersion: 'other' },
  { cueId: 'other' }, { answer: 'other' }, { inputVersion: 2 }, { accuracy: NaN }, { errors: -1 }, { words: 0 } ]) {
  test(`stale or inconsistent attempt is not usable ${JSON.stringify(patch)}`, () => {
    const f = fixture(); f.finish(); assert.equal(f.check({ attempt: f.attempt(patch) }), null);
    assert.equal(f.observer.snapshot.reason, 'checked-attempt-mismatch');
  });
}
test('Check must be explicit, current, reference-visible and eligible', () => {
  const automatic = fixture(); automatic.finish(); assert.equal(automatic.check({ explicit: false }), null); assert.equal(automatic.observer.snapshot.result, null);
  for (const patch of [{ referenceShown: false }, { eligible: false }, { currentAnswer: 'different' }]) {
    const f = fixture(); f.finish(); assert.equal(f.check(patch), null); assert.equal(f.observer.snapshot.result, null);
  }
});
test('check draft revision mismatch emits unknown rather than reusing an old final input timestamp', () => {
  const f = fixture(); f.finish(); assert.equal(f.check({ draftRevision: 2 })?.reason, 'input-revision-gap');
});
test('observer returns immutable text-free result and does not freeze caller engine or identity objects', () => {
  const f = fixture(); f.finish(); const result = f.check()!;
  assert.equal(Object.isFrozen(f.id), false); assert.equal(Object.isFrozen(f.id.engine), false);
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(f.observer.snapshot), true);
  assert.equal(JSON.stringify(f.observer.snapshot).includes('hello'), false);
  assert.throws(() => { (result as { deltaMs: number }).deltaMs = 200; }, TypeError);
});
test('real engine Check is consumed without new events, score changes, exports or saved schema fields', () => {
  let serial = 0;
  const material: Material = { id: 'material', version: 'version', title: 'test', rights: 'authored fixture', cues: [{ id: 'cue', text: 'hello', start: 10, end: 11 }] };
  const engine = new TrainingEngine({ material, sessionId: 'session', clock: { now: () => 0, wallTime: () => '2026-10-12T00:00:00Z', id: () => `event-${++serial}` } });
  const id = { ...identity(), engine, roundId: engine.getSnapshot().roundId };
  const f = fixture({ identity: id }); f.finish(); engine.input('hello'); const attempt = engine.submit()!;
  const snapshot = engine.getSnapshot(), exported = exportSession(snapshot, '2026-10-12T00:00:00Z');
  assert.equal(f.check({ attempt })?.deltaMs, -400);
  assert.equal(engine.getSnapshot(), snapshot); assert.deepEqual(exportSession(engine.getSnapshot(), '2026-10-12T00:00:00Z'), exported);
  assert.equal(snapshot.attempts.length, 1); assert.equal(snapshot.events.some(event => event.type.includes('finish')), false);
});
