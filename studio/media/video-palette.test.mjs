import test from 'node:test';
import assert from 'node:assert/strict';
import { VideoPaletteController, INITIAL_VIDEO_PALETTE_STATE } from './video-palette.ts';
import { validateVideoPalette, analyzeVideoPalette, createVideoPalette } from '../scene/video-palette.ts';

class Target extends EventTarget {
  listeners = 0;
  addEventListener(...args) { this.listeners++; super.addEventListener(...args); }
  removeEventListener(...args) { this.listeners--; super.removeEventListener(...args); }
  emit(name) { this.dispatchEvent(new Event(name)); }
}
class Video extends Target {
  videoWidth = 1920; videoHeight = 1080; readyState = 2; paused = true; ended = false; seeking = false;
  get currentTime() { return 17; }
  set currentTime(value) { assert.fail(`video seeking is forbidden (${value})`); }
  play() { assert.fail('autoplay is forbidden'); }
  pause() { assert.fail('playback mutations are forbidden'); }
}
function pixels(rgb) {
  const data = new Uint8ClampedArray(96 * 54 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
  return data;
}
function setup({ video = new Video(), canvasUnavailable = false } = {}) {
  const document = new Target(); document.hidden = false;
  const window = new Target();
  let time = 1000, nextTimer = 1, allocations = 0, reads = 0, draws = 0;
  const timers = new Map(), oldCallbacks = [];
  const palettes = [], states = [];
  const controls = { rgb: [220, 40, 20], error: null, drawHook: null, readHook: null };
  const context = {
    clearRect(x, y, w, h) { assert.deepEqual([x, y, w, h], [0, 0, 96, 54]); },
    drawImage(source, ...rect) {
      draws++; assert.strictEqual(source, video); assert.deepEqual(rect, [0, 0, 96, 54]);
      controls.drawHook?.();
    },
    getImageData(...rect) {
      reads++; assert.deepEqual(rect, [0, 0, 96, 54]);
      controls.readHook?.();
      if (controls.error) throw controls.error;
      return { data: pixels(controls.rgb) };
    },
  };
  const controller = new VideoPaletteController(video, {
    onPalette: value => palettes.push(value), onState: value => states.push(value), document, window,
    now: () => time,
    createCanvas() {
      allocations++;
      return { width: 0, height: 0, getContext(type, options) {
        assert.equal(type, '2d'); assert.deepEqual(options, { willReadFrequently: true });
        assert.equal(this.width, 96); assert.equal(this.height, 54);
        return canvasUnavailable ? null : context;
      } };
    },
    setTimeout(callback, delay) {
      assert.equal(delay, 125); const id = nextTimer++;
      timers.set(id, callback); oldCallbacks.push(callback); return id;
    },
    clearTimeout(id) { timers.delete(id); },
  });
  return { controller, video, document, window, palettes, states, controls, timers, oldCallbacks,
    latest: () => palettes.at(-1), counters: () => ({ allocations, reads, draws }),
    tick() { time += 125; const current = [...timers.entries()]; timers.clear(); for (const [, callback] of current) callback(); },
    advance(ms = 125) { time += ms; },
  };
}

test('constructor and OFF remain lazy even with all media/lifecycle events; never touch playback', () => {
  const s = setup();
  assert.strictEqual(s.controller.getSnapshot(), INITIAL_VIDEO_PALETTE_STATE);
  assert.deepEqual(s.palettes, [null]);
  for (const event of ['loadeddata', 'canplay', 'playing', 'pause', 'seeked', 'emptied', 'loadstart', 'error']) s.video.emit(event);
  s.controller.setReducedMotion(true); s.controller.lock(); s.controller.unlock();
  s.document.emit('visibilitychange'); s.window.emit('pagehide'); s.window.emit('pageshow');
  assert.deepEqual(s.counters(), { allocations: 0, reads: 0, draws: 0 });
  assert.equal(s.timers.size, 0); assert.equal(s.video.currentTime, 17);
  assert.equal(s.states.length, 1);
  s.controller.dispose();
});

test('first valid decoded frame requires dimensions and readyState, without autoplay or seek', () => {
  const s = setup(); s.video.readyState = 1; s.video.videoWidth = 0;
  s.controller.setMode('frame');
  assert.equal(s.controller.getSnapshot().status, 'waiting');
  assert.equal(s.counters().allocations, 0);
  s.video.emit('loadeddata'); assert.equal(s.counters().reads, 0);
  s.video.readyState = 2; s.video.videoWidth = 1920; s.video.emit('loadeddata');
  assert.ok(validateVideoPalette(s.latest())); assert.equal(s.counters().reads, 1);
  assert.equal(s.controller.getSnapshot().status, 'active');
  const captured = s.latest(); s.controls.rgb = [0, 0, 255];
  s.video.emit('seeked'); s.video.paused = false; s.video.emit('playing'); s.tick();
  assert.strictEqual(s.latest(), captured); assert.equal(s.counters().reads, 1); assert.equal(s.timers.size, 0);
  s.controller.dispose();
});

test('blank first frames use defaults until a flat chromatic frame becomes available', () => {
  const s = setup(); s.controls.rgb = [0, 0, 0];
  s.controller.setMode('frame'); assert.equal(s.latest(), null);
  s.controls.rgb = [255, 255, 255]; s.advance(); s.video.emit('seeked'); assert.equal(s.latest(), null);
  s.controls.rgb = [0, 0, 255]; s.advance(); s.video.emit('seeked');
  assert.ok(validateVideoPalette(s.latest())); assert.equal(s.controller.getSnapshot().hasPalette, true);
  s.controller.dispose();
});

test('follow samples only at 8Hz, preserves palette through black/white flash and does not emit state each frame', () => {
  const s = setup(); s.video.paused = false; s.controller.setMode('follow');
  const first = s.latest(), stateCount = s.states.length;
  assert.equal(s.counters().reads, 1); assert.equal(s.timers.size, 1);
  s.video.emit('canplay'); s.video.emit('playing'); assert.equal(s.counters().reads, 1);
  s.controls.rgb = [255, 255, 255]; s.tick(); assert.strictEqual(s.latest(), first);
  s.controls.rgb = [0, 0, 0]; s.tick(); assert.strictEqual(s.latest(), first);
  s.controls.rgb = [0, 0, 255]; for (let i = 0; i < 8; i++) s.tick();
  assert.notDeepEqual(s.latest(), first); assert.equal(s.states.length, stateCount);
  assert.equal(s.counters().reads, 11); assert.equal(s.timers.size, 1);
  assert.ok(Object.isFrozen(s.controller.getDiagnostics()));
  assert.equal(s.controller.getDiagnostics().analyzedFrames, 11);
  assert.equal(s.controller.getDiagnostics().acceptedFrames, 9);
  s.controller.dispose();
});

test('pause stops periodic work, paused seek does one sample, and playing resumes without changing media', () => {
  const s = setup(); s.video.paused = false; s.controller.setMode('follow');
  s.video.paused = true; s.video.emit('pause');
  const reads = s.counters().reads;
  assert.equal(s.controller.getSnapshot().status, 'paused'); assert.equal(s.timers.size, 0);
  s.tick(); assert.equal(s.counters().reads, reads);
  s.controls.rgb = [0, 255, 0]; s.video.emit('seeked');
  assert.equal(s.counters().reads, reads + 1); assert.equal(s.timers.size, 0);
  s.video.seeking = true; s.video.emit('seeking'); s.video.emit('canplay'); assert.equal(s.timers.size, 0);
  s.video.seeking = false; s.video.emit('seeked'); assert.equal(s.timers.size, 0);
  s.video.paused = false; s.video.emit('playing'); s.tick(); assert.equal(s.timers.size, 1);
  s.video.ended = true; s.video.emit('ended'); assert.equal(s.timers.size, 0);
  assert.equal(s.video.currentTime, 17); s.controller.dispose();
});

test('hidden/pagehide stop all reads; visible/pageshow resume only sampling', () => {
  const s = setup(); s.video.paused = false; s.controller.setMode('follow');
  const stale = s.oldCallbacks.at(-1);
  s.document.hidden = true; s.document.emit('visibilitychange');
  const reads = s.counters().reads; assert.equal(s.timers.size, 0); assert.equal(s.controller.getSnapshot().status, 'paused');
  s.tick(); stale(); s.video.emit('seeked'); assert.equal(s.counters().reads, reads);
  s.document.hidden = false; s.document.emit('visibilitychange'); assert.equal(s.timers.size, 1);
  assert.equal(s.counters().reads, reads + 1);
  s.window.emit('pagehide'); assert.equal(s.timers.size, 0);
  s.advance(); s.video.emit('seeked'); assert.equal(s.counters().reads, reads + 1);
  s.window.emit('pageshow'); assert.equal(s.counters().reads, reads + 2); assert.equal(s.timers.size, 1);
  s.controller.dispose();
});

test('reduced motion captures one static palette, keeps chosen mode, and resumes follow when disabled', () => {
  const s = setup(); s.video.paused = false; s.controller.setReducedMotion(true); s.controller.setMode('follow');
  const first = s.latest(); assert.equal(s.counters().reads, 1); assert.equal(s.timers.size, 0);
  assert.equal(s.controller.getSnapshot().mode, 'follow'); assert.match(s.controller.getSnapshot().message, /静态/);
  s.controls.rgb = [0, 0, 255]; s.advance(); s.video.emit('seeked'); assert.strictEqual(s.latest(), first);
  s.controller.setReducedMotion(false); assert.equal(s.counters().reads, 2); assert.equal(s.timers.size, 1);
  s.controller.setReducedMotion(true); assert.equal(s.timers.size, 0);
  s.controller.dispose();
});

test('manual lock snapshots current palette, survives mode/source changes, and OFF alone clears it', () => {
  const s = setup(); s.video.paused = false; s.controller.setMode('follow'); s.controller.lock();
  const first = s.latest(), reads = s.counters().reads;
  assert.equal(s.controller.getSnapshot().status, 'locked'); assert.equal(s.timers.size, 0);
  s.controls.rgb = [0, 255, 0]; s.tick(); s.video.emit('seeked'); assert.equal(s.counters().reads, reads);
  s.controller.setMode('frame'); assert.strictEqual(s.latest(), first); assert.equal(s.controller.getSnapshot().locked, true);
  s.controller.sourceChanged('video'); s.video.emit('loadeddata');
  assert.strictEqual(s.latest(), first); assert.equal(s.controller.getSnapshot().locked, true);
  s.controller.unlock(); assert.notDeepEqual(s.latest(), first); assert.equal(s.controller.getSnapshot().locked, false);
  s.controller.lock(); s.controller.sourceChanged('image'); assert.equal(s.controller.getSnapshot().status, 'locked');
  s.controller.unlock(); assert.equal(s.latest(), null); assert.equal(s.controller.getSnapshot().status, 'unavailable');
  s.controller.sourceChanged('demo'); s.video.emit('loadeddata'); s.controller.lock();
  s.controller.setMode('off'); assert.equal(s.latest(), null); assert.equal(s.controller.getSnapshot().locked, false);
  assert.deepEqual(s.controller.getSnapshot(), INITIAL_VIDEO_PALETTE_STATE); assert.equal(s.timers.size, 0);
  s.controller.dispose();
});

test('unlock resumes the chosen follow mode and OFF/on starts a fresh capture', () => {
  const s = setup(); s.video.paused = false; s.controller.setMode('follow'); s.controller.lock();
  s.controls.rgb = [0, 0, 255]; s.controller.unlock();
  assert.equal(s.counters().reads, 2); assert.equal(s.timers.size, 1);
  s.controller.setMode('off'); const allocations = s.counters().allocations;
  s.controller.setMode('frame'); assert.ok(s.latest()); assert.equal(s.counters().allocations, allocations + 1);
  s.controller.dispose();
});

test('source replacement immediately clears unlocked colors and cannot sample old decoded pixels or queued callbacks', () => {
  const s = setup(); s.video.paused = false; s.controller.setMode('follow');
  const stale = s.oldCallbacks.at(-1), previousReads = s.counters().reads;
  s.controller.sourceChanged('video'); assert.equal(s.latest(), null); assert.equal(s.timers.size, 0);
  stale(); s.video.emit('canplay'); s.video.emit('seeked'); assert.equal(s.counters().reads, previousReads);
  s.controls.rgb = [0, 0, 255]; s.video.emit('loadeddata');
  assert.ok(s.latest()); assert.equal(s.counters().reads, previousReads + 1);
  const next = s.latest(); stale(); assert.strictEqual(s.latest(), next);
  s.video.emit('emptied'); assert.equal(s.latest(), null); s.video.emit('loadstart'); s.video.emit('loadeddata'); assert.ok(s.latest());
  s.controller.dispose();
});

test('stale synchronous draw/read completions cannot publish pixels after source reset or disposal', () => {
  for (const hook of ['drawHook', 'readHook']) {
    const s = setup(); s.controls[hook] = () => s.controller.sourceChanged('video');
    s.controller.setMode('follow'); assert.equal(s.latest(), null); assert.equal(s.controller.getSnapshot().hasPalette, false);
    s.controls[hook] = null; s.video.emit('loadeddata'); assert.ok(s.latest()); s.controller.dispose();
  }
  const s = setup(); s.controls.readHook = () => s.controller.dispose(); s.controller.setMode('follow');
  assert.equal(s.latest(), null); assert.equal(s.states.length, 1); assert.equal(s.timers.size, 0);
});

test('SecurityError clears derived palette and is latched once per source without retrying or harming playback', () => {
  const s = setup(); s.video.paused = false; s.controller.setMode('follow');
  s.controls.error = new DOMException('blocked', 'SecurityError'); s.tick();
  assert.equal(s.latest(), null); assert.equal(s.controller.getSnapshot().status, 'unavailable');
  assert.match(s.controller.getSnapshot().message, /不允许读取/); assert.equal(s.timers.size, 0);
  const reads = s.counters().reads, states = s.states.length;
  for (let i = 0; i < 4; i++) { s.video.emit('seeked'); s.video.emit('loadeddata'); s.tick(); }
  assert.equal(s.counters().reads, reads); assert.equal(s.states.length, states);
  s.controller.setMode('off'); s.controller.setMode('follow'); assert.equal(s.counters().reads, reads);
  s.controls.error = null; s.controller.sourceChanged('video'); s.video.emit('loadeddata'); assert.ok(s.latest());
  assert.equal(s.video.currentTime, 17); s.controller.dispose();
});

test('missing context, read errors, video errors and image source all fall back accurately', () => {
  const unavailable = setup({ canvasUnavailable: true }); unavailable.controller.setMode('frame');
  assert.equal(unavailable.controller.getSnapshot().status, 'unavailable'); assert.match(unavailable.controller.getSnapshot().message, /不支持/);
  unavailable.controller.dispose();
  const s = setup(); s.controls.error = new Error('read failed'); s.controller.setMode('frame');
  assert.match(s.controller.getSnapshot().message, /无法读取/); assert.equal(s.latest(), null);
  s.controls.error = null; s.controller.sourceChanged('video'); s.video.emit('loadeddata'); assert.ok(s.latest());
  s.video.emit('error'); assert.equal(s.latest(), null); assert.match(s.controller.getSnapshot().message, /画面不可用/);
  s.controller.sourceChanged('image'); const reads = s.counters().reads;
  s.video.emit('loadeddata'); s.video.emit('seeked'); assert.equal(s.counters().reads, reads);
  assert.match(s.controller.getSnapshot().message, /图片/); s.controller.dispose();
});

test('dispose removes all listeners, cancels timers and makes stale callbacks and public methods inert', () => {
  const s = setup(); s.video.paused = false; s.controller.setMode('follow');
  const stale = s.oldCallbacks.at(-1), reads = s.counters().reads, states = s.states.length, palettes = s.palettes.length;
  s.controller.dispose(); s.controller.dispose();
  assert.equal(s.video.listeners, 0); assert.equal(s.document.listeners, 0); assert.equal(s.window.listeners, 0); assert.equal(s.timers.size, 0);
  stale(); s.video.emit('loadeddata'); s.controller.setMode('frame'); s.controller.setReducedMotion(true);
  s.controller.sourceChanged('video'); s.controller.lock(); s.controller.unlock(); s.tick();
  assert.equal(s.counters().reads, reads); assert.equal(s.states.length, states); assert.equal(s.palettes.length, palettes);
});


test('seeked resets follow smoothing without discarding the previous palette on a white flash', () => {
  const s = setup(); s.video.paused = false; s.controller.setMode('follow');
  const before = s.latest(), stale = s.oldCallbacks.at(-1);
  s.video.paused = true; s.video.seeking = true; s.video.emit('seeking');
  const reads = s.counters().reads; stale(); assert.equal(s.counters().reads, reads);
  s.controls.rgb = [255, 255, 255]; s.video.seeking = false; s.video.emit('seeked');
  assert.strictEqual(s.latest(), before, 'flash keeps the last accepted output');
  s.controls.rgb = [0, 0, 255]; s.video.seeking = true; s.video.emit('seeking');
  s.video.seeking = false; s.video.emit('seeked');
  const expected = createVideoPalette(analyzeVideoPalette(pixels([0, 0, 255]), 96, 54).tone);
  assert.deepEqual(s.latest(), expected, 'the new location has no hue mixture from the old position');
  assert.equal(s.timers.size, 0);
  s.controller.dispose();
});

test('monochrome seek retains the prior hue while resetting brightness smoothing', () => {
  const s = setup(); s.controller.setMode('follow');
  const previous = analyzeVideoPalette(pixels(s.controls.rgb), 96, 54).tone;
  s.controls.rgb = [120, 120, 120]; s.video.emit('seeked');
  const expected = createVideoPalette(analyzeVideoPalette(pixels(s.controls.rgb), 96, 54, previous.hue).tone);
  assert.deepEqual(s.latest(), expected); s.controller.dispose();
});


test('media errors cannot clear a manual lock; unlocking an unreadable source safely falls back', () => {
  const s = setup(); s.controller.setMode('follow'); s.controller.lock();
  const locked = s.latest(), reads = s.counters().reads, stateCount = s.states.length;
  s.video.emit('error');
  assert.strictEqual(s.latest(), locked); assert.equal(s.controller.getSnapshot().locked, true);
  assert.equal(s.controller.getSnapshot().status, 'locked'); assert.equal(s.states.length, stateCount);
  s.controller.sourceChanged('video'); s.video.emit('loadeddata'); s.video.emit('error');
  assert.strictEqual(s.latest(), locked); assert.equal(s.counters().reads, reads);
  s.controls.error = new DOMException('blocked', 'SecurityError'); s.controller.unlock();
  assert.equal(s.latest(), null); assert.equal(s.controller.getSnapshot().locked, false);
  assert.equal(s.controller.getSnapshot().status, 'unavailable'); s.controller.dispose();
});

for (const mode of ['frame', 'follow']) test(`same-source ${mode} unlock remembers a playback failure observed while locked`, () => {
  const s = setup(); s.controller.setMode(mode); s.controller.lock();
  const frozen = s.latest(), reads = s.counters().reads;
  s.video.readyState = 1; s.video.emit('error');
  assert.strictEqual(s.latest(), frozen); assert.equal(s.controller.getSnapshot().status, 'locked');
  assert.equal(s.controller.getSnapshot().hasPalette, true); assert.equal(s.counters().reads, reads);
  s.controller.unlock();
  assert.equal(s.latest(), null); assert.equal(s.controller.getSnapshot().status, 'unavailable');
  assert.equal(s.controller.getSnapshot().hasPalette, false); assert.equal(s.controller.getSnapshot().locked, false);
  assert.equal(s.counters().reads, reads); assert.equal(s.timers.size, 0);
  // A different, actually decoded source may recover; the failed source never
  // retries itself merely because it is unlocked or the mode changes.
  s.controller.sourceChanged('demo');s.video.readyState = 2;s.video.emit('loadeddata');
  assert.ok(validateVideoPalette(s.latest()));assert.equal(s.controller.getSnapshot().hasPalette, true);
  s.controller.dispose();
});

for (const mode of ['frame', 'follow']) test(`OFF preserves a source error without sampling; ${mode} enable reports unavailable until replacement`, () => {
  const s = setup();s.video.readyState = 1;s.video.emit('error');
  assert.strictEqual(s.controller.getSnapshot(), INITIAL_VIDEO_PALETTE_STATE);
  assert.equal(s.counters().allocations, 0);assert.equal(s.states.length, 1);
  s.controller.setMode(mode);
  assert.equal(s.controller.getSnapshot().status, 'unavailable');assert.equal(s.latest(), null);
  assert.equal(s.counters().reads, 0);assert.equal(s.timers.size, 0);
  s.controller.sourceChanged('demo');s.video.readyState = 2;s.video.emit('loadeddata');
  assert.ok(validateVideoPalette(s.latest()));s.controller.dispose();
});

test('only a genuinely valid loadeddata recovers playback failure; it does not retry pixel security failure', () => {
  const s = setup();s.video.readyState = 1;s.video.emit('error');s.controller.setMode('frame');
  s.video.emit('loadeddata');assert.equal(s.controller.getSnapshot().status, 'unavailable');
  s.video.readyState = 2;s.video.emit('loadeddata');
  assert.ok(validateVideoPalette(s.latest()));assert.equal(s.controller.getSnapshot().status, 'active');
  s.controller.sourceChanged('video');s.controls.error = new DOMException('blocked','SecurityError');s.video.emit('loadeddata');
  assert.equal(s.controller.getSnapshot().status, 'unavailable');const reads = s.counters().reads;
  s.video.emit('loadeddata');assert.equal(s.counters().reads, reads);
  assert.equal(s.controller.getSnapshot().status, 'unavailable');s.controller.dispose();
});

for (const mode of ['frame', 'follow']) test(`pixel-read failure remains latched across OFF, media error and loadeddata before ${mode}`, () => {
  const s = setup(); s.controls.error = new DOMException('blocked', 'SecurityError');
  s.controller.setMode(mode); const reads = s.counters().reads;
  assert.equal(reads, 1); assert.match(s.controller.getSnapshot().message, /不允许读取/);
  s.controller.setMode('off'); s.video.readyState = 1; s.video.emit('error');
  assert.deepEqual(s.controller.getSnapshot(), INITIAL_VIDEO_PALETTE_STATE);
  s.controls.error = null; s.video.readyState = 2; s.video.emit('loadeddata');
  s.controller.setMode(mode);
  assert.equal(s.counters().reads, reads); assert.equal(s.latest(), null);
  assert.equal(s.controller.getSnapshot().status, 'unavailable');
  assert.match(s.controller.getSnapshot().message, /不允许读取/); assert.equal(s.timers.size, 0);
  s.controller.sourceChanged('demo'); s.video.emit('loadeddata');
  assert.equal(s.counters().reads, reads + 1); assert.ok(validateVideoPalette(s.latest()));
  s.controller.dispose();
});
