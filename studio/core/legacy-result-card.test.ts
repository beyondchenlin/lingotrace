import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { TrainingEngine, type Material, type TrainingSnapshot } from './training';
import { readLegacyHistoryRecord, LegacyHistoryError, type LegacyHistorySession } from './legacy-history';
import { projectLegacyHistoryHud } from './legacy-history-hud';
import {
  projectLegacyResultCard, renderLegacyResultCard, LEGACY_RESULT_CARD_WIDTH, LEGACY_RESULT_CARD_HEIGHT,
  LEGACY_RESULT_CARD_VERSION, type LegacyResultCardModel, type LegacyResultCardFields,
} from './legacy-result-card';

// Test data only. These sentinels must never appear in a public canvas/model.
const material: Material = { id: 'PRIVATE_MATERIAL_ID', version: 'PRIVATE_MATERIAL_VERSION', title: 'PRIVATE_MATERIAL_TITLE', rights: 'PRIVATE_RIGHTS',
  cues: [{ id: 'PRIVATE_CUE_ONE', text: 'red green blue', start: 0, end: 5 },
    { id: 'PRIVATE_CUE_TWO', text: 'PRIVATE_REFERENCE_TWO', start: 5, end: 10 },
    { id: 'PRIVATE_CUE_THREE', text: 'PRIVATE_REFERENCE_THREE', start: 10, end: 15 }] };

function retained(completeOne = true, words = 173): LegacyHistorySession {
  let id = 0, now = 0;
  const engine = new TrainingEngine({ sessionId: 'PRIVATE_SESSION_ID', material,
    clock: { now: () => now, wallTime: () => new Date(Date.UTC(2026, 9, 8) + now).toISOString(), id: () => `PRIVATE_EVENT_${++id}` } });
  if (completeOne) {
    engine.input('red green blue'); now += 1000; engine.sampleClock(); engine.submit();
    engine.input('PRIVATE_DRAFT_TEXT');
  }
  const snapshot = structuredClone(engine.getSnapshot()) as unknown as Record<string, any>;
  snapshot.earnedWords = words;
  if (snapshot.attempts.length) snapshot.attempts[0].answer = 'PRIVATE_ATTEMPT_ANSWER';
  snapshot.camera = { image: 'PRIVATE_CAMERA_CAPTURE' };
  snapshot.audio = 'PRIVATE_AUDIO_RECORDING';
  return readLegacyHistoryRecord({ sessionId: snapshot.sessionId, sequence: snapshot.sequence,
    updatedAt: '2026-10-08T12:34:56.789Z', snapshot: snapshot as TrainingSnapshot });
}

type TextCall = { value: string; x: number; y: number; width: number; maxWidth: number | undefined; font: string };
function render(model: LegacyResultCardModel, dirty = false) {
  const canvas = createCanvas(32, 24), native = canvas.getContext('2d'), calls: TextCall[] = [];
  const ctx = native as unknown as CanvasRenderingContext2D;
  const draw = ctx.fillText.bind(ctx);
  ctx.fillText = (value, x, y, maxWidth) => {
    calls.push({ value, x, y, maxWidth, font: ctx.font, width: ctx.measureText(value).width });
    draw(value, x, y, maxWidth);
  };
  if (dirty) {
    ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 32, 24); ctx.translate(97, 213); ctx.scale(2, 3);
    ctx.globalAlpha = .2; ctx.globalCompositeOperation = 'xor'; ctx.shadowBlur = 20;
    ctx.beginPath(); ctx.rect(0, 0, 1, 1); ctx.clip();
  }
  renderLegacyResultCard(ctx, model);
  return { canvas, ctx, calls, png: canvas.toBuffer('image/png') };
}

test('saved original quantities are reused exactly, with a frozen primitive-only allowlist', () => {
  const session = retained(), before = JSON.stringify(session), hud = projectLegacyHistoryHud(session);
  const model = projectLegacyResultCard(session);
  assert.deepEqual(model, { version: LEGACY_RESULT_CARD_VERSION, sourceState: 'saved', includeWords: true, includeCompletion: true,
    earnedWords: hud.words.value, completedCount: hud.completion.numerator, materialCueCount: hud.completion.denominator });
  assert.equal(model.earnedWords, 173); assert.equal(model.completedCount, 1); assert.equal(model.materialCueCount, 3);
  assert.ok(Object.isFrozen(model));
  assert.ok(Object.values(model).every(value => value === null || ['string', 'number', 'boolean'].includes(typeof value)));
  assert.equal(JSON.stringify(session), before);
  assert.throws(() => { (model as { earnedWords: number }).earnedWords = 0; }, TypeError);
});

test('private source fields, dates, media, answers, drafts and source IDs are absent from model and every painted text', () => {
  const session = retained(), model = projectLegacyResultCard(session), { calls, png } = render(model);
  const exposed = JSON.stringify(model) + calls.map(call => call.value).join('\n');
  for (const sentinel of ['PRIVATE_', '2026-', '12:34', session.summary.sessionId, session.summary.materialTitle]) {
    assert.ok(!exposed.includes(sentinel), `Private sentinel appeared: ${sentinel}`);
    assert.ok(!png.includes(Buffer.from(sentinel)), `Private sentinel entered PNG: ${sentinel}`);
  }
  assert.ok(calls.some(call => call.value === '我的练习记录'));
  assert.ok(calls.some(call => call.value === 'Training v1 · 已保存快照'));
  assert.ok(calls.some(call => call.value.includes('原确认规则')));
  assert.ok(calls.some(call => call.value.includes('完成比例不是能力评分')));
  assert.ok(calls.some(call => call.value === '173'));
  assert.ok(calls.some(call => call.value === '1 / 3'));
  assert.ok(calls.some(call => call.value === '33.3%'));
});

test('optional fields default on, remove the hidden quantities, and refuse an empty selection', () => {
  const session = retained();
  for (const fields of [{ words: false }, { completion: false }]) {
    const model = projectLegacyResultCard(session, fields), { calls } = render(model), strings = calls.map(call => call.value);
    if (fields.words === false) {
      assert.equal(model.earnedWords, null); assert.equal(model.includeCompletion, true);
      assert.ok(!strings.includes('173')); assert.ok(!strings.includes('已确认词数')); assert.ok(strings.includes('1 / 3'));
    } else {
      assert.equal(model.completedCount, null); assert.equal(model.materialCueCount, null); assert.equal(model.includeWords, true);
      assert.ok(!strings.includes('素材完成情况')); assert.ok(!strings.includes('1 / 3')); assert.ok(!strings.some(text => text.includes('%')));
    }
  }
  assert.throws(() => projectLegacyResultCard(session, { words: false, completion: false }), /at least one/);
  for (const fields of [{ words: 1 }, { completion: null }, { title: true }, []]) {
    assert.throws(() => projectLegacyResultCard(session, fields as unknown as LegacyResultCardFields), TypeError);
  }
});

test('recorded zero is displayed as zero; no saved data never fabricates a zero or percentage', () => {
  const zero = projectLegacyResultCard(retained(false, 0)), none = projectLegacyResultCard(null);
  assert.equal(zero.sourceState, 'saved'); assert.equal(zero.earnedWords, 0); assert.equal(zero.completedCount, 0); assert.equal(zero.materialCueCount, 3);
  const zeroText = render(zero).calls.map(call => call.value);
  assert.ok(zeroText.includes('0')); assert.ok(zeroText.includes('0.0%')); assert.ok(zeroText.includes('0 / 3'));
  assert.equal(none.sourceState, 'no-data'); assert.equal(none.earnedWords, null); assert.equal(none.completedCount, null); assert.equal(none.materialCueCount, null);
  const noneText = render(none).calls.map(call => call.value);
  assert.ok(noneText.includes('—')); assert.ok(noneText.includes('暂无已保存数据'));
  assert.ok(!noneText.includes('Training v1 · 已保存快照'));
  assert.ok(!noneText.includes('0')); assert.ok(!noneText.some(value => value.includes('%') || /^\d+ \/ \d+$/.test(value)));
});

test('partial, non-replayable and malformed records are rejected without mutation', () => {
  const original = retained();
  const candidates = [{ ...original, coverage: 'partial' }, { ...original, replayable: false },
    { ...original, snapshot: { ...original.snapshot, coverage: 'partial' } },
    { ...original, snapshot: { ...original.snapshot, replayable: false } },
    { ...original, snapshot: { ...original.snapshot, earnedWords: undefined } }];
  for (const candidate of candidates) {
    const before = JSON.stringify(candidate);
    assert.throws(() => projectLegacyResultCard(candidate as LegacyHistorySession), error => error instanceof LegacyHistoryError);
    assert.equal(JSON.stringify(candidate), before);
  }
});

test('completion denominator requires matching embedded material evidence even when completion is hidden', () => {
  const mutations: ((value: any) => void)[] = [
    value => { delete value.snapshot.material; },
    value => { delete value.snapshot.material.version; },
    value => { value.snapshot.material.version = 'substituted-current-material'; },
    value => { delete value.snapshot.events[0].material; },
    value => { value.snapshot.events[0].material.cues.pop(); },
    value => { value.summary.materialVersion = 'different-selected-version'; },
    value => { value.summary.materialSource = 'current-catalog'; },
  ];
  for (const mutate of mutations) for (const fields of [{}, { completion: false }]) {
    const candidate = structuredClone(retained()); mutate(candidate); const before = JSON.stringify(candidate);
    assert.throws(() => projectLegacyResultCard(candidate, fields), error => error instanceof LegacyHistoryError);
    assert.equal(JSON.stringify(candidate), before);
  }
});

test('renderer rejects extra private properties, accessors and incoherent quantities before drawing', () => {
  const model = projectLegacyResultCard(retained()), canvas = createCanvas(1200, 800), ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  const candidates: unknown[] = [{ ...model, title: 'PRIVATE_INJECTION' }, { ...model, earnedWords: NaN },
    { ...model, earnedWords: -1 }, { ...model, earnedWords: Number.MAX_SAFE_INTEGER + 1 },
    { ...model, materialCueCount: 0 }, { ...model, completedCount: 4 }, { ...model, completedCount: null },
    { ...model, includeWords: false }, { ...model, sourceState: 'no-data' },
    { ...model, includeWords: false, includeCompletion: false, earnedWords: null, completedCount: null, materialCueCount: null },
    { ...model, [Symbol('private')]: 'PRIVATE_INJECTION' }];
  let getterRead = false;
  candidates.push(Object.defineProperty({ ...model }, 'earnedWords', { get() { getterRead = true; return 173; } }));
  for (const candidate of candidates) assert.throws(() => renderLegacyResultCard(ctx, candidate as LegacyResultCardModel), TypeError);
  assert.equal(getterRead, false);
  assert.equal(ctx.getImageData(0, 0, 1, 1).data[3], 0);
});

test('actual Canvas output is fixed-size, opaque, deterministic and resets prior drawing state', () => {
  const model = projectLegacyResultCard(retained()), clean = render(model), dirty = render(model, true);
  assert.equal(clean.canvas.width, LEGACY_RESULT_CARD_WIDTH); assert.equal(clean.canvas.height, LEGACY_RESULT_CARD_HEIGHT);
  assert.deepEqual(clean.png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(clean.png.readUInt32BE(16), 1200); assert.equal(clean.png.readUInt32BE(20), 800);
  assert.ok(clean.png.length > 10000); assert.deepEqual(dirty.png, clean.png);
  renderLegacyResultCard(clean.ctx, model); assert.deepEqual(clean.canvas.toBuffer('image/png'), clean.png);
  for (const [x, y] of [[0, 0], [1199, 0], [0, 799], [1199, 799], [600, 400]]) {
    assert.equal(clean.ctx.getImageData(x, y, 1, 1).data[3], 255);
  }
});

test('the largest supported saved word count stays exact and fits the available text width', () => {
  const model = projectLegacyResultCard(retained(true, Number.MAX_SAFE_INTEGER));
  for (const fields of [{}, { completion: false }]) {
    const selected = projectLegacyResultCard(retained(true, Number.MAX_SAFE_INTEGER), fields), { calls, png } = render(selected);
    const count = calls.find(call => call.value === '9,007,199,254,740,991'); assert.ok(count);
    assert.equal(selected.earnedWords, Number.MAX_SAFE_INTEGER);
    assert.ok(count.width <= count.maxWidth! + .01, 'Large saved values shrink to fit, without rounding or abbreviation.');
    assert.ok(png.length > 10000);
  }
  assert.equal(model.earnedWords, Number.MAX_SAFE_INTEGER);
});

test('a serialized allowlisted model preserves exactly the same preview/export pixels', () => {
  const model = projectLegacyResultCard(retained());
  assert.deepEqual(render(JSON.parse(JSON.stringify(model)) as LegacyResultCardModel).png, render(model).png);
});

test('actual PNG contains only image/colour chunks, without text, EXIF or source JSON metadata', () => {
  for (const fields of [{}, { words: false }, { completion: false }]) {
    const { png } = render(projectLegacyResultCard(retained(), fields));
    const chunks: string[] = [];
    let offset = 8;
    while (offset < png.length) {
      assert.ok(offset + 12 <= png.length, 'Complete PNG chunk header and CRC are present.');
      const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
      assert.ok(offset + 12 + length <= png.length, 'PNG chunk data fits inside the file.');
      assert.ok(['IHDR', 'IDAT', 'IEND', 'sBIT', 'sRGB', 'gAMA', 'cHRM', 'pHYs'].includes(type), `Unexpected PNG metadata chunk: ${type}`);
      const fixedLengths: Record<string, number> = { IHDR: 13, IEND: 0, sBIT: 4, sRGB: 1, gAMA: 4, cHRM: 32, pHYs: 9 };
      if (type !== 'IDAT') assert.equal(length, fixedLengths[type], 'Standard chunks contain only their fixed image/colour payload.');
      chunks.push(type); offset += length + 12;
    }
    assert.equal(offset, png.length, 'No appended source record or metadata follows the image.');
    assert.equal(chunks[0], 'IHDR'); assert.equal(chunks[chunks.length - 1], 'IEND'); assert.ok(chunks.includes('IDAT'));
    for (const field of ['sessionId', 'materialTitle', 'updatedAt', 'earnedWords', 'PRIVATE_']) assert.ok(!png.includes(Buffer.from(field)));
  }
});
