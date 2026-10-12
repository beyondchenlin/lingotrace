import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { SegmentHistoryReader, exportTrainingHistorySegment, type SegmentHistoryAccess } from './segment-history-reader';
import { IndexedDBTrainingRepository, TRAINING_HISTORY_SEGMENT_KEY_PREFIX, type TrainingHistorySegmentList } from './repository';
import { TrainingEngine, type NativeEditEvidence } from './training';
import { TrainingHistorySegmentProjector, type TrainingHistorySegment } from './training-history-segment';

const native = (text: string): NativeEditEvidence => ({ version: 'dom-edit-v1', kind: 'input', inputType: text ? 'insertText' : 'deleteContentBackward', data: text || null });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(t?: TestContext) {
  let serial = 0;
  const clock = { now: () => 0, wallTime: () => '2026-10-09T09:00:00.000Z', id: () => `event-${++serial}` };
  const engine = new TrainingEngine({ sessionId: 'source-session', clock });
  const factory = new IDBFactory(), dbName = `segment-reader-${t?.name ?? 'fixture'}`;
  const repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  t?.after(() => repository.close());
  return { engine, repository, factory, dbName,
    input(text: string) { engine.input(text, 'typed', native(text)); },
    projector(id = 'segment-one') { return new TrainingHistorySegmentProjector(engine.getSnapshot(), { segmentId: id, writerInstanceId: 'writer-one', generation: 1, startedAt: clock.wallTime() }); },
  };
}
function entry(id: string): TrainingHistorySegment { return fixture().projector(id).getSegment(); }
const empty: TrainingHistorySegmentList = Object.freeze({ entries: [], limit: 100, hasMore: false, nextCursor: null });
const page = (id: string, more = false): TrainingHistorySegmentList => ({ ...empty, entries: [{ segmentId: id, sessionId: 'source-session', generation: 1, startedAt: '2026-10-09T09:00:00.000Z', endedAt: null, updatedAt: '2026-10-09T09:00:00.000Z', factCount: 0, coverage: 'partial', replayable: false }], hasMore: more, nextCursor: more ? { version: 1, startedAtMs: Date.parse('2026-10-09T09:00:00.000Z'), segmentId: id } : null });
const access = (overrides: Partial<SegmentHistoryAccess> = {}): SegmentHistoryAccess => ({ listTrainingHistorySegments: async () => empty, loadTrainingHistorySegment: async id => entry(id), deliverTrainingHistorySegment: async (_id, _expected, sink) => { sink(); }, ...overrides });

/** Independent RFC 4180 reader: assertions compare parsed cells, not exporter substrings. */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (quoted) { if (char === '"') { if (csv[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += char; }
    else if (char === '"') { assert.equal(cell, ''); quoted = true; }
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\r' && csv[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += char;
  }
  assert.equal(quoted, false); assert.deepEqual(row, []); assert.equal(cell, ''); return rows;
}
function segmentFromCsv(csv: string): TrainingHistorySegment {
  const [header, ...rows] = parseCsv(csv); assert.deepEqual(header, ['row_type', 'field_or_ordinal', 'value_json']);
  const segment: Record<string, unknown> = {}, facts: unknown[] = [];
  for (const row of rows) {
    assert.equal(row.length, 3); const [kind, key, value] = row;
    if (kind === 'segment') { assert.equal(Object.hasOwn(segment, key), false); segment[key] = JSON.parse(value); }
    else { assert.equal(kind, 'fact'); const fact = JSON.parse(value); assert.equal(fact.ordinal, Number(key)); facts.push(fact); }
  }
  return { ...segment, facts } as unknown as TrainingHistorySegment;
}
async function databaseFacts(f: ReturnType<typeof fixture>): Promise<Record<string, unknown[]>> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = f.factory.open(f.dbName); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(['sessions', 'events', 'meta'], 'readonly'), rows: Record<string, unknown[]> = {};
      for (const store of ['sessions', 'events', 'meta']) { const r = tx.objectStore(store).getAll(); r.onsuccess = () => { rows[store] = r.result; }; }
      tx.oncomplete = () => resolve(rows); tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
async function deleteSegment(f: ReturnType<typeof fixture>, id: string): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = f.factory.open(f.dbName); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').delete(`${TRAINING_HISTORY_SEGMENT_KEY_PREFIX}${id}`); tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); }); }
  finally { db.close(); }
}

test('CSV and JSON retain exactly the same partial facts, redactions, versions and escaped text', () => {
  const f = fixture(); f.input('PRIVATE_BEFORE_ON'); const p = f.projector();
  const watch = f.engine.subscribe(() => p.observe(f.engine.getSnapshot()));
  f.input('PRIVATE_BEFORE_ON suffix'); f.engine.submit();
  f.input(''); f.input('=SUM(1,2), "quoted"\r\n下一行 🪴'); f.engine.submit(); watch();
  const segment = p.close('2026-10-09T09:01:00.000Z'), before = JSON.stringify(segment), pack = exportTrainingHistorySegment(segment);
  assert.deepEqual(JSON.parse(pack.json), segment); assert.deepEqual(segmentFromCsv(pack.csv), segment);
  assert.equal(JSON.stringify(segment), before); assert.equal(pack.json.includes('PRIVATE_BEFORE_ON'), false); assert.equal(pack.csv.includes('PRIVATE_BEFORE_ON'), false);
  assert.ok(segment.facts.some(fact => 'retention' in fact && fact.retention === 'redacted'));
  assert.ok(segment.facts.some(fact => fact.type === 'judgmentApplied' && fact.retention === 'recorded'));
  for (const row of parseCsv(pack.csv).slice(1)) for (const cell of row) assert.doesNotMatch(cell, /^[=+@\-\t\r]/);
  assert.equal(segmentFromCsv(pack.csv).coverage, 'partial'); assert.equal(segmentFromCsv(pack.csv).replayable, false);
});

test('empty segment and historical rule strings roundtrip without creating scores or empty facts', () => {
  const original = entry('empty'), historical = { ...original, rules: { trainingSchemaVersion: 'historical-training', ruleVersion: 'historical-rule', paceRuleVersion: 'historical-pace' } } as unknown as TrainingHistorySegment;
  const pack = exportTrainingHistorySegment(historical);
  assert.deepEqual(segmentFromCsv(pack.csv), historical); assert.deepEqual(JSON.parse(pack.json), historical);
  assert.deepEqual(segmentFromCsv(pack.csv).facts, []); assert.equal(pack.csv.includes('accuracy'), false);
  assert.throws(() => exportTrainingHistorySegment({ ...original, drafts: { secret: 'no' } } as TrainingHistorySegment), /invalid history segment/);
});

test('newest selection wins; back and disposal invalidate successful and failed reads', async () => {
  const a = deferred<TrainingHistorySegment | null>(), b = deferred<TrainingHistorySegment | null>();
  const reader = new SegmentHistoryReader(access({ loadTrainingHistorySegment: id => id === 'a' ? a.promise : b.promise }));
  const old = reader.select('a'), recent = reader.select('b'); b.resolve(entry('b')); await recent; a.resolve(entry('a')); await old;
  assert.equal(reader.getSnapshot().selected?.segmentId, 'b');
  for (const action of ['back', 'dispose'] as const) {
    const pending = deferred<TrainingHistorySegment | null>(); const r = new SegmentHistoryReader(access({ loadTrainingHistorySegment: () => pending.promise }));
    const selecting = r.select('old'); r[action](); pending.reject(Error('late failure')); await selecting;
    assert.equal(r.getSnapshot().selected, null); assert.equal(r.getSnapshot().error, null); assert.equal(r.getSnapshot().loading, false);
  }
});

test('refresh, detail and paging failures retry the failed operation without inventing a record', async () => {
  let failure = true; const reader = new SegmentHistoryReader(access({ listTrainingHistorySegments: async options => { if (failure) throw Error('read failed'); return options?.after ? page('old') : page('recent', true); }, loadTrainingHistorySegment: async id => failure ? null : entry(id) }));
  await reader.refresh(); assert.equal(reader.getSnapshot().list, null); assert.match(reader.getSnapshot().error!, /读取保留片段失败/);
  failure = false; await reader.retry(); assert.equal(reader.getSnapshot().list?.entries[0].segmentId, 'recent');
  failure = true; await reader.changePage('next'); assert.equal(reader.getSnapshot().page, 1); assert.equal(reader.getSnapshot().list?.entries[0].segmentId, 'recent');
  failure = false; await reader.retry(); assert.equal(reader.getSnapshot().page, 2);
  failure = true; await reader.select('old'); assert.equal(reader.getSnapshot().selected, null); assert.match(reader.getSnapshot().error!, /缺失不代表练习为零/);
  failure = false; await reader.retry(); assert.equal(reader.getSnapshot().selected?.segmentId, 'old');
  reader.back(); assert.equal(reader.getSnapshot().page, 2); await reader.changePage('previous'); assert.equal(reader.getSnapshot().page, 1);
});

test('pagination rereads cursor boundaries and handles an empty deleted final batch', async () => {
  const cursors: unknown[] = []; const reader = new SegmentHistoryReader(access({ listTrainingHistorySegments: async options => { cursors.push(options?.after ?? null); return options?.after ? empty : page('recent', true); } }));
  await reader.refresh(); await reader.changePage('next'); assert.equal(reader.getSnapshot().page, 2); assert.deepEqual(reader.getSnapshot().list?.entries, []);
  await reader.changePage('previous'); assert.equal(reader.getSnapshot().page, 1); assert.deepEqual(cursors, [null, page('recent', true).nextCursor, null]);
});

test('duplicate paging is ignored and late pages cannot replace refresh, detail or disposed state', async () => {
  for (const action of ['refresh', 'select', 'dispose'] as const) {
    const pending = deferred<TrainingHistorySegmentList>(); let calls = 0;
    const reader = new SegmentHistoryReader(access({ listTrainingHistorySegments: async options => { if (options?.after) { calls++; return pending.promise; } return page('recent', true); } }));
    await reader.refresh(); const paging = reader.changePage('next'); await reader.changePage('next'); assert.equal(calls, 1);
    if (action === 'refresh') await reader.refresh(); else if (action === 'select') await reader.select('chosen'); else reader.dispose();
    pending.resolve(page('obsolete')); await paging;
    assert.equal(reader.getSnapshot().page, 1); assert.equal(reader.getSnapshot().paging, false);
    if (action === 'select') assert.equal(reader.getSnapshot().selected?.segmentId, 'chosen');
    else if (action === 'dispose') assert.equal(reader.getSnapshot().list, null);
    else assert.equal(reader.getSnapshot().list?.entries[0].segmentId, 'recent');
  }
});

test('back, another selection, refresh and unmount prevent late guarded export sinks', async () => {
  for (const action of ['back', 'select', 'refresh', 'dispose'] as const) {
    const gate = deferred<void>(); let deliveries = 0, checks = 0;
    const reader = new SegmentHistoryReader(access({ deliverTrainingHistorySegment: async (_id, _expected, sink) => { checks++; await gate.promise; sink(); } }));
    await reader.select('a'); const exporting = reader.download('json', () => deliveries++); await reader.download('csv', () => deliveries++); assert.equal(checks, 1);
    if (action === 'select') await reader.select('b'); else if (action === 'refresh') await reader.refresh(); else reader[action]();
    gate.resolve(); await exporting; assert.equal(deliveries, 0, action); assert.equal(reader.getSnapshot().downloading, false);
  }
});

test('effect reconnect and reentrant listeners cannot revive obsolete reads or downloads', async () => {
  const stale = deferred<TrainingHistorySegmentList>(); let calls = 0;
  const reader = new SegmentHistoryReader(access({ listTrainingHistorySegments: () => ++calls === 1 ? stale.promise : Promise.resolve(empty) }));
  const old = reader.refresh(); reader.dispose(); reader.activate(); await reader.refresh(); stale.reject(Error('disposed read')); await old;
  assert.equal(reader.getSnapshot().list, empty); assert.equal(reader.getSnapshot().error, null);
  let reads = 0, writes = 0; const reentrant = new SegmentHistoryReader(access({ loadTrainingHistorySegment: async id => { reads++; return entry(id); } }));
  const unsubscribe = reentrant.subscribe(() => { if (reentrant.getSnapshot().loading) reentrant.back(); });
  await reentrant.select('a'); assert.equal(reads, 0); unsubscribe(); await reentrant.select('b');
  reentrant.subscribe(() => { if (reentrant.getSnapshot().downloading) reentrant.back(); });
  await reentrant.download('json', () => writes++); assert.equal(writes, 0);
});

test('real repository readers and both downloads remain readonly while recording is OFF', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const p = f.projector();
  const { permit } = await f.repository.beginTrainingHistorySegment(p.getSegment(), 1);
  f.input('new, "answer"\nvalue'); p.observe(f.engine.getSnapshot()); await f.repository.saveTrainingHistorySegment(permit, p.close('2026-10-09T09:01:00.000Z'));
  await f.repository.disableAutomaticHistory(1);
  const before = await databaseFacts(f), status = f.repository.getStatus(), control = f.repository.getAutomaticHistoryStatus();
  const reader = new SegmentHistoryReader(f.repository), deliveries: { name: string; blob: Blob }[] = [];
  await reader.refresh(); assert.equal(reader.getSnapshot().list?.entries[0].segmentId, p.getSegment().segmentId);
  await reader.select(p.getSegment().segmentId);
  await reader.download('json', (name, blob) => deliveries.push({ name, blob })); await reader.download('csv', (name, blob) => deliveries.push({ name, blob }));
  assert.equal(deliveries.length, 2); assert.match(deliveries[0].name, /partial-history-segment\.json$/); assert.equal(deliveries[1].blob.type, 'text/csv;charset=utf-8');
  assert.deepEqual(JSON.parse(await deliveries[0].blob.text()), p.getSegment()); assert.deepEqual(segmentFromCsv(await deliveries[1].blob.text()), p.getSegment());
  assert.deepEqual(await databaseFacts(f), before); assert.strictEqual(f.repository.getStatus(), status); assert.strictEqual(f.repository.getAutomaticHistoryStatus(), control);
});

test('real repository blocks stale and deleted exports; retry rereads before a new explicit download', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const p = f.projector();
  const { permit } = await f.repository.beginTrainingHistorySegment(p.getSegment(), 1);
  const reader = new SegmentHistoryReader(f.repository); await reader.select(p.getSegment().segmentId);
  f.input('changed'); p.observe(f.engine.getSnapshot()); await f.repository.saveTrainingHistorySegment(permit, p.getSegment());
  let deliveries = 0; await reader.download('json', () => deliveries++);
  assert.equal(deliveries, 0); assert.match(reader.getSnapshot().error!, /导出未开始/); assert.equal(reader.getSnapshot().downloading, false);
  await reader.retry(); assert.deepEqual(reader.getSnapshot().selected, p.getSegment()); assert.equal(deliveries, 0);
  await reader.download('csv', () => deliveries++); assert.equal(deliveries, 1);
  await deleteSegment(f, p.getSegment().segmentId); await reader.download('json', () => deliveries++);
  assert.equal(deliveries, 1); await reader.retry(); assert.equal(reader.getSnapshot().selected, null); assert.match(reader.getSnapshot().error!, /不可读取/);
});

test('fresh database reads show empty or missing history without creating persistent state', async t => {
  const f = fixture(t), reader = new SegmentHistoryReader(f.repository); await reader.refresh(); await reader.select('missing');
  assert.deepEqual(reader.getSnapshot().list?.entries, []); assert.equal(reader.getSnapshot().selected, null);
  assert.deepEqual(await f.factory.databases(), []);
});

test('partial B marker is displayed and preserved in new JSON/CSV envelope under atomic delivery', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const segment = f.projector().getSegment(); await f.repository.beginTrainingHistorySegment(segment, 1);
  const scope = await f.repository.beginPartialListeningScope(segment.segmentId, { scopeId: 'partial-b', startedAt: segment.startedAt, referenceVersion: 'reference-1' });
  const reader = new SegmentHistoryReader(f.repository); t.after(() => reader.dispose()); await reader.select(segment.segmentId);
  assert.deepEqual(reader.getSnapshot().listeningScope, scope);
  let json: Blob | null = null; await reader.download('json', (_name, blob) => { json = blob; });
  assert.ok(json); const exported = JSON.parse(await (json as Blob).text()); assert.equal(exported.exportVersion, 'listening-partial-export-v1'); assert.deepEqual(exported.segment, segment); assert.deepEqual(exported.listeningScope, scope);
  const csv = exportTrainingHistorySegment(segment, scope).csv, cells = parseCsv(csv); assert.equal(cells[1][0], 'listening-partial-export-v1'); assert.deepEqual(JSON.parse(cells[1][1]), exported);
  let delivered = false; await assert.rejects(f.repository.deliverTrainingHistorySegment(segment.segmentId, segment, () => { delivered = true; })); assert.equal(delivered, false);
});
test('partial B marker created after selection blocks old plain export rather than dropping conditions', async t => {
  const f = fixture(t); await f.repository.enableAutomaticHistory(0); const segment = f.projector().getSegment(); await f.repository.beginTrainingHistorySegment(segment, 1);
  const reader = new SegmentHistoryReader(f.repository); t.after(() => reader.dispose()); await reader.select(segment.segmentId); assert.equal(reader.getSnapshot().listeningScope, null);
  await f.repository.beginPartialListeningScope(segment.segmentId, { scopeId: 'later-b', startedAt: segment.startedAt, referenceVersion: 'reference-1' });
  let delivered = false; await reader.download('json', () => { delivered = true; }); assert.equal(delivered, false); assert.ok(reader.getSnapshot().error);
});
test('partial condition read failure is an error, not a condition-free selected record', async () => {
  const reader = new SegmentHistoryReader(access({ loadPartialListeningScope: async () => { throw new Error('read failed'); } }));
  await reader.select('segment-one'); assert.equal(reader.getSnapshot().selected, null); assert.ok(reader.getSnapshot().error); reader.dispose();
});
