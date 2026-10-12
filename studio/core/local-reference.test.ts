import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CAFE_MATERIAL } from './training';
import {
  LOCAL_REFERENCE_MEDIA_ID, LOCAL_REFERENCE_MEDIA_SHA256, LOCAL_REFERENCE_TRACK_ID,
  buildLocalReferenceProposal, canonicalMaterialDigest, canonicalLocalReferenceJSON, captureLocalReference,
  isLocalReferenceBinding, validateOptionalLocalReference, validateLocalReferenceReceipt,
  type BuildLocalReferenceOptions, type LocalReferenceReceipt,
} from './local-reference';
const time = '2026-10-10T08:00:00.000Z';
const media = { id: LOCAL_REFERENCE_MEDIA_ID, sha256: LOCAL_REFERENCE_MEDIA_SHA256, durationSeconds: 72 };
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
function options(patch: Partial<BuildLocalReferenceOptions> = {}): BuildLocalReferenceOptions {
  return { original: CAFE_MATERIAL, parent: CAFE_MATERIAL, editedCueId: CAFE_MATERIAL.cues[1].id,
    text: 'Would you like that coffee hot or iced?', start: 6.15, end: 11.85, media, saveRequestId: 'request-1', createdAt: time, ...patch };
}
function copy<T>(value: T): T { return structuredClone(value); }
async function sign(row: LocalReferenceReceipt): Promise<LocalReferenceReceipt> {
  const value = { ...row, materialDigest: await canonicalMaterialDigest(row.material, digest) };
  const { receiptDigest: _, ...unsigned } = value;
  return { ...value, receiptDigest: await digest(canonicalLocalReferenceJSON(unsigned)) };
}

test('proposal retains exact whole original metadata and stable cue order, changing only current text/range', async () => {
  const before = JSON.stringify(CAFE_MATERIAL), proposal = await buildLocalReferenceProposal(options(), digest);
  assert.equal(JSON.stringify(CAFE_MATERIAL), before);
  assert.equal(proposal.material.version, 'local-ref:request-1');
  assert.equal(proposal.materialDigest, await canonicalMaterialDigest(proposal.material, digest));
  assert.equal(proposal.parent.digest, await canonicalMaterialDigest(CAFE_MATERIAL, digest));
  assert.deepEqual(proposal.material.cues.map(cue => cue.id), CAFE_MATERIAL.cues.map(cue => cue.id));
  assert.deepEqual(proposal.change.before, CAFE_MATERIAL.cues[1]);
  assert.deepEqual(proposal.change.after, proposal.material.cues[1]);
  assert.deepEqual(proposal.material.localReference, { version: 'local-reference-v1', trackId: LOCAL_REFERENCE_TRACK_ID,
    language: 'en', parentVersion: CAFE_MATERIAL.version, editedCueId: CAFE_MATERIAL.cues[1].id, media });
  assert.ok(Object.isFrozen(proposal) && Object.isFrozen(proposal.material.cues) && Object.isFrozen(proposal.change.after));
  for (let i = 0; i < CAFE_MATERIAL.cues.length; i++) if (i !== 1) assert.deepEqual(proposal.material.cues[i], CAFE_MATERIAL.cues[i]);
});

test('default digest is full SHA-256 and canonical identity is independent of property insertion order', async () => {
  const { id, version, title, rights, cues } = CAFE_MATERIAL;
  const reordered = { cues, rights, title, version, id };
  assert.equal(await canonicalMaterialDigest(CAFE_MATERIAL), await canonicalMaterialDigest(reordered));
  assert.equal(await canonicalMaterialDigest(CAFE_MATERIAL), await canonicalMaterialDigest(CAFE_MATERIAL, digest));
  const metadata = { ...CAFE_MATERIAL, archival: { retained: true, precise: 0.000000001 } };
  assert.notEqual(await canonicalMaterialDigest(metadata, digest), await canonicalMaterialDigest(CAFE_MATERIAL, digest));
  const proposal = await buildLocalReferenceProposal(options({ original: metadata, parent: metadata }), digest);
  assert.deepEqual((proposal.material as typeof metadata).archival, metadata.archival);
});

test('legacy absent metadata keeps old materials readable; any newly present unsupported envelope throws', () => {
  for (const value of [{}, { id: 'old', cues: [{ text: '', start: Infinity }] }, { id: 'unknown-old', extra: 'retained' }]) assert.doesNotThrow(() => validateOptionalLocalReference(value));
  for (const localReference of [undefined, null, {}, { version: 'future-v2' }]) assert.throws(() => validateOptionalLocalReference({ ...CAFE_MATERIAL, localReference }));
  let getterCalls = 0;
  const getter = Object.defineProperty({ ...CAFE_MATERIAL }, 'localReference', { get() { getterCalls++; return null; }, enumerable: true });
  assert.throws(() => validateOptionalLocalReference(getter)); assert.equal(getterCalls, 0);
});

test('binding validator rejects unknown/extra fields, wrong media identity and invalid duration', async () => {
  const valid = (await buildLocalReferenceProposal(options(), digest)).material.localReference!;
  assert.equal(isLocalReferenceBinding(valid), true);
  for (const candidate of [
    { ...valid, extra: true }, { ...valid, trackId: 'other-track' }, { ...valid, language: 'fr' }, { ...valid, parentVersion: '' },
    { ...valid, version: 'future-v2' }, { ...valid, media: { ...media, extra: true } }, { ...valid, media: { ...media, sha256: '0'.repeat(64) } },
    { ...valid, media: { ...media, id: 'same-file-name' } }, ...[NaN, Infinity, -Infinity, 0, -1, undefined].map(durationSeconds => ({ ...valid, media: { ...media, durationSeconds } })),
  ]) assert.equal(isLocalReferenceBinding(candidate), false);
});

test('no-op never produces a new version while exact punctuation/time edits remain unnormalized', async () => {
  const cue = CAFE_MATERIAL.cues[1];
  await assert.rejects(buildLocalReferenceProposal(options({ text: cue.text, start: cue.start, end: cue.end }), digest), { code: 'no-change' });
  const exact = await buildLocalReferenceProposal(options({ text: ` ${cue.text} `, start: cue.start, end: cue.end }), digest);
  assert.equal(exact.material.cues[1].text, ` ${cue.text} `);
  const numeric = await buildLocalReferenceProposal(options({ text: '123' }), digest);
  assert.equal(numeric.material.cues[1].text, '123', 'existing Training English token grammar also scores digits');
  const tiny = await buildLocalReferenceProposal(options({ text: cue.text, start: cue.start + 0.00000001, end: cue.end }), digest);
  assert.equal(tiny.material.cues[1].start, cue.start + 0.00000001);
});

for (const [name, patch] of Object.entries({
  empty: { text: '  ' }, punctuation: { text: '...' }, unscorable: { text: '只有中文' }, oversized: { text: 'a'.repeat(8001) },
  negativeStart: { start: -1 }, zeroRange: { start: 10, end: 10 }, reversed: { start: 11, end: 10 },
  tooLong: { end: 72.000000001 }, missingDuration: { media: { ...media, durationSeconds: undefined } },
  infiniteDuration: { media: { ...media, durationSeconds: Infinity } }, notFiniteStart: { start: NaN },
  hashMismatch: { media: { ...media, sha256: 'f'.repeat(64) } }, missingCue: { editedCueId: 'not-selected' },
  sameVersion: { version: CAFE_MATERIAL.version }, emptyRequest: { saveRequestId: '' },
})) test(`invalid draft ${name} rejects without clipping or duration fallback`, async () => {
  await assert.rejects(buildLocalReferenceProposal(options(patch as Partial<BuildLocalReferenceOptions>), digest));
});

test('arbitrary unbound historical material cannot be promoted into canonical lineage', async () => {
  for (const parent of [
    { ...CAFE_MATERIAL, version: 'old-import' }, { ...CAFE_MATERIAL, title: 'changed' },
    { ...CAFE_MATERIAL, cues: [{ ...CAFE_MATERIAL.cues[0], text: 'changed' }, ...CAFE_MATERIAL.cues.slice(1)] },
    { ...CAFE_MATERIAL, extra: 'hidden data' },
  ]) await assert.rejects(buildLocalReferenceProposal(options({ parent }), digest), { code: 'stale-reference' });
});

test('child proposal keeps exact parent media duration and parent whole-material digest', async () => {
  const parent = await buildLocalReferenceProposal(options(), digest);
  const child = await buildLocalReferenceProposal(options({ parent: parent.material, saveRequestId: 'request-2', text: 'Hot or iced coffee?' }), digest);
  assert.equal(child.parent.digest, parent.materialDigest); assert.equal(child.parent.version, parent.material.version);
  assert.deepEqual(child.change.before, parent.material.cues[1]);
  await assert.rejects(buildLocalReferenceProposal(options({ parent: parent.material, saveRequestId: 'request-3', text: 'Hot coffee?', media: { ...media, durationSeconds: 73 } }), digest), { code: 'stale-reference' });
});

test('valid hashes do not authorize another cue, reorder/count/ID edits or material metadata changes', async () => {
  const row = await buildLocalReferenceProposal(options(), digest);
  const variants = [
    { ...row.material, cues: row.material.cues.map((cue, i) => i === 0 ? { ...cue, text: 'Another edited cue.' } : cue) },
    { ...row.material, cues: [...row.material.cues].reverse() }, { ...row.material, cues: row.material.cues.slice(1) },
    { ...row.material, cues: row.material.cues.map((cue, i) => i === 0 ? { ...cue, id: 'new-id' } : cue) },
    { ...row.material, title: 'changed' }, { ...row.material, rights: 'changed' }, { ...row.material, extra: 'injected' },
    { ...row.material, cues: row.material.cues.map((cue, i) => i === 1 ? { ...cue, extra: 'injected' } : cue) },
  ];
  for (const material of variants) await assert.rejects(validateLocalReferenceReceipt(await sign({ ...row, material }), CAFE_MATERIAL, CAFE_MATERIAL, digest));
});

test('full row validates change before/after, parent digest, material digest and receipt digest', async () => {
  const row = await buildLocalReferenceProposal(options(), digest);
  const variants = [
    { ...row, materialDigest: '0'.repeat(64) }, { ...row, parent: { ...row.parent, digest: '0'.repeat(64) } },
    { ...row, change: { ...row.change, before: { ...row.change.before, text: 'different' } } },
    { ...row, change: { ...row.change, after: { ...row.change.after, end: 11.9 } } },
    { ...row, createdAt: '2026-10-11T08:00:00.000Z' }, { ...row, saveRequestId: 'another-request' },
    { ...row, receiptDigest: '0'.repeat(64) }, { ...row, extra: 'unknown' },
  ];
  for (const value of variants) await assert.rejects(validateLocalReferenceReceipt(value, CAFE_MATERIAL, CAFE_MATERIAL, digest));
});

test('canonical digest cannot silently omit symbols/accessors/undefined/holes or mutate inputs across async work', async () => {
  const getter = Object.defineProperty({}, 'secret', { enumerable: true, get() { throw new Error('must never execute'); } });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const value of [{ a: undefined }, { a: NaN }, { a: -0 }, { a: 1n }, { [Symbol('lost')]: 1 }, getter, [, 1], cycle, new Date()]) assert.throws(() => canonicalLocalReferenceJSON(value));
  const input = copy(options()); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const build = buildLocalReferenceProposal(input, async value => { await gate; return digest(value); });
  (input.parent.cues[0] as { text: string }).text = 'Mutated during digest.';
  (input as { text: string }).text = 'Changed while hashing.';
  release(); const result = await build;
  assert.equal(result.material.cues[0].text, CAFE_MATERIAL.cues[0].text);
  assert.equal(result.material.cues[1].text, options().text);
  assert.deepEqual(captureLocalReference(result), result);
});
