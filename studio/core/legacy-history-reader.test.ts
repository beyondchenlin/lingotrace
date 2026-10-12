import test from 'node:test';
import assert from 'node:assert/strict';
import { LegacyHistoryReader, type LegacyHistoryAccess } from './legacy-history-reader';
import type { LegacyHistoryList, LegacyHistorySession } from './legacy-history';
import { TrainingEngine } from './training';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function entry(id: string): LegacyHistorySession {
  const engine = new TrainingEngine({ sessionId: id }); engine.input('Could I');
  const snapshot = engine.getSnapshot();
  return { source: 'legacy-training-v1', snapshot, summary: { source: 'legacy-training-v1', sequence: snapshot.sequence, materialSource: 'embedded-snapshot', sessionId: id, createdAt: snapshot.createdAt, updatedAt: snapshot.createdAt, earnedWords: snapshot.earnedWords, completedCount: 0, attemptCount: 0, activeMs: snapshot.activeMs, schemaVersion: snapshot.schemaVersion, materialId: snapshot.material.id, materialVersion: snapshot.material.version, materialTitle: snapshot.material.title, ruleVersions: ['word-alignment-v3'], paceRuleVersions: ['grapheme-exp-3s-v1'] } };
}
const list = { source: 'legacy-training-v1', entries: [], hasMore: false, nextCursor: null, limit: 100 } as LegacyHistoryList;
const access = (overrides: Partial<LegacyHistoryAccess> = {}): LegacyHistoryAccess => ({ listHistory: async () => list, loadHistorySession: async id => entry(id), deliverHistorySession: async (_id, _expected, sink) => { sink(); }, ...overrides });

test('newer selection wins and close invalidates late successful/failed reads', async () => {
  const a = deferred<LegacyHistorySession | null>(), b = deferred<LegacyHistorySession | null>();
  const reader = new LegacyHistoryReader(access({ loadHistorySession: id => id === 'a' ? a.promise : b.promise }));
  const first = reader.select('a'), second = reader.select('b'); b.resolve(entry('b')); await second; a.resolve(entry('a')); await first;
  assert.equal(reader.getSnapshot().selected?.snapshot.sessionId, 'b');
  const old = deferred<LegacyHistoryList>(); const closing = new LegacyHistoryReader(access({ listHistory: () => old.promise })); const pending = closing.refresh(); closing.dispose(); old.reject(Error('late')); await pending;
  assert.equal(closing.getSnapshot().error, null); assert.equal(closing.getSnapshot().list, null);
});

test('late download never reaches sink after back, another selection or unmount', async () => {
  for (const action of ['back', 'select', 'dispose'] as const) {
    const gate = deferred<void>(); let writes = 0;
    const reader = new LegacyHistoryReader(access({ deliverHistorySession: async (_id, _expected, sink) => { await gate.promise; sink(); } }));
    await reader.select('a'); const pending = reader.download('json', () => writes++);
    if (action === 'back') reader.back(); else if (action === 'select') await reader.select('b'); else reader.dispose();
    gate.resolve(); await pending; assert.equal(writes, 0, action);
  }
});

test('two explicit format downloads use one captured session and export timestamp', async () => {
  const original = entry('a'), before = JSON.stringify(original), deliveries: { name: string; blob: Blob }[] = [];
  const reader = new LegacyHistoryReader(access({ loadHistorySession: async () => original })); await reader.select('a');
  await reader.download('json', (name, blob) => deliveries.push({ name, blob })); await reader.download('csv', (name, blob) => deliveries.push({ name, blob }));
  const json = JSON.parse(await deliveries[0].blob.text()), csv = await deliveries[1].blob.text();
  assert.deepEqual(json.session, original.snapshot); assert.deepEqual(json.rawEvents, original.snapshot.events); assert.ok(csv.includes(json.exportedAt));
  assert.equal(JSON.stringify(original), before); assert.match(deliveries[0].name, /training-v1-history\.json$/);
});

test('changed durable record blocks download and leaves an explicit retry error', async () => {
  let writes = 0; const reader = new LegacyHistoryReader(access({ deliverHistorySession: async () => { throw Error('stale'); } }));
  await reader.select('a'); await reader.download('json', () => writes++); assert.equal(writes, 0); assert.match(reader.getSnapshot().error!, /导出未开始/); assert.equal(reader.getSnapshot().downloading, false);
});

test('unknown stored attempt or pace rule cannot acquire current metric definitions on export', async () => {
  for (const key of ['ruleVersions', 'paceRuleVersions'] as const) {
    const original = entry('old'), selected = { ...original, summary: { ...original.summary, [key]: ['unrecognized-old-rule'] } }; let writes = 0;
    const reader = new LegacyHistoryReader(access({ loadHistorySession: async () => selected })); await reader.select('old');
    await reader.download('json', () => writes++); assert.equal(writes, 0); assert.match(reader.getSnapshot().error!, /旧规则/); assert.equal(reader.getSnapshot().selected, selected);
  }
});

test('missing detail remains unavailable, no zero-valued record is invented', async () => {
  const reader = new LegacyHistoryReader(access({ loadHistorySession: async () => null })); await reader.select('missing');
  assert.equal(reader.getSnapshot().selected, null); assert.match(reader.getSnapshot().error!, /不可读取/);
});

test('effect reconnect invalidates old work and works after development lifecycle replay', async () => {
  const old = deferred<LegacyHistoryList>(); let call = 0; const reader = new LegacyHistoryReader(access({ listHistory: () => ++call === 1 ? old.promise : Promise.resolve(list) }));
  const pending = reader.refresh(); reader.dispose(); reader.activate(); await reader.refresh(); old.reject(Error('old effect')); await pending;
  assert.equal(reader.getSnapshot().list, list); assert.equal(reader.getSnapshot().error, null);
});

test('a reentrant listener cannot start an obsolete read or export handoff', async () => {
  let reads = 0, writes = 0; const reader = new LegacyHistoryReader(access({ loadHistorySession: async id => { reads++; return entry(id); } }));
  let once = true; reader.subscribe(() => { if (once && reader.getSnapshot().loading) { once = false; reader.back(); } });
  await reader.select('a'); assert.equal(reads, 0); await reader.select('b');
  reader.subscribe(() => { if (reader.getSnapshot().downloading) reader.back(); }); await reader.download('json', () => writes++); assert.equal(writes, 0);
});

const page = (id: string, more = false): LegacyHistoryList => ({ ...list, entries: [{status: 'ready', summary: entry(id).summary}], hasMore: more, nextCursor: more ? {version: 1, updatedAtMs: 123, key: id} : null });
test('paging reaches older entries, previous rereads its boundary, detail/back retains page', async () => {
  const requests: unknown[] = []; const reader = new LegacyHistoryReader(access({listHistory: async options => {
    requests.push(options?.after ?? null); return options?.after ? page('old') : page('recent', true);
  }}));
  await reader.refresh(); await reader.changePage('next');
  assert.equal(reader.getSnapshot().page, 2); assert.equal(reader.getSnapshot().list?.entries[0].status, 'ready');
  await reader.select('old'); reader.back(); assert.equal(reader.getSnapshot().page, 2);
  await reader.changePage('previous'); assert.equal(reader.getSnapshot().page, 1);
  assert.deepEqual(requests, [null, {version:1,updatedAtMs:123,key:'recent'}, null]);
});
test('page failure keeps current entries and cursor for retry, with no false empty result', async () => {
  let fails = true; const first = page('recent', true);
  const reader = new LegacyHistoryReader(access({listHistory: async options => { if (!options?.after) return first; if (fails) throw Error('blocked'); return page('old'); }}));
  await reader.refresh(); await reader.changePage('next'); assert.equal(reader.getSnapshot().list, first);
  assert.equal(reader.getSnapshot().page, 1); assert.match(reader.getSnapshot().error!, /仍保留当前列表/);
  fails = false; await reader.changePage('next'); assert.equal(reader.getSnapshot().page, 2); assert.equal(reader.getSnapshot().error, null);
});
test('repeated next starts once, while refresh, detail and disposal invalidate late pages', async () => {
  for (const action of ['refresh', 'select', 'dispose'] as const) {
    const pending = deferred<LegacyHistoryList>(); let moreCalls = 0;
    const reader = new LegacyHistoryReader(access({listHistory: async options => { if(options?.after) {moreCalls++; return pending.promise;} return page('recent', true); }}));
    await reader.refresh(); const old = reader.changePage('next'); await reader.changePage('next'); assert.equal(moreCalls, 1);
    if(action === 'refresh') await reader.refresh(); else if(action === 'select') await reader.select('picked'); else reader.dispose();
    pending.resolve(page('stale')); await old;
    assert.equal(reader.getSnapshot().page, 1); assert.equal(reader.getSnapshot().paging, false);
    if(action === 'select') assert.equal(reader.getSnapshot().selected?.snapshot.sessionId, 'picked');
    else if(action === 'dispose') assert.equal(reader.getSnapshot().list, null);
    else assert.equal(reader.getSnapshot().list?.hasMore, true);
  }
});
test('paging tolerates a deleted final batch, allowing previous or refresh without invention', async () => {
  const reader = new LegacyHistoryReader(access({listHistory: async options => options?.after ? list : page('recent', true)}));
  await reader.refresh(); await reader.changePage('next'); assert.equal(reader.getSnapshot().page, 2);
  assert.equal(reader.getSnapshot().list?.entries.length, 0); assert.equal(reader.getSnapshot().list?.hasMore, false);
  await reader.changePage('previous'); assert.equal(reader.getSnapshot().page, 1);
});
