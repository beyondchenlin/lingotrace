import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NPS_MATERIAL } from './builtin-material.ts';
import {
  CAFE_FIXED_PACE_COURSE, createTypingFollowState, estimatedTypingFollowRate, qualifyingTypingFollowAppend,
  reduceTypingFollow, typingFollowCourseIdentity, TYPING_FOLLOW_FIXED_RATES, TYPING_FOLLOW_TUNING as T,
  type TypingFollowAppend, type TypingFollowDecision, type TypingFollowEnvironment,
  type TypingFollowEvent, type TypingFollowIdentity, type TypingFollowIntent,
  type TypingFollowInterrupt, type TypingFollowState,
} from './typing-follow-policy.ts';
import { CAFE_MATERIAL } from './training.ts';

function identity(index = 5): TypingFollowIdentity {
  const cue = NPS_MATERIAL.cues[index], source = NPS_MATERIAL.builtinReference;
  return { courseId: NPS_MATERIAL.id, courseVersion: NPS_MATERIAL.version,
    mediaId: source.media.id, mediaSha256: source.media.sha256,
    sentenceMapVersion: source.sentenceMapVersion, sentenceMapSha256: source.sentenceMapSha256,
    cueId: cue.id, cueStartSeconds: cue.start, cueEndSeconds: cue.end };
}
function environment(): TypingFollowEnvironment {
  const id = identity();
  return { nowMs: 0, identity: id, playbackOwnerId: 'ordinary-typing-lease-1',
    referenceShown: true, mode: 'legacy-typing', listeningPlayerActive: false,
    recording: 'idle', composing: false, focused: true, visible: true,
    practiceActive: true, blocked: false, sourceVerified: true, inputProvenanceAvailable: true,
    mediaReady: true, mediaDurationSeconds: NPS_MATERIAL.builtinReference.media.durationSeconds,
    mediaPositionSeconds: id.cueStartSeconds, mediaRate: 1.25, rateWriteOwner: null, draftRevision: 0 };
}
function append(before = '', data = 'wrong', beforeRevision = 0): TypingFollowAppend {
  return { before, after: before + data, beforeRevision, afterRevision: beforeRevision + 1,
    selectionBefore: { start: before.length, end: before.length }, source: 'typed', kind: 'input',
    inputType: 'insertText', data, isTrusted: true, isComposing: false };
}
/** An authored adapter fixture: applies intent data to a plain object, never native media. */
function fixture(overrides: Partial<TypingFollowEnvironment> = {}) {
  let state = createTypingFollowState(), env = { ...environment(), ...overrides }, draft = '';
  const all: TypingFollowIntent[] = [];
  function apply(decision: TypingFollowDecision) {
    state = decision.state;
    for (const intent of decision.intents) {
      all.push(intent);
      if (intent.type === 'start-cue' || intent.type === 'set-rate') {
        env = { ...env, mediaRate: intent.rate,
          rateWriteOwner: { ownerId: intent.scope.ownerId, epoch: intent.scope.epoch, commandId: intent.commandId } };
        if (intent.type === 'start-cue') env = { ...env, mediaPositionSeconds: intent.atSeconds };
      }
      if (intent.type === 'restore-base-rate') env = { ...env, mediaRate: intent.rate, rateWriteOwner: null };
    }
    return decision;
  }
  function send(event: TypingFollowEvent, patch: Partial<TypingFollowEnvironment> = {}) {
    env = { ...env, ...patch };
    return apply(reduceTypingFollow(state, event, env));
  }
  function tick(nowMs: number, patch: Partial<TypingFollowEnvironment> = {}) {
    return send({ type: 'tick', epoch: state.epoch }, { nowMs, ...patch });
  }
  function until(nowMs: number) {
    while (env.nowMs + T.tickMs < nowMs) tick(env.nowMs + T.tickMs);
    return tick(nowMs);
  }
  function settle(ok = true) {
    return send({ type: 'play-result', epoch: state.epoch, commandId: state.active!.pendingPlay!.commandId, ok });
  }
  function start() { const decision = send({ type: 'start', explicitUserGesture: true }); if (state.active) settle(); return decision; }
  function input(nowMs: number, data = 'x', patch: Partial<TypingFollowAppend> = {}) {
    const edit = { ...append(draft, data, env.draftRevision), ...patch };
    env = { ...env, nowMs, draftRevision: edit.afterRevision };
    draft = edit.after;
    return send({ type: 'input', epoch: state.epoch, edit });
  }
  return { get state() { return state; }, get env() { return env; }, get all() { return all; },
    apply, send, tick, until, settle, start, input };
}
const types = (decision: TypingFollowDecision) => decision.intents.map(intent => intent.type);

test('fixed pacing defaults to 1x and accepts only explicitly selected supported fixed rates', () => {
  assert.deepEqual(TYPING_FOLLOW_FIXED_RATES, [0.5, 0.8, 1, 1.25, 1.5]);
  assert.ok(Object.isFrozen(TYPING_FOLLOW_FIXED_RATES));
  for (const fixedRate of [undefined, 0.5, 0.8, 1, 1.25, 1.5]) {
    const f = fixture({ pacingStrategy: 'fixed', fixedRate });
    const d = f.start();
    assert.deepEqual(types(d), ['start-cue']);
    assert.equal(d.intents[0].type === 'start-cue' && d.intents[0].rate, fixedRate ?? 1);
    assert.equal(f.state.phase, 'following');
    assert.equal(f.state.active?.actualRate, fixedRate ?? 1);
    assert.equal(f.state.active?.baseRate, 1.25);
    assert.equal(f.state.active?.pacingStrategy, 'fixed');
    assert.equal(f.state.active?.fixedRate, fixedRate ?? 1);
    f.until(3000);
    assert.equal(f.env.mediaRate, fixedRate ?? 1);
    assert.deepEqual(f.all.map(intent => intent.type), ['start-cue']);
  }
});

test('invalid fixed selections fail closed without rounding, clamping or silently choosing warm-up', () => {
  for (const fixedRate of [0, -1, 0.499999999, 0.500000001, 0.75, 0.800000001, 1.1, 1.500000001, 2, NaN, Infinity, -Infinity, '1', null]) {
    const f = fixture({ pacingStrategy: 'fixed', fixedRate: fixedRate as number });
    assert.deepEqual(types(f.start()), []);
    assert.equal(f.state.active, null);
    assert.equal(f.state.reason, 'invalid-fixed-rate');
    assert.equal(f.env.mediaRate, 1.25);
  }
  for (const pacingStrategy of ['unknown', '', null]) {
    const f = fixture({ pacingStrategy: pacingStrategy as TypingFollowEnvironment['pacingStrategy'] });
    assert.deepEqual(types(f.start()), []);
    assert.equal(f.state.reason, 'invalid-pacing-strategy');
  }
});

test('fixed pacing idle never coasts slower or writes another rate', () => {
  // Match the legacy warm-up so failure must come from real idle adaptation.
  const f = fixture({ pacingStrategy: 'fixed', fixedRate: 0.8 }); f.start();
  f.until(3000);
  assert.equal(f.env.mediaRate, 0.8);
  assert.equal(f.state.phase, 'following');
  assert.equal(f.state.reason, null);
  assert.deepEqual(f.all.map(intent => intent.type), ['start-cue']);
});

for (const [cadence, data] of [['slow', 'x'], ['fast', 'x'.repeat(100)]] as const) {
  test(`fixed pacing ${cadence} genuine input never adapts the selected rate`, () => {
    // The same authored cadence in the legacy rate-write test really changes rate.
    const f = fixture({ pacingStrategy: 'fixed', fixedRate: 0.8 }); f.start();
    for (let now = 100; now <= 10000; now += 100) { f.input(now, data); f.tick(now); }
    assert.equal(f.env.mediaRate, 0.8);
    assert.equal(f.state.phase, 'following');
    assert.equal(f.state.active?.draftRevision, 100);
    assert.deepEqual(f.all.map(intent => intent.type), ['start-cue']);
  });
}

test('pacing strategy or selected rate changes cancel the active scope until another explicit start', () => {
  for (const [initial, changed] of [
    [{ pacingStrategy: 'fixed' as const, fixedRate: 0.8 }, { pacingStrategy: 'adaptive' as const }],
    [{ pacingStrategy: 'adaptive' as const }, { pacingStrategy: 'fixed' as const }],
    [{ pacingStrategy: 'fixed' as const, fixedRate: 0.8 }, { fixedRate: 1.25 }],
  ]) {
    const f = fixture(initial); f.start();
    const d = f.tick(200, changed);
    assert.deepEqual(types(d), ['pause', 'restore-base-rate']);
    assert.equal(f.state.active, null);
    assert.equal(f.state.reason, 'pacing-changed');
    assert.deepEqual(types(f.input(300)), []);
    assert.deepEqual(types(f.tick(400)), []);
    assert.equal(f.all.some(intent => intent.type === 'resume'), false);
    f.start();
    assert.equal(f.state.phase, 'following');
    assert.equal(f.state.epoch, 2);
  }
});

test('pacing changes cancel pending play and cannot resume a former adaptive composition wait', () => {
  const pending = fixture({ pacingStrategy: 'fixed', fixedRate: 1 });
  const start = pending.send({ type: 'start', explicitUserGesture: true });
  const epoch = pending.state.epoch, commandId = start.intents[0].commandId;
  const staleSuccess = pending.send({ type: 'play-result', epoch, commandId, ok: true }, { nowMs: 100, fixedRate: 1.25 });
  assert.deepEqual(types(staleSuccess), ['pause', 'restore-base-rate']);
  assert.equal(pending.state.reason, 'pacing-changed');
  assert.equal(pending.state.active, null);
  assert.deepEqual(types(pending.send({ type: 'play-result', epoch, commandId, ok: true }, { nowMs: 200 })), []);

  const waiting = fixture({ pacingStrategy: 'adaptive' }); waiting.start();
  waiting.send({ type: 'composition-start', epoch: waiting.state.epoch, compositionId: 4 }, { nowMs: 100, composing: true });
  const edit = { ...append('', '字'), source: 'ime' as const, kind: 'compositionend' as const, inputType: null, compositionId: 4 };
  const changed = waiting.send({ type: 'input', epoch: waiting.state.epoch, edit },
    { nowMs: 200, composing: false, draftRevision: 1, pacingStrategy: 'fixed' });
  assert.deepEqual(types(changed), ['pause', 'restore-base-rate']);
  assert.equal(waiting.state.reason, 'pacing-changed');
  assert.equal(waiting.state.active, null);
  assert.equal(waiting.all.some(intent => intent.type === 'resume'), false);
});

test('pacing selection is immutable within a scope and enable cannot keep obsolete authority', () => {
  const f = fixture({ pacingStrategy: 'fixed' }); f.start();
  const active = f.state.active!;
  assert.ok(Object.isFrozen(active));
  f.tick(100, { fixedRate: 1 });
  assert.equal(f.state.phase, 'following', 'explicit 1x and its default are the same selection');
  const d = f.send({ type: 'enable', enabled: true }, { fixedRate: 0.8 });
  assert.deepEqual(types(d), ['pause', 'restore-base-rate']);
  assert.equal(f.state.reason, 'pacing-changed');
  assert.equal(f.state.active, null);
  assert.equal(active.fixedRate, 1);
});

test('stale callbacks cannot hide a changed pacing selection or overwrite a manual rate', () => {
  const f = fixture({ pacingStrategy: 'fixed' }); f.start();
  const oldEpoch = f.state.epoch; f.start();
  const d = f.send({ type: 'tick', epoch: oldEpoch }, { nowMs: 100, fixedRate: 1.25 });
  assert.deepEqual(types(d), ['pause', 'restore-base-rate']);
  assert.equal(f.state.reason, 'pacing-changed');
  assert.equal(f.state.active, null);

  const manual = fixture({ pacingStrategy: 'fixed' }); manual.start();
  const changed = manual.send({ type: 'interrupt', epoch: manual.state.epoch, reason: 'manual-rate' },
    { nowMs: 100, fixedRate: 1.5, mediaRate: 2.75, rateWriteOwner: null });
  assert.deepEqual(types(changed), []);
  assert.equal(manual.env.mediaRate, 2.75);
  assert.equal(manual.state.active, null);
});

test('fixed composition interrupts terminally instead of pausing to help input and resuming', () => {
  for (const pending of [false, true]) {
    const f = fixture({ pacingStrategy: 'fixed', fixedRate: 0.8 });
    const started = pending ? f.send({ type: 'start', explicitUserGesture: true }) : f.start();
    const epoch = f.state.epoch, commandId = started.intents[0].commandId;
    const d = f.send({ type: 'composition-start', epoch, compositionId: 7 }, { nowMs: 100, composing: true });
    assert.deepEqual(types(d), ['pause', 'restore-base-rate']);
    assert.equal(f.state.phase, 'off');
    assert.equal(f.state.reason, 'fixed-composition-interrupted');
    assert.equal(f.state.active, null);
    assert.deepEqual(types(f.send({ type: 'play-result', epoch, commandId, ok: true }, { nowMs: 200 })), []);
    const edit = { ...append('', '字'), source: 'ime' as const, kind: 'compositionend' as const, inputType: null, compositionId: 7 };
    assert.deepEqual(types(f.send({ type: 'input', epoch, edit }, { nowMs: 300, composing: false, draftRevision: 1 })), []);
    assert.deepEqual(types(f.tick(400)), []);
    assert.equal(f.all.some(intent => intent.type === 'resume' || intent.type === 'set-rate'), false);
  }
});

test('default, reload, enable-only and non-gesture start are silent and contain no active scope', () => {
  const f = fixture();
  assert.deepEqual(f.state, { enabled: false, phase: 'off', reason: null, epoch: 0, commandSequence: 0, active: null });
  assert.deepEqual(types(f.send({ type: 'enable', enabled: true })), []);
  assert.deepEqual(types(f.send({ type: 'start', explicitUserGesture: false })), []);
  assert.deepEqual(types(f.input(10)), []);
  assert.deepEqual(types(f.tick(10000)), []);
  assert.equal(f.state.active, null);
  assert.equal(createTypingFollowState().enabled, false);
});

test('explicit start alone snapshots base rate, positions once, and requires native play/rate readback', () => {
  const f = fixture();
  const started = f.send({ type: 'start', explicitUserGesture: true });
  assert.deepEqual(types(started), ['start-cue']);
  assert.equal(started.intents[0].type === 'start-cue' && started.intents[0].atSeconds, f.env.identity.cueStartSeconds);
  assert.equal(f.state.active?.baseRate, 1.25);
  assert.equal(f.state.active?.actualRate, null, 'an unapplied target is not displayed as actual');
  assert.equal(f.state.phase, 'starting');
  f.settle();
  assert.equal(f.state.phase, 'following');
  assert.equal(f.state.active?.actualRate, 0.8);
  f.input(200, 'incorrect');
  f.tick(400);
  assert.equal(f.all.filter(intent => intent.type === 'start-cue').length, 1);
});

const blocked: [string, Partial<TypingFollowEnvironment>][] = [
  ['hidden', { referenceShown: false }], ['dictation', { mode: 'dictation' }],
  ['listening', { mode: 'listening' }], ['history', { mode: 'history' }],
  ['review', { mode: 'review' }], ['replay', { mode: 'replay' }],
  ['active ListeningPlayer', { listeningPlayerActive: true }],
  ['recording preparation', { recording: 'preparing' }], ['recording', { recording: 'recording' }],
  ['recording stop', { recording: 'stopping' }], ['composing at entry', { composing: true }],
  ['blur', { focused: false }], ['background', { visible: false }],
  ['paused practice', { practiceActive: false }], ['blocker', { blocked: true }],
  ['unknown provenance', { inputProvenanceAvailable: false }],
  ['unverified source', { sourceVerified: false }], ['unready source', { mediaReady: false }],
  ['no owner', { playbackOwnerId: '' }], ['nonfinite duration', { mediaDurationSeconds: Infinity }],
  ['wrong duration', { mediaDurationSeconds: 100 }], ['zero rate', { mediaRate: 0 }],
  ['negative rate', { mediaRate: -1 }], ['NaN rate', { mediaRate: NaN }],
  ['bad revision', { draftRevision: NaN }], ['bad time', { nowMs: NaN }], ['negative time', { nowMs: -1 }],
];
for (const [name, patch] of blocked) test(`entry fails closed for ${name}`, () => {
  const f = fixture(patch);
  assert.deepEqual(types(f.send({ type: 'start', explicitUserGesture: true })), []);
  assert.equal(f.state.active, null);
  assert.equal(f.state.phase, 'off');
});

const fixedBlocked = blocked.filter(([name]) => name !== 'hidden' && name !== 'dictation');
for (const [name, patch] of fixedBlocked) test(`fixed entry preserves the existing guard for ${name}`, () => {
  const f = fixture({ pacingStrategy: 'fixed', ...patch });
  assert.deepEqual(types(f.start()), []);
  assert.equal(f.state.active, null);
  assert.equal(f.state.phase, 'off');
});

test('fixed entry still blocks assisted path when reference is hidden without dictation mode', () => {
  const f = fixture({ pacingStrategy: 'fixed', referenceShown: false, mode: 'legacy-typing' });
  assert.deepEqual(types(f.start()), []);
  assert.equal(f.state.reason, 'reference-hidden');
});

test('fixed entry blocks dictation when reference is still shown', () => {
  const f = fixture({ pacingStrategy: 'fixed', referenceShown: true, mode: 'dictation' });
  assert.deepEqual(types(f.start()), []);
  assert.equal(f.state.reason, 'dictation-reference-leaked');
});

test('fixed dictation entry starts when reference stays hidden', () => {
  const f = fixture({ pacingStrategy: 'fixed', referenceShown: false, mode: 'dictation' });
  const d = f.start();
  assert.ok(types(d).includes('start-cue'));
  assert.ok(f.state.phase === 'starting' || f.state.phase === 'following');
  assert.equal(f.state.active?.pacingStrategy, 'fixed');
});

test('fixed dictation continues while reference stays hidden', () => {
  const f = fixture({ pacingStrategy: 'fixed', referenceShown: false, mode: 'dictation' });
  f.start();
  const d = f.tick(50);
  assert.ok(f.state.phase === 'following' || f.state.phase === 'starting');
  assert.equal(f.state.active?.pacingStrategy, 'fixed');
  assert.deepEqual(types(f.tick(100, { referenceShown: false, mode: 'dictation' })).filter(t => t === 'pause'), []);
});

test('fixed dictation rejects leaked reference mid-run', () => {
  const f = fixture({ pacingStrategy: 'fixed', referenceShown: false, mode: 'dictation' });
  f.start(); f.tick(50);
  const d = f.tick(100, { referenceShown: true, mode: 'dictation' });
  assert.deepEqual(types(d), ['pause', 'restore-base-rate']);
  assert.equal(f.state.reason, 'dictation-reference-leaked');
});

test('fixed playback keeps source, privacy, observation and sentence endpoint guards', () => {
  const patches: [Partial<TypingFollowEnvironment>, string][] = [
    [{ referenceShown: false }, 'reference-hidden'], [{ visible: false }, 'background'],
    [{ focused: false }, 'blur'], [{ sourceVerified: false }, 'source-unqualified'],
    [{ recording: 'preparing' }, 'recording'], [{ mode: 'dictation' }, 'dictation-reference-leaked'],
    [{ mediaPositionSeconds: identity().cueStartSeconds - 0.001 }, 'outside-cue'],
    [{ mediaPositionSeconds: identity().cueEndSeconds }, 'sentence-ended'],
    [{ nowMs: T.maxObservationGapMs + 1 }, 'observation-gap'],
    [{ fixedRate: 1.1 }, 'invalid-fixed-rate'],
  ];
  for (const [patch, reason] of patches) {
    const f = fixture({ pacingStrategy: 'fixed' }); f.start();
    const d = f.tick(100, patch);
    assert.deepEqual(types(d), ['pause', 'restore-base-rate']);
    assert.equal(f.state.reason, reason);
    assert.equal(f.state.phase, reason === 'sentence-ended' ? 'ended' : 'off');
    assert.equal(f.state.active, null);
    assert.deepEqual(types(f.input(1200)), []);
    assert.equal(f.all.some(intent => intent.type === 'resume' || intent.type === 'set-rate'), false);
  }
});

test('fixed playback preserves newer playback owners and native manual rates', () => {
  for (const patch of [{ playbackOwnerId: 'new-owner' }, { identity: identity(4) }, { mediaRate: 2, rateWriteOwner: null }]) {
    const f = fixture({ pacingStrategy: 'fixed' }); f.start();
    assert.deepEqual(types(f.tick(100, patch)), []);
    assert.equal(f.state.active, null);
  }
  const f = fixture({ pacingStrategy: 'fixed' }); f.start();
  const d = f.send({ type: 'interrupt', epoch: f.state.epoch, reason: 'manual-rate' }, { nowMs: 100, mediaRate: 2.75, rateWriteOwner: null });
  assert.deepEqual(types(d), []);
  assert.equal(f.env.mediaRate, 2.75);
  assert.equal(f.state.active, null);
});

for (const key of Object.keys(identity()) as (keyof TypingFollowIdentity)[]) test(`registry admission rejects altered ${key}`, () => {
  const id = identity();
  const changed = { ...id, [key]: typeof id[key] === 'number' ? Number(id[key]) + 0.001 : String(id[key]) + '-changed' };
  const f = fixture({ identity: changed });
  assert.deepEqual(types(f.send({ type: 'start', explicitUserGesture: true })), []);
  assert.equal(f.state.reason, 'source-unqualified');
});

test('every registered NPS sentence is admitted, with no extension of its source boundary', () => {
  assert.equal(NPS_MATERIAL.cues.length, 11);
  for (let i = 0; i < NPS_MATERIAL.cues.length; i++) {
    const f = fixture({ identity: identity(i) });
    f.start();
    assert.equal(f.state.phase, 'following');
    assert.equal(f.state.active?.scope.identity.cueEndSeconds, NPS_MATERIAL.cues[i].end);
  }
});

test('hidden targets do not change off-state outputs and are not read for pace', () => {
  const first = environment(), second = environment();
  const hostileIdentity = new Proxy(identity(), { get() { throw new Error('hidden cue was inspected'); } });
  const action = { type: 'start', explicitUserGesture: true } as const;
  const a = reduceTypingFollow(createTypingFollowState(), action, { ...first, referenceShown: false });
  const b = reduceTypingFollow(createTypingFollowState(), action, { ...second, referenceShown: false, identity: hostileIdentity });
  assert.deepEqual(a, b);
  assert.equal(a.state.reason, 'reference-hidden');
});

test('immutable snapshot does not retain the mutable caller identity or any draft text', () => {
  const env = environment(), original = { ...env.identity };
  const d = reduceTypingFollow(createTypingFollowState(), { type: 'start', explicitUserGesture: true }, env);
  (env.identity as { courseVersion: string }).courseVersion = 'changed';
  assert.deepEqual(d.state.active?.scope.identity, original);
  assert.ok(Object.isFrozen(d.state.active?.scope.identity));
  assert.ok(Object.isFrozen(d.intents[0]));
  assert.throws(() => { (d.state.active!.samples as unknown[]).push('raw text'); }, TypeError);
  const f = fixture(); f.start(); f.input(200, 'PRIVATE_UNIQUE_WRONG_DRAFT');
  assert.equal(JSON.stringify(f.state).includes('PRIVATE_UNIQUE_WRONG_DRAFT'), false);
  assert.deepEqual(Object.keys(f.state.active!.samples[0]).sort(), ['atMs', 'count']);
});

test('true appended graphemes count spaces, wrong text, combining clusters and emoji once', () => {
  for (const data of ['wrong', 'a b!', 'e\u0301', '👩‍💻', '🇨🇳']) {
    const expected = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(data)].length;
    assert.equal(qualifyingTypingFollowAppend(append('old ', data)), expected);
  }
  assert.equal(qualifyingTypingFollowAppend(append('e', '\u0301')), null, 'extension of a prior grapheme is not a fresh grapheme');
  assert.equal(qualifyingTypingFollowAppend(append('👩', '\u200d💻')), null);
});

const excluded: [string, Partial<TypingFollowAppend>][] = [
  ['paste', { source: 'paste', inputType: 'insertFromPaste' }], ['drop', { inputType: 'insertFromDrop' }],
  ['delete', { inputType: 'deleteContentBackward' }], ['undo', { inputType: 'historyUndo' }],
  ['redo', { inputType: 'historyRedo' }], ['replacement', { inputType: 'insertReplacementText' }],
  ['autofill or unknown inputType', { inputType: null }], ['programmatic', { source: 'programmatic' }],
  ['synthetic input', { isTrusted: false }], ['preedit', { isComposing: true }],
  ['unknown source', { source: 'unknown' }], ['missing data', { data: null }],
  ['data mismatch', { data: 'different' }], ['missing selection', { selectionBefore: null }],
  ['selected identical prefix replacement', { before: 'a', after: 'aa', data: 'a', selectionBefore: { start: 0, end: 1 } }],
  ['middle repeated-letter insertion', { before: 'aa', after: 'aaa', data: 'a', selectionBefore: { start: 1, end: 1 } }],
  ['non-prefix edit', { before: 'a', after: 'b', data: 'b', selectionBefore: { start: 1, end: 1 } }],
];
for (const [name, patch] of excluded) test(`${name} supplies no pace and a changed draft disarms`, () => {
  assert.equal(qualifyingTypingFollowAppend({ ...append(), ...patch }), null);
  const f = fixture(); f.start();
  const d = f.input(200, 'wrong', patch);
  assert.equal(f.state.phase, 'off');
  assert.equal(f.state.active, null);
  assert.deepEqual(types(d), ['pause', 'restore-base-rate']);
  assert.equal(f.env.mediaRate, 1.25);
});

test('fixed playback retains every non-append provenance rejection', () => {
  for (const [, patch] of excluded) {
    const f = fixture({ pacingStrategy: 'fixed' }); f.start();
    assert.deepEqual(types(f.input(200, 'wrong', patch)), ['pause', 'restore-base-rate']);
    assert.equal(f.state.active, null);
    assert.equal(f.env.mediaRate, 1.25);
  }
});

test('missing grapheme segmentation fails closed instead of counting code points', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')!;
  try {
    Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true });
    assert.equal(qualifyingTypingFollowAppend(append('', '👩‍💻')), null);
    const f = fixture(); f.send({ type: 'start', explicitUserGesture: true });
    assert.equal(f.state.reason, 'grapheme-segmentation-unavailable');
  } finally { Object.defineProperty(Intl, 'Segmenter', descriptor); }
});

test('60-grapheme / six-second authored arithmetic fixture clamps slow, ordinary and fast estimates', () => {
  assert.equal(estimatedTypingFollowRate(5, 1000, 60 / 6), 0.5);
  assert.equal(estimatedTypingFollowRate(10, 1000, 60 / 6), 1);
  assert.equal(estimatedTypingFollowRate(20, 1000, 60 / 6), 1.5);
  assert.equal(estimatedTypingFollowRate(1, 1000, 10), 0.5);
  for (const value of [0, -1, NaN, Infinity]) {
    assert.equal(estimatedTypingFollowRate(value, 1000, 10), null);
    assert.equal(estimatedTypingFollowRate(10, value, 10), null);
    assert.equal(estimatedTypingFollowRate(10, 1000, value), null);
  }
});

test('warm-up requires one second and separated commits; a single giant commit cannot qualify', () => {
  const single = fixture(); single.start(); single.input(100, 'x'.repeat(1000)); single.until(1000);
  assert.equal(single.env.mediaRate, 0.8);
  const close = fixture(); close.start(); close.input(100, 'x'.repeat(100)); close.input(349, 'x'.repeat(100)); close.until(1000);
  assert.equal(close.env.mediaRate, 0.8);
  const qualified = fixture(); qualified.start(); qualified.input(100, 'x'.repeat(100)); qualified.input(350, 'x'.repeat(100)); qualified.until(999);
  assert.equal(qualified.env.mediaRate, 0.8);
  qualified.tick(1200);
  assert.ok(Math.abs(qualified.env.mediaRate - 0.85) < 1e-9);
});

test('rate writes honor 200 ms cap, 0.25/s slope, deadband and both bounds', () => {
  for (const data of ['x', 'x'.repeat(100)]) {
    const f = fixture(); f.start();
    let previousRate = 0.8, lastWriteMs = 0;
    for (let now = 100; now <= 10000; now += 100) {
      f.input(now, data);
      const d = f.tick(now);
      const rate = d.intents.find(intent => intent.type === 'set-rate');
      if (rate?.type === 'set-rate') {
        assert.ok(now - lastWriteMs >= 200);
        assert.ok(Math.abs(rate.rate - previousRate) <= 0.05 + 1e-9);
        assert.ok(Math.abs(rate.rate - previousRate) >= T.rateDeadband - 1e-9);
        assert.ok(rate.rate >= 0.5 && rate.rate <= 1.5);
        previousRate = rate.rate; lastWriteMs = now;
      }
    }
    if (data.length > 1) assert.equal(f.env.mediaRate, 1.5);
    else assert.ok(f.env.mediaRate < 0.8);
  }
});

test('rolling samples are left-open at three seconds and only counts/timestamps survive', () => {
  const f = fixture(); f.start();
  for (let now = 100; now <= 4100; now += 100) { f.input(now); f.tick(now); }
  assert.ok(f.state.active!.samples.every(sample => sample.atMs > 1100));
  assert.equal(f.state.active!.samples.length, 30);
  assert.equal(f.state.active!.samples[0].atMs, 1200);
});

test('sample memory is bounded even with hostile high-frequency genuine-looking input', () => {
  const f = fixture(); f.start();
  for (let n = 1; n <= T.maxSamples; n++) f.input(n / 10);
  assert.equal(f.state.active!.samples.length, T.maxSamples);
  f.input((T.maxSamples + 1) / 10);
  assert.equal(f.state.reason, 'input-overflow');
  assert.equal(f.state.active, null);
});

test('idle deadline coasts smoothly to sentence end without pause, resume or seek', () => {
  const f = fixture(); f.start(); f.until(1499);
  assert.equal(f.state.phase, 'following');
  const d = f.tick(1500);
  assert.ok(!types(d).includes('pause'));
  assert.equal(f.state.phase, 'following');
  assert.equal(f.state.reason, 'idle-coasting');
  assert.equal(f.state.active!.samples.length, 0);
  let previousRate = f.env.mediaRate;
  for (let at = 1700; at <= 4500; at += 200) {
    f.tick(at);
    assert.ok(f.env.mediaRate <= previousRate);
    assert.ok(previousRate - f.env.mediaRate <= T.maxRateDeltaPerSecond * .2 + 1e-9);
    previousRate = f.env.mediaRate;
  }
  assert.equal(f.env.mediaRate, .5);
  assert.equal(f.state.phase, 'following');
  assert.equal(f.all.filter(intent => intent.type === 'pause').length, 0);
  assert.equal(f.all.filter(intent => intent.type === 'resume').length, 0);
  const heldPosition = f.env.mediaPositionSeconds;
  assert.deepEqual(types(f.input(4600, 'wrong')), []);
  assert.equal(f.state.reason, null);
  f.tick(4800);
  assert.ok(f.env.mediaRate > .5 && f.env.mediaRate <= .55 + 1e-9);
  assert.equal(f.state.phase, 'following');
  assert.equal(f.env.mediaPositionSeconds, heldPosition);
  assert.equal(f.all.filter(intent => intent.type === 'start-cue').length, 1);
});

test('idle coasting ends only at the verified sentence boundary and cannot typing-restart', () => {
  const f = fixture(); f.start(); f.until(3000);
  assert.equal(f.state.reason, 'idle-coasting');
  assert.equal(f.env.mediaRate, .5);
  f.tick(3050, { mediaPositionSeconds: f.env.identity.cueEndSeconds - .001 });
  assert.equal(f.state.phase, 'following');
  assert.equal(f.all.filter(intent => intent.type === 'pause').length, 0);
  assert.deepEqual(types(f.tick(3100, { mediaPositionSeconds: f.env.identity.cueEndSeconds })), ['pause', 'restore-base-rate']);
  assert.equal(f.state.phase, 'ended');
  assert.equal(f.state.reason, 'sentence-ended');
  assert.equal(f.state.active, null);
  assert.deepEqual(types(f.input(3200)), []);
  assert.equal(f.all.filter(intent => intent.type === 'start-cue').length, 1);
  assert.equal(f.all.filter(intent => intent.type === 'resume').length, 0);
});

test('equal genuine input cadence has equal rates regardless of reference correctness', () => {
  const correct = fixture(), wrong = fixture(); correct.start(); wrong.start();
  const reference = NPS_MATERIAL.cues[5].text;
  for (let index = 0; index < 12; index++) {
    const at = (index + 1) * 150;
    correct.input(at, reference[index]); wrong.input(at, 'x');
    const a = correct.tick(at), b = wrong.tick(at);
    assert.deepEqual(a, b, 'neither state nor media intent exposes answer matching');
  }
  correct.until(5000); wrong.until(5000);
  assert.deepEqual(correct.state, wrong.state);
  assert.deepEqual(correct.all, wrong.all);
});

for (const patch of [{ referenceShown: false }, { visible: false }, { focused: false }, { practiceActive: false }, { recording: 'preparing' as const }]) {
  test(`idle coasting immediately honors privacy/lifecycle interruption ${JSON.stringify(patch)}`, () => {
    const f = fixture(); f.start(); f.until(1800);
    assert.equal(f.state.reason, 'idle-coasting');
    const d = f.tick(1850, patch);
    assert.deepEqual(types(d), ['pause', 'restore-base-rate']);
    assert.equal(f.state.active, null);
  });
}

test('paste or missing evidence cannot wake idle playback', () => {
  for (const patch of [{ source: 'paste' as const }, { isTrusted: false }, { selectionBefore: null }]) {
    const f = fixture(); f.start(); f.until(1500);
    assert.equal(types(f.input(1600, 'x', patch)).includes('resume'), false);
    assert.equal(f.state.phase, 'off');
  }
});

test('composition preedit pauses; final genuine append resumes once with fresh warm-up', () => {
  const f = fixture(); f.start(); f.input(100, 'a');
  const d = f.send({ type: 'composition-start', epoch: f.state.epoch, compositionId: 7 }, { nowMs: 200, composing: true });
  assert.deepEqual(types(d), ['pause']);
  f.until(4000);
  assert.equal(f.state.phase, 'waiting');
  assert.equal(f.state.active!.samples.length, 0);
  const edit = { ...append('a', '👩‍💻', 1), source: 'ime' as const, kind: 'compositionend' as const, inputType: null, compositionId: 7 };
  const resumed = f.send({ type: 'input', epoch: f.state.epoch, edit }, { nowMs: 4100, composing: false, draftRevision: 2 });
  assert.deepEqual(types(resumed), ['set-rate', 'resume']);
  assert.equal(f.state.active!.samples[0].count, 1);
  const duplicate = f.send({ type: 'input', epoch: f.state.epoch, edit }, { nowMs: 4101 });
  assert.deepEqual(types(duplicate), []);
  assert.equal(f.state.active!.samples.length, 1);
  f.settle();
  f.until(5100);
  assert.equal(f.env.mediaRate, 0.8, 'single IME commit cannot create measured cadence');
});

test('composition cancellation never resumes or manufactures a commit', () => {
  const f = fixture(); f.start();
  f.send({ type: 'composition-start', epoch: f.state.epoch, compositionId: 8 }, { nowMs: 100, composing: true });
  const d = f.send({ type: 'composition-cancel', epoch: f.state.epoch, compositionId: 8 }, { nowMs: 200, composing: false });
  assert.deepEqual(types(d), []);
  assert.equal(f.state.phase, 'waiting');
  assert.equal(f.state.active!.samples.length, 0);
  f.until(1500);
  assert.equal(f.all.some(intent => intent.type === 'resume'), false);
});

test('unknown composition identity and preedit input fail closed', () => {
  for (const patch of [{ compositionId: 99 }, { isComposing: true }, { source: 'typed' as const, kind: 'input' as const, inputType: 'insertText' }]) {
    const f = fixture(); f.start();
    f.send({ type: 'composition-start', epoch: f.state.epoch, compositionId: 9 }, { nowMs: 100, composing: true });
    const edit = { ...append('', '字'), source: 'ime' as const, kind: 'compositionend' as const, inputType: null, compositionId: 9, ...patch };
    const d = f.send({ type: 'input', epoch: f.state.epoch, edit }, { nowMs: 200, composing: false, draftRevision: 1 });
    assert.equal(f.state.phase, 'off');
    assert.equal(types(d).includes('resume'), false);
  }
});

const interruptions: TypingFollowInterrupt[] = ['manual-pause', 'manual-play', 'manual-seek', 'manual-replay',
  'hide-reference', 'background', 'blur', 'course-change', 'cue-change', 'version-change', 'recording',
  'check', 'next', 'review', 'replay', 'unmount', 'media-error', 'unattributed-native-event'];
for (const reason of interruptions) test(`${reason} disarms and restores the captured ordinary rate, never typing-restarts`, () => {
  const f = fixture(); f.start();
  const d = f.send({ type: 'interrupt', epoch: f.state.epoch, reason });
  assert.deepEqual(types(d), ['pause', 'restore-base-rate']);
  const restore = d.intents[1];
  assert.ok(restore.type === 'restore-base-rate');
  assert.equal(restore.rate, 1.25);
  assert.equal(restore.onlyIfRateCommandId, 1);
  assert.equal(f.state.active, null);
  assert.deepEqual(types(f.input(200)), []);
});

test('fixed playback retains every explicit interruption and never typing-restarts', () => {
  for (const reason of interruptions) {
    const f = fixture({ pacingStrategy: 'fixed' }); f.start();
    assert.deepEqual(types(f.send({ type: 'interrupt', epoch: f.state.epoch, reason })), ['pause', 'restore-base-rate']);
    assert.equal(f.state.active, null);
    assert.equal(f.env.mediaRate, 1.25);
    assert.deepEqual(types(f.input(200)), []);
  }
});

test('manual rate wins exactly, including values outside beta bounds', () => {
  const f = fixture(); f.start();
  const d = f.send({ type: 'interrupt', epoch: f.state.epoch, reason: 'manual-rate' }, { mediaRate: 2.75, rateWriteOwner: null });
  assert.deepEqual(types(d), []);
  assert.equal(f.state.active, null);
  assert.equal(f.env.mediaRate, 2.75);
  assert.deepEqual(types(f.input(100)), []);
});

test('turning off is paused restoration, never an implicit resume', () => {
  const f = fixture(); f.start();
  assert.deepEqual(types(f.send({ type: 'enable', enabled: false })), ['pause', 'restore-base-rate']);
  assert.equal(f.state.enabled, false);
  assert.equal(f.state.active, null);
  assert.deepEqual(types(f.send({ type: 'enable', enabled: true })), []);
  assert.deepEqual(types(f.input(100)), []);
});

test('actual base-rate restore is conditional; a newer owner gets no cleanup writes', () => {
  for (const patch of [{ playbackOwnerId: 'new-listening-owner' }, { identity: identity(4) }, { identity: { ...identity(), mediaSha256: 'new-media' } }]) {
    const f = fixture(); f.start();
    const d = f.tick(100, patch);
    assert.equal(f.state.reason, 'ownership-changed');
    assert.deepEqual(types(d), []);
  }
  const f = fixture(); f.start();
  const d = f.tick(100, { mediaRate: 2, rateWriteOwner: null });
  assert.deepEqual(types(d), []);
  assert.equal(f.state.reason, 'rate-ownership-changed');
});

test('sentence endpoint is terminal, even with more real input; only explicit start re-arms', () => {
  const f = fixture({ identity: identity(0) }); f.start();
  const d = f.tick(760, { mediaPositionSeconds: f.env.identity.cueEndSeconds });
  assert.equal(f.state.phase, 'ended');
  assert.deepEqual(types(d), ['pause', 'restore-base-rate']);
  assert.equal(f.state.active, null);
  assert.deepEqual(types(f.input(800, 'still typing')), []);
  assert.deepEqual(types(f.tick(1000)), []);
  f.start();
  assert.equal(f.state.phase, 'following');
  assert.equal(f.state.epoch, 2);
  assert.equal(f.all.filter(intent => intent.type === 'start-cue').length, 2);
});

test('endpoint prevents idle input resume and pending play success; lower escape never seeks back', () => {
  const idle = fixture(); idle.start(); idle.until(1500);
  const edit = append();
  const d = idle.send({ type: 'input', epoch: idle.state.epoch, edit }, { nowMs: 1600, draftRevision: 1, mediaPositionSeconds: idle.env.identity.cueEndSeconds });
  assert.equal(idle.state.phase, 'ended');
  assert.equal(types(d).includes('resume'), false);
  const pending = fixture(); pending.send({ type: 'start', explicitUserGesture: true });
  pending.send({ type: 'play-result', epoch: pending.state.epoch, commandId: pending.state.active!.pendingPlay!.commandId, ok: true }, { mediaPositionSeconds: pending.env.identity.cueEndSeconds });
  assert.equal(pending.state.phase, 'ended');
  const escaped = fixture(); escaped.start();
  assert.deepEqual(types(escaped.tick(100, { mediaPositionSeconds: escaped.env.identity.cueStartSeconds - 0.001 })), ['pause', 'restore-base-rate']);
  assert.equal(escaped.state.reason, 'outside-cue');
  assert.equal(escaped.all.filter(intent => intent.type === 'start-cue').length, 1);
});

test('backwards, nonfinite and long unobserved clocks disarm without catch-up rates', () => {
  for (const nowMs of [-1, NaN, Infinity, T.maxObservationGapMs + 1]) {
    const f = fixture(); f.start();
    const d = f.tick(nowMs);
    assert.equal(f.state.active, null);
    assert.deepEqual(types(d), ['pause', 'restore-base-rate']);
    assert.deepEqual(types(f.input(2000)), []);
  }
  const f = fixture(); f.start();
  f.tick(T.maxObservationGapMs);
  assert.equal(f.state.phase, 'following', 'the boundary itself is allowed');
});

test('late old-epoch input, play rejection, rate event and interrupt cannot affect a restarted scope', () => {
  const f = fixture(); f.start();
  const oldEpoch = f.state.epoch, oldCommand = f.state.active!.rateWrite.commandId;
  f.start();
  const before = f.state;
  for (const event of [
    { type: 'input', epoch: oldEpoch, edit: append() },
    { type: 'play-result', epoch: oldEpoch, commandId: oldCommand, ok: false },
    { type: 'rate-applied', epoch: oldEpoch, commandId: oldCommand },
    { type: 'interrupt', epoch: oldEpoch, reason: 'manual-pause' },
  ] as TypingFollowEvent[]) {
    assert.deepEqual(types(f.send(event)), []);
    assert.deepEqual(f.state, before);
  }
  assert.equal(f.state.active!.baseRate, 1.25, 'rapid restart must not snapshot its own warm-up as the manual base');
});

test('old play settlement cannot cancel a newer resume in the same scope', () => {
  const f = fixture(); const first = f.start().intents[0].commandId;
  f.send({ type: 'composition-start', epoch: f.state.epoch, compositionId: 1 }, { nowMs: 100, composing: true });
  f.send({ type: 'composition-cancel', epoch: f.state.epoch, compositionId: 1 }, { nowMs: 200, composing: false });
  f.input(300);
  const currentPlay = f.state.active!.pendingPlay!.commandId;
  assert.notEqual(currentPlay, first);
  assert.deepEqual(types(f.send({ type: 'play-result', epoch: f.state.epoch, commandId: first, ok: false })), []);
  assert.equal(f.state.active!.pendingPlay!.commandId, currentPlay);
  f.settle();
  assert.equal(f.state.phase, 'following');
});

test('manual pause or hide during composition makes its final input inert', () => {
  for (const patch of [{ referenceShown: false }, { focused: false }, { visible: false }, { recording: 'preparing' as const }]) {
    const f = fixture(); f.start();
    f.send({ type: 'composition-start', epoch: f.state.epoch, compositionId: 1 }, { nowMs: 100, composing: true });
    f.tick(200, patch);
    assert.equal(f.state.active, null);
    const edit = { ...append('', '文'), source: 'ime' as const, kind: 'compositionend' as const, inputType: null, compositionId: 1 };
    assert.deepEqual(types(f.send({ type: 'input', epoch: f.state.epoch, edit }, { nowMs: 300, composing: false, draftRevision: 1 })), []);
  }
});

test('pending initial or resumed play rejection is terminal with no retry loop', () => {
  for (const resume of [false, true]) {
    const f = fixture();
    if (resume) {
      f.start();
      f.send({ type: 'composition-start', epoch: f.state.epoch, compositionId: 1 }, { nowMs: 100, composing: true });
      f.send({ type: 'composition-cancel', epoch: f.state.epoch, compositionId: 1 }, { nowMs: 200, composing: false });
      f.input(300);
    }
    else f.send({ type: 'start', explicitUserGesture: true });
    assert.deepEqual(types(f.settle(false)), ['pause', 'restore-base-rate']);
    assert.equal(f.state.reason, 'play-rejected');
    assert.deepEqual(types(f.input(f.env.nowMs + 100)), []);
  }
});

test('pending play timeout and clamped/unapplied native rate remain explicit failures', () => {
  const f = fixture(); f.send({ type: 'start', explicitUserGesture: true }); f.until(1500);
  assert.equal(f.state.reason, 'play-timeout');
  const clamped = fixture(); clamped.send({ type: 'start', explicitUserGesture: true });
  const commandId = clamped.state.active!.rateWrite.commandId;
  const d = clamped.send({ type: 'rate-applied', epoch: clamped.state.epoch, commandId }, { mediaRate: 1 });
  assert.equal(clamped.state.reason, 'rate-not-applied');
  assert.deepEqual(types(d), ['pause']);
  assert.equal(clamped.env.mediaRate, 1, 'unapplied rate has no restoration authority');
});

test('skipped or unobserved draft revisions disarm instead of accepting late edit evidence', () => {
  const f = fixture(); f.start();
  const edit = { ...append(), beforeRevision: 1, afterRevision: 2 };
  f.send({ type: 'input', epoch: f.state.epoch, edit }, { nowMs: 100, draftRevision: 2 });
  assert.equal(f.state.reason, 'draft-revision-gap');
  const unobserved = fixture(); unobserved.start(); unobserved.tick(100, { draftRevision: 1 });
  assert.equal(unobserved.state.reason, 'draft-revision-gap');
});

test('control-only decisions have no scoring, persistence, audio graph, volume or native-call capability', async () => {
  const source = await readFile(new URL('./typing-follow-policy.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:window|document|localStorage|indexedDB|fetch|AudioContext|MediaRecorder|TrainingEngine|reduceTraining|setTimeout|setInterval)\b/);
  assert.doesNotMatch(source, /\.(?:play|pause|seek|save|submit|score|setVolume)\s*\(/);
  assert.doesNotMatch(source, /currentTime\s*=/);
  const f = fixture(); f.start(); f.input(100, 'wrong wrong wrong'); f.until(1600);
  assert.ok(f.all.every(intent => ['start-cue', 'set-rate', 'pause', 'resume', 'restore-base-rate'].includes(intent.type)));
  assert.equal(f.state.active!.samples.length, 0);
});

test('expired cadence without an actual system pause never issues redundant resume', () => {
  const f = fixture(); f.start();
  f.input(100, 'x'.repeat(100)); f.input(400, 'x'.repeat(100)); f.until(1000);
  const previousRate = f.env.mediaRate;
  assert.ok(previousRate > 0.8);
  f.until(1899);
  assert.equal(f.state.phase, 'following');
  const resumed = f.input(1900, 'x');
  assert.deepEqual(types(resumed), []);
  assert.equal(f.state.phase, 'following');
  assert.equal(f.state.active!.segmentStartedMs, 1900);
  assert.equal(f.state.active!.samples.length, 1);
  const before = f.env.mediaRate;
  f.tick(2100);
  assert.ok(f.env.mediaRate <= before && before - f.env.mediaRate <= 0.05 + 1e-9);
  assert.equal(f.all.filter(intent => intent.type === 'resume').length, 0);
});

test('composition can supersede pending initial play; late settlement cannot start or advance', () => {
  const f = fixture();
  const start = f.send({ type: 'start', explicitUserGesture: true });
  const commandId = start.intents[0].commandId;
  f.send({ type: 'composition-start', epoch: f.state.epoch, compositionId: 1 }, { nowMs: 100, composing: true });
  for (const ok of [true, false]) {
    const d = f.send({ type: 'play-result', epoch: f.state.epoch, commandId, ok }, { nowMs: 200 });
    assert.deepEqual(types(d), []);
    assert.equal(f.state.phase, 'waiting');
    assert.equal(f.state.active!.pendingPlay, null);
  }
});

test('changed native rate with old write token never restores or retunes an external choice', () => {
  for (const type of ['tick', 'interrupt', 'rate-applied'] as const) {
    const f = fixture({ mediaRate: 1 }); f.start();
    const epoch = f.state.epoch, commandId = f.state.active!.rateWrite.commandId;
    const event: TypingFollowEvent = type === 'tick' ? { type, epoch } : type === 'interrupt'
      ? { type, epoch, reason: 'unattributed-native-event' } : { type, epoch, commandId };
    const d = f.send(event, { nowMs: 100, mediaRate: 1.25 });
    assert.equal(f.state.active, null);
    assert.equal(d.intents.some(intent => intent.type === 'restore-base-rate' || intent.type === 'set-rate'), false);
    assert.equal(f.env.mediaRate, 1.25);
  }
});

test('duplicate or old-epoch input cannot hide an unobserved committed-draft change', () => {
  const f = fixture(); f.start(); f.input(100);
  const duplicate = append();
  const d = f.send({ type: 'input', epoch: f.state.epoch, edit: duplicate }, { nowMs: 200, draftRevision: 2 });
  assert.equal(f.state.reason, 'draft-revision-gap');
  assert.deepEqual(types(d), ['pause', 'restore-base-rate']);
  const old = fixture(); old.start(); const epoch = old.state.epoch; old.start();
  old.send({ type: 'input', epoch, edit: append() }, { nowMs: 100, draftRevision: 1 });
  assert.equal(old.state.reason, 'draft-revision-gap');
});

test('deadband omits a sub-0.02 change and admits exactly 0.02', () => {
  for (const target of [0.81, 0.82]) {
    const f = fixture(); f.start();
    const nominal = f.state.active!.nominalGraphemesPerSecond;
    const count = Math.ceil(nominal * target);
    const atMs = 1000 * count / (nominal * target);
    assert.ok(atMs >= T.minimumCoverageMs);
    f.input(100, 'x'.repeat(count - 1)); f.input(400, 'x'); f.until(800);
    const d = f.tick(atMs);
    if (target === 0.81) assert.deepEqual(types(d), []);
    else assert.ok(Math.abs(f.env.mediaRate - target) < 1e-9);
  }
});

test('smoothing never catches up an allowed long observation gap', () => {
  const f = fixture(); f.start();
  f.input(100, 'x'.repeat(100)); f.input(400, 'x'.repeat(100)); f.until(800);
  f.input(900, 'x'); f.tick(1000);
  const before = f.env.mediaRate;
  f.tick(1800);
  assert.ok(Math.abs(f.env.mediaRate - before - 0.05) < 1e-9);
});

test('rate-change and restoration intents include expected prior token and native value guards', () => {
  const f = fixture(); f.start();
  f.input(100, 'x'.repeat(100)); f.input(400, 'x'.repeat(100)); f.until(800);
  const previous = f.state.active!.rateWrite;
  const changed = f.tick(1000).intents[0];
  assert.ok(changed.type === 'set-rate');
  assert.equal(changed.onlyIfRateCommandId, previous.commandId);
  assert.equal(changed.onlyIfRateEquals, 0.8);
  const restored = f.send({ type: 'enable', enabled: false }).intents[1];
  assert.ok(restored.type === 'restore-base-rate');
  assert.equal(restored.onlyIfRateCommandId, changed.commandId);
  assert.equal(restored.onlyIfRateEquals, changed.rate);
  assert.equal(restored.rate, 1.25);
});

test('identity capture retains only declared identity primitives, never extra caller data', () => {
  const id = { ...identity(), extraPrivateText: 'SECRET_DRAFT', arbitrary: { nested: 'private' } };
  const f = fixture({ identity: id }); f.start();
  assert.equal(JSON.stringify(f.state).includes('SECRET_DRAFT'), false);
  assert.equal(Object.keys(f.state.active!.scope.identity).length, Object.keys(identity()).length);
  assert.equal(Object.isFrozen(id), false, 'capturing identity must not mutate/freeze caller objects');
});


function cafeIdentity(index = 0): TypingFollowIdentity {
  const cue = CAFE_FIXED_PACE_COURSE.cues[index], course = CAFE_FIXED_PACE_COURSE;
  return { courseId: course.courseId, courseVersion: course.courseVersion,
    mediaId: course.mediaId, mediaSha256: course.mediaSha256,
    sentenceMapVersion: course.sentenceMapVersion, sentenceMapSha256: course.sentenceMapSha256,
    cueId: cue.id, cueStartSeconds: cue.start, cueEndSeconds: cue.end };
}

test('cafe fixed-pace admits verified original course and rejects adaptive Follow', () => {
  const id = cafeIdentity(0);
  const adaptive = fixture({ identity: id, mediaDurationSeconds: CAFE_FIXED_PACE_COURSE.durationSeconds, mediaPositionSeconds: id.cueStartSeconds, pacingStrategy: 'adaptive' });
  assert.deepEqual(types(adaptive.send({ type: 'start', explicitUserGesture: true })), []);
  assert.equal(adaptive.state.reason, 'source-unqualified');
  const fixed = fixture({ identity: id, mediaDurationSeconds: CAFE_FIXED_PACE_COURSE.durationSeconds, mediaPositionSeconds: id.cueStartSeconds, pacingStrategy: 'fixed', fixedRate: 1, mediaRate: 1 });
  fixed.start();
  assert.equal(fixed.state.phase, 'following');
  assert.equal(fixed.state.active?.scope.identity.courseId, CAFE_MATERIAL.id);
  assert.equal(fixed.state.active?.pacingStrategy, 'fixed');
});

test('every registered cafe sentence is admitted under fixed pacing only', () => {
  assert.equal(CAFE_FIXED_PACE_COURSE.cues.length, 12);
  for (let i = 0; i < CAFE_FIXED_PACE_COURSE.cues.length; i++) {
    const id = cafeIdentity(i);
    const f = fixture({ identity: id, mediaDurationSeconds: CAFE_FIXED_PACE_COURSE.durationSeconds, mediaPositionSeconds: id.cueStartSeconds, pacingStrategy: 'fixed', fixedRate: 1, mediaRate: 1 });
    f.start();
    assert.equal(f.state.phase, 'following');
    assert.equal(f.state.active?.scope.identity.cueEndSeconds, CAFE_FIXED_PACE_COURSE.cues[i].end);
  }
});

test('typingFollowCourseIdentity binds NPS builtin and cafe original without inventing foreign courses', () => {
  const npsCue = NPS_MATERIAL.cues[0];
  const nps = typingFollowCourseIdentity(NPS_MATERIAL, npsCue);
  assert.equal(nps?.courseId, NPS_MATERIAL.id);
  assert.equal(nps?.mediaSha256, NPS_MATERIAL.builtinReference.media.sha256);
  const cafeCue = CAFE_MATERIAL.cues[2];
  const cafe = typingFollowCourseIdentity(CAFE_MATERIAL, cafeCue);
  assert.equal(cafe?.courseId, CAFE_MATERIAL.id);
  assert.equal(cafe?.mediaId, CAFE_FIXED_PACE_COURSE.mediaId);
  assert.equal(cafe?.sentenceMapSha256, CAFE_FIXED_PACE_COURSE.sentenceMapSha256);
  assert.equal(typingFollowCourseIdentity({ id: 'foreign', version: 'v1' }, cafeCue), null);
});

test('cafe fixed-pace rejects wrong duration or altered media hash', () => {
  const id = cafeIdentity(1);
  const wrongDuration = fixture({ identity: id, mediaDurationSeconds: 43.366667, mediaPositionSeconds: id.cueStartSeconds, pacingStrategy: 'fixed', fixedRate: 1, mediaRate: 1 });
  assert.deepEqual(types(wrongDuration.send({ type: 'start', explicitUserGesture: true })), []);
  assert.equal(wrongDuration.state.reason, 'invalid-range');
  const forged = { ...id, mediaSha256: '0'.repeat(64) };
  const wrongHash = fixture({ identity: forged, mediaDurationSeconds: CAFE_FIXED_PACE_COURSE.durationSeconds, mediaPositionSeconds: id.cueStartSeconds, pacingStrategy: 'fixed', fixedRate: 1, mediaRate: 1 });
  assert.deepEqual(types(wrongHash.send({ type: 'start', explicitUserGesture: true })), []);
  assert.equal(wrongHash.state.reason, 'source-unqualified');
});
