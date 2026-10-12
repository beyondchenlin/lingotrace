import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {TypingErrorFeedback} from './typing-error-feedback.ts';
import {
  INITIAL_SUBMISSION_AUDIO_SNAPSHOT, SubmissionAudio, SubmissionAudioError, selectSubmissionCue,
  SUBMISSION_AUDIO_DEDUPE_LIMIT, SUBMISSION_AUDIO_MAX_ID_LENGTH,
} from './submission-audio.ts';

function gate() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
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
  constructor(context) { super(); this.context = context; }
  connect(target) { this.connections.push(target); }
  disconnect(target) {
    this.disconnectCount++;
    this.connections = target ? this.connections.filter(node => node !== target) : [];
  }
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
  end() { this.dispatchEvent(new Event('ended')); }
}

class FakeTrack {
  kind = 'audio';
  readyState = 'live';
  stopCount = 0;
  stop() { this.readyState = 'ended'; this.stopCount++; }
}

class FakeDestination extends FakeNode {
  tracks = [new FakeTrack()];
  stream = { getTracks: () => this.tracks, getAudioTracks: () => this.tracks };
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
  destination = new FakeNode(this);
  gains = [];
  sources = [];
  buffers = [];
  streamDestinations = [];
  streamSources = [];
  resumeCount = 0;
  suspendCount = 0;
  closeCount = 0;
  createGain() { const node = new FakeGain(this); this.gains.push(node); return node; }
  createBufferSource() { const node = new FakeSource(this); this.sources.push(node); return node; }
  createBuffer(...args) { const buffer = new FakeBuffer(...args); this.buffers.push(buffer); return buffer; }
  createMediaStreamDestination() {
    const node = new FakeDestination(this); this.streamDestinations.push(node); return node;
  }
  createMediaStreamSource(stream) {
    const node = new FakeNode(this); node.stream = stream; this.streamSources.push(node); return node;
  }
  setState(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
  resume() {
    this.resumeCount++;
    // Deliberately allow a stale resume to resurrect a closed fake context.
    return (this.resumeGate?.promise ?? Promise.resolve()).then(() => { this.setState('running'); });
  }
  suspend() { this.suspendCount++; this.setState('suspended'); return Promise.resolve(); }
  close() { this.closeCount++; this.setState('closed'); return Promise.resolve(); }
}

function setup(configure = () => {}, options = {}) {
  const contexts = [], visibility = new Visibility(), lifecycle = new TrackedTarget();
  let now = 1000;
  const audio = new SubmissionAudio({
    contextFactory: () => {
      const context = new FakeContext();
      configure(context, contexts.length);
      contexts.push(context);
      return context;
    },
    visibilityTarget: visibility, lifecycleTarget: lifecycle, now: () => now,
    ...options,
  });
  return { audio, contexts, visibility, lifecycle, advance: (ms = 400) => { now += ms; } };
}

function assertCueReleased(source, { natural = false } = {}) {
  assert.equal(source.stopCount, natural ? 0 : source.startCount);
  assert.equal(source.disconnectCount, 1);
  assert.deepEqual(source.connections, []);
  assert.equal(source.buffer, null);
  assert.equal(source.listenerCount(), 0);
}

function assertReleased(context) {
  assert.equal(context.state, 'closed');
  assert.equal(context.listenerCount(), 0);
  for (const source of context.sources) assertCueReleased(source);
  for (const gain of context.gains) {
    assert.equal(gain.gain.value, 0);
    assert.deepEqual(gain.connections, []);
  }
  for (const destination of context.streamDestinations) {
    assert.deepEqual(destination.connections, []);
    assert.ok(destination.tracks.every(track => track.stopCount === 1 && track.readyState === 'ended'));
  }
}

test('default OFF and default unrecorded; stable frozen snapshot, independent settings create no graph', () => {
  const { audio, contexts } = setup();
  assert.deepEqual(audio.getSnapshot(), INITIAL_SUBMISSION_AUDIO_SNAPSHOT);
  assert.equal(Object.isFrozen(INITIAL_SUBMISSION_AUDIO_SNAPSHOT), true);
  const initial = audio.getSnapshot();
  assert.equal(audio.getSnapshot(), initial);
  assert.throws(() => { initial.enabled = true; }, TypeError);
  let updates = 0;
  const unsubscribe = audio.subscribe(() => { updates++; });
  audio.setVolume(0.7);
  audio.setMonitorMuted(true);
  audio.setMonitorMuted(true);
  assert.equal(updates, 2);
  const changed = audio.getSnapshot();
  audio.setVolume(0.7);
  assert.equal(audio.getSnapshot(), changed);
  assert.equal(initial.volume, 0.4);
  assert.equal(changed.volume, 0.7);
  assert.equal(changed.monitorMuted, true);
  unsubscribe();
  audio.setVolume(0.5);
  assert.equal(updates, 2);
  assert.equal(audio.play('correct', 'off-attempt'), false);
  assert.equal(contexts.length, 0);
  audio.dispose();
});

test('explicit enable resumes synchronously and creates no sound or recording nodes', async () => {
  const { audio, contexts } = setup();
  const transitions = [];
  audio.subscribe(() => { transitions.push(audio.getSnapshot()); });
  const pending = audio.enable();
  const context = contexts[0];
  assert.equal(context.resumeCount, 1);
  assert.equal(audio.getSnapshot().enabling, true);
  assert.equal(audio.getSnapshot().enabled, false);
  assert.deepEqual(context.gains.map(gain => gain.gain.value), [0, 0]);
  assert.equal(context.sources.length, 0);
  assert.equal(context.streamDestinations.length, 0);
  assert.equal(context.streamSources.length, 0);
  assert.deepEqual(context.gains[0].connections, [context.gains[1]]);
  assert.deepEqual(context.gains[1].connections, [context.destination]);
  await pending;
  assert.equal(audio.getSnapshot().enabled, true);
  assert.equal(context.sources.length, 0, 'unlock never emits a test or delayed cue');
  assert.deepEqual(context.gains.map(gain => gain.gain.value), [0.4 * 0.055, 1]);
  assert.deepEqual(transitions.map(state => [state.enabling, state.enabled]), [[true, false], [false, true]]);
  audio.dispose();
  assertReleased(context);
});

test('duplicate enables share pending work; skipped pending/off attempt IDs can never replay', async () => {
  const delayed = gate();
  const { audio, contexts } = setup(context => { context.resumeGate = delayed; });
  assert.equal(audio.play('correct', 'off'), false);
  const pending = audio.enable();
  assert.equal(audio.enable(), pending);
  assert.equal(audio.play('firstCompletion', 'pending'), false);
  delayed.resolve();
  await pending;
  await audio.enable();
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].resumeCount, 1);
  assert.equal(contexts[0].sources.length, 0);
  assert.equal(audio.play('correct', 'off'), false);
  assert.equal(audio.play('firstCompletion', 'pending'), false);
  assert.equal(audio.play('correct', 'fresh'), true);
  audio.dispose();
  assertReleased(contexts[0]);
});

test('selector emits exactly one outcome and gives first completion priority', () => {
  assert.equal(selectSubmissionCue({ correct: false, firstCompletion: false }), 'correction');
  assert.equal(selectSubmissionCue({ correct: true, firstCompletion: false }), 'correct');
  assert.equal(selectSubmissionCue({ correct: true, firstCompletion: true }), 'firstCompletion');
  assert.equal(selectSubmissionCue({ correct: false, firstCompletion: true }), 'firstCompletion');
});

test('three distinct cues use finite low-peak smooth PCM with short natural durations and fixed speed', async () => {
  const { audio, contexts, advance } = setup(context => { context.sampleRate = 48000; });
  await audio.enable();
  const context = contexts[0], samplesByKind = [];
  for (const [kind, duration] of [['correction', 0.16], ['correct', 0.26], ['firstCompletion', 0.39]]) {
    assert.equal(audio.play(kind, kind), true);
    const source = context.sources.at(-1), buffer = source.buffer;
    assert.equal(source.loop, false);
    assert.equal(source.playbackRate.value, 1);
    assert.equal(buffer.numberOfChannels, 1);
    assert.equal(buffer.duration, duration);
    assert.deepEqual(source.connections, [context.gains[0]]);
    const samples = buffer.getChannelData(0);
    assert.ok(samples.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1));
    assert.ok(Math.abs(samples[0]) < 1e-7 && Math.abs(samples.at(-1)) < 1e-7, 'zero-ended envelope');
    assert.ok(samples.some(sample => Math.abs(sample) > 0.5), 'nonempty PCM');
    assert.ok(samples.every((sample, index) => !index || Math.abs(sample - samples[index - 1]) < 0.12), 'smooth PCM');
    assert.ok(Math.max(...samples.map(Math.abs)) * context.gains[0].gain.value <= 0.055);
    samplesByKind.push(samples.slice());
    source.end();
    assertCueReleased(source, { natural: true });
    assert.equal(audio.getSnapshot().enabled, true, 'natural cue end keeps opt-in graph ready');
    advance();
  }
  assert.notDeepEqual(samplesByKind[0], samplesByKind[1]);
  assert.notDeepEqual(samplesByKind[1], samplesByKind[2]);
  assert.equal(context.resumeCount, 1, 'play never attempts to resume');
  audio.dispose();
});

test('dedupe and rate limit consume dropped attempts; cancel and disable do not make history replayable', async () => {
  const { audio, contexts, advance } = setup();
  await audio.enable();
  for (const id of ['', '   ', null, undefined]) assert.equal(audio.play('correct', id), false);
  assert.equal(audio.play('unsupported', 'bad-kind'), false);
  assert.equal(audio.play('correct', 'first'), true);
  assert.equal(audio.play('correction', 'first'), false);
  assert.equal(audio.play('firstCompletion', 'too-fast'), false);
  assert.equal(contexts[0].sources.length, 1);
  audio.cancel();
  assertCueReleased(contexts[0].sources[0]);
  assert.equal(audio.getSnapshot().enabled, true);
  advance();
  assert.equal(audio.play('firstCompletion', 'too-fast'), false);
  assert.equal(audio.play('correct', 'first'), false);
  assert.equal(audio.play('correct', 'fresh'), true);
  audio.disable();
  advance();
  await audio.enable();
  assert.equal(audio.play('correct', 'fresh'), false);
  assert.equal(contexts[1].sources.length, 0);
  assert.equal(audio.play('firstCompletion', 'new-session'), true);
  audio.dispose();
  contexts.forEach(assertReleased);
});

test('a new allowed cue cancels the old tail rather than overlapping voices', async () => {
  const { audio, contexts, advance } = setup();
  await audio.enable();
  assert.equal(audio.play('firstCompletion', 'first'), true);
  advance(320);
  assert.equal(audio.play('correction', 'second'), true);
  assertCueReleased(contexts[0].sources[0]);
  assert.equal(contexts[0].sources[1].stopCount, 0);
  audio.dispose();
  assertReleased(contexts[0]);
});

test('oversized IDs are rejected without playback or dedupe allocation; maximum-length ID is accepted once', async () => {
  const { audio, contexts, advance } = setup();
  await audio.enable();
  const oversized = 'x'.repeat(SUBMISSION_AUDIO_MAX_ID_LENGTH + 1);
  for (let i = 0; i < SUBMISSION_AUDIO_DEDUPE_LIMIT + 1; i++) {
    assert.equal(audio.play('correct', oversized + i), false);
  }
  assert.equal(contexts[0].sources.length, 0);
  assert.equal(audio.getSnapshot().error, null, 'invalid IDs never use bounded dedupe slots');
  const bounded = 'x'.repeat(SUBMISSION_AUDIO_MAX_ID_LENGTH);
  assert.equal(audio.play('correct', bounded), true);
  advance();
  assert.equal(audio.play('correct', bounded), false);
  assert.equal(contexts[0].sources.length, 1);
  audio.dispose();
});

test('bounded dedupe fails closed at capacity, never evicts old IDs, and keeps reload-required error', async () => {
  const { audio, contexts, visibility } = setup();
  // Disabled live attempts must still be remembered so enabling cannot replay
  // them; filling the hard bound must not create an audio graph.
  for (let i = 0; i < SUBMISSION_AUDIO_DEDUPE_LIMIT; i++) {
    assert.equal(audio.play('correct', `off-${i}`), false);
  }
  assert.equal(contexts.length, 0);
  assert.equal(audio.getSnapshot().error, null);
  await audio.enable();
  assert.equal(audio.play('correct', 'off-0'), false, 'oldest entry was not evicted');
  assert.equal(audio.play('correct', 'overflow'), false);
  assert.equal(audio.getSnapshot().enabled, false);
  assert.equal(audio.getSnapshot().error.code, 'dedupe_limit');
  assert.match(audio.getSnapshot().error.message, /训练和评分不受影响/);
  assert.match(audio.getSnapshot().error.message, /重新打开页面/);
  assert.equal(Object.isFrozen(audio.getSnapshot().error), true);
  assertReleased(contexts[0]);
  assert.equal(contexts[0].sources.length, 0);
  const limited = audio.getSnapshot();
  audio.disable();
  visibility.hide();
  visibility.show();
  assert.equal(audio.getSnapshot(), limited, 'user toggle and lifecycle cannot clear the sticky limit');
  await assert.rejects(audio.enable(), error => error.code === 'dedupe_limit');
  assert.equal(audio.play('firstCompletion', 'another-new'), false);
  assert.equal(audio.play('correct', 'off-0'), false);
  assert.equal(contexts.length, 1, 'limit cannot be bypassed by another enable');
  audio.dispose();
});

test('repeated disabled attempts occupy one dedupe slot and never cause a late cue', async () => {
  const { audio, contexts } = setup();
  for (let i = 0; i < SUBMISSION_AUDIO_DEDUPE_LIMIT + 1; i++) {
    assert.equal(audio.play('correct', 'same-disabled-attempt'), false);
  }
  assert.equal(contexts.length, 0);
  assert.equal(audio.getSnapshot().error, null);
  await audio.enable();
  assert.equal(audio.play('correct', 'same-disabled-attempt'), false);
  assert.equal(audio.play('correct', 'fresh'), true);
  assert.equal(contexts[0].sources.length, 1);
  audio.dispose();
});

test('cancel during pending enable preserves the choice but cannot flush any delayed cue', async () => {
  const delayed = gate();
  const { audio, contexts } = setup(context => { context.resumeGate = delayed; });
  const pending = audio.enable();
  audio.play('correct', 'pending');
  audio.cancel();
  delayed.resolve();
  await pending;
  assert.equal(audio.getSnapshot().enabled, true);
  assert.equal(contexts[0].sources.length, 0);
  assert.equal(audio.play('correct', 'pending'), false);
  audio.dispose();
});

test('volume clamps independently; monitor mute only touches speaker gain and never speed or resume', async () => {
  const { audio, contexts } = setup();
  audio.setVolume(0);
  await audio.enable();
  const context = contexts[0], [master, monitor] = context.gains;
  assert.equal(audio.getSnapshot().enabled, true);
  assert.equal(master.gain.value, 0);
  assert.equal(audio.play('correct', 'test'), true);
  for (const [input, expected] of [[0.5, 0.5], [100, 1], [-1, 0], [NaN, 0], [Infinity, 0], [-Infinity, 0]]) {
    audio.setVolume(input);
    assert.equal(audio.getSnapshot().volume, expected);
    assert.equal(master.gain.value, expected * 0.055);
    assert.equal(monitor.gain.value, 1);
    assert.equal(context.sources[0].playbackRate.value, 1);
  }
  audio.setVolume(0.8);
  audio.setMonitorMuted(true);
  assert.equal(master.gain.value, 0.8 * 0.055);
  assert.equal(monitor.gain.value, 0);
  audio.setMonitorMuted(false);
  assert.equal(master.gain.value, 0.8 * 0.055);
  assert.equal(monitor.gain.value, 1);
  assert.equal(context.resumeCount, 1);
  audio.dispose();
  assertReleased(context);
});

test('settings chosen during unlock apply when ready and cannot create delayed playback', async () => {
  const delayed = gate();
  const { audio, contexts } = setup(context => { context.resumeGate = delayed; });
  const pending = audio.enable();
  audio.setVolume(0.9);
  audio.setMonitorMuted(true);
  assert.deepEqual(contexts[0].gains.map(gain => gain.gain.value), [0, 0]);
  delayed.resolve();
  await pending;
  assert.deepEqual(contexts[0].gains.map(gain => gain.gain.value), [0.9 * 0.055, 0]);
  assert.equal(contexts[0].sources.length, 0);
  audio.dispose();
});

test('hidden and pagehide disable immediately; foreground never auto-resumes or replays', async () => {
  for (const event of ['hidden', 'pagehide']) {
    const { audio, contexts, visibility, lifecycle, advance } = setup();
    await audio.enable();
    audio.play('firstCompletion', 'before');
    if (event === 'hidden') visibility.hide();
    else lifecycle.dispatchEvent(new Event('pagehide'));
    assert.equal(audio.getSnapshot().enabled, false);
    assert.equal(audio.getSnapshot().disableReason, event);
    assertReleased(contexts[0]);
    audio.play('correct', 'background');
    visibility.show();
    assert.equal(contexts.length, 1);
    advance();
    await audio.enable();
    assert.equal(contexts[1].sources.length, 0);
    assert.equal(audio.play('correct', 'background'), false);
    assert.equal(audio.play('correct', 'before'), false);
    audio.dispose();
  }
});

test('background enable is rejected without creating a context', async () => {
  const { audio, visibility, contexts } = setup();
  visibility.hide();
  await assert.rejects(audio.enable(), error => error.code === 'background');
  assert.equal(contexts.length, 0);
  audio.dispose();
});

test('disable, hidden, pagehide and disposal beat a late resume without replacing newer state', async () => {
  for (const action of ['disable', 'hidden', 'pagehide', 'dispose']) {
    const delayed = gate();
    const { audio, contexts, visibility, lifecycle } = setup((context, index) => {
      if (index === 0) context.resumeGate = delayed;
    });
    const canceled = assert.rejects(audio.enable(), error => error.code === 'canceled');
    if (action === 'hidden') visibility.hide();
    else if (action === 'pagehide') lifecycle.dispatchEvent(new Event('pagehide'));
    else audio[action]();
    assertReleased(contexts[0]);
    if (action !== 'dispose') {
      visibility.show();
      await audio.enable();
    }
    const current = audio.getSnapshot();
    delayed.resolve();
    await canceled;
    assert.equal(audio.getSnapshot(), current);
    assertReleased(contexts[0]);
    assert.equal(contexts[0].sources.length, 0);
    audio.dispose();
  }
});

test('context suspension/interruption/closure stops active cue and requires a fresh gesture', async () => {
  for (const state of ['suspended', 'interrupted', 'closed']) {
    const { audio, contexts } = setup();
    await audio.enable();
    audio.play('correct', 'cue');
    contexts[0].setState(state);
    assert.equal(audio.getSnapshot().enabled, false);
    assert.equal(audio.getSnapshot().disableReason, 'interrupted');
    assertReleased(contexts[0]);
    contexts[0].setState('running');
    assert.equal(audio.play('correct', 'stale-running'), false);
    assert.equal(audio.getSnapshot().enabled, false);
    assert.equal(contexts[0].resumeCount, 1);
    audio.dispose();
  }
});

test('an unannounced suspension on play never resumes or queues a cue', async () => {
  const { audio, contexts } = setup();
  await audio.enable();
  contexts[0].state = 'suspended';
  assert.equal(audio.play('firstCompletion', 'suspended'), false);
  assert.equal(audio.getSnapshot().disableReason, 'interrupted');
  assert.equal(contexts[0].resumeCount, 1);
  assert.equal(contexts[0].sources.length, 0);
  assertReleased(contexts[0]);
  audio.dispose();
});

test('recording attachment while OFF allocates no audio and does not enable or resume anything', () => {
  const { audio, contexts } = setup();
  const recording = new FakeContext(), destination = recording.createGain();
  const detach = audio.attachRecordingTarget(recording, destination);
  assert.equal(audio.getSnapshot().enabled, false);
  assert.equal(contexts.length, 0);
  assert.equal(recording.resumeCount, 0);
  assert.equal(recording.streamSources.length, 0);
  detach();
  detach();
  assert.equal(recording.listenerCount(), 0);
  assert.equal(recording.closeCount, 0);
  audio.dispose();
});

test('opt-in recording graph taps pre-monitor cues only; no microphone or other context destinations', async () => {
  const { audio, contexts } = setup();
  const recording = new FakeContext(), destination = recording.createGain();
  const detach = audio.attachRecordingTarget(recording, destination);
  await audio.enable();
  const local = contexts[0], [master, monitor] = local.gains;
  const output = local.streamDestinations[0], input = recording.streamSources[0];
  assert.deepEqual(master.connections, [monitor, output]);
  assert.deepEqual(monitor.connections, [local.destination]);
  assert.deepEqual(input.connections, [destination]);
  assert.equal(input.stream, output.stream);
  assert.equal(local.streamSources.length, 0);
  assert.equal(recording.streamDestinations.length, 0);
  audio.setMonitorMuted(true);
  const recordLevel = master.gain.value;
  assert.equal(audio.play('correct', 'record-muted'), true);
  assert.equal(monitor.gain.value, 0);
  assert.equal(master.gain.value, recordLevel);
  assert.deepEqual(local.sources[0].connections, [master]);
  assert.equal(recording.resumeCount, 0);
  detach();
  assert.deepEqual(master.connections, [monitor], 'detaching keeps the speaker route intact');
  assert.equal(input.disconnectCount, 1);
  assert.equal(output.tracks[0].stopCount, 1);
  assert.equal(recording.closeCount, 0);
  assert.equal(recording.suspendCount, 0);
  assert.equal(recording.listenerCount(), 0);
  audio.dispose();
  assertReleased(local);
});

test('enabled attachment and replacement release old bridges; stale detach cannot affect current recording', async () => {
  const { audio, contexts } = setup();
  await audio.enable();
  const first = new FakeContext(), second = new FakeContext();
  const detachFirst = audio.attachRecordingTarget(first, first.createGain());
  const firstOutput = contexts[0].streamDestinations[0];
  const detachSecond = audio.attachRecordingTarget(second, second.createGain());
  assert.equal(firstOutput.tracks[0].stopCount, 1);
  assert.equal(first.listenerCount(), 0);
  assert.equal(second.listenerCount(), 1);
  detachFirst();
  const secondOutput = contexts[0].streamDestinations[1];
  assert.equal(secondOutput.tracks[0].stopCount, 0);
  detachSecond();
  assert.equal(secondOutput.tracks[0].stopCount, 1);
  assert.equal(second.listenerCount(), 0);
  audio.dispose();
  assertReleased(contexts[0]);
});

test('disable releases the bridge; explicit re-enable rebuilds only an attached recording target', async () => {
  const { audio, contexts } = setup();
  const recording = new FakeContext(), destination = recording.createGain();
  const detach = audio.attachRecordingTarget(recording, destination);
  await audio.enable();
  audio.play('correct', 'first');
  audio.disable();
  assertReleased(contexts[0]);
  assert.equal(recording.streamSources[0].disconnectCount, 1);
  assert.equal(recording.closeCount, 0);
  await audio.enable();
  assert.equal(recording.streamSources.length, 2);
  assert.equal(contexts[1].sources.length, 0);
  assert.equal(contexts[1].streamDestinations.length, 1);
  detach();
  audio.disable();
  await audio.enable();
  assert.equal(contexts[2].streamDestinations.length, 0);
  audio.dispose();
  contexts.forEach(assertReleased);
});

test('closing the external recording context releases the bridge without touching speaker cues', async () => {
  const { audio, contexts } = setup();
  await audio.enable();
  const recording = new FakeContext();
  audio.attachRecordingTarget(recording, recording.createGain());
  audio.play('correct', 'cue');
  recording.setState('closed');
  assert.equal(audio.getSnapshot().enabled, true);
  assert.equal(contexts[0].sources[0].stopCount, 0);
  assert.equal(contexts[0].streamDestinations[0].tracks[0].stopCount, 1);
  assert.equal(recording.listenerCount(), 0);
  assert.deepEqual(contexts[0].gains[0].connections, [contexts[0].gains[1]]);
  audio.dispose();
});

test('invalid recording targets and partial bridge failures never damage shared context or monitor', async () => {
  for (const failure of ['wrong-context', 'closed', 'output', 'source', 'connect']) {
    const { audio, contexts } = setup();
    await audio.enable();
    const recording = new FakeContext(), destination = recording.createGain();
    if (failure === 'wrong-context') destination.context = new FakeContext();
    if (failure === 'closed') recording.state = 'closed';
    if (failure === 'output') contexts[0].createMediaStreamDestination = () => { throw new Error('failed'); };
    if (failure === 'source') recording.createMediaStreamSource = () => { throw new Error('failed'); };
    if (failure === 'connect') {
      const create = recording.createMediaStreamSource.bind(recording);
      recording.createMediaStreamSource = stream => {
        const source = create(stream);
        source.connect = () => { throw new Error('failed'); };
        return source;
      };
    }
    assert.throws(() => audio.attachRecordingTarget(recording, destination), error => error.code === 'recording_failed');
    assert.equal(audio.getSnapshot().enabled, true);
    assert.equal(recording.listenerCount(), 0);
    assert.equal(recording.resumeCount, 0);
    assert.equal(recording.closeCount, 0);
    assert.deepEqual(contexts[0].gains[0].connections, [contexts[0].gains[1]]);
    for (const output of contexts[0].streamDestinations) assert.equal(output.tracks[0].stopCount, 1);
    for (const input of recording.streamSources) assert.equal(input.disconnectCount, 1);
    audio.dispose();
  }
});

test('resume failures are visible and retry is explicit; a resolved-but-suspended context is not enabled', async () => {
  for (const failure of ['reject', 'unchanged']) {
    const { audio, contexts } = setup((context, index) => {
      if (index === 0) context.resume = () => failure === 'reject' ? Promise.reject(new Error('blocked')) : Promise.resolve();
    });
    await assert.rejects(audio.enable(), error => error.code === 'enable_failed');
    assert.equal(audio.getSnapshot().enabled, false);
    assert.equal(audio.getSnapshot().error.code, 'enable_failed');
    assert.equal(Object.isFrozen(audio.getSnapshot().error), true);
    assertReleased(contexts[0]);
    await audio.enable();
    assert.equal(audio.getSnapshot().enabled, true);
    assert.equal(audio.getSnapshot().error, null);
    assert.equal(contexts[1].sources.length, 0);
    audio.dispose();
  }
});

test('factory and partial enable graph failures release what was created', async () => {
  for (const failure of ['master', 'monitor', 'connect', 'resume']) {
    const { audio, contexts } = setup(context => {
      if (failure === 'resume') context.resume = () => { throw new Error('failed'); };
      else {
        const create = context.createGain.bind(context);
        context.createGain = () => {
          if ((failure === 'master' && !context.gains.length) || (failure === 'monitor' && context.gains.length)) throw new Error('failed');
          const node = create();
          if (failure === 'connect') node.connect = () => { throw new Error('failed'); };
          return node;
        };
      }
    });
    await assert.rejects(audio.enable(), error => error.code === 'enable_failed');
    assert.equal(audio.getSnapshot().enabling, false);
    assertReleased(contexts[0]);
    audio.dispose();
  }
  const audio = new SubmissionAudio({
    contextFactory: () => { throw new SubmissionAudioError('unavailable'); },
    visibilityTarget: null, lifecycleTarget: null,
  });
  await assert.rejects(audio.enable(), error => error.code === 'unavailable');
  audio.dispose();
});

test('partial cue creation and start failures release source and disable truthfully', async () => {
  for (const failure of ['createBufferSource', 'createBuffer', 'connect', 'start']) {
    const { audio, contexts } = setup();
    await audio.enable();
    const context = contexts[0];
    if (failure === 'createBufferSource' || failure === 'createBuffer') context[failure] = () => { throw new Error('failed'); };
    else {
      const create = context.createBufferSource.bind(context);
      context.createBufferSource = () => {
        const source = create();
        source[failure] = () => { throw new Error('failed'); };
        return source;
      };
    }
    assert.equal(audio.play('correct', failure), false);
    assert.equal(audio.getSnapshot().enabled, false);
    assert.equal(audio.getSnapshot().error.code, 'enable_failed');
    assertReleased(context);
    audio.dispose();
  }
});

test('cleanup is immediate and robust to source, lifecycle, automation and subscriber failures', async () => {
  const { audio, contexts, visibility, lifecycle } = setup();
  let updates = 0;
  audio.subscribe(() => { throw new Error('UI failed'); });
  audio.subscribe(() => { updates++; });
  await audio.enable();
  audio.play('firstCompletion', 'cue');
  const local = contexts[0], recording = new FakeContext();
  audio.attachRecordingTarget(recording, recording.createGain());
  local.sources[0].stop = () => { throw new Error('already stopped'); };
  local.gains[0].gain.cancelScheduledValues = () => { throw new Error('automation failed'); };
  local.suspend = () => Promise.reject(new Error('suspend failed'));
  local.close = () => { throw new Error('close failed'); };
  assert.doesNotThrow(() => audio.dispose());
  audio.dispose();
  assert.equal(audio.getSnapshot().enabled, false);
  assert.equal(local.gains[0].gain.value, 0);
  assert.equal(local.sources[0].buffer, null);
  assert.deepEqual(local.sources[0].connections, []);
  assert.equal(local.listenerCount(), 0);
  assert.equal(recording.listenerCount(), 0);
  assert.equal(visibility.listenerCount(), 0);
  assert.equal(lifecycle.listenerCount(), 0);
  assert.equal(updates, 3);
  const disposed = audio.getSnapshot();
  audio.setVolume(1);
  audio.setMonitorMuted(true);
  audio.disable();
  audio.cancel();
  assert.equal(audio.getSnapshot(), disposed);
  assert.equal(audio.play('correct', 'after-dispose'), false);
  await assert.rejects(audio.enable(), error => error.code === 'disposed');
  assert.throws(() => audio.attachRecordingTarget(recording, recording.createGain()), error => error.code === 'disposed');
});

test('failed gain automation or unannounced suspension on a setting disables the graph safely', async () => {
  for (const failure of ['volume', 'monitor', 'suspended']) {
    const { audio, contexts } = setup();
    await audio.enable();
    audio.play('correct', 'cue');
    if (failure === 'volume') contexts[0].gains[0].gain.setTargetAtTime = () => { throw new Error('failed'); };
    if (failure === 'monitor') contexts[0].gains[1].gain.setValueAtTime = () => { throw new Error('failed'); };
    if (failure === 'suspended') contexts[0].state = 'suspended';
    if (failure === 'monitor') audio.setMonitorMuted(true);
    else audio.setVolume(0.9);
    assert.equal(audio.getSnapshot().enabled, false);
    assert.equal(audio.getSnapshot().disableReason, 'interrupted');
    assertReleased(contexts[0]);
    audio.dispose();
  }
});

function reachableNodes(source) {
  const nodes = new Set();
  const visit = node => {
    if (nodes.has(node)) return;
    nodes.add(node);
    node.connections.forEach(visit);
  };
  visit(source);
  return nodes;
}

test('input errors never unlock, queue, or replay after pending enable and re-enable', async () => {
  const delayed = gate();
  const { audio, contexts, advance } = setup((context, index) => {
    if (index === 0) context.resumeGate = delayed;
  });
  assert.equal(audio.playInputError(), false);
  assert.equal(contexts.length, 0);
  const pending = audio.enable();
  assert.equal(audio.playInputError(), false);
  audio.cancelInputError();
  audio.cancel();
  assert.equal(contexts[0].sources.length, 0);
  delayed.resolve();
  await pending;
  assert.equal(contexts[0].sources.length, 0, 'unlock cannot replay the dropped typing event');
  assert.equal(audio.playInputError(), true);
  assert.equal(contexts[0].resumeCount, 1);
  audio.disable();
  assertReleased(contexts[0]);
  assert.equal(audio.playInputError(), false);
  advance();
  await audio.enable();
  assert.equal(contexts[1].sources.length, 0);
  audio.dispose();
  assertReleased(contexts[1]);
  assert.equal(audio.playInputError(), false);
  assert.equal(contexts.length, 2);
});

test('input error PCM is short, smooth, restrained and fixed-speed, and natural end releases its source', async () => {
  const { audio, contexts } = setup(context => { context.sampleRate = 48000; });
  await audio.enable();
  assert.equal(audio.playInputError(), true);
  const context = contexts[0], source = context.sources[0], buffer = source.buffer;
  const inputGain = context.gains[2];
  assert.equal(source.loop, false);
  assert.equal(source.playbackRate.value, 1);
  assert.equal(buffer.duration, 0.09);
  assert.equal(buffer.numberOfChannels, 1);
  assert.deepEqual(source.connections, [inputGain]);
  const samples = buffer.getChannelData(0);
  assert.ok(samples.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 0.5));
  assert.ok(Math.abs(samples[0]) < 1e-7 && Math.abs(samples.at(-1)) < 1e-7);
  assert.ok(samples.some(sample => Math.abs(sample) > 0.3));
  assert.ok(samples.every((sample, index) => !index || Math.abs(sample - samples[index - 1]) < 0.03));
  assert.ok(Math.max(...samples.map(Math.abs)) * inputGain.gain.value <= 0.055 / 2);
  source.end();
  assertCueReleased(source, { natural: true });
  assert.equal(audio.getSnapshot().enabled, true);
  assert.equal(context.resumeCount, 1);
  audio.dispose();
  assert.equal(inputGain.gain.value, 0);
  assert.deepEqual(inputGain.connections, []);
});

test('input errors are monitor-only before and after explicit recording opt-in and replacement', async () => {
  for (const attachBeforeEnable of [false, true]) {
    const { audio, contexts, advance } = setup();
    const recording = new FakeContext(), destination = recording.createGain();
    if (attachBeforeEnable) audio.attachRecordingTarget(recording, destination);
    await audio.enable();
    assert.equal(audio.playInputError(), true);
    const context = contexts[0], [master, monitor, inputGain] = context.gains;
    const firstSource = context.sources[0];
    if (!attachBeforeEnable) audio.attachRecordingTarget(recording, destination);
    const output = context.streamDestinations[0];
    assert.deepEqual(inputGain.connections, [monitor]);
    assert.deepEqual(master.connections, [monitor, output]);
    assert.deepEqual(monitor.connections, [context.destination]);
    const assertMonitorOnly = source => {
      const reachable = reachableNodes(source);
      assert.ok(reachable.has(context.destination));
      assert.ok(!reachable.has(master));
      for (const target of context.streamDestinations) assert.ok(!reachable.has(target));
      assert.ok(!reachable.has(destination));
    };
    assertMonitorOnly(firstSource);
    assert.equal(context.streamSources.length, 0);
    assert.equal(recording.resumeCount, 0);
    const secondRecording = new FakeContext();
    audio.attachRecordingTarget(secondRecording, secondRecording.createGain());
    assertMonitorOnly(firstSource);
    assert.equal(firstSource.stopCount, 0, 'recording replacement does not reroute or restart input audio');
    assert.equal(output.tracks[0].stopCount, 1);
    advance();
    assert.equal(audio.playInputError(), true);
    assertMonitorOnly(context.sources[1]);
    assert.equal(context.gains.length, 3, 'input gain is reused, not allocated per key');
    audio.detachRecordingTarget();
    assertMonitorOnly(context.sources[1]);
    audio.dispose();
    assertReleased(context);
    assert.equal(recording.closeCount, 0);
    assert.equal(secondRecording.closeCount, 0);
  }
});

test('input errors have a bounded independent 320 ms drop limiter with no queued sounds', async () => {
  const { audio, contexts, advance } = setup();
  await audio.enable();
  assert.equal(audio.playInputError(), true);
  const context = contexts[0], first = context.sources[0];
  for (let i = 0; i < 1000; i++) assert.equal(audio.playInputError(), false);
  advance(319);
  assert.equal(audio.playInputError(), false);
  assert.equal(context.sources.length, 1);
  assert.equal(first.stopCount, 0, 'dropped input does not interrupt the current transient');
  advance(1);
  assert.equal(context.sources.length, 1, 'elapsed time alone cannot flush dropped events');
  assert.equal(audio.playInputError(), true);
  assertCueReleased(first);
  assert.equal(context.sources.length, 2);
  assert.equal(context.gains.length, 3);
  audio.cancelInputError();
  assert.equal(audio.playInputError(), false, 'cancel does not reset the input limiter');
  advance(320);
  assert.equal(context.sources.length, 2);
  assert.equal(audio.playInputError(), true);
  assert.equal(context.resumeCount, 1);
  audio.dispose();
  assertReleased(context);
});

test('all real submission kinds preempt input audio and input events cannot interrupt an active submission', async () => {
  for (const kind of ['correction', 'correct', 'firstCompletion']) {
    const { audio, contexts, advance } = setup();
    await audio.enable();
    assert.equal(audio.playInputError(), true);
    const context = contexts[0], input = context.sources[0];
    assert.equal(audio.play(kind, `${kind}-attempt`), true, 'typing must not consume the submission limiter');
    assertCueReleased(input);
    const submitted = context.sources[1];
    assert.deepEqual(submitted.connections, [context.gains[0]]);
    assert.equal(audio.playInputError(), false);
    advance(500);
    assert.equal(audio.playInputError(), false, 'an active submission wins even after the 320 ms window');
    audio.cancelInputError();
    assert.equal(submitted.stopCount, 0, 'transient-only cancellation cannot stop F03');
    assert.equal(context.sources.length, 2);
    submitted.end();
    assertCueReleased(submitted, { natural: true });
    assert.equal(audio.playInputError(), true);
    audio.dispose();
  }
});

test('recent naturally ended submissions retain priority until 320 ms and keep their own limiter', async () => {
  const { audio, contexts, advance } = setup();
  await audio.enable();
  assert.equal(audio.play('correction', 'first'), true);
  const first = contexts[0].sources[0];
  first.end();
  advance(319);
  assert.equal(audio.playInputError(), false);
  assert.equal(audio.play('correct', 'too-fast'), false);
  advance(1);
  assert.equal(audio.playInputError(), true);
  const input = contexts[0].sources[1];
  assert.equal(audio.play('firstCompletion', 'next'), true, 'input playback never moves submission rate-limit time');
  assertCueReleased(input);
  advance();
  assert.equal(audio.play('correct', 'too-fast'), false, 'dropped real submission IDs remain consumed');
  assert.equal(contexts[0].sources.length, 3);
  audio.dispose();
});

test('input events never consume submission dedupe slots or relax bounded fail-closed semantics', async () => {
  const { audio, contexts } = setup();
  for (let i = 0; i < SUBMISSION_AUDIO_DEDUPE_LIMIT + 1; i++) assert.equal(audio.playInputError(), false);
  for (let i = 0; i < SUBMISSION_AUDIO_DEDUPE_LIMIT - 1; i++) audio.play('correct', `off-${i}`);
  await audio.enable();
  assert.equal(audio.playInputError(), true);
  assert.equal(audio.play('correct', 'last-slot'), true);
  assert.equal(audio.getSnapshot().error, null);
  assert.equal(audio.play('correct', 'overflow'), false);
  assert.equal(audio.getSnapshot().error.code, 'dedupe_limit');
  assert.equal(audio.playInputError(), false);
  assertReleased(contexts[0]);
  audio.dispose();
});

test('monitor mute discards input tails and muted events without replay, while F03 recording stays live', async () => {
  const { audio, contexts, advance } = setup();
  const recording = new FakeContext();
  audio.attachRecordingTarget(recording, recording.createGain());
  await audio.enable();
  assert.equal(audio.playInputError(), true);
  const context = contexts[0], [master, monitor, inputGain] = context.gains;
  const firstInput = context.sources[0], recordLevel = master.gain.value;
  audio.setMonitorMuted(true);
  assertCueReleased(firstInput);
  assert.equal(inputGain.gain.value, recordLevel);
  assert.equal(monitor.gain.value, 0);
  advance();
  assert.equal(audio.playInputError(), false);
  audio.setMonitorMuted(false);
  assert.equal(context.sources.length, 1, 'unmute never replays muted events or the canceled tail');
  assert.equal(audio.playInputError(), true);
  assert.equal(audio.play('correct', 'recorded'), true);
  const submitted = context.sources.at(-1);
  audio.setMonitorMuted(true);
  audio.cancelInputError();
  assert.equal(submitted.stopCount, 0);
  assert.equal(master.gain.value, recordLevel);
  assert.deepEqual(submitted.connections, [master]);
  assert.ok(master.connections.includes(context.streamDestinations[0]));
  assert.equal(context.streamDestinations[0].tracks[0].stopCount, 0);
  assert.equal(context.resumeCount, 1);
  audio.dispose();
  assertReleased(context);
});

test('input volume tracks the shared control; zero-volume events and tails cannot return on volume-up', async () => {
  const { audio, contexts, advance } = setup();
  audio.setVolume(0);
  await audio.enable();
  const context = contexts[0];
  assert.equal(audio.playInputError(), false);
  assert.equal(context.sources.length, 0);
  assert.equal(context.gains.length, 2, 'silent events do not allocate input nodes');
  audio.setVolume(0.7);
  assert.equal(context.sources.length, 0);
  assert.equal(audio.playInputError(), true);
  const [master, monitor, inputGain] = context.gains, source = context.sources[0];
  assert.equal(inputGain.gain.value, 0.7 * 0.055);
  audio.setVolume(0.2);
  assert.equal(inputGain.gain.value, 0.2 * 0.055);
  assert.equal(master.gain.value, inputGain.gain.value);
  assert.equal(monitor.gain.value, 1);
  assert.equal(source.stopCount, 0);
  audio.setVolume(0);
  assertCueReleased(source);
  advance();
  assert.equal(audio.playInputError(), false);
  audio.setVolume(1);
  assert.equal(context.sources.length, 1);
  assert.equal(audio.playInputError(), true);
  assert.equal(inputGain.gain.value, 0.055);
  assert.equal(context.resumeCount, 1);
  audio.dispose();
  assertReleased(context);
});

test('input cancellation is immediate and independent; global cancel still stops either kind', async () => {
  const { audio, contexts, advance } = setup();
  await audio.enable();
  assert.equal(audio.playInputError(), true);
  const context = contexts[0];
  audio.cancelInputError();
  audio.cancelInputError();
  assertCueReleased(context.sources[0]);
  assert.equal(audio.getSnapshot().enabled, true);
  advance();
  assert.equal(audio.playInputError(), true);
  audio.cancel();
  assertCueReleased(context.sources[1]);
  assert.equal(audio.play('correct', 'real'), true);
  audio.cancelInputError();
  assert.equal(context.sources[2].stopCount, 0);
  audio.cancel();
  assertCueReleased(context.sources[2]);
  assert.equal(audio.getSnapshot().enabled, true);
  audio.dispose();
  assertReleased(context);
});

test('disable, background, pagehide, context interruption and disposal release input audio without replay', async () => {
  for (const action of ['disable', 'hidden', 'pagehide', 'suspended', 'interrupted', 'closed', 'dispose']) {
    const { audio, contexts, visibility, lifecycle, advance } = setup();
    await audio.enable();
    assert.equal(audio.playInputError(), true);
    if (action === 'hidden') visibility.hide();
    else if (action === 'pagehide') lifecycle.dispatchEvent(new Event('pagehide'));
    else if (['suspended', 'interrupted', 'closed'].includes(action)) contexts[0].setState(action);
    else audio[action]();
    assertReleased(contexts[0]);
    assert.equal(audio.getSnapshot().enabled, false);
    assert.equal(audio.playInputError(), false);
    visibility.show();
    advance();
    assert.equal(contexts.length, 1, 'foreground/time never create or resume a context');
    if (action !== 'dispose') {
      await audio.enable();
      assert.equal(contexts[1].sources.length, 0);
      assert.equal(audio.playInputError(), true);
      audio.dispose();
      assertReleased(contexts[1]);
    }
    assert.equal(visibility.listenerCount(), 0);
    assert.equal(lifecycle.listenerCount(), 0);
  }
});

test('input playback catches unannounced suspension/hidden state without resume or allocation', async () => {
  for (const blocked of ['suspended', 'hidden']) {
    const { audio, contexts, visibility } = setup();
    await audio.enable();
    if (blocked === 'hidden') visibility.hidden = true;
    else contexts[0].state = 'suspended';
    assert.equal(audio.playInputError(), false);
    assert.equal(contexts[0].sources.length, 0);
    assert.equal(contexts[0].resumeCount, 1);
    assert.equal(audio.getSnapshot().disableReason, blocked === 'hidden' ? 'hidden' : 'interrupted');
    assertReleased(contexts[0]);
    audio.dispose();
  }
});

test('invalid clocks drop input events without poisoning either limiter', async () => {
  let now = NaN;
  const { audio, contexts } = setup(() => {}, { now: () => now });
  await audio.enable();
  for (const invalid of [NaN, Infinity, -Infinity]) {
    now = invalid;
    assert.equal(audio.playInputError(), false);
  }
  assert.equal(contexts[0].sources.length, 0);
  now = 1000;
  assert.equal(audio.playInputError(), true);
  assert.equal(audio.play('correct', 'valid'), true);
  audio.dispose();
  assertReleased(contexts[0]);
});

test('partial input gain/source failures clean up and disable truthfully', async () => {
  for (const failure of ['createGain', 'gainSet', 'gainConnect', 'createBufferSource', 'createBuffer', 'connect', 'start']) {
    const { audio, contexts } = setup();
    await audio.enable();
    const context = contexts[0];
    if (['createGain', 'createBufferSource', 'createBuffer'].includes(failure)) {
      context[failure] = () => { throw new Error('failed'); };
    } else if (failure === 'gainSet' || failure === 'gainConnect') {
      const create = context.createGain.bind(context);
      context.createGain = () => {
        const gain = create();
        if (failure === 'gainSet') gain.gain.setValueAtTime = () => { throw new Error('failed'); };
        else gain.connect = () => { throw new Error('failed'); };
        return gain;
      };
    } else {
      const create = context.createBufferSource.bind(context);
      context.createBufferSource = () => {
        const source = create();
        source[failure] = () => { throw new Error('failed'); };
        return source;
      };
    }
    assert.equal(audio.playInputError(), false);
    assert.equal(audio.getSnapshot().enabled, false);
    assert.equal(audio.getSnapshot().error.code, 'enable_failed');
    assertReleased(context);
    audio.dispose();
  }
});

test('failed input volume automation releases transient audio and the graph safely', async () => {
  const { audio, contexts } = setup();
  await audio.enable();
  assert.equal(audio.playInputError(), true);
  contexts[0].gains[2].gain.setTargetAtTime = () => { throw new Error('failed'); };
  audio.setVolume(0.9);
  assert.equal(audio.getSnapshot().enabled, false);
  assert.equal(audio.getSnapshot().disableReason, 'interrupted');
  assertReleased(contexts[0]);
  audio.dispose();
});


// Exercise the actual failure-modal entry, which does not pass through openPanel.
const studioSource = await readFile(new URL('../components/Studio.tsx', import.meta.url), 'utf8');
const failSceneSource = studioSource.slice(studioSource.indexOf(' function failSceneRendering('), studioSource.indexOf(' function recoverSceneRendering('))
  .replace('error:unknown,terminal:boolean', 'error,terminal');
const sceneModalSource = studioSource.match(/useEffect\(\(\)=>\{(const dialog=sceneFallbackRef\.current;.*?)\},\[sceneFailure\]\);/s)?.[1];
assert.ok(sceneModalSource, 'actual renderer failure dialog effect must be located');
for (const terminal of [false, true]) for (const kind of ['correction', 'correct', 'firstCompletion']) {
  test(`actual ${terminal ? 'terminal' : 'recovering'} renderer modal cancels ${kind} and typing tails without disabling preferences`, async () => {
    const submitted = setup(), typing = setup(), shakes = [], vibrations = [], calls = [];
    const feedback = new TypingErrorFeedback({audio: typing.audio, now: () => 1000,
      shake: value => shakes.push(value), vibrate: value => { vibrations.push(value); return true; }});
    await submitted.audio.enable(); await typing.audio.enable();
    assert.equal(submitted.audio.play(kind, 'live-attempt'), true); assert.equal(feedback.pulse(), true);
    const submittedSource = submitted.contexts[0].sources[0], typingSource = typing.contexts[0].sources[0];
    const dialog = {open: false, showModal() { this.open = true; }, close() { this.open = false; }};
    const scope = {
      cancelFollow: reason => calls.push(['follow', reason]), cancelTypingErrorFeedback: () => feedback.cancel(),
      submissionSound: {audio: {current: submitted.audio}}, sceneRenderFailureCode: () => 'draw-TypeError',
      sceneRenderPhaseRef: {current: 'draw'}, sceneFailureRef: {current: false}, sceneFailure: null,
      sceneFallbackRef: {current: dialog}, stageRef: {current: {dataset: {}}},
      setSceneFailure: value => { scope.sceneFailure = value; }, setSceneFailureCode: code => calls.push(['code', code]),
      cancelRecordingPreparation: () => calls.push(['cancel-recording-preparation']),
      recorderRef: {current: {getSnapshot: () => ({state: 'recording'})}},
      stopRecording: reason => calls.push(['stop-recording', reason]),
    };
    vm.createContext(scope); vm.runInContext(failSceneSource + ';this.fail=failSceneRendering', scope);
    scope.fail(new Error('draw failed'), terminal); vm.runInContext('(()=>{' + sceneModalSource + '})()', scope);
    assert.equal(dialog.open, true); assert.equal(scope.sceneFailure, terminal ? 'failed' : 'recovering');
    assertCueReleased(submittedSource); assertCueReleased(typingSource);
    assert.equal(shakes.at(-1), undefined); assert.equal(vibrations.at(-1), 0);
    assert.equal(submitted.audio.getSnapshot().enabled, true); assert.equal(typing.audio.getSnapshot().enabled, true);
    assert.equal(submitted.contexts[0].closeCount, 0); assert.equal(typing.contexts[0].closeCount, 0);
    assert.ok(calls.some(call => call[0] === 'cancel-recording-preparation')); assert.ok(calls.some(call => call[0] === 'stop-recording'));
    submitted.advance(); assert.equal(submitted.audio.play(kind, 'live-attempt'), false, 'recovery cannot replay the consumed attempt');
    assert.equal(submitted.contexts[0].sources.length, 1); assert.equal(typing.contexts[0].sources.length, 1);
    feedback.dispose(); submitted.audio.dispose();
  });
}

test('renderer modal while explicit enable is pending neither queues a cue nor disables the preference', async () => {
  const resume = gate(), pending = setup(context => { context.resumeGate = resume; });
  const enabling = pending.audio.enable();
  assert.equal(pending.audio.play('firstCompletion', 'pending-attempt'), false);
  const scope = {
    cancelFollow() {}, cancelTypingErrorFeedback() {}, submissionSound: {audio: {current: pending.audio}},
    sceneRenderFailureCode: () => 'draw-TypeError', sceneRenderPhaseRef: {current: 'draw'}, sceneFailureRef: {current: false},
    setSceneFailure() {}, setSceneFailureCode() {}, stageRef: {current: null}, cancelRecordingPreparation() {}, recorderRef: {current: null},
  };
  vm.createContext(scope); vm.runInContext(failSceneSource + ';this.fail=failSceneRendering', scope);
  scope.fail(new Error('draw failed'), false); assert.equal(pending.audio.getSnapshot().enabling, true);
  resume.resolve(); await enabling;
  assert.equal(pending.audio.getSnapshot().enabled, true); assert.equal(pending.contexts[0].sources.length, 0);
  assert.equal(pending.audio.play('firstCompletion', 'pending-attempt'), false);
  scope.fail(new Error('draw failed again'), true); assert.equal(pending.contexts[0].sources.length, 0);
  pending.audio.dispose();
});
