import test from 'node:test';
import assert from 'node:assert/strict';
import { TrainingEngine, CAFE_MATERIAL, type TrainingSnapshot } from './training';
import {
  CONTEXT_BOOKMARK_MEDIA_ID, CONTEXT_BOOKMARK_MEDIA_SHA256, ContextBookmarkError, getBookmarkReference,
  isCurrentBookmarkReference, contextBookmarkWords, contextBookmarkSelection, contextBookmarkKey,
  createContextBookmark, validateContextBookmark,
} from './context-bookmark';

const createdAt = '2026-10-10T06:00:00.000Z', saveId = 'f0c27bd3-1fb3-4d23-9682-3b0c6e4c1eb9';
function engine(): TrainingEngine {
  let id = 0;
  return new TrainingEngine({ clock: { now: () => 0, wallTime: () => createdAt, id: () => `bookmark-${++id}` } });
}
function reference() {
  const current = engine(); current.input('my private answer'); current.submit();
  return getBookmarkReference(current.getSnapshot(), CAFE_MATERIAL.cues[0].id)!;
}

test('only an already submitted current original row can supply a reference', () => {
  const current = engine(), cueId = CAFE_MATERIAL.cues[0].id;
  assert.equal(getBookmarkReference(current.getSnapshot(), cueId), null);
  current.input(CAFE_MATERIAL.cues[0].text);
  assert.equal(getBookmarkReference(current.getSnapshot(), cueId), null, 'a draft is not a submission');
  current.submit();
  const before = JSON.stringify(current.getSnapshot()), bound = getBookmarkReference(current.getSnapshot(), cueId)!;
  assert.equal(bound.text, CAFE_MATERIAL.cues[0].text);
  assert.equal(bound.mediaId, CONTEXT_BOOKMARK_MEDIA_ID); assert.equal(bound.mediaSha256, CONTEXT_BOOKMARK_MEDIA_SHA256);
  assert.equal(getBookmarkReference(current.getSnapshot(), CAFE_MATERIAL.cues[1].id), null);
  assert.equal(getBookmarkReference(current.getSnapshot(), 'missing'), null);
  current.input('new private unsent draft');
  assert.deepEqual(getBookmarkReference(current.getSnapshot(), cueId), bound, 'a later draft does not replace the submitted original');
  assert.doesNotMatch(JSON.stringify(bound), /answer|draft|accuracy|errors|gain|attempt|private/);
  assert.ok(Object.isFrozen(bound));
  const after = current.getSnapshot(); getBookmarkReference(after, cueId);
  assert.equal(JSON.stringify(after), JSON.stringify(current.getSnapshot())); assert.notEqual(JSON.stringify(after), before);
});

test('a wrong submission is eligible without copying answers, scores or training identities', () => {
  const ref = reference(), bookmark = createContextBookmark(ref, 0, 7, createdAt, saveId);
  assert.equal(bookmark.selection.text, 'Could I');
  assert.deepEqual(Object.keys(bookmark).sort(), ['schemaVersion', 'key', 'saveId', 'reference', 'selection', 'createdAt'].sort());
  assert.doesNotMatch(JSON.stringify(bookmark), /private answer|answer|accuracy|errors|draft|sessionId|roundId|attemptId/);
});

test('mismatched current material, original text, cue time, rule and round evidence are unavailable', () => {
  const current = engine(); current.input('wrong'); current.submit(); const snapshot = current.getSnapshot(), cueId = CAFE_MATERIAL.cues[0].id;
  const bad: TrainingSnapshot[] = [
    { ...snapshot, material: { ...snapshot.material, id: 'uploaded-local-file' } },
    { ...snapshot, material: { ...snapshot.material, version: 'changed-version' } },
    ...[{ text: 'Could I have another coffee?' }, { start: 1 }, { end: 5 }, { start: NaN }, { id: 'changed' }].map(patch => ({ ...snapshot, material: { ...snapshot.material, cues: [{ ...snapshot.material.cues[0], ...patch }, ...snapshot.material.cues.slice(1)] } })),
    { ...snapshot, material: { ...snapshot.material, cues: [snapshot.material.cues[0], ...snapshot.material.cues] } },
    ...[{ sessionId: 'other' }, { roundId: 'other' }, { reference: 'different' }, { materialVersion: 'old' }, { ruleVersion: '' }, { attemptId: '' }, { words: 0 }, { accuracy: NaN }, { errors: -1 }].map(patch => ({ ...snapshot, attempts: [{ ...snapshot.attempts[0], ...patch }] })),
    { ...snapshot, attempts: [snapshot.attempts[0], snapshot.attempts[0]] },
  ];
  for (const value of bad) assert.equal(getBookmarkReference(value, cueId), null);
  for (const value of [null, {}, { material: null }]) assert.equal(getBookmarkReference(value as unknown as TrainingSnapshot, cueId), null);
});

test('word spans and contiguous phrases preserve exact original casing and punctuation', () => {
  const ref = reference(), words = contextBookmarkWords(ref);
  assert.deepEqual(words.map(word => word.text), ['Could', 'I', 'have', 'a', 'coffee', 'please']);
  for (const word of words) assert.equal(word.text, ref.text.slice(word.start, word.end));
  assert.equal(contextBookmarkSelection(ref, words[4].start, words[5].end).text, 'coffee, please');
  assert.ok(Object.isFrozen(words)); assert.ok(words.every(Object.isFrozen));
  for (const [start, end] of [[0, 0], [1, 5], [0, 4], [-1, 5], [0, 100], [0, NaN], [0.5, 5], [5, 7], [22, 28]]) {
    assert.throws(() => contextBookmarkSelection(ref, start, end), ContextBookmarkError);
  }
});

test('deterministic key distinguishes source cue and exact selection but not creation incarnation', () => {
  const ref = reference();
  const a = createContextBookmark(ref, 0, 5, createdAt, saveId), b = createContextBookmark(ref, 0, 5, '2026-10-10T07:00:00.000Z', 'c767b7b2-4205-477a-a9fb-04fd08eb0d38');
  assert.equal(a.key, b.key); assert.equal(a.key, contextBookmarkKey(ref, 0, 5));
  assert.notEqual(a.key, contextBookmarkKey(ref, 0, 7)); assert.notEqual(a.saveId, b.saveId);
});

test('validation returns immutable narrow copies and rejects unknown or extra persisted data', () => {
  const bookmark = createContextBookmark(reference(), 0, 5, createdAt, saveId), copied = JSON.parse(JSON.stringify(bookmark));
  const read = validateContextBookmark(copied); copied.selection.text = 'changed'; copied.reference.text = 'changed';
  assert.deepEqual(read, bookmark); assert.notEqual(read, bookmark);
  assert.ok(Object.isFrozen(read) && Object.isFrozen(read.selection) && Object.isFrozen(read.reference));
  for (const value of [null, [], {}, { ...bookmark, schemaVersion: 'future-v2' }, { ...bookmark, saveId: '' }, { ...bookmark, saveId: 'not-a-uuid' },
    { ...bookmark, answer: 'private' }, { ...bookmark, createdAt: 'yesterday' }, { ...bookmark, createdAt: '2026-02-31T06:00:00.000Z' },
    { ...bookmark, key: 'forged' }, { ...bookmark, selection: { ...bookmark.selection, text: 'Could?' } },
    { ...bookmark, selection: { ...bookmark.selection, start: 1 } }, { ...bookmark, selection: { ...bookmark.selection, answer: 'private' } }]) {
    assert.throws(() => validateContextBookmark(value), ContextBookmarkError);
  }
});

test('every declared media and source field is pinned; stale values cannot be repaired or played', () => {
  const bookmark = createContextBookmark(reference(), 0, 5, createdAt, saveId);
  for (const patch of [{ materialId: 'other' }, { materialVersion: 'old' }, { cueId: 'other' }, { text: 'Changed reference' },
    { startSeconds: 1 }, { endSeconds: 7 }, { startSeconds: NaN }, { endSeconds: Infinity }, { mediaId: 'local-file' },
    { mediaSha256: '0'.repeat(64) }, { mediaSha256: undefined }, { url: 'blob:unverified' }]) {
    const ref = { ...bookmark.reference, ...patch };
    assert.equal(isCurrentBookmarkReference(ref), false);
    assert.throws(() => validateContextBookmark({ ...bookmark, reference: ref }), { code: 'stale-reference' });
  }
});

test('unreadable accessor records never run supplied getters or borrow inherited fields', () => {
  const bookmark = createContextBookmark(reference(), 0, 5, createdAt, saveId); let calls = 0;
  const record = { ...bookmark }; Object.defineProperty(record, 'reference', { get: () => { calls++; return bookmark.reference; }, enumerable: true });
  assert.throws(() => validateContextBookmark(record)); assert.equal(calls, 0);
  const ref = { ...bookmark.reference }; Object.defineProperty(ref, 'text', { get: () => { calls++; return bookmark.reference.text; }, enumerable: true });
  assert.equal(isCurrentBookmarkReference(ref), false); assert.equal(calls, 0);
  assert.throws(() => validateContextBookmark(Object.create(bookmark)));
});
