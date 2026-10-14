/** Follow recover presentation — UI-only classification.
 * Does not claim phone audio, acoustic sync, or real-device acceptance.
 * Does not invent Training facts or change Follow policy admission. */

export type FollowRecoverKind = 'none' | 'play-failed' | 'media-error' | 'rate-failed';

export type FollowDeepLinkSurface = {
  readonly showTip: boolean;
  readonly showRecover: boolean;
  readonly recoverKind: FollowRecoverKind;
};

/** Map host/policy interrupt reasons to a recoverable UI kind. */
export function classifyFollowRecoverReason(reason: string | null | undefined): FollowRecoverKind {
  if (!reason) return 'none';
  if (reason === 'media-error') return 'media-error';
  if (reason === 'rate-not-applied') return 'rate-failed';
  if (reason.startsWith('play-')) return 'play-failed';
  return 'none';
}

/** Whether the toolbar should surface a visible (non-sr-only) status chip. */
export function followStatusNeedsVisibleSurface(input: {
  readonly recoverKind: FollowRecoverKind;
  readonly followDeepLink: boolean;
  readonly unavailable: boolean;
  readonly phase: string;
  readonly active: boolean;
}): boolean {
  if (input.recoverKind !== 'none') return true;
  if (input.followDeepLink && input.unavailable && !input.active) return true;
  if (!input.active && (input.phase === 'ended' || input.phase === 'off') && input.followDeepLink) return true;
  return false;
}

/** Deep-link tip + recover banners for ?follow=1 (honest Beta, no autoplay claim). */
export function resolveFollowDeepLinkSurface(input: {
  readonly followDeepLink: boolean;
  readonly tipDismissed: boolean;
  readonly active: boolean;
  readonly reason: string | null | undefined;
}): FollowDeepLinkSurface {
  const recoverKind = classifyFollowRecoverReason(input.reason);
  const showRecover = recoverKind !== 'none' && !input.active;
  const showTip =
    input.followDeepLink &&
    !input.tipDismissed &&
    !input.active &&
    !showRecover;
  return { showTip, showRecover, recoverKind };
}
