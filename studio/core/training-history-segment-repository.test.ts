import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBDatabase, IDBObjectStore } from 'fake-indexeddb';
import {
  IndexedDBTrainingRepository, TRAINING_HISTORY_SEGMENT_KEY_PREFIX, readTrainingHistorySegment,
  type TrainingHistorySegmentPermit,
} from './repository.ts';
import { TrainingEngine, type NativeEditEvidence } from './training.ts';
import { TrainingHistorySegmentProjector, type TrainingHistorySegment } from './training-history-segment.ts';
import { AUTOMATIC_HISTORY_CONTROL_KEY, AutomaticHistoryWriteFenceError } from './automatic-history-control.ts';

const native = (text: string): NativeEditEvidence => ({ version: 'dom-edit-v1', kind: 'input', inputType: text ? 'insertText' : 'deleteContentBackward', data: text || null });
function fixture(t: TestContext) {
  const factory = new IDBFactory(), dbName = `segment-repository-${t.name}`, options = { indexedDB: factory, dbName };
  const repository = new IndexedDBTrainingRepository(options);
  let serial = 0;
  const clock = { now: () => 0, wallTime: () => '2026-10-09T09:00:00.000Z', id: () => `event-${++serial}` };
  const engine = new TrainingEngine({ sessionId: 'same-live-session', clock });
  t.after(() => repository.close());
  const projector = (generation: number, segmentId = `segment-${++serial}`, source = engine, writerInstanceId = 'writer-one') => new TrainingHistorySegmentProjector(source.getSnapshot(), { generation, segmentId, writerInstanceId, startedAt: clock.wallTime() });
  return { factory, dbName, options, repository, engine, projector, input(text: string) { engine.input(text, 'typed', native(text)); },
    async admit(generation = 1) { const p = projector(generation), admission = await repository.beginTrainingHistorySegment(p.getSegment(), generation); return { p, ...admission }; },
    peer() { const peer = new IndexedDBTrainingRepository(options); t.after(() => peer.close()); return peer; },
  };
}
function open(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => { const request = factory.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });
}
interface Facts { sessions: unknown[]; events: unknown[]; meta: { key: string; [key: string]: unknown }[] }
async function facts(factory: IDBFactory, dbName: string): Promise<Facts> {
  const db = await open(factory, dbName);
  try {
    const tx = db.transaction(['sessions', 'events', 'meta'], 'readonly'), result = {} as Facts;
    for (const name of ['sessions', 'events', 'meta'] as const) { const r = tx.objectStore(name).getAll(); r.onsuccess = () => { result[name] = r.result; }; }
    await done(tx); return result;
  } finally { db.close(); }
}
async function changeMeta(f: ReturnType<typeof fixture>, work: (store: IDBObjectStore) => void) {
  const db = await open(f.factory, f.dbName);
  try { const tx = db.transaction('meta', 'readwrite'); work(tx.objectStore('meta')); await done(tx); } finally { db.close(); }
}
function fence(reason?: AutomaticHistoryWriteFenceError['reason']) { return (error: unknown) => error instanceof AutomaticHistoryWriteFenceError && (!reason || error.reason === reason); }
function oldFacts(value: Facts) { return { sessions: value.sessions, events: value.events, latest: value.meta.find(row => row.key === 'latest') }; }
const key = (id: string) => `${TRAINING_HISTORY_SEGMENT_KEY_PREFIX}${id}`;

// Real adapter calls with fake IndexedDB exercise transaction ordering and rollback,
// not a map substitute. Browser scheduling still needs browser verification.
test('OFF to ON preserves the same live engine and all old v1 facts, saving only allowlisted post-ON segments', async t => {
  const f = fixture(t); f.input('OLD_SAVED_ANSWER'); await f.repository.saveSession(f.engine.getSnapshot());
  const before = oldFacts(await facts(f.factory, f.dbName));
  await f.repository.disableAutomaticHistory();
  f.input('PRIVATE_OFF_MARKER'); f.engine.submit();
  const privateState = f.engine.getSnapshot();
  const on = await f.repository.enableAutomaticHistory(1); assert.deepEqual(on, { state: 'segment-on', generation: 2 });
  assert.strictEqual(f.engine.getSnapshot(), privateState);
  const { p, permit } = await f.admit(2);
  const unwatch = f.engine.subscribe(() => p.observe(f.engine.getSnapshot())); t.after(unwatch);
  f.input('PRIVATE_OFF_MARKER suffix'); f.engine.submit();
  f.input(''); f.input('FRESH_ON_ANSWER'); f.engine.submit();
  const visible = p.getSegment(); await f.repository.saveTrainingHistorySegment(permit, visible);
  await assert.rejects(f.repository.saveSession(f.engine.getSnapshot()), fence('segment-mode'));
  const stored = await facts(f.factory, f.dbName);
  assert.deepEqual(oldFacts(stored), before);
  const segmentRows = stored.meta.filter(row => row.key.startsWith(TRAINING_HISTORY_SEGMENT_KEY_PREFIX));
  assert.equal(segmentRows.length, 1);
  const json = JSON.stringify(segmentRows);
  assert.equal(json.includes('PRIVATE_OFF_MARKER'), false); assert.equal(json.includes('OLD_SAVED_ANSWER'), false);
  assert.equal(json.includes('FRESH_ON_ANSWER'), true);
  for (const field of ['"events"', '"drafts"', '"attempts"', '"activeMs"', '"earnedWords"', '"inputObservation"', '"gain"']) assert.equal(json.includes(field), false, field);
  assert.deepEqual(await f.repository.loadTrainingHistorySegment(visible.segmentId), visible);
  assert.deepEqual(await f.factory.databases(), [{ name: f.dbName, version: 2 }]);
  assert.equal(f.engine.getSnapshot().sessionId, privateState.sessionId);
});

test('explicit ON persists answer-free v2 policy and never enables full snapshot saving', async t => {
  const f = fixture(t);
  await f.repository.enableAutomaticHistory(0);
  await assert.rejects(f.repository.saveSession(f.engine.getSnapshot()), fence('segment-mode'));
  assert.deepEqual(await facts(f.factory, f.dbName), { sessions: [], events: [], meta: [{ key: AUTOMATIC_HISTORY_CONTROL_KEY, version: 2, mode: 'segments', automaticHistoryEnabled: true, generation: 1 }] });
  const off = await f.repository.disableAutomaticHistory(1); assert.deepEqual(off, { state: 'segment-off', generation: 2 });
  await assert.rejects(f.repository.saveSession(f.engine.getSnapshot()), fence('local-off'));
  assert.deepEqual(await f.repository.enableAutomaticHistory(2), { state: 'segment-on', generation: 3 });
  await assert.rejects(f.repository.saveSession(f.engine.getSnapshot()), fence('segment-mode'));
});

test('configuration reads on a fresh page cannot grant write permission; explicit already-ON enable grants a fresh admission', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const peer = f.peer();
  assert.deepEqual(await peer.readAutomaticHistoryControl(), { state: 'segment-on', generation: 1 });
  const p = f.projector(1);
  await assert.rejects(peer.beginTrainingHistorySegment(p.getSegment(), 1), fence('stale-generation'));
  await peer.enableAutomaticHistory(1); const admitted = await peer.beginTrainingHistorySegment(p.getSegment(), 1);
  await assert.rejects(f.repository.saveTrainingHistorySegment(admitted.permit, p.getSegment()), fence('invalid-permit'));
  assert.deepEqual(await peer.readAutomaticHistoryControl(), { state: 'segment-on', generation: 1 });
});

test('only authenticated empty initial projections are admitted; clones and forged permits cannot write', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const p = f.projector(1);
  const before = await facts(f.factory, f.dbName);
  await assert.rejects(f.repository.beginTrainingHistorySegment(structuredClone(p.getSegment()), 1), /live projector/);
  f.input('NEW'); p.observe(f.engine.getSnapshot());
  await assert.rejects(f.repository.beginTrainingHistorySegment(p.getSegment(), 1), fence('invalid-permit'));
  assert.deepEqual(await facts(f.factory, f.dbName), before);
  const { p: fresh, permit } = await f.admit();
  await assert.rejects(f.repository.saveTrainingHistorySegment(permit, structuredClone(fresh.getSegment())), /live projector/);
  await assert.rejects(f.repository.saveTrainingHistorySegment(Object.freeze({}) as TrainingHistorySegmentPermit, fresh.getSegment()), fence('invalid-permit'));
});

test('exact repeated admission, batch retry and older batch delivery are idempotent', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const p = f.projector(1);
  const first = f.repository.beginTrainingHistorySegment(p.getSegment(), 1);
  assert.strictEqual(f.repository.beginTrainingHistorySegment(p.getSegment(), 1), first);
  const { permit } = await first; assert.strictEqual((await f.repository.beginTrainingHistorySegment(p.getSegment(), 1)).permit, permit);
  f.input('one'); const older = p.observe(f.engine.getSnapshot()); await f.repository.saveTrainingHistorySegment(permit, older);
  f.input('one two'); const newer = p.observe(f.engine.getSnapshot()); await f.repository.saveTrainingHistorySegment(permit, newer);
  const before = await facts(f.factory, f.dbName);
  assert.deepEqual(await f.repository.saveTrainingHistorySegment(permit, older), newer);
  assert.deepEqual(await f.repository.saveTrainingHistorySegment(permit, newer), newer);
  assert.deepEqual(await facts(f.factory, f.dbName), before);
});

test('OFF synchronously revokes queued writes and stale callbacks cannot be retagged under a later ON generation', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const { p, permit } = await f.admit();
  const initial = await f.repository.loadTrainingHistorySegment(p.getSegment().segmentId);
  f.input('QUEUED'); const batch = p.observe(f.engine.getSnapshot());
  const write = f.repository.saveTrainingHistorySegment(permit, batch), rejection = assert.rejects(write, fence('local-off'));
  const off = f.repository.disableAutomaticHistory(1);
  assert.equal(f.repository.getAutomaticHistoryStatus().locallyStopped, true);
  await Promise.all([rejection, off]);
  assert.deepEqual(await f.repository.loadTrainingHistorySegment(batch.segmentId), initial);
  await f.repository.enableAutomaticHistory(2);
  await assert.rejects(f.repository.saveTrainingHistorySegment(permit, batch), fence('local-off'));
  await assert.rejects(f.repository.beginTrainingHistorySegment(batch, 3), fence('invalid-permit'));
  assert.deepEqual(await f.repository.loadTrainingHistorySegment(batch.segmentId), initial);
});

for (const point of ['add', 'put-success'] as const) {
  test(`OFF aborts active segment transaction at ${point} without changing prior durable facts`, async t => {
    const f = fixture(t); await f.repository.enableAutomaticHistory(0);
    let p = f.projector(1), permit: TrainingHistorySegmentPermit | undefined;
    if (point === 'put-success') { const admitted = await f.repository.beginTrainingHistorySegment(p.getSegment(), 1); permit = admitted.permit; f.input('IN_FLIGHT'); p.observe(f.engine.getSnapshot()); }
    const before = await facts(f.factory, f.dbName), originalAdd = IDBObjectStore.prototype.add, originalPut = IDBObjectStore.prototype.put;
    let off: Promise<unknown> | undefined;
    const stop = () => { off = f.repository.disableAutomaticHistory(1); };
    IDBObjectStore.prototype.add = function(value, at) {
      const request = originalAdd.call(this, value, at);
      if (point === 'add' && this.name === 'meta' && value.key?.startsWith(TRAINING_HISTORY_SEGMENT_KEY_PREFIX)) stop();
      return request;
    };
    IDBObjectStore.prototype.put = function(value, at) {
      const request = originalPut.call(this, value, at);
      if (point === 'put-success' && this.name === 'meta' && value.key?.startsWith(TRAINING_HISTORY_SEGMENT_KEY_PREFIX)) request.addEventListener('success', stop);
      return request;
    };
    try {
      await assert.rejects(permit ? f.repository.saveTrainingHistorySegment(permit, p.getSegment()) : f.repository.beginTrainingHistorySegment(p.getSegment(), 1), fence('local-off'));
      await off;
    } finally { IDBObjectStore.prototype.add = originalAdd; IDBObjectStore.prototype.put = originalPut; }
    assert.ok(off);
    assert.deepEqual((await facts(f.factory, f.dbName)).meta.filter(row => row.key !== AUTOMATIC_HISTORY_CONTROL_KEY), before.meta.filter(row => row.key !== AUTOMATIC_HISTORY_CONTROL_KEY));
    assert.equal(f.repository.getStatus().pendingWrites, 0);
  });
}

test('pending admission listeners can request OFF and cannot obtain a useful permit', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const p = f.projector(1);
  let off: Promise<unknown> | undefined;
  f.repository.subscribe(() => { if (!off && f.repository.getStatus().state === 'pending') off = f.repository.disableAutomaticHistory(1); });
  await assert.rejects(f.repository.beginTrainingHistorySegment(p.getSegment(), 1), fence('local-off')); await off;
  assert.equal(await f.repository.loadTrainingHistorySegment(p.getSegment().segmentId), null);
  assert.equal(f.repository.getStatus().pendingWrites, 0);
});

test('OFF from an admission success observer prevents issuing a usable permit after the commit', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const p = f.projector(1);
  let off: Promise<unknown> | undefined, triggered = false;
  f.repository.subscribe(() => { if (!triggered && f.repository.getStatus().state === 'persisted') { triggered = true; off = f.repository.disableAutomaticHistory(1); } });
  await assert.rejects(f.repository.beginTrainingHistorySegment(p.getSegment(), 1), fence('local-off')); await off;
  assert.deepEqual(await f.repository.loadTrainingHistorySegment(p.getSegment().segmentId), p.getSegment(), 'empty initial segment committed before the later OFF intent');
  assert.equal(f.repository.getStatus().pendingWrites, 0);
});

test('explicit permit revocation and repository close synchronously stop late and queued callbacks', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const { p, permit } = await f.admit();
  f.input('LATE'); const batch = p.observe(f.engine.getSnapshot()), before = await facts(f.factory, f.dbName);
  const write = f.repository.saveTrainingHistorySegment(permit, batch), failed = assert.rejects(write, fence('invalid-permit'));
  f.repository.revokeTrainingHistorySegment(permit); await failed;
  await assert.rejects(f.repository.saveTrainingHistorySegment(permit, batch), fence('invalid-permit'));
  await assert.rejects(f.repository.beginTrainingHistorySegment(f.projector(1, batch.segmentId).getSegment(), 1), fence('invalid-permit'));
  const next = await f.admit(); f.input('CLOSE_LATE'); next.p.observe(f.engine.getSnapshot());
  const pending = f.repository.saveTrainingHistorySegment(next.permit, next.p.getSegment()), closed = assert.rejects(pending, fence('closed'));
  await f.repository.close(); await closed;
  assert.deepEqual(await f.repository.loadTrainingHistorySegment(batch.segmentId), before.meta.find(row => row.key === key(batch.segmentId))?.segment);
  await assert.rejects(f.repository.enableAutomaticHistory(1), fence('closed'));
});

test('a missing head cannot be recreated by a valid formerly admitted writer', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const { p, permit } = await f.admit();
  await changeMeta(f, store => { store.delete(key(p.getSegment().segmentId)); });
  f.input('AFTER_REMOVAL'); p.observe(f.engine.getSnapshot());
  await assert.rejects(f.repository.saveTrainingHistorySegment(permit, p.getSegment()), fence('invalid-permit'));
  assert.equal(await f.repository.loadTrainingHistorySegment(p.getSegment().segmentId), null);
  await assert.rejects(f.repository.beginTrainingHistorySegment(f.projector(1, p.getSegment().segmentId).getSegment(), 1), fence('invalid-permit'));
});

test('authenticated conflicting fact prefixes cannot replace an existing segment', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const p = f.projector(1, 'conflict');
  const otherEngine = new TrainingEngine({ snapshot: f.engine.getSnapshot(), clock: { now: () => 0, wallTime: () => '2026-10-09T09:00:00.000Z', id: () => 'other-event' } });
  const other = f.projector(1, 'conflict', otherEngine);
  const { permit } = await f.repository.beginTrainingHistorySegment(p.getSegment(), 1);
  f.input('GOOD'); p.observe(f.engine.getSnapshot()); await f.repository.saveTrainingHistorySegment(permit, p.getSegment());
  const before = await facts(f.factory, f.dbName);
  otherEngine.input('CONFLICT', 'typed', native('CONFLICT')); other.observe(otherEngine.getSnapshot());
  await assert.rejects(f.repository.saveTrainingHistorySegment(permit, other.getSegment()), /existing facts were preserved/);
  assert.deepEqual(await facts(f.factory, f.dbName), before);
});

test('an explicitly closed segment cannot be reopened or extended and close retry remains idempotent', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const { p, permit } = await f.admit();
  const openSegment = p.getSegment();
  const closed = p.close('2026-10-09T10:00:00.000Z'); await f.repository.saveTrainingHistorySegment(permit, closed);
  const before = await facts(f.factory, f.dbName);
  assert.deepEqual(await f.repository.saveTrainingHistorySegment(permit, openSegment), closed);
  assert.deepEqual(await f.repository.saveTrainingHistorySegment(permit, closed), closed);
  const rogue = f.projector(1, closed.segmentId); f.input('AFTER_CLOSED'); rogue.observe(f.engine.getSnapshot());
  await assert.rejects(f.repository.saveTrainingHistorySegment(permit, rogue.getSegment()), /closed history segment/);
  assert.deepEqual(await facts(f.factory, f.dbName), before);
});

test('cross-instance control compares reject stale toggles and stale generations under the same meta lock', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const { p, permit } = await f.admit(), peer = f.peer();
  assert.deepEqual(await peer.disableAutomaticHistory(1), { state: 'segment-off', generation: 2 });
  f.input('AFTER_REMOTE_OFF'); p.observe(f.engine.getSnapshot());
  await assert.rejects(f.repository.saveTrainingHistorySegment(permit, p.getSegment()), fence('persisted-off'));
  const before = await facts(f.factory, f.dbName);
  await assert.rejects(f.repository.enableAutomaticHistory(1), fence('stale-generation'));
  assert.equal(f.repository.getAutomaticHistoryStatus().locallyStopped, true);
  assert.deepEqual(await facts(f.factory, f.dbName), before);
  await peer.enableAutomaticHistory(2);
  await assert.rejects(f.repository.disableAutomaticHistory(2), fence('stale-generation'));
  assert.deepEqual(await peer.readAutomaticHistoryControl(), { state: 'segment-on', generation: 3 });
  assert.equal(f.repository.getAutomaticHistoryStatus().locallyStopped, true);
});

test('remote OFF then ON does not let an old-generation permit resume', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const { p, permit } = await f.admit(), peer = f.peer();
  await peer.disableAutomaticHistory(1); await peer.enableAutomaticHistory(2);
  f.input('OLD_GENERATION'); p.observe(f.engine.getSnapshot());
  await assert.rejects(f.repository.saveTrainingHistorySegment(permit, p.getSegment()), fence('stale-generation'));
  assert.deepEqual((await f.repository.loadTrainingHistorySegment(p.getSegment().segmentId))?.facts, []);
});

test('rapid OFF then explicit ON can use its own receipt, and a pending listener cannot reverse the queue', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0);
  const off = f.repository.disableAutomaticHistory(1);
  const on = off.then(receipt => f.repository.enableAutomaticHistory(receipt.generation));
  assert.deepEqual(await on, { state: 'segment-on', generation: 3 });
  let nested: Promise<unknown> | undefined, triggered = false;
  f.repository.subscribe(() => {
    if (!triggered && f.repository.getAutomaticHistoryStatus().settingsState === 'pending') {
      triggered = true; nested = assert.rejects(f.repository.enableAutomaticHistory(3), fence('stale-generation'));
    }
  });
  assert.deepEqual(await f.repository.disableAutomaticHistory(3), { state: 'segment-off', generation: 4 });
  await nested;
  assert.equal(f.repository.getAutomaticHistoryStatus().locallyStopped, true);
  assert.deepEqual(await f.repository.readAutomaticHistoryControl(), { state: 'segment-off', generation: 4 });
});

test('failed ON and failed segment writes preserve old facts, local stop, and truthful errors through read/export', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const { p, permit } = await f.admit();
  const initial = p.getSegment(), before = await facts(f.factory, f.dbName);
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(value, at) { if (this.name === 'meta') throw new DOMException('Injected quota', 'QuotaExceededError'); return original.call(this, value, at); };
  try { f.input('UNSAVED'); p.observe(f.engine.getSnapshot()); await assert.rejects(f.repository.saveTrainingHistorySegment(permit, p.getSegment()), { name: 'QuotaExceededError' }); }
  finally { IDBObjectStore.prototype.put = original; }
  const status = f.repository.getStatus(); let delivered = 0;
  await f.repository.listTrainingHistorySegments(); await f.repository.loadTrainingHistorySegment(initial.segmentId);
  await f.repository.deliverTrainingHistorySegment(initial.segmentId, initial, () => { delivered++; });
  assert.strictEqual(f.repository.getStatus(), status); assert.equal(delivered, 1);
  assert.deepEqual(await facts(f.factory, f.dbName), before);
  await f.repository.disableAutomaticHistory(1); const offFacts = await facts(f.factory, f.dbName);
  IDBObjectStore.prototype.put = function(value, at) { if (this.name === 'meta') throw new DOMException('Injected quota', 'QuotaExceededError'); return original.call(this, value, at); };
  try { await assert.rejects(f.repository.enableAutomaticHistory(2), { name: 'QuotaExceededError' }); } finally { IDBObjectStore.prototype.put = original; }
  assert.deepEqual(await facts(f.factory, f.dbName), offFacts);
  const settings = f.repository.getAutomaticHistoryStatus(); assert.equal(settings.locallyStopped, true); assert.equal(settings.settingsState, 'not-persisted');
  await f.repository.readAutomaticHistoryControl(); await f.repository.listTrainingHistorySegments();
  assert.strictEqual(f.repository.getAutomaticHistoryStatus(), settings);
});

test('absent history reads and failed final export never create a database or change save state', async t => {
  const f = fixture(t); const status = f.repository.getStatus(), settings = f.repository.getAutomaticHistoryStatus();
  assert.deepEqual(await f.repository.listTrainingHistorySegments(), { entries: [], limit: 100, hasMore: false, nextCursor: null });
  assert.equal(await f.repository.loadTrainingHistorySegment('absent'), null);
  await assert.rejects(f.repository.deliverTrainingHistorySegment('absent', f.projector(1, 'absent').getSegment(), () => {}), /no longer exists/);
  assert.deepEqual(await f.factory.databases(), []);
  assert.strictEqual(f.repository.getStatus(), status); assert.strictEqual(f.repository.getAutomaticHistoryStatus(), settings);
});

test('historical exports remain available while OFF and after new generations, but reject changed or removed selections', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const { p, permit } = await f.admit();
  const initial = p.getSegment(); f.input('RECORDED'); p.observe(f.engine.getSnapshot()); await f.repository.saveTrainingHistorySegment(permit, p.getSegment());
  let delivered = 0;
  await assert.rejects(f.repository.deliverTrainingHistorySegment(initial.segmentId, initial, () => { delivered++; }), /changed/);
  const selected = await f.repository.loadTrainingHistorySegment(initial.segmentId); assert.ok(selected);
  await f.repository.disableAutomaticHistory(1);
  const status = f.repository.getStatus(), settings = f.repository.getAutomaticHistoryStatus();
  await f.repository.deliverTrainingHistorySegment(initial.segmentId, selected, () => { delivered++; });
  assert.strictEqual(f.repository.getStatus(), status); assert.strictEqual(f.repository.getAutomaticHistoryStatus(), settings);
  await f.repository.enableAutomaticHistory(2); await f.repository.deliverTrainingHistorySegment(initial.segmentId, selected, () => { delivered++; });
  assert.equal(delivered, 2);
  await changeMeta(f, store => { store.delete(key(initial.segmentId)); });
  await assert.rejects(f.repository.deliverTrainingHistorySegment(initial.segmentId, selected, () => { delivered++; }), /no longer exists/);
  assert.equal(delivered, 2);
});

test('final export clones selection before awaiting and holds a readonly lock through the synchronous sink', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const { p } = await f.admit();
  const selected = structuredClone(p.getSegment()), db = await open(f.factory, f.dbName), order: string[] = [];
  let deletion: Promise<void> | undefined;
  const exporting = f.repository.deliverTrainingHistorySegment(selected.segmentId, selected, () => {
    order.push('sink'); const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').delete(key(selected.segmentId));
    deletion = done(tx).then(() => { order.push('deleted'); }); order.push('sink-finished');
  });
  (selected as { generation: number }).generation = 123;
  await exporting; await deletion; db.close();
  assert.deepEqual(order, ['sink', 'sink-finished', 'deleted']);
});

test('read boundaries reject unexpected raw fields and malformed fact identities without changing saved records', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const { p, permit } = await f.admit();
  f.input('new'); p.observe(f.engine.getSnapshot()); await f.repository.saveTrainingHistorySegment(permit, p.getSegment());
  const originalSegment = p.getSegment();
  for (const modify of [
    (s: Record<string, unknown>) => { s.drafts = { private: 'NEVER_EXPORT' }; },
    (s: Record<string, unknown>) => { (s.facts as Record<string, unknown>[])[0].nativeEdit = { data: 'NEVER_EXPORT' }; },
    (s: Record<string, unknown>) => { (s.facts as Record<string, unknown>[])[0].ordinal = 99; },
    (s: Record<string, unknown>) => { s.replayable = true; },
  ]) {
    const segment = structuredClone(originalSegment) as unknown as Record<string, unknown>; modify(segment);
    await changeMeta(f, store => { store.put({ key: key(originalSegment.segmentId), version: 1, segment, updatedAt: '2026-10-09T10:00:00.000Z' }); });
    const before = await facts(f.factory, f.dbName);
    await assert.rejects(f.repository.loadTrainingHistorySegment(originalSegment.segmentId), /invalid history segment/);
    await assert.rejects(f.repository.listTrainingHistorySegments(), /invalid history segment/);
    await assert.rejects(f.repository.deliverTrainingHistorySegment(originalSegment.segmentId, originalSegment, () => assert.fail('must not deliver')), /invalid history segment/);
    assert.deepEqual(await facts(f.factory, f.dbName), before);
  }
  assert.throws(() => readTrainingHistorySegment({ ...originalSegment, endedAt: 'invalid' }), /invalid history segment/);
});

test('segment keyset pagination reaches every record beyond 100 using immutable startedAt and segment ID', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0);
  // Seed only actual authenticated projector output, using the real adapter.
  for (let index = 0; index < 137; index++) {
    const p = new TrainingHistorySegmentProjector(f.engine.getSnapshot(), { generation: 1, segmentId: `page-${String(index).padStart(3, '0')}`, writerInstanceId: 'writer-one', startedAt: new Date(Date.UTC(2026, 9, 9, 9, index % 4)).toISOString() });
    await f.repository.beginTrainingHistorySegment(p.getSegment(), 1);
  }
  const status = f.repository.getStatus(), before = await facts(f.factory, f.dbName);
  const first = await f.repository.listTrainingHistorySegments(); assert.equal(first.entries.length, 100); assert.equal(first.hasMore, true); assert.ok(first.nextCursor);
  const expected = before.meta.filter(row => row.key.startsWith(TRAINING_HISTORY_SEGMENT_KEY_PREFIX)).map(row => row.segment as TrainingHistorySegment).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || a.segmentId.localeCompare(b.segmentId)).map(segment => segment.segmentId);
  const second = await f.repository.listTrainingHistorySegments({ after: first.nextCursor });
  assert.equal(second.entries.length, 37); assert.equal(second.hasMore, false); assert.equal(second.nextCursor, null);
  assert.deepEqual([...first.entries, ...second.entries].map(entry => entry.segmentId), expected);
  assert.strictEqual(f.repository.getStatus(), status); assert.deepEqual(await facts(f.factory, f.dbName), before);
  await changeMeta(f, store => { store.delete(key(first.nextCursor!.segmentId)); });
  assert.deepEqual((await f.repository.listTrainingHistorySegments({ after: first.nextCursor })).entries, second.entries, 'a deleted boundary does not strand later records');
  const mutable = { ...first.nextCursor! }, pending = f.repository.listTrainingHistorySegments({ after: mutable }); mutable.startedAtMs = 0;
  assert.deepEqual((await pending).entries, second.entries, 'capture cursor before awaiting');
  for (const invalid of [{ ...first.nextCursor!, version: 2 }, { ...first.nextCursor!, startedAtMs: NaN }, { ...first.nextCursor!, extra: true }]) {
    await assert.rejects(f.repository.listTrainingHistorySegments({ after: invalid as never }), /Invalid segment history cursor/);
  }
});

test('missing or unknown controls fail closed for segment admission and append without changing previous records', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const { p, permit } = await f.admit();
  for (const malformed of [undefined, { key: AUTOMATIC_HISTORY_CONTROL_KEY, version: 99 }, { key: AUTOMATIC_HISTORY_CONTROL_KEY, version: 2, mode: 'snapshots', automaticHistoryEnabled: true, generation: 1 }]) {
    await changeMeta(f, store => { if (malformed === undefined) store.delete(AUTOMATIC_HISTORY_CONTROL_KEY); else store.put(malformed); });
    const before = await facts(f.factory, f.dbName);
    f.input('MISSING_PERMISSION'); p.observe(f.engine.getSnapshot());
    await assert.rejects(f.repository.saveTrainingHistorySegment(permit, p.getSegment()), fence(malformed === undefined ? 'persisted-off' : 'invalid-control'));
    await assert.rejects(f.repository.beginTrainingHistorySegment(f.projector(1).getSegment(), 1), fence(malformed === undefined ? 'persisted-off' : 'invalid-control'));
    assert.deepEqual(await facts(f.factory, f.dbName), before);
  }
});

test('final export rejects async or thenable sinks before reporting delivery success', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const { p } = await f.admit();
  const selected = p.getSegment(), status = f.repository.getStatus(); let deliveries = 0;
  await assert.rejects(f.repository.deliverTrainingHistorySegment(selected.segmentId, selected, async () => { deliveries++; }), /synchronous sink/);
  assert.equal(deliveries, 0);
  await assert.rejects(f.repository.deliverTrainingHistorySegment(selected.segmentId, selected, (() => Promise.resolve()) as () => void), /returned a Promise/);
  assert.strictEqual(f.repository.getStatus(), status);
});


test('removing control after local OFF to ON never re-enables full snapshots on that page', async t => {
  const f = fixture(t); f.input('OLD'); await f.repository.saveSession(f.engine.getSnapshot());
  await f.repository.disableAutomaticHistory(); f.input('PRIVATE_GAP'); await f.repository.enableAutomaticHistory(1);
  const before = oldFacts(await facts(f.factory, f.dbName));
  await changeMeta(f, store => { store.delete(AUTOMATIC_HISTORY_CONTROL_KEY); });
  await assert.rejects(f.repository.saveSession(f.engine.getSnapshot()), fence('segment-mode'));
  assert.deepEqual(oldFacts(await facts(f.factory, f.dbName)), before);
});

test('OFF requested during an in-flight ON aborts its settings transaction before any segment can be admitted', async t => {
  const f = fixture(t);
  await f.repository.disableAutomaticHistory();
  const before = await facts(f.factory, f.dbName), original = IDBObjectStore.prototype.put;
  let off: Promise<unknown> | undefined;
  IDBObjectStore.prototype.put = function(value, at) {
    const request = original.call(this, value, at);
    if (this.name === 'meta' && value.key === AUTOMATIC_HISTORY_CONTROL_KEY && value.automaticHistoryEnabled === true) {
      request.addEventListener('success', () => { off = f.repository.disableAutomaticHistory(1); });
    }
    return request;
  };
  try { await assert.rejects(f.repository.enableAutomaticHistory(1), fence('local-off')); await off; }
  finally { IDBObjectStore.prototype.put = original; }
  assert.ok(off); assert.equal(f.repository.getAutomaticHistoryStatus().locallyStopped, true);
  assert.deepEqual(await f.repository.readAutomaticHistoryControl(), { state: 'segment-off', generation: 2 });
  const after = await facts(f.factory, f.dbName);
  assert.deepEqual(oldFacts(after), oldFacts(before));
  assert.equal(after.meta.some(row => row.key.startsWith(TRAINING_HISTORY_SEGMENT_KEY_PREFIX)), false);
  await assert.rejects(f.repository.beginTrainingHistorySegment(f.projector(2).getSegment(), 2), fence('local-off'));
});
