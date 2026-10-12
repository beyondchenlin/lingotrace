import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CAFE_MATERIAL, TrainingEngine } from './training';
import { NPS_MATERIAL, NPS_COURSE_MEDIA } from './builtin-material';
import { NPS_PLAYBACK_MEDIA } from '../media/nps-playback';
import { IndexedDBTrainingRepository } from './repository';
import { readTrainingHistoryBootstrap } from './training-history-bootstrap';
import { exportStudioSession } from './session-export';
import { flushReferenceTransition } from './reference-transition';
import { setup, gate, until, tick, learning, reveals, due, nextDue } from './studio-host-test-fixture';

// Browser media is synthetic, but selection, all transition guards, Training,
// the permission recorder, review association and IndexedDB are the real code.
const fixture = (t: TestContext) => setup(t, { courseSources: true });
type Fixture = Awaited<ReturnType<typeof fixture>>;
function elements(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...elements(tree.props?.children)];
}
function button(f: Fixture, label: string) {
  const found = elements(f.ctx.renderMediaPanel()).find(node => node.type === 'button' && node.props.children === label);
  assert.ok(found, `Find the actual course button: ${label}`); return found.props;
}
const snapshotBytes = (f: Fixture) => JSON.stringify(f.engine.getSnapshot());
async function npsTask(f: Fixture, cueIndex = 7) {
  f.ctx.changeCue(cueIndex); f.input('a genuine source answer'); f.ctx.submit(); f.engine.setFrozen('idle', true);
  await f.ctx.saveReviewTask(NPS_MATERIAL.cues[cueIndex].id, due, 'nps-source-task');
  return (await f.repo.listReviewTasks()).entries.find(task => task.target.material.id === NPS_MATERIAL.id)!;
}
function hidden(f: Fixture) {
  assert.equal(f.ctx.showSubtitle, false); assert.equal(reveals(f.ctx.engineRef.current.getSnapshot()).length, 0);
  assert.equal(f.video.plays, 0); assert.ok(f.auxiliary.every(video => video.plays === 0));
}
async function segments(f: Fixture) {
  return Promise.all((await f.repo.listTrainingHistorySegments()).entries.map(entry => f.repo.loadTrainingHistorySegment(entry.segmentId)));
}

// Exercise JSX click handlers as well as the explicit course-switch command.
test('actual chooser selection/cancel is metadata-only and preserves the old coffee round and media', async t => {
  const f = await fixture(t); await f.ctx.openPanel('media');
  const old = snapshotBytes(f), stored = await f.repo.loadHistorySession(f.engine.getSnapshot().sessionId);
  const initial = renderToStaticMarkup(f.ctx.renderMediaPanel());
  for (const cue of NPS_MATERIAL.cues) assert.equal(initial.includes(cue.text), false);
  button(f, 'NPS 真人英语 · 43 秒 / 11 句').onClick();
  assert.equal(f.ctx.courseChoice, 'nps'); assert.equal(snapshotBytes(f), old); assert.equal(f.npsAcquired, 0);
  const selected = renderToStaticMarkup(f.ctx.renderMediaPanel());
  assert.match(selected, /结束当前轮/); assert.match(selected, /参考显示遵循你的/); assert.match(selected, /展示参考计入辅助练习/); assert.match(selected, /选择课程不会自动播放/);
  for (const cue of NPS_MATERIAL.cues) assert.equal(selected.includes(cue.text), false);
  button(f, '取消选材').onClick();
  assert.equal(f.ctx.courseChoice, null); assert.equal(snapshotBytes(f), old); assert.equal(f.npsAcquired, 0);
  assert.deepEqual(await f.repo.loadHistorySession(f.engine.getSnapshot().sessionId), stored); hidden(f);
});

test('actual cancel during NPS verification retains the complete old round and releases late media', async t => {
  const f = await fixture(t), held = gate(); t.after(held.resolve);
  await f.ctx.loadReviewMaterial(f.task.target); const source = f.video.src, old = snapshotBytes(f);
  const stored = await f.repo.loadHistorySession(f.engine.getSnapshot().sessionId); f.setNpsAcquireGate(held);
  const work = f.ctx.startBuiltinPractice(NPS_MATERIAL); work.catch(() => {});
  await until(() => f.npsAcquired === 1, 'pending NPS verification');
  assert.equal(f.ctx.referenceBlocked(), true); f.ctx.cancelCourseSelection();
  held.resolve(); await assert.rejects(work); await tick();
  assert.equal(snapshotBytes(f), old); assert.equal(f.video.src, source); assert.equal(f.npsAcquired, f.npsReleased);
  assert.deepEqual(await f.repo.loadHistorySession(f.engine.getSnapshot().sessionId), stored);
  assert.equal(f.ctx.referenceBlocked(), false); assert.equal(f.ctx.courseChoice, null); assert.equal(f.trace.includes('engine.start'), false); hidden(f);
});

for (const [label, patch] of [
  ['unverified lease', { verified: false }], ['actual SHA mismatch', { actualSha256: '0'.repeat(64) }],
  ['declared SHA mismatch', { mediaSha256: '0'.repeat(64) }], ['coffee media identity', { mediaId: 'lingotrace-original-cafe-video-v1' }],
] as const) test(`actual failed NPS ${label} cannot reset or expose the old round`, async t => {
  const f = await fixture(t), old = snapshotBytes(f), stored = await f.repo.loadHistorySession(f.engine.getSnapshot().sessionId);
  f.setNpsLease(patch); await assert.rejects(f.ctx.startBuiltinPractice(NPS_MATERIAL));
  assert.equal(snapshotBytes(f), old); assert.deepEqual(await f.repo.loadHistorySession(f.engine.getSnapshot().sessionId), stored);
  assert.equal(f.trace.includes('engine.start'), false); assert.equal(f.npsAcquired, f.npsReleased);
  assert.equal(f.ctx.referenceBusy, false); assert.equal(f.ctx.referenceBlocked(), false); assert.ok(f.ctx.courseError); hidden(f);
});

for (const fault of ['old CAS', 'privacy flip', 'new tail'] as const) test(`actual NPS ${fault} at the boundary preserves the old round instead of starting a new one`, async t => {
  const f = await fixture(t), old = f.engine.getSnapshot(), oldAttempt = JSON.stringify(old.attempts);
  if (fault === 'old CAS') {
    const peer = new IndexedDBTrainingRepository({ indexedDB: f.factory, dbName: f.dbName }); t.after(() => peer.close());
    const peerEngine = new TrainingEngine({ snapshot: old }); peerEngine.input('peer saved draft'); await peer.saveSession(peerEngine.getSnapshot());
    f.input('this page unsaved draft');
  } else if (fault === 'privacy flip') {
    const flush = f.history.flush.bind(f.history); f.history.flush = async () => {
      await flush(); await f.repo.disableAutomaticHistory(0);
    };
  } else {
    f.ctx.flushReferenceTransition = async (options: Parameters<typeof flushReferenceTransition>[0]) => {
      const boundary = await flushReferenceTransition(options); f.engine.input('microtask tail survives'); return boundary;
    };
  }
  await assert.rejects(f.ctx.startBuiltinPractice(NPS_MATERIAL));
  assert.equal(f.engine.getSnapshot().sessionId, old.sessionId); assert.equal(JSON.stringify(f.engine.getSnapshot().attempts), oldAttempt);
  assert.deepEqual(f.engine.getSnapshot().material, CAFE_MATERIAL); assert.equal(f.trace.includes('engine.start'), false); hidden(f);
  if (fault === 'old CAS') {
    assert.equal(f.engine.draft, 'this page unsaved draft'); assert.match(f.history.getSnapshot().error!, /尚未保存/);
    assert.equal((await f.repo.loadHistorySession(old.sessionId))!.snapshot.drafts[f.engine.cue.id].text, 'peer saved draft');
  } else if (fault === 'privacy flip') assert.equal((await f.repo.readAutomaticHistoryControl()).state, 'segment-off');
  else assert.equal(f.engine.draft, 'microtask tail survives');
});

test('actual explicit NPS start loads NPS media, retains 11 exact cue references and leaves old attempts byte-identical', async t => {
  const f = await fixture(t), old = f.engine.getSnapshot(), oldExport = exportStudioSession(old, old.createdAt);
  await f.ctx.openPanel('media'); button(f, 'NPS 真人英语 · 43 秒 / 11 句').onClick();
  button(f, '结束当前轮，使用此课程新开练习').onClick({nativeEvent:{isTrusted:true}});
  await until(() => f.engine.getSnapshot().material.id === NPS_MATERIAL.id && !f.ctx.referenceBusy, 'explicit NPS start completed');
  const fresh = f.engine.getSnapshot();
  assert.notEqual(fresh.sessionId, old.sessionId); assert.deepEqual(fresh.material, NPS_MATERIAL);
  assert.equal(fresh.cueIndex, 0); assert.equal(fresh.attempts.length, 0); assert.equal(fresh.earnedWords, 0); assert.equal(f.engine.draft, '');
  assert.equal(f.video.src, 'blob:review-verified-nps'); assert.equal(f.video.currentSrc, f.video.src);
  assert.equal(f.ctx.originalMediaLease.current.mediaId, NPS_COURSE_MEDIA.mediaId);
  assert.equal(f.ctx.originalMediaLease.current.actualSha256, NPS_PLAYBACK_MEDIA.playbackVariant.mediaSha256);
  assert.equal(f.video.duration, NPS_COURSE_MEDIA.durationSeconds); assert.equal(f.video.currentTime, .77);
  assert.equal(f.ctx.builtinMediaReady, true); assert.equal(f.ctx.bookmarkMediaReady, false); assert.equal(f.ctx.mediaRef.current.poster.src, '');
  assert.equal(f.ctx.currentCorrectedMediaError(), null); assert.equal(f.ctx.panel, null); hidden(f);
  assert.ok(f.trace.indexOf('history.flush.end') < f.trace.indexOf('engine.start'));
  assert.deepEqual((await f.repo.loadHistorySession(old.sessionId))!.snapshot, old);
  assert.equal(exportStudioSession(old, old.createdAt).json, oldExport.json); assert.equal(exportStudioSession(old, old.createdAt).csv, oldExport.csv);
  await f.ctx.openPanel('media'); const html = renderToStaticMarkup(f.ctx.renderMediaPanel());
  assert.equal((html.match(/class="cue-grid">([\s\S]*?)<\/div>/)?.[1].match(/<button/g) ?? []).length, 11);
  for (const cue of NPS_MATERIAL.cues) assert.equal(html.includes(cue.text), false);
  assert.match(html, /未作逐句人工听校/); f.ctx.closePanel();
  for (let index = 0; index < NPS_MATERIAL.cues.length; index++) {
    const cue = NPS_MATERIAL.cues[index]; f.ctx.changeCue(index); assert.equal(f.video.currentTime, cue.start);
    f.input(cue.text); f.ctx.submit(); const attempt = f.engine.getSnapshot().attempts.at(-1)!;
    assert.equal(attempt.cueId, cue.id); assert.equal(attempt.reference, cue.text); assert.equal(attempt.errors, 0);
    assert.equal(attempt.conditions.revealed, false); assert.equal(attempt.conditions.hinted, false);
  }
  assert.equal(f.engine.getSnapshot().completedCueIds.length, 11); assert.equal(f.engine.getSnapshot().attempts.length, 11); hidden(f);
  const finished = f.engine.getSnapshot(); f.ctx.submit();
  assert.equal(f.engine.getSnapshot().cueIndex, 0); assert.deepEqual(f.engine.getSnapshot().attempts, finished.attempts);
  assert.equal(f.engine.getSnapshot().earnedWords, finished.earnedWords);
  await f.ctx.openPanel('data'); const exported = f.ctx.exportRef.current;
  assert.deepEqual(JSON.parse(exported.json).session.material, NPS_MATERIAL);
  assert.equal(JSON.parse(exported.json).session.attempts.length, 11); assert.ok(exported.csv.includes(NPS_COURSE_MEDIA.mediaSha256));
  assert.deepEqual((await f.repo.loadHistorySession(old.sessionId))!.snapshot.attempts, old.attempts);
});

test('actual NPS new-round action repeats verified preparation and keeps the old NPS round immutable', async t => {
  const f = await fixture(t); await f.ctx.startBuiltinPractice(NPS_MATERIAL);
  f.input(f.engine.cue.text); f.ctx.submit(); f.engine.setFrozen('idle', true); await f.history.flush();
  const old = f.engine.getSnapshot(), acquired = f.npsAcquired;
  await f.ctx.beginNewRound(); const fresh = f.engine.getSnapshot();
  assert.notEqual(fresh.sessionId, old.sessionId); assert.deepEqual(fresh.material, old.material);
  assert.equal(fresh.attempts.length, 0); assert.equal(f.npsAcquired, acquired + 2); assert.equal(f.ctx.currentCorrectedMediaError(), null);
  assert.equal(f.video.currentTime, .77); assert.deepEqual((await f.repo.loadHistorySession(old.sessionId))!.snapshot, old); hidden(f);
  const beforeFailure = f.engine.getSnapshot(); f.setNpsLease({ actualSha256: '0'.repeat(64) });
  await f.ctx.beginNewRound(); assert.deepEqual(learning(f.engine.getSnapshot()), learning(beforeFailure));
  assert.ok(f.ctx.courseError); hidden(f);
});

test('actual NPS source → nonfirst-cue retest → winner/export/restore preserves fixed source identity and hidden reference', async t => {
  const f = await fixture(t); await f.ctx.startBuiltinPractice(NPS_MATERIAL);
  const task = await npsTask(f), source = f.engine.getSnapshot(); assert.ok(task);
  assert.deepEqual(task.target.material, NPS_MATERIAL); assert.equal(task.target.media.id, NPS_COURSE_MEDIA.mediaId);
  assert.equal(task.target.media.sha256, NPS_COURSE_MEDIA.mediaSha256); assert.equal(task.target.cueId, NPS_MATERIAL.cues[7].id);
  assert.equal(task.source.attemptId, source.attempts[0].attemptId); assert.equal(source.attempts[0].materialVersion, NPS_MATERIAL.version);
  const fixedTarget = JSON.stringify(task.target), coffeeTask = JSON.stringify(await f.repo.exportReviewTask(f.task.taskId));
  await f.ctx.startReviewTask({ taskId: task.taskId, revision: task.revision }, nextDue);
  const retest = f.engine.getSnapshot(), binding = f.ctx.reviewBindingRef.current;
  assert.notEqual(retest.sessionId, source.sessionId); assert.equal(retest.cueIndex, 7); assert.equal(f.video.currentTime, NPS_MATERIAL.cues[7].start);
  assert.deepEqual(retest.material, NPS_MATERIAL); assert.equal(retest.attempts.length, 0); assert.equal(binding.cueId, task.target.cueId); hidden(f);
  f.input('a real incorrect retest'); f.ctx.submit(); await f.settle();
  const attempt = f.engine.getSnapshot().attempts[0]; assert.ok(attempt.errors > 0); assert.equal(attempt.conditions.revealed, false);
  const exported = await f.repo.exportReviewTask(task.taskId);
  assert.equal(exported.relations.length, 1); assert.equal(exported.relations[0].source.attemptId, attempt.attemptId);
  assert.equal(exported.relations[0].instanceId, binding.instanceId); assert.equal(exported.relations[0].disposition, 'winner');
  assert.equal(JSON.stringify(exported.task.target), fixedTarget); assert.deepEqual(exported.task.due, nextDue);
  assert.equal(JSON.stringify(await f.repo.exportReviewTask(f.task.taskId)), coffeeTask);
  assert.deepEqual((await f.repo.loadHistorySession(source.sessionId))!.snapshot, source);
  const restored = await f.restore(), before = JSON.stringify(restored.engine.getSnapshot());
  await f.ctx.loadDemo(); await f.ctx.restoreSavedReviewBinding(restored.snapshot);
  assert.equal(JSON.stringify(restored.engine.getSnapshot()), before); assert.equal(restored.engine.isPassiveRestored, true);
  assert.equal(f.ctx.reviewBindingRef.current.instanceId, binding.instanceId); assert.equal(f.ctx.currentCorrectedMediaError(), null);
  assert.equal(f.video.currentTime, NPS_MATERIAL.cues[7].start); assert.equal(f.ctx.reviewPendingRef.current.size, 0); hidden(f);
  assert.equal((await restored.repo.exportReviewTask(task.taskId)).relations.length, 1);
  await f.ctx.openPanel('data'); assert.deepEqual(JSON.parse(f.ctx.exportRef.current.json).session.material, NPS_MATERIAL);
  assert.equal(JSON.stringify(restored.engine.getSnapshot()), before);
});

test('actual OFF NPS selection stays temporary and later ON/refresh never resurrects its private answer', async t => {
  const f = await fixture(t); await f.ctx.changeHistoryRecording(false);
  const oldHistory = await f.repo.loadHistorySession(f.engine.getSnapshot().sessionId);
  await f.ctx.startBuiltinPractice(NPS_MATERIAL); assert.equal(f.history.getSnapshot().mode, 'off'); assert.equal(f.ctx.temporary, true); hidden(f);
  f.input('PRIVATE_NPS_OFF_ANSWER'); f.ctx.submit(); const privateSnapshot = f.engine.getSnapshot();
  assert.equal(await f.repo.loadHistorySession(privateSnapshot.sessionId), null); assert.equal((await segments(f)).length, 0);
  await assert.rejects(f.ctx.saveReviewTask(f.engine.cue.id, due, 'off-nps-source'), /尚未保存|临时答案/);
  const off = await readTrainingHistoryBootstrap(f.repo); assert.equal(off.saved, null); assert.equal(off.temporary, true);
  assert.equal(JSON.parse(exportStudioSession(privateSnapshot).json).session.attempts[0].answer, 'PRIVATE_NPS_OFF_ANSWER');
  await f.ctx.changeHistoryRecording(true); assert.equal(f.history.getSnapshot().mode, 'segment');
  f.ctx.inputRef.current.value = ''; f.ctx.inputHandler({ currentTarget: f.ctx.inputRef.current, nativeEvent: { inputType: 'deleteContentBackward', data: null } });
  f.input('recorded after explicit ON'); f.ctx.submit(); await f.history.flush();
  const savedSegments = await segments(f); assert.equal(savedSegments.length, 1);
  assert.equal(JSON.stringify(savedSegments).includes('PRIVATE_NPS_OFF_ANSWER'), false);
  assert.equal(JSON.stringify(savedSegments).includes(privateSnapshot.attempts[0].attemptId), false);
  assert.ok(JSON.stringify(savedSegments).includes('recorded after explicit ON'));
  assert.deepEqual(await f.repo.loadHistorySession(oldHistory!.snapshot.sessionId), oldHistory);
  let latestReads = 0; const bootstrap = await readTrainingHistoryBootstrap({ readAutomaticHistoryControl: f.repo.readAutomaticHistoryControl.bind(f.repo), loadLatest: async () => { latestReads++; return privateSnapshot; } });
  assert.equal(bootstrap.saved, null); assert.equal(latestReads, 0);
  assert.equal(await f.repo.loadHistorySession(privateSnapshot.sessionId), null); assert.equal((await f.repo.listReviewTasks()).entries.length, 1);
});

test('actual partial NPS retest uses only admitted facts and cannot restore a full training session or advance after OFF', async t => {
  const f = await fixture(t); await f.ctx.changeHistoryRecording(false); await f.ctx.changeHistoryRecording(true);
  await f.ctx.startBuiltinPractice(NPS_MATERIAL); assert.equal(f.history.getSnapshot().mode, 'segment');
  const task = await npsTask(f, 10); assert.equal(task.source.kind, 'partial');
  await f.ctx.startReviewTask({ taskId: task.taskId, revision: task.revision }, nextDue);
  const binding = f.ctx.reviewBindingRef.current; assert.equal(binding.session.kind, 'partial'); hidden(f);
  f.input('partial genuine NPS retest'); f.ctx.submit(); await f.settle();
  const result = f.engine.getSnapshot().attempts[0], exported = await f.repo.exportReviewTask(task.taskId);
  assert.equal(exported.relations.length, 1); assert.equal(exported.relations[0].source.kind, 'partial');
  assert.equal(exported.relations[0].source.attemptId, result.attemptId);
  assert.equal(exported.evidence.find(e => e.source.attemptId === result.attemptId)!.coverage, 'partial');
  assert.equal(await f.repo.loadHistorySession(result.sessionId), null);
  const segment = (await f.repo.loadTrainingHistorySegment(binding.session.segmentId))!;
  assert.equal(segment.replayable, false); assert.equal(segment.coverage, 'partial');
  assert.equal(segment.material.id, NPS_MATERIAL.id); assert.equal(segment.material.version, NPS_MATERIAL.version);
  const bootstrap = await readTrainingHistoryBootstrap(f.repo); assert.equal(bootstrap.saved, null);
  const before = f.engine.getSnapshot(); let bindingReads = 0;
  f.repo.restoreReviewSessionBinding = async () => { bindingReads++; throw Error('Partial history must never restore a full binding'); };
  await f.ctx.restoreSavedReviewBinding(before); assert.equal(bindingReads, 0); assert.deepEqual(f.engine.getSnapshot(), before);
  await f.ctx.changeHistoryRecording(false); f.input('PRIVATE_NPS_OFF_RETEST'); f.ctx.submit();
  await f.ctx.changeHistoryRecording(true); await f.ctx.flushReviewResults(); await f.history.flush();
  assert.equal(f.ctx.reviewBindingRef.current, null); assert.equal(f.ctx.reviewPendingRef.current.size, 0);
  assert.equal((await f.repo.exportReviewTask(task.taskId)).relations.length, 1);
  assert.equal(JSON.stringify(await segments(f)).includes('PRIVATE_NPS_OFF_RETEST'), false);
});

test('actual wrong NPS decoder duration fails before resetting the old coffee round', async t => {
  const f = await fixture(t), old = snapshotBytes(f), stored = await f.repo.loadHistorySession(f.engine.getSnapshot().sessionId);
  f.setNpsDuration(72); await assert.rejects(f.ctx.startBuiltinPractice(NPS_MATERIAL), /时长/);
  assert.equal(snapshotBytes(f), old); assert.equal(f.trace.includes('engine.start'), false);
  assert.deepEqual(await f.repo.loadHistorySession(f.engine.getSnapshot().sessionId), stored);
  assert.equal(f.npsAcquired, f.npsReleased); assert.equal(f.video.src, ''); hidden(f);
});

test('actual runtime NPS decoder error fails closed, preserves Training and reloads only through explicit fixed-source verification', async t => {
  const f = await fixture(t); await f.ctx.startBuiltinPractice(NPS_MATERIAL);
  f.input('retained NPS draft'); f.engine.setFrozen('idle', true); await f.history.flush();
  const before = snapshotBytes(f), acquired = f.npsAcquired;
  f.video.fail();
  assert.equal(snapshotBytes(f), before); assert.equal(f.ctx.builtinMediaReady, false); assert.equal(f.ctx.visualRef.current.ready, false);
  assert.equal(f.ctx.mediaDuration, 0); assert.equal(f.video.src, ''); assert.equal(f.video.currentSrc, '');
  assert.equal(f.ctx.originalMediaLease.current, null); assert.equal(f.ctx.reviewMediaRef.current, null);
  assert.ok(f.ctx.courseError); assert.ok(f.ctx.currentCorrectedMediaError()); assert.equal(f.npsAcquired, acquired);
  assert.equal(f.video.sources.includes('/studio-assets/06-cafe.mp4'), false); assert.equal(f.npsReleased, f.npsAcquired);
  f.input('late rejected decoder-failed answer'); f.ctx.submit(); f.ctx.reveal();
  assert.equal(snapshotBytes(f), before); assert.equal(f.ctx.inputRef.current.value, f.engine.draft); assert.equal(f.ctx.showSubtitle, false);
  await f.ctx.loadDemo();
  assert.equal(f.npsAcquired, acquired + 2); assert.equal(f.ctx.currentCorrectedMediaError(), null);
  assert.equal(f.video.src, 'blob:review-verified-nps'); assert.equal(f.ctx.courseError, ''); assert.equal(f.ctx.builtinMediaReady, true);
  assert.equal(snapshotBytes(f), before); hidden(f);
});

test('actual background cancellation during NPS verification retains old learning and refuses a late source', async t => {
  const f = await fixture(t), old = f.engine.getSnapshot(), held = gate(); t.after(held.resolve); f.setNpsAcquireGate(held);
  const work = f.ctx.startBuiltinPractice(NPS_MATERIAL); work.catch(() => {});
  await until(() => f.npsAcquired === 1, 'background verification gate'); f.ctx.document.hidden = true; f.ctx.visibility();
  held.resolve(); await assert.rejects(work); await tick();
  assert.deepEqual(learning(f.engine.getSnapshot()), learning(old)); assert.equal(f.trace.includes('engine.start'), false);
  assert.equal(f.ctx.reviewVerificationRef.current, null); assert.equal(f.npsAcquired, f.npsReleased); assert.equal(f.video.src, ''); hidden(f);
});

test('actual return to original coffee uses its source and retains prior NPS attempts and fixed export', async t => {
  const f = await fixture(t); await f.ctx.startBuiltinPractice(NPS_MATERIAL);
  f.input(f.engine.cue.text); f.ctx.submit(); f.engine.setFrozen('idle', true); await f.history.flush();
  const old = f.engine.getSnapshot(), exported = exportStudioSession(old, old.createdAt);
  await f.ctx.startBuiltinPractice(CAFE_MATERIAL);
  assert.deepEqual(f.engine.getSnapshot().material, CAFE_MATERIAL); assert.equal(f.engine.getSnapshot().material.cues.length, 12);
  assert.equal(f.video.src, 'blob:review-verified-original'); assert.equal(f.video.duration, 72);
  assert.equal(f.ctx.mediaRef.current.poster.src, '/studio-assets/06-cafe-poster.jpg'); assert.equal(f.ctx.builtinMediaReady, false);
  assert.deepEqual((await f.repo.loadHistorySession(old.sessionId))!.snapshot, old);
  assert.equal(exportStudioSession(old, old.createdAt).json, exported.json); assert.equal(exportStudioSession(old, old.createdAt).csv, exported.csv); hidden(f);
});

for (const fault of ['actual lesson hash', 'actual lesson duration'] as const) test(`actual post-commit NPS ${fault} failure blocks answers but explicit reload retains the same new round`, async t => {
  const f = await fixture(t), old = f.engine.getSnapshot(); let faultActive = true;
  if (fault === 'actual lesson hash') {
    // The new handoff reserves the lesson lease before the commit. Inject the
    // source discrepancy at consumption, not at a now-removed second download.
    const acquire = f.ctx.npsMediaPool.acquire;
    f.ctx.npsMediaPool.acquire = async (...args: unknown[]) => {
      const lease = await acquire(...args);
      return { ...lease, get actualSha256() { return faultActive && f.engine.getSnapshot().material.id === NPS_MATERIAL.id ? '0'.repeat(64) : lease.actualSha256; } };
    };
  } else f.video.durationForSource = () => faultActive ? 72 : NPS_COURSE_MEDIA.durationSeconds;
  await assert.rejects(f.ctx.startBuiltinPractice(NPS_MATERIAL), /哈希|时长/);
  const fresh = f.engine.getSnapshot(); assert.notEqual(fresh.sessionId, old.sessionId); assert.deepEqual(fresh.material, NPS_MATERIAL);
  assert.deepEqual((await f.repo.loadHistorySession(old.sessionId))!.snapshot, old);
  assert.equal(f.ctx.restoreFailedRef.current, false); assert.equal(f.ctx.restoreFailed, false); assert.ok(f.ctx.courseError);
  assert.equal(f.ctx.referenceBusy, false); assert.equal(f.ctx.courseSwitchRef.current, null); assert.equal(f.ctx.referenceTransitionRef.current, false);
  assert.equal(f.ctx.builtinMediaReady, false); assert.equal(f.ctx.visualRef.current.ready, false); assert.equal(f.ctx.mediaDuration, 0);
  assert.equal(f.ctx.visualRef.current.message, '视频暂不可用，请重新加载');
  assert.equal(f.video.src, ''); assert.equal(f.ctx.originalMediaLease.current, null); assert.equal(f.npsReleased, f.npsAcquired);
  f.input('must not enter the failed new course'); f.ctx.submit(); f.ctx.reveal(); assert.deepEqual(f.engine.getSnapshot(), fresh);
  faultActive = false; await f.ctx.loadDemo();
  assert.equal(f.engine.getSnapshot().sessionId, fresh.sessionId); assert.equal(f.ctx.currentCorrectedMediaError(), null);
  assert.equal(f.ctx.courseError, ''); assert.equal(f.ctx.builtinMediaReady, true); assert.equal(f.ctx.visualRef.current.message, '');
  assert.deepEqual((await f.repo.loadHistorySession(old.sessionId))!.snapshot, old);
  assert.equal(f.trace.filter(value => value === 'engine.start').length, 1); assert.equal(f.video.sources.includes('/studio-assets/06-cafe.mp4'), false); hidden(f);
});

test('actual cancellation after NPS commit cannot discard the new round and preparation settles without a duplicate reset', async t => {
  const f = await fixture(t), old = f.engine.getSnapshot(), held = gate(); t.after(held.resolve); f.video.metadataGate = held;
  const work = f.ctx.startBuiltinPractice(NPS_MATERIAL); work.catch(() => {});
  await until(() => f.ctx.courseSwitchRef.current?.committed && f.video.src === 'blob:review-verified-nps', 'committed course awaiting main metadata');
  const committed = f.engine.getSnapshot(); assert.notEqual(committed.sessionId, old.sessionId);
  f.ctx.cancelCourseSelection(); assert.equal(f.ctx.courseSwitchRef.current.committed, true); assert.equal(f.ctx.referenceBusy, true);
  assert.equal(f.ctx.referenceBlocked(), true); f.input('locked during preparation'); f.ctx.submit(); f.ctx.closePanel();
  assert.deepEqual(f.engine.getSnapshot(), committed); await assert.rejects(f.ctx.startBuiltinPractice(NPS_MATERIAL), /当前状态/);
  held.resolve(); await work;
  assert.equal(f.ctx.referenceBusy, false); assert.equal(f.ctx.courseSwitchRef.current, null); assert.equal(f.ctx.referenceBlocked(), false);
  assert.equal(f.ctx.panel, null); assert.equal(f.ctx.currentCorrectedMediaError(), null); assert.equal(f.ctx.builtinMediaReady, true);
  assert.equal(f.trace.filter(value => value === 'engine.start').length, 1); assert.deepEqual((await f.repo.loadHistorySession(old.sessionId))!.snapshot, old); hidden(f);
});
