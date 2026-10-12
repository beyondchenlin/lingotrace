import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { NPS_COURSE_MEDIA } from '../core/builtin-material.ts';
import { ORIGINAL_COURSE_MEDIA, createOriginalCourseMediaPool, createContextBookmarkPreviewController } from './context-bookmark-media.ts';

// Real registered identity; tiny byte/digest stubs isolate ownership and race tests.
const NPS = NPS_COURSE_MEDIA;
const NPS_DURATION = 43.366667;
const tick = () => new Promise(resolve => setImmediate(resolve));
const gate = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const hashBytes = value => Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16)).buffer;
const reference = Object.freeze({ materialId: 'nps-connie-lau-education-ranger-7fe78a9f',
  materialVersion: 'nps-test-reference-v1', cueId: 'nps-test-cue-1', text: 'Descriptor ownership test.',
  startSeconds: 0, endSeconds: 6, mediaId: NPS.mediaId, mediaSha256: NPS.mediaSha256 });
const secondReference = Object.freeze({ ...reference, cueId: 'nps-test-cue-2', startSeconds: 6, endSeconds: 12 });
const cafeReference = Object.freeze({ ...reference, materialId: 'cafe-original', materialVersion: 'cafe-studio-v1',
  cueId: 'cafe-studio-1', mediaId: ORIGINAL_COURSE_MEDIA.mediaId, mediaSha256: ORIGINAL_COURSE_MEDIA.mediaSha256 });

function poolSetup(media = NPS, extra = {}, defaultDescriptor = false) {
  const source = new Blob([`isolated bytes: ${media.mediaId}`], { type: 'video/mp4' });
  const calls = { fetches: [], digests: [], created: [], revoked: [] };
  const dependencies = {
    fetch: async (url, { signal }) => { calls.fetches.push({ url, signal }); return { ok: true, blob: async () => source }; },
    digest: async bytes => { calls.digests.push(bytes.byteLength); return hashBytes(media.mediaSha256); },
    createObjectURL: blob => { calls.created.push(blob); return `blob:${media.mediaId}-${calls.created.length}`; },
    revokeObjectURL: url => calls.revoked.push(url), ...extra,
  };
  const pool = defaultDescriptor ? createOriginalCourseMediaPool(dependencies) : createOriginalCourseMediaPool(dependencies, media);
  return { pool, calls, source };
}
class TrackedTarget extends EventTarget {
  handlers = new Map();
  addEventListener(name, listener, options) {
    const set = this.handlers.get(name) ?? new Set(); set.add(listener); this.handlers.set(name, set);
    super.addEventListener(name, listener, options);
  }
  removeEventListener(name, listener, options) {
    this.handlers.get(name)?.delete(listener); if (!this.handlers.get(name)?.size) this.handlers.delete(name);
    super.removeEventListener(name, listener, options);
  }
  emit(name) { this.dispatchEvent(new Event(name)); }
  get listenerCount() { return [...this.handlers.values()].reduce((sum, set) => sum + set.size, 0); }
}
class FakeVideo extends TrackedTarget {
  _src = ''; currentSrc = ''; duration = NaN; readyState = 0; paused = true; currentTime = 0;
  volume = 1; muted = false; playbackRate = 1; loop = true; autoplay = true;
  plays = 0; pauses = 0; metadataDuration = NPS_DURATION; metadataAuto = true; playOverride = null;
  get src() { return this._src; }
  set src(value) { this._src = value; this.currentSrc = value; this.readyState = 0; this.duration = NaN; }
  load() { if (this._src && this.metadataAuto) queueMicrotask(() => { if (this._src) this.metadata(); }); }
  metadata() { this.duration = this.metadataDuration; this.readyState = 1; this.emit('loadedmetadata'); }
  play() {
    this.plays++; if (this.playOverride) return this.playOverride();
    this.paused = false; this.emit('play'); this.emit('playing'); return Promise.resolve();
  }
  pause() { this.pauses++; if (!this.paused) { this.paused = true; this.emit('pause'); } }
  removeAttribute(name) { if (name === 'src') { this._src = ''; this.currentSrc = ''; this.readyState = 0; this.duration = NaN; } }
}
function previewSetup(extra = {}) {
  const shared = extra.shared ?? poolSetup();
  const video = extra.video ?? new FakeVideo();
  const documentTarget = new TrackedTarget(), windowTarget = new TrackedTarget();
  let hidden = false, recording = false;
  const controller = createContextBookmarkPreviewController({
    video, pool: shared.pool, media: NPS,
    validateReference: value => [reference, secondReference].some(expected =>
      Object.keys(expected).every(key => expected[key] === value[key])) ? null : 'Reference does not match the current registered cue.',
    lifecycle: { documentTarget, windowTarget, isHidden: () => hidden }, isRecordingBlocked: () => recording,
    ...extra.dependencies,
  });
  const ready = async (ref = reference) => { controller.select(ref); await controller.load(); };
  return { ...shared, video, controller, ready, documentTarget, windowTarget,
    setHidden: value => { hidden = value; documentTarget.emit('visibilitychange'); },
    setRecordingGuard: value => { recording = value; },
  };
}
function forgedPool(patch = {}) {
  const counts = { acquired: 0, released: 0 };
  const lease = { url: 'blob:forged-test', mediaId: NPS.mediaId, mediaSha256: NPS.mediaSha256,
    actualSha256: NPS.mediaSha256, verified: true, verificationError: null,
    release: () => { counts.released++; }, ...patch };
  return { pool: { acquire: async () => { counts.acquired++; return lease; } }, counts, lease };
}

test('default cafe identity remains frozen and byte-for-byte unchanged', () => {
  assert.deepEqual(ORIGINAL_COURSE_MEDIA, { url: '/studio-assets/06-cafe.mp4', mediaId: 'cafe-original-video-v1',
    mediaSha256: '22fc25ade368f351cda21951916e559ff359cf1ac8419fbfa5444e050cdbf740' });
  assert.equal(Object.isFrozen(ORIGINAL_COURSE_MEDIA), true);
});

test('default cafe and explicit NPS pools retain independent fetch, digest, Blob URL and references', async () => {
  const cafe = poolSetup(ORIGINAL_COURSE_MEDIA, {}, true), nps = poolSetup();
  const [cafeMain, npsMain, npsPreview] = await Promise.all([cafe.pool.acquire(), nps.pool.acquire(), nps.pool.acquire()]);
  try {
    assert.equal(cafeMain.verified, true); assert.equal(npsMain.verified, true);
    assert.equal(cafeMain.mediaId, ORIGINAL_COURSE_MEDIA.mediaId); assert.equal(npsMain.mediaId, NPS.mediaId);
    assert.equal(cafeMain.actualSha256, ORIGINAL_COURSE_MEDIA.mediaSha256); assert.equal(npsMain.actualSha256, NPS.mediaSha256);
    assert.equal(npsMain.mediaSha256, NPS.mediaSha256); assert.equal(npsMain.url, npsPreview.url);
    assert.notEqual(cafeMain.url, npsMain.url);
    assert.deepEqual(cafe.calls.fetches.map(call => call.url), [ORIGINAL_COURSE_MEDIA.url]);
    assert.deepEqual(nps.calls.fetches.map(call => call.url), [NPS.url]);
    assert.equal(cafe.calls.digests.length, 1); assert.equal(nps.calls.digests.length, 1);
    assert.deepEqual(nps.calls.created, [nps.source]);
    npsPreview.release(); npsPreview.release(); assert.deepEqual(nps.calls.revoked, []);
    cafeMain.release(); assert.deepEqual(cafe.calls.revoked, [cafeMain.url]); assert.deepEqual(nps.calls.revoked, []);
    assert.equal(nps.calls.fetches[0].signal.aborted, false);
    assert.equal(Object.isFrozen(npsMain), true);
    assert.deepEqual(Object.keys(npsMain).sort(), ['actualSha256', 'mediaId', 'mediaSha256', 'release', 'url', 'verificationError', 'verified']);
  } finally { cafeMain.release(); npsMain.release(); npsPreview.release(); }
  assert.deepEqual(nps.calls.revoked, [npsMain.url]);
});

test('pool captures descriptor before fetch and ignores later caller mutation', async () => {
  const mutable = { ...NPS }; const urls = [];
  const shared = poolSetup(mutable, {
    fetch: async url => { urls.push(url); return { ok: true, blob: async () => new Blob(['NPS stub']) }; },
    digest: async () => hashBytes(NPS.mediaSha256),
  });
  Object.assign(mutable, ORIGINAL_COURSE_MEDIA);
  const lease = await shared.pool.acquire();
  try { assert.deepEqual(urls, [NPS.url]); assert.equal(lease.mediaId, NPS.mediaId); assert.equal(lease.mediaSha256, NPS.mediaSha256); assert.equal(lease.verified, true); }
  finally { lease.release(); }
});

const invalidDescriptors = [null, [], {}, { ...NPS, url: 'https://example.test/video.mp4' },
  { ...NPS, url: '//example.test/video.mp4' }, { ...NPS, url: '/studio-assets/../06-cafe.mp4' },
  { ...NPS, url: '/studio-assets/./06-cafe.mp4' }, { ...NPS, url: '/studio-assets//06-cafe.mp4' },
  { ...NPS, url: '/studio-assets/%2e%2e/06-cafe.mp4' }, { ...NPS, url: '/studio-assets/a.mp4?other=1' },
  { ...NPS, url: '/studio-assets/a.mp4#other' }, { ...NPS, url: '/studio-assets/a\\b.mp4' },
  { ...NPS, mediaId: '' }, { ...NPS, mediaId: 'nps wrong' }, { ...NPS, mediaId: 1 },
  { ...NPS, mediaSha256: NPS.mediaSha256.toUpperCase() }, { ...NPS, mediaSha256: 'g'.repeat(64) },
  { ...NPS, mediaSha256: '0'.repeat(63) }, { ...NPS, mediaSha256: null }];
for (const [index, descriptor] of invalidDescriptors.entries()) {
  test(`invalid descriptor ${index} is rejected before source operations`, () => {
    let calls = 0;
    assert.throws(() => createOriginalCourseMediaPool({ fetch: () => { calls++; } }, descriptor), TypeError);
    const video = new FakeVideo();
    assert.throws(() => createContextBookmarkPreviewController({ video, pool: { acquire: () => { calls++; } },
      media: descriptor, validateReference: () => null }), TypeError);
    assert.equal(calls, 0); assert.equal(video.listenerCount, 0); assert.equal(video.pauses, 0);
  });
}

test('NPS controller captures a frozen identity independently of caller mutation', async () => {
  const media = { ...NPS }; const p = previewSetup({ dependencies: { media } });
  Object.assign(media, ORIGINAL_COURSE_MEDIA);
  try {
    await p.ready(); await p.controller.play(); assert.equal(p.controller.getState().phase, 'playing');
    assert.equal(p.video.duration, NPS_DURATION); assert.equal(p.video.currentSrc, `blob:${NPS.mediaId}-1`);
    assert.equal(Object.isFrozen(p.controller.getState().reference), true);
  } finally { p.controller.dispose(); }
});

for (const [name, dependencies, ref] of [
  ['default cafe rejects NPS reference', { media: undefined }, reference],
  ['explicit NPS rejects cafe reference', {}, cafeReference],
  ['explicit NPS rejects mixed reference hash', {}, { ...reference, mediaSha256: ORIGINAL_COURSE_MEDIA.mediaSha256 }],
  ['explicit NPS rejects mixed reference ID', {}, { ...reference, mediaId: ORIGINAL_COURSE_MEDIA.mediaId }],
]) {
  test(name, async () => {
    const p = previewSetup({ dependencies: { ...dependencies, validateReference: () => null } });
    try { await p.ready(ref); await p.controller.play(); assert.equal(p.controller.getState().phase, 'error'); assert.equal(p.calls.fetches.length, 0); assert.equal(p.video.plays, 0); }
    finally { p.controller.dispose(); }
  });
}

for (const [name, patch] of [
  ['wrong actual hash', { actualSha256: ORIGINAL_COURSE_MEDIA.mediaSha256 }],
  ['missing actual hash', { actualSha256: null }],
  ['wrong declared hash', { mediaSha256: ORIGINAL_COURSE_MEDIA.mediaSha256 }],
  ['wrong media ID', { mediaId: ORIGINAL_COURSE_MEDIA.mediaId }],
  ['unverified', { verified: false }],
]) {
  test(`NPS refuses lease with ${name} before assigning video.src`, async () => {
    const shared = forgedPool(patch), p = previewSetup({ shared });
    try { await p.ready(); await p.controller.play(); assert.equal(p.controller.getState().phase, 'error'); assert.equal(p.video.src, ''); assert.equal(p.video.plays, 0); assert.equal(shared.counts.released, 1); }
    finally { p.controller.dispose(); }
  });
  test(`NPS rechecks ${name} during native playback instead of trusting initial authorization`, async () => {
    const shared = forgedPool(), p = previewSetup({ shared });
    try {
      await p.ready(); await p.controller.play(); Object.assign(shared.lease, patch); p.video.emit('timeupdate');
      assert.equal(p.controller.getState().phase, 'error'); assert.equal(p.video.paused, true); assert.equal(p.video.muted, true);
      assert.equal(p.video.src, ''); assert.equal(shared.counts.released, 1);
    } finally { p.controller.dispose(); }
  });
}

test('NPS descriptor with actual cafe bytes stays unverified and cannot borrow default cafe authority', async () => {
  const shared = poolSetup(NPS, { digest: async () => hashBytes(ORIGINAL_COURSE_MEDIA.mediaSha256) });
  const lesson = await shared.pool.acquire(); const p = previewSetup({ shared });
  try {
    assert.equal(lesson.mediaId, NPS.mediaId); assert.equal(lesson.actualSha256, ORIGINAL_COURSE_MEDIA.mediaSha256);
    assert.equal(lesson.verified, false); await p.ready(); await p.controller.play();
    assert.equal(p.controller.getState().phase, 'error'); assert.equal(p.video.src, ''); assert.equal(p.video.plays, 0);
    assert.equal(shared.calls.fetches.length, 1); assert.deepEqual(shared.calls.revoked, []);
  } finally { p.controller.dispose(); lesson.release(); }
});

for (const change of ['src', 'currentSrc']) {
  test(`NPS stops when actual ${change} changes to cafe source`, async () => {
    const p = previewSetup();
    try {
      await p.ready(); await p.controller.play(); p.video[change] = `blob:${ORIGINAL_COURSE_MEDIA.mediaId}-1`; p.video.emit('timeupdate');
      assert.equal(p.controller.getState().phase, 'error'); assert.equal(p.video.paused, true); assert.equal(p.video.src, '');
      assert.equal(p.calls.revoked.length, 1);
    } finally { p.controller.dispose(); }
  });
}

for (const stage of ['fetch', 'blob', 'digest']) {
  test(`NPS cancellation during ${stage} leaves other cafe pool alive and late work cannot allocate`, async () => {
    const held = gate();
    const extra = stage === 'fetch' ? { fetch: () => held.promise } : stage === 'blob' ?
      { fetch: async () => ({ ok: true, blob: () => held.promise }) } : { digest: () => held.promise };
    const nps = poolSetup(NPS, extra), cafe = poolSetup(ORIGINAL_COURSE_MEDIA, {}, true);
    const cafeLease = await cafe.pool.acquire(), abort = new AbortController();
    const pending = nps.pool.acquire({ signal: abort.signal }); await tick(); abort.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    held.resolve(stage === 'fetch' ? { ok: true, blob: async () => nps.source } : stage === 'blob' ? nps.source : hashBytes(NPS.mediaSha256));
    await tick();
    try {
      assert.deepEqual(nps.calls.created, []); assert.deepEqual(nps.calls.revoked, []);
      assert.deepEqual(cafe.calls.revoked, []); assert.equal(cafe.calls.fetches[0].signal.aborted, false);
      const secondCafe = await cafe.pool.acquire(); assert.equal(secondCafe.url, cafeLease.url); secondCafe.release();
    } finally { cafeLease.release(); }
  });
}

test('cancelling one NPS borrower keeps both another NPS borrower and cafe generation alive', async () => {
  const held = gate(), signals = [];
  const nps = poolSetup(NPS, { fetch: (_, { signal }) => { signals.push(signal); return held.promise; } });
  const cafe = poolSetup(ORIGINAL_COURSE_MEDIA, {}, true), cafeLease = await cafe.pool.acquire();
  const abort = new AbortController(), cancelled = nps.pool.acquire({ signal: abort.signal }), retained = nps.pool.acquire();
  await tick(); abort.abort(); await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(signals[0].aborted, false); assert.equal(cafe.calls.fetches[0].signal.aborted, false);
  held.resolve({ ok: true, blob: async () => nps.source }); const npsLease = await retained;
  try { assert.equal(npsLease.verified, true); assert.deepEqual(cafe.calls.revoked, []); assert.deepEqual(nps.calls.revoked, []); }
  finally { npsLease.release(); cafeLease.release(); }
});

test('late acquisition from a pool that ignores cancellation is released without disturbing the newer NPS selection', async () => {
  const held = gate(), shared = forgedPool(); let acquired = 0;
  const old = { ...shared.lease, url: 'blob:old-nps', release: () => { acquired++; } };
  let calls = 0; const nativeAcquire = shared.pool.acquire;
  shared.pool.acquire = () => ++calls === 1 ? held.promise : nativeAcquire();
  const p = previewSetup({ shared });
  try {
    p.controller.select(reference); const loading = p.controller.load(); await tick();
    await p.ready(secondReference); await p.controller.play(); const after = p.controller.getState();
    held.resolve(old); await loading; await tick();
    assert.equal(acquired, 1); assert.equal(p.controller.getState(), after); assert.equal(p.video.src, shared.lease.url);
    assert.equal(p.video.paused, false); assert.equal(shared.counts.released, 0);
  } finally { p.controller.dispose(); }
});

for (const duration of [NaN, Infinity, 0, 5.99]) {
  test(`NPS refuses actual duration ${duration} instead of substituting cafe duration`, async () => {
    const video = new FakeVideo(); video.metadataDuration = duration; const p = previewSetup({ video, dependencies: { metadataTimeoutMs: 10 } });
    try {
      await p.ready(); await p.controller.play(); assert.equal(p.controller.getState().phase, 'error'); assert.equal(p.video.plays, 0); assert.equal(p.video.src, '');
      assert.match(p.controller.getState().error, Number.isFinite(duration) && duration > 0 ? /片段时间范围超过/ : /元数据加载超时/);
      assert.ok(p.controller.getState().error.endsWith(`[range-v71; actual=${duration}; cueStart=${reference.startSeconds}; cueEnd=${reference.endSeconds}; ready=1; transport=blob]`));
    }
    finally { p.controller.dispose(); }
  });
}

test('NPS exact finite final boundary works without adopting a 72-second cafe fallback', async () => {
  const final = { ...reference, startSeconds: 40, endSeconds: 43.366 };
  const p = previewSetup({ dependencies: { validateReference: () => null } });
  try {
    await p.ready(final); assert.equal(p.controller.getState().duration, NPS_DURATION); await p.controller.play();
    p.video.currentTime = 43.5; p.video.emit('timeupdate');
    assert.equal(p.video.currentTime, final.endSeconds); assert.equal(p.video.paused, true);
  } finally { p.controller.dispose(); }
});

test('NPS monitor controls remain native and independent of the default cafe preview', async () => {
  const nps = previewSetup();
  const cafe = previewSetup({ shared: poolSetup(ORIGINAL_COURSE_MEDIA, {}, true),
    dependencies: { media: undefined, validateReference: () => null } });
  try {
    await nps.ready(); await cafe.ready(cafeReference); await nps.controller.play(); await cafe.controller.play();
    nps.controller.setMonitor({ volume: .2, courseMuted: true, allMuted: false });
    assert.equal(nps.video.muted, true); assert.equal(nps.video.volume, .2); assert.equal(cafe.video.muted, false); assert.equal(cafe.video.volume, .8);
    nps.controller.setMonitor({ volume: .4, courseMuted: false, allMuted: true }); assert.equal(nps.video.muted, true);
    nps.controller.setMonitor({ volume: .4, courseMuted: false, allMuted: false }); assert.equal(nps.video.muted, false);
    nps.controller.setRecordingBlocked(true); assert.equal(nps.video.muted, true); assert.equal(nps.video.paused, true);
    assert.equal(cafe.video.paused, false); assert.equal(cafe.calls.revoked.length, 0);
    const plays = nps.video.plays; nps.controller.setRecordingBlocked(false); assert.equal(nps.video.plays, plays); assert.equal(nps.video.paused, true);
    await nps.controller.play(); assert.equal(nps.video.plays, plays + 1);
  } finally { nps.controller.dispose(); cafe.controller.dispose(); }
});

for (const interruption of ['recording', 'recording-guard', 'hidden', 'pagehide', 'close', 'select', 'dispose']) {
  test(`late NPS native play after ${interruption} cannot resume sound or acquire cafe authority`, async () => {
    const p = previewSetup(), held = gate();
    try {
      await p.ready(); p.video.playOverride = () => held.promise.then(() => { p.video.paused = false; p.video.emit('playing'); });
      const playing = p.controller.play();
      if (interruption === 'recording') p.controller.setRecordingBlocked(true);
      else if (interruption === 'recording-guard') { p.setRecordingGuard(true); p.video.emit('timeupdate'); }
      else if (interruption === 'hidden') p.setHidden(true);
      else if (interruption === 'pagehide') p.windowTarget.emit('pagehide');
      else if (interruption === 'select') p.controller.select(secondReference);
      else p.controller[interruption]();
      await playing; held.resolve(); await tick();
      assert.equal(p.video.paused, true); assert.equal(p.video.muted, true); assert.notEqual(p.controller.getState().phase, 'playing');
      assert.deepEqual(p.calls.fetches.map(call => call.url), [NPS.url]);
    } finally { p.controller.dispose(); }
  });
}

for (const interruption of ['recording', 'hidden', 'pagehide', 'close', 'select', 'dispose']) {
  test(`NPS ${interruption} interrupts metadata safely, and late metadata never restarts playback`, async () => {
    const video = new FakeVideo(); video.metadataAuto = false; const p = previewSetup({ video });
    try {
      p.controller.select(reference); const loading = p.controller.load(); await tick();
      if (interruption === 'recording') p.controller.setRecordingBlocked(true);
      else if (interruption === 'hidden') p.setHidden(true);
      else if (interruption === 'pagehide') p.windowTarget.emit('pagehide');
      else if (interruption === 'select') p.controller.select(secondReference);
      else p.controller[interruption]();
      await loading; const after = p.controller.getState(); video.metadata(); await tick();
      assert.equal(p.controller.getState(), after); assert.equal(video.src, ''); assert.equal(video.plays, 0); assert.equal(p.calls.revoked.length, 1);
    } finally { p.controller.dispose(); }
    assert.equal(video.listenerCount, 0); assert.equal(p.documentTarget.listenerCount, 0); assert.equal(p.windowTarget.listenerCount, 0);
  });
}

test('late NPS play fulfillment does not pause a newer explicit selection', async () => {
  const p = previewSetup(), held = gate();
  try {
    await p.ready(); p.video.playOverride = () => { p.video.paused = false; p.video.emit('play'); return held.promise; };
    const playing = p.controller.play(); await p.ready(secondReference); await playing;
    p.video.playOverride = null; await p.controller.play(); const pauses = p.video.pauses;
    held.resolve(); await tick();
    assert.equal(p.video.pauses, pauses); assert.equal(p.video.paused, false); assert.equal(p.video.muted, false);
    assert.equal(p.controller.getState().reference.cueId, secondReference.cueId);
  } finally { p.controller.dispose(); }
});

test('queued NPS pause event does not mute a newer authorized play', async () => {
  const p = previewSetup(); let pendingPause;
  try {
    await p.ready(); await p.controller.play();
    p.video.pause = () => { p.video.pauses++; if (!p.video.paused) { p.video.paused = true; pendingPause = () => p.video.emit('pause'); } };
    p.controller.pause(); await p.controller.play(); pendingPause(); await tick();
    assert.equal(p.video.paused, false); assert.equal(p.video.muted, false); assert.equal(p.controller.getState().phase, 'playing');
  } finally { p.controller.dispose(); }
});

test('registered catalogue descriptors may carry metadata without leaking it into a media lease', async () => {
  const descriptor = { ...NPS, duration: NPS_DURATION, title: 'NPS source', sourcePage: 'https://www.nps.gov/' };
  const shared = poolSetup(descriptor); const lease = await shared.pool.acquire();
  const p = previewSetup({ shared, dependencies: { media: descriptor } });
  try {
    await p.ready(); await p.controller.play(); assert.equal(p.controller.getState().phase, 'playing');
    assert.equal(lease.duration, undefined); assert.equal(lease.title, undefined); assert.equal(lease.sourcePage, undefined);
    assert.equal(Object.isFrozen(descriptor), false);
  } finally { p.controller.dispose(); lease.release(); }
});

test('NPS retry replaces only its invalid generation while retained cafe and NPS leases remain owned', async () => {
  let digests = 0;
  const nps = poolSetup(NPS, { digest: async () => hashBytes(++digests === 1 ? ORIGINAL_COURSE_MEDIA.mediaSha256 : NPS.mediaSha256) });
  const cafe = poolSetup(ORIGINAL_COURSE_MEDIA, {}, true);
  const invalidNps = await nps.pool.acquire(), cafeLease = await cafe.pool.acquire();
  const verifiedNps = await nps.pool.acquire({ retry: true });
  try {
    assert.equal(invalidNps.verified, false); assert.equal(verifiedNps.verified, true);
    assert.notEqual(invalidNps.url, verifiedNps.url); assert.equal(verifiedNps.mediaId, NPS.mediaId);
    assert.deepEqual(nps.calls.revoked, []); assert.deepEqual(cafe.calls.revoked, []);
    invalidNps.release(); assert.deepEqual(nps.calls.revoked, [invalidNps.url]);
    const current = await nps.pool.acquire(); assert.equal(current.url, verifiedNps.url); current.release();
    assert.equal(digests, 2); assert.equal(cafe.calls.digests.length, 1);
  } finally { invalidNps.release(); verifiedNps.release(); cafeLease.release(); }
});

test('NPS synchronous abort during URL allocation revokes its late URL once and leaves cafe intact', async () => {
  const abort = new AbortController();
  const nps = poolSetup(NPS, { createObjectURL: () => { abort.abort(); return 'blob:late-nps'; } });
  const cafe = poolSetup(ORIGINAL_COURSE_MEDIA, {}, true), cafeLease = await cafe.pool.acquire();
  try {
    await assert.rejects(nps.pool.acquire({ signal: abort.signal }), { name: 'AbortError' }); await tick();
    assert.deepEqual(nps.calls.revoked, ['blob:late-nps']); assert.deepEqual(cafe.calls.revoked, []);
    assert.equal(cafe.calls.fetches[0].signal.aborted, false);
  } finally { cafeLease.release(); }
});


test('registered NPS media descriptor and actual bundled bytes agree with the independent source identity', async () => {
  assert.equal(NPS.url, '/studio-assets/nps-connie/connie-lau-education-ranger-720p.mp4');
  assert.equal(NPS.mediaId, 'nps-connie-lau-education-ranger-video-v1');
  assert.equal(NPS.mediaSha256, 'b2ea5fa763a5687961606061afbef1b7619fcaff3ccd04b3e0b9f14584ffa642');
  assert.equal(NPS.durationSeconds, NPS_DURATION);
  const bytes = await readFile(new URL(`../../public${NPS.url}`, import.meta.url));
  assert.equal(bytes.byteLength, 19584717);
  const shared = poolSetup(NPS, {
    fetch: async url => { assert.equal(url, NPS.url); return { ok: true, blob: async () => new Blob([bytes]) }; },
    digest: buffer => webcrypto.subtle.digest('SHA-256', buffer),
  });
  const lease = await shared.pool.acquire();
  try {
    assert.equal(lease.verified, true); assert.equal(lease.actualSha256, NPS.mediaSha256);
    assert.equal(lease.mediaId, NPS.mediaId); assert.notEqual(lease.actualSha256, ORIGINAL_COURSE_MEDIA.mediaSha256);
  } finally { lease.release(); }
  assert.deepEqual(shared.calls.revoked, [lease.url]);
});
