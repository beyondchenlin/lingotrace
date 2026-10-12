import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_VIDEO_PALETTE_STATE, analyzeVideoPalette, createVideoPalette,
  smoothVideoPaletteTone, validateVideoPalette, videoPaletteLuminance,
} from './video-palette';

function frame(rgb: number[], width = 96, height = 54) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([...rgb, 255], i);
  return pixels;
}
function paint(pixels: Uint8ClampedArray, rgb: number[], x: number, y: number, w: number, h: number) {
  for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) pixels.set([...rgb, 255], (row * 96 + col) * 4);
}
const hueDistance = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

test('OFF is the frozen canonical default with no derived palette or lock', () => {
  assert.deepEqual(INITIAL_VIDEO_PALETTE_STATE, { mode: 'off', status: 'off', locked: false, hasPalette: false, message: '已关闭，使用默认配色。' });
  assert.ok(Object.isFrozen(INITIAL_VIDEO_PALETTE_STATE));
});

test('black, white and transparent frames use fallback, while flat saturated colours are valid', () => {
  for (const rgb of [[0, 0, 0], [10, 10, 10]]) assert.equal(analyzeVideoPalette(frame(rgb), 96, 54).reason, 'black');
  for (const rgb of [[255, 255, 255], [249, 249, 249]]) assert.equal(analyzeVideoPalette(frame(rgb), 96, 54).reason, 'white');
  assert.equal(analyzeVideoPalette(new Uint8ClampedArray(96 * 54 * 4), 96, 54).reason, 'empty');
  for (const [rgb, hue] of [[[255, 0, 0], 0], [[0, 255, 0], 120], [[0, 0, 255], 240]] as const) {
    const result = analyzeVideoPalette(frame([...rgb]), 96, 54);
    assert.equal(result.reason, 'color');
    assert.ok(result.tone);
    assert.ok(hueDistance(result.tone.hue, hue) < .001);
    assert.ok(validateVideoPalette(createVideoPalette(result.tone)));
  }
});

test('black letterbox and pillarbox edges are cropped, not mistaken for the dominant colour', () => {
  const pixels = frame([0, 0, 0]);
  paint(pixels, [25, 80, 210], 16, 12, 64, 30);
  const cropped = analyzeVideoPalette(pixels, 96, 54).tone!;
  const clean = analyzeVideoPalette(frame([25, 80, 210]), 96, 54).tone!;
  assert.ok(hueDistance(cropped.hue, clean.hue) < .001);
  assert.ok(Math.abs(cropped.lightness - clean.lightness) < 1e-10);
});

test('subtitle region has reduced influence and monochrome frames retain the prior hue', () => {
  const pixels = frame([100, 110, 145]);
  paint(pixels, [255, 0, 0], 0, 43, 96, 11);
  assert.ok(hueDistance(analyzeVideoPalette(pixels, 96, 54).tone!.hue, 226.667) < 1);
  assert.equal(analyzeVideoPalette(frame([120, 120, 120]), 96, 54, 37).tone!.hue, 37);
  assert.equal(analyzeVideoPalette(frame([122, 120, 121]), 96, 54, 287).tone!.hue, 287);
  assert.equal(analyzeVideoPalette(frame([100, 100, 100]), 96, 54, NaN).tone!.hue, 210);
});

test('near-total white flashes reject the frame rather than switching to residual subtitle colour', () => {
  const pixels = frame([255, 255, 255]);
  paint(pixels, [255, 0, 0], 0, 49, 96, 5);
  assert.deepEqual(analyzeVideoPalette(pixels, 96, 54), { tone: null, reason: 'white' });
});

test('malformed or oversized input is bounded and empty', () => {
  for (const [w, h] of [[0, 54], [-1, 54], [96.5, 54], [NaN, 54], [1000, 1000]]) {
    assert.deepEqual(analyzeVideoPalette(new Uint8Array(), w, h), { tone: null, reason: 'empty' });
  }
  assert.equal(analyzeVideoPalette(new Uint8Array(10), 96, 54).reason, 'empty');
});

test('generated palette slots remain bounded canonical hex across hue and luminance extremes', () => {
  for (let hue = -360; hue <= 720; hue += 15) for (const saturation of [0, .05, .5, 1, Infinity]) for (const lightness of [0, .5, 1, NaN]) {
    const palette = createVideoPalette({ hue, saturation, lightness, luminance: lightness });
    assert.ok(validateVideoPalette(palette), JSON.stringify(palette));
    assert.ok(Object.isFrozen(palette));
    for (const key of ['glassTop', 'glassBottom'] as const) {
      const color = palette[key], rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
      const luminance = videoPaletteLuminance(rgb[0], rgb[1], rgb[2]);
      assert.ok((1.05 / (luminance + .05)) > 12, `${key} keeps an opaque dark backdrop`);
    }
  }
});

test('renderer validation rejects arbitrary CSS, bright glass, invalid channels and throwing accessors', () => {
  const palette = createVideoPalette({ hue: 35, saturation: .8, lightness: .5, luminance: .5 });
  for (const value of [null, [], '', {}, { ...palette, frame: 'red' }, { ...palette, glow: 'url(https://example.test)' },
    { ...palette, frame: '#fff' }, { ...palette, frame: '#FFFFFF' }, { ...palette, glassTop: '#ffffff' },
    { ...palette, glassBottom: '#444444' }, { ...palette, glow: '#zzzzzz' }]) assert.equal(validateVideoPalette(value), false);
  assert.equal(validateVideoPalette(Object.defineProperty({}, 'frame', { get() { throw Error('bad'); } })), false);
});

test('smoothing has 600ms ordinary/250ms cut response, shortest-path hue and bounded brightness steps', () => {
  const previous = { hue: 355, saturation: .3, lightness: .3, luminance: .2 };
  const ordinary = smoothVideoPaletteTone(previous, { ...previous, hue: 5 });
  const expected = (355 + 10 * (1 - Math.exp(-125 / 600))) % 360;
  assert.ok(Math.abs(ordinary.hue - expected) < 1e-8);
  const cut = smoothVideoPaletteTone(previous, { hue: 125, saturation: 1, lightness: .95, luminance: 1 });
  assert.ok(Math.abs(cut.hue - ((355 + 130 * (1 - Math.exp(-125 / 250))) % 360)) < 1e-8);
  assert.ok(cut.lightness - previous.lightness <= .045 + 1e-10);
  assert.ok(cut.luminance - previous.luminance <= .045 + 1e-10);
  assert.deepEqual(smoothVideoPaletteTone(previous, { ...previous, hue: 5 }, 0), previous);
  assert.deepEqual(smoothVideoPaletteTone(previous, { ...previous, hue: 5 }, 10000), smoothVideoPaletteTone(previous, { ...previous, hue: 5 }, 250));
  assert.notStrictEqual(smoothVideoPaletteTone(null, previous), previous);
});
