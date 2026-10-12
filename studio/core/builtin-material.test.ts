import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NPS_MATERIAL, NPS_COURSE_MEDIA, validateOptionalBuiltinSource, isBuiltinMaterial, builtinCourseForMaterial } from './builtin-material.ts';
import { CAFE_MATERIAL } from './training.ts';

const assets = new URL('../../public/studio-assets/nps-connie/', import.meta.url);
const hash = (name: string) => createHash('sha256').update(readFileSync(new URL(name, assets))).digest('hex');

test('registered NPS assets preserve official bytes and the exact documented 11-sentence map', () => {
  const source = NPS_MATERIAL.builtinReference;
  assert.equal(hash('connie-lau-education-ranger-720p.mp4'), source.media.sha256);
  assert.equal(readFileSync(new URL('connie-lau-education-ranger-720p.mp4', assets)).byteLength, source.media.byteLength);
  assert.equal(hash('connie-lau-education-ranger.en.vtt'), source.officialCaptionSha256);
  assert.equal(hash('connie-lau-education-ranger.en.normalized.vtt'), source.normalizedCaptionSha256);
  assert.equal(hash('sentences.json'), source.sentenceMapSha256);
  assert.equal(source.sentenceMapSha256, '24ea8d06860298369f97e850df7069eb7e9b468ef2ad5df6468f6e868289eedc');
  assert.ok(NPS_MATERIAL.version.includes(source.sentenceMapSha256));
  const map = JSON.parse(readFileSync(new URL('sentences.json', assets), 'utf8'));
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', assets), 'utf8'));
  assert.equal(NPS_MATERIAL.id, manifest.id); assert.equal(source.sourcePage, manifest.sourcePage);
  assert.equal(source.sourceVideoUrl, manifest.sourceVideoUrl); assert.equal(source.sourceCaptionUrl, manifest.sourceCaptionUrl);
  assert.equal(source.credit, manifest.credit); assert.equal(source.policyUrl, manifest.policyUrl);
  assert.equal(source.timingBasis, map.timingBasis); assert.equal(source.sentenceMapVersion, map.version);
  assert.equal(NPS_MATERIAL.cues.length, 11);
  assert.deepEqual(NPS_MATERIAL.cues, map.sentences.map((cue: { text: string; startMs: number; endMs: number }, index: number) => ({
    id: `nps-connie-7fe78a9f-${index + 1}`, text: cue.text, start: cue.startMs / 1000, end: cue.endMs / 1000,
  })));
  assert.equal(NPS_MATERIAL.cues.at(-1)!.end, 43.366);
  assert.match(readFileSync(new URL('connie-lau-education-ranger.en.vtt', assets), 'utf8'), /00:00:43\.960/);
  assert.equal(NPS_COURSE_MEDIA.durationSeconds, 43.366667);
  assert.equal('localReference' in NPS_MATERIAL, false);
  assert.equal('parentVersion' in source, false); assert.equal('editedCueId' in source, false);
  assert.ok(Object.isFrozen(NPS_MATERIAL.cues[0])); assert.ok(Object.isFrozen(source.media));
});

test('only an exact registered material resolves; ordinary v1 absence is unchanged', () => {
  const copy = structuredClone(NPS_MATERIAL);
  assert.equal(isBuiltinMaterial(copy), true); assert.equal(builtinCourseForMaterial(copy), NPS_COURSE_MEDIA);
  assert.doesNotThrow(() => validateOptionalBuiltinSource(CAFE_MATERIAL));
  assert.equal(isBuiltinMaterial(CAFE_MATERIAL), false); assert.equal(builtinCourseForMaterial(CAFE_MATERIAL), null);
  assert.equal(isBuiltinMaterial({ id: 'preview', cues: [] }), false);
  assert.equal(isBuiltinMaterial(null), false);
  const reordered = Object.fromEntries(Object.entries(copy).reverse());
  assert.equal(isBuiltinMaterial(reordered), true);
});

test('missing, mutated, forged, extended or non-JSON built-in declarations fail closed', () => {
  const edits: ((value: any) => void)[] = [
    v => { delete v.builtinReference; }, v => { v.id = 'cafe-original'; }, v => { v.version += '-edited'; },
    v => { v.title += ' changed'; }, v => { v.rights = ''; }, v => { v.cues[0].text += ' changed'; },
    v => { v.cues[0].id = 'cafe-studio-1'; }, v => { v.cues[0].start = 0; }, v => { v.cues.at(-1).end = 43.960; },
    v => { v.builtinReference.media.sha256 = '0'.repeat(64); }, v => { v.builtinReference.media.id = 'cafe-original-video-v1'; },
    v => { v.builtinReference.media.byteLength--; }, v => { v.builtinReference.media.durationSeconds = 72; },
    v => { v.builtinReference.officialCaptionSha256 = '0'.repeat(64); }, v => { v.builtinReference.sentenceMapSha256 = '0'.repeat(64); },
    v => { v.builtinReference.sourcePage = 'https://example.test'; }, v => { v.builtinReference.version = 'future'; },
    v => { v.builtinReference = null; }, v => { v.localReference = {}; }, v => { v.extra = undefined; },
    v => { v.cues[0].start = -0; }, v => { v.cues[0].end = NaN; }, v => { v.builtinSource = v.builtinReference; },
    v => { delete v.builtinReference; v.id = 'fake'; }, // The stable version/cue identity remains a claim.
    v => { Object.defineProperty(v, 'builtinReference', { get() { throw new Error('Getter ran'); } }); },
    v => { v.builtinReference.extra = true; }, v => { v.cues.push(v.cues[0]); },
  ];
  for (const edit of edits) {
    const value = structuredClone(NPS_MATERIAL); edit(value);
    assert.throws(() => validateOptionalBuiltinSource(value), /built-in material\/source binding/);
    assert.throws(() => isBuiltinMaterial(value)); assert.throws(() => builtinCourseForMaterial(value));
  }
  assert.throws(() => builtinCourseForMaterial({ ...CAFE_MATERIAL, builtinReference: {} }));
  assert.throws(() => builtinCourseForMaterial(Object.create(NPS_MATERIAL)));
});
