import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import {
  HudContrastController, HUD_CONTRAST_MIN_ALPHA, HUD_CONTRAST_MAX_ALPHA,
  HUD_CONTRAST_FALLBACK_ALPHA, HUD_CONTRAST_SAMPLE_MS, HUD_CONTRAST_SMOOTHING_MS,
  analyzeHudLuminance, hudBackingAlpha, hudRelativeLuminance, smoothHudBackingAlpha,
  type HudContrastRegions,
} from './hud-contrast';

const full = { x: 0, y: 0, w: 1, h: 1 };
const regions = { caption: full };
const source = () => ({ width: 1920, height: 1080 }) as CanvasImageSource;
const close = (actual: number, expected: number, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);
function frame(red: number, green = red, blue = red, width = 8, height = 4) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) pixels.set([red, green, blue, 255], index);
  return pixels;
}

test('relative luminance uses linearized sRGB and finite conservative input boundaries', () => {
  close(hudRelativeLuminance(0, 0, 0), 0);
  close(hudRelativeLuminance(255, 255, 255), 1);
  close(hudRelativeLuminance(255, 0, 0), .2126);
  close(hudRelativeLuminance(0, 255, 0), .7152);
  close(hudRelativeLuminance(0, 0, 255), .0722);
  close(hudRelativeLuminance(128, 128, 128), .21586050011389926);
  close(hudRelativeLuminance(-20, -20, -20), 0);
  close(hudRelativeLuminance(500, 500, 500), 1);
  for (const invalid of [NaN, Infinity, -Infinity]) close(hudRelativeLuminance(invalid, 0, 0), 1);
});

test('backing opacity is continuous and exactly linear across every intermediate brightness', () => {
  assert.equal(hudBackingAlpha(0), HUD_CONTRAST_MIN_ALPHA);
  assert.equal(hudBackingAlpha(1), HUD_CONTRAST_MAX_ALPHA);
  for (let step = 0; step <= 1000; step++) {
    const brightness = step / 1000;
    close(hudBackingAlpha(brightness), .30 + .48 * brightness);
    if (step) close(hudBackingAlpha(brightness) - hudBackingAlpha(brightness - .001), .00048);
  }
  for (const brightness of [NaN, Infinity, -Infinity]) assert.equal(hudBackingAlpha(brightness), HUD_CONTRAST_FALLBACK_ALPHA);
  assert.equal(hudBackingAlpha(-1), HUD_CONTRAST_MIN_ALPHA);
  assert.equal(hudBackingAlpha(2), HUD_CONTRAST_MAX_ALPHA);
});

test('regional mean separates bright and dark HUD areas from one frame', () => {
  const pixels = frame(0);
  for (let y = 0; y < 4; y++) for (let x = 4; x < 8; x++) pixels.set([255, 255, 255, 255], (y * 8 + x) * 4);
  const result = analyzeHudLuminance(pixels, 8, 4, {
    dark: { x: 0, y: 0, w: .5, h: 1 }, light: { x: .5, y: 0, w: .5, h: 1 }, all: full,
  });
  close(result.dark, 0);
  close(result.light, 1);
  close(result.all, .5);
  close(hudBackingAlpha(result.all), (hudBackingAlpha(result.dark) + hudBackingAlpha(result.light)) / 2);
});

test('a small bright area contributes proportionally, without percentile or max-pixel switching', () => {
  const pixels = frame(0);
  pixels.set([255, 255, 255, 255], 0);
  close(analyzeHudLuminance(pixels, 8, 4, regions).caption, 1 / 32);
  pixels.set([255, 255, 255, 255], 4);
  close(analyzeHudLuminance(pixels, 8, 4, regions).caption, 2 / 32);
});

test('transparent pixels use conservative white composition and never inherit previous frame pixels', () => {
  const transparent = frame(0);
  for (let index = 3; index < transparent.length; index += 4) transparent[index] = 0;
  close(analyzeHudLuminance(transparent, 8, 4, regions).caption, 1);
  for (let index = 3; index < transparent.length; index += 4) transparent[index] = 128;
  close(analyzeHudLuminance(transparent, 8, 4, regions).caption, hudRelativeLuminance(127, 127, 127));
});

test('sample geometry is clipped and invalid, empty or oversized samples are omitted', () => {
  const pixels = frame(128);
  const expected = hudRelativeLuminance(128, 128, 128);
  const result = analyzeHudLuminance(pixels, 8, 4, {
    clipped: { x: -.2, y: -.2, w: 1.4, h: 1.4 },
    outside: { x: 1, y: 0, w: 1, h: 1 },
    empty: { ...full, w: 0 }, backwards: { ...full, h: -1 }, invalid: { ...full, x: NaN },
  });
  close(result.clipped, expected/(1.4*1.4));
  assert.deepEqual(Object.keys(result), ['clipped']);
  for (const [width, height] of [[0, 4], [-1, 4], [8.5, 4], [NaN, 4], [512, 512]]) {
    assert.deepEqual(analyzeHudLuminance(pixels, width, height, regions), {});
  }
  assert.deepEqual(analyzeHudLuminance(new Uint8Array(4), 8, 4, regions), {});
});

test('600ms temporal easing is monotonic, partition-independent and bounded after a long suspension', () => {
  const start = .78, target = .30;
  close(smoothHudBackingAlpha(start, target, 100), start + (target - start) * (1 - Math.exp(-100 / HUD_CONTRAST_SMOOTHING_MS)));
  const once = smoothHudBackingAlpha(start, target, 250);
  const twice = smoothHudBackingAlpha(smoothHudBackingAlpha(start, target, 125), target, 125);
  close(once, twice);
  assert.ok(once < start && once > target);
  assert.equal(smoothHudBackingAlpha(start, target, 10000), once);
  for (const elapsed of [0, -100, NaN, Infinity]) assert.equal(smoothHudBackingAlpha(start, target, elapsed), start);
  let value = start;
  for (let tick = 0; tick < 240; tick++) {
    const next = smoothHudBackingAlpha(value, target, 16);
    assert.ok(next <= value && next >= target);
    value = next;
  }
  assert.ok(value < .301);
});

test('controller reads at most once per 250ms while its alpha eases on ordinary render frames', () => {
  let reads = 0;
  const controller = new HudContrastController({ sampler: () => { reads++; return { caption: 0 }; } });
  const media = source();
  const first = controller.update(media, 'one', regions, 0);
  assert.equal(first.status, 'adaptive');
  assert.equal(first.alpha.caption, HUD_CONTRAST_FALLBACK_ALPHA);
  const next = controller.update(media, 'one', regions, 100);
  assert.ok(next.alpha.caption < first.alpha.caption);
  controller.update(media, 'one', regions, 249);
  assert.equal(reads, 1);
  controller.update(media, 'one', regions, 250);
  assert.equal(reads, 2);
  for (let time = 251; time <= 1000; time++) controller.update(media, 'one', regions, time);
  assert.equal(reads, 5);
  assert.equal(HUD_CONTRAST_SAMPLE_MS, 250);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.alpha));
});

test('rapid source luminance changes produce small smooth frame steps rather than backing flashes', () => {
  let bright = false;
  const controller = new HudContrastController({ sampler: () => ({ caption: bright ? 1 : 0 }) });
  const media = source();
  let previous = controller.update(media, 'one', regions, 0).alpha.caption;
  for (let time = 16; time <= 5000; time += 16) {
    bright = Math.floor(time / 250) % 2 === 1;
    const alpha = controller.update(media, 'one', regions, time).alpha.caption;
    assert.ok(Math.abs(alpha - previous) < .013, 'no per-frame opacity jump');
    assert.ok(alpha >= HUD_CONTRAST_MIN_ALPHA && alpha <= HUD_CONTRAST_MAX_ALPHA);
    previous = alpha;
  }
});

test('identity or element changes discard old dark-source values immediately', () => {
  let reads = 0;
  const controller = new HudContrastController({ sampler: () => { reads++; return { caption: 0 }; } });
  const media = source();
  controller.update(media, 'one', regions, 0);
  const old = controller.update(media, 'one', regions, 250);
  assert.ok(old.alpha.caption < HUD_CONTRAST_FALLBACK_ALPHA);
  assert.equal(controller.update(media, 'two', regions, 251).alpha.caption, HUD_CONTRAST_FALLBACK_ALPHA);
  assert.equal(reads, 3);
  controller.update(media, 'two', regions, 400);
  assert.equal(controller.update(source(), 'two', regions, 401).alpha.caption, HUD_CONTRAST_FALLBACK_ALPHA);
  assert.equal(reads, 4);
});

test('null or newly unready media clears sampled values without accessing pixels', () => {
  let reads = 0;
  const controller = new HudContrastController({ sampler: () => { reads++; return { caption: 0 }; } });
  const media = Object.assign(source(), { videoWidth: 1920, videoHeight: 1080, readyState: 2 });
  controller.update(media, 'one', regions, 0);
  assert.ok(controller.update(media, 'one', regions, 200).alpha.caption < HUD_CONTRAST_FALLBACK_ALPHA);
  media.readyState = 0;
  assert.deepEqual(controller.update(media, 'one', regions, 201), { status: 'waiting', alpha: { caption: HUD_CONTRAST_FALLBACK_ALPHA } });
  assert.equal(reads, 1);
  media.readyState = 2;
  controller.update(media, 'one', regions, 202);
  assert.equal(reads, 2);
  assert.deepEqual(controller.update(null, 'one', regions, 203), { status: 'waiting', alpha: { caption: HUD_CONTRAST_FALLBACK_ALPHA } });
});

test('sampler null clears targets, and missing or invalid regions use individual safe fallbacks', () => {
  let sample: Record<string, number> | null = { caption: 0 };
  const controller = new HudContrastController({ sampler: () => sample });
  const media = source();
  controller.update(media, 'one', regions, 0);
  controller.update(media, 'one', regions, 200);
  sample = null;
  assert.deepEqual(controller.update(media, 'one', regions, 250), { status: 'waiting', alpha: { caption: HUD_CONTRAST_FALLBACK_ALPHA } });
  sample = { caption: 0, invalid: NaN };
  const result = controller.update(media, 'one', { ...regions, missing: full, invalid: full }, 500);
  assert.equal(result.status, 'fallback');
  assert.ok(result.alpha.caption < HUD_CONTRAST_FALLBACK_ALPHA);
  assert.equal(result.alpha.missing, HUD_CONTRAST_FALLBACK_ALPHA);
  assert.equal(result.alpha.invalid, HUD_CONTRAST_FALLBACK_ALPHA);
});

test('a security failure latches fallback without repeated reads and a new identity can recover', () => {
  let reads = 0, fail = false;
  const controller = new HudContrastController({ sampler: () => {
    reads++;
    if (fail) throw new DOMException('Tainted canvas', 'SecurityError');
    return { caption: 0 };
  } });
  const media = source();
  controller.update(media, 'one', regions, 0);
  controller.update(media, 'one', regions, 200);
  fail = true;
  assert.deepEqual(controller.update(media, 'one', regions, 250), { status: 'fallback', alpha: { caption: HUD_CONTRAST_FALLBACK_ALPHA } });
  for (let time = 500; time < 5000; time += 250) controller.update(media, 'one', regions, time);
  assert.equal(reads, 2);
  fail = false;
  assert.equal(controller.update(media, 'two', regions, 5000).status, 'adaptive');
  assert.equal(reads, 3);
  controller.reset();
  controller.update(media, 'two', regions, 5001);
  assert.equal(reads, 4);
});

test('reduced motion uses deterministic readable backing and performs no pixel reads', () => {
  let reads = 0;
  const controller = new HudContrastController({ sampler: () => { reads++; return { caption: 0 }; } });
  const media = source();
  const expected = { status: 'fallback', alpha: { caption: HUD_CONTRAST_FALLBACK_ALPHA } };
  for (const time of [0, 16, 1000, 10000]) assert.deepEqual(controller.update(media, 'one', regions, time, true), expected);
  assert.equal(reads, 0);
  controller.update(media, 'one', regions, 10016);
  assert.equal(reads, 1);
  assert.deepEqual(controller.update(media, 'one', regions, 10032, true), expected);
});

test('new or moved regions start conservatively without reusing unrelated spatial samples', () => {
  const controller = new HudContrastController({ sampler: (_source, current) => Object.fromEntries(Object.keys(current).map(key => [key, 0])) });
  const media = source();
  const geometry = { caption: { ...full } };
  controller.update(media, 'one', geometry, 0);
  assert.ok(controller.update(media, 'one', geometry, 100).alpha.caption < HUD_CONTRAST_FALLBACK_ALPHA);
  geometry.caption.x = .5;
  const moved = controller.update(media, 'one', geometry, 120);
  assert.equal(moved.alpha.caption, HUD_CONTRAST_FALLBACK_ALPHA);
  assert.equal(moved.status, 'waiting');
  const replaced = controller.update(media, 'one', { keyboard: full }, 140);
  assert.deepEqual(replaced.alpha, { keyboard: HUD_CONTRAST_FALLBACK_ALPHA });
  const empty = controller.update(media, 'one', {}, 150);
  assert.deepEqual(empty, { status: 'waiting', alpha: {} });
});

test('nonfinite and rewound clocks cannot trigger runaway sampling or invalid output', () => {
  let reads = 0;
  const controller = new HudContrastController({ sampler: () => { reads++; return { caption: 0 }; } });
  const media = source();
  for (const time of [1000, NaN, Infinity, -Infinity, 900, 900, 1000, 1149]) {
    const result = controller.update(media, 'one', regions, time);
    assert.ok(Number.isFinite(result.alpha.caption));
  }
  assert.equal(reads, 1);
  controller.update(media, 'one', regions, 1150);
  assert.equal(reads, 2);
});

test('input pixels and region records remain unchanged, including ordinary prototype-like keys', () => {
  const pixels = frame(140), before = pixels.slice();
  const geometry: HudContrastRegions = Object.freeze(Object.fromEntries(['caption', '__proto__', 'constructor'].map(key => [key, Object.freeze({ ...full })])));
  const means = analyzeHudLuminance(pixels, 8, 4, geometry);
  const controller = new HudContrastController({ sampler: () => Object.freeze(means) });
  const result = controller.update(source(), 'one', geometry, 0);
  assert.deepEqual(Object.keys(result.alpha), ['caption', '__proto__', 'constructor']);
  assert.deepEqual(pixels, before);
  assert.deepEqual(geometry.caption, full);
});

test('default sampler owns one tiny offscreen canvas and never reads or modifies the source canvas', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  const allocations: number[][] = [];
  let reads = 0, clears = 0;
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class {
    constructor(width: number, height: number) {
      allocations.push([width, height]);
      const canvas = createCanvas(width, height), context = canvas.getContext('2d');
      const read = context.getImageData.bind(context), clear = context.clearRect.bind(context);
      context.getImageData = ((...args: Parameters<typeof read>) => { reads++; return read(...args); }) as typeof context.getImageData;
      context.clearRect = ((...args: Parameters<typeof clear>) => { clears++; return clear(...args); }) as typeof context.clearRect;
      return canvas;
    }
  } });
  try {
    const canvas = createCanvas(192, 108), context = canvas.getContext('2d');
    context.fillStyle = '#000000'; context.fillRect(0, 0, 96, 108);
    context.fillStyle = '#ffffff'; context.fillRect(96, 0, 96, 108);
    const before = canvas.toBuffer('image/png');
    context.getImageData = () => { throw new Error('Must never sample the source/display canvas'); };
    const controller = new HudContrastController();
    const geometry = { dark: { x: 0, y: 0, w: .5, h: 1 }, light: { x: .5, y: 0, w: .5, h: 1 } };
    let result = controller.update(canvas as unknown as CanvasImageSource, 'one', geometry, 0);
    assert.equal(result.status, 'adaptive');
    for (let time = 16; time < 3000; time += 16) result = controller.update(canvas as unknown as CanvasImageSource, 'one', geometry, time);
    assert.ok(result.alpha.dark < .305);
    close(result.alpha.light, .78);
    assert.deepEqual(allocations, [[96, 54]]);
    assert.equal(reads, clears);
    assert.ok(reads <= 12);
    assert.deepEqual(canvas.toBuffer('image/png'), before);
    const darkBeforeClear = result.alpha.dark;
    context.clearRect(0, 0, 192, 108);
    const afterClear = controller.update(canvas as unknown as CanvasImageSource, 'one', geometry, 3250);
    assert.ok(afterClear.alpha.dark > darkBeforeClear, 'the private canvas clears old opaque pixels before sampling transparent content');
  } finally {
    if (original) Object.defineProperty(globalThis, 'OffscreenCanvas', original);
    else Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
  }
});

test('default CORS failure discards its tainted canvas and allocates a clean one for a new source', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  let allocations = 0, reads = 0;
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class {
    constructor(width: number, height: number) {
      const index = ++allocations;
      const canvas = createCanvas(width, height), context = canvas.getContext('2d');
      const read = context.getImageData.bind(context);
      context.getImageData = ((...args: Parameters<typeof read>) => {
        reads++;
        if (index === 1) throw new DOMException('Cross-origin pixels', 'SecurityError');
        return read(...args);
      }) as typeof context.getImageData;
      return canvas;
    }
  } });
  try {
    const canvas = createCanvas(192, 108) as unknown as CanvasImageSource;
    const controller = new HudContrastController();
    const fallback = { status: 'fallback', alpha: { caption: HUD_CONTRAST_FALLBACK_ALPHA } };
    assert.deepEqual(controller.update(canvas, 'tainted', regions, 0), fallback);
    assert.deepEqual(controller.update(canvas, 'tainted', regions, 1000), fallback);
    assert.equal(allocations, 1);
    assert.equal(reads, 1);
    assert.equal(controller.update(canvas, 'clean', regions, 1001).status, 'adaptive');
    assert.equal(allocations, 2);
    assert.equal(reads, 2);
  } finally {
    if (original) Object.defineProperty(globalThis, 'OffscreenCanvas', original);
    else Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
  }
});

test('an environment without any local canvas API returns fallback instead of throwing', () => {
  const names = ['OffscreenCanvas', 'document'] as const;
  const originals = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: undefined });
  try {
    const controller = new HudContrastController(), media = source();
    const expected = { status: 'fallback', alpha: { caption: HUD_CONTRAST_FALLBACK_ALPHA } };
    assert.deepEqual(controller.update(media, 'one', regions, 0), expected);
    assert.deepEqual(controller.update(media, 'one', regions, 10000), expected);
  } finally {
    names.forEach((name, index) => {
      const original = originals[index];
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});
