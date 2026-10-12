import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, DRAFT_VERSION, TIMING_DRAFT_VERSION, DraftError, identifyMedia,
  createSubtitleDraft, createTextTrackDraft, createASRDraft, validateDraft,
  serializeDraft, reopenDraft, editCueText, editCueTiming, undoLastEdit,
  canUndo, canPlayCue, getCueIssues, revalidateDuration, exportVTT, getDraftBudget,
} from '../../public/subtitle-workbench/draft.js';

const copy = value => JSON.parse(JSON.stringify(value));
const code = expected => error => error instanceof DraftError && error.code === expected;
const file = () => new File(['timing editor media'], 'timing.wav', { type: 'audio/wav' });
const measured = (mediaDuration = 10) => ({ mediaDuration, decodedSampleRate: 16000, decodedSampleCount: mediaDuration * 16000 });
const media = async (duration = 10) => identifyMedia(file(), measured(duration));
const srt = (text = 'Hello', start = '00:00:00,000', end = '00:00:01,000', sourceId = 'same') => `${sourceId}\n${start} --> ${end}\n${text}\n`;
const subtitle = async (text = srt()) => createSubtitleDraft({ media: await media(), text, format: 'srt' });
const asr = async (chunks = [{ text: ' Hello', timestamp: [0.1, 0.4] }, { text: ' world.', timestamp: [0.4, 0.8] }]) => createASRDraft({ media: await media(), output: { text: chunks.map(word => word.text).join(''), chunks } });
const current = cue => ({ start: cue.start, end: cue.end, anomalies: cue.anomalies, text: cue.text, alignment: cue.alignment, revision: cue.revision });
const frozen = value => {
  if (value && typeof value === 'object') {
    assert.ok(Object.isFrozen(value));
    Object.values(value).forEach(frozen);
  }
};

test('v1 creation, reopen, text edits, and undo retain their exact legacy schema', async () => {
  const original = await asr(), cueId = original.candidates[0].id;
  const edited = editCueText(original, cueId, 'Manual words');
  const undone = undoLastEdit(edited);
  for (const value of [original, edited, undone]) {
    assert.equal(value.version, DRAFT_VERSION);
    assert.equal(Object.hasOwn(value, 'legacyEdits'), false);
    for (const edit of value.edits) {
      assert.deepEqual(Object.keys(edit.old).sort(), ['alignment', 'revision', 'text']);
      assert.equal(Object.hasOwn(edit, 'mediaDuration'), false);
    }
    assert.deepEqual(await reopenDraft(serializeDraft(value), file(), measured()), value);
  }
});

test('first real timing edit explicitly promotes v1 with deterministic full legacy snapshots', async () => {
  let original = await asr(); const cueId = original.candidates[0].id;
  original = editCueText(original, cueId, 'First revision');
  original = editCueText(original, cueId, 'Second revision');
  original = undoLastEdit(original);
  const before = serializeDraft(original), edited = editCueTiming(original, cueId, { start: 0, end: 1 });
  assert.equal(edited.version, TIMING_DRAFT_VERSION);
  assert.deepEqual(edited.legacyEdits, original.edits);
  assert.equal(edited.edits.length, original.edits.length + 1);
  original.edits.forEach((edit, index) => {
    const expanded = edited.edits[index];
    assert.equal(expanded.id, edit.id); assert.equal(expanded.kind, edit.kind);
    assert.equal(expanded.undoOf, edit.undoOf); assert.equal(expanded.mediaDuration, null);
    assert.deepEqual(expanded.old, { start: 0.1, end: 0.8, anomalies: { start: null, end: null }, ...edit.old });
    assert.deepEqual(expanded.new, { start: 0.1, end: 0.8, anomalies: { start: null, end: null }, ...edit.new });
  });
  assert.deepEqual(edited.edits.at(-1).old, current(original.candidates[0]));
  assert.deepEqual(edited.edits.at(-1).new, current(edited.candidates[0]));
  assert.equal(edited.edits.at(-1).mediaDuration, 10);
  assert.equal(edited.candidates[0].revision, 3);
  assert.equal(edited.candidates[0].alignment, 'stale');
  assert.equal(serializeDraft(original), before);
  for (const field of ['source', 'raw', 'run']) assert.deepEqual(edited[field], original[field]);
  frozen(edited); frozen(original);
  assert.deepEqual(editCueTiming(original, cueId, { start: 0, end: 1 }), edited);
  assert.deepEqual(await reopenDraft(serializeDraft(edited), file(), measured()), edited);
});

test('no-op timing preserves exact object/version/history and failed input is atomic', async () => {
  const original = await subtitle(), cueId = original.candidates[0].id;
  assert.equal(editCueTiming(original, cueId, { start: 0, end: 1 }), original);
  const edited = editCueTiming(original, cueId, { start: 0, end: 2 });
  assert.equal(editCueTiming(edited, cueId, { start: 0, end: 2 }), edited);
  for (const range of [
    { start: '', end: 1 }, { start: '0', end: 1 }, { start: null, end: 1 },
    { start: undefined, end: 1 }, { start: NaN, end: 1 }, { start: 0, end: Infinity },
    { start: -Infinity, end: 1 }, { start: -0, end: 1 }, { start: -0.001, end: 1 },
    { start: 1, end: 1 }, { start: 2, end: 1 }, { start: 0, end: 10.001 },
    { start: 10, end: 10.001 }, { start: 0, end: -1 }, { start: 0 },
    { start: 0, end: 1, suppliedAlignment: 'valid' }, null,
  ]) assert.throws(() => editCueTiming(original, cueId, range), DraftError);
  let getterReads = 0;
  const getter = { get start() { getterReads++; return 0; }, end: 1 };
  assert.throws(() => editCueTiming(original, cueId, getter), code('schema'));
  assert.equal(getterReads, 0);
  assert.throws(() => editCueTiming(original, 'missing', { start: 0, end: 1 }), code('cue'));
  assert.equal(original.version, DRAFT_VERSION); assert.equal(original.edits.length, 0);
  assert.equal(validateDraft(original), original);
});

test('valid boundaries include zero, current media end, and one millisecond without clipping', async () => {
  const original = await subtitle(), cueId = original.candidates[0].id;
  for (const range of [{ start: 0, end: 10 }, { start: 0, end: 0.001 }, { start: 9.999, end: 10 }]) {
    const edited = editCueTiming(original, cueId, range);
    assert.deepEqual([edited.candidates[0].start, edited.candidates[0].end], [range.start, range.end]);
    assert.equal(canPlayCue(edited, cueId), true); assert.ok(exportVTT(edited));
  }
  const tiny = editCueTiming(original, cueId, { start: 0, end: 0.0001 });
  assert.equal(canPlayCue(tiny, cueId), true);
  assert.throws(() => exportVTT(tiny), error => error.code === 'invalid-cues' && error.details[0].issues.includes('vtt-millisecond-precision'));
});

test('mixed text/timing/undo preserves global order, exact restoration, and monotonic branch revisions', async () => {
  const original = await subtitle(srt('one') + '\n' + srt('two', '00:00:02,000', '00:00:03,000'));
  const [a, b] = original.candidates.map(cue => cue.id);
  let value = editCueText(original, a, 'ONE');
  value = editCueTiming(value, b, { start: 1.5, end: 3.5 });
  value = editCueText(value, b, 'TWO');
  value = editCueTiming(value, a, { start: 0.001, end: 1.1 });
  assert.deepEqual(value.edits.map(edit => edit.kind), ['text', 'timing', 'text', 'timing']);
  const saved = serializeDraft(value);
  value = await reopenDraft(saved, file(), measured());
  value = undoLastEdit(value);
  assert.deepEqual(current(value.candidates[0]), current(editCueText(original, a, 'ONE').candidates[0]));
  value = undoLastEdit(value);
  assert.equal(value.candidates[1].text, 'two'); assert.equal(value.candidates[1].start, 1.5);
  value = undoLastEdit(value);
  assert.deepEqual(current(value.candidates[1]), current(original.candidates[1]));
  value = undoLastEdit(value);
  assert.deepEqual(value.candidates.map(current), original.candidates.map(current));
  assert.equal(value.edits.length, 8); assert.equal(canUndo(value), false);
  assert.throws(() => undoLastEdit(value), code('no-undo'));
  const branched = editCueTiming(value, b, { start: 2.001, end: 3 });
  assert.equal(branched.candidates[1].revision, 3);
  assert.deepEqual(branched.edits.slice(0, value.edits.length), value.edits);
  assert.deepEqual(branched.legacyEdits, value.legacyEdits);
  assert.equal(branched.edits.at(-1).id, 'edit-000009');
  const textBranch = editCueText(branched, a, 'New branch');
  assert.equal(textBranch.candidates[0].revision, 3);
  assert.deepEqual(await reopenDraft(serializeDraft(textBranch), file(), measured()), textBranch);
});

test('timing edits always stale alignment without manufacturing or shifting word timestamps', async () => {
  const original = await asr(), cueId = original.candidates[0].id;
  assert.equal(original.candidates[0].alignment, 'valid');
  const wider = editCueTiming(original, cueId, { start: 0, end: 1 });
  assert.equal(wider.candidates[0].alignment, 'stale');
  const typedOriginal = editCueTiming(wider, cueId, { start: 0.1, end: 0.8 });
  assert.equal(typedOriginal.candidates[0].alignment, 'stale');
  for (const value of [wider, typedOriginal]) {
    assert.deepEqual(value.raw, original.raw); assert.deepEqual(value.run, original.run);
    assert.deepEqual(value.candidates[0].rawWordIds, original.candidates[0].rawWordIds);
    assert.equal(value.candidates[0].reviewStatus, 'needs-review');
  }
  const onceUndone = undoLastEdit(typedOriginal); assert.equal(onceUndone.candidates[0].alignment, 'stale');
  const restored = undoLastEdit(onceUndone);
  assert.deepEqual(current(restored.candidates[0]), current(original.candidates[0]));
  assert.equal(restored.candidates[0].alignment, 'valid');
});

test('malformed raw source can be repaired per cue; unrelated upgrades and undo cannot bypass blockers', async () => {
  const original = await subtitle('missing timing entirely\n\n' + srt('valid', '00:00:02,000', '00:00:03,000') + '\n' + srt('invalid token', 'broken', '00:00:04,000'));
  const [bad, valid, token] = original.candidates.map(cue => cue.id);
  const upgraded = editCueTiming(original, valid, { start: 2, end: 3.5 });
  for (const cueId of [bad, token]) {
    assert.equal(canPlayCue(upgraded, cueId), false);
    assert.ok(getCueIssues(upgraded, cueId).includes('raw-invalid-syntax'));
    assert.ok(getCueIssues(upgraded, cueId).includes('invalid-syntax'));
  }
  assert.throws(() => exportVTT(upgraded), code('invalid-cues'));
  const repairedOne = editCueTiming(upgraded, bad, { start: 0, end: 1 });
  assert.equal(canPlayCue(repairedOne, bad), true);
  assert.ok(getCueIssues(repairedOne, bad).includes('raw-invalid-syntax'));
  assert.ok(!getCueIssues(repairedOne, bad).includes('invalid-syntax'));
  assert.throws(() => exportVTT(repairedOne), error => error.code === 'invalid-cues' && error.details.length === 1 && error.details[0].id === token);
  const repairedBoth = editCueTiming(repairedOne, token, { start: 3.5, end: 4 });
  assert.ok(exportVTT(repairedBoth));
  for (const value of [upgraded, repairedOne, repairedBoth]) {
    assert.deepEqual(value.raw, original.raw); assert.deepEqual(value.source, original.source);
    assert.ok(value.candidates.every(cue => cue.alignment !== 'valid'));
  }
  const undone = undoLastEdit(repairedBoth);
  assert.deepEqual(current(undone.candidates[2]), current(original.candidates[2]));
  assert.equal(canPlayCue(undone, token), false);
  assert.deepEqual(await reopenDraft(serializeDraft(repairedBoth), file(), measured()), repairedBoth);
});

test('ASR and native-track anomaly repairs retain original evidence and undo exact anomalies', async () => {
  const native = await createTextTrackDraft({ media: await media(), track: { id: '', label: '', language: 'en', kind: 'captions' }, cues: [{ id: 'a', text: 'broken', start: NaN, end: null }] });
  for (const original of [await asr([{ text: ' broken', timestamp: [null, Infinity] }]), await asr([{ text: ' reversed', timestamp: [2, -1] }]), native]) {
    const cueId = original.candidates[0].id;
    const repaired = editCueTiming(original, cueId, { start: 0, end: 1 });
    assert.equal(canPlayCue(repaired, cueId), true); assert.ok(exportVTT(repaired));
    assert.deepEqual(repaired.raw, original.raw); assert.deepEqual(repaired.source, original.source);
    assert.deepEqual(repaired.candidates[0].anomalies, { start: null, end: null });
    assert.equal(repaired.candidates[0].alignment, 'stale');
    const restored = undoLastEdit(repaired);
    assert.deepEqual(current(restored.candidates[0]), current(original.candidates[0]));
    assert.equal(canPlayCue(restored, cueId), false);
    assert.equal(restored.candidates[0].alignment, 'unavailable');
  }
});

test('legal overlap does not clip neighbors or reorder stable source identities', async () => {
  const original = await subtitle(srt('first', '00:00:02,000', '00:00:04,000') + '\n' + srt('second', '00:00:05,000', '00:00:06,000'));
  const edited = editCueTiming(original, original.candidates[1].id, { start: 1, end: 3 });
  assert.deepEqual(edited.candidates.map(cue => [cue.id, cue.sourceRawCueId, cue.sourceCueId, cue.sourceOrder]), original.candidates.map(cue => [cue.id, cue.sourceRawCueId, cue.sourceCueId, cue.sourceOrder]));
  assert.deepEqual(current(edited.candidates[0]), current(original.candidates[0]));
  assert.ok(edited.candidates.every(cue => cue.flags.includes('overlap') && canPlayCue(edited, cue.id)));
  assert.ok(edited.candidates[1].flags.includes('out-of-order'));
  const vtt = exportVTT(edited);
  assert.ok(vtt.indexOf('draft-cue-000002') < vtt.indexOf('draft-cue-000001'));
  assert.ok(vtt.includes('00:00:01.000 --> 00:00:03.000'));
  assert.ok(vtt.includes('00:00:02.000 --> 00:00:04.000'));
});

test('fresh duration measurement changes current risk without invalidating valid historical timing', async () => {
  const original = await asr(), cueId = original.candidates[0].id;
  const edited = editCueTiming(original, cueId, { start: 8, end: 10 });
  const shorter = await reopenDraft(serializeDraft(edited), file(), { mediaDuration: 9 });
  assert.equal(shorter.source.mediaDuration, 9); assert.equal(shorter.source.originalMediaDuration, 10);
  assert.deepEqual(shorter.edits, edited.edits); assert.deepEqual(shorter.legacyEdits, edited.legacyEdits);
  assert.deepEqual(shorter.raw, original.raw);
  assert.ok(getCueIssues(shorter, cueId).includes('out-of-bounds'));
  assert.equal(canPlayCue(shorter, cueId), false); assert.throws(() => exportVTT(shorter), code('invalid-cues'));
  assert.ok(serializeDraft(shorter));
  assert.throws(() => editCueTiming(shorter, cueId, { start: 8, end: 9.001 }), DraftError);
  const repaired = editCueTiming(shorter, cueId, { start: 8, end: 9 });
  assert.equal(repaired.edits.at(-1).mediaDuration, 9); assert.ok(exportVTT(repaired));
  const undone = undoLastEdit(repaired);
  assert.deepEqual(current(undone.candidates[0]), current(edited.candidates[0]));
  assert.equal(canPlayCue(undone, cueId), false);
  const longer = revalidateDuration(undone, measured(10));
  assert.equal(canPlayCue(longer, cueId), true); assert.ok(exportVTT(longer));
  assert.deepEqual(longer.edits, undone.edits);
});

test('closed v2 schema replays every editable field and rejects forged history/provenance', async () => {
  const source = await asr(), cueId = source.candidates[0].id;
  const legacy = editCueText(source, cueId, 'Legacy text');
  const edited = editCueTiming(legacy, cueId, { start: 0, end: 2 });
  const mutations = [
    value => { value.version = DRAFT_VERSION; }, value => { delete value.legacyEdits; },
    value => { value.legacyEdits[0].new.text = 'changed legacy'; },
    value => { value.edits[0].old.start = 0; }, value => { value.edits[0].new.end = 1; },
    value => { value.edits[0].mediaDuration = 10; },
    value => { value.edits[1].old.end = 1; }, value => { value.edits[1].new.end = 3; },
    value => { value.edits[1].new.text = 'Timing smuggled text'; },
    value => { value.edits[1].new.alignment = 'valid'; value.candidates[0].alignment = 'valid'; },
    value => { value.edits[1].new.revision = 1; value.candidates[0].revision = 1; },
    value => { value.edits[1].mediaDuration = 1; }, value => { value.edits[1].mediaDuration = 61; },
    value => { value.edits[1].mediaDuration = null; }, value => { value.edits[1].undoOf = 'edit-000001'; },
    value => { value.edits[1].id = 'edit-000001'; }, value => { value.edits[1].cueId = 'missing'; },
    value => { value.edits[1].alignment = 'valid'; },
    value => { value.candidates[0].start = 0.01; }, value => { value.candidates[0].end = 3; },
    value => { value.candidates[0].anomalies.start = { type: 'null', value: 'null', reason: 'missing' }; },
    value => { value.candidates[0].sourceOrder = 1; }, value => { value.candidates[0].rawWordIds = []; },
    value => { value.candidates[0].reviewStatus = 'reviewed'; }, value => { value.candidates[0].flags = ['verified']; },
    value => { value.run.extra = true; }, value => { value.extra = true; },
  ];
  for (const mutation of mutations) { const bad = copy(edited); mutation(bad); assert.throws(() => validateDraft(bad), DraftError); }
  const retimedText = copy(editCueText(edited, cueId, 'New text'));
  retimedText.edits.at(-1).new.start = 0.01; retimedText.candidates[0].start = 0.01;
  assert.throws(() => validateDraft(retimedText), code('schema'));
  const fakeUndo = copy(undoLastEdit(edited));
  fakeUndo.edits.at(-1).new.end = 1; fakeUndo.candidates[0].end = 1;
  assert.throws(() => validateDraft(fakeUndo), code('schema'));
  const noTiming = copy(legacy); noTiming.version = TIMING_DRAFT_VERSION; noTiming.legacyEdits = copy(legacy.edits);
  assert.throws(() => validateDraft(noTiming), code('schema'));
  const noChange = copy(editCueTiming(source, cueId, { start: 0, end: 2 }));
  Object.assign(noChange.edits[0].new, { start: 0.1, end: 0.8 });
  Object.assign(noChange.candidates[0], { start: 0.1, end: 0.8 });
  assert.throws(() => validateDraft(noChange), code('schema'));
});

test('v2 duplicate fields and malformed history reject before media bytes are read', async () => {
  const original = await subtitle(), edited = editCueTiming(original, original.candidates[0].id, { start: 0, end: 2 });
  let reads = 0; const spy = { size: file().size, arrayBuffer() { reads++; return file().arrayBuffer(); } };
  const serialized = serializeDraft(edited);
  await assert.rejects(reopenDraft(serialized.replace('"legacyEdits":', '"legacyEdits":[],"legacyEdits":'), spy, measured()), code('schema'));
  const forged = copy(edited); forged.edits[0].new.alignment = 'valid';
  await assert.rejects(reopenDraft(JSON.stringify(forged), spy, measured()), code('schema'));
  assert.equal(reads, 0);
  await assert.rejects(reopenDraft(serialized, new File(['wrong'], 'timing.wav'), measured()), code('media-identity'));
  const renamed = await reopenDraft(serialized, new File(['timing editor media'], 'renamed.mp4'), measured());
  assert.deepEqual(renamed, edited);
});

test('v2 histories and preserved v1 edits count toward text/JSON budget atomically', async () => {
  const source = Array.from({ length: 15 }, (_, index) => srt('x'.repeat(15000), '00:00:00,000', '00:00:01,000', String(index))).join('\n');
  let legacy = await subtitle(source), accepted = 0;
  while (accepted < 10) {
    try { legacy = editCueText(legacy, legacy.candidates[0].id, String(accepted).repeat(15000)); accepted++; }
    catch (error) { assert.equal(error.code, 'limit'); break; }
  }
  assert.ok(accepted > 0 && accepted < 10);
  const preserved = serializeDraft(legacy);
  assert.throws(() => editCueTiming(legacy, legacy.candidates[0].id, { start: 0, end: 2 }), code('limit'));
  assert.equal(serializeDraft(legacy), preserved); assert.equal(legacy.version, DRAFT_VERSION);
  let value = await subtitle(srt('a'.repeat(16000)));
  value = editCueTiming(value, value.candidates[0].id, { start: 0, end: 2 });
  let failed = false;
  for (let index = 0; index < 50; index++) {
    const prior = value;
    try { value = editCueTiming(value, value.candidates[0].id, { start: 0, end: index % 2 ? 2 : 3 }); }
    catch (error) { assert.equal(error.code, 'limit'); assert.equal(value, prior); failed = true; break; }
  }
  assert.equal(failed, true);
  const budget = getDraftBudget(value);
  assert.ok(budget.textUnits + budget.reservedTextUnits <= LIMITS.totalTextUnits);
  assert.ok(budget.jsonBytes + budget.reservedJSONBytes <= LIMITS.jsonBytes);
  assert.deepEqual(await reopenDraft(serializeDraft(value), file(), measured()), value);
  const smaller = await reopenDraft(serializeDraft(value), file(), { mediaDuration: 0.5 });
  assert.deepEqual(smaller.edits, value.edits);
  const smallerBudget = getDraftBudget(smaller);
  assert.equal(smallerBudget.textUnits + smallerBudget.reservedTextUnits, budget.textUnits + budget.reservedTextUnits);
  assert.equal(smallerBudget.jsonBytes + smallerBudget.reservedJSONBytes, budget.jsonBytes + budget.reservedJSONBytes);
});

test('v2 permits all 2,000 edits and refuses timing, text, and undo 2,001 without truncation', async () => {
  const original = await subtitle();
  const full = copy(editCueTiming(original, original.candidates[0].id, { start: 0, end: 2 }));
  const cue = full.candidates[0]; let before = current(cue);
  for (let index = 2; index <= LIMITS.edits; index++) {
    const after = { ...copy(before), end: index % 2 ? 2 : 3, revision: index };
    full.edits.push({ id: `edit-${String(index).padStart(6, '0')}`, cueId: cue.id, kind: 'timing', old: before, new: after, undoOf: null, mediaDuration: 10 });
    before = after;
  }
  Object.assign(cue, before); validateDraft(full);
  assert.equal(full.edits.length, LIMITS.edits);
  assert.throws(() => editCueTiming(full, cue.id, { start: 1, end: 2 }), code('limit'));
  assert.throws(() => editCueText(full, cue.id, 'another'), code('limit'));
  assert.throws(() => undoLastEdit(full), code('limit'));
  assert.equal(editCueTiming(full, cue.id, { start: cue.start, end: cue.end }), full);
  assert.deepEqual(await reopenDraft(serializeDraft(full), file(), measured()), full);
});

test('repaired source bounds retain original evidence separately from fresh raw bounds', async () => {
  const original = await createSubtitleDraft({ media: await media(5), text: srt('originally too long', '00:00:00,000', '00:00:07,000'), format: 'srt' });
  const cueId = original.candidates[0].id;
  assert.ok(getCueIssues(original, cueId).includes('out-of-bounds'));
  const repaired = editCueTiming(original, cueId, { start: 0, end: 4 });
  for (const flag of ['raw-out-of-bounds', 'raw-original-out-of-bounds']) assert.ok(getCueIssues(repaired, cueId).includes(flag));
  assert.ok(!getCueIssues(repaired, cueId).includes('out-of-bounds'));
  assert.equal(canPlayCue(repaired, cueId), true); assert.ok(exportVTT(repaired));
  assert.deepEqual(repaired.source, original.source); assert.deepEqual(repaired.raw, original.raw);
  const longer = revalidateDuration(repaired, measured(8));
  assert.ok(!getCueIssues(longer, cueId).includes('raw-out-of-bounds'));
  assert.ok(getCueIssues(longer, cueId).includes('raw-original-out-of-bounds'));
  assert.equal(canPlayCue(longer, cueId), true); assert.ok(exportVTT(longer));
  const shorter = await reopenDraft(serializeDraft(longer), file(), { mediaDuration: 3 });
  for (const flag of ['raw-out-of-bounds', 'raw-original-out-of-bounds', 'out-of-bounds']) assert.ok(getCueIssues(shorter, cueId).includes(flag));
  assert.equal(canPlayCue(shorter, cueId), false);
  assert.deepEqual(shorter.edits, longer.edits);
  const budgets = [repaired, longer, shorter].map(getDraftBudget);
  assert.equal(new Set(budgets.map(value => value.textUnits + value.reservedTextUnits)).size, 1);
  assert.equal(new Set(budgets.map(value => value.jsonBytes + value.reservedJSONBytes)).size, 1);
  const originallyValid = await subtitle();
  const v2 = editCueTiming(originallyValid, originallyValid.candidates[0].id, { start: 0, end: 2 });
  const newMeasurement = revalidateDuration(v2, { mediaDuration: 0.5 });
  assert.ok(getCueIssues(newMeasurement, originallyValid.candidates[0].id).includes('raw-out-of-bounds'));
  assert.ok(!getCueIssues(newMeasurement, originallyValid.candidates[0].id).includes('raw-original-out-of-bounds'));
});
