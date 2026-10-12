import test from 'node:test';
import assert from 'node:assert/strict';
import { StandbyAudio, StandbyAudioError } from './standby-audio.ts';

function gate() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class FakeParam {
  value = 0;
  calls = [];
  cancelScheduledValues(time) { this.calls.push(['cancel', time]); }
  setValueAtTime(value, time) { this.value = value; this.calls.push(['set', value, time]); }
  setTargetAtTime(value, time, constant) { this.value = value; this.calls.push(['target', value, time, constant]); }
}

class FakeNode {
  connections = [];
  disconnectCount = 0;
  connect(target) { this.connections.push(target); }
  disconnect() { this.disconnectCount++; this.connections.length = 0; }
}

class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeOscillator extends FakeNode {
  frequency = new FakeParam();
  startCount = 0;
  stopCount = 0;
  start() { this.startCount++; }
  stop() { this.stopCount++; }
}

class FakeContext {
  currentTime = 12;
  state = 'suspended';
  destination = {};
  gains = [];
  oscillators = [];
  resumeCount = 0;
  suspendCount = 0;
  closeCount = 0;
  createGain() { const node = new FakeGain(); this.gains.push(node); return node; }
  createOscillator() { const node = new FakeOscillator(); this.oscillators.push(node); return node; }
  resume() {
    this.resumeCount++;
    return (this.resumeGate?.promise ?? Promise.resolve()).then(() => { this.state = 'running'; });
  }
  suspend() { this.suspendCount++; this.state = 'suspended'; return Promise.resolve(); }
  close() { this.closeCount++; this.state = 'closed'; return Promise.resolve(); }
}

class Visibility extends EventTarget {
  hidden = false;
  hide() { this.hidden = true; this.dispatchEvent(new Event('visibilitychange')); }
  show() { this.hidden = false; this.dispatchEvent(new Event('visibilitychange')); }
}

function setup(configure = () => {}) {
  const contexts = [];
  const visibility = new Visibility();
  const audio = new StandbyAudio({
    contextFactory: () => {
      const context = new FakeContext();
      configure(context, contexts.length);
      contexts.push(context);
      return context;
    },
    visibilityTarget: visibility,
  });
  const tick = (energy = 1, extra = {}) => audio.update({ energy, active: true, mediaAudible: false, ...extra });
  return { audio, contexts, visibility, tick };
}

test('construction and updates are silent until explicit enable; unlock executes synchronously', async () => {
  const { audio, contexts, tick } = setup();
  tick();
  assert.equal(contexts.length, 0);
  const enabling = audio.enable();
  const context = contexts[0];
  assert.equal(context.resumeCount, 1);
  assert.equal(context.gains[0].gain.value, 0);
  tick();
  assert.equal(context.gains[0].gain.value, 0);
  await enabling;
  assert.equal(context.gains[0].gain.value, 0);
  tick();
  assert.ok(context.gains[0].gain.value > 0);
  assert.deepEqual(context.gains[0].connections, [context.destination]);
  assert.ok(context.oscillators.every(node => node.type === 'sine'));
  audio.dispose();
});

test('energy changes pitch and gain, reaches silence at zero, and ducks under media', async () => {
  const { audio, contexts, tick } = setup();
  await audio.enable();
  const context = contexts[0], master = context.gains[0].gain;
  tick(0.02);
  const lowGain = master.value, lowPitch = context.oscillators[0].frequency.value;
  tick(1);
  const peakGain = master.value, peakPitch = context.oscillators[0].frequency.value;
  assert.ok(lowGain < peakGain / 1000);
  assert.ok(peakPitch > lowPitch);
  assert.ok(peakGain <= 0.014);
  assert.deepEqual(master.calls.at(-1), ['target', peakGain, context.currentTime, 0.01]);
  assert.deepEqual(context.oscillators[0].frequency.calls.at(-1), ['target', peakPitch, context.currentTime, 0.01]);
  assert.equal(context.gains.slice(1).reduce((sum, node) => sum + node.gain.value, 0), 1);
  assert.equal(context.oscillators[1].frequency.value, peakPitch * 2);
  tick(1, { mediaAudible: true });
  assert.ok(master.value > 0 && master.value < peakGain / 4);
  tick(0);
  assert.equal(master.value, 0);
  tick(100);
  assert.equal(master.value, peakGain);
  for (const energy of [-1, NaN, Infinity, -Infinity]) {
    tick(energy);
    assert.equal(master.value, 0);
  }
  audio.dispose();
});

test('inactive and document hidden silence immediately; visibility alone never restarts sound', async () => {
  const { audio, contexts, visibility, tick } = setup();
  await audio.enable();
  const master = contexts[0].gains[0].gain;
  tick();
  tick(1, { active: false });
  assert.equal(master.value, 0);
  tick();
  assert.ok(master.value > 0);
  visibility.hide();
  assert.equal(master.value, 0);
  assert.deepEqual(master.calls.at(-2), ['cancel', 12]);
  assert.deepEqual(master.calls.at(-1), ['set', 0, 12]);
  tick();
  assert.equal(master.value, 0);
  visibility.show();
  assert.equal(master.value, 0);
  tick();
  assert.ok(master.value > 0);
  audio.dispose();
});

test('disable mutes, cancels automation, stops and disconnects all owned nodes synchronously', async () => {
  const { audio, contexts, tick } = setup();
  await audio.enable();
  const context = contexts[0];
  tick();
  audio.disable();
  assert.equal(context.gains[0].gain.value, 0);
  assert.deepEqual(context.gains[0].gain.calls.at(-1), ['set', 0, context.currentTime]);
  assert.ok(context.gains.every(node => node.gain.value === 0 && node.disconnectCount === 1));
  assert.ok(context.oscillators.every(node => node.stopCount === 1 && node.disconnectCount === 1));
  assert.equal(context.suspendCount, 1);
  assert.equal(context.closeCount, 1);
  tick();
  audio.disable();
  assert.equal(context.gains[0].gain.value, 0);
  assert.ok(context.oscillators.every(node => node.stopCount === 1));
  await audio.enable();
  assert.equal(contexts.length, 2);
  assert.equal(contexts[1].gains[0].gain.value, 0);
  audio.dispose();
});

test('a disabled pending unlock cannot resurrect sound or interfere with a newer enable', async () => {
  const delayed = gate();
  const { audio, contexts, tick } = setup((context, index) => { if (index === 0) context.resumeGate = delayed; });
  const pending = audio.enable();
  assert.equal(audio.enable(), pending);
  const canceled = assert.rejects(pending, error => error instanceof StandbyAudioError && error.code === 'canceled');
  const first = contexts[0];
  audio.disable();
  await audio.enable();
  tick();
  assert.ok(contexts[1].gains[0].gain.value > 0);
  delayed.resolve();
  await canceled;
  assert.equal(first.gains[0].gain.value, 0);
  assert.ok(first.oscillators.every(node => node.stopCount === 1 && node.connections.length === 0));
  assert.equal(first.state, 'closed');
  assert.ok(contexts[1].gains[0].gain.value > 0);
  audio.dispose();
});

test('dispose is idempotent, removes the visibility listener, and prevents future unlocks', async () => {
  const { audio, contexts, visibility, tick } = setup();
  await audio.enable();
  tick();
  audio.dispose();
  audio.dispose();
  const context = contexts[0], calls = context.gains[0].gain.calls.length;
  visibility.hide();
  tick();
  assert.equal(context.gains[0].gain.calls.length, calls);
  assert.equal(context.closeCount, 1);
  await assert.rejects(audio.enable(), error => error.code === 'disposed');
  assert.equal(contexts.length, 1);
});

test('resume rejection produces a clear error and releases the failed context', async () => {
  const context = new FakeContext();
  context.resume = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
  const audio = new StandbyAudio({ contextFactory: () => context, visibilityTarget: null });
  await assert.rejects(audio.enable(), error => error.code === 'enable_failed' && /点击开关重试/.test(error.message));
  assert.equal(context.gains[0].gain.value, 0);
  assert.equal(context.state, 'closed');
  assert.ok(context.oscillators.every(node => node.stopCount === 1));
  audio.dispose();
});

test('disposing during unlock cancels a late resolve and never permits another context', async () => {
  const delayed = gate();
  const { audio, contexts, tick } = setup(context => { context.resumeGate = delayed; });
  const canceled = assert.rejects(audio.enable(), error => error.code === 'canceled');
  audio.dispose();
  delayed.resolve();
  await canceled;
  tick();
  assert.equal(contexts[0].gains[0].gain.value, 0);
  assert.equal(contexts[0].state, 'closed');
  await assert.rejects(audio.enable(), error => error.code === 'disposed');
  assert.equal(contexts.length, 1);
});

test('synchronous graph failure releases partial resources and permits a clean retry', async () => {
  const { audio, contexts, tick } = setup((context, index) => {
    if (index === 0) context.createOscillator = () => { throw new Error('graph failed'); };
  });
  await assert.rejects(audio.enable(), error => error.code === 'enable_failed');
  assert.equal(contexts[0].gains[0].gain.value, 0);
  assert.equal(contexts[0].gains[0].disconnectCount, 1);
  assert.equal(contexts[0].state, 'closed');
  await audio.enable();
  tick();
  assert.ok(contexts[1].gains[0].gain.value > 0);
  audio.dispose();
});

test('cleanup continues when one node or browser lifecycle operation fails', async () => {
  const { audio, contexts, tick } = setup();
  await audio.enable();
  tick();
  const context = contexts[0];
  context.oscillators[0].stop = () => { throw new Error('already stopped'); };
  context.suspend = () => Promise.reject(new Error('already closing'));
  context.close = () => { throw new Error('already closing'); };
  assert.doesNotThrow(() => audio.disable());
  assert.equal(context.gains[0].gain.value, 0);
  assert.ok(context.oscillators.every(node => node.connections.length === 0));
  assert.equal(context.oscillators[1].stopCount, 1);
  assert.ok(context.gains.every(node => node.disconnectCount === 1));
  audio.dispose();
});
