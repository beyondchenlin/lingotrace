import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDBTrainingRepository, TRAINING_HISTORY_SEGMENT_KEY_PREFIX } from './repository';
import { TrainingEngine, SCHEMA_VERSION, RULE_VERSION, PACE_RULE_VERSION, type TrainingSnapshot } from './training';
import { ListeningConditions } from './listening-flow';
import { readListeningSession, type ListeningSessionRecord } from './listening-session';
import { readLegacyHistoryRecord, type LegacyHistorySession } from './legacy-history';
import { TRAINING_HISTORY_SEGMENT_VERSION, type TrainingHistorySegment } from './training-history-segment';
import { RecordCalendarReader, type RecordCalendarAccess } from './record-calendar-reader';
import { RecordCalendarMetrics, projectRecordCalendarMetricFacts } from './record-calendar-metrics';
import { recordCalendarSourceIdentity } from './record-calendar';

const fast = { yieldControl: async () => {} };
const options = { scopeId: 'calendar-scope', startedAt: '2026-12-01T00:00:00Z', referenceVersion: 'reference-1' };
function fixture(t: TestContext, sessionId = 'listening-one', start = '2026-10-05T23:59:30Z') {
  const factory = new IDBFactory(), dbName = t.name, repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  let serial = 0, now = 0;
  const engine = new TrainingEngine({ sessionId, clock: { now: () => now, wallTime: () => new Date(Date.parse(start) + now).toISOString(), id: () => `${sessionId}-${++serial}` } });
  const snapshot = engine.getSnapshot(), conditions = new ListeningConditions({ sessionId, roundId: snapshot.roundId, materialId: snapshot.material.id, materialVersion: snapshot.material.version, referenceVersion: options.referenceVersion }, 'complete-to-submit');
  t.after(() => repository.close());
  const input = (text: string) => engine.input(text, 'typed', { version: 'dom-edit-v1', kind: 'input', inputType: 'insertText', data: text });
  const submit = () => { const captured = conditions.capture(engine.getSnapshot()); engine.submit(); conditions.complete(captured, engine.getSnapshot()); };
  return { factory, dbName, repository, engine, conditions, input, submit, advance: (ms: number) => { now += ms; engine.sampleClock(); } };
}
async function open(f: ReturnType<typeof fixture>) {
  return new Promise<IDBDatabase>((resolve, reject) => { const r = f.factory.open(f.dbName); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
async function capture(f: ReturnType<typeof fixture>) {
  const db = await open(f);
  try { const values: Record<string, unknown> = { version: db.version, stores: [...db.objectStoreNames] };
    await new Promise<void>((resolve, reject) => { const tx = db.transaction(['sessions', 'events', 'meta'], 'readonly'); for (const name of ['sessions', 'events', 'meta']) { const r = tx.objectStore(name).getAll(); r.onsuccess = () => { values[name] = r.result; }; } tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error); });
    return JSON.stringify(values);
  } finally { db.close(); }
}
async function put(f: ReturnType<typeof fixture>, store: string, value: unknown) {
  const db = await open(f); try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value); tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error); }); } finally { db.close(); }
}
const valueOnly = (metrics: ReturnType<RecordCalendarMetrics['getSnapshot']>) => ({ ...metrics, days: metrics.days.map(({ day, coverage, ...values }) => ({ day, coverage, ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value: value.value, unknownCount: value.unknownCount }])) })), weeks: metrics.weeks.map(({ day, through, coverage, ...values }) => ({ day, through, coverage, ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value: value.value, unknownCount: value.unknownCount }])) })) });

test('real repository wrapper conversion preserves existing Training UTC dates and all four recorded metrics without writes', async t => {
  const f = fixture(t); f.input(f.engine.cue.text); f.advance(60_000); f.engine.submit();
  const original = f.engine.getSnapshot(); await f.repository.saveSession(original);
  const beforeStorage = JSON.parse(await capture(f));
  const reader = new RecordCalendarReader(f.repository, fast); t.after(() => reader.dispose());
  await reader.refresh('UTC'); const before = reader.getSnapshot(); assert.equal(before.records.length, 1);
  const admitted = await f.repository.beginListeningSessionScope(original, options);
  const afterAdmission = await capture(f); assert.deepEqual(admitted.record.preBRecord, beforeStorage.sessions[0]);
  await reader.refresh('UTC'); const after = reader.getSnapshot();
  assert.equal(after.status, 'loaded'); assert.equal(after.records.length, 1);
  assert.equal(after.records[0].source, 'listening-session'); assert.equal(after.records[0].key, `listening-session:${original.sessionId}`);
  assert.deepEqual(after.records[0].days, ['2026-10-05', '2026-10-06']);
  assert.deepEqual(valueOnly(after.metrics), valueOnly(before.metrics));
  assert.equal(after.metrics.weeks[0].submissions.value, 1); assert.equal(after.metrics.weeks[0].firstCompletions.value, 1);
  assert.equal(after.metrics.weeks[0].matchedTerms.value, 6); assert.equal(after.metrics.weeks[0].inputActiveMs.value, 60_000);
  await reader.select(after.records[0].key); const selected = reader.getSnapshot().selected;
  assert.equal(selected?.source, 'listening-session');
  if (selected?.source === 'listening-session') { assert.deepEqual(selected.listeningSession, admitted.record); assert.equal('session' in selected, false); }
  assert.equal(await capture(f), afterAdmission); assert.deepEqual((await f.repository.loadListeningSession(original.sessionId))?.trainingSnapshot, original);
});

function legacy(snapshot: TrainingSnapshot): LegacyHistorySession {
  return readLegacyHistoryRecord({ sessionId: snapshot.sessionId, sequence: snapshot.sequence, updatedAt: '2026-12-01T00:00:00Z', snapshot });
}
function wrapper(snapshot: TrainingSnapshot): ListeningSessionRecord {
  return readListeningSession({ version: 'listening-session-v1', sessionId: snapshot.sessionId, sequence: snapshot.sequence, updatedAt: '2026-12-01T00:00:00Z', snapshot: { schemaVersion: 'listening-session-v1', events: null }, trainingSnapshot: snapshot, preBRecord: null,
    scope: { ...options, admittedSequence: snapshot.sequence, generation: 0, revision: 0 },
    conditions: { schemaVersion: 'listening-conditions-v1', identity: { sessionId: snapshot.sessionId, roundId: snapshot.roundId, materialId: snapshot.material.id, materialVersion: snapshot.material.version, referenceVersion: options.referenceVersion }, presentations: [], boundaries: [] } });
}
function partial(snapshot: TrainingSnapshot): TrainingHistorySegment {
  const events = snapshot.events.filter(e => e.type === 'submitRequested');
  return { schemaVersion: TRAINING_HISTORY_SEGMENT_VERSION, sessionId: snapshot.sessionId, segmentId: 'overlap', writerInstanceId: 'writer', generation: 1, material: { id: snapshot.material.id, version: snapshot.material.version }, rules: { trainingSchemaVersion: SCHEMA_VERSION, ruleVersion: RULE_VERSION, paceRuleVersion: PACE_RULE_VERSION }, startedAt: '2026-12-01T00:00:00Z', endedAt: null, coverage: 'partial', replayable: false,
    facts: events.map((e, i) => ({ sourceEventId: e.eventId, ordinal: i + 1, wallTime: e.wallTime, cueId: e.cueId, type: 'submitRequested', attemptId: e.attemptId, retention: 'redacted', redactionReason: 'draft-predates-segment' })) };
}
function access(full: LegacyHistorySession[] = [], parts: TrainingHistorySegment[] = [], listening: readonly ListeningSessionRecord[] = [], overrides: Partial<RecordCalendarAccess> = {}): RecordCalendarAccess {
  return {
    listHistory: async () => ({ source: 'legacy-training-v1', entries: full.map(value => ({ status: 'ready', summary: value.summary })), limit: 100, hasMore: false, nextCursor: null }),
    loadHistorySession: async id => full.find(value => value.summary.sessionId === id) ?? null,
    listTrainingHistorySegments: async () => ({ entries: parts.map(p => ({ segmentId: p.segmentId, sessionId: p.sessionId, generation: p.generation, startedAt: p.startedAt, endedAt: p.endedAt, updatedAt: p.startedAt, factCount: p.facts.length, coverage: 'partial', replayable: false })), limit: 100, hasMore: false, nextCursor: null }),
    loadTrainingHistorySegment: async id => parts.find(value => value.segmentId === id) ?? null,
    listListeningSessions: async () => listening,
    loadListeningSession: async id => listening.find(value => value.sessionId === id) ?? null,
    ...overrides,
  };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (value: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('real assisted wrapper preserves original conditions, pre-B receipt, OFF settings and private text only in selected detail', async t => {
  const f = fixture(t); f.input('PRIVATE_PRE_B_ANSWER'); await f.repository.saveSession(f.engine.getSnapshot());
  const { permit, record: admitted } = await f.repository.beginListeningSessionScope(f.engine.getSnapshot(), options);
  f.conditions.present(f.engine.cue.id, 'automatic-text', true, options.referenceVersion); f.input(f.engine.cue.text); f.advance(60_000); f.submit();
  const stored = await f.repository.saveListeningSession(permit, f.engine.getSnapshot(), f.conditions.snapshot(), 0);
  await f.repository.disableAutomaticHistory(0); const before = await capture(f);
  const reader = new RecordCalendarReader(f.repository, fast); t.after(() => reader.dispose()); await reader.refresh('UTC');
  const view = reader.getSnapshot(); assert.equal(view.status, 'loaded'); assert.equal(view.records.length, 1);
  const trainingMetrics = new RecordCalendarMetrics('UTC'); trainingMetrics.add(await projectRecordCalendarMetricFacts(legacy(stored.trainingSnapshot), `legacy-full:${stored.sessionId}`, 'UTC'));
  assert.deepEqual(valueOnly(view.metrics), valueOnly(trainingMetrics.getSnapshot()));
  assert.equal(view.metrics.weeks[0].submissions.value, 1); assert.equal(view.metrics.weeks[0].firstCompletions.value, 1);
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE_PRE_B|Could I|coffee|trainingSnapshot|preBRecord|known-assisted|alignment/);
  assert.ok(view.metrics.weeks[0].submissions.sourceEventIds.every(e => e.recordKeys.every(k => k === `listening-session:${stored.sessionId}`)));
  await reader.select(view.records[0].key); const selected = reader.getSnapshot().selected; assert.equal(selected?.source, 'listening-session');
  if (selected?.source === 'listening-session') {
    assert.deepEqual(selected.listeningSession, stored); assert.deepEqual(selected.listeningSession.preBRecord, admitted.preBRecord);
    assert.equal(selected.listeningSession.conditions.boundaries[0].assistance, 'known-assisted');
    assert.equal(selected.listeningSession.trainingSnapshot.attempts.length, 1); assert.equal(selected.listeningSession.trainingSnapshot.attempts[0].answer, f.engine.cue.text);
    assert.ok(Object.isFrozen(selected.listeningSession.conditions.boundaries)); assert.equal('session' in selected, false);
  }
  assert.equal(await capture(f), before);
});

test('real corrupt wrapper fails the entire listening family without erasing valid legacy or partial history or writing', async t => {
  const f = fixture(t); f.input(f.engine.cue.text); f.engine.submit(); await f.repository.beginListeningSessionScope(f.engine.getSnapshot(), options);
  const another = new TrainingEngine({ sessionId: 'unchanged-legacy' }); another.input('KEEP_ORIGINAL'); const saved = another.getSnapshot(); await f.repository.saveSession(saved);
  const part = partial(f.engine.getSnapshot()); await put(f, 'meta', { key: `${TRAINING_HISTORY_SEGMENT_KEY_PREFIX}${part.segmentId}`, version: 1, segment: part, updatedAt: part.startedAt });
  const bad = structuredClone(wrapper(saved)); Object.assign(bad, { sessionId: 'corrupt', conditions: undefined }); await put(f, 'sessions', bad);
  const before = await capture(f), reader = new RecordCalendarReader(f.repository, fast); t.after(() => reader.dispose()); await reader.refresh('UTC');
  assert.equal(reader.getSnapshot().status, 'partial'); assert.deepEqual(reader.getSnapshot().records.map(r => r.source), ['legacy-full', 'partial-segment']);
  assert.ok(reader.getSnapshot().unreadableCount >= 1); assert.equal(await capture(f), before);
  await reader.select('legacy-full:unchanged-legacy'); assert.equal(reader.getSnapshot().selected?.source, 'legacy-full');
});

test('old adapters missing either listening read capability explicitly report incomplete coverage', async t => {
  const f = fixture(t), full = legacy(f.engine.getSnapshot());
  for (const missing of [{ listListeningSessions: undefined }, { loadListeningSession: undefined }, { listListeningSessions: undefined, loadListeningSession: undefined }]) {
    const reader = new RecordCalendarReader(access([full], [], [], missing), fast); await reader.refresh('UTC');
    assert.equal(reader.getSnapshot().status, 'partial'); assert.equal(reader.getSnapshot().unreadableCount, 1); assert.equal(reader.getSnapshot().records.length, 1); reader.dispose();
  }
  const reader = new RecordCalendarReader(access([], [], [], { listListeningSessions: undefined }), fast); await reader.refresh('UTC'); assert.equal(reader.getSnapshot().status, 'failed'); reader.dispose();
});

test('duplicate, malformed, missing, wrong-ID and stale wrappers quarantine the whole listening family before publication', async t => {
  const f = fixture(t), original = wrapper(f.engine.getSnapshot()), full = legacy(f.engine.getSnapshot());
  const otherEngine = new TrainingEngine({ sessionId: 'second' }), second = wrapper(otherEngine.getSnapshot());
  const broken = { ...second, conditions: undefined } as unknown as ListeningSessionRecord;
  const newer = readListeningSession({ ...second, scope: { ...second.scope, revision: 1 } });
  for (const overrides of [
    { listListeningSessions: async () => [original, broken] },
    { listListeningSessions: async () => [original, original] },
    { listListeningSessions: async () => [original, { ...original, updatedAt: '2026-12-02T00:00:00Z' }] },
    { listListeningSessions: async () => null as unknown as readonly ListeningSessionRecord[] },
    { loadListeningSession: async (id: string) => id === original.sessionId ? original : null },
    { loadListeningSession: async (id: string) => id === original.sessionId ? original : original },
    { loadListeningSession: async (id: string) => id === original.sessionId ? original : newer },
    { loadListeningSession: async (id: string) => { if (id === original.sessionId) return original; throw Error('failed read'); } },
  ] satisfies Partial<RecordCalendarAccess>[]) {
    const reader = new RecordCalendarReader(access([full], [], [original, second], overrides), { ...fast, yieldEvery: 1 });
    const seen: string[] = []; reader.subscribe(() => seen.push(...reader.getSnapshot().records.map(r => r.source)));
    await reader.refresh('UTC'); assert.equal(reader.getSnapshot().status, 'partial'); assert.equal(reader.getSnapshot().unreadableCount, 1);
    assert.deepEqual(reader.getSnapshot().records.map(r => r.source), ['legacy-full']); assert.equal(seen.includes('listening-session'), false); reader.dispose();
  }
});

test('wrapper identity includes assistance, scope, receipt, saved metadata and same-sequence Training contents on selection', async t => {
  const f = fixture(t); f.input('original answer'); await f.repository.saveSession(f.engine.getSnapshot());
  const { permit } = await f.repository.beginListeningSessionScope(f.engine.getSnapshot(), options); f.input(f.engine.cue.text); f.submit();
  const original = await f.repository.saveListeningSession(permit, f.engine.getSnapshot(), f.conditions.snapshot(), 0);
  const transforms: ((value: ListeningSessionRecord) => unknown)[] = [
    value => ({ ...value, updatedAt: '2026-12-02T00:00:00Z' }),
    value => ({ ...value, scope: { ...value.scope, revision: value.scope.revision + 1 } }),
    value => ({ ...value, scope: { ...value.scope, scopeId: 'changed-scope' } }),
    value => ({ ...value, conditions: { ...value.conditions, boundaries: value.conditions.boundaries.map(b => ({ ...b, assistance: 'unknown', coverage: 'partial' })) } }),
    value => ({ ...value, preBRecord: { ...value.preBRecord!, updatedAt: '2026-12-03T00:00:00Z' } }),
    value => { const changed = structuredClone(value); Object.assign(changed.trainingSnapshot, { draft: 'same-sequence changed draft' }); return changed; },
    () => null,
    () => wrapper(new TrainingEngine({ sessionId: 'wrong-id' }).getSnapshot()),
    value => ({ ...value, conditions: undefined }),
  ];
  for (const transform of transforms) {
    let current: unknown = original; const reader = new RecordCalendarReader(access([], [], [original], { loadListeningSession: async () => current as ListeningSessionRecord | null }), fast);
    await reader.refresh('UTC'); await reader.select(`listening-session:${original.sessionId}`); assert.equal(reader.getSnapshot().selected?.source, 'listening-session');
    current = transform(original); if (current && (current as ListeningSessionRecord).conditions && (current as ListeningSessionRecord).sessionId === original.sessionId) readListeningSession(current);
    await reader.select(`listening-session:${original.sessionId}`); assert.equal(reader.getSnapshot().selected, null); assert.match(reader.getSnapshot().error!, /已更改|安全核对/); reader.dispose();
  }
});

test('all three sources deduplicate existing Training facts and keep wrapper record keys', async t => {
  const f = fixture(t); f.input(f.engine.cue.text); f.advance(60_000); f.engine.submit(); const snapshot = f.engine.getSnapshot(), original = wrapper(snapshot), full = legacy(snapshot), part = partial(snapshot);
  const reader = new RecordCalendarReader(access([full], [part], [original]), fast); t.after(() => reader.dispose()); await reader.refresh('UTC'); const state = reader.getSnapshot();
  assert.equal(state.status, 'loaded'); assert.equal(state.records.length, 3); assert.equal(state.metrics.conflictCount, 0);
  assert.equal(state.metrics.weeks[0].submissions.value, 1); assert.equal(state.metrics.weeks[0].firstCompletions.value, 1); assert.equal(state.metrics.weeks[0].matchedTerms.value, 6); assert.equal(state.metrics.weeks[0].inputActiveMs.value, 60_000);
  assert.deepEqual(state.metrics.weeks[0].submissions.sourceEventIds[0].recordKeys, [`legacy-full:${snapshot.sessionId}`, `listening-session:${snapshot.sessionId}`, 'partial-segment:overlap']);
  await assert.rejects(projectRecordCalendarMetricFacts(original, `legacy-full:${snapshot.sessionId}`, 'UTC'), /provenance/);
});

test('wrapper overlap conflicts retract submissions rather than increasing the original count', async t => {
  const f = fixture(t); f.input(f.engine.cue.text); f.engine.submit(); const snapshot = f.engine.getSnapshot(), original = wrapper(snapshot), part = partial(snapshot);
  const conflicting = { ...part, facts: part.facts.map(e => ({ ...e, wallTime: '2026-10-07T00:00:00Z' })) } as TrainingHistorySegment;
  const reader = new RecordCalendarReader(access([], [conflicting], [original]), fast); t.after(() => reader.dispose()); await reader.refresh('UTC');
  const state = reader.getSnapshot(); assert.equal(state.status, 'partial'); assert.ok(state.metrics.conflictCount > 0); assert.ok(state.metrics.days.every(d => d.submissions.value === null));
});

test('wrapper dates use saved Training event wall times, reject impossible dates, and never infer metadata or L/T time', async t => {
  const f = fixture(t), snapshot = structuredClone(f.engine.getSnapshot());
  Object.assign(snapshot.events[0], { wallTime: '2026-02-30T00:00:00Z' }); Object.assign(snapshot, { createdAt: '2026-02-30T00:00:00Z' });
  const invalid = wrapper(snapshot); await f.repository.saveSession(f.engine.getSnapshot()); await put(f, 'sessions', invalid); const before = await capture(f);
  const reader = new RecordCalendarReader(f.repository, fast); t.after(() => reader.dispose()); await reader.refresh('UTC');
  assert.equal(reader.getSnapshot().status, 'partial'); assert.equal(reader.getSnapshot().undatedEventCount, 1); assert.equal(reader.getSnapshot().undatedRecordCount, 1);
  assert.deepEqual(reader.getSnapshot().records[0].days, []); assert.deepEqual(reader.getSnapshot().metrics.days, []); assert.equal(await capture(f), before);
  const valid = new RecordCalendarReader(access([], [], [wrapper(f.engine.getSnapshot())]), fast); t.after(() => valid.dispose()); await valid.refresh('Asia/Shanghai');
  assert.deepEqual(valid.getSnapshot().records[0].days, ['2026-10-06']); assert.equal(valid.getSnapshot().records[0].days.includes('2026-12-01'), false);
});

test('more than 100 listening wrappers are all explicitly read, yielded and indexed without retaining raw text', async () => {
  const records = Array.from({ length: 103 }, (_, i) => wrapper(new TrainingEngine({ sessionId: `session-${i}`, clock: { now: () => 0, wallTime: () => '2026-10-05T23:59:30Z', id: () => `event-${i}` } }).getSnapshot()));
  let reads = 0, yields = 0; const reader = new RecordCalendarReader(access([], [], records, { loadListeningSession: async id => { reads++; return records.find(v => v.sessionId === id)!; } }), { yieldEvery: 8, yieldControl: async () => { yields++; } });
  await reader.refresh('UTC'); assert.equal(reader.getSnapshot().status, 'loaded'); assert.equal(reader.getSnapshot().records.length, 103); assert.equal(reads, 103); assert.ok(yields >= 30);
  assert.doesNotMatch(JSON.stringify(reader.getSnapshot()), /trainingSnapshot|preBRecord|alignment|presentations/); reader.dispose();
});

test('cancelling a pending third-source list or load consumes late failures and preserves earlier source results', async t => {
  const f = fixture(t), full = legacy(f.engine.getSnapshot()), original = wrapper(f.engine.getSnapshot());
  for (const during of ['list', 'load'] as const) {
    const gate = deferred<any>(), started = deferred<void>(); let loads = 0;
    const reader = new RecordCalendarReader(access([full], [], [original], during === 'list' ? {
      listListeningSessions: async () => { started.resolve(); return gate.promise; }, loadListeningSession: async () => { loads++; return original; },
    } : { loadListeningSession: async () => { loads++; started.resolve(); return gate.promise; } }), fast);
    const work = reader.refresh('UTC'); await started.promise; reader.cancel(); await work;
    assert.equal(reader.getSnapshot().status, 'cancelled'); assert.deepEqual(reader.getSnapshot().records.map(r => r.source), ['legacy-full']); assert.equal(loads, during === 'list' ? 0 : 1);
    gate.reject(Error('late failure')); await Promise.resolve(); assert.equal(reader.getSnapshot().status, 'cancelled'); reader.dispose();
  }
});

test('new scan epochs fence pending listening reads and reset date projection to the selected timezone', async t => {
  const f = fixture(t), original = wrapper(f.engine.getSnapshot()), gate = deferred<readonly ListeningSessionRecord[]>(), started = deferred<void>(); let lists = 0;
  const reader = new RecordCalendarReader(access([], [], [original], { listListeningSessions: async () => { if (++lists === 1) { started.resolve(); return gate.promise; } return [original]; } }), fast); t.after(() => reader.dispose());
  const old = reader.refresh('UTC'); await started.promise; await reader.refresh('Asia/Shanghai'); await old;
  gate.resolve([original]); await Promise.resolve(); assert.equal(reader.getSnapshot().status, 'loaded'); assert.equal(reader.getSnapshot().timeZone, 'Asia/Shanghai'); assert.deepEqual(reader.getSnapshot().records[0].days, ['2026-10-06']);
});

test('listening selection late results cannot override back, newer selection, refresh or disposal', async t => {
  const f = fixture(t), original = wrapper(f.engine.getSnapshot()), full = legacy(f.engine.getSnapshot());
  for (const action of ['back', 'select', 'refresh', 'dispose'] as const) {
    const gate = deferred<ListeningSessionRecord | null>(), started = deferred<void>(); let delayed = false;
    const reader = new RecordCalendarReader(access([full], [], [original], { loadListeningSession: async () => { if (delayed) { started.resolve(); return gate.promise; } return original; } }), fast);
    await reader.refresh('UTC'); delayed = true; const selection = reader.select(`listening-session:${original.sessionId}`); await started.promise; delayed = false;
    if (action === 'back') reader.back(); else if (action === 'select') await reader.select(`legacy-full:${original.sessionId}`); else if (action === 'refresh') await reader.refresh('Asia/Shanghai'); else reader.dispose();
    await selection; gate.resolve(original); await Promise.resolve(); assert.equal(reader.getSnapshot().selected?.source, action === 'select' ? 'legacy-full' : undefined); assert.equal(reader.getSnapshot().selecting, false); assert.equal(reader.getSnapshot().error, null); reader.dispose();
  }
});

test('wrapper fingerprint includes all saved envelope fields without disclosing them', async t => {
  const f = fixture(t), original = wrapper(f.engine.getSnapshot());
  const changed = readListeningSession({ ...original, scope: { ...original.scope, revision: 1 } });
  const digest = await recordCalendarSourceIdentity(original); assert.match(digest, /^[a-f0-9]{64}$/); assert.notEqual(digest, await recordCalendarSourceIdentity(changed));
  await assert.rejects(projectRecordCalendarMetricFacts({ ...original, conditions: undefined } as unknown as ListeningSessionRecord, `listening-session:${original.sessionId}`, 'UTC'));
});


test('real wrapper and partial overlap deduplicate across local midnight and retain exact source links while OFF', async t => {
  const f = fixture(t); f.input(f.engine.cue.text); f.advance(60_000); f.engine.submit();
  const snapshot = f.engine.getSnapshot(), { record } = await f.repository.beginListeningSessionScope(snapshot, options), part = partial(snapshot);
  await put(f, 'meta', { key: `${TRAINING_HISTORY_SEGMENT_KEY_PREFIX}${part.segmentId}`, version: 1, segment: part, updatedAt: part.startedAt });
  await f.repository.disableAutomaticHistory(0); const before = await capture(f);
  const reader = new RecordCalendarReader(f.repository, fast); t.after(() => reader.dispose()); await reader.refresh('UTC');
  const state = reader.getSnapshot(); assert.equal(state.status, 'loaded'); assert.equal(state.records.length, 2);
  assert.equal(state.metrics.weeks[0].submissions.value, 1); assert.equal(state.metrics.weeks[0].firstCompletions.value, 1); assert.equal(state.metrics.weeks[0].matchedTerms.value, 6);
  assert.deepEqual(state.metrics.days.map(d => [d.day, d.inputActiveMs.value]), [['2026-10-05', 30_000], ['2026-10-06', 30_000]]);
  assert.deepEqual(state.metrics.weeks[0].submissions.sourceEventIds[0].recordKeys, [`listening-session:${record.sessionId}`, 'partial-segment:overlap']);
  await reader.select(`listening-session:${record.sessionId}`); assert.equal(reader.getSnapshot().selected?.source, 'listening-session');
  await reader.select('partial-segment:overlap'); assert.equal(reader.getSnapshot().selected?.source, 'partial-segment');
  await reader.refresh('Asia/Shanghai'); assert.deepEqual(reader.getSnapshot().metrics.days.map(d => [d.day, d.inputActiveMs.value]), [['2026-10-06', 60_000]]);
  assert.equal(await capture(f), before);
});

test('large listening projection yields and cancellation never publishes a staged wrapper or its metrics', async t => {
  const f = fixture(t); for (let i = 0; i < 80; i++) f.input(`private answer ${i}`);
  const original = wrapper(f.engine.getSnapshot()), earlier = legacy(new TrainingEngine({ sessionId: 'earlier' }).getSnapshot()); let yields = 0;
  let reader: RecordCalendarReader; reader = new RecordCalendarReader(access([earlier], [], [original]), { yieldEvery: 8, yieldControl: async () => { if (++yields === 3) reader.cancel(); } });
  await reader.refresh('UTC'); assert.equal(reader.getSnapshot().status, 'cancelled'); assert.deepEqual(reader.getSnapshot().records.map(r => r.source), ['legacy-full']);
  assert.equal(reader.getSnapshot().metrics.days.some(d => d.submissions.sourceEventIds.some(e => e.recordKeys.some(k => k.startsWith('listening-session:')))), false);
  assert.doesNotMatch(JSON.stringify(reader.getSnapshot()), /private answer/); reader.dispose();
});
