import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { setup, gate, until, tick, learning, HOST_MEDIA_ORIGIN } from './studio-host-test-fixture';
import { NPS_MATERIAL, NPS_COURSE_MEDIA } from './builtin-material';
import { NPS_PLAYBACK_MEDIA } from '../media/nps-playback';
import { createOriginalCourseMediaPool } from '../media/context-bookmark-media';
import { fixedReviewDurationMatches, fixedReviewTargetMatches } from '../media/fixed-review-media';
const source = new Blob([await readFile(new URL('../../public/studio-assets/nps-connie/connie-lau-compatible-mp4-v1.mp4', import.meta.url))], { type: 'video/mp4' });
assert.equal(source.size, 19581425);
type Fixture = Awaited<ReturnType<typeof setup>>;
function useRealPool(f: Fixture) {
  const calls = { fetches: 0, digests: 0, hashedBytes: 0, created: [] as string[], revoked: [] as string[] };
  const pool = createOriginalCourseMediaPool({
    origin: HOST_MEDIA_ORIGIN,
    fetch: async () => { calls.fetches++; return { ok: true, status: 200, url: HOST_MEDIA_ORIGIN+NPS_PLAYBACK_MEDIA.playbackVariant.url, redirected:false, type:'basic' as const, headers:new Headers({'Content-Type':'video/mp4'}), blob: async () => source }; },
    digest: async bytes => { calls.digests++; calls.hashedBytes += bytes.byteLength; return webcrypto.subtle.digest('SHA-256', bytes); },
    createObjectURL: () => { const url = `blob:production-nps-${calls.created.length + 1}`; calls.created.push(url); return url; },
    revokeObjectURL: url => calls.revoked.push(url),
  }, NPS_PLAYBACK_MEDIA);
  const duration = (url: string) => url.startsWith('blob:production-nps-') ? NPS_COURSE_MEDIA.durationSeconds : 72;
  f.video.durationForSource = duration;
  const create = f.ctx.document.createElement;
  f.ctx.document.createElement = (name: string) => { const video = create(name); video.durationForSource = duration; return video; };
  f.ctx.npsMediaPool = pool;
  return { pool, calls };
}

test('actual Host and production pool hand off the registered lossless NPS representation with one fetch/hash and one live URL', async t => {
  const f = await setup(t, { courseSources: true }), { calls } = useRealPool(f);
  await f.ctx.startBuiltinPractice(NPS_MATERIAL);
  assert.equal(calls.fetches, 1); assert.equal(calls.digests, 1); assert.equal(calls.hashedBytes, 19581425);
  assert.equal(calls.created.length, 1); assert.deepEqual(calls.revoked, []);
  assert.equal(f.video.src, calls.created[0]); assert.equal(f.ctx.originalMediaLease.current.actualSha256, NPS_PLAYBACK_MEDIA.playbackVariant.mediaSha256);
  assert.equal(f.ctx.currentCorrectedMediaError(), null); assert.equal(f.ctx.builtinMediaReady, true);
  assert.equal(f.video.plays, 0); assert.ok(f.auxiliary.every(video => video.plays === 0));
  f.ctx.releaseOriginalMedia(); assert.deepEqual(calls.revoked, calls.created);
});

test('verification-only callers never retain the temporary playback bytes or URL', async t => {
  const f = await setup(t, { courseSources: true }), { calls } = useRealPool(f);
  const target = await f.ctx.verifyReviewMedia(NPS_MATERIAL, NPS_MATERIAL.cues[0].id);
  assert.equal(target.media.sha256, NPS_COURSE_MEDIA.mediaSha256);
  assert.equal(calls.fetches, 1); assert.deepEqual(calls.revoked, calls.created);
  assert.equal(f.ctx.originalMediaLease.current, null); assert.equal(f.engine.getSnapshot().material.id, 'cafe-original');
});

for (const interruption of ['cancel', 'hidden', 'recording', 'dispose'] as const) test(`prepared NPS lease is released after ${interruption} before the new-session boundary`, async t => {
  const f = await setup(t, { courseSources: true }), old = learning(f.engine.getSnapshot()), { calls } = useRealPool(f);
  const flush = f.ctx.flushReferenceTransition;
  f.ctx.flushReferenceTransition = async (options: unknown) => {
    const boundary = await flush(options);
    assert.equal(calls.created.length, 1); assert.equal(calls.revoked.length, 0);
    if (interruption === 'cancel') f.ctx.cancelCourseSelection();
    else if (interruption === 'hidden') f.ctx.document.hidden = true;
    else if (interruption === 'recording') f.ctx.recordPreparing.current = true;
    else f.ctx.disposed.current = true;
    return boundary;
  };
  await assert.rejects(f.ctx.startBuiltinPractice(NPS_MATERIAL));
  assert.deepEqual(learning(f.engine.getSnapshot()), old); assert.deepEqual(calls.revoked, calls.created);
  assert.equal(f.trace.includes('engine.start'), false); assert.equal(f.video.src, ''); assert.equal(f.video.plays, 0);
});

test('main decoder failure is retryable from actual Play without a new round, second download in the failed transition, or source fallback', async t => {
  const f = await setup(t, { courseSources: true }), old = f.engine.getSnapshot(), { calls } = useRealPool(f), held = gate(); t.after(held.resolve);
  f.video.metadataGate = held;
  const work = f.ctx.startBuiltinPractice(NPS_MATERIAL); work.catch(() => {});
  await until(() => f.ctx.courseSwitchRef.current?.committed && f.video.src === calls.created[0], 'main NPS metadata waiting');
  f.video.fail(); await assert.rejects(work, /lesson; MEDIA_3/);
  const failed = f.engine.getSnapshot();
  assert.equal(calls.fetches, 1); assert.deepEqual(calls.revoked, calls.created);
  assert.equal(f.ctx.restoreFailedRef.current, false); assert.equal(f.ctx.restoreFailed, false); assert.equal(f.ctx.builtinAnswerBlocked(), true);
  assert.equal(f.ctx.visualRef.current.message, '视频暂不可用，请重新加载');
  f.input('blocked until fixed-source reload'); f.ctx.submit(); assert.deepEqual(f.engine.getSnapshot(), failed);
  f.video.metadataGate = null; held.resolve(); f.ctx.togglePlay();
  await until(() => f.ctx.builtinMediaReady && !f.ctx.courseError, 'Play-triggered fixed-source retry');
  assert.equal(f.engine.getSnapshot().sessionId, failed.sessionId); assert.equal(f.video.plays, 0);
  assert.equal(calls.fetches, 2); assert.equal(calls.digests, 2); assert.equal(f.video.src, calls.created[1]);
  assert.equal(f.ctx.builtinAnswerBlocked(), false); assert.equal(f.ctx.visualRef.current.message, '');
  assert.deepEqual((await f.repo.loadHistorySession(old.sessionId))!.snapshot, old);
  assert.equal(f.trace.filter(item => item === 'engine.start').length, 1);
  assert.equal(f.video.sources.some(url => url.startsWith('/studio-assets/') || url.includes('cafe')), false);
  f.ctx.closePanel(); f.ctx.togglePlay(); await tick(); assert.equal(f.video.plays, 1);
});

test('same verified NPS bytes allow submillisecond detached/main metadata precision without changing a saved target', async t => {
  const f = await setup(t, { courseSources: true });
  f.video.durationForSource = () => NPS_COURSE_MEDIA.durationSeconds + .000001;
  await f.ctx.startBuiltinPractice(NPS_MATERIAL);
  assert.equal(f.ctx.currentCorrectedMediaError(), null);
  const target = await f.ctx.verifyReviewMedia(NPS_MATERIAL, NPS_MATERIAL.cues[0].id), saved = JSON.stringify(target);
  f.setNpsDuration(NPS_COURSE_MEDIA.durationSeconds + .000001);
  const measured = await f.ctx.verifyReviewMedia(NPS_MATERIAL, NPS_MATERIAL.cues[0].id, target);
  assert.equal(fixedReviewTargetMatches(measured, target), true); assert.equal(JSON.stringify(target), saved);
  assert.equal(fixedReviewDurationMatches(target, NPS_COURSE_MEDIA.durationSeconds + .0011), false);
  assert.equal(fixedReviewDurationMatches(target, 43.3659), false); // Still inside 1 ms, but below the final actual cue end.
  assert.equal(fixedReviewDurationMatches({ ...target, media: { ...target.media, sha256: '0'.repeat(64) } }, measured.media.durationSeconds), false);
  assert.equal(fixedReviewTargetMatches({ ...measured, cueId: NPS_MATERIAL.cues[1].id }, target), false);
  assert.equal(fixedReviewDurationMatches(f.task.target, f.task.target.media.durationSeconds + .000001), false);
});

test('NPS declared tolerance never admits a video shorter than a registered cue, even while verifying the first cue', async t => {
  const f = await setup(t, { courseSources: true }), old = learning(f.engine.getSnapshot());
  f.setNpsDuration(43.3659);
  await assert.rejects(f.ctx.startBuiltinPractice(NPS_MATERIAL), /时长或句子边界/);
  assert.deepEqual(learning(f.engine.getSnapshot()), old); assert.equal(f.npsReleased, f.npsAcquired);
});
