/** PRD continue slice: course deep-link intent + Follow catalog entry.
 * Does not claim phone audio / real-device Follow acceptance. */
import assert from 'node:assert/strict';
import {
  parseCourseQueryParam,
  parseFollowQueryParam,
  resolveCourseDeepLink,
  stripCourseQueryParam,
  NPS_COURSE_ID,
  CAFE_COURSE_ID,
} from '../studio/core/course-deep-link.ts';
import { DEMO_LESSON_CARDS } from '../studio/carousel/motions.ts';

assert.equal(parseCourseQueryParam('cafe'), 'cafe');
assert.equal(parseFollowQueryParam('1'), true);

const restoredCafePrompt = resolveCourseDeepLink({
  requested: 'cafe',
  currentMaterialId: NPS_COURSE_ID,
  hasRestoredSession: true,
  freshAwaitingInput: false,
});
assert.equal(restoredCafePrompt.kind, 'prompt-switch');

const freshAuto = resolveCourseDeepLink({
  requested: 'cafe',
  currentMaterialId: NPS_COURSE_ID,
  hasRestoredSession: false,
  freshAwaitingInput: true,
});
assert.equal(freshAuto.kind, 'auto-start');

assert.equal(stripCourseQueryParam('/studio/?course=cafe&follow=1'), '/studio/?follow=1');

const followCards = DEMO_LESSON_CARDS.filter(c => c.kind === 'follow');
assert.ok(followCards.length >= 1);
assert.ok(followCards.every(c => c.href.includes('follow=1')));
assert.ok(DEMO_LESSON_CARDS.some(c => c.href.includes('course=cafe')));
assert.ok(DEMO_LESSON_CARDS.length >= 7);

console.log(JSON.stringify({
  ok: true,
  courseDeepLinkPrompt: true,
  followCatalog: true,
  followHref: followCards[0].href,
  cafeHref: DEMO_LESSON_CARDS.find(c => c.kind === 'cafe')?.href,
  phoneAudioVerified: false,
  storyCafePackage: 'assets-missing-candidate-only',
  note: 'Harness proves deep-link policy + Follow catalog. No phone audio claim. /story/cafe/ still needs author package bytes.',
}, null, 2));
