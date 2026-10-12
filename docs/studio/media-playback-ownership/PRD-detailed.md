# Media playback ownership correction · Detailed PRD

## Evidence
- Baseline: v80 release commit 1b46f53195f7a1c86637d72555a972fe1d4a78dd.
- Reported image: NPS Connie Lau, sentence 3, displayed time 00:06 / 00:43 while paused. This is consistent with its stored 6.02–8.21 second interval; the screenshot alone cannot prove A/V drift.
- ffprobe of the immutable current playback MP4: H.264 30 fps, start 0, duration 43.366667 seconds; AAC stereo 48 kHz, start 0, duration 43.337333 seconds. The original and registered lossless representation contain both audio and video. No independent TTS playback path was found.
- NPS official captions contain 21 intervals, including an empty opening interval; 20 contain text. The fixed map merges them into 11 sentences by punctuation. Its provenance explicitly does not claim independent acoustic alignment.
- The displayed Canvas samples the same active HTMLVideoElement that produces native audio. Nevertheless, old pending legacy playback could restart another element after ownership changed.

## Implementation boundary
1. Timeline marker dragging resolves duration and seek from the active ListeningPlayer when present; fallback remains the legacy lesson. Scoring selection deliberately does not change on free seek.
2. Listening navigation derives the presentation index from actual native position, including hidden-reference mode without reading or exposing answer text. Typing continues to use its selected grading cue. DOM and Canvas share that presentation index; the persisted Training snapshot is never rewritten for playback navigation.
3. beforeListen invalidates the old corrected-play request/owner. Legacy onPlay refuses active listening; onPause ignores obsolete legacy notifications.
4. finish cancels the start generation and awaits the pending start before finalizing. start waits for an existing finish. Existing admitted scope persistence can settle without an orphan native player.
5. ListeningPlayer separates desired playback intent from request generation. Pause/end-of-cue clear the intent; explicit play establishes it. Old Promise results obey latest intent. A queued pause event only clears intent when the native element is actually paused; canceled playing events are stopped immediately.

## Regression coverage
- Real Studio callback extraction: pending verified legacy play after listening takeover; late native play; queued legacy pause.
- Actual hook: immediate start/finish cancellation; delayed persistence admission plus a later explicit start.
- Actual ListeningPlayer: old fulfillment after successful newer play; latest explicit pause; stale rejection; queued old pause while resumed.
- Actual timeline handlers: active listen/type dragging reaches the active element; repeated next/previous advances from the live position; hidden reference remains hidden; grading snapshot unchanged.
- Canvas: the listening counter uses the active transport index and typing ignores that presentation override.

## Historical branch verification ledger
- Focused changed-path suite: 84 passing before final full-suite run.
- TypeScript: passed.
- Core/scene aggregate: 1882 tests, 1878 passed and four frozen-v65 compatibility cases skipped because that initial run omitted its fixture environment variable. Separate rerun of builtin-repository.test.ts with LINGOTRACE_FROZEN_V65_DIR=/tmp/lingotrace-frozen-v65-audit passed all 18 cases, including those four; therefore all 1882 aggregate cases have passing evidence.
- Media aggregate: 824 tests, 823 passed, one existing actual MediaRecorder fixture skipped.
- Independent read-only review: four race reproductions pass against the patched source; no definite regression found within that scope.
- Final integration and production build are completed at exact 55bf7b7 as recorded below; this historical branch ledger did not itself publish.
- Public cloud browser: loading NPS failed at response body read with [fetch; BODY], including one normal retry. Existing isolated preview also displayed media unavailable. This is not established as the cause of the user's experience.
- No claim of actual audible/browser lip-sync, acoustic sentence-boundary quality, camera/microphone/OS recording, mobile hardware behavior, or resolved user-specific A/V drift.


## Final integrated verification status · 2026-10-11

Exact integrated source `55bf7b7d05efca200127151dd8b9aa3bd5499c97` passed independent source review, 1,900 core/scene checks (zero skips), 823 media checks (one pre-existing optional real MediaRecorder fixture skip), 93 HUD checks (zero skips), TypeScript and the production static-export build. The final capacity/navigation corrections were independently checked with 72 and 19 focused tests; 1,000 deterministic normal-size Unicode comparisons retained the prior feedback ranges. These are software evidence, not proof of browser crash resolution.

The broader a489 functional browser matrix passed live green/red native-letter feedback, middle edits and Tab/newline paste, neutral hidden mode, explicit checked precedence and stale-check removal, no live formal attempts, café listening/navigation, language persistence and responsive layout. After the final 55bf replacement, the exact 388-file manifest and actual requested replacement runtime were verified. Saved Chinese preference and draft recovered. Native correct/incorrect-letter edits recomputed colors; Hide removed reference/answer-derived colors and accessibility validity hints. Listen Next/Previous moved to 6/0 seconds. Continue → Let me type preserved the draft and left playback paused. The final roughly two-minute interaction window showed no additional error 9; it is a focused delta gate, not a complete repeat of the earlier matrix or stress test.

Earlier a489 and old QA pages displayed Chromium error 9 with unresolved cause. Reload recovered saved data; the earlier single-QA-page recovery remained usable for about four minutes. The performance bounds address demonstrated work/allocation paths and do not explain or establish a fix for that crash. Original listening-history snapshot costs still grow with accumulated spans; long-duration stability remains unverified. NPS response-body loading remains limited. Actual audible native-track quality/lip synchronization, genuine device IME/mobile OS, camera/microphone and recorded output were not verified. The user's unspecified original sound/picture symptom is not claimed resolved. Input-following adaptive speed is excluded.

This completes the bounded functional cloud-browser release gate with disclosed limitations, not full-PRD or user visual acceptance. Publication identity and subsequent actual public smoke are recorded separately after those operations. Requirements and earlier released PRDs remain unchanged.

See [integrated release verification](../centered-english-hud/release-verification-v81.md).
