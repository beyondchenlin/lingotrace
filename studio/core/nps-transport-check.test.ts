import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import NpsTransportCheck, { createNpsTransportCheckController } from '../components/NpsTransportCheck';
import { createOriginalCourseMediaPool, type OriginalCourseMediaLease } from '../media/context-bookmark-media';
import { NPS_PLAYBACK_MEDIA } from '../media/nps-playback';
import { NPS_COURSE_MEDIA, NPS_MATERIAL } from './builtin-material';

const origin = 'https://nps-check.example';
const source = new Blob([await readFile(new URL('../../public/studio-assets/nps-connie/connie-lau-compatible-mp4-v1.mp4', import.meta.url))], { type: 'video/mp4' });
const directUrl = new URL(NPS_PLAYBACK_MEDIA.playbackVariant.url, origin).href;
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

class Video extends EventTarget {
  private source = '';
  currentSrc = ''; duration = NPS_COURSE_MEDIA.durationSeconds; videoWidth = 4; videoHeight = 3;
  readyState = 0; currentTime = 0; paused = true; seeking = false; plays = 0;
  crossOrigin: string | null = null; playsInline = false; preload = ''; autoplay = false; muted = false; defaultMuted = false; controls = false;
  error: { code: number; message: string } | null = null;
  assignments: { src: string; crossOrigin: string | null; autoplay: boolean; muted: boolean }[] = [];
  playGate: ReturnType<typeof deferred> | null = null;
  callbacks = new Map<string, EventListener[]>();
  get src() { return this.source; }
  set src(value: string) { this.source = value; this.assignments.push({ src: value, crossOrigin: this.crossOrigin, autoplay: this.autoplay, muted: this.muted }); }
  addEventListener(name: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    super.addEventListener(name, listener, options);
    if (typeof listener === 'function') this.callbacks.set(name, [...(this.callbacks.get(name) ?? []), listener]);
  }
  removeAttribute(name: string) { if (name === 'src') { this.source = ''; this.currentSrc = ''; this.readyState = 0; this.error = null; } }
  load() { if (this.source) this.currentSrc = this.source; }
  metadata() { this.readyState = 2; this.dispatchEvent(new Event('loadedmetadata')); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  async play() { this.plays++; this.paused = false; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); if (this.playGate) await this.playGate.promise; }
}

function fixture(options: { fetchGate?: ReturnType<typeof deferred>; corrupt?: boolean; mime?: string } = {}) {
  const video = new Video(), documentTarget = new EventTarget(), windowTarget = new EventTarget();
  let hidden = false, drawn: unknown = null, readbacks = 0, encoded = 0, fetches = 0;
  const revoked: string[] = [];
  let heldLease: OriginalCourseMediaLease | null = null;
  const canvas = {
    width: 1, height: 1,
    getContext() { return {
      drawImage(value: unknown) { drawn = value; },
      getImageData(_x: number, _y: number, width: number, height: number) { readbacks++; return { data: new Uint8ClampedArray(width * height * 4) }; },
    }; },
    toDataURL() { encoded++; return 'data:image/png;base64,checked'; },
  };
  const pool = createOriginalCourseMediaPool({
    origin,
    fetch: async (url, request) => {
      fetches++; assert.equal(request.redirect, 'error'); assert.equal(url, directUrl);
      await options.fetchGate?.promise;
      return { ok: true, status: 200, type: 'basic' as const, url: directUrl, redirected: false, headers: new Headers({ 'Content-Type': options.mime ?? 'video/mp4' }),
        blob: async () => options.corrupt ? new Blob(['not the video'], { type: 'video/mp4' }) : source };
    },
    digest: bytes => webcrypto.subtle.digest('SHA-256', bytes),
    createObjectURL: () => `blob:checked-nps-${fetches}`,
    revokeObjectURL: url => revoked.push(url),
  }, NPS_PLAYBACK_MEDIA);
  const controller = createNpsTransportCheckController({ video: video as unknown as HTMLVideoElement,
    canvas: canvas as unknown as HTMLCanvasElement, pool: { async acquire(options) {
      heldLease = await pool.acquire(options); return heldLease;
    } }, changed() {}, origin, documentTarget, windowTarget, isHidden: () => hidden });
  return { video, canvas, controller, revoked, documentTarget, windowTarget,
    hide() { hidden = true; documentTarget.dispatchEvent(new Event('visibilitychange')); },
    setHidden() { hidden = true; }, expireLease() { heldLease?.release(); },
    get drawn() { return drawn; }, get readbacks() { return readbacks; }, get encoded() { return encoded; }, get fetches() { return fetches; },
  };
}

test('isolated check renders no source, autoplay, learning entry or permission request', async () => {
  const markup = renderToStaticMarkup(createElement(NpsTransportCheck));
  assert.match(markup, /仅验证同源直接播放与画布，不产生学习记录。/);
  assert.match(markup, /核验并加载同源兼容视频/);
  const video = markup.match(/<video[^>]*>/)?.[0] ?? '';
  assert.match(video, /crossOrigin="anonymous"/i); assert.match(video, /preload="metadata"/); assert.match(video, /muted/);
  assert.doesNotMatch(video, /\ssrc=|autoplay|\scontrols(?:=|\s|>)/i);
  const component = await readFile(new URL('../components/NpsTransportCheck.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(component, /getUserMedia|getDisplayMedia|MediaRecorder|indexedDB|localStorage|sessionStorage|URLSearchParams|window\.location\.search|from ['"][^'"]*training/);
  const route = await readFile(new URL('../../app/media-transport-check/page.tsx', import.meta.url), 'utf8');
  assert.match(route, /NpsTransportCheck/); assert.doesNotMatch(route, /studio\.css|components\/Studio/);
  const assembly = await readFile(new URL('../../scripts/assemble-site.mjs', import.meta.url), 'utf8');
  assert.match(assembly, /access\('out\/media-transport-check\/index\.html'\)/);
  assert.match(assembly, /'media-transport-check'/);
});

test('real pool converts only its verified holder, then loads fixed HTTPS metadata without playing', async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  assert.equal(f.fetches, 0); assert.equal(f.video.src, '');
  await f.controller.load();
  assert.equal(f.controller.getState().phase, 'loading'); assert.equal(f.fetches, 1);
  assert.deepEqual(f.video.assignments, [{ src: directUrl, crossOrigin: 'anonymous', autoplay: false, muted: true }]);
  assert.equal(f.video.plays, 0); assert.equal(f.video.controls, false); assert.deepEqual(f.revoked, []);
  f.video.metadata();
  assert.equal(f.controller.getState().phase, 'ready'); assert.equal(f.video.controls, true);
  assert.equal(f.controller.getState().actualSha256, NPS_PLAYBACK_MEDIA.playbackVariant.mediaSha256);
  assert.equal(f.controller.getState().currentSrc, directUrl); assert.equal(f.controller.getState().duration, NPS_COURSE_MEDIA.durationSeconds);
  assert.equal(f.video.plays, 0);
  f.controller.stop(); assert.equal(f.video.src, ''); assert.deepEqual(f.revoked, ['blob:checked-nps-1']);
});

test('manual playback, fixed cue seeking and Canvas use the actual verified native element', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.load(); f.video.metadata();
  await f.controller.play(); assert.equal(f.video.plays, 1); assert.equal(f.controller.getState().phase, 'playing');
  for (const index of [0, 1, -1] as const) {
    f.controller.seek(index);
    assert.equal(f.video.currentTime, NPS_MATERIAL.cues[index === -1 ? NPS_MATERIAL.cues.length - 1 : index].start);
    assert.equal(f.video.paused, true); assert.ok(f.video.currentTime < f.video.duration);
  }
  f.controller.checkCanvas(); assert.equal(f.drawn, f.video); assert.equal(f.readbacks, 1); assert.equal(f.encoded, 1);
  assert.match(f.controller.getState().canvasResult, /画布读取成功/); assert.match(f.controller.getState().frameDataUrl, /^data:image\/png;/);
  f.controller.seek(0); assert.equal(f.controller.getState().frameDataUrl, ''); assert.equal(f.canvas.width, 1);
});

for (const failure of ['hash', 'mime', 'duration', 'currentSrc', 'native'] as const) test(`${failure} failure stops and releases without an unverified fallback`, async t => {
  const f = fixture({ corrupt: failure === 'hash', mime: failure === 'mime' ? 'text/html' : undefined });
  t.after(() => f.controller.dispose()); await f.controller.load();
  if (failure === 'duration') { f.video.duration = 99; f.video.metadata(); }
  if (failure === 'currentSrc') { f.video.currentSrc = `${origin}/unapproved.mp4`; f.video.metadata(); }
  if (failure === 'native') { f.video.error = { code: 4, message: 'PipelineStatus::DEMUXER_ERROR_DETECTED_AAC' }; f.video.dispatchEvent(new Event('error')); }
  assert.equal(f.controller.getState().phase, 'error'); assert.equal(f.video.src, ''); assert.equal(f.video.plays, 0);
  assert.equal(f.video.assignments.length, failure === 'hash' || failure === 'mime' ? 0 : 1);
  assert.equal(f.video.assignments.some(row => row.src.startsWith('blob:')), false);
  if (failure === 'native') assert.equal(f.controller.getState().nativeError, 'code=4; PipelineStatus::DEMUXER_ERROR_DETECTED_AAC');
});

for (const interruption of ['stop', 'hidden', 'pagehide', 'dispose'] as const) test(`${interruption} aborts a pending fetch and prevents a late native source`, async () => {
  const gate = deferred(), f = fixture({ fetchGate: gate });
  const work = f.controller.load(); await Promise.resolve();
  if (interruption === 'stop') f.controller.stop();
  else if (interruption === 'hidden') f.hide();
  else if (interruption === 'pagehide') f.windowTarget.dispatchEvent(new Event('pagehide'));
  else f.controller.dispose();
  gate.resolve(); await work;
  assert.equal(f.video.src, ''); assert.equal(f.video.assignments.length, 0); assert.equal(f.video.plays, 0);
  f.controller.dispose();
});

test('hidden cancels a ready source and pending play completion cannot revive it', async () => {
  const f = fixture(); await f.controller.load(); f.video.metadata(); f.video.playGate = deferred();
  const playing = f.controller.play(); f.hide(); f.video.playGate.resolve(); await playing;
  assert.equal(f.controller.getState().phase, 'stopped'); assert.equal(f.video.src, ''); assert.equal(f.video.paused, true);
  assert.equal(f.controller.getState().frameDataUrl, ''); assert.deepEqual(f.revoked, ['blob:checked-nps-1']); f.controller.dispose();
});

test('old native callbacks cannot change or release a replacement request', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.load();
  const oldMetadata = f.video.callbacks.get('loadedmetadata')![0], oldError = f.video.callbacks.get('error')![0];
  await f.controller.load(); f.video.metadata();
  oldMetadata(new Event('loadedmetadata')); oldError(new Event('error'));
  assert.equal(f.controller.getState().phase, 'ready'); assert.equal(f.video.src, directUrl);
  assert.deepEqual(f.revoked, ['blob:checked-nps-1']); assert.equal(f.fetches, 2); assert.equal(f.video.plays, 0);
});

test('altered source after metadata is rejected before playback or Canvas readback', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.load(); f.video.metadata();
  f.video.currentSrc = `${origin}/unapproved.mp4`; await f.controller.play(); f.controller.checkCanvas();
  assert.equal(f.controller.getState().phase, 'error'); assert.equal(f.video.plays, 0); assert.equal(f.readbacks, 0); assert.equal(f.video.src, '');
});

for (const success of ['promise', 'native-playing'] as const) test(`successful ${success} clears a previous recoverable play rejection`, async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.load(); f.video.metadata();
  f.video.play = async () => { throw new DOMException('Playback needs an explicit gesture.', 'NotAllowedError'); };
  await f.controller.play(); assert.match(f.controller.getState().error, /explicit gesture/);
  if (success === 'promise') {
    f.video.play = async () => { f.video.paused = false; };
    await f.controller.play();
  } else { f.video.paused = false; f.video.dispatchEvent(new Event('playing')); }
  assert.equal(f.controller.getState().phase, 'playing'); assert.equal(f.controller.getState().error, '');
  assert.equal(f.video.currentSrc, directUrl); assert.equal(f.fetches, 1);
});

const metadataEvents = ['loadedmetadata', 'durationchange', 'loadeddata', 'canplay'] as const;
const fullCueStart = Math.min(...NPS_MATERIAL.cues.map(cue => cue.start));
const fullCueEnd = Math.max(...NPS_MATERIAL.cues.map(cue => cue.end));

for (const unknown of [NaN, Infinity, 0]) test(`unknown duration ${unknown} waits for finite durationchange without playing`, async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.load();
  f.video.duration = unknown; f.video.metadata();
  assert.equal(f.controller.getState().phase, 'loading'); assert.equal(f.video.controls, false);
  assert.equal(f.controller.getState().duration, null); assert.equal(f.video.src, directUrl);
  f.video.duration = NPS_COURSE_MEDIA.durationSeconds; f.video.dispatchEvent(new Event('durationchange'));
  assert.equal(f.controller.getState().phase, 'ready'); assert.equal(f.video.controls, true);
  assert.equal(f.controller.getState().duration, NPS_COURSE_MEDIA.durationSeconds);
  assert.equal(f.video.plays, 0); assert.deepEqual(f.revoked, []);
});

for (const event of metadataEvents) test(`${event} only accepts finite valid metadata when readyState reaches HAVE_METADATA`, async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.load();
  f.video.dispatchEvent(new Event(event));
  assert.equal(f.controller.getState().phase, 'loading'); assert.equal(f.video.controls, false);
  f.video.readyState = 1; f.video.dispatchEvent(new Event(event));
  assert.equal(f.controller.getState().phase, 'ready'); assert.equal(f.video.controls, true); assert.equal(f.video.plays, 0);
});

for (const unknown of [NaN, Infinity, 0]) test(`unknown duration ${unknown} times out at the original 20 s despite repeated readiness events`, async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await f.controller.load(); f.video.duration = unknown; f.video.metadata();
  for (let elapsed = 0; elapsed < 19000; elapsed += 1000) {
    t.mock.timers.tick(1000);
    for (const event of metadataEvents) f.video.dispatchEvent(new Event(event));
    assert.equal(f.controller.getState().phase, 'loading');
  }
  t.mock.timers.tick(999); assert.equal(f.controller.getState().phase, 'loading');
  t.mock.timers.tick(1);
  assert.equal(f.controller.getState().phase, 'error'); assert.equal(f.video.src, ''); assert.equal(f.video.controls, false);
  assert.match(f.controller.getState().error, /时长.*(?:未知|尚未)|(?:未知|尚未).*时长/);
  assert.match(f.controller.getState().error, /range-v71; actual=/);
  assert.ok(f.controller.getState().error.includes(`cueStart=${fullCueStart}; cueEnd=${fullCueEnd}`));
  assert.match(f.controller.getState().error, /ready=2; transport=verified-direct/);
  assert.equal(f.controller.getState().nativeError, ''); assert.deepEqual(f.revoked, ['blob:checked-nps-1']);
  f.video.duration = NPS_COURSE_MEDIA.durationSeconds; f.video.metadata();
  assert.equal(f.controller.getState().phase, 'error'); assert.equal(f.video.plays, 0);
});

test('readyState zero remains bounded even with finite duration and repeated metadata', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); t.mock.timers.enable({ apis: ['setTimeout'] });
  await f.controller.load();
  f.video.dispatchEvent(new Event('loadedmetadata')); t.mock.timers.tick(19000);
  f.video.dispatchEvent(new Event('durationchange')); assert.equal(f.controller.getState().phase, 'loading');
  t.mock.timers.tick(1000); assert.equal(f.controller.getState().phase, 'error');
  assert.match(f.controller.getState().error, /元数据.*(?:未就绪|尚未)|(?:未就绪|尚未).*元数据/);
  assert.match(f.controller.getState().error, /ready=0; transport=verified-direct/);
  assert.equal(f.video.src, '');
});

test('successful delayed metadata cancels the deadline and later metadata does not reset playback phase', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); t.mock.timers.enable({ apis: ['setTimeout'] });
  await f.controller.load(); f.video.duration = NaN; f.video.metadata(); t.mock.timers.tick(19999);
  f.video.duration = NPS_COURSE_MEDIA.durationSeconds; f.video.dispatchEvent(new Event('canplay'));
  await f.controller.play();
  for (const event of metadataEvents) f.video.dispatchEvent(new Event(event));
  assert.equal(f.controller.getState().phase, 'playing');
  t.mock.timers.tick(20001); assert.equal(f.controller.getState().phase, 'playing'); assert.equal(f.video.src, directUrl);
});

for (const invalid of ['duration', 'width', 'height'] as const) test(`first finite positive metadata with invalid ${invalid} fails without rescue by later correction`, async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.load();
  f.video.duration = NaN; f.video.metadata();
  f.video.duration = invalid === 'duration' ? 99 : NPS_COURSE_MEDIA.durationSeconds;
  if (invalid === 'width') f.video.videoWidth = 0;
  if (invalid === 'height') f.video.videoHeight = 0;
  f.video.dispatchEvent(new Event('durationchange'));
  assert.equal(f.controller.getState().phase, 'error'); assert.equal(f.video.src, '');
  assert.match(f.controller.getState().error, /range-v71; actual=/);
  assert.ok(f.controller.getState().error.includes(`cueStart=${fullCueStart}; cueEnd=${fullCueEnd}`));
  assert.doesNotMatch(f.controller.getState().error, /时长.*(?:未知|尚未)|(?:未知|尚未).*时长/);
  f.video.duration = NPS_COURSE_MEDIA.durationSeconds; f.video.videoWidth = 4; f.video.videoHeight = 3;
  for (const event of metadataEvents) f.video.dispatchEvent(new Event(event));
  assert.equal(f.controller.getState().phase, 'error'); assert.equal(f.video.controls, false); assert.equal(f.video.plays, 0);
});

for (const event of metadataEvents) test(`${event} checks selected source before waiting for unknown duration`, async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.load();
  f.video.duration = NaN; f.video.currentSrc = `${origin}/unapproved.mp4`; f.video.dispatchEvent(new Event(event));
  assert.equal(f.controller.getState().phase, 'error'); assert.equal(f.video.src, ''); assert.equal(f.video.controls, false);
  assert.deepEqual(f.revoked, ['blob:checked-nps-1']);
});

for (const event of metadataEvents) test(`${event} remains fail-closed if duration becomes unknown after readiness`, async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.load(); f.video.metadata();
  f.video.duration = NaN; f.video.dispatchEvent(new Event(event));
  assert.equal(f.controller.getState().phase, 'error'); assert.equal(f.video.src, ''); assert.equal(f.video.controls, false);
});

for (const interruption of ['native-error', 'stop', 'hidden', 'pagehide', 'dispose'] as const) test(`${interruption} cancels unknown metadata and every delayed readiness callback`, async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); t.mock.timers.enable({ apis: ['setTimeout'] });
  await f.controller.load(); f.video.duration = NaN; f.video.metadata();
  assert.equal(f.controller.getState().phase, 'loading');
  const callbacks = metadataEvents.flatMap(event => (f.video.callbacks.get(event) ?? []).map(callback => ({ event, callback })));
  if (interruption === 'native-error') {
    f.video.error = { code: 4, message: 'native decode failed' }; f.video.dispatchEvent(new Event('error'));
    assert.equal(f.controller.getState().nativeError, 'code=4; native decode failed');
  } else if (interruption === 'stop') f.controller.stop();
  else if (interruption === 'hidden') f.hide();
  else if (interruption === 'pagehide') f.windowTarget.dispatchEvent(new Event('pagehide'));
  else f.controller.dispose();
  const stoppedState = f.controller.getState();
  f.video.duration = NPS_COURSE_MEDIA.durationSeconds; f.video.readyState = 2;
  for (const { event, callback } of callbacks) callback(new Event(event));
  t.mock.timers.tick(20000);
  assert.deepEqual(f.controller.getState(), stoppedState); assert.equal(f.video.src, ''); assert.equal(f.video.controls, false);
  assert.equal(f.video.plays, 0); assert.deepEqual(f.revoked, ['blob:checked-nps-1']);
});

test('stale readiness and native error callbacks cannot complete or release a replacement unknown metadata wait', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.load();
  f.video.duration = NaN; f.video.metadata();
  const events = [...metadataEvents, 'error'];
  const oldCallbacks = events.flatMap(event => (f.video.callbacks.get(event) ?? []).map(callback => ({ event, callback })));
  await f.controller.load(); f.video.duration = NPS_COURSE_MEDIA.durationSeconds; f.video.readyState = 2;
  for (const { event, callback } of oldCallbacks) callback(new Event(event));
  assert.equal(f.controller.getState().phase, 'loading'); assert.equal(f.video.controls, false);
  assert.equal(f.video.src, directUrl); assert.deepEqual(f.revoked, ['blob:checked-nps-1']);
  f.video.dispatchEvent(new Event('loadeddata'));
  assert.equal(f.controller.getState().phase, 'ready'); assert.equal(f.video.plays, 0); assert.equal(f.fetches, 2);
});

for (const event of metadataEvents) test(`${event} checks the live direct lease before waiting for duration`, async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.load();
  f.video.duration = NaN; f.expireLease(); f.video.dispatchEvent(new Event(event));
  assert.equal(f.controller.getState().phase, 'error'); assert.equal(f.video.src, '');
  assert.equal(f.video.controls, false); assert.deepEqual(f.revoked, ['blob:checked-nps-1']);
});

for (const event of metadataEvents) test(`${event} cannot complete metadata while hidden before visibility cleanup`, async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.load();
  f.video.readyState = 2; f.setHidden(); f.video.dispatchEvent(new Event(event));
  assert.equal(f.controller.getState().phase, 'loading'); assert.equal(f.video.controls, false); assert.equal(f.video.plays, 0);
  f.hide(); assert.equal(f.video.src, ''); assert.deepEqual(f.revoked, ['blob:checked-nps-1']);
});

for (const delta of [-0.0005, 0.0005]) test(`duration tolerance ${delta} remains accepted without changing native duration`, async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.load();
  const duration = NPS_COURSE_MEDIA.durationSeconds + delta;
  f.video.duration = duration; f.video.metadata();
  assert.equal(f.controller.getState().phase, 'ready'); assert.equal(f.video.duration, duration);
});

for (const duration of [NPS_COURSE_MEDIA.durationSeconds + 0.00101, fullCueEnd - 0.0001]) test(`finite duration ${duration} cannot broaden tolerance or truncate the last cue`, async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.load();
  f.video.duration = duration; f.video.metadata();
  assert.equal(f.controller.getState().phase, 'error'); assert.equal(f.video.duration, duration);
  assert.equal(f.video.src, ''); assert.equal(f.video.controls, false);
  assert.ok(f.controller.getState().error.includes(`actual=${duration}`));
  assert.ok(f.controller.getState().error.includes(`cueStart=${fullCueStart}; cueEnd=${fullCueEnd}`));
});

for (const invalid of [NaN, Infinity, 0]) test(`timeupdate fails closed on runtime duration ${invalid}`, async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.load(); f.video.metadata();
  f.video.duration = invalid; f.video.dispatchEvent(new Event('timeupdate'));
  assert.equal(f.controller.getState().phase, 'error'); assert.equal(f.video.src, ''); assert.equal(f.video.controls, false);
});

test('timeout reports finite invalid duration as mismatch rather than unknown metadata', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); t.mock.timers.enable({ apis: ['setTimeout'] });
  await f.controller.load(); f.video.duration = NaN; f.video.metadata();
  f.video.duration = 99; t.mock.timers.tick(20000);
  assert.equal(f.controller.getState().phase, 'error'); assert.match(f.controller.getState().error, /时长、画面尺寸或片段范围不符/);
  assert.match(f.controller.getState().error, /range-v71; actual=99/);
  assert.doesNotMatch(f.controller.getState().error, /时长尚未取得/); assert.equal(f.video.src, '');
});

for (const event of metadataEvents) for (const stage of ['pending', 'finite', 'ready'] as const) test(`${event} rejects a native error during ${stage} metadata without requiring an error event`, async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.load();
  if (stage === 'ready') f.video.metadata();
  f.video.duration = stage === 'pending' ? NaN : NPS_COURSE_MEDIA.durationSeconds;
  f.video.readyState = stage === 'pending' ? 0 : 2;
  f.video.error = { code: 4, message: 'PipelineStatus::DEMUXER_ERROR_DETECTED_AAC' };
  f.video.dispatchEvent(new Event(event));
  assert.equal(f.controller.getState().phase, 'error'); assert.equal(f.video.src, ''); assert.equal(f.video.controls, false);
  assert.match(f.controller.getState().error, /MEDIA_4/); assert.match(f.controller.getState().error, /range-v71/);
  assert.equal(f.video.plays, 0); assert.deepEqual(f.revoked, ['blob:checked-nps-1']);
});

test('progress-event native diagnostic is bounded and excludes native source URLs', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.load();
  f.video.duration = NaN;
  f.video.error = { code: 4, message: `https://private.example/media-secret.mp4\n${'x'.repeat(1000)}` };
  f.video.dispatchEvent(new Event('loadeddata'));
  assert.equal(f.controller.getState().phase, 'error');
  const diagnostic = `${f.controller.getState().error} ${f.controller.getState().nativeError}`;
  assert.match(diagnostic, /MEDIA_4/); assert.match(diagnostic, /\[source\]/);
  assert.doesNotMatch(diagnostic, /private\.example|media-secret|x{161}/); assert.ok(diagnostic.length < 700);
});

test('deadline reports a silent native error before unknown-duration timeout', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); t.mock.timers.enable({ apis: ['setTimeout'] });
  await f.controller.load(); f.video.duration = NaN; f.video.metadata();
  f.video.error = { code: 3, message: 'native decode failed' }; t.mock.timers.tick(20000);
  assert.equal(f.controller.getState().phase, 'error'); assert.match(f.controller.getState().error, /MEDIA_3/);
  assert.doesNotMatch(f.controller.getState().error, /时长尚未取得/); assert.equal(f.video.src, '');
});

for (const event of metadataEvents) test(`${event} cannot accept late finite metadata ahead of a delayed timeout callback`, async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  await f.controller.load(); f.video.duration = NaN; f.video.metadata();
  // Advance the deadline without running queued timers, as with a blocked event loop.
  t.mock.timers.setTime(21000);
  f.video.duration = NPS_COURSE_MEDIA.durationSeconds; f.video.dispatchEvent(new Event(event));
  assert.equal(f.controller.getState().phase, 'error'); assert.match(f.controller.getState().error, /超时/);
  assert.equal(f.video.src, ''); assert.equal(f.video.controls, false); assert.equal(f.video.plays, 0);
  assert.deepEqual(f.revoked, ['blob:checked-nps-1']);
});
