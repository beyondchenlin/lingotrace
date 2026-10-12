import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createOriginalCourseMediaPool, createContextBookmarkPreviewController } from './context-bookmark-media.ts';

// Exercise real pool-issued private capability views, not forged public lease fields.
const origin = 'https://lesson.example';
const bytes = new Blob(['finite metadata test bytes'], { type: 'video/mp4' });
const hash = createHash('sha256').update(await bytes.bytes()).digest('hex');
const variant = Object.freeze({ url: `/studio-assets/playback-${hash}.mp4`, mediaId: 'finite-playback', mediaSha256: hash });
const media = Object.freeze({ url: '/studio-assets/source.mp4', mediaId: 'finite-original', mediaSha256: 'a'.repeat(64), playbackVariant: variant, allowVerifiedDirect: true });
const reference = Object.freeze({ materialId: 'finite-original', materialVersion: 'finite-v1', cueId: 'one', text: 'Keep exact bounds.', startSeconds: 1, endSeconds: 6, mediaId: media.mediaId, mediaSha256: media.mediaSha256 });
const nativeAAC = { code: 4, message: 'PipelineStatus::DEMUXER_ERROR_DETECTED_AAC' };
const progressEvents = ['loadedmetadata', 'durationchange', 'loadeddata', 'canplay'];
const tick = () => new Promise(resolve => setImmediate(resolve));
class Video extends EventTarget {
  _src = ''; currentSrc = ''; currentTime = 0; duration = NaN; readyState = 0; networkState = 1; paused = true; error = null;
  muted = true; volume = 1; playbackRate = 1; loads = []; sources = []; plays = 0; handlers = new Map(); onLoad = null;
  get src() { return this._src; }
  set src(value) { this._src = value; this.sources.push(value); this.currentSrc = value; this.duration = NaN; this.readyState = 0; }
  addEventListener(name, listener, options) { const set = this.handlers.get(name) ?? new Set(); set.add(listener); this.handlers.set(name, set); super.addEventListener(name, listener, options); }
  removeEventListener(name, listener, options) { this.handlers.get(name)?.delete(listener); if (!this.handlers.get(name)?.size) this.handlers.delete(name); super.removeEventListener(name, listener, options); }
  get listenerCount() { return [...this.handlers.values()].reduce((sum, set) => sum + set.size, 0); }
  emit(name) { this.dispatchEvent(new Event(name)); }
  metadata(duration = NaN, readyState = 1, event = 'loadedmetadata') { this.duration = duration; this.readyState = readyState; this.emit(event); }
  load() { this.error = null; if (this.src) { this.loads.push(this.src); this.onLoad?.(); } }
  pause() { if (!this.paused) { this.paused = true; this.emit('pause'); } }
  play() { this.plays++; this.paused = false; this.emit('play'); return Promise.resolve(); }
  removeAttribute(name) { if (name === 'src') { this._src = ''; this.currentSrc = ''; this.duration = NaN; this.readyState = 0; } }
}
const nextLoad = video => new Promise(resolve => { video.onLoad = resolve; });
async function setup(t, transport = 'blob', extra = {}) {
  const calls = { fetches: 0, revoked: [], leases: [] }, video = new Video();
  const pool = createOriginalCourseMediaPool({ origin,
    fetch: async () => { calls.fetches++; return { ok: true, status: 200, type: 'basic', redirected: false, url: origin + variant.url, headers: new Headers({ 'content-type': 'video/mp4' }), blob: async () => bytes }; },
    digest: data => webcrypto.subtle.digest('SHA-256', data),
    createObjectURL: () => `blob:finite-${calls.fetches}`, revokeObjectURL: url => calls.revoked.push(url),
  }, media);
  // Retain the acquired real holder for stale-authority tests without forging it.
  const observedPool = { async acquire(options) { const holder = await pool.acquire(options); calls.leases.push(holder); return holder; } };
  const documentTarget = new EventTarget(), windowTarget = new EventTarget();
  let hidden = false, blocked = false;
  const controller = createContextBookmarkPreviewController({ video, pool: observedPool, media, origin, metadataTimeoutMs: 1000,
    validateReference: value => value.cueId === 'one' ? null : 'changed reference',
    lifecycle: { documentTarget, windowTarget, isHidden: () => hidden }, isRecordingBlocked: () => blocked, ...extra });
  t.after(() => controller.dispose());
  const baseline = video.listenerCount;
  controller.select(reference); const attached = nextLoad(video), loading = controller.load();
  await Promise.race([attached, loading]);
  assert.ok(video.src, 'Pool acquisition attached the verified Blob');
  if (transport === 'verified-direct') {
    const directAttached = nextLoad(video); video.error = nativeAAC; video.emit('error'); await Promise.race([directAttached, loading]);
    assert.equal(video.src, origin + variant.url, 'Exact AAC failure converts the real private holder once');
  }
  return { video, controller, calls, baseline, loading, documentTarget, windowTarget,
    hide() { hidden = true; }, record() { blocked = true; } };
}
function cleanWait(f) { assert.equal(f.video.listenerCount, f.baseline); assert.equal(f.video.plays, 0); }
function failed(f, pattern) { assert.equal(f.controller.getState().phase, 'error'); assert.match(f.controller.getState().error, pattern); assert.equal(f.video.src, ''); assert.equal(f.calls.revoked.length, 1); cleanWait(f); }

for (const transport of ['blob', 'verified-direct']) {
  for (const unknown of [NaN, Infinity, 0, -1]) test(`${transport}: unknown ${unknown} metadata waits for finite durationchange without autoplay`, async t => {
    const f = await setup(t, transport); f.video.metadata(unknown); await tick();
    assert.equal(f.controller.getState().phase, 'loading'); assert.equal(f.video.plays, 0); assert.equal(f.calls.revoked.length, 0);
    f.video.metadata(6, 1, 'durationchange'); await f.loading;
    assert.equal(f.controller.getState().phase, 'ready'); assert.equal(f.controller.getState().duration, 6); assert.equal(f.controller.getPlaybackTransport(), transport); assert.equal(f.video.currentTime, 1); cleanWait(f);
  });
  for (const event of progressEvents) test(`${transport}: ${event} can complete a finite ready wait`, async t => {
    const f = await setup(t, transport); f.video.metadata(NaN); await tick(); f.video.metadata(12, 1, event); await f.loading;
    assert.equal(f.controller.getState().phase, 'ready'); cleanWait(f);
  });
  test(`${transport}: finite duration without HAVE_METADATA remains pending`, async t => {
    const f = await setup(t, transport); f.video.metadata(12, 0, 'durationchange'); await tick(); assert.equal(f.controller.getState().phase, 'loading');
    f.video.metadata(12, 1, 'loadeddata'); await f.loading; assert.equal(f.controller.getState().phase, 'ready'); cleanWait(f);
  });
  test(`${transport}: first finite too-short duration fails immediately and cannot be rescued`, async t => {
    const f = await setup(t, transport); f.video.metadata(NaN); await tick();
    f.video.metadata(5.999999, 1, 'durationchange'); f.video.metadata(12, 1, 'canplay'); await f.loading;
    failed(f, /片段时间范围超过原片实际有限时长.*range-v71; actual=5\.999999; cueStart=1; cueEnd=6; ready=1; transport=/);
  });
  for (const unknown of [NaN, Infinity, 0]) test(`${transport}: persistent ${unknown} times out with actual local diagnostics`, async t => {
    const f = await setup(t, transport, { metadataTimeoutMs: 25 }); f.video.metadata(unknown); await f.loading;
    failed(f, new RegExp(`元数据加载超时.*range-v71; actual=${unknown}; cueStart=1; cueEnd=6; ready=1; transport=${transport}`));
  });
  for (const nativeError of [{ code: 3, message: 'decode error' }, { code: 4, message: ` ${nativeAAC.message}` }]) test(`${transport}: native error while pending fails without general fallback`, async t => {
    const f = await setup(t, transport); f.video.metadata(NaN); await tick(); f.video.error = nativeError; f.video.emit('error'); await f.loading;
    failed(f, /无法读取原片元数据.*MEDIA_[34]/); assert.equal(f.video.loads.length, transport === 'blob' ? 1 : 2); assert.equal(f.calls.fetches, 1);
  });
  for (const event of [...progressEvents, 'error']) {
    for (const stale of ['src', 'currentSrc', 'lease', 'hidden', 'recording']) test(`${transport}: ${event} rechecks live ${stale} while duration remains unknown`, async t => {
      const f = await setup(t, transport); f.video.metadata(NaN); await tick();
      if (stale === 'src') f.video._src = 'blob:stale';
      else if (stale === 'currentSrc') f.video.currentSrc = 'blob:stale';
      else if (stale === 'lease') f.calls.leases[0].release();
      else if (stale === 'hidden') f.hide(); else f.record();
      f.video.emit(event); await f.loading;
      assert.notEqual(f.controller.getState().phase, 'loading'); assert.notEqual(f.controller.getState().phase, 'ready');
      assert.equal(f.video.src, ''); assert.equal(f.calls.revoked.length, 1); cleanWait(f);
      f.video.metadata(12); await tick(); assert.notEqual(f.controller.getState().phase, 'ready');
    });
  }
  for (const action of ['close', 'select', 'background', 'dispose', 'pagehide', 'visibilitychange', 'setRecordingBlocked']) test(`${transport}: ${action} cancels unknown wait and removes all temporary handlers`, async t => {
    const f = await setup(t, transport); f.video.metadata(NaN); await tick();
    if (action === 'select') f.controller.select({ ...reference });
    else if (action === 'pagehide') f.windowTarget.dispatchEvent(new Event('pagehide'));
    else if (action === 'visibilitychange') { f.hide(); f.documentTarget.dispatchEvent(new Event('visibilitychange')); }
    else if (action === 'setRecordingBlocked') f.controller.setRecordingBlocked(true); else f.controller[action]();
    await f.loading; const state = f.controller.getState();
    for (const event of progressEvents) f.video.metadata(12, 1, event);
    await tick(); assert.equal(f.controller.getState(), state); assert.equal(f.video.src, ''); assert.equal(f.video.listenerCount, action === 'dispose' ? 0 : f.baseline); assert.equal(f.calls.revoked.length, 1); assert.equal(f.video.plays, 0);
  });
  for (const unknown of [NaN, Infinity, 0]) test(`${transport}: later ${unknown} runtime duration fails closed rather than reopening loading`, async t => {
    const f = await setup(t, transport); f.video.metadata(12); await f.loading; await f.controller.play();
    f.video.metadata(unknown, 1, 'durationchange'); assert.equal(f.controller.getState().phase, 'error'); assert.equal(f.video.paused, true); assert.equal(f.video.src, ''); assert.equal(f.video.plays, 1); assert.match(f.controller.getState().error, /range-v71/);
  });
}

test('repeated unknown events share one original timeout deadline, including exact AAC conversion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const f = await setup(t); f.video.metadata(NaN); await tick();
  t.mock.timers.tick(600); f.video.metadata(Infinity, 1, 'durationchange'); await tick();
  assert.equal(f.controller.getState().phase, 'loading');
  f.video.error = nativeAAC; f.video.emit('error'); await tick(); assert.equal(f.video.loads.length, 2);
  t.mock.timers.tick(399); f.video.metadata(0, 1, 'canplay'); await tick(); assert.equal(f.controller.getState().phase, 'loading');
  t.mock.timers.tick(1); await f.loading; failed(f, /元数据加载超时.*transport=verified-direct/);
});

test('a stale metadata callback cannot settle or release a newer source', async t => {
  const f = await setup(t); f.video.metadata(NaN); await tick();
  const stale = [...f.video.handlers.get('loadedmetadata')]; f.controller.select(reference); await f.loading;
  const attached = nextLoad(f.video), fresh = f.controller.load(); await Promise.race([attached, fresh]);
  const url = f.video.src; assert.ok(url); assert.notEqual(url, f.calls.leases[0].url);
  for (const callback of stale) callback(new Event('loadedmetadata'));
  assert.equal(f.video.src, url); assert.equal(f.controller.getState().phase, 'loading'); assert.equal(f.calls.revoked.length, 1);
  f.video.metadata(12); await fresh; assert.equal(f.controller.getState().phase, 'ready'); assert.equal(f.video.src, url); cleanWait(f);
});

test('a finite progress event after the deadline cannot beat a delayed timer callback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const f = await setup(t); f.video.metadata(NaN); await tick();
  t.mock.timers.setTime(Date.now() + 1000);
  f.video.metadata(12, 1, 'durationchange'); await f.loading; failed(f, /元数据加载超时.*actual=12/);
});

test('metadata readyState lost before acceptance cannot publish ready', async t => {
  const f = await setup(t); f.video.metadata(12); f.video.readyState = 0; await f.loading;
  failed(f, /range-v71; actual=12; cueStart=1; cueEnd=6; ready=0/);
});

for (const edge of ['late exact AAC event', 'timeout with exact AAC error', 'expiry before awaited AAC catch']) {
  test(`${edge} cannot convert or assign a direct source after the original deadline`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const f = await setup(t); f.video.metadata(NaN); await tick();
    f.video.error = nativeAAC;
    if (edge === 'timeout with exact AAC error') t.mock.timers.tick(1000);
    else if (edge === 'late exact AAC event') {
      t.mock.timers.setTime(Date.now() + 1000); f.video.emit('error');
    } else {
      t.mock.timers.tick(999); f.video.emit('error');
      // Promise catch has not run yet: a timely rejection cannot carry old authority.
      t.mock.timers.setTime(Date.now() + 1);
    }
    await tick();
    const sources = [...f.video.sources], loads = [...f.video.loads];
    // Settle the old implementation's incorrectly scheduled zero-ms retry timer.
    t.mock.timers.tick(0); await f.loading;
    assert.deepEqual(sources, ['blob:finite-1'], 'No direct URL assignment after expiry');
    assert.deepEqual(loads, ['blob:finite-1'], 'No native direct load after expiry');
    failed(f, /元数据加载超时.*transport=blob/);
  });
}

for (const transport of ['blob', 'verified-direct']) {
  test(`${transport}: native error between metadata resolution and acceptance fails without a new retry`, async t => {
    const f = await setup(t, transport); f.video.metadata(12);
    f.video.error = nativeAAC; f.video.emit('error'); await f.loading;
    failed(f, /无法读取原片元数据.*MEDIA_4/);
    assert.equal(f.video.loads.length, transport === 'blob' ? 1 : 2);
    assert.equal(f.controller.getPlaybackTransport(), null);
  });
  test(`${transport}: a live native error revokes reported playback readiness`, async t => {
    const f = await setup(t, transport); f.video.metadata(12); await f.loading;
    assert.equal(f.controller.getPlaybackTransport(), transport);
    f.video.error = nativeAAC;
    assert.equal(f.controller.getPlaybackTransport(), null);
  });
  test(`${transport}: lost HAVE_METADATA revokes reported transport without needing another event`, async t => {
    const f = await setup(t, transport); f.video.metadata(12); await f.loading;
    assert.equal(f.controller.getPlaybackTransport(), transport);
    f.video.readyState = 0;
    assert.equal(f.controller.getPlaybackTransport(), null);
  });
}
