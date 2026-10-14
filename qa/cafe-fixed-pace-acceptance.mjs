/** Automated acceptance harness: Cafe as verified Studio fixed-pace material.
 * Does not claim phone audio / real-device listening. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CAFE_FIXED_PACE_COURSE, typingFollowCourseIdentity, createTypingFollowState, reduceTypingFollow } from '../studio/core/typing-follow-policy.ts';
import { CAFE_MATERIAL } from '../studio/core/training.ts';
import { LOCAL_REFERENCE_MEDIA_ID, LOCAL_REFERENCE_MEDIA_SHA256 } from '../studio/core/local-reference.ts';
import { DEMO_LESSON_CARDS } from '../studio/carousel/motions.ts';

const mediaBytes = await readFile(new URL('../public/studio-assets/06-cafe.mp4', import.meta.url));
const mediaSha = createHash('sha256').update(mediaBytes).digest('hex');
assert.equal(mediaSha, LOCAL_REFERENCE_MEDIA_SHA256);
assert.equal(mediaSha, CAFE_FIXED_PACE_COURSE.mediaSha256);
assert.equal(LOCAL_REFERENCE_MEDIA_ID, CAFE_FIXED_PACE_COURSE.mediaId);
assert.equal(CAFE_MATERIAL.cues.length, 12);
assert.equal(CAFE_FIXED_PACE_COURSE.durationSeconds, 72);

const identity = typingFollowCourseIdentity(CAFE_MATERIAL, CAFE_MATERIAL.cues[0]);
assert.ok(identity);
assert.equal(identity.sentenceMapSha256, CAFE_FIXED_PACE_COURSE.sentenceMapSha256);

const envBase = {
  nowMs: 0, identity, playbackOwnerId: 'cafe-acceptance-lease',
  referenceShown: true, mode: 'legacy-typing', listeningPlayerActive: false,
  recording: 'idle', composing: false, focused: true, visible: true,
  practiceActive: true, blocked: false, sourceVerified: true, inputProvenanceAvailable: true,
  mediaReady: true, mediaDurationSeconds: 72, mediaPositionSeconds: 0, mediaRate: 1,
  rateWriteOwner: null, draftRevision: 0, fixedRate: 1,
};

const adaptive = reduceTypingFollow(createTypingFollowState(), { type: 'start', explicitUserGesture: true }, { ...envBase, pacingStrategy: 'adaptive' });
assert.equal(adaptive.state.reason, 'source-unqualified');
assert.equal(adaptive.intents.length, 0);

const fixed = reduceTypingFollow(createTypingFollowState(), { type: 'start', explicitUserGesture: true }, { ...envBase, pacingStrategy: 'fixed' });
assert.equal(fixed.state.phase, 'starting');
assert.equal(fixed.intents[0]?.type, 'start-cue');
assert.equal(fixed.intents[0]?.rate, 1);

const cafeCards = DEMO_LESSON_CARDS.filter(c => c.kind === 'cafe');
assert.ok(cafeCards.length >= 2);
assert.ok(cafeCards.every(c => c.href.includes('course=cafe')));
assert.equal(DEMO_LESSON_CARDS.some(c => c.kind === 'cafe-preview'), false);

console.log(JSON.stringify({
  ok: true,
  cafeMediaSha256: mediaSha,
  cafeByteLength: mediaBytes.byteLength,
  cues: CAFE_MATERIAL.cues.length,
  durationSeconds: CAFE_FIXED_PACE_COURSE.durationSeconds,
  adaptiveFollowBlocked: true,
  fixedPaceAdmitted: true,
  cardDeepLink: '/studio/?course=cafe',
  phoneAudioVerified: false,
  note: 'Harness proves SHA binding + fixed-pace registry + card deep link. No claim of phone audio acceptance.',
}, null, 2));
