import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_WHITE_NOISE_SNAPSHOT, WhiteNoiseAudio, WhiteNoiseAudioError,
} from './white-noise-audio.ts';

function gate() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function seededRandom(seed = 123456789) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

class TrackedTarget extends EventTarget {
  listeners = new Map();
  addEventListener(type, callback, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
    super.addEventListener(type, callback, options);
  }
  removeEventListener(type, callback, options) {
    this.listeners.get(type)?.delete(callback);
    super.removeEventListener(type, callback, options);
  }
  listenerCount() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

class Visibility extends TrackedTarget {
  hidden = false;
  hide() { this.hidden = true; this.dispatchEvent(new Event('visibilitychange')); }
  show() { this.hidden = false; this.dispatchEvent(new Event('visibilitychange')); }
}

class FakeParam {
  value = 0;
  calls = [];
  cancelScheduledValues(time) { this.calls.push(['cancel', time]); }
  setValueAtTime(value, time) { this.value = value; this.calls.push(['set', value, time]); }
  setTargetAtTime(value, time, constant) { this.value = value; this.calls.push(['target', value, time, constant]); }
}

class FakeNode extends TrackedTarget {
  connections = [];
  disconnectCount = 0;
  connect(target) { this.connections.push(target); }
  disconnect() { this.disconnectCount++; this.connections.length = 0; }
}

class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeSource extends FakeNode {
  buffer = null;
  loop = false;
  playbackRate = { value: 1 };
  startCount = 0;
  stopCount = 0;
  start() { this.startCount++; }
  stop() { this.stopCount++; this.dispatchEvent(new Event('ended')); }
}

class FakeBuffer {
  constructor(numberOfChannels, length, sampleRate) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel) { return this.channels[channel]; }
}

class FakeContext extends TrackedTarget {
  currentTime = 12;
  sampleRate = 8000;
  state = 'suspended';
  destination = {};
  gains = [];
  sources = [];
  buffers = [];
  resumeCount = 0;
  suspendCount = 0;
  closeCount = 0;
  createGain() { const node = new FakeGain(); this.gains.push(node); return node; }
  createBufferSource() { const node = new FakeSource(); this.sources.push(node); return node; }
  createBuffer(...args) { const buffer = new FakeBuffer(...args); this.buffers.push(buffer); return buffer; }
  setState(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
  resume() {
    this.resumeCount++;
    // Intentionally allow a late resume to resurrect a closed fake context:
    // the controller must still notice cancellation and close it again.
    return (this.resumeGate?.promise ?? Promise.resolve()).then(() => { this.setState('running'); });
  }
  suspend() { this.suspendCount++; this.setState('suspended'); return Promise.resolve(); }
  close() { this.closeCount++; this.setState('closed'); return Promise.resolve(); }
}

function setup(configure = () => {}, options = {}) {
  const contexts = [];
  const visibility = new Visibility();
  const lifecycle = new TrackedTarget();
  const audio = new WhiteNoiseAudio({
    contextFactory: () => {
      const context = new FakeContext();
      configure(context, contexts.length);
      contexts.push(context);
      return context;
    },
    visibilityTarget: visibility,
    lifecycleTarget: lifecycle,
    random: seededRandom(),
    ...options,
  });
  return { audio, contexts, visibility, lifecycle };
}

function assertReleased(context) {
  assert.equal(context.state, 'closed');
  assert.equal(context.listenerCount(), 0);
  for (const source of context.sources) {
    assert.equal(source.stopCount, source.startCount);
    assert.equal(source.disconnectCount, 1);
    assert.deepEqual(source.connections, []);
    assert.equal(source.buffer, null);
    assert.equal(source.listenerCount(), 0);
  }
  for (const gain of context.gains) {
    assert.equal(gain.gain.value, 0);
    assert.equal(gain.disconnectCount, 1);
    assert.deepEqual(gain.connections, []);
  }
}

test('default is OFF; immutable stable snapshots and volume changes create no audio graph', () => {
  const { audio, contexts } = setup();
  assert.deepEqual(audio.getSnapshot(), INITIAL_WHITE_NOISE_SNAPSHOT);
  assert.equal(Object.isFrozen(INITIAL_WHITE_NOISE_SNAPSHOT), true);
  const initial = audio.getSnapshot();
  assert.equal(audio.getSnapshot(), initial);
  assert.equal(Object.isFrozen(initial), true);
  assert.throws(() => { initial.enabled = true; }, TypeError);
  let notified = 0;
  const unsubscribe = audio.subscribe(() => { notified++; });
  audio.setVolume(0.7);
  assert.equal(notified, 1);
  assert.equal(audio.getSnapshot().volume, 0.7);
  assert.equal(initial.volume, 0.3);
  const changed = audio.getSnapshot();
  audio.setVolume(0.7);
  assert.equal(audio.getSnapshot(), changed);
  assert.equal(notified, 1);
  unsubscribe();
  audio.setVolume(0.2);
  assert.equal(notified, 1);
  assert.equal(contexts.length, 0);
  audio.dispose();
});

test('explicit enable resumes synchronously, stays silent while pending, and connects only to own destination', async () => {
  const { audio, contexts } = setup();
  const transitions = [];
  audio.subscribe(() => { transitions.push(audio.getSnapshot()); });
  const pending = audio.enable();
  const context = contexts[0];
  assert.equal(context.resumeCount, 1);
  assert.equal(audio.getSnapshot().enabling, true);
  assert.equal(audio.getSnapshot().enabled, false);
  assert.equal(context.gains[0].gain.value, 0);
  assert.equal(context.sources.length, 1);
  assert.equal(context.gains.length, 1);
  assert.deepEqual(context.sources[0].connections, [context.gains[0]]);
  assert.deepEqual(context.gains[0].connections, [context.destination]);
  assert.equal(context.sources[0].loop, true);
  assert.equal(context.sources[0].playbackRate.value, 1);
  await pending;
  assert.equal(audio.getSnapshot().enabled, true);
  assert.equal(audio.getSnapshot().enabling, false);
  assert.equal(context.gains[0].gain.value, 0.012);
  assert.deepEqual(transitions.map(state => [state.enabling, state.enabled]), [[true, false], [false, true]]);
  audio.dispose();
  assertReleased(context);
});

test('duplicate enables share one pending promise and never duplicate a running graph', async () => {
  const delayed = gate();
  const { audio, contexts } = setup(context => { context.resumeGate = delayed; });
  const pending = audio.enable();
  assert.equal(audio.enable(), pending);
  assert.equal(contexts.length, 1);
  delayed.resolve();
  await pending;
  await audio.enable();
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].resumeCount, 1);
  assert.equal(contexts[0].sources[0].startCount, 1);
  audio.dispose();
});

test('volume is normalized, conservative, independently adjustable and never changes speed', async () => {
  const { audio, contexts } = setup();
  audio.setVolume(0);
  await audio.enable();
  const context = contexts[0], master = context.gains[0].gain;
  assert.equal(master.value, 0);
  assert.equal(audio.getSnapshot().enabled, true);
  for (const [input, normalized] of [[0.5, 0.5], [100, 1], [-1, 0], [NaN, 0], [Infinity, 0], [-Infinity, 0]]) {
    audio.setVolume(input);
    assert.equal(audio.getSnapshot().volume, normalized);
    assert.equal(master.value, normalized * 0.04);
    assert.equal(context.sources[0].playbackRate.value, 1);
    assert.equal(context.resumeCount, 1);
  }
  audio.setVolume(1);
  assert.deepEqual(master.calls.at(-1), ['target', 0.04, context.currentTime, 0.015]);
  audio.disable();
  audio.setVolume(0.9);
  assert.equal(contexts.length, 1);
  assert.equal(audio.getSnapshot().enabled, false);
  assert.equal(master.value, 0);
  audio.dispose();
});

test('latest volume chosen during unlock is used only after resume succeeds', async () => {
  const delayed = gate();
  const { audio, contexts } = setup(context => { context.resumeGate = delayed; });
  const pending = audio.enable();
  audio.setVolume(0.8);
  assert.equal(contexts[0].gains[0].gain.value, 0);
  delayed.resolve();
  await pending;
  assert.equal(contexts[0].gains[0].gain.value, 0.032);
  audio.dispose();
});

test('constructor volume options are normalized without creating any resources', () => {
  for (const [volume, expected] of [[-1, 0], [2, 1], [NaN, 0], [Infinity, 0], [0.6, 0.6]]) {
    const { audio, contexts } = setup(() => {}, { volume });
    assert.equal(audio.getSnapshot().volume, expected);
    assert.equal(contexts.length, 0);
    audio.dispose();
  }
});

test('hidden state immediately stops and releases; foreground never resumes automatically', async () => {
  const { audio, contexts, visibility } = setup();
  await audio.enable();
  visibility.hide();
  assert.equal(audio.getSnapshot().enabled, false);
  assert.equal(audio.getSnapshot().enabling, false);
  assert.equal(audio.getSnapshot().disableReason, 'hidden');
  assertReleased(contexts[0]);
  const snapshot = audio.getSnapshot();
  visibility.show();
  assert.equal(audio.getSnapshot(), snapshot);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].resumeCount, 1);
  await audio.enable();
  assert.equal(contexts.length, 2);
  assert.equal(audio.getSnapshot().enabled, true);
  audio.dispose();
});

test('hidden before enable prevents allocation, and silently hidden pending resume is canceled', async () => {
  const delayed = gate();
  const { audio, contexts, visibility } = setup(context => { context.resumeGate = delayed; });
  visibility.hide();
  await assert.rejects(audio.enable(), error => error.code === 'background');
  assert.equal(contexts.length, 0);
  visibility.show();
  const pending = assert.rejects(audio.enable(), error => error.code === 'canceled');
  // Defend even if the browser has not delivered visibilitychange yet.
  visibility.hidden = true;
  delayed.resolve();
  await pending;
  assertReleased(contexts[0]);
  assert.equal(audio.getSnapshot().disableReason, 'hidden');
  audio.dispose();
});

test('old delayed resume cannot resurrect noise, overwrite a newer session, or clear its pending promise', async () => {
  const firstGate = gate(), secondGate = gate();
  const { audio, contexts, visibility } = setup((context, index) => {
    context.resumeGate = index === 0 ? firstGate : secondGate;
  });
  const oldRejected = assert.rejects(audio.enable(), error => error instanceof WhiteNoiseAudioError && error.code === 'canceled');
  visibility.hide();
  visibility.show();
  const newPending = audio.enable();
  firstGate.resolve();
  await oldRejected;
  assert.equal(audio.enable(), newPending);
  assert.equal(audio.getSnapshot().enabling, true);
  assert.equal(audio.getSnapshot().error, null);
  assertReleased(contexts[0]);
  assert.equal(contexts[0].closeCount, 2);
  secondGate.resolve();
  await newPending;
  assert.equal(audio.getSnapshot().enabled, true);
  assert.ok(contexts[1].gains[0].gain.value > 0);
  audio.dispose();
});

test('user disable fences a late rejection without showing an obsolete error', async () => {
  const delayed = gate();
  const { audio, contexts } = setup(context => { context.resumeGate = delayed; });
  const canceled = assert.rejects(audio.enable(), error => error.code === 'canceled');
  audio.disable();
  delayed.reject(new Error('permission denied later'));
  await canceled;
  assert.equal(audio.getSnapshot().disableReason, 'user');
  assert.equal(audio.getSnapshot().error, null);
  assertReleased(contexts[0]);
  audio.dispose();
});

test('pagehide releases immediately; pageshow cannot resume and fresh enable still works', async () => {
  const { audio, contexts, lifecycle } = setup();
  await audio.enable();
  lifecycle.dispatchEvent(new Event('pagehide'));
  assert.equal(audio.getSnapshot().disableReason, 'pagehide');
  assertReleased(contexts[0]);
  lifecycle.dispatchEvent(new Event('pageshow'));
  assert.equal(audio.getSnapshot().enabled, false);
  assert.equal(contexts.length, 1);
  await audio.enable();
  assert.equal(contexts.length, 2);
  audio.dispose();
});

test('pagehide during pending unlock cancels it and keeps the pagehide explanation', async () => {
  const delayed = gate();
  const { audio, contexts, lifecycle } = setup(context => { context.resumeGate = delayed; });
  const canceled = assert.rejects(audio.enable(), error => error.code === 'canceled');
  lifecycle.dispatchEvent(new Event('pagehide'));
  assertReleased(contexts[0]);
  delayed.resolve();
  await canceled;
  assert.equal(audio.getSnapshot().disableReason, 'pagehide');
  assert.equal(audio.getSnapshot().enabled, false);
  assertReleased(contexts[0]);
  audio.dispose();
});

test('context suspension/interruption/closure makes state truthful and never auto-resumes', async () => {
  for (const state of ['suspended', 'interrupted', 'closed']) {
    const { audio, contexts } = setup();
    await audio.enable();
    contexts[0].setState(state);
    assert.equal(audio.getSnapshot().enabled, false);
    assert.equal(audio.getSnapshot().disableReason, 'interrupted');
    assertReleased(contexts[0]);
    contexts[0].setState('running');
    assert.equal(audio.getSnapshot().enabled, false);
    assert.equal(contexts[0].gains[0].gain.value, 0);
    assert.equal(contexts[0].resumeCount, 1);
    audio.dispose();
  }
});

test('unexpected buffer end stops and releases the session rather than reporting enabled', async () => {
  const { audio, contexts } = setup();
  await audio.enable();
  contexts[0].sources[0].dispatchEvent(new Event('ended'));
  assert.equal(audio.getSnapshot().enabled, false);
  assert.equal(audio.getSnapshot().disableReason, 'interrupted');
  assertReleased(contexts[0]);
  audio.dispose();
});

test('resume rejection produces a frozen visible failure and requires an explicit fresh retry', async () => {
  const { audio, contexts } = setup((context, index) => {
    if (index === 0) context.resume = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
  });
  await assert.rejects(audio.enable(), error => error.code === 'enable_failed' && /点击开关重试/.test(error.message));
  const failed = audio.getSnapshot();
  assert.equal(failed.enabled, false);
  assert.equal(failed.enabling, false);
  assert.equal(failed.disableReason, 'error');
  assert.equal(failed.error.code, 'enable_failed');
  assert.equal(Object.isFrozen(failed.error), true);
  assertReleased(contexts[0]);
  assert.equal(contexts.length, 1);
  const retry = audio.enable();
  assert.equal(audio.getSnapshot().error, null);
  await retry;
  assert.equal(contexts.length, 2);
  assert.equal(audio.getSnapshot().enabled, true);
  audio.dispose();
});

test('resolved resume that did not start the context must never report success', async () => {
  const { audio, contexts } = setup(context => { context.resume = () => Promise.resolve(); });
  await assert.rejects(audio.enable(), error => error.code === 'enable_failed');
  assert.equal(audio.getSnapshot().enabled, false);
  assert.equal(audio.getSnapshot().error.code, 'enable_failed');
  assertReleased(contexts[0]);
  audio.dispose();
});

test('factory, partial graph, source start and synchronous resume failures release what was created', async () => {
  for (const failingMethod of ['createGain', 'createBufferSource', 'createBuffer', 'start', 'resume']) {
    const { audio, contexts } = setup(context => {
      if (failingMethod === 'start') {
        const create = context.createBufferSource.bind(context);
        context.createBufferSource = () => {
          const source = create();
          source.start = () => { throw new Error('failed'); };
          return source;
        };
      } else context[failingMethod] = () => { throw new Error('failed'); };
    });
    await assert.rejects(audio.enable(), error => error.code === 'enable_failed');
    assert.equal(audio.getSnapshot().enabling, false);
    assertReleased(contexts[0]);
    audio.dispose();
  }
  const audio = new WhiteNoiseAudio({
    contextFactory: () => { throw new WhiteNoiseAudioError('unavailable'); },
    visibilityTarget: null, lifecycleTarget: null,
  });
  await assert.rejects(audio.enable(), error => error.code === 'unavailable');
  assert.equal(audio.getSnapshot().error.code, 'unavailable');
  audio.dispose();
});

test('dispose removes every listener, cancels pending work and forbids further enables', async () => {
    const delayed = gate();
    const { audio, contexts, visibility, lifecycle } = setup(context => { context.resumeGate = delayed; });
    const canceled = assert.rejects(audio.enable(), error => error.code === 'canceled');
    audio.dispose();
    audio.dispose();
    assert.equal(visibility.listenerCount(), 0);
    assert.equal(lifecycle.listenerCount(), 0);
    assert.equal(audio.getSnapshot().disableReason, 'disposed');
    delayed.resolve();
    await canceled;
    assertReleased(contexts[0]);
    const disposed = audio.getSnapshot();
    audio.setVolume(1);
    audio.disable();
    visibility.hide();
    lifecycle.dispatchEvent(new Event('pagehide'));
    assert.equal(audio.getSnapshot(), disposed);
    await assert.rejects(audio.enable(), error => error.code === 'disposed');
    assert.equal(contexts.length, 1);
});

test('reduced-motion disable is supported, with no implicit resume when volume changes', async () => {
  const { audio, contexts } = setup();
  await audio.enable();
  audio.disable('reduced_motion');
  audio.setVolume(0.5);
  assert.equal(audio.getSnapshot().disableReason, 'reduced_motion');
  assert.equal(audio.getSnapshot().enabled, false);
  assertReleased(contexts[0]);
  assert.equal(contexts.length, 1);
  audio.dispose();
});

test('cleanup is synchronous and resilient to failing browser cleanup and subscriber callbacks', async () => {
  const { audio, contexts, lifecycle, visibility } = setup();
  audio.subscribe(() => { throw new Error('UI listener failure'); });
  let goodListenerCalls = 0;
  audio.subscribe(() => { goodListenerCalls++; });
  await audio.enable();
  const context = contexts[0];
  context.sources[0].stop = () => { throw new Error('already stopped'); };
  context.gains[0].gain.cancelScheduledValues = () => { throw new Error('automation error'); };
  context.suspend = () => Promise.reject(new Error('lifecycle failed'));
  context.close = () => { throw new Error('lifecycle failed'); };
  assert.doesNotThrow(() => audio.dispose());
  assert.equal(audio.getSnapshot().enabled, false);
  assert.equal(context.gains[0].gain.value, 0);
  assert.equal(context.sources[0].buffer, null);
  assert.deepEqual(context.sources[0].connections, []);
  assert.deepEqual(context.gains[0].connections, []);
  assert.equal(context.listenerCount(), 0);
  assert.equal(visibility.listenerCount(), 0);
  assert.equal(lifecycle.listenerCount(), 0);
  assert.equal(goodListenerCalls, 3);
});

test('volume-automation failure or unannounced suspension cannot leave enabled state', async () => {
  for (const failAutomation of [true, false]) {
    const { audio, contexts } = setup();
    await audio.enable();
    if (failAutomation) contexts[0].gains[0].gain.setTargetAtTime = () => { throw new Error('automation failed'); };
    else contexts[0].state = 'suspended';
    audio.setVolume(0.8);
    assert.equal(audio.getSnapshot().volume, 0.8);
    assert.equal(audio.getSnapshot().enabled, false);
    assert.equal(audio.getSnapshot().disableReason, 'interrupted');
    assertReleased(contexts[0]);
    audio.dispose();
  }
});

function correlation(a, b, offset = 0) {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length - offset; i++) {
    ab += a[i] * b[i + offset]; aa += a[i] ** 2; bb += b[i + offset] ** 2;
  }
  return ab / Math.sqrt(aa * bb);
}

// Test-side radix-2 FFT: inspect the actual generated Float32 PCM samples rather
// than merely asserting that a random-number helper was called.
function powerSpectrum(samples, length = 32768) {
  const real = Float64Array.from(samples.subarray(0, length));
  const imag = new Float64Array(length);
  for (let i = 1, j = 0; i < length; i++) {
    let bit = length >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let span = 2; span <= length; span *= 2) {
    const angle = -2 * Math.PI / span;
    for (let start = 0; start < length; start += span) {
      for (let i = 0; i < span / 2; i++) {
        const even = start + i, odd = even + span / 2;
        const cos = Math.cos(angle * i), sin = Math.sin(angle * i);
        const r = real[odd] * cos - imag[odd] * sin;
        const m = real[odd] * sin + imag[odd] * cos;
        real[odd] = real[even] - r; imag[odd] = imag[even] - m;
        real[even] += r; imag[even] += m;
      }
    }
  }
  return Array.from({ length: length / 2 }, (_, i) => real[i] ** 2 + imag[i] ** 2);
}

test('actual two-second PCM has uniform amplitude, near-zero DC, uncorrelated channels and broadband spectrum', async () => {
  const { audio, contexts } = setup(context => { context.sampleRate = 48000; });
  await audio.enable();
  const buffer = contexts[0].sources[0].buffer;
  assert.equal(buffer.numberOfChannels, 2);
  assert.equal(buffer.length, 96000);
  assert.equal(buffer.duration, 2);
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  for (const samples of channels) {
    let sum = 0, squared = 0, min = 1, max = -1;
    const histogram = Array(10).fill(0);
    for (const sample of samples) {
      assert.ok(Number.isFinite(sample) && sample >= -1 && sample <= 1);
      sum += sample; squared += sample ** 2;
      min = Math.min(min, sample); max = Math.max(max, sample);
      histogram[Math.min(9, Math.floor((sample + 1) * 5))]++;
    }
    assert.ok(Math.abs(sum / samples.length) < 0.01, 'DC mean is near zero');
    assert.ok(Math.abs(squared / samples.length - 1 / 3) < 0.01, 'variance matches uniform noise');
    assert.ok(min < -0.99 && max > 0.99, 'full bipolar sample range');
    assert.ok(histogram.every(count => Math.abs(count / samples.length - 0.1) < 0.005), 'uniform amplitude distribution');
    for (const lag of [1, 2, 16, 127, 1024]) {
      assert.ok(Math.abs(correlation(samples, samples, lag)) < 0.02, `low serial correlation at lag ${lag}`);
    }
    const spectrum = powerSpectrum(samples);
    const bandMeans = Array.from({ length: 8 }, (_, band) => {
      const first = Math.max(1, band * 2048), end = (band + 1) * 2048;
      return spectrum.slice(first, end).reduce((sum, power) => sum + power, 0) / (end - first);
    });
    const mean = bandMeans.reduce((sum, power) => sum + power, 0) / bandMeans.length;
    assert.ok(bandMeans.every(power => power > mean * 0.8 && power < mean * 1.2),
      'eight equal-width frequency bands have comparable power, unlike a tonal oscillator');
  }
  assert.ok(Math.abs(correlation(channels[0], channels[1])) < 0.02, 'stereo channels are independently generated');
  audio.dispose();
});

test('all-listening mute preserves white noise preference and never creates a recording bus',async()=>{
 const {audio,contexts}=setup();audio.setMonitorMuted(true);await audio.enable();
 assert.equal(audio.getSnapshot().enabled,true);assert.equal(contexts[0].gains[0].gain.value,0);
 audio.setVolume(.75);assert.equal(contexts[0].gains[0].gain.value,0);
 audio.setMonitorMuted(false);assert.equal(contexts[0].gains[0].gain.value,.75*.04);
 audio.setMonitorMuted(true);audio.disable();await audio.enable();assert.equal(contexts[1].gains[0].gain.value,0);
 audio.dispose();
});
