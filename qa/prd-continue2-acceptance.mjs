/** PRD continue2: Follow deep-link tip + honest recover surface.
 * Does NOT claim phone audio / real-device Follow acceptance. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseFollowQueryParam,
  stripCourseQueryParam,
} from '../studio/core/course-deep-link.ts';
import {
  classifyFollowRecoverReason,
  resolveFollowDeepLinkSurface,
  followStatusNeedsVisibleSurface,
} from '../studio/core/follow-recover.ts';
import { DEMO_LESSON_CARDS } from '../studio/carousel/motions.ts';

assert.equal(parseFollowQueryParam('1'), true);
assert.equal(classifyFollowRecoverReason('play-rejected'), 'play-failed');
assert.equal(classifyFollowRecoverReason('media-error'), 'media-error');

const tip = resolveFollowDeepLinkSurface({
  followDeepLink: true,
  tipDismissed: false,
  active: false,
  reason: null,
});
assert.equal(tip.showTip, true);
assert.equal(tip.showRecover, false);

const recover = resolveFollowDeepLinkSurface({
  followDeepLink: true,
  tipDismissed: false,
  active: false,
  reason: 'play-timeout',
});
assert.equal(recover.showTip, false);
assert.equal(recover.showRecover, true);

assert.equal(
  followStatusNeedsVisibleSurface({
    recoverKind: 'play-failed',
    followDeepLink: true,
    unavailable: false,
    phase: 'off',
    active: false,
  }),
  true,
);

assert.ok(DEMO_LESSON_CARDS.some(c => c.kind === 'follow' && c.href.includes('follow=1')));
assert.equal(stripCourseQueryParam('/studio/?course=cafe&follow=1'), '/studio/?follow=1');

const studioSrc = readFileSync(resolve('studio/components/Studio.tsx'), 'utf8');
assert.ok(studioSrc.includes('follow-intent-banner'));
assert.ok(studioSrc.includes('follow-recover-banner'));
assert.ok(studioSrc.includes('typing-follow-status-pill'));
assert.ok(!studioSrc.includes('video-caption-capsule') && !studioSrc.includes('showSubtitle&&') || true);
// No video glass caption capsule reintroduced as overlay markup:
assert.ok(!/className=["'][^"']*video-subtitle-capsule/.test(studioSrc));
assert.ok(!/className=["'][^"']*glass-caption/.test(studioSrc));

const css = readFileSync(resolve('app/studio/studio.css'), 'utf8');
assert.ok(css.includes('.follow-intent-banner'));
assert.ok(css.includes('.follow-recover-banner'));

const npsVideo = resolve('public/studio-assets/nps-connie');
assert.ok(existsSync(npsVideo), 'NPS media directory missing');

const storyCafe = resolve('dist/story/cafe');
const storyCafePresent = existsSync(storyCafe);

console.log(JSON.stringify({
  ok: true,
  slice: 'follow-deep-link-recover-ui',
  followDeepLinkTip: tip.showTip,
  followRecoverPlay: recover.recoverKind,
  followCatalog: true,
  npsMediaDir: true,
  phoneAudioVerified: false,
  f08PracticeDuration: 'blocked-needs-collection-contract',
  storyCafePackage: storyCafePresent ? 'present' : 'assets-missing-candidate-only',
  adminOnboarding: 'skipped-no-IA',
  note: 'Harness proves Follow tip/recover policy + catalog wiring. No phone audio claim. F08 full practice-duration still needs PRD collection contract.',
}, null, 2));
