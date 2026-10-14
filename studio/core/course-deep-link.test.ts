import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAFE_COURSE_ID,
  NPS_COURSE_ID,
  parseCourseQueryParam,
  parseFollowQueryParam,
  resolveCourseDeepLink,
  stripCourseQueryParam,
  courseKindForMaterialId,
} from './course-deep-link.ts';

test('parseCourseQueryParam accepts only cafe|nps', () => {
  assert.equal(parseCourseQueryParam('cafe'), 'cafe');
  assert.equal(parseCourseQueryParam('nps'), 'nps');
  assert.equal(parseCourseQueryParam('Cafe'), null);
  assert.equal(parseCourseQueryParam(null), null);
  assert.equal(parseCourseQueryParam(''), null);
});

test('parseFollowQueryParam is strict', () => {
  assert.equal(parseFollowQueryParam('1'), true);
  assert.equal(parseFollowQueryParam('true'), true);
  assert.equal(parseFollowQueryParam('0'), false);
  assert.equal(parseFollowQueryParam(null), false);
});

test('courseKindForMaterialId maps known courses', () => {
  assert.equal(courseKindForMaterialId(NPS_COURSE_ID), 'nps');
  assert.equal(courseKindForMaterialId(CAFE_COURSE_ID), 'cafe');
  assert.equal(courseKindForMaterialId('local-video'), 'other');
});

test('fresh cafe link auto-starts only without restored session', () => {
  assert.deepEqual(
    resolveCourseDeepLink({
      requested: 'cafe',
      currentMaterialId: NPS_COURSE_ID,
      hasRestoredSession: false,
      freshAwaitingInput: true,
    }),
    { kind: 'auto-start', course: 'cafe' },
  );
});

test('restored NPS with cafe deep link prompts explicit switch', () => {
  assert.deepEqual(
    resolveCourseDeepLink({
      requested: 'cafe',
      currentMaterialId: NPS_COURSE_ID,
      hasRestoredSession: true,
      freshAwaitingInput: false,
    }),
    { kind: 'prompt-switch', course: 'cafe', current: 'nps' },
  );
});

test('restored cafe with nps deep link prompts switch back', () => {
  assert.deepEqual(
    resolveCourseDeepLink({
      requested: 'nps',
      currentMaterialId: CAFE_COURSE_ID,
      hasRestoredSession: true,
      freshAwaitingInput: false,
    }),
    { kind: 'prompt-switch', course: 'nps', current: 'cafe' },
  );
});

test('matched course does not prompt', () => {
  assert.deepEqual(
    resolveCourseDeepLink({
      requested: 'cafe',
      currentMaterialId: CAFE_COURSE_ID,
      hasRestoredSession: true,
      freshAwaitingInput: false,
    }),
    { kind: 'matched', course: 'cafe' },
  );
});

test('stripCourseQueryParam keeps other params', () => {
  assert.equal(stripCourseQueryParam('/studio/?course=cafe&dictation=1'), '/studio/?dictation=1');
  assert.equal(stripCourseQueryParam('/studio/?course=cafe'), '/studio/');
});
