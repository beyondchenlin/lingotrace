import test from 'node:test';
import assert from 'node:assert/strict';
import { CAFE_MATERIAL } from './training';
import { flushReferenceTransition } from './reference-transition';
import { reviewAttemptSource } from './review-task-source';
import { setup, gate, until, tick, reveals, learning, due, nextDue } from './studio-host-test-fixture';

test('actual save/retry/list/cancel use a durable submitted source and create zero Training facts', async t => {
  const f = await setup(t), before = f.engine.getSnapshot(), stored = await f.repo.loadHistorySession(before.sessionId);
  assert.equal((await f.ctx.saveReviewTask(f.task.target.cueId, due, 'host-save-review')).disposition, 'already-present');
  await f.ctx.refreshReviewTasks(); assert.equal(f.ctx.reviewRows.length, 1); assert.equal(f.ctx.reviewRows[0].cueNumber, f.targetIndex + 1);
  assert.equal(JSON.stringify(f.ctx.reviewRows).includes(f.engine.cue.text), false, 'Task rows contain metadata, never the hidden answer');
  await assert.rejects(f.ctx.saveReviewTask(CAFE_MATERIAL.cues[0].id, due, 'unsubmitted'), /真实提交/);
  await f.ctx.changeReviewTask(f.row, 'cancel');
  assert.equal(f.ctx.reviewRows[0].status, 'cancelled'); assert.deepEqual(f.engine.getSnapshot(), before);
  assert.deepEqual(await f.repo.loadHistorySession(before.sessionId), stored); assert.equal((await f.repo.listReviewTasks()).entries.length, 1);
  const attempt = before.attempts[0]; assert.equal(f.task.source.attemptId, attempt.attemptId);
  assert.deepEqual(f.task.source, reviewAttemptSource(before, attempt, f.history.getCommittedReviewSession()!));
});

test('actual corrected-version retest targets task cue rather than edited cue and never reveals on launch', async t => {
  const f = await setup(t, { corrected: true }), old = f.engine.getSnapshot();
  assert.notEqual(f.task.target.cueId, f.task.target.material.localReference!.editedCueId);
  await f.start(); const next = f.engine.getSnapshot();
  assert.notEqual(next.sessionId, old.sessionId); assert.equal(next.cueIndex, f.targetIndex); assert.deepEqual(next.material, f.task.target.material);
  assert.equal(next.attempts.length, 0); assert.equal(next.earnedWords, 0); assert.equal(reveals(next).length, 0); assert.equal(f.ctx.showSubtitle, false);
  assert.equal(f.ctx.reviewBindingRef.current.cueId, f.task.target.cueId); assert.equal(f.video.currentTime, f.engine.cue.start);
  assert.ok(f.trace.indexOf('history.flush.end') < f.trace.indexOf('engine.start'));
  assert.ok(f.trace.indexOf('binding.end') < f.trace.indexOf('panel:null')); assert.equal(f.ctx.reviewBusy, false);
  assert.deepEqual((await f.repo.loadHistorySession(old.sessionId))!.snapshot, old);
  f.ctx.reveal(); const reveal = reveals(f.engine.getSnapshot())[0]; assert.equal(reveal.cueId, f.task.target.cueId); assert.equal(Object.hasOwn(reveal, 'referenceExposure'), false);
});

for (const stage of ['segment admission', 'binding'] as const) test(`actual ${stage} stays locked until admitted and durably bound`, async t => {
  const f = await setup(t); if (stage === 'segment admission') { await f.history.turnOff(); await f.history.turnOn(); }
  const held = gate(); let waiting = false;
  if (stage === 'segment admission') { const original = f.repo.beginTrainingHistorySegment.bind(f.repo); f.repo.beginTrainingHistorySegment = async (...args) => { waiting = true; await held.promise; return original(...args); }; }
  else { const original = f.repo.bindReviewSession.bind(f.repo); f.repo.bindReviewSession = async (...args) => { waiting = true; await held.promise; return original(...args); }; }
  const work = f.start(); await until(() => waiting, stage); const locked = f.engine.getSnapshot();
  assert.equal(f.ctx.reviewBindingRef.current, null); assert.equal(f.ctx.referenceBlocked(), true); assert.equal(f.ctx.panel, 'review-tasks');
  f.input('must not enter'); f.ctx.submit(); f.ctx.reveal(); f.ctx.changeCue(0); f.ctx.closePanel();
  assert.deepEqual(f.engine.getSnapshot(), locked); assert.equal(f.ctx.inputRef.current.value, f.engine.draft); assert.equal(f.ctx.showSubtitle, false);
  await assert.rejects(f.start(), /当前状态/); held.resolve(); await work;
  assert.equal(f.ctx.referenceBlocked(), false); assert.ok(f.ctx.reviewBindingRef.current); assert.equal(f.trace.filter(v => v === 'engine.start').length, 1);
  if (stage === 'segment admission') { assert.equal(f.ctx.reviewBindingRef.current.session.kind, 'partial'); assert.ok(f.trace.indexOf('permit.end') < f.trace.indexOf('binding.begin')); }
});

for (const fault of ['dirty save', 'pending write', 'new event', 'permission generation', 'plan CAS'] as const) test(`actual old-round ${fault} prevents reset and preserves the old tail`, async t => {
  const f = await setup(t), old = f.engine.getSnapshot(); let held: ReturnType<typeof gate> | null = null, pending: Promise<void> | null = null;
  if (fault === 'dirty save') { f.input('unsaved old draft'); f.repo.saveSession = async () => { throw Error('synthetic quota'); }; }
  if (fault === 'pending write') {
    held = gate(); const original = f.repo.saveSession.bind(f.repo); f.repo.saveSession = async (...args) => { await held!.promise; return original(...args); };
    f.input('pending old draft'); pending = f.history.flush(); assert.equal(f.history.getSnapshot().pendingWrites, 1);
  }
  if (fault === 'new event') { const original = f.history.flush.bind(f.history); f.history.flush = async () => { await original(); f.engine.input('late old tail'); }; }
  if (fault === 'permission generation') { const original = f.repo.prepareReviewRetest.bind(f.repo); f.repo.prepareReviewRetest = async (...args) => { const result = await original(...args); await f.repo.disableAutomaticHistory(0); return result; }; }
  if (fault === 'plan CAS') { const original = f.repo.prepareReviewRetest.bind(f.repo); f.repo.prepareReviewRetest = async (...args) => { await f.repo.changeReviewTask({ taskId: f.task.taskId, expectedRevision: f.task.revision, action: 'cancel' }); return original(...args); }; }
  await assert.rejects(f.start()); held?.resolve(); if (pending) await pending;
  assert.equal(f.engine.getSnapshot().sessionId, old.sessionId); assert.deepEqual(f.engine.getSnapshot().attempts, old.attempts); assert.equal(f.trace.includes('engine.start'), false);
  assert.equal(f.ctx.reviewBindingRef.current, null); assert.equal(f.ctx.reviewStartFailure, ''); assert.equal(f.ctx.reviewBusy, false);
  if (fault === 'new event') assert.equal(f.engine.draft, 'late old tail');
  else if (fault === 'dirty save') assert.equal(f.engine.draft, 'unsaved old draft');
  else if (fault === 'pending write') assert.equal(f.engine.draft, 'pending old draft');
});

test('actual caller rechecks its boundary after the helper promise returns and before synchronous reset', async t => {
  const f = await setup(t), old = f.engine.getSnapshot();
  // Delegate to the real boundary, then inject the environmental fact into the
  // otherwise inaccessible return-to-caller microtask. Do not replace its checks.
  f.ctx.flushReferenceTransition = async (options: Parameters<typeof flushReferenceTransition>[0]) => {
    const boundary = await flushReferenceTransition(options); f.engine.input('microtask tail'); return boundary;
  };
  await assert.rejects(f.start(), /变化/); assert.equal(f.engine.getSnapshot().sessionId, old.sessionId);
  assert.equal(f.engine.draft, 'microtask tail'); assert.equal(f.trace.includes('engine.start'), false);
});

for (const fault of ['new permit', 'binding', 'media duration'] as const) test(`actual ${fault} failure after reset requires explicit untracked fallback`, async t => {
  const f = await setup(t), oldId = f.engine.getSnapshot().sessionId;
  if (fault === 'new permit') { await f.history.turnOff(); await f.history.turnOn(); f.repo.beginTrainingHistorySegment = async () => { throw Error('synthetic new permit failure'); }; }
  if (fault === 'binding') f.repo.bindReviewSession = async () => { throw Error('synthetic binding failure'); };
  if (fault === 'media duration') f.video.duration = 71;
  await assert.rejects(f.start()); assert.notEqual(f.engine.getSnapshot().sessionId, oldId);
  assert.ok(f.ctx.reviewStartFailure); assert.equal(f.ctx.panel, 'review-tasks'); assert.equal(f.ctx.reviewBindingRef.current, null); assert.equal(f.ctx.referenceBlocked(), true);
  const locked = f.engine.getSnapshot(); f.input('blocked fallback'); f.ctx.submit(); f.ctx.reveal(); f.ctx.closePanel(); assert.deepEqual(f.engine.getSnapshot(), locked);
  f.ctx.leaveFailedReviewStart(); assert.equal(f.ctx.referenceBlocked(), false); assert.equal(f.ctx.panel, null); assert.match(f.ctx.reviewTrackingMessage, /普通练习/);
  f.input('actual temporary answer'); f.ctx.submit(); await f.settle();
  assert.equal(f.engine.getSnapshot().attempts.length, 1); assert.equal(f.ctx.reviewPendingRef.current.size, 0);
  assert.equal((await f.repo.exportReviewTask(f.task.taskId)).relations.length, 0); assert.equal((await f.repo.loadReviewTask(f.task.taskId))!.currentInstanceId, f.task.currentInstanceId);
});

test('actual submit persists its real judgment before relation; incorrect winner and later assisted correction stay on original instance', async t => {
  const f = await setup(t); await f.start(); const binding = f.ctx.reviewBindingRef.current, commit = f.repo.commitReviewResult.bind(f.repo);
  f.ctx.submit(); assert.equal(f.engine.getSnapshot().attempts.length, 0); assert.equal(f.ctx.reviewPendingRef.current.size, 0);
  f.repo.commitReviewResult = async (...args) => {
    const snapshot = (await f.repo.loadHistorySession(args[0].source.sessionId))!.snapshot;
    assert.ok(snapshot.attempts.some(a => a.attemptId === args[0].source.attemptId));
    assert.ok(snapshot.events.some(e => e.eventId === args[0].source.judgmentEventId)); return commit(...args);
  };
  f.input('wrong but real retest'); f.ctx.submit(); const wrong = f.engine.getSnapshot().attempts[0]; assert.ok(wrong.errors > 0); await f.settle();
  const won = (await f.repo.loadReviewTask(f.task.taskId))!; assert.deepEqual(won.due, nextDue); assert.notEqual(won.currentInstanceId, binding.instanceId);
  assert.equal(f.ctx.reviewBindingRef.current, binding); assert.equal((await f.repo.loadReviewInstance(binding.instanceId))!.winner!.source.attemptId, wrong.attemptId);
  f.ctx.reveal(); f.input(f.engine.cue.text); f.ctx.submit(); const corrected = f.engine.getSnapshot().attempts[1]; await f.settle();
  assert.equal(corrected.errors, 0); assert.equal(corrected.conditions.revealed, true); assert.equal(wrong.conditions.revealed, false);
  const exported = await f.repo.exportReviewTask(f.task.taskId); assert.equal(exported.relations.length, 2);
  assert.deepEqual(exported.relations.map(r => r.instanceId), [binding.instanceId, binding.instanceId]);
  assert.deepEqual(await f.repo.loadReviewTask(f.task.taskId), won); assert.equal((await f.repo.loadReviewInstance(won.currentInstanceId))!.winner, null);
  assert.deepEqual((await f.repo.loadHistorySession(wrong.sessionId))!.snapshot.attempts, f.engine.getSnapshot().attempts);
  assert.match(f.ctx.reviewTrackingMessage, /没有重复推进/);
});

test('actual partial retest saves and associates its recorded result without pretending it is complete history', async t => {
  const f = await setup(t); await f.history.turnOff(); await f.history.turnOn(); await f.start();
  const binding = f.ctx.reviewBindingRef.current; assert.equal(binding.session.kind, 'partial');
  f.input('authentic partial retest answer'); f.ctx.submit(); await f.settle();
  const attempt = f.engine.getSnapshot().attempts[0], exported = await f.repo.exportReviewTask(f.task.taskId);
  assert.equal(exported.relations.length, 1); assert.equal(exported.relations[0].source.kind, 'partial');
  assert.equal(exported.relations[0].source.attemptId, attempt.attemptId);
  const evidence = exported.evidence.find(e => e.source.attemptId === attempt.attemptId)!;
  assert.equal(evidence.availability, 'available'); assert.equal(evidence.coverage, 'partial'); assert.equal(evidence.assistance, 'unknown');
  assert.equal(evidence.result?.errors, attempt.errors); assert.equal(await f.repo.loadHistorySession(attempt.sessionId), null);
  const segment = (await f.repo.loadTrainingHistorySegment(binding.session.segmentId))!;
  assert.ok(segment.facts.some(fact => fact.type === 'judgmentApplied' && fact.attemptId === attempt.attemptId && fact.retention === 'recorded'));
  await f.ctx.refreshReviewTasks(); assert.match(f.ctx.reviewRows[0].resultSummary, /部分记录/); assert.ok(f.ctx.reviewRows[0].resultSummary.includes(attempt.attemptId));
  assert.equal(JSON.stringify(f.ctx.reviewRows).includes(attempt.answer), false);
});

for (const delivery of ['after rejection', 'in the same pending drain'] as const) test(`actual redacted undo result cannot block the next recorded retest ${delivery}`, async t => {
  const f = await setup(t); await f.history.turnOff(); await f.history.turnOn(); await f.start();
  const binding = f.ctx.reviewBindingRef.current, held = gate(); t.after(held.resolve);
  const commit = f.repo.commitReviewResult.bind(f.repo); let firstCommit = false;
  f.repo.commitReviewResult = async (...args) => {
    if (!firstCommit) { firstCommit = true; if (delivery === 'in the same pending drain') await held.promise; }
    return commit(...args);
  };
  const nativeInput = (value: string, inputType: string, data: string | null) => {
    f.ctx.inputRef.current.value = value;
    f.ctx.inputHandler({ currentTarget: f.ctx.inputRef.current, nativeEvent: { inputType, data } });
  };
  f.input('first typed wrong answer');
  nativeInput('first typed wrong answer plus more', 'insertText', ' plus more');
  nativeInput('first typed wrong answer', 'historyUndo', null); f.ctx.submit();
  if (delivery === 'after rejection') await f.settle();
  else await until(() => firstCommit, 'first redacted result awaiting commit');
  const rejectedAttempt = f.engine.getSnapshot().attempts[0];
  const firstSegment = (await f.repo.loadTrainingHistorySegment(binding.session.segmentId))!;
  const redacted = firstSegment.facts.filter(fact => fact.type === 'judgmentApplied').at(-1)!;
  assert.equal(redacted.retention, 'redacted'); assert.equal(Object.hasOwn(redacted, 'result'), false);
  assert.equal((await f.repo.exportReviewTask(f.task.taskId)).relations.length, 0);
  nativeInput('', 'deleteContentBackward', null); f.input('fresh typed answer with exact provenance'); f.ctx.submit();
  // The ordinary history saver is independent of the blocked relation queue.
  if (delivery === 'in the same pending drain') await f.history.flush();
  held.resolve(); await f.settle();
  const validAttempt = f.engine.getSnapshot().attempts[1];
  const segment = (await f.repo.loadTrainingHistorySegment(binding.session.segmentId))!;
  assert.deepEqual(segment.facts.filter(fact => fact.type === 'judgmentApplied').map(fact => fact.retention), ['redacted', 'recorded']);
  const exported = await f.repo.exportReviewTask(f.task.taskId);
  assert.equal(exported.relations.length, 1, 'An ineligible redacted queue head must not block the first eligible saved result');
  assert.equal(exported.relations[0].source.attemptId, validAttempt.attemptId); assert.equal(exported.relations[0].disposition, 'winner');
  assert.equal(exported.relations.some(relation => relation.source.attemptId === rejectedAttempt.attemptId), false);
  assert.deepEqual(exported.task.due, nextDue); assert.equal(f.ctx.reviewPendingCount, 0); assert.equal(f.ctx.reviewPendingRef.current.size, 0);
  assert.equal((await f.repo.loadReviewInstance(binding.instanceId))!.winner!.source.attemptId, validAttempt.attemptId);
  const wonTask = exported.task;
  await f.ctx.flushReviewResults(); await f.ctx.flushReviewResults();
  assert.deepEqual(await f.repo.loadReviewTask(f.task.taskId), wonTask); assert.equal((await f.repo.exportReviewTask(f.task.taskId)).relations.length, 1);
  await f.ctx.changeHistoryRecording(false);
  nativeInput('', 'deleteContentBackward', null); f.input('private OFF retry'); f.ctx.submit(); await f.ctx.changeHistoryRecording(true);
  nativeInput('', 'deleteContentBackward', null); f.input('new permission ordinary answer'); f.ctx.submit(); await f.settle(); await f.ctx.flushReviewResults();
  assert.equal(f.ctx.reviewBindingRef.current, null); assert.equal(f.ctx.reviewPendingCount, 0);
  assert.deepEqual(await f.repo.loadReviewTask(f.task.taskId), wonTask); assert.equal((await f.repo.exportReviewTask(f.task.taskId)).relations.length, 1);
});

for (const resolution of ['explicit retry', 'OFF then ON'] as const) test(`actual partial valid result retains a quota retry after dropping the redacted head, with ${resolution}`, async t => {
  const f = await setup(t); await f.history.turnOff(); await f.history.turnOn(); await f.start();
  const nativeInput = (value: string, inputType: string, data: string | null) => {
    f.ctx.inputRef.current.value = value;
    f.ctx.inputHandler({ currentTarget: f.ctx.inputRef.current, nativeEvent: { inputType, data } });
  };
  f.input('typed wrong answer'); nativeInput('typed wrong answer changed', 'insertText', ' changed');
  nativeInput('typed wrong answer', 'historyUndo', null); f.ctx.submit(); await f.settle();
  const rejectedAttempt = f.engine.getSnapshot().attempts[0];
  assert.equal(f.ctx.reviewPendingRef.current.has(rejectedAttempt.attemptId), false, 'Terminal source rejection must leave the queue');
  const commit = f.repo.commitReviewResult.bind(f.repo); let quota = true;
  f.repo.commitReviewResult = async (...args) => { if (quota) throw new DOMException('synthetic relation quota', 'QuotaExceededError'); return commit(...args); };
  nativeInput('', 'deleteContentBackward', null); f.input('fully recorded answer needing retry'); f.ctx.submit(); await f.settle();
  const validAttempt = f.engine.getSnapshot().attempts[1];
  assert.deepEqual([...f.ctx.reviewPendingRef.current.keys()], [validAttempt.attemptId]); assert.equal(f.ctx.reviewPendingCount, 1);
  assert.equal((await f.repo.exportReviewTask(f.task.taskId)).relations.length, 0); assert.match(f.ctx.reviewTrackingMessage, /quota/);
  assert.equal(f.history.getSnapshot().error, null);
  quota = false;
  if (resolution === 'OFF then ON') { await f.ctx.changeHistoryRecording(false); await f.ctx.changeHistoryRecording(true); }
  await f.ctx.flushReviewResults(); await f.ctx.flushReviewResults();
  const exported = await f.repo.exportReviewTask(f.task.taskId);
  assert.equal(f.ctx.reviewPendingCount, 0); assert.equal(exported.relations.length, resolution === 'explicit retry' ? 1 : 0);
  assert.equal(exported.relations.some(relation => relation.source.attemptId === rejectedAttempt.attemptId), false);
  if (resolution === 'explicit retry') { assert.equal(exported.relations[0].source.attemptId, validAttempt.attemptId); assert.deepEqual(exported.task.due, nextDue); }
  else { assert.equal(f.ctx.reviewBindingRef.current, null); assert.equal(exported.task.currentInstanceId, f.task.currentInstanceId); assert.deepEqual(exported.task.due, due); }
});

test('actual source-task save from an admitted segment preserves a partial source locator', async t => {
  const f = await setup(t); await f.history.turnOff(); await f.history.turnOn(); f.ctx.changeCue(0);
  f.input('new sentence captured from segment'); f.ctx.submit(); const before = f.engine.getSnapshot();
  assert.equal((await f.ctx.saveReviewTask(f.engine.cue.id, nextDue, 'partial-source-task')).disposition, 'saved');
  const task = (await f.repo.listReviewTasks()).entries.find(task => task.requestId === 'partial-source-task')!;
  assert.equal(task.source.kind, 'partial'); assert.equal(task.source.attemptId, before.attempts.at(-1)!.attemptId);
  assert.deepEqual(f.engine.getSnapshot(), before); const exported = await f.repo.exportReviewTask(task.taskId);
  assert.equal(exported.evidence[0].assistance, 'unknown'); assert.equal(exported.evidence[0].coverage, 'partial'); assert.equal(exported.relations.length, 0);
});

for (const unavailable of ['missing corrected reference', 'wrong original hash'] as const) test(`actual ${unavailable} blocks retest before reset without erasing task history`, async t => {
  const f = await setup(t, { corrected: unavailable === 'missing corrected reference' }), before = f.engine.getSnapshot();
  if (unavailable === 'missing corrected reference') { f.library.isExactSavedMaterial = async () => false; await f.ctx.refreshReviewTasks(); assert.equal(f.ctx.reviewRows[0].canStart, false); }
  else f.setLease({ verified: false, actualSha256: '0'.repeat(64), verificationError: 'Original checksum mismatch' });
  await assert.rejects(f.start()); assert.deepEqual(f.engine.getSnapshot(), before); assert.equal(f.ctx.reviewBindingRef.current, null);
  assert.equal((await f.repo.exportReviewTask(f.task.taskId)).relations.length, 0); assert.equal(f.trace.includes('engine.start'), false);
});

test('actual failed relation keeps genuine saved answer retryable without reporting scheduled success', async t => {
  const f = await setup(t); await f.start(); const commit = f.repo.commitReviewResult.bind(f.repo); let fail = true;
  f.repo.commitReviewResult = async (...args) => { if (fail) throw Error('synthetic relation transaction failure'); return commit(...args); };
  f.input('genuine answer remains saved'); f.ctx.submit(); await f.settle();
  assert.equal(f.ctx.reviewPendingCount, 1); assert.match(f.ctx.reviewTrackingMessage, /synthetic relation/);
  assert.equal((await f.repo.loadHistorySession(f.engine.getSnapshot().sessionId))!.snapshot.attempts.length, 1);
  assert.equal((await f.repo.exportReviewTask(f.task.taskId)).relations.length, 0); assert.equal(f.history.getSnapshot().error, null);
  fail = false; await f.ctx.flushReviewResults(); assert.equal(f.ctx.reviewPendingCount, 0); assert.equal((await f.repo.exportReviewTask(f.task.taskId)).relations.length, 1);
});

for (const stop of ['OFF', 'pagehide', 'cancel', 'leave cue'] as const) test(`actual ${stop} during result flush clears pending association and never follows a later permission`, async t => {
  const f = await setup(t); await f.start(); await f.history.flush(); const held = gate(), flush = f.history.flush.bind(f.history); let waiting = false;
  f.history.flush = async () => { waiting = true; await held.promise; await flush(); };
  f.input('answer at pending boundary'); f.ctx.submit(); await until(() => waiting, 'held result history flush');
  assert.equal(f.ctx.reviewPendingRef.current.size, 1);
  if (stop === 'OFF') await f.ctx.changeHistoryRecording(false);
  if (stop === 'pagehide') f.ctx.pageHide();
  if (stop === 'cancel') { const current = (await f.repo.loadReviewTask(f.task.taskId))!; await f.ctx.changeReviewTask(current, 'cancel'); }
  if (stop === 'leave cue') f.ctx.changeCue(0);
  assert.equal(f.ctx.reviewBindingRef.current, null); assert.equal(f.ctx.reviewPendingRef.current.size, 0);
  held.resolve(); await f.settle(); if (f.ctx.exitHistorySave) await f.ctx.exitHistorySave;
  assert.equal((await f.repo.exportReviewTask(f.task.taskId)).relations.length, 0);
  if (stop === 'OFF') { await f.ctx.changeHistoryRecording(true); f.input('fresh allowed answer'); f.ctx.submit(); await f.settle(); await f.ctx.flushReviewResults(); assert.equal((await f.repo.exportReviewTask(f.task.taskId)).relations.length, 0); }
  assert.equal(f.ctx.reviewPendingCount, 0);
});

test('actual full restore binds only the exact saved old occurrence and never scans unassociated saved attempts', async t => {
  const f = await setup(t); await f.start(); f.input('first winning result'); f.ctx.submit(); await f.settle();
  const oldInstance = f.ctx.reviewBindingRef.current.instanceId;
  // A real second attempt was saved normally, but never delivered to review.
  f.engine.input('saved but not review delivered'); f.engine.submit(); await f.history.flush();
  const restored = await f.restore(), before = restored.engine.getSnapshot(); let commits = 0;
  const commit = restored.repo.commitReviewResult.bind(restored.repo); restored.repo.commitReviewResult = async (...args) => { commits++; return commit(...args); };
  await f.ctx.restoreSavedReviewBinding(restored.snapshot);
  assert.equal(f.ctx.reviewBindingRef.current.instanceId, oldInstance); assert.deepEqual(restored.engine.getSnapshot(), before);
  assert.equal(f.ctx.reviewPendingRef.current.size, 0); assert.equal(commits, 0); assert.equal((await restored.repo.exportReviewTask(f.task.taskId)).relations.length, 1);
  const current = (await restored.repo.loadReviewTask(f.task.taskId))!; assert.notEqual(current.currentInstanceId, oldInstance);
  f.input('new real correction after refresh'); f.ctx.submit(); await f.settle(); assert.equal(commits, 1);
  const exported = await restored.repo.exportReviewTask(f.task.taskId); assert.equal(exported.relations.length, 2); assert.equal(exported.relations[1].instanceId, oldInstance);
  assert.equal((await restored.repo.loadReviewTask(f.task.taskId))!.currentInstanceId, current.currentInstanceId);
});

test('actual restore abandons an exact binding when live state changes during verification', async t => {
  const f = await setup(t); await f.start(); const restored = await f.restore(), held = gate(); f.setAcquireGate(held);
  const work = f.ctx.restoreSavedReviewBinding(restored.snapshot); await until(() => !!f.ctx.reviewVerificationRef.current, 'restore media verification');
  restored.engine.input('new input while restore was waiting'); held.resolve(); await work;
  assert.equal(f.ctx.reviewBindingRef.current, null); assert.equal(f.ctx.reviewPendingRef.current.size, 0);
  assert.equal((await restored.repo.exportReviewTask(f.task.taskId)).relations.length, 0);
});

test('actual refresh after leaving the target cue cannot silently reattach its saved old binding', async t => {
  const f = await setup(t); await f.start(); f.ctx.changeCue(0); await f.history.flush();
  const restored = await f.restore(), before = restored.engine.getSnapshot(), acquisitions = f.acquired;
  await f.ctx.restoreSavedReviewBinding(restored.snapshot);
  assert.equal(f.ctx.reviewBindingRef.current, null); assert.equal(f.acquired, acquisitions, 'Reject wrong cue before loading target media');
  assert.deepEqual(restored.engine.getSnapshot(), before); assert.equal((await restored.repo.exportReviewTask(f.task.taskId)).relations.length, 0);
});

test('actual OFF status survives a late rejected result promise from the abandoned generation', async t => {
  const f = await setup(t); await f.start(); const held = gate(); t.after(held.resolve); let committing = false;
  f.repo.commitReviewResult = async () => { committing = true; await held.promise; throw Error('stale association error'); };
  f.input('saved answer before OFF'); f.ctx.submit(); await until(() => committing, 'delayed result commit');
  await f.ctx.changeHistoryRecording(false); const stoppedMessage = f.ctx.reviewTrackingMessage; assert.match(stoppedMessage, /关闭/);
  held.resolve(); await f.settle(); assert.equal(f.ctx.reviewTrackingMessage, stoppedMessage); assert.equal(f.ctx.reviewPendingCount, 0);
  assert.equal((await f.repo.exportReviewTask(f.task.taskId)).relations.length, 0);
});

test('actual newer retest drains its own queued result after an old in-flight association is revoked', async t => {
  const f = await setup(t); await f.start(); const held = gate(); t.after(held.resolve);
  const commit = f.repo.commitReviewResult.bind(f.repo); let oldCommitting = false, calls = 0;
  f.repo.commitReviewResult = async (...args) => { calls++; if (calls === 1) { oldCommitting = true; await held.promise; throw Error('old stopped association'); } return commit(...args); };
  f.input('older genuine attempt'); f.ctx.submit(); await until(() => oldCommitting, 'old association in flight');
  const oldSession = f.engine.getSnapshot().sessionId, current = (await f.repo.loadReviewTask(f.task.taskId))!;
  await f.ctx.startReviewTask(current, nextDue); assert.notEqual(f.engine.getSnapshot().sessionId, oldSession);
  f.input('new genuine attempt'); f.ctx.submit(); assert.equal(f.ctx.reviewPendingRef.current.size, 1); assert.equal(calls, 1);
  held.resolve(); await until(() => calls === 2 && !f.ctx.reviewResultBusy.current, 'new action automatically drained');
  assert.equal(f.ctx.reviewPendingCount, 0); assert.match(f.ctx.reviewTrackingMessage, /已按你预选/);
  const exported = await f.repo.exportReviewTask(f.task.taskId); assert.equal(exported.relations.length, 1);
  assert.equal(exported.relations[0].source.sessionId, f.engine.getSnapshot().sessionId);
  assert.equal((await f.repo.loadHistorySession(oldSession))!.snapshot.attempts.length, 1);
});

test('actual save after OFF cannot use tasks to copy an unrecorded new answer', async t => {
  const f = await setup(t); await f.ctx.changeHistoryRecording(false);
  f.input('private OFF answer'); f.ctx.submit(); const snapshot = f.engine.getSnapshot();
  await assert.rejects(f.ctx.saveReviewTask(f.task.target.cueId, due, 'off-new-source'), /尚未保存|临时答案/);
  assert.deepEqual(f.engine.getSnapshot(), snapshot); assert.equal((await f.repo.listReviewTasks()).entries.length, 1);
  assert.equal((await f.repo.loadHistorySession(snapshot.sessionId))!.snapshot.attempts.length, 1);
  assert.equal(f.ctx.reviewBusy, false);
});

test('actual failed source flush blocks saving a task without converting unsaved evidence into a locator', async t => {
  const f = await setup(t); f.input('new source that cannot be saved'); f.ctx.submit();
  f.repo.saveSession = async () => { throw Error('source quota'); };
  await assert.rejects(f.ctx.saveReviewTask(f.task.target.cueId, due, 'unsaved-source'), /尚未保存/);
  assert.equal((await f.repo.listReviewTasks()).entries.length, 1); assert.equal(f.engine.getSnapshot().attempts.length, 2);
  assert.equal((await f.repo.loadHistorySession(f.engine.getSnapshot().sessionId))!.snapshot.attempts.length, 1);
});

test('actual OFF while binding is awaiting storage never opens tracked practice or later back-associates it', async t => {
  const f = await setup(t), held = gate(); t.after(held.resolve); let binding = false;
  const original = f.repo.bindReviewSession.bind(f.repo); f.repo.bindReviewSession = async (...args) => { binding = true; await held.promise; return original(...args); };
  const work = f.start(); await until(() => binding, 'startup binding'); await f.ctx.changeHistoryRecording(false); held.resolve(); await assert.rejects(work);
  assert.equal(f.ctx.reviewBindingRef.current, null); assert.equal(f.history.getSnapshot().mode, 'off'); assert.ok(f.ctx.reviewStartFailure);
  f.ctx.leaveFailedReviewStart(); f.input('ordinary OFF answer'); f.ctx.submit(); await f.ctx.changeHistoryRecording(true);
  await f.ctx.flushReviewResults(); assert.equal((await f.repo.exportReviewTask(f.task.taskId)).relations.length, 0);
});

test('actual pagehide during metadata loading aborts startup and releases its media lease', async t => {
  const f = await setup(t), held = gate(); t.after(held.resolve); f.video.metadataGate = held;
  const work = f.start(); await until(() => !!f.ctx.reviewMediaRequestRef.current && f.video.src.startsWith('blob:'), 'retest metadata loading');
  f.ctx.pageHide(); await assert.rejects(work); held.resolve(); await tick();
  assert.equal(f.ctx.reviewBindingRef.current, null); assert.equal(f.ctx.reviewMediaRequestRef.current, null);
  assert.equal(f.ctx.originalMediaLease.current, null); assert.equal(f.ctx.reviewMediaRef.current, null); assert.equal(f.acquired, f.released);
  assert.equal((await f.repo.exportReviewTask(f.task.taskId)).relations.length, 0);
});

for (const mode of ['off', 'segment', 'awaiting'] as const) test(`actual ${mode} refresh never reattaches a full practice or searches for pending answers`, async t => {
  const f = await setup(t); await f.start(); await f.ctx.changeHistoryRecording(false);
  if (mode === 'segment') await f.history.turnOn();
  if (mode === 'awaiting') { const control = await f.repo.enableAutomaticHistory(f.history.getSnapshot().control!.generation); f.history.connect(f.engine.getSnapshot(), control); }
  let reads = 0; f.repo.restoreReviewSessionBinding = async () => { reads++; throw Error('must not read a full binding'); };
  const before = f.engine.getSnapshot(); await f.ctx.restoreSavedReviewBinding(before); await f.ctx.refreshReviewTasks();
  assert.equal(reads, 0); assert.equal(f.ctx.reviewBindingRef.current, null); assert.deepEqual(f.engine.getSnapshot(), before); assert.equal(f.ctx.reviewRows.length, 1);
});

test('actual background cancellation releases verification and cannot reset or enable tracking', async t => {
  const f = await setup(t), before = f.engine.getSnapshot(), held = gate(); f.setAcquireGate(held);
  const work = f.start(); await until(() => !!f.ctx.reviewVerificationRef.current, 'startup media verification');
  f.ctx.document.hidden = true; f.ctx.visibility(); held.resolve(); await assert.rejects(work); await tick();
  assert.deepEqual(learning(f.engine.getSnapshot()), learning(before)); assert.equal(f.trace.includes('engine.start'), false);
  assert.equal(f.ctx.reviewBindingRef.current, null); assert.equal(f.ctx.reviewVerificationRef.current, null); assert.equal(f.acquired, f.released);
});
