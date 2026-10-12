import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IDBFactory } from 'fake-indexeddb';
import { BUILTIN_TRAINING_SCHEMA, NPS_MATERIAL } from './builtin-material.ts';
import { CAFE_MATERIAL, SCHEMA_VERSION, TrainingEngine, exportSession, type Material, type TrainingSnapshot } from './training.ts';
import { IndexedDBTrainingRepository } from './repository.ts';
import { TrainingHistorySegmentProjector, type TrainingHistorySegment } from './training-history-segment.ts';
import { readTrainingHistoryBootstrap } from './training-history-bootstrap.ts';
import { exportTrainingHistorySegment } from './segment-history-reader.ts';
import { exportStudioSession } from './session-export.ts';
import { AUTOMATIC_HISTORY_CONTROL_KEY } from './automatic-history-control.ts';
import { buildReviewTarget, type ReviewSourceLocator } from './review-tasks.ts';
import { resolveReviewLocalTime } from './review-due-time.ts';
import { LOCAL_REFERENCE_MEDIA_ID, LOCAL_REFERENCE_MEDIA_SHA256 } from './local-reference.ts';

const at = '2026-10-10T11:00:00.000Z';
const native = (text: string) => ({ version: 'dom-edit-v1' as const, kind: 'input' as const, inputType: text ? 'insertText' : 'deleteContentBackward', data: text || null });
function clock(sessionId: string) {
  let id = 0;
  return { now: () => 0, wallTime: () => at, id: () => `${sessionId}-event-${++id}` };
}
function engine(sessionId: string, material: Material = NPS_MATERIAL) {
  return new TrainingEngine({ sessionId, material, clock: clock(sessionId) });
}
function exercise(source: TrainingEngine) {
  source.input(source.cue.text, 'typed', native(source.cue.text)); source.submit();
  return source.getSnapshot();
}
function fixture(t: TestContext) {
  const factory = new IDBFactory(), dbName = `builtin-${t.name}`, options = { indexedDB: factory, dbName };
  const repository = new IndexedDBTrainingRepository(options);
  t.after(() => repository.close());
  return { factory, dbName, repository, options };
}
async function open(factory: IDBFactory, dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(dbName);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error); });
}
interface StoredFacts { version: number; sessions: { sessionId: string; snapshot: TrainingSnapshot }[]; events: unknown[]; meta: { key: string; [key: string]: unknown }[] }
async function facts(f: ReturnType<typeof fixture>): Promise<StoredFacts> {
  const db = await open(f.factory, f.dbName);
  try {
    const result = { version: db.version } as StoredFacts, transaction = db.transaction(['sessions', 'events', 'meta'], 'readonly');
    for (const name of ['sessions', 'events', 'meta'] as const) {
      const request = transaction.objectStore(name).getAll(); request.onsuccess = () => { result[name] = request.result; };
    }
    await completed(transaction); return result;
  } finally { db.close(); }
}
async function assertUnchanged(f: ReturnType<typeof fixture>, before: StoredFacts) {
  const after = await facts(f);
  assert.deepEqual(after, before);
  assert.equal(JSON.stringify(after), JSON.stringify(before), 'retained values, version, and actual latest pointer remain byte-for-byte equal when serialized');
}
async function corruptStoredSnapshot(f: ReturnType<typeof fixture>, snapshot: TrainingSnapshot) {
  const db = await open(f.factory, f.dbName);
  try {
    const transaction = db.transaction('sessions', 'readwrite');
    transaction.objectStore('sessions').put({ sessionId: snapshot.sessionId, sequence: snapshot.sequence, snapshot, updatedAt: at });
    await completed(transaction);
  } finally { db.close(); }
}

// The actual new engine and writer create both profile discriminators and binding.
// No direct IDB fixture is used for any successful compatibility roundtrip.
test('actual NPS full writer restores the genuine bound profile, all events, attempts and original latest without a database migration', async t => {
  const f = fixture(t), snapshot = exercise(engine('nps-full'));
  await f.repository.saveSession(snapshot);
  const before = await facts(f);
  assert.equal(before.version, 1);
  assert.equal(snapshot.schemaVersion, BUILTIN_TRAINING_SCHEMA);
  assert.ok(snapshot.events.every(event => event.schemaVersion === BUILTIN_TRAINING_SCHEMA));
  assert.equal(before.meta.find(row => row.key === 'latest')?.sessionId, snapshot.sessionId);
  assert.equal(before.meta.some(row => row.key === AUTOMATIC_HISTORY_CONTROL_KEY), false);
  assert.deepEqual(before.sessions[0].snapshot, snapshot);
  const reader = new IndexedDBTrainingRepository(f.options); t.after(() => reader.close());
  assert.deepEqual(await reader.loadLatest(), snapshot);
  assert.deepEqual(await readTrainingHistoryBootstrap(reader), { control: { state: 'legacy-default', generation: 0 }, saved: snapshot, temporary: false });
  assert.deepEqual((await reader.loadHistorySession(snapshot.sessionId))?.snapshot, snapshot);
  const list = await reader.listHistory(); assert.equal(list.entries.length, 1); assert.equal(list.entries[0].status, 'ready');
  assert.deepEqual(JSON.parse(exportSession(snapshot, at).json).session, snapshot);
  assert.equal(reader.getStatus().state, 'persisted');
  await assertUnchanged(f, before);
});

const invalidProfiles: [string, (snapshot: any) => void][] = [
  ['unknown stored snapshot schema', s => { s.schemaVersion = 'future-training-v99'; }],
  ['stored snapshot downgraded to v1', s => { s.schemaVersion = SCHEMA_VERSION; }],
  ['first event downgraded to v1', s => { s.events[0].schemaVersion = SCHEMA_VERSION; }],
  ['later event downgraded to v1', s => { s.events[1].schemaVersion = SCHEMA_VERSION; }],
  ['all discriminators downgraded to v1', s => { s.schemaVersion = SCHEMA_VERSION; for (const event of s.events) event.schemaVersion = SCHEMA_VERSION; }],
  ['stored snapshot missing source binding', s => { delete s.material.builtinReference; }],
  ['first event missing source binding', s => { delete s.events[0].material.builtinReference; }],
  ['stored snapshot altered media digest', s => { s.material.builtinReference.media.sha256 = '0'.repeat(64); }],
  ['first event altered media digest', s => { s.events[0].material.builtinReference.media.sha256 = '0'.repeat(64); }],
  ['stored material replaced with coffee', s => { s.material = structuredClone(CAFE_MATERIAL); }],
  ['first event replaced with coffee profile', s => { s.events[0].material = structuredClone(CAFE_MATERIAL); s.events[0].schemaVersion = SCHEMA_VERSION; }],
];
for (const [label, mutate] of invalidProfiles) test(`NPS ${label} is rejected on save and restore without writes or normalization`, async t => {
  const f = fixture(t), snapshot = exercise(engine(`invalid-${label}`));
  await f.repository.saveSession(snapshot);
  const altered = structuredClone(snapshot); mutate(altered);
  const validBefore = await facts(f);
  await assert.rejects(f.repository.saveSession(altered), /profile|schema|built-in|material|session start/i);
  await assertUnchanged(f, validBefore);
  // Direct IDB writes are restricted to deliberately corrupting test storage.
  await corruptStoredSnapshot(f, altered);
  const before = await facts(f);
  await assert.rejects(f.repository.loadLatest(), /profile|schema|built-in|material|session start/i);
  assert.equal(f.repository.getStatus().state, 'error');
  await assert.rejects(readTrainingHistoryBootstrap(f.repository), /profile|schema|built-in|material|session start/i);
  await assert.rejects(f.repository.loadHistorySession(snapshot.sessionId));
  const list = await f.repository.listHistory(); assert.equal(list.entries.length, 1); assert.equal(list.entries[0].status, 'error');
  await assertUnchanged(f, before);
});

test('coffee snapshot schema cannot be silently normalized from otherwise valid v1 events', async t => {
  const f = fixture(t), snapshot = exercise(engine('coffee-top-level', CAFE_MATERIAL));
  await f.repository.saveSession(snapshot);
  const altered = structuredClone(snapshot) as any; altered.schemaVersion = BUILTIN_TRAINING_SCHEMA;
  await corruptStoredSnapshot(f, altered);
  const before = await facts(f);
  await assert.rejects(f.repository.loadLatest(), /profile/);
  await assert.rejects(readTrainingHistoryBootstrap(f.repository), /profile/);
  await assertUnchanged(f, before);
});

async function savePartial(f: ReturnType<typeof fixture>, source: TrainingEngine): Promise<TrainingHistorySegment> {
  source.nextCue(1); source.input('PRIVATE_BEFORE_ON', 'typed', native('PRIVATE_BEFORE_ON'));
  const control = await f.repository.enableAutomaticHistory(0);
  assert.deepEqual(control, { state: 'segment-on', generation: 1 });
  const projector = new TrainingHistorySegmentProjector(source.getSnapshot(), { segmentId: 'new-nps-partial', writerInstanceId: 'new-writer', generation: 1, startedAt: at });
  const { permit } = await f.repository.beginTrainingHistorySegment(projector.getSegment(), 1);
  const unsubscribe = source.subscribe(() => projector.observe(source.getSnapshot()));
  try {
    source.input('PRIVATE_BEFORE_ON suffix', 'typed', native(' suffix')); source.submit();
    source.input('', 'typed', native('')); source.input(source.cue.text, 'typed', native(source.cue.text)); source.submit();
    const segment = projector.getSegment(); await f.repository.saveTrainingHistorySegment(permit, segment);
    assert.equal(JSON.stringify(segment).includes('PRIVATE_BEFORE_ON'), false);
    return segment;
  } finally { unsubscribe(); }
}
function decodeSegmentCSV(csv: string) {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    if (quoted) {
      if (char === '"') { if (csv[index + 1] === '"') { cell += '"'; index++; } else quoted = false; } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\r' && csv[index + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; index++; }
    else cell += char;
  }
  assert.equal(quoted, false); assert.deepEqual(row, []); assert.equal(cell, '');
  const [header, ...data] = rows; assert.deepEqual(header, ['row_type', 'field_or_ordinal', 'value_json']);
  const metadata: Record<string, unknown> = {}, projected: unknown[] = [];
  for (const [kind, key, value] of data) {
    if (kind === 'segment') metadata[key] = JSON.parse(value);
    else { assert.equal(kind, 'fact'); const fact = JSON.parse(value); assert.equal(fact.ordinal, Number(key)); projected.push(fact); }
  }
  return { ...metadata, facts: projected };
}

test('actual new partial writer keeps exact partial fields and NPS provenance while bootstrap never reconstructs its session', async t => {
  const f = fixture(t), source = engine('new-partial'), prefix = exercise(source);
  await f.repository.saveSession(prefix);
  const fullBefore = await facts(f), segment = await savePartial(f, source), before = await facts(f);
  assert.equal(segment.rules.trainingSchemaVersion, BUILTIN_TRAINING_SCHEMA);
  assert.deepEqual(Object.keys(segment).sort(), ['schemaVersion', 'sessionId', 'segmentId', 'writerInstanceId', 'generation', 'material', 'rules', 'startedAt', 'endedAt', 'coverage', 'replayable', 'facts'].sort());
  assert.deepEqual(Object.keys(segment.rules).sort(), ['trainingSchemaVersion', 'ruleVersion', 'paceRuleVersion'].sort());
  assert.deepEqual(segment.material, { id: NPS_MATERIAL.id, version: NPS_MATERIAL.version });
  assert.equal(segment.coverage, 'partial'); assert.equal(segment.replayable, false);
  assert.deepEqual(before.sessions, fullBefore.sessions); assert.deepEqual(before.events, fullBefore.events);
  assert.deepEqual(before.meta.find(row => row.key === 'latest'), fullBefore.meta.find(row => row.key === 'latest'));
  assert.deepEqual(await f.repository.loadTrainingHistorySegment(segment.segmentId), segment);
  const pack = exportTrainingHistorySegment(segment);
  assert.deepEqual(JSON.parse(pack.json), segment); assert.deepEqual(decodeSegmentCSV(pack.csv), segment);
  const bootstrap = await readTrainingHistoryBootstrap(f.repository); assert.equal(bootstrap.saved, null); assert.equal(bootstrap.temporary, true);
  await assertUnchanged(f, before);
});

// Independent archived v65 readers, never copies of the candidate code. The
// optional archive keeps the portable unit suite usable; release validation
// must set this path and run these tests with zero skipped cases.
const frozenRoot = process.env.LINGOTRACE_FROZEN_V65_DIR ?? '/workspace/shared/lingotrace-nps-scope-v66/frozen-v65';
const frozenAvailable = existsSync(join(frozenRoot, 'studio/core/repository.ts'));
const archivedOnly = { skip: frozenAvailable ? false : 'Set LINGOTRACE_FROZEN_V65_DIR to the immutable 18eaf70 archive for release compatibility validation.' };
const frozenHashes: Record<string, string> = {
  repository: 'ad58a91b09054f73249934d64ae2813461cb1cf1eb915b540121aaf9ef0c919a',
  training: '623b200b1e2d09823bd1801b141da074d671ef2ac4f325ae8cf75b423c4727df',
  'training-history-bootstrap': 'e497cf7f3ab44cc452d8d3bde0d070219603c4e8e47f60791fb818cb983c40e9',
  'training-history-segment': '2f6078b09909c421d113807c71ebd478e5708f3e87aa1bb84d0e7355fed22ff6',
  'segment-history-reader': '5f452a24f21f2be4d537461f86729f5eaf186c175f4e43554e590df253d2d89a',
  'legacy-history': '995caa8c8af5aa19a3bca11ec94293e0128160989343f0ffde1f0a70015b37d6',
  'review-tasks': '77f5cb86d915bf0e2a8293aa0bd3f28500988edd74ecddf4a319085cc9524d07',
  'review-task-storage': 'd4754b49c8234a363b50105725acd0874182c77e3fdcd5c5d1696d1638b5ef2b',
};
async function frozen() {
  for (const [name, expected] of Object.entries(frozenHashes)) assert.equal(createHash('sha256').update(readFileSync(join(frozenRoot, `studio/core/${name}.ts`))).digest('hex'), expected, `${name} must be frozen v65, not candidate code`);
  const load = (name: string) => import(pathToFileURL(join(frozenRoot, `studio/core/${name}.ts`)).href);
  const [repository, training, bootstrap, partial, projector, fullExport, review] = await Promise.all(['repository', 'training', 'training-history-bootstrap', 'segment-history-reader', 'training-history-segment', 'session-export', 'review-tasks'].map(load));
  return { repository, training, bootstrap, partial, projector, fullExport, review };
}

test('frozen v65 explicitly rejects real new full writer on old-open and refreshed restores, lists unavailable NPS, and preserves readable coffee and all bytes', archivedOnly, async t => {
  const old = await frozen(), f = fixture(t), reader = new old.repository.IndexedDBTrainingRepository(f.options);
  t.after(() => reader.close());
  const coffeeEngine = new old.training.TrainingEngine({ sessionId: 'retained-old-coffee', clock: clock('retained-old-coffee') });
  const coffee = exercise(coffeeEngine); await reader.saveSession(coffee);
  const snapshot = exercise(engine('genuine-new-nps')); await f.repository.saveSession(snapshot);
  const before = await facts(f);
  await assert.rejects(reader.loadLatest(), /Unsupported event schema/); assert.equal(reader.getStatus().state, 'error');
  await assert.rejects(old.bootstrap.readTrainingHistoryBootstrap(reader), /Unsupported event schema/);
  assert.throws(() => old.training.replay(snapshot.events, snapshot.material), /Unsupported event schema/);
  const refreshed = new old.repository.IndexedDBTrainingRepository(f.options); t.after(() => refreshed.close());
  await assert.rejects(refreshed.loadLatest(), /Unsupported event schema/);
  const list = await reader.listHistory(); assert.equal(list.entries.length, 2);
  assert.equal(list.entries.find((entry: any) => entry.status === 'ready')?.summary.sessionId, coffee.sessionId);
  assert.equal(list.entries.find((entry: any) => entry.status === 'error')?.sessionId, snapshot.sessionId);
  assert.equal(list.entries.find((entry: any) => entry.status === 'error')?.error.code, 'unsupported-schema');
  assert.deepEqual((await reader.loadHistorySession(coffee.sessionId))?.snapshot, coffee);
  await assert.rejects(reader.loadHistorySession(snapshot.sessionId), { code: 'unsupported-schema' });
  assert.equal(before.meta.find(row => row.key === 'latest')?.sessionId, snapshot.sessionId);
  await assertUnchanged(f, before);
});

test('frozen v65 reads and JSON/CSV exports real new partial facts unchanged, and bootstrap returns saved:null without loading full latest', archivedOnly, async t => {
  const old = await frozen(), f = fixture(t), source = engine('frozen-partial');
  await f.repository.saveSession(exercise(source));
  const segment = await savePartial(f, source), before = await facts(f);
  const reader = new old.repository.IndexedDBTrainingRepository(f.options); t.after(() => reader.close());
  let restoreCalls = 0;
  const loadLatest = reader.loadLatest.bind(reader); reader.loadLatest = async () => { restoreCalls++; return loadLatest(); };
  const bootstrap = await old.bootstrap.readTrainingHistoryBootstrap(reader);
  assert.equal(bootstrap.saved, null); assert.equal(bootstrap.temporary, true); assert.equal(restoreCalls, 0);
  assert.equal((await reader.listTrainingHistorySegments()).entries.length, 1);
  const loaded = await reader.loadTrainingHistorySegment(segment.segmentId); assert.deepEqual(loaded, segment);
  const pack = old.partial.exportTrainingHistorySegment(loaded);
  assert.deepEqual(JSON.parse(pack.json), segment); assert.deepEqual(decodeSegmentCSV(pack.csv), segment);
  assert.deepEqual(pack, exportTrainingHistorySegment(segment));
  let deliveries = 0; await reader.deliverTrainingHistorySegment(segment.segmentId, loaded, () => { deliveries++; }); assert.equal(deliveries, 1);
  await assertUnchanged(f, before);
});

test('frozen and current coffee full snapshots, scores, JSON/CSV and partial projections remain identical', archivedOnly, async t => {
  const old = await frozen(), f = fixture(t);
  const current = engine('same-coffee', CAFE_MATERIAL), previous = new old.training.TrainingEngine({ sessionId: 'same-coffee', clock: clock('same-coffee') });
  const snapshot = exercise(current), baseline = exercise(previous);
  assert.deepEqual(snapshot, baseline); assert.equal(snapshot.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(exportSession(snapshot, at), old.training.exportSession(baseline, at));
  assert.deepEqual(exportStudioSession(snapshot, at), old.fullExport.exportStudioSession(baseline, at));
  await f.repository.saveSession(snapshot); const before = await facts(f);
  assert.deepEqual(await f.repository.loadLatest(), baseline);
  assert.deepEqual((await readTrainingHistoryBootstrap(f.repository)).saved, baseline);
  assert.deepEqual((await f.repository.loadHistorySession(snapshot.sessionId))?.snapshot, baseline);
  const options = { segmentId: 'same-coffee-segment', writerInstanceId: 'same-coffee-writer', generation: 1, startedAt: at };
  const currentProjection = new TrainingHistorySegmentProjector(snapshot, options), oldProjection = new old.projector.TrainingHistorySegmentProjector(baseline, options);
  for (const [source, projection] of [[current, currentProjection], [previous, oldProjection]] as const) {
    source.nextCue(1); source.input(source.cue.text, 'typed', native(source.cue.text)); source.submit(); projection.observe(source.getSnapshot());
  }
  assert.deepEqual(currentProjection.getSegment(), oldProjection.getSegment());
  assert.deepEqual(exportTrainingHistorySegment(currentProjection.getSegment()), old.partial.exportTrainingHistorySegment(oldProjection.getSegment()));
  await assertUnchanged(f, before);
});

function reviewSource(snapshot: TrainingSnapshot): ReviewSourceLocator {
  const attempt = snapshot.attempts.at(-1)!;
  return { kind: 'full', sessionId: snapshot.sessionId, attemptId: attempt.attemptId,
    submitEventId: snapshot.events.find(event => event.type === 'submitRequested' && event.attemptId === attempt.attemptId)!.eventId,
    judgmentEventId: snapshot.events.find(event => event.type === 'judgmentApplied' && event.attemptId === attempt.attemptId)!.eventId };
}

test('frozen v65 leaves a real new-writer NPS review task unreadable and refuses retest, while same-database old coffee tasks remain readable and preparable', archivedOnly, async t => {
  const old = await frozen(), f = fixture(t), reader = new old.repository.IndexedDBTrainingRepository(f.options);
  t.after(() => reader.close());
  const due = resolveReviewLocalTime('2026-10-12T10:00', 'UTC')[0], nextDue = resolveReviewLocalTime('2026-10-13T10:00', 'UTC')[0];
  const coffeeEngine = new old.training.TrainingEngine({ sessionId: 'original-coffee-review', clock: clock('original-coffee-review') });
  const coffee = exercise(coffeeEngine); await reader.saveSession(coffee);
  const coffeeTarget = await old.review.buildReviewTarget(old.training.CAFE_MATERIAL, coffee.attempts[0].cueId,
    { id: LOCAL_REFERENCE_MEDIA_ID, sha256: LOCAL_REFERENCE_MEDIA_SHA256, durationSeconds: 72 });
  const oldCoffeeTask = await reader.createReviewTask({ requestId: 'original-coffee-request', source: reviewSource(coffee), target: coffeeTarget, due });
  const nps = exercise(engine('actual-nps-review')); await f.repository.saveSession(nps);
  const { id, sha256, durationSeconds } = NPS_MATERIAL.builtinReference.media;
  const npsTarget = await buildReviewTarget(NPS_MATERIAL, nps.attempts[0].cueId, { id, sha256, durationSeconds });
  const newNpsTask = await f.repository.createReviewTask({ requestId: 'actual-nps-request', source: reviewSource(nps), target: npsTarget, due });
  assert.equal(newNpsTask.disposition, 'created');
  assert.deepEqual(newNpsTask.task.target.material, NPS_MATERIAL);
  assert.deepEqual(await f.repository.loadReviewTask(newNpsTask.task.taskId), newNpsTask.task);
  const before = await facts(f);
  assert.equal(before.version, 1); assert.equal(before.meta.some(row => row.key === AUTOMATIC_HISTORY_CONTROL_KEY), false);
  assert.equal(before.meta.find(row => row.key === 'latest')?.sessionId, nps.sessionId);

  const listed = await reader.listReviewTasks();
  assert.deepEqual(listed, { entries: [oldCoffeeTask.task], unreadableCount: 1 });
  await assert.rejects(reader.loadReviewTask(newNpsTask.task.taskId), { code: 'invalid-record' });
  await assert.rejects(reader.prepareReviewRetest({ taskId: newNpsTask.task.taskId, expectedRevision: newNpsTask.task.revision, nextDue }), { code: 'invalid-record' });
  assert.deepEqual(await reader.loadReviewTask(oldCoffeeTask.task.taskId), oldCoffeeTask.task);
  assert.deepEqual((await reader.loadHistorySession(coffee.sessionId))?.snapshot, coffee);
  await assertUnchanged(f, before);

  // A legitimate old coffee plan may change its own two metadata records only.
  const coffeePlan = await reader.prepareReviewRetest({ taskId: oldCoffeeTask.task.taskId, expectedRevision: oldCoffeeTask.task.revision, nextDue });
  assert.deepEqual(coffeePlan.task.target, oldCoffeeTask.task.target);
  assert.deepEqual(coffeePlan.task.source, oldCoffeeTask.task.source);
  assert.deepEqual(coffeePlan.instance.nextDue, nextDue);
  assert.equal(coffeePlan.task.revision, oldCoffeeTask.task.revision + 1);
  const after = await facts(f), changedCoffeeKeys = new Set([`review-task-v1:${oldCoffeeTask.task.taskId}`, `review-instance-v1:${oldCoffeeTask.instance.instanceId}`]);
  assert.equal(after.version, before.version); assert.deepEqual(after.sessions, before.sessions); assert.deepEqual(after.events, before.events);
  const retainedBefore = before.meta.filter(row => !changedCoffeeKeys.has(row.key)), retainedAfter = after.meta.filter(row => !changedCoffeeKeys.has(row.key));
  assert.deepEqual(retainedAfter, retainedBefore); assert.equal(JSON.stringify(retainedAfter), JSON.stringify(retainedBefore));
  assert.deepEqual(await f.repository.loadReviewTask(newNpsTask.task.taskId), newNpsTask.task);
  assert.deepEqual(await reader.listReviewTasks(), { entries: [coffeePlan.task], unreadableCount: 1 });
});
