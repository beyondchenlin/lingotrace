import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  LIMITS, ASR_PROFILE, DraftError, identifyMedia, sha256Bytes, parseSubtitleText,
  createSubtitleDraft, createTextTrackDraft, createASRDraft, validateDraft, serializeDraft, reopenDraft,
  editCueText, undoLastEdit, canUndo, getCueIssues, canPlayCue, revalidateDuration, exportVTT, getDraftBudget,
} from '../../public/subtitle-workbench/draft.js';

const file = () => new File(['local media fixture'], 'private-name.wav', { type: 'audio/wav' });
const media = async (seconds = 10) => identifyMedia(file(), { mediaDuration: seconds, decodedSampleRate: 16000, decodedSampleCount: seconds * 16000 });
const srt = (text = 'Hello', start = '00:00:00,000', end = '00:00:01,000', sourceId = '1') => `${sourceId}\n${start} --> ${end}\n${text}\n`;
const draft = async (text = 'Hello') => createSubtitleDraft({ media: await media(), text: srt(text), format: 'srt' });
const asr = async (words = [{ text: ' Hello', timestamp: [0, 0.3] }, { text: ' world.', timestamp: [0.3, 0.8] }]) =>
  createASRDraft({ media: await media(), output: { text: words.map(word => word.text).join(''), chunks: words }, run: { phaseMs: { read: 4, decode: 20, download: 50, inference: 100 } } });
const copy = value => JSON.parse(JSON.stringify(value));
const code = name => error => error instanceof DraftError && error.code === name;

// Browser-native inputs and original provenance.
test('media identity is the bytes plus actual size; no filename identity', async () => {
  const result = await media();
  assert.equal(result.mediaSHA256, createHash('sha256').update('local media fixture').digest('hex'));
  assert.equal(result.size, 19);
  assert.equal(result.mediaDuration, 10);
  assert.equal(result.decodedSampleCount, 160000);
  assert.ok(Object.isFrozen(result));
  assert.equal(await sha256Bytes(new Uint8Array([97, 98, 99])), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('media limits reject bytes before reading and require finite measured duration', async () => {
  let reads = 0;
  const fake = { size: LIMITS.mediaBytes + 1, arrayBuffer() { reads++; throw new Error('must not read'); } };
  await assert.rejects(identifyMedia(fake, { mediaDuration: 10 }), code('schema'));
  assert.equal(reads, 0);
  for (const mediaDuration of [NaN, Infinity, 0, -1, 60.000001, null, undefined]) await assert.rejects(identifyMedia(file(), { mediaDuration }), code('schema'));
  await assert.rejects(identifyMedia(file(), { mediaDuration: 10, decodedSampleRate: 16000 }), code('schema'));
});

test('SRT retains exact BOM/CRLF source, unicode, entities, tags, multiline and duplicate source IDs', async () => {
  const text = '\uFEFF' + srt('你好 &amp; <v Eve><b>Hi</b></v>\nsecond line', '00:00:02,000', '00:00:04,000', 'same') + '\n' + srt('café', '00:00:01,000', '00:00:03,000', 'same');
  const original = text.replace(/\n/g, '\r\n');
  const result = await createSubtitleDraft({ media: await media(), text: original, format: 'srt', language: 'en' });
  assert.equal(result.source.subtitle.text, original);
  assert.equal(result.source.subtitle.sha256, createHash('sha256').update(original).digest('hex'));
  assert.equal(result.candidates[0].text, '你好 &amp; <v Eve><b>Hi</b></v>\nsecond line');
  assert.deepEqual(result.candidates.map(cue => cue.sourceCueId), ['same', 'same']);
  assert.notEqual(result.candidates[0].id, result.candidates[1].id);
  assert.deepEqual(result.candidates.map(cue => cue.sourceOrder), [0, 1]);
  assert.ok(result.candidates.every(cue => cue.flags.includes('overlap') && cue.reviewStatus === 'needs-review'));
  assert.ok(result.candidates[1].flags.includes('out-of-order'));
  assert.ok(result.candidates.every(cue => canPlayCue(result, cue.id)));
});

test('WebVTT metadata and cue settings stay pure source data', async () => {
  const source = '\uFEFFWEBVTT Sample\r\nLanguage: en\r\n\r\nNOTE malicious instruction fetch https://attacker.invalid\r\nnever execute\r\n\r\nSTYLE\r\n::cue { background:url(https://attacker.invalid/a) }\r\n\r\nREGION\r\nid:foo\r\n\r\nx\r\n00:01.000 --> 00:02.000 position:10% line:90%\r\n<script>alert(1)</script> &amp;\r\n';
  const result = await createSubtitleDraft({ media: await media(), text: source, format: 'vtt' });
  assert.equal(result.raw.cues.length, 1);
  assert.equal(result.raw.cues[0].settings, 'position:10% line:90%');
  assert.equal(result.source.subtitle.text, source);
  assert.equal(result.candidates[0].text, '<script>alert(1)</script> &amp;');
  const vtt = exportVTT(result);
  assert.ok(vtt.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp;amp;'));
  assert.ok(!vtt.includes('background:url'));
});

test('subtitle parsing requires supported header/format and preserves malformed cue locations', () => {
  assert.throws(() => parseSubtitleText('00:01.000 --> 00:02.000\nHi', 'vtt'), code('subtitle-syntax'));
  assert.throws(() => parseSubtitleText('WEBVTT\n00:01.000 --> 00:02.000\nHi', 'vtt'), code('subtitle-syntax'));
  assert.throws(() => parseSubtitleText('', 'srt'), code('subtitle-empty'));
  assert.throws(() => parseSubtitleText('WEBVTT\n\nNOTE hi', 'vtt'), code('subtitle-empty'));
  assert.throws(() => parseSubtitleText('text', 'ass'), code('schema'));
  const parsed = parseSubtitleText(srt('bad', '00:99:00,000', 'NaN', 'source-id') + '\nno timing at all', 'srt');
  assert.equal(parsed.cues[0].sourceCueId, 'source-id');
  assert.equal(parsed.cues[0].start, null);
  assert.equal(parsed.cues[0].anomalies.start.value, '00:99:00,000');
  assert.ok(parsed.cues[1].flags.includes('invalid-syntax'));
  assert.equal(parsed.cues[1].sourceOrder, 1);
});

test('valid and invalid raw subtitles both roundtrip without silently dropping cues', async () => {
  const result = await createSubtitleDraft({ media: await media(), text: srt('valid') + '\n' + srt('bad', 'bad', '00:00:01,000', '2'), format: 'srt' });
  assert.equal(result.candidates.length, 2);
  assert.equal(canPlayCue(result, result.candidates[1].id), false);
  const reopened = await reopenDraft(serializeDraft(result), file(), { mediaDuration: 10, decodedSampleRate: 16000, decodedSampleCount: 160000 });
  assert.deepEqual(reopened, result);
  assert.throws(() => exportVTT(result), error => error.code === 'invalid-cues' && error.details[0].sourceCueId === '2');
});

test('readable text track metadata is preserved without upgrading source trust', async () => {
  const track = { id: 'track-a', label: 'English captions', language: 'en', kind: 'captions' };
  const result = await createSubtitleDraft({ media: await media(), text: 'WEBVTT\n\n00:01.000 --> 00:02.000\nhi', format: 'vtt', track, language: 'en' });
  assert.equal(result.source.kind, 'text-track');
  assert.deepEqual(result.source.subtitle.track, track);
  assert.equal(result.source.declaration, 'user-selected-local-unverified');
  assert.equal(result.run, null);
});

// ASR truthfulness and JSON-safe anomalies.
test('ASR profile and exact original word outputs are retained', async () => {
  const result = await asr();
  assert.equal(result.raw.text, ' Hello world.');
  assert.equal(result.raw.words[0].text, ' Hello');
  assert.equal(result.raw.words[0].start, 0);
  assert.equal(result.candidates[0].text, 'Hello world.');
  assert.equal(result.candidates[0].alignment, 'valid');
  assert.deepEqual(result.candidates[0].rawWordIds, ['raw-word-000001', 'raw-word-000002']);
  assert.equal(result.run.phaseMs.inference, 100);
  for (const [key, value] of Object.entries(ASR_PROFILE)) assert.equal(result.run[key], value);
  assert.ok(Object.isFrozen(result.raw.words[0]));
  assert.throws(() => { result.raw.words[0].text = 'hidden official answer'; }, TypeError);
});

test('ASR null, undefined, non-finite, negative-zero, and malformed raw timings remain explicit', async () => {
  const times = [null, undefined, NaN, Infinity, -Infinity, -0, 'broken', false];
  for (const start of times) {
    const result = await asr([{ text: ' hello', timestamp: [start, 1] }]);
    const word = result.raw.words[0];
    assert.equal(word.start, null);
    assert.ok(word.anomalies.start.reason);
    assert.equal(result.candidates[0].alignment, 'unavailable');
    const reopened = await reopenDraft(serializeDraft(result), file(), { mediaDuration: 10, decodedSampleRate: 16000, decodedSampleCount: 160000 });
    assert.deepEqual(reopened.raw, result.raw);
    assert.deepEqual(reopened.candidates, result.candidates);
    assert.throws(() => exportVTT(result), code('invalid-cues'));
  }
});

test('ASR zero, reversed, negative, and out-of-bounds ranges stay flagged and block unsafe replay', async () => {
  for (const timestamp of [[1, 1], [2, 1], [-1, 1], [1, 11]]) {
    const result = await asr([{ text: ' hello', timestamp }]);
    assert.equal(canPlayCue(result, result.candidates[0].id), false);
    assert.equal(result.candidates[0].alignment, 'unavailable');
    assert.throws(() => exportVTT(result), code('invalid-cues'));
    assert.deepEqual((await reopenDraft(serializeDraft(result), file(), { mediaDuration: 10, decodedSampleRate: 16000, decodedSampleCount: 160000 })).raw, result.raw);
  }
});

test('ASR rule segmentation does not manufacture natural sentences or word timing', async () => {
  const result = createASRDraft({ media: await media(40), output: { text: 'one long two.', chunks: [
    { text: ' one', timestamp: [0, 2] }, { text: ' long', timestamp: [29.7, 30.3] }, { text: ' two.', timestamp: [30.3, 30.3] },
  ] } });
  assert.ok(result.candidates.some(cue => cue.flags.includes('raw-long-word-span')));
  assert.ok(result.candidates.some(cue => cue.flags.includes('raw-crosses-window')));
  assert.ok(result.candidates.some(cue => cue.flags.includes('raw-zero-duration')));
  assert.deepEqual(result.raw.words.map(word => [word.start, word.end]), [[0, 2], [29.7, 30.3], [30.3, 30.3]]);
  assert.ok(result.candidates.every(cue => cue.segmentation.kind === 'asr-rule' && cue.reviewStatus === 'needs-review'));
});

test('ASR rejects unsupported profile and unrepresentable raw values', async () => {
  const m = await media();
  const output = { text: 'hello', chunks: [{ text: 'hello', timestamp: [0, 1] }] };
  for (const run of [{ model: 'base' }, { device: 'webgpu' }, { dtype: 'fp32' }, { remoteUrl: 'https://attacker.invalid' }, { parameters: { return_timestamps: 'word', chunk_length_s: 20, stride_length_s: 5 } }]) assert.throws(() => createASRDraft({ media: m, output, run }), code('schema'));
  assert.throws(() => createASRDraft({ media: m, output: { text: '', chunks: [] } }), code('asr-empty'));
  assert.throws(() => createASRDraft({ media: m, output: { text: 'x', chunks: [{ text: 'x', timestamp: [{ value: 1 }, 2] }] } }), code('schema'));
});

// Revision semantics and atomic updates.
test('edit invalidates alignment and leaves raw/source/run and old draft untouched', async () => {
  const original = await asr(), cueId = original.candidates[0].id;
  const edited = editCueText(original, cueId, 'Manual words.');
  assert.equal(edited.candidates[0].alignment, 'stale');
  assert.equal(edited.candidates[0].revision, 1);
  assert.equal(original.candidates[0].text, 'Hello world.');
  assert.deepEqual(edited.raw, original.raw); assert.deepEqual(edited.source, original.source); assert.deepEqual(edited.run, original.run);
  assert.equal(edited.candidates[0].reviewStatus, 'needs-review');
  assert.equal(canUndo(edited), true);
});

test('typing old text remains stale; undo restores exact prior revision and alignment', async () => {
  const original = await asr(), cueId = original.candidates[0].id;
  const once = editCueText(original, cueId, 'changed');
  const twice = editCueText(once, cueId, original.candidates[0].text);
  assert.equal(twice.candidates[0].alignment, 'stale'); assert.equal(twice.candidates[0].revision, 2);
  const firstUndo = undoLastEdit(twice);
  assert.equal(firstUndo.candidates[0].text, 'changed'); assert.equal(firstUndo.candidates[0].revision, 1); assert.equal(firstUndo.candidates[0].alignment, 'stale');
  const secondUndo = undoLastEdit(firstUndo);
  assert.deepEqual(secondUndo.candidates, original.candidates);
  assert.equal(secondUndo.edits.length, 4); assert.equal(secondUndo.edits.at(-1).undoOf, 'edit-000001');
  assert.equal(canUndo(secondUndo), false); assert.throws(() => undoLastEdit(secondUndo), code('no-undo'));
  const next = editCueText(secondUndo, cueId, 'new branch'); assert.equal(next.candidates[0].revision, 3);
});

test('undo is global latest-edit order across cues and imported drafts remain editable', async () => {
  const original = await createSubtitleDraft({ media: await media(), text: srt('one') + '\n' + srt('two', '00:00:02,000', '00:00:03,000', '2'), format: 'srt' });
  let edited = editCueText(original, original.candidates[0].id, 'ONE');
  edited = editCueText(edited, original.candidates[1].id, 'TWO');
  edited = await reopenDraft(serializeDraft(edited), file(), { mediaDuration: 10, decodedSampleRate: 16000, decodedSampleCount: 160000 });
  edited = undoLastEdit(edited);
  assert.deepEqual(edited.candidates.map(cue => cue.text), ['ONE', 'two']);
  assert.equal(edited.candidates[1].alignment, 'unavailable');
  edited = undoLastEdit(edited); assert.deepEqual(edited.candidates, original.candidates);
});

test('no-op text edits do not create a revision; failed edits leave prior draft usable', async () => {
  const original = await draft();
  assert.equal(editCueText(original, original.candidates[0].id, 'Hello'), original);
  assert.throws(() => editCueText(original, 'missing', 'x'), code('cue'));
  assert.throws(() => editCueText(original, original.candidates[0].id, 'x'.repeat(LIMITS.textUnits + 1)), code('limit'));
  assert.equal(original.edits.length, 0); assert.equal(validateDraft(original), original);
});

// Reopen and source/measurement integrity.
test('reopen validates schema and source hash before reading media', async () => {
  const original = await draft(); let reads = 0;
  const spy = { size: file().size, arrayBuffer() { reads++; return file().arrayBuffer(); } };
  const unknown = copy(original); unknown.source.arbitraryURL = 'https://attacker.invalid';
  await assert.rejects(reopenDraft(JSON.stringify(unknown), spy, { mediaDuration: 10 }), code('schema'));
  const wrongSHA = copy(original); wrongSHA.source.subtitle.sha256 = 'f'.repeat(64);
  assert.throws(() => serializeDraft(wrongSHA), code('source-identity'));
  await assert.rejects(reopenDraft(JSON.stringify(wrongSHA), spy, { mediaDuration: 10 }), code('source-identity'));
  assert.equal(reads, 0);
});

test('same filename with different bytes rejects; renamed identical bytes reopen', async () => {
  const original = await draft();
  await assert.rejects(reopenDraft(serializeDraft(original), new File(['LOCAL MEDIA FIXTURE'], 'private-name.wav'), { mediaDuration: 10 }), code('media-identity'));
  await assert.rejects(reopenDraft(serializeDraft(original), new File(['local media fixture changed'], 'private-name.wav'), { mediaDuration: 10 }), code('media-identity'));
  const renamed = await reopenDraft(serializeDraft(original), new File(['local media fixture'], 'renamed.mp3'), { mediaDuration: 10 });
  assert.equal(renamed.source.mediaSHA256, original.source.mediaSHA256);
});

test('duration/samples revalidation preserves raw and original measurements; no proportional shift', async () => {
  const original = await asr([{ text: ' first', timestamp: [0, 1] }, { text: ' second.', timestamp: [9, 10] }]);
  const reopened = await reopenDraft(serializeDraft(original), file(), { mediaDuration: 9.999 });
  assert.equal(reopened.source.originalMediaDuration, 10);
  assert.equal(reopened.source.originalDecodedSampleRate, 16000); assert.equal(reopened.source.originalDecodedSampleCount, 160000);
  assert.equal(reopened.source.decodedSampleRate, null); assert.equal(reopened.source.mediaDuration, 9.999);
  assert.deepEqual(reopened.raw, original.raw); assert.deepEqual(reopened.run, original.run);
  assert.deepEqual(reopened.candidates.map(cue => [cue.start, cue.end]), original.candidates.map(cue => [cue.start, cue.end]));
  assert.ok(reopened.candidates.every(cue => cue.flags.includes('duration-revalidated') && cue.flags.includes('samples-not-redecoded')));
  assert.ok(reopened.candidates.at(-1).flags.includes('out-of-bounds'));
  assert.equal(canPlayCue(reopened, reopened.candidates.at(-1).id), false);
  assert.throws(() => exportVTT(reopened), code('invalid-cues'));
  const restored = revalidateDuration(reopened, { mediaDuration: 10, decodedSampleRate: 48000, decodedSampleCount: 480000 });
  assert.ok(restored.candidates[0].flags.includes('samples-revalidated'));
  assert.equal(restored.source.originalDecodedSampleRate, 16000);
  assert.ok(exportVTT(restored).includes('00:00:10.000'));
});

test('UTF-8 JSON file/bytes roundtrip and invalid encoding/JSON are rejected', async () => {
  const original = await draft('你好 🙂'); const serialized = serializeDraft(original);
  for (const input of [new TextEncoder().encode(serialized), new Blob(['\uFEFF' + serialized]), new TextEncoder().encode(serialized).buffer]) {
    const reopened = await reopenDraft(input, file(), { mediaDuration: 10, decodedSampleRate: 16000, decodedSampleCount: 160000 }); assert.deepEqual(reopened, original);
  }
  await assert.rejects(reopenDraft(new Uint8Array([0xff]), file(), { mediaDuration: 10 }), code('encoding'));
  await assert.rejects(reopenDraft('{', file(), { mediaDuration: 10 }), code('json'));
});

test('duplicate JSON fields, unsafe object keys, and non-data values are rejected', async () => {
  const original = await draft(), serialized = serializeDraft(original);
  await assert.rejects(reopenDraft(serialized.replace('"version":', '"version":"discarded","version":'), file(), { mediaDuration: 10 }), code('schema'));
  await assert.rejects(reopenDraft(serialized.replace('"label":', '"\\u006cabel":"discarded","label":'), file(), { mediaDuration: 10 }), code('schema'));
  const proto = JSON.parse(serialized); Object.defineProperty(proto, '__proto__', { enumerable: true, value: {} });
  assert.throws(() => validateDraft(proto), code('schema'));
  const getter = copy(original); Object.defineProperty(getter, 'source', { enumerable: true, get() { throw new Error('getter must not execute'); } });
  assert.throws(() => validateDraft(getter), code('schema'));
  const cycle = copy(original); cycle.raw.words.push(cycle); assert.throws(() => validateDraft(cycle), code('schema'));
  const bad = copy(original); bad.run = undefined; assert.throws(() => validateDraft(bad), code('schema'));
});

test('closed schema rejects unknown fields, forged flags/valid/review status and broken references', async () => {
  const original = await asr([{ text: ' hello', timestamp: [null, 1] }]);
  const mutations = [
    item => { item.version = 'subtitle-draft.v2'; }, item => { item.label = 'Reviewed'; },
    item => { item.source.declaration = 'official'; }, item => { item.run.device = 'webgpu'; },
    item => { item.raw.words[0].id = 'source-cue-000001'; }, item => { item.raw.words[0].flags = []; },
    item => { item.raw.words[0].anomalies.start.reason = 'non-finite'; },
    item => { item.candidates[0].alignment = 'valid'; }, item => { item.candidates[0].flags = []; },
    item => { item.candidates[0].reviewStatus = 'reviewed'; }, item => { item.candidates[0].rawWordIds = ['missing']; },
    item => { item.candidates[0].sourceOrder = 20; }, item => { item.candidates[0].segmentation.rule = 'verified-natural-sentence'; },
    item => { item.candidates[0].start = 0; item.candidates[0].anomalies.start = null; },
    item => { item.candidates[0].url = 'javascript:alert(1)'; }, item => { item.raw.words[0].confidence = 1; },
  ];
  for (const change of mutations) { const item = copy(original); change(item); assert.throws(() => validateDraft(item), DraftError); }
});

test('closed history rejects forged candidate edits and fake undo restoration', async () => {
  const original = await asr(); const edited = editCueText(original, original.candidates[0].id, 'different');
  const mutations = [
    item => { item.candidates[0].text = 'forged'; }, item => { item.edits[0].old.text = 'forged'; },
    item => { item.edits[0].new.alignment = 'valid'; }, item => { item.edits[0].new.revision = 50; },
    item => { item.edits[0].cueId = 'bad'; }, item => { item.edits[0].undoOf = 'edit-000001'; },
  ];
  for (const change of mutations) { const item = copy(edited); change(item); assert.throws(() => serializeDraft(item), code('schema')); }
  const undone = copy(undoLastEdit(edited)); undone.edits[1].new.alignment = 'stale'; assert.throws(() => validateDraft(undone), code('schema'));
});

// VTT all-or-nothing and bounded work.
test('VTT retains legal overlap with stable playback sort and safe text', async () => {
  const original = await createSubtitleDraft({ media: await media(), text: srt('<b>A</b> & entity', '00:00:02,000', '00:00:04,000', 'A') + '\n' + srt('B', '00:00:01,000', '00:00:03,000', 'B'), format: 'srt' });
  const output = exportVTT(original);
  assert.ok(output.indexOf('draft-cue-000002') < output.indexOf('draft-cue-000001'));
  assert.ok(output.includes('00:00:01.000 --> 00:00:03.000')); assert.ok(output.includes('00:00:02.000 --> 00:00:04.000'));
  assert.ok(output.includes('&lt;b&gt;A&lt;/b&gt; &amp; entity'));
  assert.deepEqual(original.candidates.map(cue => cue.sourceCueId), ['A', 'B']);
});

test('any invalid cue blocks the whole VTT, with source-localizable blockers', async () => {
  const original = await createSubtitleDraft({ media: await media(), text: srt('okay') + '\n' + srt('zero', '00:00:02,000', '00:00:02,000', 'problem') + '\n' + srt('late', '00:00:09,000', '00:00:11,000', 'late'), format: 'srt' });
  assert.throws(() => exportVTT(original), error => {
    assert.equal(error.code, 'invalid-cues'); assert.deepEqual(error.details.map(detail => detail.sourceCueId), ['problem', 'late']);
    assert.ok(error.details[0].issues.includes('zero-duration')); assert.ok(error.details[1].issues.includes('out-of-bounds')); return true;
  });
  assert.equal(JSON.parse(serializeDraft(original)).candidates.length, 3);
});

test('empty/blank-line/control text and submillisecond zero cues cannot yield broken VTT', async () => {
  for (const text of ['', 'line\n\nline', 'line\n \nline', 'a\u0000b']) {
    const original = await draft(); const edited = editCueText(original, original.candidates[0].id, text);
    assert.throws(() => exportVTT(edited), code('invalid-cues')); assert.ok(serializeDraft(edited));
  }
  const tiny = await asr([{ text: 'one', timestamp: [0, 0.0001] }]); assert.throws(() => exportVTT(tiny), code('invalid-cues'));
});

test('500 cues accepted; 501 rejected with no truncation', async () => {
  const source = Array.from({ length: 500 }, (_, i) => srt('x', '00:00:00,000', '00:00:01,000', String(i))).join('\n');
  const original = await createSubtitleDraft({ media: await media(), text: source, format: 'srt' }); assert.equal(original.candidates.length, 500);
  assert.equal((await reopenDraft(serializeDraft(original), file(), { mediaDuration: 10, decodedSampleRate: 16000, decodedSampleCount: 160000 })).candidates.length, 500);
  assert.throws(() => parseSubtitleText(source + '\n' + srt('extra'), 'srt'), code('limit'));
});

test('raw word and per-segment limits are checked at ingest and reopen', async () => {
  const m = await media();
  assert.throws(() => createASRDraft({ media: m, output: { text: '', chunks: Array.from({ length: 10001 }, () => ({ text: '', timestamp: [0, 1] })) } }), code('limit'));
  await assert.rejects(createSubtitleDraft({ media: m, text: srt('x'.repeat(16001)), format: 'srt' }), code('limit'));
  const maximum = await draft('x'.repeat(16000)); assert.equal(maximum.candidates[0].text.length, 16000);
  assert.ok(serializeDraft(maximum));
  const bad = copy(maximum); bad.candidates[0].text += 'x'; await assert.rejects(reopenDraft(JSON.stringify(bad), file(), { mediaDuration: 10 }), code('limit'));
});

test('total text budget rejects added edit atomically before making an unexportable draft', async () => {
  const source = Array.from({ length: 15 }, (_, i) => srt('x'.repeat(15000), '00:00:00,000', '00:00:01,000', String(i))).join('\n');
  let current = await createSubtitleDraft({ media: await media(), text: source, format: 'srt' });
  let succeeded = 0;
  for (let i = 0; i < 10; i++) {
    const previous = current;
    try { current = editCueText(current, current.candidates[0].id, String(i).repeat(15000)); succeeded++; }
    catch (error) { assert.equal(error.code, 'limit'); assert.equal(current, previous); break; }
  }
  assert.ok(succeeded > 0 && succeeded < 10);
  assert.equal(validateDraft(current), current);
  const serialized = serializeDraft(current); assert.ok(new TextEncoder().encode(serialized).length <= LIMITS.jsonBytes);
  const reopened = await reopenDraft(serialized, file(), { mediaDuration: 10, decodedSampleRate: 16000, decodedSampleCount: 160000 }); assert.deepEqual(reopened, current);
});

test('2,000 edits preserved; edit and undo refuse 2,001 without truncating history', async () => {
  const original = await draft(); const full = copy(original); const cue = full.candidates[0];
  let before = { text: cue.text, alignment: cue.alignment, revision: cue.revision };
  for (let i = 1; i <= 2000; i++) {
    const after = { text: `edit ${i}`, alignment: 'stale', revision: i };
    full.edits.push({ id: `edit-${String(i).padStart(6, '0')}`, cueId: cue.id, kind: 'text', old: before, new: after, undoOf: null }); before = after;
  }
  Object.assign(cue, before); validateDraft(full);
  assert.throws(() => editCueText(full, cue.id, 'another'), code('limit'));
  assert.throws(() => undoLastEdit(full), code('limit'));
  const reopened = await reopenDraft(serializeDraft(full), file(), { mediaDuration: 10, decodedSampleRate: 16000, decodedSampleCount: 160000 });
  assert.equal(reopened.edits.length, 2000);
  const tooMany = copy(full); tooMany.edits.push(copy(tooMany.edits[0])); assert.throws(() => validateDraft(tooMany), code('limit'));
});

test('JSON/subtitle byte limits are UTF-8 bytes and checked before file reads or parsing', async () => {
  let reads = 0;
  await assert.rejects(reopenDraft({ size: LIMITS.jsonBytes + 1, arrayBuffer() { reads++; } }, file(), { mediaDuration: 10 }), code('schema'));
  assert.equal(reads, 0);
  await assert.rejects(reopenDraft(' '.repeat(LIMITS.jsonBytes + 1), file(), { mediaDuration: 10 }), code('limit'));
  assert.throws(() => parseSubtitleText('你'.repeat(350000), 'srt'), code('limit'));
});

test('module is pure local data: no requests, execution, DOM, DB, scoring or attempt plumbing', async () => {
  const source = await readFile(new URL('../../public/subtitle-workbench/draft.js', import.meta.url), 'utf8');
  for (const forbidden of [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\beval\s*\(/, /\bnew Function\b/, /\bimport\s*\(/, /\bindexedDB\b/, /\blocalStorage\b/, /\bsessionStorage\b/, /\binnerHTML\b/, /\bTrainingEngine\b/, /\bpostMessage\s*\(/]) assert.doesNotMatch(source, forbidden);
});


test('native readable text track keeps submillisecond original timing, duplicate IDs, metadata and explicit snapshot provenance', async () => {
  const track = { id: 'native', label: 'Native English', language: 'en', kind: 'subtitles' };
  const result = await createTextTrackDraft({ media: await media(), track, cues: [
    { id: 'same', text: '<b>First</b>', start: 0.123456789, end: 1.987654321 },
    { id: 'same', text: 'Overlap', start: 1.8, end: 2.2 },
  ] });
  assert.equal(result.source.subtitle.format, 'text-track');
  assert.equal(JSON.parse(result.source.subtitle.text).format, 'native-text-track.snapshot.v1');
  assert.equal(result.raw.cues[0].start, 0.123456789); assert.equal(result.candidates[0].end, 1.987654321);
  assert.deepEqual(result.source.subtitle.track, track); assert.equal(result.source.subtitle.language, 'en');
  assert.ok(result.candidates.every(cue => cue.flags.includes('overlap')));
  const reopened = await reopenDraft(serializeDraft(result), file(), { mediaDuration: 10, decodedSampleRate: 16000, decodedSampleCount: 160000 });
  assert.deepEqual(reopened, result); assert.ok(exportVTT(result).includes('00:00:00.123 --> 00:00:01.988'));
});

test('native text track invalid originals remain JSON-safe, unplayable and fully reopenable', async () => {
  const track = { id: '', label: '', language: '', kind: 'captions' };
  const result = await createTextTrackDraft({ media: await media(), track, cues: [{ id: '', text: 'broken', start: NaN, end: null }] });
  assert.equal(result.raw.cues[0].anomalies.start.value, 'NaN');
  assert.equal(canPlayCue(result, result.candidates[0].id), false);
  assert.throws(() => exportVTT(result), code('invalid-cues'));
  const reopened = await reopenDraft(serializeDraft(result), file(), { mediaDuration: 10, decodedSampleRate: 16000, decodedSampleCount: 160000 }); assert.deepEqual(reopened, result);
});

test('10,000 raw words fit a bounded candidate rule and reopen at the exact upper boundary', async () => {
  const chunks = Array.from({ length: 10000 }, (_, index) => ({ text: ' a', timestamp: [index * 0.006, (index + 1) * 0.006] }));
  const result = createASRDraft({ media: await media(60), output: { text: chunks.map(word => word.text).join(''), chunks } });
  assert.equal(result.raw.words.length, 10000); assert.equal(result.candidates.length, 417);
  const reopened = await reopenDraft(serializeDraft(result), file(), { mediaDuration: 60, decodedSampleRate: 16000, decodedSampleCount: 960000 }); assert.deepEqual(reopened, result);
});


// Independent ordinary-data pre-review regressions D1–D4.
test('D1: a legal multiline NOTE block is retained as source metadata and never becomes a cue', async () => {
  const text = 'WEBVTT\n\nNOTE\nAn ordinary editorial comment.\nSecond comment line.\n\n00:00:01.000 --> 00:00:02.000\nHello\n';
  const result = await createSubtitleDraft({ media: await media(), text, format: 'vtt' });
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].text, 'Hello');
  assert.equal(result.source.subtitle.text, text); assert.ok(exportVTT(result));
  assert.deepEqual(await reopenDraft(serializeDraft(result), file(), { mediaDuration: 10, decodedSampleRate: 16000, decodedSampleCount: 160000 }), result);
});

test('D3: recursively reordered JSON object keys preserve meaning while arrays and values stay exact', async () => {
  const keySort = value => Array.isArray(value) ? value.map(keySort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, keySort(value[key])])) : value;
  for (const initial of [await draft('Original subtitle'), await asr(), await asr([{ text: ' malformed', timestamp: [null, 1] }]), await createTextTrackDraft({ media: await media(), cues: [{ id: 'native', text: 'x', start: 0.123456, end: 1.123456 }], track: { id: '', label: '', language: 'en', kind: 'captions' } })]) {
    const edited = editCueText(initial, initial.candidates[0].id, 'Human revision');
    const reordered = JSON.stringify(keySort(edited), null, 2);
    const reopened = await reopenDraft(reordered, file(), { mediaDuration: 10, decodedSampleRate: 16000, decodedSampleCount: 160000 });
    assert.deepEqual(reopened, edited); assert.deepEqual(undoLastEdit(reopened).candidates, initial.candidates);
  }
});

test('D4: interior raw word bounds are explicitly flagged against every fresh duration, without moving originals', async () => {
  const initial = createASRDraft({ media: await media(1), output: { text: ' one two three', chunks: [
    { text: ' one', timestamp: [0, 0.2] }, { text: ' two', timestamp: [0.2, 1.001] }, { text: ' three', timestamp: [0.5, 0.8] },
  ] } });
  assert.deepEqual([initial.candidates[0].start, initial.candidates[0].end], [0, 0.8]);
  assert.ok(getCueIssues(initial, initial.candidates[0].id).includes('raw-out-of-bounds'));
  assert.equal(initial.candidates[0].alignment, 'unavailable'); assert.equal(initial.raw.words[1].end, 1.001);
  const longer = revalidateDuration(initial, { mediaDuration: 1.01, decodedSampleRate: 16000, decodedSampleCount: 16160 });
  assert.ok(!getCueIssues(longer, longer.candidates[0].id).includes('raw-out-of-bounds')); assert.deepEqual(longer.raw, initial.raw);
  const shorter = revalidateDuration(longer, { mediaDuration: 0.9 });
  assert.ok(getCueIssues(shorter, shorter.candidates[0].id).includes('raw-out-of-bounds')); assert.deepEqual(shorter.raw, initial.raw);
});

test('D2: maximum legal actual-plus-reserved text/byte budget survives all fresh-measurement diagnostics', async () => {
  const source = Array.from({ length: 15 }, (_, index) => srt('a'.repeat(16000), '00:00:01,000', '00:00:02,000', String(index))).join('\n');
  let current = await createSubtitleDraft({ media: await media(), text: source, format: 'srt' });
  for (let index = 0; index < 20; index++) {
    let low = 1, high = 16000, best = null;
    while (low <= high) {
      const mid = (low + high) >> 1;
      try { best = editCueText(current, current.candidates[0].id, String(index % 10).repeat(mid)); low = mid + 1; }
      catch (error) { if (error.code !== 'limit') throw error; high = mid - 1; }
    }
    if (!best) break;
    current = best;
    const budget = getDraftBudget(current);
    if (budget.textLimit - budget.textUnits - budget.reservedTextUnits < 100) break;
  }
  const initialBudget = getDraftBudget(current), totalText = initialBudget.textUnits + initialBudget.reservedTextUnits;
  assert.ok(totalText >= 999900 && totalText <= LIMITS.totalTextUnits);
  const json = serializeDraft(current);
  for (const measured of [
    { mediaDuration: 10, decodedSampleRate: 16000, decodedSampleCount: 160000 },
    { mediaDuration: 10.000001, decodedSampleRate: 48000, decodedSampleCount: 480001 },
    { mediaDuration: 1.5 },
    { mediaDuration: 10, decodedSampleRate: 16000, decodedSampleCount: 160000 },
  ]) {
    current = await reopenDraft(serializeDraft(current), file(), measured);
    const budget = getDraftBudget(current);
    assert.equal(budget.textUnits + budget.reservedTextUnits, totalText);
    assert.equal(budget.jsonBytes + budget.reservedJSONBytes, initialBudget.jsonBytes + initialBudget.reservedJSONBytes);
    assert.ok(budget.textUnits <= LIMITS.totalTextUnits); assert.ok(budget.jsonBytes <= LIMITS.jsonBytes);
    assert.deepEqual(current.raw, JSON.parse(json).raw); assert.deepEqual(current.edits, JSON.parse(json).edits);
  }
});
