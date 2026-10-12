import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { ORIGINAL_COURSE_MEDIA, createOriginalCourseMediaPool, createContextBookmarkPreviewController } from './context-bookmark-media.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const gate = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const hashBytes = value => Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16)).buffer;
const goodDigest = () => Promise.resolve(hashBytes(ORIGINAL_COURSE_MEDIA.mediaSha256));
const source = new Blob(['original local video bytes'], { type: 'video/mp4' });
function poolSetup(extra = {}) {
  const calls = { fetches: [], blobs: [], digests: [], created: [], revoked: [] };
  const pool = createOriginalCourseMediaPool({
    fetch: async (url, options) => { calls.fetches.push([url, options]); return { ok: true, blob: async () => { calls.blobs.push(source); return source; } }; },
    digest: async bytes => { calls.digests.push(bytes); return goodDigest(); },
    createObjectURL: blob => { calls.created.push(blob); return `blob:original-${calls.created.length}`; },
    revokeObjectURL: url => calls.revoked.push(url), ...extra,
  });
  return { pool, calls };
}
const reference = Object.freeze({ materialId: 'cafe-original', materialVersion: 'cafe-studio-v1', cueId: 'cafe-studio-1',
  text: 'Could I have a coffee, please?', startSeconds: 0, endSeconds: 6,
  mediaId: ORIGINAL_COURSE_MEDIA.mediaId, mediaSha256: ORIGINAL_COURSE_MEDIA.mediaSha256 });
const secondReference = Object.freeze({ ...reference, cueId: 'cafe-studio-2', text: 'Would you like it hot or iced?', startSeconds: 6, endSeconds: 12 });
const validate = value => [reference, secondReference].some(expected => Object.keys(expected).every(key => expected[key] === value[key])) ? null : '书签与当前原片版本不一致。';

class TrackedTarget extends EventTarget {
  handlers = new Map();
  addEventListener(name, listener, options) { const set = this.handlers.get(name) ?? new Set(); set.add(listener); this.handlers.set(name, set); super.addEventListener(name, listener, options); }
  removeEventListener(name, listener, options) { this.handlers.get(name)?.delete(listener); if (!this.handlers.get(name)?.size) this.handlers.delete(name); super.removeEventListener(name, listener, options); }
  emit(name) { this.dispatchEvent(new Event(name)); }
  get listenerCount() { return [...this.handlers.values()].reduce((sum, set) => sum + set.size, 0); }
}
class FakeVideo extends TrackedTarget {
  _src = ''; currentSrc = ''; duration = NaN; readyState = 0; paused = true; _time = 0;
  volume = 1; muted = false; playbackRate = 1; loop = true; autoplay = true;
  loads = 0; plays = 0; pauses = 0; seeks = []; metadataDuration = 72; metadataAuto = true; playOverride = null;
  get src() { return this._src; }
  set src(value) { this._src = value; this.currentSrc = value; this.readyState = 0; this.duration = NaN; }
  get currentTime() { return this._time; }
  set currentTime(value) { this._time = value; this.seeks.push(value); }
  load() { this.loads++; if (this._src && this.metadataAuto) queueMicrotask(() => { if (this._src) this.metadata(); }); }
  metadata() { this.duration = this.metadataDuration; this.readyState = 1; this.emit('loadedmetadata'); }
  play() { this.plays++; if (this.playOverride) return this.playOverride(); this.paused = false; this.emit('play'); this.emit('playing'); return Promise.resolve(); }
  pause() { this.pauses++; if (!this.paused) { this.paused = true; this.emit('pause'); } }
  removeAttribute(name) { if (name === 'src') { this._src = ''; this.currentSrc = ''; this.readyState = 0; this.duration = NaN; } }
  advance(seconds) { this._time = seconds; this.emit('timeupdate'); }
}
function previewSetup(extra = {}) {
  const shared = extra.shared ?? poolSetup();
  const video = extra.video ?? new FakeVideo();
  const documentTarget = new TrackedTarget(), windowTarget = new TrackedTarget();
  let hidden = false, recording = false;
  const controller = createContextBookmarkPreviewController({ video, pool: shared.pool, validateReference: validate,
    lifecycle: { documentTarget, windowTarget, isHidden: () => hidden }, isRecordingBlocked: () => recording,
    ...extra.dependencies,
  });
  const ready = async (ref = reference) => { controller.select(ref); await controller.load(); };
  return { ...shared, video, controller, ready, documentTarget, windowTarget,
    setHidden: value => { hidden = value; documentTarget.emit('visibilitychange'); },
    setRecordingGuard: value => { recording = value; },
  };
}

test('lesson and preview acquisitions share fetch, digest, Blob and URL until last idempotent release', async () => {
  const { pool, calls } = poolSetup();
  const [lesson, preview] = await Promise.all([pool.acquire(), pool.acquire()]);
  assert.notEqual(lesson, preview); assert.equal(lesson.url, preview.url); assert.equal(lesson.verified, true);
  assert.equal(lesson.actualSha256, ORIGINAL_COURSE_MEDIA.mediaSha256); assert.equal(Object.isFrozen(lesson), true);
  assert.equal(calls.fetches.length, 1); assert.equal(calls.digests.length, 1); assert.deepEqual(calls.created, [source]);
  assert.equal(calls.fetches[0][0], '/studio-assets/06-cafe.mp4');
  lesson.release(); lesson.release(); assert.deepEqual(calls.revoked, []);
  const third = await pool.acquire({ retry: true }); assert.equal(third.url, preview.url); assert.equal(calls.fetches.length, 1);
  preview.release(); assert.deepEqual(calls.revoked, []); third.release(); assert.deepEqual(calls.revoked, ['blob:original-1']);
  const fresh = await pool.acquire(); assert.equal(calls.fetches.length, 2); fresh.release();
});

test('aborting one pending borrower preserves the shared operation and other borrower', async () => {
  const held = gate(); const { pool, calls } = poolSetup({ fetch: async (_, { signal }) => { calls.fetches.push(signal); return held.promise; } });
  const abort = new AbortController(); const canceled = pool.acquire({ signal: abort.signal }), kept = pool.acquire();
  await tick(); abort.abort(); await assert.rejects(canceled, { name: 'AbortError' });
  assert.equal(calls.fetches[0].aborted, false);
  held.resolve({ ok: true, blob: async () => source }); const lease = await kept;
  assert.equal(lease.verified, true); assert.deepEqual(calls.revoked, []); lease.release();
});

for (const stage of ['fetch', 'blob', 'digest']) {
  test(`last pending borrower abort settles immediately during ${stage}, no late URL or cache`, async () => {
    const held = gate(); let fetchSignal;
    const extra = stage === 'fetch' ? { fetch: (_, { signal }) => { fetchSignal = signal; return held.promise; } } :
      stage === 'blob' ? { fetch: async (_, { signal }) => { fetchSignal = signal; return { ok: true, blob: () => held.promise }; } } : { digest: () => held.promise };
    const { pool, calls } = poolSetup(extra); const abort = new AbortController();
    const pending = pool.acquire({ signal: abort.signal }); await tick(); abort.abort(); await assert.rejects(pending, { name: 'AbortError' });
    if (fetchSignal) assert.equal(fetchSignal.aborted, true);
    held.resolve(stage === 'fetch' ? { ok: true, blob: async () => source } : stage === 'blob' ? source : await goodDigest());
    await tick(); assert.deepEqual(calls.created, []); assert.deepEqual(calls.revoked, []);
  });
}

test('preaborted acquire never fetches, and aborting an allocated lease revokes only after final holder', async () => {
  const { pool, calls } = poolSetup(); const abort = new AbortController(); abort.abort();
  await assert.rejects(pool.acquire({ signal: abort.signal }), { name: 'AbortError' }); assert.equal(calls.fetches.length, 0);
  const live = new AbortController(); const first = await pool.acquire({ signal: live.signal }), second = await pool.acquire();
  live.abort(); assert.deepEqual(calls.revoked, []); first.release(); second.release(); assert.equal(calls.revoked.length, 1);
});

test('invalid bytes remain playable by lesson only; explicit retry replaces generation without breaking retained URL', async () => {
  let attempts = 0; const { pool, calls } = poolSetup({ digest: async () => ++attempts === 1 ? new ArrayBuffer(32) : goodDigest() });
  const lesson = await pool.acquire(), rejectedPreview = await pool.acquire();
  assert.equal(lesson.verified, false); assert.match(lesson.verificationError, /不匹配/); assert.equal(lesson.url, rejectedPreview.url);
  rejectedPreview.release(); assert.equal(attempts, 1);
  const retried = await pool.acquire({ retry: true }); assert.equal(retried.verified, true); assert.equal(attempts, 2);
  assert.notEqual(retried.url, lesson.url); assert.deepEqual(calls.revoked, []);
  lesson.release(); assert.deepEqual(calls.revoked, ['blob:original-1']); retried.release(); assert.equal(calls.revoked.length, 2);
});

test('digest failure is distinct from hash mismatch, retryable explicitly, without guessing verification', async () => {
  let attempt = 0; const { pool } = poolSetup({ digest: async () => { if (++attempt === 1) throw new Error('crypto unavailable'); return goodDigest(); } });
  const failed = await pool.acquire(); assert.equal(failed.verified, false); assert.equal(failed.actualSha256, null); assert.match(failed.verificationError, /无法完成/);
  const same = await pool.acquire(); assert.equal(attempt, 1); same.release();
  const retried = await pool.acquire({ retry: true }); assert.equal(retried.verified, true); failed.release(); retried.release();
});

for (const failure of ['throw', 'http', 'empty']) {
  test(`fetch ${failure} failure creates no URL and next explicit acquire can retry`, async () => {
    let n = 0; const { pool, calls } = poolSetup({ fetch: async () => {
      if (++n === 1) { if (failure === 'throw') throw new Error('network'); return { ok: failure !== 'http', blob: async () => new Blob([]) }; }
      return { ok: true, blob: async () => source };
    } });
    await assert.rejects(pool.acquire(), /原片未能加载/); assert.deepEqual(calls.created, []);
    const retry = await pool.acquire(); assert.equal(retry.verified, true); retry.release();
  });
}

test('real bundled MP4 bytes verify by SHA-256, and changing one byte fails closed', async () => {
  const bytes = await readFile(new URL('../../public/studio-assets/06-cafe.mp4', import.meta.url));
  const original = new Blob([bytes]); bytes[0] ^= 1; const changed = new Blob([bytes]);
  for (const [blob, verified] of [[original, true], [changed, false]]) {
    const { pool } = poolSetup({ fetch: async () => ({ ok: true, blob: async () => blob }), digest: data => webcrypto.subtle.digest('SHA-256', data) });
    const lease = await pool.acquire(); assert.equal(lease.verified, verified); lease.release();
  }
});

test('synchronous cancellation inside URL allocation revokes the late URL exactly once', async () => {
  const abort = new AbortController(); const revoked = [];
  const { pool } = poolSetup({ createObjectURL: () => { abort.abort(); return 'blob:late'; }, revokeObjectURL: url => revoked.push(url) });
  await assert.rejects(pool.acquire({ signal: abort.signal }), { name: 'AbortError' }); await tick(); assert.deepEqual(revoked, ['blob:late']);
});

test('selection + shared metadata load never plays; explicit play is confined to the selected cue', async () => {
  const p = previewSetup(); const { controller: c, video, calls } = p;
  c.select({ ...reference, unrelatedPrivateText: 'not retained' });
  assert.equal(c.getState().reference.unrelatedPrivateText, undefined); assert.equal(Object.isFrozen(c.getState().reference), true);
  const first = c.load(), duplicate = c.load(); assert.equal(first, duplicate); await first;
  assert.equal(c.getState().phase, 'ready'); assert.equal(c.getState().duration, 72); assert.equal(video.plays, 0);
  assert.equal(video.loop, false); assert.equal(video.autoplay, false); assert.equal(video.currentTime, 0);
  await c.play(); assert.equal(video.plays, 1); assert.equal(video.paused, false); assert.equal(c.getState().phase, 'playing');
  video.advance(6.2); assert.equal(video.paused, true); assert.equal(video.currentTime, 6); assert.equal(c.getState().phase, 'ready');
  await c.play(); assert.equal(video.currentTime, 0); c.pause(); assert.equal(video.paused, true);
  c.seek(-100); assert.equal(video.currentTime, 0); c.seek(100); assert.equal(video.currentTime, 6);
  c.close(); assert.equal(video.src, ''); assert.equal(c.getState().phase, 'empty'); assert.deepEqual(calls.revoked, ['blob:original-1']); c.dispose();
});

test('main lesson and controller retain one shared URL; preview close does not break lesson playback', async () => {
  const shared = poolSetup(); const lesson = await shared.pool.acquire(); const p = previewSetup({ shared }); await p.ready();
  assert.equal(p.video.src, lesson.url); assert.equal(shared.calls.fetches.length, 1); assert.equal(shared.calls.digests.length, 1);
  p.controller.close(); assert.deepEqual(shared.calls.revoked, []); lesson.release(); assert.deepEqual(shared.calls.revoked, [lesson.url]); p.controller.dispose();
});

for (const patch of [{ mediaId: 'arbitrary' }, { mediaSha256: 'f'.repeat(64) }, { materialVersion: 'old' }, { materialId: 'old-history' },
  { cueId: 'unknown' }, { text: 'changed' }, { startSeconds: -1 }, { endSeconds: 0 }, { endSeconds: Infinity }, { startSeconds: NaN }]) {
  test(`invalid/unknown reference never acquires a source: ${JSON.stringify(patch)}`, async () => {
    const p = previewSetup(); await p.ready({ ...reference, ...patch }); await p.controller.play();
    assert.equal(p.controller.getState().phase, 'error'); assert.equal(p.calls.fetches.length, 0); assert.equal(p.video.plays, 0); p.controller.dispose();
  });
}

for (const duration of [NaN, Infinity, 0, -1, 5.99]) {
  test(`actual invalid or short duration ${duration} cannot play`, async () => {
    const video = new FakeVideo(); video.metadataDuration = duration; const p = previewSetup({ video, dependencies: { metadataTimeoutMs: 10 } }); await p.ready(); await p.controller.play();
    assert.equal(p.controller.getState().phase, 'error');
    assert.match(p.controller.getState().error, duration > 0 && Number.isFinite(duration) ? /^片段时间范围超过原片实际有限时长，不能播放。/ : /^原片元数据加载超时，请手动重试。/);
    assert.ok(p.controller.getState().error.endsWith(`[range-v71; actual=${duration}; cueStart=0; cueEnd=6; ready=1; transport=blob]`));
    assert.equal(video.plays, 0); assert.equal(video.src, ''); assert.equal(p.calls.revoked.length, 1); p.controller.dispose();
  });
}

test('exact boundary equals actual duration; later invalid duration/source changes stop and revoke', async () => {
  for (const change of ['duration', 'source']) {
    const video = new FakeVideo(); video.metadataDuration = 6; const p = previewSetup({ video }); await p.ready(); await p.controller.play();
    if (change === 'duration') { video.duration = Infinity; video.emit('durationchange'); }
    else { video.src = 'blob:another-unverified-source'; video.emit('timeupdate'); }
    assert.equal(p.controller.getState().phase, 'error'); if(change==='duration')assert.equal(p.controller.getState().error, '片段时间范围超过原片实际有限时长，不能播放。 [range-v71; actual=Infinity; cueStart=0; cueEnd=6; ready=1; transport=blob]'); assert.equal(video.paused, true); assert.equal(video.src, ''); p.controller.dispose();
  }
});

test('bad hash and unavailable digest refuse bookmark playback without any fallback URL', async () => {
  for (const digest of [async () => new ArrayBuffer(32), async () => { throw new Error('not available'); }]) {
    const shared = poolSetup({ digest }); const lesson = await shared.pool.acquire(); const p = previewSetup({ shared }); await p.ready();
    assert.equal(p.controller.getState().phase, 'error'); assert.equal(p.video.src, ''); assert.equal(p.video.plays, 0);
    assert.equal(shared.calls.fetches.length, 1); assert.deepEqual(shared.calls.revoked, []); p.controller.dispose(); lesson.release();
  }
});

test('metadata error and timeout clean pending handlers and release the source', async () => {
  for (const reason of ['error', 'timeout']) {
    const video = new FakeVideo(); video.metadataAuto = false;
    const p = previewSetup({ video, dependencies: { metadataTimeoutMs: 10 } }); const baseline = video.listenerCount;
    p.controller.select(reference); const loading = p.controller.load(); await tick(); if (reason === 'error') video.emit('error'); await loading;
    assert.equal(p.controller.getState().phase, 'error'); assert.equal(video.listenerCount, baseline); assert.equal(video.src, ''); assert.equal(p.calls.revoked.length, 1); p.controller.dispose();
  }
});

for (const action of ['close', 'select', 'background', 'dispose']) {
  test(`${action} cancels metadata loading and a late event cannot restore preview`, async () => {
    const video = new FakeVideo(); video.metadataAuto = false; const p = previewSetup({ video });
    p.controller.select(reference); const loading = p.controller.load(); await tick();
    if (action === 'select') p.controller.select(secondReference); else p.controller[action]();
    await loading; const after = p.controller.getState(); video.metadata(); await tick();
    assert.equal(p.controller.getState(), after); assert.equal(video.src, ''); assert.equal(video.plays, 0); assert.equal(p.calls.revoked.length, 1); p.controller.dispose();
  });
}

test('changing selection while fetch is unresolved aborts old borrower, then fresh selection may load', async () => {
  const held = gate(); let n = 0; const shared = poolSetup({ fetch: async () => ++n === 1 ? held.promise : { ok: true, blob: async () => source } });
  const p = previewSetup({ shared }); p.controller.select(reference); const old = p.controller.load(); await tick();
  p.controller.select(secondReference); await p.controller.load(); await old;
  const after = p.controller.getState(); held.resolve({ ok: true, blob: async () => source }); await tick();
  assert.equal(p.controller.getState(), after); assert.equal(after.reference.cueId, secondReference.cueId); assert.equal(p.video.currentTime, 6);
  assert.equal(shared.calls.created.length, 1); p.controller.dispose();
});

test('monitor preferences affect only native preview monitor, including changes during play', async () => {
  const p = previewSetup(); await p.ready(); const c = p.controller;
  c.setMonitor({ volume: .3, courseMuted: false, allMuted: false }); await c.play();
  assert.equal(p.video.volume, .3); assert.equal(p.video.muted, false);
  c.setMonitor({ volume: .6, courseMuted: true, allMuted: false }); assert.equal(p.video.muted, true); assert.equal(p.video.volume, .6);
  c.setMonitor({ volume: .6, courseMuted: false, allMuted: true }); assert.equal(p.video.muted, true);
  c.setMonitor({ volume: 8, courseMuted: false, allMuted: false }); assert.equal(p.video.muted, false); assert.equal(p.video.volume, 1);
  c.setMonitor({ volume: NaN, courseMuted: false, allMuted: false }); assert.equal(p.video.volume, 0);
  c.pause(); assert.equal(p.video.muted, true); c.dispose();
});

for (const phase of ['starting', 'recording', 'stopping']) {
  test(`${phase} recording blocks active/native playback and never resumes on return`, async () => {
    const p = previewSetup(); await p.ready(); await p.controller.play(); p.controller.setRecordingBlocked(true);
    assert.equal(p.video.paused, true); assert.equal(p.video.muted, true); assert.equal(p.controller.getState().recordingBlocked, true);
    const count = p.video.plays; await p.controller.play(); assert.equal(p.video.plays, count);
    p.video.paused = false; p.video.emit('play'); assert.equal(p.video.paused, true);
    p.controller.setRecordingBlocked(false); assert.equal(p.video.paused, true); assert.equal(p.video.plays, count);
    await p.controller.play(); assert.equal(p.video.plays, count + 1); p.controller.dispose();
  });
}

test('authoritative recording guard wins even before a state-setter/render arrives', async () => {
  const p = previewSetup(); await p.ready(); p.setRecordingGuard(true); await p.controller.play();
  assert.equal(p.video.plays, 0); assert.match(p.controller.getState().error, /录制/);
  p.setRecordingGuard(false); await p.controller.play(); p.setRecordingGuard(true); p.video.emit('timeupdate');
  assert.equal(p.video.paused, true); assert.equal(p.video.muted, true); p.controller.dispose();
});

test('recording starts during metadata loading: pending request settles, source released, no late playback', async () => {
  const video = new FakeVideo(); video.metadataAuto = false; const p = previewSetup({ video });
  p.controller.select(reference); const loading = p.controller.load(); await tick(); p.controller.setRecordingBlocked(true); await loading;
  video.metadata(); await tick(); assert.equal(p.controller.getState().phase, 'selected'); assert.equal(video.src, ''); assert.equal(video.plays, 0);
  p.controller.setRecordingBlocked(false); assert.equal(video.plays, 0); p.controller.dispose();
});

for (const interrupt of ['recording', 'close', 'select', 'hidden', 'pagehide', 'dispose']) {
  test(`late native play fulfillment after ${interrupt} cannot restart sound`, async () => {
    const p = previewSetup(); await p.ready(); const held = gate();
    p.video.playOverride = () => held.promise.then(() => { p.video.paused = false; p.video.emit('playing'); });
    const play = p.controller.play();
    if (interrupt === 'recording') p.controller.setRecordingBlocked(true);
    else if (interrupt === 'hidden') p.setHidden(true);
    else if (interrupt === 'pagehide') p.windowTarget.emit('pagehide');
    else if (interrupt === 'select') p.controller.select(secondReference);
    else p.controller[interrupt]();
    await play; held.resolve(); await tick();
    assert.equal(p.video.paused, true); assert.equal(p.video.muted, true); assert.notEqual(p.controller.getState().phase, 'playing'); p.controller.dispose();
  });
}

for (const event of ['visibilitychange', 'pagehide']) {
  test(`real ${event} event target cancels loading and releases preview; returning never autoplays`, async () => {
    const video = new FakeVideo(); video.metadataAuto = false; const p = previewSetup({ video });
    p.controller.select(reference); const pending = p.controller.load(); await tick();
    if (event === 'visibilitychange') p.setHidden(true); else p.windowTarget.emit('pagehide');
    await pending; assert.equal(video.src, ''); assert.equal(p.calls.revoked.length, 1);
    if (event === 'visibilitychange') p.setHidden(false); else p.windowTarget.emit('pageshow');
    video.metadata(); assert.equal(video.plays, 0); assert.equal(p.controller.getState().phase, 'selected');
    p.controller.dispose(); assert.equal(video.listenerCount, 0); assert.equal(p.documentTarget.listenerCount, 0); assert.equal(p.windowTarget.listenerCount, 0);
  });
}

test('validation is rechecked before every play and while playing, not trusted from initial load', async () => {
  let current = true; const p = previewSetup({ dependencies: { validateReference: ref => current ? validate(ref) : '当前版本已变更。' } });
  await p.ready(); current = false; await p.controller.play(); assert.equal(p.video.plays, 0); assert.equal(p.controller.getState().phase, 'error');
  current = true; await p.ready(); await p.controller.play(); current = false; p.video.emit('timeupdate');
  assert.equal(p.video.paused, true); assert.equal(p.controller.getState().phase, 'error'); p.controller.dispose();
});

test('native play without explicit controller authorization is stopped; native seeks remain cue-bounded', async () => {
  const p = previewSetup(); await p.ready(secondReference);
  p.video.paused = false; p.video.emit('play'); assert.equal(p.video.paused, true); assert.equal(p.video.muted, true);
  await p.controller.play(); p.video._time = 1; p.video.emit('seeking'); assert.equal(p.video.currentTime, 6);
  p.video._time = 70; p.video.emit('seeking'); assert.equal(p.video.currentTime, 12); assert.equal(p.video.paused, true); p.controller.dispose();
});

test('native decode errors and ended events halt and keep no unattended playback', async () => {
  const p = previewSetup(); await p.ready(); await p.controller.play(); p.video.emit('ended'); assert.equal(p.video.paused, true); assert.equal(p.video.currentTime, 6);
  await p.controller.play(); p.video.emit('error'); assert.equal(p.video.paused, true); assert.equal(p.video.src, ''); assert.equal(p.controller.getState().phase, 'error'); p.controller.dispose();
});

test('play rejection is visible and requires a fresh explicit click; synchronous close during loading reads no bytes', async () => {
  const p = previewSetup(); await p.ready(); p.video.playOverride = () => Promise.reject(new Error('Playback not allowed'));
  await p.controller.play(); assert.equal(p.controller.getState().phase, 'ready'); assert.equal(p.controller.getState().error, 'Playback not allowed'); assert.equal(p.video.paused, true);
  p.controller.close(); const fetches = p.calls.fetches.length; p.controller.select(reference);
  p.controller.subscribe(() => { if (p.controller.getState().phase === 'loading') p.controller.close(); });
  await p.controller.load(); assert.equal(p.calls.fetches.length, fetches); p.controller.dispose();
});

test('controller contains no audio graph, microphone, recording, generated-sound or alternate-fetch path', async () => {
  const text = await readFile(new URL('./context-bookmark-media.ts', import.meta.url), 'utf8');
  for (const forbidden of ['createMediaElementSource(', 'captureStream(', 'getUserMedia(', 'new AudioContext(', 'new MediaRecorder(', 'createOscillator(', 'createMediaStreamDestination(']) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
  assert.equal((text.match(/fetch\(/g) ?? []).length, 1);
});

test('boundary watchdog stops playback even without a native timeupdate event', async () => {
  const p = previewSetup(); await p.ready(); await p.controller.play();
  // Browser throttling can delay timeupdate. The independent watchdog reads time.
  p.video._time = 6.15;
  await new Promise(resolve => setTimeout(resolve, 125));
  assert.equal(p.video.paused, true); assert.equal(p.video.currentTime, 6); assert.equal(p.controller.getState().phase, 'ready');
  p.controller.dispose();
});

test('disposed/hidden controller cannot start new loads or leave subscriptions or URLs behind', async () => {
  const p = previewSetup(); p.setHidden(true); p.controller.select(reference); await p.controller.load();
  assert.equal(p.calls.fetches.length, 0); p.setHidden(false); await p.controller.load();
  let notifications = 0; p.controller.subscribe(() => notifications++); p.controller.dispose(); const last = notifications;
  p.controller.select(secondReference); await p.controller.load(); await p.controller.play(); p.controller.seek(8);
  p.controller.setRecordingBlocked(true); p.controller.setMonitor({ volume: 1, courseMuted: false, allMuted: false });
  p.documentTarget.emit('visibilitychange'); p.windowTarget.emit('pageshow'); p.video.emit('play');
  assert.equal(notifications, last); assert.equal(p.calls.fetches.length, 1); assert.equal(p.calls.revoked.length, 1);
  assert.equal(p.video.listenerCount, 0); assert.equal(p.documentTarget.listenerCount, 0); assert.equal(p.windowTarget.listenerCount, 0);
});

test('independent: stale fulfilled native Play must not pause a newer explicitly-started selection', async () => {
 const p=previewSetup(); await p.ready(); const held=gate();
 p.video.playOverride=()=>{p.video.paused=false;p.video.emit('play');p.video.emit('playing');return held.promise};
 const old=p.controller.play();
 p.controller.select(secondReference); await p.controller.load(); await old;
 p.video.playOverride=null;await p.controller.play();
 assert.equal(p.controller.getState().phase,'playing'); assert.equal(p.video.paused,false);
 held.resolve();await tick();
 const actual={phase:p.controller.getState().phase,paused:p.video.paused,muted:p.video.muted,reference:p.controller.getState().reference.cueId};
 p.controller.dispose();
 assert.deepEqual(actual,{phase:'playing',paused:false,muted:false,reference:secondReference.cueId});
});
test('independent: queued native pause event must not silence a newer active playback', async () => {
 const p=previewSetup();await p.ready(); await p.controller.play();
 let pendingPause=null;
 p.video.pause=()=>{p.video.pauses++;if(!p.video.paused){p.video.paused=true;pendingPause=()=>p.video.emit('pause')}};
 p.controller.pause();
 await p.controller.play();
 assert.equal(p.video.paused,false); assert.equal(p.video.muted,false);
 pendingPause(); await tick();
 const actual={phase:p.controller.getState().phase,paused:p.video.paused,muted:p.video.muted};
 p.controller.dispose();
 assert.deepEqual(actual,{phase:'playing',paused:false,muted:false});
});

test('stale play fulfillment after explicit same-cue pause/restart defers to the newer playback owner',async()=>{
 const p=previewSetup();await p.ready();const held=gate();
 p.video.playOverride=()=>{p.video.paused=false;p.video.emit('play');return held.promise};
 const old=p.controller.play();p.controller.pause();await old;
 p.video.playOverride=null;await p.controller.play();const pauses=p.video.pauses;
 held.resolve();await tick();assert.equal(p.video.pauses,pauses);assert.equal(p.video.paused,false);assert.equal(p.video.muted,false);assert.equal(p.controller.getState().phase,'playing');p.controller.dispose();
});
test('old fulfillment still silences a newer selection after its recording permission is revoked',async()=>{
 const p=previewSetup();await p.ready();const held=gate();p.video.playOverride=()=>held.promise;
 const old=p.controller.play();p.controller.select(secondReference);await p.controller.load();await old;
 p.video.playOverride=null;await p.controller.play();p.setRecordingGuard(true);held.resolve();await tick();
 assert.equal(p.video.paused,true);assert.equal(p.video.muted,true);p.controller.dispose();
});


test('request diagnostics distinguish HTTP, network, body and empty data without exposing raw errors', async () => {
  const cases = [
    ['HTTP_503', async () => ({ ok: false, status: 503, blob: async () => source })],
    ['NETWORK', async () => { throw Error('PRIVATE_NETWORK_DETAIL'); }],
    ['BODY', async () => ({ ok: true, blob: async () => { throw Error('PRIVATE_BODY_DETAIL'); } })],
    ['EMPTY_BODY', async () => ({ ok: true, blob: async () => new Blob([]) })],
  ];
  for (const [code, fetch] of cases) {
    const { pool, calls } = poolSetup({ fetch });
    await assert.rejects(pool.acquire(), error => {
      assert.ok(error.message.includes(`[fetch; ${code}]`)); assert.equal(error.message.includes('PRIVATE_'), false); return true;
    });
    assert.deepEqual(calls.created, []);
  }
});

test('metadata failure includes bounded native media state, retains no source and remains explicitly retryable', async () => {
  const video = new FakeVideo(); video.metadataAuto = false; video.error = { code: 4 }; video.networkState = 3;
  const f = previewSetup({ video }); f.controller.select(reference);
  const loading = f.controller.load(); await tick(); video.emit('error'); await loading;
  assert.match(f.controller.getState().error, /metadata; MEDIA_4; ready=0; network=3/);
  assert.equal(f.controller.getState().phase, 'error'); assert.equal(video.src, ''); assert.deepEqual(f.calls.revoked, ['blob:original-1']);
  video.error = null; video.metadataAuto = true; await f.controller.load();
  assert.equal(f.controller.getState().phase, 'ready'); assert.equal(video.plays, 0); f.controller.dispose();
});

test('metadata timeout distinguishes its stage from download and exposes no URL', async () => {
  const video = new FakeVideo(); video.metadataAuto = false;
  const f = previewSetup({ video, dependencies: { metadataTimeoutMs: 2 } });
  await f.ready(); const error = f.controller.getState().error;
  assert.match(error, /元数据加载超时.*metadata; MEDIA_0/); assert.equal(error.includes('blob:'), false);
  assert.equal(video.src, ''); assert.deepEqual(f.calls.revoked, ['blob:original-1']); f.controller.dispose();
});
