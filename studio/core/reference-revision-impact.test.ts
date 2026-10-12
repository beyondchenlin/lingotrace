import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
import {CAFE_MATERIAL, TrainingEngine} from './training';
import {exportStudioSession} from './session-export';
import {buildLocalReferenceProposal, buildLocalReferenceStructureProposal, canonicalLocalReferenceJSON, LOCAL_REFERENCE_MEDIA_ID, LOCAL_REFERENCE_MEDIA_SHA256, type LocalReferenceMaterial, type LocalReferenceReceipt} from './local-reference';
import {IndexedDBLocalReferenceRepository, LOCAL_REFERENCE_DATABASE_NAME, LOCAL_REFERENCE_STORE_NAME, type LocalReferenceList} from './local-reference-repository';
import {deriveReferenceRevisionImpact, ReferenceRevisionImpactReader, type ReferenceRevisionImpactAccess} from './reference-revision-impact';

const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
const media = {id: LOCAL_REFERENCE_MEDIA_ID, sha256: LOCAL_REFERENCE_MEDIA_SHA256, durationSeconds: 72};
async function edit(parent: LocalReferenceMaterial, id: string, cueIndex = 1, patch: {text?: string; start?: number; end?: number} = {}) {
  const cue = parent.cues[cueIndex];
  return buildLocalReferenceProposal({original: CAFE_MATERIAL, parent, saveRequestId: id, editedCueId: cue.id,
    text: patch.text ?? `Private corrected reference ${id}.`, start: patch.start ?? cue.start, end: patch.end ?? cue.end, media, createdAt: '2026-10-12T00:00:00.000Z'}, digest);
}
const list = (entries: readonly LocalReferenceReceipt[], unreadableCount = 0): LocalReferenceList => ({entries, unreadableCount});
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test('full historical identity anchors only its own direct and subsequent verified revisions without exposing text', async () => {
  const root = await edit(CAFE_MATERIAL, 'root'), child = await edit(root.material, 'child', 2), sibling = await edit(CAFE_MATERIAL, 'sibling');
  const all = list([child, sibling, root]);
  const first = await deriveReferenceRevisionImpact(CAFE_MATERIAL, all, digest);
  assert.equal(first.status, 'matched');
  assert.deepEqual(first.revisions.map(item => [item.materialVersion, item.relation, item.kind]), [
    [root.material.version, 'direct', 'text'], [sibling.material.version, 'direct', 'text'], [child.material.version, 'subsequent', 'text'],
  ]);
  const fromEdited = await deriveReferenceRevisionImpact(root.material, all, digest);
  assert.deepEqual(fromEdited.revisions.map(item => item.materialVersion), [child.material.version]);
  assert.deepEqual(fromEdited.revisions[0].affectedHistoricalUnitIds, [CAFE_MATERIAL.cues[2].id]);
  assert.doesNotMatch(JSON.stringify(first), /Private corrected reference|Could I have/);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.revisions) && Object.isFrozen(first.revisions[0].affectedHistoricalUnitIds));
});

test('same cue, material ID or version never substitutes for full historical material identity', async () => {
  const revision = await edit(CAFE_MATERIAL, 'revision');
  for (const material of [
    {...CAFE_MATERIAL, title: 'Changed complete material metadata'},
    {...CAFE_MATERIAL, cues: CAFE_MATERIAL.cues.map((cue, index) => index === 8 ? {...cue, text: 'Other content.'} : cue)},
    {...CAFE_MATERIAL, version: 'an-unrelated-version'},
    {...CAFE_MATERIAL, privateMetadata: {source: 'different'}},
    {...CAFE_MATERIAL, id: 'unrelated-course'},
  ]) {
    const result = await deriveReferenceRevisionImpact(material, list([revision]), digest);
    assert.equal(result.status, 'no-match'); assert.deepEqual(result.revisions, []);
  }
  const changedSaved = {...revision.material, title: 'same local version with different material'};
  const child = await edit(revision.material, 'child');
  assert.equal((await deriveReferenceRevisionImpact(changedSaved, list([revision, child]), digest)).status, 'no-match');
});

test('text, exact timing and combined corrections are classified without normalizing timestamps', async () => {
  const cue = CAFE_MATERIAL.cues[1];
  const timing = await edit(CAFE_MATERIAL, 'timing', 1, {text: cue.text, start: cue.start + 0.00000001});
  const both = await edit(timing.material, 'both', 1, {end: cue.end - 0.25});
  const result = await deriveReferenceRevisionImpact(CAFE_MATERIAL, list([both, timing]), digest);
  assert.deepEqual(result.revisions.map(item => item.kind), ['timing', 'text-and-timing']);
  assert.deepEqual(result.revisions.map(item => item.affectedHistoricalUnitIds), [[cue.id], [cue.id]]);
});

test('read-only history projection preserves snapshot, attempts, score and reference receipts byte-for-byte', async () => {
  const engine = new TrainingEngine({sessionId: 'history-unchanged'}); engine.input('Could I have a coffee, please?', 'typed'); await engine.submit();
  const snapshot = engine.getSnapshot(), revision = await edit(snapshot.material, 'later');
  const before = canonicalLocalReferenceJSON(snapshot), receiptBefore = canonicalLocalReferenceJSON(revision);
  const exportedAt = '2026-10-12T00:00:00.000Z', exportedBefore = exportStudioSession(snapshot, exportedAt);
  const result = await deriveReferenceRevisionImpact(snapshot.material, list([revision]), digest);
  assert.equal(result.status, 'matched'); assert.equal(canonicalLocalReferenceJSON(snapshot), before); assert.equal(canonicalLocalReferenceJSON(revision), receiptBefore);
  assert.deepEqual(exportStudioSession(snapshot, exportedAt), exportedBefore);
});

test('actual validated library read has no false clean state when a corrupt ancestor removes descendants', async () => {
  const factory = new IDBFactory(), repository = new IndexedDBLocalReferenceRepository({original: CAFE_MATERIAL, indexedDB: factory, digest, broadcastChannel: () => null});
  const parent = await edit(CAFE_MATERIAL, 'parent'), child = await edit(parent.material, 'child');
  await repository.save(parent); await repository.save(child);
  const result = await deriveReferenceRevisionImpact(CAFE_MATERIAL, await repository.list(), digest);
  assert.equal(result.revisions.length, 2);
  const request = factory.open(LOCAL_REFERENCE_DATABASE_NAME, 1);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LOCAL_REFERENCE_STORE_NAME, 'readwrite');
    tx.objectStore(LOCAL_REFERENCE_STORE_NAME).put({...parent, material: {...parent.material, title: 'Corrupted ancestor'}});
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
  }); db.close();
  const before = await factory.databases();
  const partial = await deriveReferenceRevisionImpact(CAFE_MATERIAL, await repository.list(), digest);
  assert.deepEqual(await factory.databases(), before);
  assert.equal(partial.status, 'no-match'); assert.equal(partial.unreadableCount, 2);
  await repository.close();
});

test('reader starts inert, refreshes on library invalidation and never calls a write capability', async () => {
  const revision = await edit(CAFE_MATERIAL, 'new'), callbacks = new Set<() => void>(); let reads = 0, unsubscribed = 0;
  const repository: ReferenceRevisionImpactAccess = {list: async () => {reads++; return list([revision]);}, subscribe: callback => {callbacks.add(callback); return () => {unsubscribed++; callbacks.delete(callback);};}};
  const reader = new ReferenceRevisionImpactReader(repository, CAFE_MATERIAL, digest);
  assert.equal(reads, 0); assert.equal(reader.getSnapshot().status, 'idle');
  reader.activate(); await settle(); assert.equal(reads, 1); assert.equal(reader.getSnapshot().status, 'ready');
  callbacks.forEach(callback => callback()); await settle(); assert.equal(reads, 2);
  reader.dispose(); assert.equal(unsubscribed, 1); assert.equal(callbacks.size, 0);
});

test('failed, superseded and disposed reads cannot display stale verified impacts or claim unchanged', async () => {
  const revision = await edit(CAFE_MATERIAL, 'latest');
  const pending: {resolve: (value: LocalReferenceList) => void; reject: (error: Error) => void}[] = [];
  const repository: ReferenceRevisionImpactAccess = {list: () => new Promise((resolve, reject) => pending.push({resolve, reject})), subscribe: () => () => {}};
  const reader = new ReferenceRevisionImpactReader(repository, CAFE_MATERIAL, digest); reader.activate();
  const next = reader.refresh(); pending[1].resolve(list([revision])); await next;
  assert.equal(reader.getSnapshot().status, 'ready');
  pending[0].resolve(list([])); await settle(); assert.equal(reader.getSnapshot().result?.status, 'matched');
  const failed = reader.refresh(); assert.equal(reader.getSnapshot().result, null); pending[2].reject(new Error('read failed')); await failed;
  assert.equal(reader.getSnapshot().status, 'unavailable'); assert.equal(reader.getSnapshot().result, null);
  const late = reader.refresh(); reader.dispose(); pending[3].resolve(list([revision])); await late; assert.notEqual(reader.getSnapshot().status, 'ready');
});

test('empty reference library remains a bounded no-match and is never created by history inspection', async () => {
  const factory = new IDBFactory(), repository = new IndexedDBLocalReferenceRepository({original: CAFE_MATERIAL, indexedDB: factory, digest, broadcastChannel: () => null});
  const reader = new ReferenceRevisionImpactReader(repository, CAFE_MATERIAL, digest); reader.activate(); await reader.refresh();
  assert.equal(reader.getSnapshot().result?.status, 'no-match'); assert.deepEqual(await factory.databases(), []);
  reader.dispose(); await repository.close();
});


test('verified split, descendant edit and merge propagate old-unit lineage without using a reused cue ID', async () => {
  const factory = new IDBFactory(), repository = new IndexedDBLocalReferenceRepository({original: CAFE_MATERIAL, indexedDB: factory, digest, broadcastChannel: () => null});
  const split = await buildLocalReferenceStructureProposal({original: CAFE_MATERIAL, parent: CAFE_MATERIAL, editedCueId: CAFE_MATERIAL.cues[1].id,
    operation: 'split', text: 'Split private first.', secondText: 'Split private second.', splitAt: 9, media, saveRequestId: 'split', createdAt: '2026-10-12T00:00:00.000Z'}, digest);
  const edited = await edit(split.material, 'split-second-edit', 2);
  const merged = await buildLocalReferenceStructureProposal({original: CAFE_MATERIAL, parent: edited.material, editedCueId: edited.material.cues[2].id,
    operation: 'merge', text: 'Merged private second and third.', media, saveRequestId: 'merge', createdAt: '2026-10-12T00:00:00.000Z'}, digest);
  const mergedEdit = await edit(merged.material, 'merged-edit', 2);
  const sibling = await edit(CAFE_MATERIAL, 'other-branch', 1);
  for (const row of [split, edited, merged, mergedEdit, sibling]) await repository.save(row);
  const result = await deriveReferenceRevisionImpact(CAFE_MATERIAL, await repository.list(), digest);
  const branch = result.revisions.filter(item => item.materialVersion !== sibling.material.version);
  const second = CAFE_MATERIAL.cues[1].id, third = CAFE_MATERIAL.cues[2].id;
  assert.deepEqual(branch.map(item => [item.kind, item.relation, item.affectedHistoricalUnitIds]), [
    ['split', 'direct', [second]], ['text', 'subsequent', [second]], ['merge', 'subsequent', [second, third]], ['text', 'subsequent', [second, third]],
  ]);
  assert.deepEqual(branch[2].parentUnitIds, [split.material.cues[2].id, third]);
  assert.deepEqual(branch[3].unitIds, [merged.material.cues[2].id]);
  const fromSplit = await deriveReferenceRevisionImpact(split.material, await repository.list(), digest);
  assert.deepEqual(fromSplit.revisions.map(item => item.materialVersion), [edited.material.version, merged.material.version, mergedEdit.material.version]);
  assert.deepEqual(fromSplit.revisions[0].affectedHistoricalUnitIds, [split.material.cues[2].id]);
  assert.deepEqual(fromSplit.revisions[2].affectedHistoricalUnitIds, [split.material.cues[2].id, third]);
  assert.doesNotMatch(JSON.stringify(result), /Split private|Merged private|Private corrected/);
  await repository.close();
});

test('missing intermediate revision never creates a shortcut from matching unit identifiers', async () => {
  const parent = await edit(CAFE_MATERIAL, 'missing-parent'), child = await edit(parent.material, 'child-only');
  const result = await deriveReferenceRevisionImpact(CAFE_MATERIAL, list([child]), digest);
  assert.equal(result.status, 'no-match'); assert.deepEqual(result.revisions, []);
});


test('unavailable complete-identity hashing never falls back to version or cue matching', async () => {
  const revision = await edit(CAFE_MATERIAL, 'digest-unavailable');
  const repository = {list: async () => list([revision]), subscribe: () => () => {}};
  const reader = new ReferenceRevisionImpactReader(repository, CAFE_MATERIAL, async () => {throw Error('Crypto unavailable');});
  reader.activate(); await reader.refresh();
  assert.equal(reader.getSnapshot().status, 'unavailable'); assert.equal(reader.getSnapshot().result, null); reader.dispose();
});

test('StrictMode-style reactivation removes old subscription and allows only the current lifetime result', async () => {
  const revision = await edit(CAFE_MATERIAL, 'strict-mode'); let subscribed = 0, unsubscribed = 0;
  const pending: ((value: LocalReferenceList) => void)[] = [];
  const reader = new ReferenceRevisionImpactReader({list: () => new Promise(resolve => pending.push(resolve)), subscribe: () => {subscribed++; return () => {unsubscribed++;};}}, CAFE_MATERIAL, digest);
  reader.activate(); reader.dispose(); reader.activate();
  pending[1](list([revision])); await settle(); assert.equal(reader.getSnapshot().result?.status, 'matched');
  pending[0](list([])); await settle(); assert.equal(reader.getSnapshot().result?.status, 'matched');
  reader.dispose(); assert.equal(subscribed, 2); assert.equal(unsubscribed, 2);
});
