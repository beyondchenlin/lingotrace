import test from 'node:test';
import assert from 'node:assert/strict';
import { CAFE_MATERIAL } from './training.ts';
import { LOCAL_REFERENCE_MEDIA_ID, LOCAL_REFERENCE_MEDIA_SHA256 } from './local-reference.ts';
import { buildReviewTarget, captureReviewSource, reviewActiveKey } from './review-tasks.ts';
const media = { id: LOCAL_REFERENCE_MEDIA_ID, sha256: LOCAL_REFERENCE_MEDIA_SHA256, durationSeconds: 72 };
test('review target fixes the complete material, actual media and target cue without scoring', async () => {
  const target = await buildReviewTarget(CAFE_MATERIAL, CAFE_MATERIAL.cues[0].id, media);
  assert.equal(target.material.version, CAFE_MATERIAL.version); assert.match(target.materialDigest, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(target.material.cues));
  await assert.rejects(buildReviewTarget(CAFE_MATERIAL, 'missing', media));
  await assert.rejects(buildReviewTarget(CAFE_MATERIAL, CAFE_MATERIAL.cues[0].id, {...media, durationSeconds: 1}));
});
test('locator exact union rejects extra private content and identity keys distinguish real attempts', async () => {
  const source = { kind: 'full' as const, sessionId: 's', attemptId: 'a', submitEventId: 'q', judgmentEventId: 'j' };
  assert.throws(() => captureReviewSource({...source, answer: 'private'}));
  assert.throws(() => captureReviewSource({...source, kind: 'partial', segmentId: 'p', generation: 0}));
  const target = await buildReviewTarget(CAFE_MATERIAL, CAFE_MATERIAL.cues[0].id, media);
  assert.notEqual(reviewActiveKey(source,target), reviewActiveKey({...source, attemptId: 'b'},target));
});
