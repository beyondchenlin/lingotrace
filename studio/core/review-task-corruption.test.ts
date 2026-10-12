import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDBTrainingRepository } from './repository.ts';
import { TrainingEngine, CAFE_MATERIAL } from './training.ts';
import { buildReviewTarget } from './review-tasks.ts';
import { LOCAL_REFERENCE_MEDIA_ID, LOCAL_REFERENCE_MEDIA_SHA256 } from './local-reference.ts';
import { resolveReviewLocalTime } from './review-due-time.ts';
import { REVIEW_TASK_PREFIX, REVIEW_INSTANCE_PREFIX, REVIEW_BINDING_PREFIX, REVIEW_RESULT_PREFIX } from './review-task-storage.ts';
import { setup } from './studio-host-test-fixture.ts';

const due = resolveReviewLocalTime('2026-10-12T10:00', 'UTC')[0];
const nextDue = resolveReviewLocalTime('2026-10-19T10:00', 'UTC')[0];
const prefixes = [REVIEW_INSTANCE_PREFIX, REVIEW_BINDING_PREFIX, REVIEW_RESULT_PREFIX];
async function metadata(factory: IDBFactory, dbName: string, put?: { key: string; value: unknown }) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(dbName); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<any[]>((resolve, reject) => {
      const tx = db.transaction('meta', put ? 'readwrite' : 'readonly'), store = tx.objectStore('meta');
      if (put) store.put(put);
      const request = store.getAll();
      tx.oncomplete = () => resolve(request.result); tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
async function fixture(t: test.TestContext) {
  const factory = new IDBFactory(), dbName = `review-corruption-${crypto.randomUUID()}`;
  const repo = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  t.after(() => repo.close());
  let serial = 0;
  const engine = new TrainingEngine({ clock: { now: () => 0, wallTime: () => '2026-10-10T10:00:00.000Z', id: () => `corruption-${++serial}` } });
  engine.input('actual source answer'); engine.submit();
  const snapshot = engine.getSnapshot(), attempt = snapshot.attempts[0]; await repo.saveSession(snapshot);
  const source = { kind: 'full' as const, sessionId: snapshot.sessionId, attemptId: attempt.attemptId,
    submitEventId: snapshot.events.find(event => event.type === 'submitRequested')!.eventId,
    judgmentEventId: snapshot.events.find(event => event.type === 'judgmentApplied')!.eventId };
  const target = await buildReviewTarget(CAFE_MATERIAL, CAFE_MATERIAL.cues[0].id,
    { id: LOCAL_REFERENCE_MEDIA_ID, sha256: LOCAL_REFERENCE_MEDIA_SHA256, durationSeconds: 72 });
  const created = await repo.createReviewTask({ requestId: 'corruption-task-request', taskId: 'healthy-task', instanceId: 'healthy-instance', source, target, due });
  return { factory, dbName, repo, engine, created, rows: (put?: { key: string; value: unknown }) => metadata(factory, dbName, put) };
}

async function retested(t: test.TestContext) {
  const f = await fixture(t), plan = await f.repo.prepareReviewRetest({ taskId: f.created.task.taskId, expectedRevision: 1, nextDue });
  f.engine.startReferenceSession(CAFE_MATERIAL, 0); await f.repo.saveSession(f.engine.getSnapshot());
  const binding = await f.repo.bindReviewSession({ taskId: plan.task.taskId, instanceId: plan.instance.instanceId, expectedRevision: plan.task.revision,
    session: { kind: 'full', sessionId: f.engine.getSnapshot().sessionId, generation: 0 } });
  f.engine.input('authentic retest answer'); f.engine.submit(); const snapshot = f.engine.getSnapshot(), attempt = snapshot.attempts[0];
  await f.repo.saveSession(snapshot);
  await f.repo.commitReviewResult({ binding, source: { kind: 'full', sessionId: snapshot.sessionId, attemptId: attempt.attemptId,
    submitEventId: snapshot.events.find(event => event.type === 'submitRequested')!.eventId,
    judgmentEventId: snapshot.events.find(event => event.type === 'judgmentApplied')!.eventId } });
  return { ...f, exported: await f.repo.exportReviewTask(f.created.task.taskId) };
}

for (const prefix of prefixes) test(`export isolates unrelated malformed ${prefix} without changing stored records or Training`, async t => {
  const f = await fixture(t), expected = await f.repo.exportReviewTask(f.created.task.taskId);
  const beforeHistory = await f.repo.loadHistorySession(f.created.task.source.sessionId), status = f.repo.getStatus();
  const inserted = { key: prefix + 'unrelated-corrupt-row', value: { schemaVersion: 'future', taskId: 'another-task' } };
  const before = await f.rows(inserted);
  assert.deepEqual(await f.repo.exportReviewTask(f.created.task.taskId), expected);
  assert.deepEqual(await f.rows(), before);
  assert.deepEqual(await f.repo.loadHistorySession(f.created.task.source.sessionId), beforeHistory);
  assert.deepEqual(f.repo.getStatus(), status);
});

for (const prefix of prefixes) test(`export keeps malformed target and ambiguous owner ${prefix} fail-closed`, async t => {
  for (const owner of ['healthy-task', undefined, '', ' another-task ']) {
    const f = await fixture(t), value = { schemaVersion: 'future', ...(owner === undefined ? {} : { taskId: owner }) };
    const before = await f.rows({ key: prefix + 'corrupt-row', value });
    await assert.rejects(f.repo.exportReviewTask(f.created.task.taskId), { code: 'invalid-record' });
    assert.deepEqual(await f.rows(), before);
  }
});

test('export refuses inconsistent target task and instance storage identities', async t => {
  for (const kind of ['task', 'current instance', 'historical instance']) {
    const f = await fixture(t);
    if (kind === 'task') await f.rows({ key: REVIEW_TASK_PREFIX + f.created.task.taskId, value: { ...f.created.task, taskId: 'another-task' } });
    if (kind === 'current instance') await f.rows({ key: REVIEW_INSTANCE_PREFIX + f.created.instance.instanceId, value: { ...f.created.instance, instanceId: 'another-instance' } });
    if (kind === 'historical instance') await f.rows({ key: REVIEW_INSTANCE_PREFIX + 'wrong-key', value: { ...f.created.instance, instanceId: 'old-instance' } });
    const before = await f.rows();
    await assert.rejects(f.repo.exportReviewTask(f.created.task.taskId), { code: 'invalid-record' }, kind);
    assert.deepEqual(await f.rows(), before);
  }
});

test('foreign taskId cannot hide a target-linked predecessor instance', async t => {
  const f = await fixture(t);
  await f.repo.changeReviewTask({ taskId: f.created.task.taskId, expectedRevision: 1, action: 'reschedule', due: nextDue });
  const old = (await f.rows()).find(row => row.key === REVIEW_INSTANCE_PREFIX + f.created.instance.instanceId);
  await f.rows({ ...old, value: { ...old.value, taskId: 'another-task' } });
  await assert.rejects(f.repo.exportReviewTask(f.created.task.taskId), { code: 'invalid-record' });
});

for (const prefix of [REVIEW_BINDING_PREFIX, REVIEW_RESULT_PREFIX]) test(`export refuses mismatched primary identity and foreign claims on target ${prefix}`, async t => {
  for (const corruption of ['wrong key', 'foreign owner', 'missing owner']) {
    const f = await retested(t), record = (await f.rows()).find(row => row.key.startsWith(prefix));
    if (corruption === 'wrong key') await f.rows({ ...record, key: prefix + 'wrong-key' });
    else {
      const value = { ...record.value, taskId: 'another-task' };
      if (corruption === 'missing owner') delete value.taskId;
      await f.rows({ ...record, value });
    }
    const before = await f.rows();
    await assert.rejects(f.repo.exportReviewTask(f.created.task.taskId), { code: 'invalid-record' }, corruption);
    assert.deepEqual(await f.rows(), before);
  }
});

test('target export retains its real winner and source proofs while isolating all foreign malformed namespaces', async t => {
  const f = await retested(t);
  for (const prefix of prefixes) await f.rows({ key: prefix + 'unrelated-corrupt-row', value: { schemaVersion: 'future', taskId: 'another-task' } });
  const before = await f.rows();
  assert.deepEqual(await f.repo.exportReviewTask(f.created.task.taskId), f.exported);
  assert.equal(f.exported.instances.length, 2); assert.equal(f.exported.bindings.length, 1); assert.equal(f.exported.relations.length, 1);
  assert.equal(f.exported.relations[0].disposition, 'winner'); assert.equal(f.exported.evidence.length, 2);
  assert.equal(f.exported.evidence.every(evidence => evidence.availability === 'available'), true);
  assert.deepEqual(await f.rows(), before);
});

for (const prefix of prefixes) test(`actual Studio refresh keeps healthy task startable beside unrelated malformed ${prefix}`, async t => {
  const f = await setup(t);
  await f.ctx.refreshReviewTasks(); assert.equal(f.ctx.reviewRows[0].canStart, true);
  const before = f.engine.getSnapshot(), saved = await f.repo.loadHistorySession(before.sessionId);
  const rows = await metadata(f.factory, f.dbName, { key: prefix + 'unrelated-corrupt-row', value: { schemaVersion: 'future', taskId: 'another-task' } });
  await f.ctx.refreshReviewTasks();
  assert.equal(f.ctx.reviewRows.length, 1); assert.equal(f.ctx.reviewRows[0].canStart, true); assert.equal(f.ctx.reviewUnreadable, 0);
  assert.equal(f.ctx.reviewError, ''); assert.deepEqual(f.engine.getSnapshot(), before);
  assert.deepEqual(await f.repo.loadHistorySession(before.sessionId), saved);
  assert.deepEqual(await metadata(f.factory, f.dbName), rows);
});

for (const [label, tail] of [
  ['unknown attempt', ['unreferenced-later-attempt']], ['empty attempt', ['']], ['null attempt', [null]], ['missing attempt', []],
  ['extra tuple item', ['unreferenced-later-attempt', 'extra']],
] as const) test(`foreign owner cannot hide a target-session result key with ${label}`, async t => {
  const f = await retested(t), sessionId = f.exported.bindings[0].session.sessionId;
  const before = await f.rows({ key: REVIEW_RESULT_PREFIX + JSON.stringify([sessionId, ...tail]),
    value: { schemaVersion: 'future', taskId: 'another-task' } });
  await assert.rejects(f.repo.exportReviewTask(f.created.task.taskId), { code: 'invalid-record' });
  assert.deepEqual(await f.rows(), before);
});

for (const [kind, key, identity] of [
  ['instance', REVIEW_INSTANCE_PREFIX + 'foreign-instance-a', { instanceId: 'foreign-instance-b' }],
  ['binding', REVIEW_BINDING_PREFIX + 'foreign-session-a', { session: { sessionId: 'foreign-session-b' } }],
  ['result', REVIEW_RESULT_PREFIX + JSON.stringify(['foreign-session-a', 'foreign-attempt-a']), { source: { sessionId: 'foreign-session-b', attemptId: 'foreign-attempt-b' } }],
] as const) test(`export isolates wholly foreign ${kind} key/payload disagreement`, async t => {
  const f = await retested(t), before = await f.rows({ key, value: { schemaVersion: 'future', taskId: 'another-task', ...identity } });
  assert.deepEqual(await f.repo.exportReviewTask(f.created.task.taskId), f.exported);
  assert.deepEqual(await f.rows(), before);
});
