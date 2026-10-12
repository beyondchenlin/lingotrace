# Media playback ownership correction · Total PRD

Date: 2026-10-11. Candidate correction to v80; publication is separate.

## Purpose
Keep video, its native audio, timeline navigation, and displayed cue markers under one active media owner. The user reported that sound and picture did not play together. This change repairs reproducible control races without claiming that the original report, hardware sound output, or encoded A/V synchronization has been verified end-to-end.

## Requirements
- Dragging the timeline while continuous listening or listening-backed typing is active controls that same native video, never the paused legacy element.
- Continuous-listening previous/next controls, keyboard navigation, selected markers, and cue counter follow the actual media position. This is presentation-only: training cue, drafts, attempts, scoring and hidden-reference behavior are unchanged.
- Switching into listening invalidates pending legacy play admission. Old play/pause events cannot resume the old sound or clear the new owner's listening state.
- Finishing while listening start is pending cancels that admission and waits for persistence work to settle before any transition. A later explicit start waits for finish.
- Native play promises honor the newest playing/paused intent, including old queued pause events. A stale fulfillment cannot pause a newer authorized playback; a cancellation still stops late playback.
- No audio track, TTS, source video, subtitle timing, F03 recording routing, or default autoplay changes.

## Acceptance
Actual-source regression tests reproduce each old race and pass after the correction. Existing data/privacy/recording tests and typecheck pass. Exact final production build and actual browser A/V verification are separate gates. Failed or untested checks remain disclosed.

## Separate request
Input-following playback is a new optional feature with a separate PRD. Current NPS assets have sentence/caption intervals only, not reliable word timestamps. This correction does not implement or promise word-level playback following.


## Final integrated verification status · 2026-10-11

Exact integrated source `55bf7b7d05efca200127151dd8b9aa3bd5499c97` passed independent source review, 1,900 core/scene checks (zero skips), 823 media checks (one pre-existing optional real MediaRecorder fixture skip), 93 HUD checks (zero skips), TypeScript and the production static-export build. The final capacity/navigation corrections were independently checked with 72 and 19 focused tests; 1,000 deterministic normal-size Unicode comparisons retained the prior feedback ranges. These are software evidence, not proof of browser crash resolution.

The broader a489 functional browser matrix passed live green/red native-letter feedback, middle edits and Tab/newline paste, neutral hidden mode, explicit checked precedence and stale-check removal, no live formal attempts, café listening/navigation, language persistence and responsive layout. After the final 55bf replacement, the exact 388-file manifest and actual requested replacement runtime were verified. Saved Chinese preference and draft recovered. Native correct/incorrect-letter edits recomputed colors; Hide removed reference/answer-derived colors and accessibility validity hints. Listen Next/Previous moved to 6/0 seconds. Continue → Let me type preserved the draft and left playback paused. The final roughly two-minute interaction window showed no additional error 9; it is a focused delta gate, not a complete repeat of the earlier matrix or stress test.

Earlier a489 and old QA pages displayed Chromium error 9 with unresolved cause. Reload recovered saved data; the earlier single-QA-page recovery remained usable for about four minutes. The performance bounds address demonstrated work/allocation paths and do not explain or establish a fix for that crash. Original listening-history snapshot costs still grow with accumulated spans; long-duration stability remains unverified. NPS response-body loading remains limited. Actual audible native-track quality/lip synchronization, genuine device IME/mobile OS, camera/microphone and recorded output were not verified. The user's unspecified original sound/picture symptom is not claimed resolved. Input-following adaptive speed is excluded.

This completes the bounded functional cloud-browser release gate with disclosed limitations, not full-PRD or user visual acceptance. Publication identity and subsequent actual public smoke are recorded separately after those operations. Requirements and earlier released PRDs remain unchanged.

See [integrated release verification](../centered-english-hud/release-verification-v81.md).
