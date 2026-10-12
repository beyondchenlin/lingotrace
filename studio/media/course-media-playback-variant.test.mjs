import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import * as mediaModule from './context-bookmark-media.ts';

const { ORIGINAL_COURSE_MEDIA, createOriginalCourseMediaPool, createContextBookmarkPreviewController } = mediaModule;
const sourceIdentity = Object.freeze({ url: '/studio-assets/variant-test/source.mp4',
  mediaId: 'variant-source-v1', mediaSha256: 'a'.repeat(64) });
const playbackVariant = Object.freeze({ url: '/studio-assets/variant-test/lossless.mp4',
  mediaId: 'variant-lossless-playback-v1', mediaSha256: 'b'.repeat(64) });
const media = Object.freeze({ ...sourceIdentity, playbackVariant });
const reference = Object.freeze({ materialId: 'variant-source', materialVersion: 'variant-source-v1',
  cueId: 'variant-source-cue-1', text: 'Original source identity remains authoritative.',
  startSeconds: 0, endSeconds: 6, mediaId: media.mediaId, mediaSha256: media.mediaSha256 });
const bytes = new Blob(['explicit playback bytes'], { type: 'video/mp4' });
const hashBytes = hash => Uint8Array.from(hash.match(/../g), byte => parseInt(byte, 16)).buffer;
const tick = () => new Promise(resolve => setImmediate(resolve));
const gate = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

function poolSetup(descriptor = media, extra = {}) {
  const calls = { fetches: [], digests: 0, created: [], revoked: [] };
  const pool = createOriginalCourseMediaPool({
    fetch: async (url, { signal }) => { calls.fetches.push({ url, signal }); return { ok: true, blob: async () => bytes }; },
    digest: async () => { calls.digests++; return hashBytes(playbackVariant.mediaSha256); },
    createObjectURL: blob => { calls.created.push(blob); return `blob:variant-${calls.created.length}`; },
    revokeObjectURL: url => calls.revoked.push(url), ...extra,
  }, descriptor);
  return { pool, calls };
}
class FakeVideo extends EventTarget {
  _src = ''; currentSrc = ''; currentTime = 0; duration = NaN; paused = true; plays = 0;
  readyState = 0; volume = 1; muted = true; playbackRate = 1;
  get src() { return this._src; }
  set src(value) { this._src = value; this.currentSrc = value; this.readyState = 0; this.duration = NaN; }
  emit(name) { this.dispatchEvent(new Event(name)); }
  load() { if (this._src) queueMicrotask(() => { if (this._src) { this.duration = 12; this.readyState = 1; this.emit('loadedmetadata'); } }); }
  play() { this.plays++; this.paused = false; this.emit('play'); this.emit('playing'); return Promise.resolve(); }
  pause() { if (!this.paused) { this.paused = true; this.emit('pause'); } }
  removeAttribute(name) { if (name === 'src') { this._src = ''; this.currentSrc = ''; this.readyState = 0; this.duration = NaN; } }
}
function previewSetup(pool, descriptor = media) {
  const video = new FakeVideo();
  const controller = createContextBookmarkPreviewController({ video, pool, media: descriptor,
    validateReference: ref => Object.keys(reference).every(key => ref[key] === reference[key]) ? null : 'Wrong source reference.',
  });
  const ready = async (ref = reference) => { controller.select(ref); await controller.load(); };
  return { video, controller, ready };
}
function forgedPool(patch = {}) {
  let released = 0;
  const lease = { url: 'blob:forged-variant', mediaId: media.mediaId, mediaSha256: media.mediaSha256,
    actualSha256: playbackVariant.mediaSha256, playbackVariant: { ...playbackVariant },
    verified: true, verificationError: null, release: () => { released++; }, ...patch };
  return { lease, pool: { acquire: async () => lease }, releases: () => released };
}

test('explicit variant shares one fetch/digest/Blob URL while retaining original source identity and actual byte hash', async () => {
  const { pool, calls } = poolSetup();
  const [main, preview] = await Promise.all([pool.acquire(), pool.acquire()]);
  try {
    assert.deepEqual(calls.fetches.map(call => call.url), [playbackVariant.url]);
    assert.equal(calls.digests, 1); assert.deepEqual(calls.created, [bytes]);
    assert.equal(main.url, preview.url); assert.notEqual(main, preview);
    assert.equal(main.mediaId, sourceIdentity.mediaId); assert.equal(main.mediaSha256, sourceIdentity.mediaSha256);
    assert.equal(main.actualSha256, playbackVariant.mediaSha256); assert.notEqual(main.actualSha256, main.mediaSha256);
    assert.equal(main.verified, true); assert.equal(main.verificationError, null);
    assert.deepEqual(main.playbackVariant, playbackVariant); assert.notEqual(main.playbackVariant, playbackVariant);
    assert.equal(Object.isFrozen(main.playbackVariant), true); assert.equal(Object.isFrozen(main), true);
    assert.deepEqual(Object.keys(main).sort(), ['actualSha256', 'mediaId', 'mediaSha256', 'playbackVariant', 'release', 'url', 'verificationError', 'verified']);
    assert.equal(mediaModule.isVerifiedCourseMediaLease(main, media), true);
    main.release(); main.release(); assert.deepEqual(calls.revoked, []);
    const third = await pool.acquire({ retry: true });
    assert.equal(third.url, preview.url); assert.equal(calls.fetches.length, 1); third.release();
  } finally { main.release(); preview.release(); }
  assert.deepEqual(calls.revoked, [main.url]);
});

test('variant pool and controller capture source and nested variant independently of caller mutation', async () => {
  const mutable = { ...sourceIdentity, playbackVariant: { ...playbackVariant, privateNote: 'not retained' } };
  const shared = poolSetup(mutable), p = previewSetup(shared.pool, mutable);
  Object.assign(mutable.playbackVariant, ORIGINAL_COURSE_MEDIA); Object.assign(mutable, ORIGINAL_COURSE_MEDIA);
  mutable.playbackVariant = undefined;
  try {
    await p.ready(); assert.equal(p.controller.getState().phase, 'ready'); await p.controller.play();
    assert.equal(p.controller.getState().phase, 'playing'); assert.equal(p.video.plays, 1);
    assert.deepEqual(shared.calls.fetches.map(call => call.url), [playbackVariant.url]);
    const lease = await shared.pool.acquire();
    try { assert.deepEqual(lease.playbackVariant, playbackVariant); assert.equal(lease.mediaSha256, sourceIdentity.mediaSha256); }
    finally { lease.release(); }
  } finally { p.controller.dispose(); }
});

for (const variant of [null, [], {}, { ...playbackVariant, url: 'https://example.test/playback.mp4' },
  { ...playbackVariant, url: '//example.test/playback.mp4' }, { ...playbackVariant, url: '/studio-assets/../playback.mp4' },
  { ...playbackVariant, url: '/studio-assets/%2e%2e/playback.mp4' }, { ...playbackVariant, url: '/studio-assets/a.mp4?other=1' },
  { ...playbackVariant, mediaId: '' }, { ...playbackVariant, mediaSha256: 'b'.repeat(63) }]) {
  test(`invalid explicit variant is rejected before fetching: ${JSON.stringify(variant)}`, () => {
    const descriptor = { ...sourceIdentity, playbackVariant: variant }; let fetches = 0;
    assert.throws(() => createOriginalCourseMediaPool({ fetch: () => { fetches++; } }, descriptor), TypeError);
    assert.throws(() => previewSetup({ acquire: () => { fetches++; } }, descriptor), TypeError);
    assert.equal(fetches, 0);
  });
}

const badLeases = [
  ['wrong source ID', { mediaId: 'different-source' }],
  ['wrong source hash', { mediaSha256: playbackVariant.mediaSha256 }],
  ['source hash claimed as actual playback hash', { actualSha256: sourceIdentity.mediaSha256 }],
  ['missing actual hash', { actualSha256: null }],
  ['unverified bytes', { verified: false }],
  ['missing explicit variant', { playbackVariant: undefined }],
  ['null explicit variant', { playbackVariant: null }],
  ['different variant URL', { playbackVariant: { ...playbackVariant, url: '/studio-assets/variant-test/other.mp4' } }],
  ['different variant ID', { playbackVariant: { ...playbackVariant, mediaId: 'different-playback' } }],
  ['different variant hash', { playbackVariant: { ...playbackVariant, mediaSha256: sourceIdentity.mediaSha256 } }],
];
for (const [name, patch] of badLeases) {
  test(`variant authority rejects ${name} before source assignment and when rechecking playback`, async () => {
    for (const duringPlayback of [false, true]) {
      const shared = forgedPool(duringPlayback ? {} : patch), p = previewSetup(shared.pool);
      try {
        await p.ready(); await p.controller.play();
        if (duringPlayback) {
          assert.equal(p.controller.getState().phase, 'playing'); Object.assign(shared.lease, patch); p.video.emit('timeupdate');
        } else { assert.equal(p.video.plays, 0); }
        assert.equal(mediaModule.isVerifiedCourseMediaLease(shared.lease, media), false);
        assert.equal(p.controller.getState().phase, 'error'); assert.equal(p.video.src, '');
        assert.equal(p.video.paused, true); assert.equal(shared.releases(), 1);
      } finally { p.controller.dispose(); }
    }
  });
}

test('mutating a lease nested variant during playback fails closed', async () => {
  const shared = forgedPool(), p = previewSetup(shared.pool);
  try {
    await p.ready(); await p.controller.play(); assert.equal(p.controller.getState().phase, 'playing');
    shared.lease.playbackVariant.url = '/studio-assets/variant-test/replaced.mp4'; p.video.emit('timeupdate');
    assert.equal(p.controller.getState().phase, 'error'); assert.equal(p.video.src, ''); assert.equal(shared.releases(), 1);
  } finally { p.controller.dispose(); }
});

test('variant authority accepts only original reference identity and never a playback-variant reference', async () => {
  const shared = poolSetup(), p = previewSetup(shared.pool);
  try {
    await p.ready({ ...reference, mediaId: playbackVariant.mediaId, mediaSha256: playbackVariant.mediaSha256 });
    await p.controller.play(); assert.equal(p.controller.getState().phase, 'error');
    assert.equal(shared.calls.fetches.length, 0); assert.equal(p.video.plays, 0);
  } finally { p.controller.dispose(); }
});

test('unconfigured source authority rejects a variant lease even when both actual hashes happen to match', async () => {
  const shared = forgedPool({ actualSha256: sourceIdentity.mediaSha256,
    playbackVariant: { ...playbackVariant, mediaSha256: sourceIdentity.mediaSha256 } });
  assert.equal(mediaModule.isVerifiedCourseMediaLease(shared.lease, sourceIdentity), false);
  const p = previewSetup(shared.pool, sourceIdentity);
  try { await p.ready(); assert.equal(p.controller.getState().phase, 'error'); assert.equal(p.video.src, ''); }
  finally { p.controller.dispose(); }
});

test('lease helper preserves ordinary source verification and fails closed for absent leases or invalid descriptors', async () => {
  const shared = poolSetup(sourceIdentity, { digest: async () => hashBytes(sourceIdentity.mediaSha256) });
  const lease = await shared.pool.acquire();
  try {
    assert.equal(lease.playbackVariant, undefined); assert.equal(mediaModule.isVerifiedCourseMediaLease(lease, sourceIdentity), true);
    assert.equal(mediaModule.isVerifiedCourseMediaLease(lease, media), false);
    for (const candidate of [null, undefined]) assert.equal(mediaModule.isVerifiedCourseMediaLease(candidate, sourceIdentity), false);
    for (const descriptor of [null, {}, { ...media, playbackVariant: null }]) {
      assert.equal(mediaModule.isVerifiedCourseMediaLease(lease, descriptor), false);
    }
  } finally { lease.release(); }
});

for (const failure of ['missing', 'mismatch', 'digest']) {
  test(`variant ${failure} fails closed without fetching original URL or falling back to source hash`, async () => {
    const extra = failure === 'missing' ? { fetch: async (url, { signal }) => {
      shared.calls.fetches.push({ url, signal }); return { ok: false, status: 404, blob: async () => bytes };
    } } : { digest: async () => {
      if (failure === 'digest') throw new Error('Unavailable'); return hashBytes(sourceIdentity.mediaSha256);
    } };
    const shared = poolSetup(media, extra), p = previewSetup(shared.pool);
    try {
      await p.ready(); await p.controller.play(); assert.equal(p.controller.getState().phase, 'error');
      assert.equal(p.video.src, ''); assert.equal(p.video.plays, 0);
      assert.deepEqual(shared.calls.fetches.map(call => call.url), [playbackVariant.url]);
      assert.equal(shared.calls.created.length, shared.calls.revoked.length);
    } finally { p.controller.dispose(); }
  });
}

test('variant retry replaces only failed generation and preserves retained lease until release', async () => {
  let digests = 0;
  const shared = poolSetup(media, { digest: async () => hashBytes(++digests === 1 ? sourceIdentity.mediaSha256 : playbackVariant.mediaSha256) });
  const invalid = await shared.pool.acquire(), valid = await shared.pool.acquire({ retry: true });
  try {
    assert.equal(invalid.verified, false); assert.equal(invalid.actualSha256, sourceIdentity.mediaSha256);
    assert.equal(valid.verified, true); assert.equal(valid.actualSha256, playbackVariant.mediaSha256);
    assert.notEqual(valid.url, invalid.url); assert.deepEqual(shared.calls.revoked, []);
    assert.deepEqual(shared.calls.fetches.map(call => call.url), [playbackVariant.url, playbackVariant.url]);
    invalid.release(); assert.deepEqual(shared.calls.revoked, [invalid.url]);
  } finally { invalid.release(); valid.release(); }
  assert.deepEqual(shared.calls.revoked, [invalid.url, valid.url]);
});

test('canceling one variant borrower retains shared download and the other verified borrower', async () => {
  const held = gate(); let requestSignal;
  const shared = poolSetup(media, { fetch: (url, { signal }) => {
    shared.calls.fetches.push({ url, signal }); requestSignal = signal; return held.promise;
  } });
  const abort = new AbortController(), cancelled = shared.pool.acquire({ signal: abort.signal }), kept = shared.pool.acquire();
  await tick(); abort.abort(); await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(requestSignal.aborted, false); held.resolve({ ok: true, blob: async () => bytes });
  const lease = await kept;
  try { assert.equal(lease.verified, true); assert.equal(shared.calls.fetches.length, 1); assert.deepEqual(shared.calls.revoked, []); }
  finally { lease.release(); }
});

for (const stage of ['fetch', 'blob', 'digest']) {
  test(`canceling final variant borrower during ${stage} settles promptly and cannot retain a late URL`, async () => {
    const held = gate(); let requestSignal;
    const extra = stage === 'fetch' ? { fetch: (_, { signal }) => { requestSignal = signal; return held.promise; } } :
      stage === 'blob' ? { fetch: async (_, { signal }) => { requestSignal = signal; return { ok: true, blob: () => held.promise }; } } :
        { digest: () => held.promise };
    const shared = poolSetup(media, extra), abort = new AbortController();
    const pending = shared.pool.acquire({ signal: abort.signal }); await tick(); abort.abort();
    await assert.rejects(pending, { name: 'AbortError' }); if (requestSignal) assert.equal(requestSignal.aborted, true);
    held.resolve(stage === 'fetch' ? { ok: true, blob: async () => bytes } : stage === 'blob' ? bytes : hashBytes(playbackVariant.mediaSha256));
    await tick(); assert.deepEqual(shared.calls.created, []); assert.deepEqual(shared.calls.revoked, []);
  });
}

test('real SHA-256 verifies fetched variant bytes independently of source bytes and rejects one-byte changes', async () => {
  const original = Buffer.from('original container bytes'), variant = Buffer.from('losslessly remuxed container bytes');
  const changed = Buffer.from(variant); changed[0] ^= 1;
  const descriptor = { ...sourceIdentity, mediaSha256: createHash('sha256').update(original).digest('hex'),
    playbackVariant: { ...playbackVariant, mediaSha256: createHash('sha256').update(variant).digest('hex') } };
  for (const [body, expected] of [[variant, true], [original, false], [changed, false]]) {
    const shared = poolSetup(descriptor, { fetch: async url => {
      assert.equal(url, descriptor.playbackVariant.url); return { ok: true, blob: async () => new Blob([body]) };
    }, digest: buffer => webcrypto.subtle.digest('SHA-256', buffer) });
    const lease = await shared.pool.acquire();
    try {
      assert.equal(lease.actualSha256, createHash('sha256').update(body).digest('hex'));
      assert.equal(lease.mediaSha256, descriptor.mediaSha256); assert.equal(lease.verified, expected);
      assert.equal(mediaModule.isVerifiedCourseMediaLease(lease, descriptor), expected);
    } finally { lease.release(); }
  }
});
