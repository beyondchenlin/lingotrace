import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFollowRecoverReason,
  followStatusNeedsVisibleSurface,
  resolveFollowDeepLinkSurface,
} from './follow-recover.ts';

test('classifyFollowRecoverReason maps play and media failures', () => {
  assert.equal(classifyFollowRecoverReason('play-rejected'), 'play-failed');
  assert.equal(classifyFollowRecoverReason('play-timeout'), 'play-failed');
  assert.equal(classifyFollowRecoverReason('media-error'), 'media-error');
  assert.equal(classifyFollowRecoverReason('rate-not-applied'), 'rate-failed');
  assert.equal(classifyFollowRecoverReason('manual-pause'), 'none');
  assert.equal(classifyFollowRecoverReason(null), 'none');
});

test('resolveFollowDeepLinkSurface prefers recover over tip', () => {
  assert.deepEqual(
    resolveFollowDeepLinkSurface({
      followDeepLink: true,
      tipDismissed: false,
      active: false,
      reason: 'play-rejected',
    }),
    { showTip: false, showRecover: true, recoverKind: 'play-failed' },
  );
  assert.deepEqual(
    resolveFollowDeepLinkSurface({
      followDeepLink: true,
      tipDismissed: false,
      active: false,
      reason: null,
    }),
    { showTip: true, showRecover: false, recoverKind: 'none' },
  );
  assert.deepEqual(
    resolveFollowDeepLinkSurface({
      followDeepLink: true,
      tipDismissed: true,
      active: false,
      reason: null,
    }),
    { showTip: false, showRecover: false, recoverKind: 'none' },
  );
  assert.deepEqual(
    resolveFollowDeepLinkSurface({
      followDeepLink: true,
      tipDismissed: false,
      active: true,
      reason: null,
    }),
    { showTip: false, showRecover: false, recoverKind: 'none' },
  );
});

test('followStatusNeedsVisibleSurface for deep-link unavailable and recover', () => {
  assert.equal(
    followStatusNeedsVisibleSurface({
      recoverKind: 'play-failed',
      followDeepLink: false,
      unavailable: false,
      phase: 'off',
      active: false,
    }),
    true,
  );
  assert.equal(
    followStatusNeedsVisibleSurface({
      recoverKind: 'none',
      followDeepLink: true,
      unavailable: true,
      phase: 'off',
      active: false,
    }),
    true,
  );
  assert.equal(
    followStatusNeedsVisibleSurface({
      recoverKind: 'none',
      followDeepLink: false,
      unavailable: false,
      phase: 'following',
      active: true,
    }),
    false,
  );
});
