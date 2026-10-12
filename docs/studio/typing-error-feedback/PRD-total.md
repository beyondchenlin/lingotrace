# Typing error feedback: bounded supplement

Date: 2026-10-11. Base: published v81 source recorded as `55bf7b7d05efca200127151dd8b9aa3bd5499c97`, deployment repository `18ac500220750949349a29d441ed5c428ee006c7`.

## Requested outcome

The user expressly requested vibration and an error sound when English input is wrong. Add a short, quiet error cue and restrained wrong-letter shake within the existing v81 input presentation. Keep the existing layout, native editing, feedback colors and actual Check/F03 contract.

## User behavior and preferences

- New typing-error sound and motion choices default on, independently of the pre-existing submission-sound setting. Their new device-local preference preserves explicit off choices. Missing data uses the new default; corrupt or inaccessible data fails quiet. A failed write affects persistence only and is stated in settings.
- The old F03 submission preference has no stored value and remains default off. Neither its enable state nor recording selections are changed by the new default. Current all-monitor mute keeps priority for sound; reduced motion suppresses only the new visual/device motion.
- Sound unlock happens only in a trusted input-area pointer/key/native-input/composition gesture or a trusted Check pointer/key gesture. Loading, rendering and restoring do not resume audio or play a cue. Unlock is not proof of an audible device; a mistake before resume finishes is dropped rather than replayed later.
- With the already-approved reference visible, only a newly committed, trusted insertion containing a wrong native span may cue. The existing letter comparison remains the authority. Existing wrong text, moves, selection, deletion/correction, paste, undo/redo, automatic replacement and IME candidate text do not cue. Final IME commit is eligible once, subject to the existing same-task tail guard.
- Hidden dictation never obtains immediate correctness cues. Only a successful explicit Check with actual errors can cue. F03 first-completion/correct/correction selection remains unchanged; enabled F03 handles the Check sound, and the new error sound is only the correction fallback when F03 is off.
- Two small wrong-letter oscillations last 180 ms and stay within 2 CSS pixels. Native caret, selection, hit targets and line layout do not move. Supported devices may also request an 18 ms vibration; absence, rejection or failure is not a global blocker.
- One immediate feedback pulse per 360 ms; excess pulses are discarded. No repeat queue, timers that replay errors, persistent mistake log or scoring change.

## Isolation and stopping rules

The new sound uses the tested SubmissionAudio implementation in a dedicated local instance. Its transient bus connects to speaker monitoring, never the recording master/tap. Recording choices remain default off and unchanged. White noise is not connected. A selected physical microphone can still capture ambient speaker sound.

Recording/preparation disables transient motion and device vibration. Reduced motion disables only the new visual/device motion; the independent error-sound setting remains effective, with trusted activation and mute rules unchanged. Hide, input correction, pause, modal opening, cue/session transition, blur and background cancel active transient effects. Background/pagehide/system audio interruption disables the graph. The next trusted foreground input-area gesture may resume it, without replaying a previous error; activation rejection/failure requires an explicit settings retry. Cancellation does not erase the saved off/on preference.

## Completion and limits

Delivery is source, paired PRDs, tests and independent review only. No publication, production build, CUA, actual speaker audition, real IME, physical phone, vibration hardware or encoded recording check was performed in this scoped work. Integration with the parallel follow-playback and enlarged-input changes requires combined regression and browser gates. No claim that the full future F03 roadmap is implemented.


## Subsequent scoped verification record — 2026-10-11

The candidate-stage statements above are preserved as historical handoff context; this later record updates only status and evidence, without changing requirements. The integrated runtime source is `90b7c3fa3a1ab5dfd39e29becb5af3434462f93d`. Source review, 2,029 core/scene tests (zero skips), 897 media tests (one pre-existing optional recording-fixture skip), TypeScript and the production build passed. The independent final source review passed 97 focused checks.

Actual dot-cloud Chromium accepted the scoped native UI repairs: the original 156-character narrow draft, caret/selection/scrolling, a new committed Café save followed by normal reload, Below keyboard-only placement, the thin footer, and the requested HUD background top/left edges. Unchanged error-preference, reduced-motion and locale independence checks come from the earlier exact 4d6 browser run; they were not all repeated in R2. This is a bounded UI gate, not whole-PRD or user visual acceptance. See `../main-ui-v82-release-verification.md`.

Media remains outside this acceptance: Café still displayed a native playback error in the HTTP preview, and NPS was blocked by its HTTPS qualification rule. Historical Chromium error9 incidents remain unexplained. Physical-phone/OS IME, vibration, audible effects, speech synchrony, camera hardware and actual recorded output were not verified. No new typing Follow runtime is included in this main-site release; the separate public QA Follow candidate remains independently gated. Publication and the final release commit are established only by the saved-version/deployment receipt, followed by the separate production HTTPS smoke.
