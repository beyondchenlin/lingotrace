# Typing error feedback: implementation and acceptance

Companion: [total PRD](PRD-total.md). This supplement does not rewrite the verified v81 release PRDs.

## 1. Event boundary

`hasNewTypingError` is a pure projection over before/after committed native values. It admits only trusted `insertText` or the single explicit `compositionend`, rejects composing/pasted events, and requires the already-presented reference. Common unchanged prefix/suffix locate the changed native span. A wrong range from the existing normalized, grapheme-aware live-letter projection must intersect that inserted span. Deletion-only/unchanged edits and unchanged old mistakes cannot fire. Raw length guards match the existing presentation limit before comparison.

Studio captures the engine draft immediately before its existing input/endComposition call, then observes the committed engine draft afterward. It does not introduce engine events, alter native text, submit, change attempts or scores, or derive a cue from a render frame. Existing IME final-tail consumption remains before this observation. Replacing an incorrect character with a different incorrect character is a new eligible edit; re-delivering the same value is not.

The host additionally requires live course media, ready state, a current engine, no fixture/replay/modal/layout/restore failure/background/pause/strict-listen state, explicit reference visibility, and equality with the currently painted reference. This intentionally fails quiet when the visible-reference presentation has not yet caught up. The Check path executes only after a new real attempt is returned from `engine.submit()`; duplicates, empty attempts and passive restoration do not reach it.

## 2. Independent preference and audio ownership

`lingotrace-typing-error-feedback-v1` stores only `{sound,motion}` booleans. It stores no answer, reference, error position, health data or training history. Read failure/corrupt explicit data is quiet; write failure is reported. New choices default on in accordance with the user's direct request. They neither read nor overwrite F03 or monitor choices.

The React hook creates a dedicated controller/audio object but no AudioContext on mount. `prepare` is synchronous in a trusted, eligible user event and requests `enable()` without any subsequent play callback. The audio graph only plays from the live pulse path. Activation failure/rejection requires an explicit settings off/on retry, not repeated automatic retries per keystroke. Only background/pagehide/system interruption may recover on the next trusted foreground input-area gesture. SubmissionAudio generation ownership invalidates old pending resumes; recovery never attaches a play callback or replays the old error. Cleanup unsubscribes, cancels device motion and disconnects/disposes the graph.

`SubmissionAudio.playInputError()` adds a 90 ms synthesized tone using an independent gain into the existing monitor node. It never connects to `master`, `RecordingTarget` or a recording bridge. Volume and all-monitor mute apply; mute/zero volume discard the transient tail. The audio-level 320 ms limiter is separate from the 360 ms feedback limiter. It does not consume submission IDs or the submission limiter. Active/recent F03 has priority; real submission cancels immediate sound and gets a 500 ms feedback priority window. The original exact submission-ID dedupe bound and completion selection remain intact.

A successful erroneous Check triggers one motion pulse even in hidden dictation. If F03 is enabled, no new error sound is played; otherwise the dedicated error graph can supply it. Correct and first-completion results never trigger an error pulse. The F03 recording tap therefore continues to contain only explicitly selected original submitted cues, never live typing error cues.

## 3. Visual, hardware and lifecycle

A transient `typingErrorAt` presentation field drives a damped two-cycle 180 ms offset in only the already-wrong Canvas letter runs. Peak displacement is bounded at 2 CSS pixels and clipped by the existing input rectangle. Ghost reference, correct letters, native textarea geometry, caret/selection, media picture, focus and hit targets remain unchanged. No new large button or global layout change is introduced.

Reduced motion, recording and an expired/invalid timestamp produce exactly zero offset. Reduced motion does not disable, cancel or block the separately enabled error sound, including an eligible checked-error fallback. Motion preference/reduced-motion transitions cancel only visual and device effects; general lifecycle cancellation still stops both. The legacy F03 reduced-motion policy is unchanged. Recording preparation/recording/stopping also suppress device vibration in the controller. Optional feature-detected `navigator.vibrate(18)` is never treated as proof of hardware output; a false result or exception does not prevent visible or audio feedback. A tracked pending haptic request is canceled with zero on the same relevant lifecycle boundaries. Monitor mute suppresses hardware vibration while retaining existing static red/wavy feedback and optional visual shake.

Both concise controls live in the existing settings panel with English/Simplified Chinese labels and explanatory text. Existing aria-invalid, descriptive Check/review output and non-color waves remain authoritative; live errors do not spam a screen-reader live region. The reduced-motion status and read/write/activation limitations are stated rather than replaced by misleading success.

## 4. Verification matrix

- Pure projection: progressive correct/wrong input, repeated wrong positions, middle insert/delete, repeated text, native unchanged tails, Unicode normalization, oversized input, paste/undo/drop/autocorrect, unknown/synthetic and composition events.
- Actual host: trusted input vs synthetic events; hidden/background/read-only/media guards; IME start/candidate/final/tail; interrupted composition; unchanged attempt count, score and event count; RAF/restore paths have no pulse.
- Audio: independent limiter, no unlock/play on mount, no queued replay, F03 priority, mute/zero volume, pending/failed resume, cancel/disable/background/pagehide/disposal, recording route isolation and allocation cleanup.
- Preferences/controller: new default vs explicit off/corrupt state, mute/reduced/recording transitions, supported/refused/throwing/absent vibration, Check fallback and successful-completion suppression.
- Renderer: bounded short offset, unchanged native geometry, static reduced-motion and recording output, wrong runs only.
- Regression: core/scene, media, HUD and nonincremental TypeScript. Build and browser/device/encoded-output verification remain separate integration gates, not implied by program tests.


## Subsequent scoped verification record — 2026-10-11

The candidate-stage statements above are preserved as historical handoff context; this later record updates only status and evidence, without changing requirements. The integrated runtime source is `90b7c3fa3a1ab5dfd39e29becb5af3434462f93d`. Source review, 2,029 core/scene tests (zero skips), 897 media tests (one pre-existing optional recording-fixture skip), TypeScript and the production build passed. The independent final source review passed 97 focused checks.

Actual dot-cloud Chromium accepted the scoped native UI repairs: the original 156-character narrow draft, caret/selection/scrolling, a new committed Café save followed by normal reload, Below keyboard-only placement, the thin footer, and the requested HUD background top/left edges. Unchanged error-preference, reduced-motion and locale independence checks come from the earlier exact 4d6 browser run; they were not all repeated in R2. This is a bounded UI gate, not whole-PRD or user visual acceptance. See `../main-ui-v82-release-verification.md`.

Media remains outside this acceptance: Café still displayed a native playback error in the HTTP preview, and NPS was blocked by its HTTPS qualification rule. Historical Chromium error9 incidents remain unexplained. Physical-phone/OS IME, vibration, audible effects, speech synchrony, camera hardware and actual recorded output were not verified. No new typing Follow runtime is included in this main-site release; the separate public QA Follow candidate remains independently gated. Publication and the final release commit are established only by the saved-version/deployment receipt, followed by the separate production HTTPS smoke.
