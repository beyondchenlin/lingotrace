import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createOriginalCourseMediaPool, createContextBookmarkPreviewController, isVerifiedCourseMediaLease, isExactNativeAACError } from './context-bookmark-media.ts';

const origin = 'https://lesson.example';
const bytes = new Blob(['audited unchanged AAC representation'], { type: 'video/mp4' });
const digest = createHash('sha256').update(await bytes.bytes()).digest('hex');
const variant = Object.freeze({ url: `/studio-assets/test/playback-${digest}.mp4`, mediaId: 'test-playback', mediaSha256: digest });
const media = Object.freeze({ url: '/studio-assets/test/original.mp4', mediaId: 'test-original', mediaSha256: 'a'.repeat(64), playbackVariant: variant, allowVerifiedDirect: true });
const resourceUrl = origin + variant.url;
const reference = Object.freeze({ materialId: 'test-original', materialVersion: 'test-v1', cueId: 'cue-1', text: 'Keep the source identity.', startSeconds: 1, endSeconds: 6, mediaId: media.mediaId, mediaSha256: media.mediaSha256 });
const nativeAAC = { code: 4, message: 'PipelineStatus::DEMUXER_ERROR_DETECTED_AAC' };
const tick = () => new Promise(resolve => setImmediate(resolve));
const until = async predicate => { const deadline = Date.now() + 2000; while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1)); assert.equal(!!predicate(), true); };
const gate = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const response = (patch = {}) => ({ ok: true, status: 200, type: 'basic', url: resourceUrl, redirected: false, headers: new Headers({ 'content-type': 'video/mp4' }), blob: async () => bytes, ...patch });
function setup(extra = {}, descriptor = media) {
  const calls = { fetches: [], digests: 0, created: [], revoked: [] };
  const pool = createOriginalCourseMediaPool({ origin,
    fetch: async (url, options) => { calls.fetches.push({ url, options }); return response(); },
    digest: async buffer => { calls.digests++; return webcrypto.subtle.digest('SHA-256', buffer); },
    createObjectURL: blob => { calls.created.push(blob); return `blob:test-${calls.created.length}`; },
    revokeObjectURL: url => calls.revoked.push(url), ...extra,
  }, descriptor);
  return { pool, calls };
}
class Video extends EventTarget {
  _src = ''; currentSrc = ''; currentTime = 0; duration = NaN; paused = true; readyState = 0; networkState = 3; error = null;
  muted = true; volume = 1; playbackRate = 1; plays = 0; loads = []; pending = []; blobError = nativeAAC; directError = null; auto = true;
  get src() { return this._src; }
  set src(value) { this._src = value; this.currentSrc = value; this.duration = NaN; this.readyState = 0; }
  emit(name) { this.dispatchEvent(new Event(name)); }
  load() { this.error = null; if (!this.src) return; const url = this.src; this.loads.push(url); const complete = () => {
    if (this.src !== url) return;
    this.error = url.startsWith('blob:') ? this.blobError : this.directError;
    if (this.error) this.emit('error'); else { this.duration = 12; this.readyState = 1; this.emit('loadedmetadata'); }
  }; if (this.auto) queueMicrotask(complete); else this.pending.push(complete); }
  play() { this.plays++; this.paused = false; this.emit('play'); return Promise.resolve(); }
  pause() { if (!this.paused) { this.paused = true; this.emit('pause'); } }
  removeAttribute(name) { if (name === 'src') { this._src = ''; this.currentSrc = ''; this.duration = NaN; this.readyState = 0; } }
}
function preview(shared = setup(), video = new Video(), extra = {}) {
  const controller = createContextBookmarkPreviewController({ pool: shared.pool, video, media, origin, validateReference: value => value.cueId === reference.cueId ? null : 'wrong cue', ...extra });
  controller.select(reference);
  return { ...shared, video, controller };
}

test('direct capability is proof-gated, immutable, holder-local and released exactly once', async () => {
  const { pool, calls } = setup(); const [first, other] = await Promise.all([pool.acquire(), pool.acquire()]);
  assert.equal(first.transport, 'blob'); assert.equal(first.verifiedResourceUrl, resourceUrl);
  assert.equal(calls.fetches[0].url, resourceUrl); assert.equal(calls.fetches[0].options.redirect, 'error');
  const direct = first.toVerifiedDirect();
  assert.equal(direct, first.toVerifiedDirect()); assert.equal(direct, direct.toVerifiedDirect());
  assert.equal(direct.release, first.release); assert.equal(direct.url, resourceUrl); assert.equal(direct.transport, 'verified-direct');
  assert.equal(Object.isFrozen(direct), true); assert.equal(first.transport, 'blob'); assert.equal(other.url, first.url);
  assert.equal(direct.actualSha256, digest); assert.equal(direct.mediaSha256, media.mediaSha256);
  assert.equal(isVerifiedCourseMediaLease(direct, media, origin), true);
  assert.equal(isVerifiedCourseMediaLease(direct, media, 'https://other.example'), false);
  assert.equal(isVerifiedCourseMediaLease({ ...direct }, media, origin), false);
  first.release(); assert.throws(() => first.toVerifiedDirect(), { name: 'AbortError' });
  assert.equal(isVerifiedCourseMediaLease(direct, media, origin), false); assert.equal(isVerifiedCourseMediaLease(first, media, origin), false);
  direct.release(); assert.deepEqual(calls.revoked, []); other.release(); assert.deepEqual(calls.revoked, [first.url]);
  assert.equal(calls.fetches.length, 1); assert.equal(calls.digests, 1);
});

for (const [name, patch] of [
  ['opaque response', { type: 'opaque' }], ['CORS response', { type: 'cors' }], ['missing response type', { type: undefined }],
  ['redirect', { redirected: true }], ['missing redirect proof', { redirected: undefined }],
  ['wrong URL', { url: origin + '/studio-assets/old.mp4' }], ['foreign URL', { url: 'https://other.example' + variant.url }],
  ['empty URL', { url: '' }], ['missing MIME', { headers: new Headers() }],
  ['wrong MIME', { headers: new Headers({ 'content-type': 'text/html' }) }], ['empty body', { blob: async () => new Blob([]) }],
]) test(`${name} response cannot issue any lease or direct capability`, async () => {
  const s = setup({ fetch: async () => response(patch) }); await assert.rejects(s.pool.acquire()); assert.deepEqual(s.calls.created, []);
});
for (const patch of [{ playbackVariant: undefined }, { playbackVariant: { ...variant, url: '/studio-assets/no-hash.mp4' } }, { playbackVariant: { ...variant, url: `https://other.example/${digest}.mp4` } }]) {
  test(`invalid opt-in descriptor rejects before fetch ${JSON.stringify(patch)}`, () => assert.throws(() => setup({}, { ...media, ...patch }), TypeError));
}
for (const badOrigin of ['http://lesson.example', 'null', '', 'https://lesson.example/path']) {
  test(`direct permission requires canonical HTTPS origin ${badOrigin}`, () => assert.throws(() => setup({ origin: badOrigin }), TypeError));
}
for (const badBytes of [new Blob(['old AAC bytes']), new Blob(['corrupt AAC bytes'])]) {
  test('wrong actual bytes never receive direct capability', async () => { const s = setup({ fetch: async () => response({ blob: async () => badBytes }) }); const lease = await s.pool.acquire();
    assert.equal(lease.verified, false); assert.notEqual(lease.actualSha256, digest); assert.equal(lease.toVerifiedDirect, undefined); assert.equal(lease.verifiedResourceUrl, undefined); lease.release(); });
}
test('opt-out preserves old lease shape and cannot direct-convert despite valid bytes', async () => {
  const { allowVerifiedDirect, ...legacy } = media; const s = setup({}, legacy); const lease = await s.pool.acquire();
  assert.equal(lease.transport, undefined); assert.equal(lease.verifiedResourceUrl, undefined); assert.equal(lease.toVerifiedDirect, undefined); lease.release();
});
test('exact native AAC metadata error retries verified direct once without autoplay', async () => {
  const p = preview(); await p.controller.load(); assert.equal(p.controller.getState().phase, 'ready');
  assert.deepEqual(p.video.loads, ['blob:test-1', resourceUrl]); assert.equal(p.controller.getPlaybackTransport(), 'verified-direct');
  assert.equal(p.video.crossOrigin, 'anonymous'); assert.equal(p.video.plays, 0); assert.equal(p.calls.fetches.length, 1);
  assert.deepEqual(p.controller.getState().reference, reference);
  p.controller.dispose(); assert.deepEqual(p.calls.revoked, ['blob:test-1']);
});
for (const error of [{ code: 4, message: '' }, { code: 3, message: nativeAAC.message }, { code: 4, message: ' ' + nativeAAC.message }, { code: 4, message: nativeAAC.message + ' ' }, { code: 4, message: 'Unsupported codec' }]) {
  test(`nonexact error cannot convert ${JSON.stringify(error)}`, async () => { const video = new Video(); video.blobError = error; const p = preview(setup(), video); await p.controller.load();
    assert.equal(p.controller.getState().phase, 'error'); assert.equal(p.video.loads.length, 1); assert.match(p.controller.getState().error, /transport=blob/); p.controller.dispose(); });
}
test('repeated exact native AAC error stops after one direct retry', async () => { const video = new Video(); video.directError = nativeAAC; const p = preview(setup(), video); await p.controller.load();
  assert.equal(p.controller.getState().phase, 'error'); assert.equal(video.loads.length, 2); assert.match(p.controller.getState().error, /transport=verified-direct/); assert.equal(p.controller.getPlaybackTransport(), null); p.controller.dispose(); });
test('forged capability or direct lease cannot authorize fallback', async () => {
  let converted = 0; const fake = { url: 'blob:forged', mediaId: media.mediaId, mediaSha256: media.mediaSha256, playbackVariant: variant, actualSha256: digest, verified: true, verificationError: null, transport: 'blob', verifiedResourceUrl: resourceUrl, release() {}, toVerifiedDirect() { converted++; return { ...fake, url: resourceUrl, transport: 'verified-direct' }; } };
  const p = preview({ pool: { acquire: async () => fake } }); await p.controller.load(); assert.equal(p.controller.getState().phase, 'error'); assert.equal(converted, 0); assert.deepEqual(p.video.loads, []); p.controller.dispose();
});
test('aborted holder cannot convert or invalidate a different live holder', async () => { const s = setup(); const abort = new AbortController(); const one = await s.pool.acquire({ signal: abort.signal }); const two = await s.pool.acquire(); const direct = one.toVerifiedDirect(); abort.abort();
  assert.throws(() => one.toVerifiedDirect(), { name: 'AbortError' }); assert.equal(isVerifiedCourseMediaLease(direct, media, origin), false); assert.equal(isVerifiedCourseMediaLease(two, media, origin), true); two.release(); assert.equal(s.calls.revoked.length, 1); });
for (const action of ['close', 'background', 'recording', 'dispose', 'select']) {
  test(`${action} between native error and retry blocks late conversion`, async () => { const video = new Video(); video.auto = false; const p = preview(setup(), video); const loading = p.controller.load(); await until(() => video.pending.length);
    video.pending.shift()(); if (action === 'recording') p.controller.setRecordingBlocked(true); else if (action === 'select') p.controller.select({ ...reference, cueId: 'other' }); else p.controller[action](); await loading;
    assert.equal(video.loads.length, 1); assert.equal(video.src, ''); assert.equal(video.plays, 0); assert.equal(p.controller.getPlaybackTransport(), null); p.controller.dispose(); });
}
test('synchronous recording guard change before retry prevents conversion', async () => { let blocked = false; const video = new Video(); video.auto = false; const p = preview(setup(), video, { isRecordingBlocked: () => blocked }); const loading = p.controller.load(); await until(() => video.pending.length); video.pending.shift()(); blocked = true; await loading;
  assert.equal(video.loads.length, 1); assert.equal(p.controller.getPlaybackTransport(), null); assert.equal(video.plays, 0); p.controller.dispose(); });
test('playback exact AAC fallback reloads metadata silently and keeps the reference', async () => { const video = new Video(); video.blobError = null; const p = preview(setup(), video); await p.controller.load(); assert.equal(p.controller.getPlaybackTransport(), 'blob');
  await p.controller.play(); video.error = nativeAAC; video.emit('error'); await tick(); assert.equal(p.controller.getState().phase, 'ready'); assert.equal(p.controller.getPlaybackTransport(), 'verified-direct'); assert.equal(video.plays, 1); assert.equal(video.paused, true); assert.equal(p.controller.getState().reference.cueId, reference.cueId); p.controller.dispose(); });
test('successful metadata must still match source and cue duration before exposing transport', async () => { const p = preview(); await p.controller.load(); assert.equal(p.controller.getPlaybackTransport(), 'verified-direct'); p.video.currentSrc = 'https://other.example/bad.mp4'; assert.equal(p.controller.getPlaybackTransport(), null); await p.controller.play(); assert.equal(p.controller.getState().phase, 'error'); p.controller.dispose(); });
test('last cancellation during digest cannot create late direct authority or revoke later generation', async () => { const held = gate(); let n = 0; const s = setup({ digest: buffer => ++n === 1 ? held.promise : webcrypto.subtle.digest('SHA-256', buffer) }); const abort = new AbortController(); const pending = s.pool.acquire({ signal: abort.signal }); await tick(); abort.abort(); await assert.rejects(pending, { name: 'AbortError' }); const newer = await s.pool.acquire(); held.resolve(await webcrypto.subtle.digest('SHA-256', await bytes.arrayBuffer())); await tick();
  assert.equal(s.calls.created.length, 1); assert.deepEqual(s.calls.revoked, []); assert.equal(isVerifiedCourseMediaLease(newer.toVerifiedDirect(), media, origin), true); newer.release(); assert.deepEqual(s.calls.revoked, ['blob:test-1']); });


test('pool can be constructed during server rendering, without issuing direct authority', () => {
  assert.doesNotThrow(() => createOriginalCourseMediaPool({}, media));
});
test('raw AAC predicate rejects normalized, nonnumeric-code and throwing getter substitutes', () => {
  assert.equal(isExactNativeAACError(nativeAAC), true);
  for (const error of [null, undefined, { code: '4', message: nativeAAC.message }, { code: 4, message: nativeAAC.message + '\n' }, { code: 4, get message() { throw new Error('native getter failed'); } }]) {
    assert.equal(isExactNativeAACError(error), false);
  }
});
test('unknown transport cannot be validated even with the right source hash', async () => {
  const s = setup(); const lease = await s.pool.acquire();
  assert.equal(isVerifiedCourseMediaLease({ ...lease, transport: 'url' }, media, origin), false); lease.release();
});
for (const action of ['close', 'background', 'recording', 'dispose', 'select']) {
  test(`${action} during direct metadata cancels only that holder and ignores late metadata`, async () => {
    const s = setup(); const other = await s.pool.acquire(); const video = new Video(); video.auto = false; const p = preview(s, video);
    const loading = p.controller.load(); await until(() => video.pending.length); video.pending.shift()();
    await until(() => video.pending.length); assert.equal(video.src, resourceUrl);
    const directCompletion = video.pending.shift();
    if (action === 'recording') p.controller.setRecordingBlocked(true); else if (action === 'select') p.controller.select({ ...reference, cueId: 'other' }); else p.controller[action]();
    await loading; const state = p.controller.getState(); directCompletion(); video.emit('loadedmetadata'); video.error = nativeAAC; video.emit('error'); await tick();
    assert.equal(p.controller.getState(), state); assert.equal(video.src, ''); assert.equal(video.plays, 0); assert.equal(p.controller.getPlaybackTransport(), null);
    assert.deepEqual(s.calls.revoked, []); assert.equal(other.transport, 'blob'); assert.equal(isVerifiedCourseMediaLease(other, media, origin), true);
    p.controller.dispose(); other.release(); assert.deepEqual(s.calls.revoked, ['blob:test-1']);
  });
}
test('hidden guard between native error and retry blocks conversion without a lifecycle event', async () => {
  let hidden = false; const video = new Video(); video.auto = false; const p = preview(setup(), video, { lifecycle: { isHidden: () => hidden } });
  const loading = p.controller.load(); await until(() => video.pending.length); video.pending.shift()(); hidden = true; await loading;
  assert.equal(video.loads.length, 1); assert.equal(video.plays, 0); assert.equal(p.controller.getPlaybackTransport(), null); p.controller.dispose();
});
test('source mismatch at the exact native error cannot authorize retry', async () => {
  const video = new Video(); video.auto = false; const p = preview(setup(), video); const loading = p.controller.load(); await until(() => video.pending.length);
  video.currentSrc = origin + '/studio-assets/unrelated.mp4'; video.error = nativeAAC; video.emit('error'); await loading;
  assert.equal(p.controller.getState().phase, 'error'); assert.equal(video.loads.length, 1); p.controller.dispose();
});
test('metadata timeout and invalid duration never trigger a direct retry', async () => {
  const timeoutVideo = new Video(); timeoutVideo.auto = false; const timeout = preview(setup(), timeoutVideo, { metadataTimeoutMs: 5 }); await timeout.controller.load();
  assert.equal(timeout.controller.getState().phase, 'error'); assert.equal(timeoutVideo.loads.length, 1); timeout.controller.dispose();
  const shortVideo = new Video(); shortVideo.auto = false; const short = preview(setup(), shortVideo); const loading = short.controller.load(); await until(() => shortVideo.pending.length);
  shortVideo.duration = 1; shortVideo.readyState = 1; shortVideo.emit('loadedmetadata'); await loading;
  assert.equal(short.controller.getState().phase, 'error'); assert.equal(shortVideo.loads.length, 1); short.controller.dispose();
});
test('direct metadata still requires nonempty exact native currentSrc', async () => {
  const video = new Video(); video.auto = false; const p = preview(setup(), video); const loading = p.controller.load(); await until(() => video.pending.length); video.pending.shift()(); await until(() => video.pending.length);
  video.duration = 12; video.readyState = 1; video.currentSrc = ''; video.emit('loadedmetadata'); await loading;
  assert.equal(p.controller.getState().phase, 'error'); assert.equal(p.controller.getPlaybackTransport(), null); p.controller.dispose();
});
test('getPlaybackTransport stops reporting ready transport when a live guard changes', async () => {
  let blocked = false; const p = preview(setup(), new Video(), { isRecordingBlocked: () => blocked }); await p.controller.load();
  assert.equal(p.controller.getPlaybackTransport(), 'verified-direct'); blocked = true; assert.equal(p.controller.getPlaybackTransport(), null); blocked = false;
  p.video.duration = 2; assert.equal(p.controller.getPlaybackTransport(), null); p.controller.dispose();
});
test('borrowers acquired after another converts still receive the shared Blob view', async () => {
  const s = setup(); const first = await s.pool.acquire(); const direct = first.toVerifiedDirect(); const later = await s.pool.acquire();
  assert.equal(later.transport, 'blob'); assert.equal(later.url, first.url); assert.equal(s.calls.fetches.length, 1);
  later.release(); assert.equal(isVerifiedCourseMediaLease(direct, media, origin), true); direct.release(); assert.deepEqual(s.calls.revoked, [first.url]);
});

test('default browser origin is resolved at acquisition and rechecked before direct reuse', async () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'location');
  try {
    delete globalThis.location;
    const s = setup({ origin: undefined });
    Object.defineProperty(globalThis, 'location', { value: { origin }, configurable: true });
    const lease = await s.pool.acquire(); const direct = lease.toVerifiedDirect();
    assert.equal(isVerifiedCourseMediaLease(direct, media), true);
    globalThis.location.origin = 'https://changed.example';
    assert.equal(isVerifiedCourseMediaLease(direct, media), false);
    assert.throws(() => lease.toVerifiedDirect(), TypeError);
    lease.release(); assert.deepEqual(s.calls.revoked, ['blob:test-1']);
  } finally { if (before) Object.defineProperty(globalThis, 'location', before); else delete globalThis.location; }
});
