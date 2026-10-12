import test from 'node:test';
import assert from 'node:assert/strict';
import { CourseAudioRouting, CourseAudioRoutingError } from './course-audio-routing.ts';

function gate() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class FakeParam {
  value = 1;
  calls = [];
  cancelScheduledValues(time) { this.calls.push(['cancel', time]); }
  setValueAtTime(value, time) { this.value = value; this.calls.push(['set', value, time]); }
}

class FakeNode {
  connections = new Set();
  connects = [];
  disconnects = [];
  constructor(context) { this.context = context; }
  connect(node) {
    if (this.context.connectFailure === node) throw new Error('connect failed');
    this.connects.push(node); this.connections.add(node); return node;
  }
  disconnect(node) {
    this.disconnects.push(node);
    if (node) this.connections.delete(node); else this.connections.clear();
  }
}

class FakeGain extends FakeNode { gain = new FakeParam(); }

class FakeContext {
  currentTime = 12;
  state = 'suspended';
  destination = new FakeNode(this);
  sources = [];
  gains = [];
  resumeCount = 0;
  closeCount = 0;
  suspendCount = 0;
  createMediaElementSource(element) {
    if (element.hasSource) throw new Error('duplicate media element source');
    const node = new FakeNode(this); node.element = element;
    element.hasSource = true; this.sources.push(node); return node;
  }
  createGain() { const node = new FakeGain(this); this.gains.push(node); return node; }
  resume() {
    this.resumeCount++;
    if (this.resumeThrow) throw this.resumeThrow;
    return (this.resumeGate?.promise ?? Promise.resolve()).then(() => {
      if (!this.staySuspended) this.state = 'running';
    });
  }
  close() { this.closeCount++; this.state = 'closed'; return Promise.resolve(); }
  suspend() { this.suspendCount++; this.state = 'suspended'; return Promise.resolve(); }
  // A unit-amplitude course sample. Deliberately model native attenuation too,
  // so tests fail if the helper implements monitoring on the media element.
  sample(destination) {
    if (this.state !== 'running') return 0;
    const visit = (node, signal) => {
      if (node === destination) return signal;
      const output = signal * (node.gain?.value ?? 1);
      return [...node.connections].reduce((sum, child) => sum + visit(child, output), 0);
    };
    return this.sources.reduce((sum, node) => sum + visit(node, node.element.muted ? 0 : node.element.volume), 0);
  }
}

function setup(options = {}) {
  const context = new FakeContext();
  const element = { volume: .8, muted: false, pause: () => assert.fail('must not pause the caller’s media') };
  const router = new CourseAudioRouting({ context, element, ...options });
  return { context, element, router, destination: new FakeNode(context) };
}
const errorCode = code => error => error instanceof CourseAudioRoutingError && error.code === code;

test('construction/settings allocate nothing; explicit gesture resumes synchronously with one silent monitor', async () => {
  const { context, element, router, destination } = setup();
  router.setVolume(.6); router.setCourseMuted(true); router.setAllMonitorMuted(true);
  assert.equal(context.sources.length, 0); assert.equal(context.gains.length, 0); assert.equal(context.resumeCount, 0);
  assert.equal(element.volume, .8); assert.equal(element.muted, false);
  assert.throws(() => router.connectRecording(destination), errorCode('not_enabled'));
  const pending = router.enableFromGesture();
  assert.equal(context.resumeCount, 1); assert.equal(context.sources.length, 1); assert.equal(context.gains.length, 1);
  assert.equal(context.gains[0].gain.value, 0);
  assert.equal(router.enableFromGesture(), pending);
  assert.throws(() => router.connectRecording(destination), errorCode('not_enabled'));
  await pending;
  assert.equal(element.volume, 1); assert.equal(element.muted, false);
  assert.deepEqual([...context.sources[0].connections], [context.gains[0]]);
  assert.deepEqual([...context.gains[0].connections], [context.destination]);
  assert.equal(context.sample(destination), 0, 'enabling alone never adds a recording source');
  await router.enableFromGesture(); assert.equal(context.resumeCount, 1);
  router.dispose();
});

for (const volume of [0, .25, 1]) for (const courseMuted of [false, true]) for (const allMonitorMuted of [false, true]) {
  test(`recording is pre-monitor at volume=${volume}, courseMute=${courseMuted}, allMute=${allMonitorMuted}`, async () => {
    const { context, element, router, destination } = setup();
    await router.enableFromGesture();
    const cleanup = router.connectRecording(destination);
    router.setVolume(volume); router.setCourseMuted(courseMuted); router.setAllMonitorMuted(allMonitorMuted);
    assert.equal(context.sample(context.destination), courseMuted || allMonitorMuted ? 0 : volume);
    assert.equal(context.sample(destination), 1, 'explicitly selected course source keeps its original amplitude');
    assert.equal(element.volume, 1); assert.equal(element.muted, false);
    assert.deepEqual([...context.gains[0].connections], [context.destination], 'monitor never feeds the recorder');
    cleanup(); cleanup();
    assert.equal(context.sample(destination), 0); assert.equal(context.sample(context.destination), courseMuted || allMonitorMuted ? 0 : volume);
    router.dispose();
  });
}

test('unmuting all-listening preserves course-only mute and previous volume', async () => {
  const { router, context } = setup({ volume: .37 });
  await router.enableFromGesture();
  router.setCourseMuted(true); router.setAllMonitorMuted(true); router.setAllMonitorMuted(false);
  assert.equal(context.sample(context.destination), 0);
  assert.deepEqual(router.getState(), { volume: .37, courseMuted: true, allMonitorMuted: false, effectiveVolume: 0, enabled: true });
  router.setCourseMuted(false); assert.equal(context.sample(context.destination), .37);
  router.setAllMonitorMuted(true); router.setVolume(.62); router.setAllMonitorMuted(false);
  assert.equal(context.sample(context.destination), .62);
  assert.equal(Object.isFrozen(router.getState()), true);
  router.dispose();
});

test('first recording can capture a course whose native element started muted at zero volume', async () => {
  const context = new FakeContext(); const element = { volume: 0, muted: true };
  const router = new CourseAudioRouting({ context, element }); const destination = new FakeNode(context);
  await router.enableFromGesture(); router.connectRecording(destination);
  assert.equal(context.sample(context.destination), 0); assert.equal(context.sample(destination), 1);
  assert.equal(router.getState().volume, 0); assert.equal(router.getState().courseMuted, true);
  assert.equal(element.volume, 1); assert.equal(element.muted, false);
  router.dispose();
});

test('invalid volume is silent and finite volume is clamped, without attenuating recording', async () => {
  const { router, context, destination } = setup(); await router.enableFromGesture(); router.connectRecording(destination);
  for (const value of [NaN, Infinity, -Infinity, -1]) {
    router.setVolume(value); assert.equal(context.sample(context.destination), 0); assert.equal(context.sample(destination), 1);
  }
  router.setVolume(2); assert.equal(context.sample(context.destination), 1);
  router.dispose();
});

test('repeated recording connections are independently releasable and never remove monitoring', async () => {
  const { router, context, destination } = setup(); await router.enableFromGesture();
  const other = new FakeNode(context);
  const first = router.connectRecording(destination), second = router.connectRecording(destination), third = router.connectRecording(other);
  assert.equal(context.sources[0].connects.filter(node => node === destination).length, 1);
  first(); first(); assert.equal(context.sample(destination), 1);
  second(); assert.equal(context.sample(destination), 0); assert.equal(context.sample(other), 1);
  third(); assert.equal(context.sample(other), 0); assert.equal(context.sample(context.destination), .8);
  assert.equal(context.sources[0].disconnects.includes(undefined), false, 'cleanup must target only its recording destination');
  const later = router.connectRecording(destination);
  second(); assert.equal(context.sample(destination), 1, 'an old cleanup cannot remove a new session');
  later(); router.dispose();
});

test('dispose immediately releases every owned edge without closing context or stopping media', async () => {
  const { router, context, destination } = setup(); await router.enableFromGesture();
  const cleanup = router.connectRecording(destination); const monitor = context.gains[0];
  router.dispose(); router.dispose(); cleanup();
  assert.equal(monitor.gain.value, 0); assert.equal(monitor.connections.size, 0); assert.equal(context.sources[0].connections.size, 0);
  assert.equal(context.closeCount, 0); assert.equal(context.suspendCount, 0);
  assert.equal(context.sources[0].disconnects.length, 2); assert.equal(monitor.disconnects.length, 1);
  router.setVolume(1); router.setCourseMuted(false); router.setAllMonitorMuted(false);
  assert.equal(context.sample(context.destination), 0);
  await assert.rejects(router.enableFromGesture(), errorCode('disposed'));
  assert.throws(() => router.connectRecording(destination), errorCode('disposed'));
});

for (const failure of ['rejection', 'throw', 'still suspended']) {
  test(`resume ${failure} is surfaced, recording fails closed, and gesture retry reuses source`, async () => {
    const { router, context, destination } = setup();
    const reason = new Error('audio was blocked');
    if (failure === 'rejection') { context.resumeGate = gate(); context.resumeGate.reject(reason); }
    if (failure === 'throw') context.resumeThrow = reason;
    if (failure === 'still suspended') context.staySuspended = true;
    await assert.rejects(router.enableFromGesture(), errorCode('enable_failed'));
    assert.equal(context.gains[0].gain.value, 0); assert.equal(router.getState().enabled, false);
    assert.throws(() => router.connectRecording(destination), errorCode('not_enabled'));
    context.resumeGate = undefined; context.resumeThrow = undefined; context.staySuspended = false;
    await router.enableFromGesture();
    assert.equal(context.sources.length, 1); assert.equal(context.gains.length, 1); assert.equal(context.resumeCount, 2);
    assert.equal(context.sample(context.destination), .8);
    router.dispose();
  });
}

test('a suspended active context resumes again without replacing any source or monitor', async () => {
  const { router, context } = setup(); await router.enableFromGesture();
  context.state = 'suspended'; assert.equal(router.getState().enabled, false);
  await router.enableFromGesture();
  assert.equal(context.resumeCount, 2); assert.equal(context.sources.length, 1); assert.equal(context.gains.length, 1);
  router.dispose();
});

test('disposing a pending resume prevents resurrection and permits same-context source reuse', async () => {
  const { router, context, element } = setup(); context.resumeGate = gate();
  const pending = router.enableFromGesture(); const canceled = assert.rejects(pending, errorCode('canceled'));
  const oldMonitor = context.gains[0]; router.dispose();
  const replacement = new CourseAudioRouting({ context, element, volume: .44 });
  const next = replacement.enableFromGesture();
  assert.equal(context.sources.length, 1); assert.equal(context.gains.length, 2);
  context.resumeGate.resolve(); await Promise.all([canceled, next]);
  assert.equal(oldMonitor.gain.value, 0); assert.equal(oldMonitor.connections.size, 0);
  assert.equal(context.sample(context.destination), .44);
  replacement.dispose();
});

test('same-element concurrent owners or a different context cannot create a duplicate source', async () => {
  const { router, context, element } = setup(); await router.enableFromGesture();
  const duplicate = new CourseAudioRouting({ context, element });
  await assert.rejects(duplicate.enableFromGesture(), errorCode('source_in_use'));
  duplicate.dispose(); assert.equal(context.sample(context.destination), .8);
  const otherContext = new FakeContext(); const wrongContext = new CourseAudioRouting({ context: otherContext, element });
  await assert.rejects(wrongContext.enableFromGesture(), errorCode('context_mismatch'));
  router.dispose();
  await assert.rejects(wrongContext.enableFromGesture(), errorCode('context_mismatch'));
  assert.equal(otherContext.sources.length, 0); assert.equal(context.sources.length, 1);
  wrongContext.dispose();
});

test('partial monitor connection failure can retry without leaking a graph or duplicating the source', async () => {
  const { router, context } = setup(); context.connectFailure = context.destination;
  await assert.rejects(router.enableFromGesture(), errorCode('enable_failed'));
  assert.equal(context.sources.length, 1); assert.equal(context.sources[0].connections.size, 0);
  assert.equal(context.gains[0].connections.size, 0); assert.equal(context.resumeCount, 0);
  context.connectFailure = undefined; await router.enableFromGesture();
  assert.equal(context.sources.length, 1); assert.equal(context.gains.length, 2);
  assert.equal(context.sample(context.destination), .8); router.dispose();
});

test('invalid/failed recording destinations never bypass monitoring or replace the source', async () => {
  const { router, context, destination } = setup(); await router.enableFromGesture();
  for (const invalid of [context.destination, context.gains[0], new FakeNode(new FakeContext())]) {
    assert.throws(() => router.connectRecording(invalid), errorCode('recording_failed'));
  }
  context.connectFailure = destination;
  assert.throws(() => router.connectRecording(destination), errorCode('recording_failed'));
  assert.equal(context.sources[0].connections.size, 1); assert.equal(context.sample(context.destination), .8);
  context.connectFailure = undefined; const cleanup = router.connectRecording(destination);
  assert.equal(context.sample(destination), 1); cleanup(); router.dispose();
});

test('a closed context is refused without node allocation or implicit replacement', async () => {
  const { router, context } = setup(); context.state = 'closed';
  await assert.rejects(router.enableFromGesture(), errorCode('closed'));
  assert.equal(context.sources.length, 0); assert.equal(context.gains.length, 0); assert.equal(context.resumeCount, 0);
  router.dispose();
});
