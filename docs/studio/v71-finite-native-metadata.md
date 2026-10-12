# v71 bounded finite-metadata readiness

## Observed failure and actual causal boundary

The user's latest Android screenshot displays the plain range failure with NPS cue01 and media time unavailable. It does not show the loaded chunk, actual duration or transport. This is not proof the native AAC problem is resolved.

On frozen v70, actual host probes confirm default loading verifies the selected cue: first cue is 0.770–1.530 seconds. Its generic range failure covers NaN, Infinity, zero/negative duration and real cue overflow. A finite 43.36-second duration produces a different fixed-source identity error, so final-cue rounding does not explain the screenshot by itself. The implementation unconditionally resolved `loadedmetadata` and immediately rejected unknown duration; later `durationchange` could not recover because the source was already released. Both private verification and the main element had this premature-readiness failure. Isolated program sequences reproduce it; the phone's actual measured duration remains unknown.

The HTML media specification defines unknown/unbounded durations and later durationchange updates: https://html.spec.whatwg.org/multipage/media.html#dom-media-duration . The new handling is a bounded compatibility guard, not a claim that all tested synthetic event sequences are produced by this user's browser.

## Minimal repair

Private verification, main fixed-course loading and the existing isolated check page wait while duration is not finite-positive or readyState is below HAVE_METADATA. They observe loadedmetadata, durationchange, loadeddata and canplay without starting playback, seeking to discover duration, or changing reference facts. The original timeout budget is retained; progress events do not refresh it, and the AAC retry consumes the remaining budget. Native error, stale request/source/lease, cancel, hidden, recording and disposal retain fail-closed behavior. Once ready, a later invalid source or duration does not re-enter indefinite pending readiness.

The first finite-positive measurement must still pass all existing strict bounds. No arbitrary timing margin or playback clamp is added. The NPS registered-source comparison remains at most 1 ms, and every cue end must be within the actual finite duration. Coffee and corrected-reference identity rules remain exact. Finite 1.529 / 2 / 43.36 / 43.3659 remain refused for the appropriate range/source check; 43.366 remains valid because the actual final cue ends at exactly 43.366.

A bounded local `range-v71` diagnostic reports actual duration (including NaN/Infinity), cueStart, cueEnd, readyState and actual Blob/direct transport before release. It contains no answer, URL, new upload or external logging. A persistent unavailable duration reports timeout; a finite invalid range remains rejected with its measured facts. Raw exact AAC matching is unchanged and still allows only one fully verified same-origin direct retry.

## Preservation and evidence

The NPS original file, lossless playback bytes, full-SHA URL, material/subtitles, events/attempts/exports, storage permissions and schemas are unchanged. No new source, media transcode, main-stage layout, recording entry, microphone/camera permission or paused bookmark feature is introduced. The prior v70 remains available for rollback.

Red/green tests exercise the actual host plus controller and existing diagnostic page, including unknown-to-finite progress, first finite wrong measurements, shared total deadline, direct handoff across both stages, native errors, stale events, cancellation and post-ready failures. Full checks and independent code review precede same-site release. Cloud native metadata/Blob and direct page checks are separate from synthetic unknown-duration sequences; the affected Android browser remains a user acceptance step.
