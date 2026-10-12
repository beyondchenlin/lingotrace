import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMutedCopyController, verifyDecodedVideo } from './muted-copy-controller.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const gate = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const source = new Blob(['original-video-and-mixed-audio'], { type: 'video/webm' });
const muted = new Blob(['same-video-payload'], { type: 'video/webm' });
const dimensions = [{ trackNumber: 1, width: 1280, height: 720 }];
const transformed = { blob: muted, before: { dimensions, lastVideoTimestampSeconds: 3.9 }, after: { dimensions, lastVideoTimestampSeconds: 3.9 }, removedAudioTracks: 1, removedAudioBlocks: 25 };
const decoded = { width: 1280, height: 720, durationSeconds: 4.2, decodedFrame: true };
const record = { id: 'original-id', mimeType: 'video/webm;codecs=vp8,opus', complete: true, status: 'complete' };

function setup(overrides = {}) {
  const calls = { load: [], transform: [], verify: [], created: [], revoked: [], downloads: [] };
  const controller = createMutedCopyController({
    load: async id => { calls.load.push(id); return source; },
    transform: async (blob, options) => { calls.transform.push([blob, options]); return transformed; },
    verify: async (blob, options) => { calls.verify.push([blob, options]); return decoded; },
    createObjectURL: blob => { calls.created.push(blob); return `blob:result-${calls.created.length}`; },
    revokeObjectURL: url => { calls.revoked.push(url); },
    download: (url, filename) => { calls.downloads.push([url, filename]); },
    ...overrides,
  });
  const ready = async () => { controller.select(record); controller.setConsent(true); await controller.generate(); };
  return { controller, calls, ready };
}

test('explicit consent, generation, verified output and actual user preview precede manual download', async () => {
  const { controller: c, calls } = setup();
  assert.equal(c.getState().phase, 'empty');
  await c.generate(); c.setConsent(true); assert.equal(c.getState().consent, false);
  c.select({ ...record, privateTrainingText: 'must not copy this into state or filename' });
  await c.generate(); assert.deepEqual(calls.load, []); assert.equal(c.download(), false);
  assert.equal(c.getState().record.privateTrainingText, undefined);
  c.setConsent(true); await c.generate();
  const state = c.getState();
  assert.equal(state.phase, 'ready'); assert.equal(state.previewed, false);
  assert.equal(Object.isFrozen(state), true); assert.equal(Object.isFrozen(state.record), true); assert.equal(Object.isFrozen(state.info), true);
  assert.deepEqual(calls.load, ['original-id']);
  assert.deepEqual(calls.verify.map(([blob]) => blob), [source, muted]);
  assert.equal(calls.transform[0][0], source); assert.equal(await source.text(), 'original-video-and-mixed-audio');
  assert.deepEqual(calls.downloads, []); assert.equal(c.download(), false);
  c.markPreviewed('blob:stale'); assert.equal(c.download(), false);
  c.markPreviewed(state.previewUrl); assert.equal(c.getState().previewed, true);
  assert.equal(c.download(), true);
  assert.deepEqual(calls.downloads, [['blob:result-1', 'lingotrace-muted-copy.webm']]);
  assert.equal(c.getState().info.durationSeconds, 4.2); assert.equal(c.getState().info.removedAudioTracks, 1);
  c.dispose(); assert.deepEqual(calls.revoked, ['blob:result-1']);
});

test('duplicate generate is one shared operation, and ready cannot regenerate implicitly', async () => {
  const loading = gate(); let loads = 0;
  const { controller: c, calls } = setup({ load: () => { loads++; return loading.promise; } });
  c.select(record); c.setConsent(true);
  const first = c.generate(), second = c.generate(); assert.equal(first, second);
  await tick(); assert.equal(loads, 1); assert.equal(c.getState().phase, 'generating');
  loading.resolve(source); await first;
  await c.generate(); assert.equal(loads, 1); assert.equal(calls.transform.length, 1);
  c.dispose();
});

for (const stage of ['load', 'source verify', 'transform', 'output verify']) {
  test(`cancel fences and settles ignored abort during ${stage}; a late result cannot resurrect anything`, async () => {
    const held = gate(); let verifications = 0; let abortedSignal;
    const { controller: c, calls } = setup({
      ...(stage === 'load' ? { load: () => held.promise } : {}),
      ...(stage === 'transform' ? { transform: (_, { signal }) => { abortedSignal = signal; return held.promise; } } : {}),
      ...(stage.includes('verify') ? { verify: (_, { signal }) => {
        verifications++;
        if (verifications === (stage === 'source verify' ? 1 : 2)) { abortedSignal = signal; return held.promise; }
        return Promise.resolve(decoded);
      } } : {}),
    });
    c.select(record); c.setConsent(true); const generation = c.generate(); await tick();
    c.cancel(); await generation;
    if (abortedSignal) assert.equal(abortedSignal.aborted, true);
    assert.equal(c.getState().phase, 'selected'); assert.equal(c.getState().consent, false);
    const cancelled = c.getState();
    held.resolve(stage === 'load' ? source : stage === 'transform' ? transformed : decoded); await tick();
    assert.equal(c.getState(), cancelled); assert.deepEqual(calls.created, []); assert.deepEqual(calls.downloads, []);
    c.dispose();
  });
}

test('changing selection fences a late rejected loader and permits a fresh independent generation', async () => {
  const held = gate(); let loads = 0;
  const { controller: c, calls } = setup({ load: () => ++loads === 1 ? held.promise : Promise.resolve(source) });
  c.select(record); c.setConsent(true); const old = c.generate(); await tick();
  c.select({ ...record, id: 'replacement' }); assert.equal(c.getState().consent, false);
  c.setConsent(true); await c.generate(); const ready = c.getState();
  held.reject(new Error('old loader failure')); await old; await tick();
  assert.equal(c.getState(), ready); assert.equal(ready.record.id, 'replacement'); assert.equal(calls.created.length, 1);
  c.dispose();
});

for (const action of ['select', 'cancel', 'close', 'background', 'dispose', 'setConsent']) {
  test(`${action} revokes the ready result once and removes all download authority`, async () => {
    const { controller: c, calls, ready } = setup(); await ready();
    const url = c.getState().previewUrl; c.markPreviewed(url);
    if (action === 'select') c.select(record);
    else if (action === 'setConsent') c.setConsent(false);
    else c[action]();
    assert.equal(c.getState().consent, false); assert.equal(c.getState().previewUrl, null);
    assert.equal(c.getState().info, null); assert.equal(c.getState().previewed, false); assert.equal(c.download(), false);
    c.markPreviewed(url); assert.equal(c.download(), false);
    c.dispose(); c.dispose(); assert.deepEqual(calls.revoked, [url]);
  });
}

test('background/dispose abort all stages without notifying after unmount', async () => {
  const held = gate(); const { controller: c, calls } = setup({ verify: () => held.promise });
  let notifications = 0; c.subscribe(() => notifications++);
  c.select(record); c.setConsent(true); const work = c.generate(); await tick();
  c.dispose(); const before = notifications; await work;
  held.resolve(decoded); await tick(); c.select(record); c.setConsent(true); await c.generate();
  assert.equal(notifications, before); assert.deepEqual(calls.created, []); assert.equal(c.getState().phase, 'empty');
});

for (const invalid of [{ ...record, mimeType: 'video/mp4' }, { ...record, status: 'recording' },
  { ...record, complete: false }, { ...record, status: 'interrupted' }, { ...record, id: '' }]) {
  test(`ineligible selection is refused without loading: ${JSON.stringify(invalid)}`, async () => {
    const { controller: c, calls } = setup(); c.select(invalid); c.setConsent(true); await c.generate();
    assert.equal(c.getState().phase, 'error'); assert.equal(c.getState().consent, false); assert.deepEqual(calls.load, []);
    c.dispose();
  });
}

test('loader MIME and empty bytes fail closed before transform', async () => {
  for (const blob of [new Blob(['mp4'], { type: 'video/mp4' }), new Blob([], { type: 'video/webm' })]) {
    const { controller: c, calls, ready } = setup({ load: async () => blob }); await ready();
    assert.equal(c.getState().phase, 'error'); assert.deepEqual(calls.transform, []); assert.deepEqual(calls.created, []); c.dispose();
  }
});

test('synchronous load failure is retryable only after fresh consent', async () => {
  let attempts = 0;
  const { controller: c, calls, ready } = setup({ load: () => { if (++attempts === 1) throw new Error('read failed'); return Promise.resolve(source); } });
  await ready(); assert.equal(c.getState().phase, 'error'); assert.equal(c.getState().error, 'read failed');
  await c.generate(); assert.equal(attempts, 1);
  c.setConsent(true); await c.generate(); assert.equal(c.getState().phase, 'ready'); assert.equal(calls.created.length, 1); c.dispose();
});

for (const invalid of [{ ...decoded, width: 0 }, { ...decoded, height: 0 }, { ...decoded, decodedFrame: false },
  { ...decoded, durationSeconds: Infinity }, { ...decoded, durationSeconds: NaN }, { ...decoded, durationSeconds: 0 }]) {
  test(`unknown/nondecodable verification never enables ready: ${JSON.stringify(invalid)}`, async () => {
    const { controller: c, calls, ready } = setup({ verify: async () => invalid }); await ready();
    assert.equal(c.getState().phase, 'error'); assert.deepEqual(calls.created, []); assert.equal(c.download(), false); c.dispose();
  });
}

for (const after of [{ ...decoded, width: 640 }, { ...decoded, durationSeconds: 4.7 }, { ...decoded, decodedFrame: false }]) {
  test(`output validation mismatch fails closed: ${JSON.stringify(after)}`, async () => {
    let n = 0; const { controller: c, calls, ready } = setup({ verify: async () => ++n === 1 ? decoded : after }); await ready();
    assert.equal(c.getState().phase, 'error'); assert.deepEqual(calls.created, []); c.dispose();
  });
}

test('container dimensions must match actual native decoded dimensions', async () => {
  const { controller: c, calls, ready } = setup({ transform: async () => ({ ...transformed, after: { dimensions: [{ width: 640, height: 480 }] } }) });
  await ready(); assert.equal(c.getState().phase, 'error'); assert.deepEqual(calls.created, []); c.dispose();
});

test('visible preview errors revoke result and stale video errors are ignored', async () => {
  const { controller: c, calls, ready } = setup(); await ready(); const url = c.getState().previewUrl;
  c.previewFailed('blob:old'); assert.equal(c.getState().phase, 'ready');
  c.markPreviewed(url); c.previewFailed(url);
  assert.equal(c.getState().phase, 'error'); assert.deepEqual(calls.revoked, [url]); assert.equal(c.download(), false); c.dispose();
});

test('download failure revokes result, while failed transform never allocates preview URL', async () => {
  const failed = setup({ transform: async () => { throw new Error('unsupported container'); } });
  await failed.ready(); assert.equal(failed.controller.getState().phase, 'error'); assert.deepEqual(failed.calls.created, []); failed.controller.dispose();
  const { controller: c, calls, ready } = setup({ download: () => { throw new Error('blocked'); } });
  await ready(); const url = c.getState().previewUrl; c.markPreviewed(url); assert.equal(c.download(), false);
  assert.equal(c.getState().phase, 'error'); assert.deepEqual(calls.revoked, [url]); c.dispose();
});

test('synchronous subscribers may cancel generating without any source read', async () => {
  const { controller: c, calls } = setup(); c.select(record); c.setConsent(true);
  c.subscribe(() => { if (c.getState().phase === 'generating') c.close(); });
  await c.generate(); assert.deepEqual(calls.load, []); assert.equal(c.getState().phase, 'empty'); c.dispose();
});

class FakeVideo extends EventTarget {
  duration = NaN; readyState = 0; videoWidth = 0; videoHeight = 0; error = null;
  src = ''; loadCalls = 0; pauseCalls = 0; removeCalls = 0; seeks = []; registered = new Set();
  addEventListener(name, callback, options) { this.registered.add(name); super.addEventListener(name, callback, options); }
  removeEventListener(name, callback, options) { this.registered.delete(name); super.removeEventListener(name, callback, options); }
  load() { this.loadCalls++; }
  play() { assert.fail('verification must never autoplay'); }
  pause() { this.pauseCalls++; }
  remove() { this.removeCalls++; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  set currentTime(value) { this.seeks.push(value); this.seek?.(value); }
  get currentTime() { return this.seeks.at(-1) ?? 0; }
  emit(name) { this.dispatchEvent(new Event(name)); }
  metadata(duration = 4.2) { this.duration = duration; this.videoWidth = 1280; this.videoHeight = 720; this.readyState = 1; this.emit('loadedmetadata'); }
  frame() { this.readyState = 2; this.emit('loadeddata'); }
}
function nativeSetup(extra = {}) {
  const video = new FakeVideo(); const timers = new Map(); let nextTimer = 0;
  const calls = { urls: [], revoked: [], draws: 0, reads: 0, canvasRemoves: 0 };
  const canvas = { width: 0, height: 0, remove: () => calls.canvasRemoves++, getContext: () => ({
    drawImage: (actual) => { assert.equal(actual, video); calls.draws++; },
    getImageData: () => { calls.reads++; return { data: new Uint8ClampedArray(4) }; },
  }) };
  const options = {
    createVideo: () => video, createCanvas: () => canvas,
    createObjectURL: blob => { calls.urls.push(blob); return 'blob:private-verification'; },
    revokeObjectURL: url => calls.revoked.push(url),
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: timer => timers.delete(timer), ...extra,
  };
  const clean = () => {
    assert.deepEqual(calls.revoked, ['blob:private-verification']); assert.equal(timers.size, 0);
    assert.equal(video.registered.size, 0); assert.equal(video.src, ''); assert.equal(video.pauseCalls, 1); assert.equal(video.removeCalls, 1);
  };
  return { video, canvas, calls, options, timers, clean };
}

test('native verifier requires drawable decoded frame, not metadata, and cleans its private resources', async () => {
  const f = nativeSetup(); const verifying = verifyDecodedVideo(source, f.options); let settled = false; verifying.then(() => { settled = true; });
  assert.equal(f.video.muted, true); assert.equal(f.video.defaultMuted, true); assert.equal(f.video.volume, 0); assert.equal(f.video.autoplay, false);
  f.video.metadata(); await tick(); assert.equal(settled, false); assert.equal(f.calls.draws, 0);
  f.video.frame(); assert.deepEqual(await verifying, decoded); assert.equal(f.calls.draws, 1); assert.equal(f.calls.reads, 1);
  assert.deepEqual(f.video.seeks, []); f.clean(); assert.equal(f.canvas.width, 0); assert.equal(f.canvas.height, 0);
});

test('initial MediaRecorder Infinity duration is recovered by bounded native EOF seek without playing', async () => {
  const f = nativeSetup(); const verifying = verifyDecodedVideo(source, f.options);
  f.video.metadata(Infinity); f.video.frame(); assert.deepEqual(f.video.seeks, [86400]);
  f.video.duration = 4.2; f.video.emit('durationchange');
  assert.deepEqual(await verifying, decoded); f.clean();
});

for (const duration of [Infinity, NaN, 0]) {
  test(`unknown native duration ${duration} never borrows a seek time or guesses a duration`, async () => {
    const f = nativeSetup(); const verifying = verifyDecodedVideo(source, f.options);
    f.video.metadata(duration); f.video.frame(); f.video.emit('seeked');
    assert.deepEqual(f.video.seeks, [86400]); [...f.timers.values()][0]();
    await assert.rejects(verifying, /有限录像时长/); f.clean();
  });
}

test('finite metadata with no decoded frame and zero-dimension frames fail closed', async () => {
  for (const zeroDimensions of [false, true]) {
    const f = nativeSetup(); const verifying = verifyDecodedVideo(source, f.options); f.video.metadata();
    if (zeroDimensions) { f.video.videoWidth = 0; f.video.frame(); }
    [...f.timers.values()][0](); await assert.rejects(verifying, /未能解码录像画面/); assert.equal(f.calls.draws, 0); f.clean();
  }
});

test('native error, canvas decode/read failure, and out-of-bounds duration release every resource', async () => {
  for (const scenario of ['media', 'canvas', 'duration']) {
    const f = nativeSetup();
    if (scenario === 'canvas') f.canvas.getContext = () => ({ drawImage() { throw new Error('not decoded'); } });
    const verifying = verifyDecodedVideo(source, f.options);
    if (scenario === 'media') { f.video.error = { code: 3 }; f.video.emit('error'); }
    else { f.video.metadata(scenario === 'duration' ? 90000 : 4.2); f.video.frame(); }
    await assert.rejects(verifying); f.clean();
  }
});

test('native verifier aborts promptly before metadata and after frame/EOF seek, with no lingering listener', async () => {
  for (const stage of ['before', 'metadata', 'seek']) {
    const abort = new AbortController(); const f = nativeSetup({ signal: abort.signal });
    if (stage === 'before') abort.abort();
    const verifying = verifyDecodedVideo(source, f.options);
    if (stage === 'seek') { f.video.metadata(Infinity); f.video.frame(); }
    if (stage !== 'before') abort.abort();
    await assert.rejects(verifying, { name: 'AbortError' });
    if (stage === 'before') { assert.deepEqual(f.calls.urls, []); assert.equal(f.timers.size, 0); }
    else f.clean();
  }
});

test('an audio-only tail may disappear without changing video timestamps or padding guessed duration', async () => {
  let calls = 0;
  const { controller: c, ready } = setup({ verify: async () => ({ ...decoded, durationSeconds: ++calls === 1 ? 19.439 : 4.2 }) });
  await ready(); assert.equal(c.getState().phase, 'ready');
  assert.equal(c.getState().info.sourceDurationSeconds, 19.439); assert.equal(c.getState().info.durationSeconds, 4.2);
  c.dispose();
});

test('output duration must still reach the last retained video timestamp', async () => {
  let calls = 0;
  const { controller: c, ready } = setup({ verify: async () => ({ ...decoded, durationSeconds: ++calls === 1 ? 4.2 : 2 }) });
  await ready(); assert.equal(c.getState().phase, 'error'); assert.equal(c.getState().previewUrl, null); c.dispose();
});

test('size cap is enforced before allocating a decoder or invoking transform', async () => {
  class OversizedBlob extends Blob { get size() { return 256 * 1024 * 1024 + 1; } }
  const { controller: c, calls, ready } = setup({ load: async () => new OversizedBlob(['x'], { type: 'video/webm' }) });
  await ready(); assert.equal(c.getState().phase, 'error'); assert.match(c.getState().error, /256 MiB/);
  assert.deepEqual(calls.verify, []); assert.deepEqual(calls.transform, []); c.dispose();
});

test('structured transform errors are understandable without exposing implementation messages', async () => {
  for (const code of ['WEBM_TOO_LARGE', 'WEBM_TOO_COMPLEX', 'UNSUPPORTED_WEBM', 'INVALID_WEBM']) {
    const { controller: c, ready } = setup({ transform: async () => { throw Object.assign(new Error('technical parser failure'), { code }); } });
    await ready(); assert.equal(c.getState().phase, 'error'); assert.doesNotMatch(c.getState().error, /technical parser failure/); c.dispose();
  }
});

test('same-turn cancellation prevents a scheduled loader from being called', async () => {
  const { controller: c, calls } = setup(); c.select(record); c.setConsent(true); const work = c.generate(); c.cancel(); await work;
  assert.deepEqual(calls.load, []); assert.equal(c.getState().phase, 'selected'); c.dispose();
});

test('native error event itself fails even when the platform has no MediaError object', async () => {
  const f = nativeSetup(); const verifying = verifyDecodedVideo(source, f.options); f.video.emit('error');
  await assert.rejects(verifying, /无法解码录像/); f.clean();
});
