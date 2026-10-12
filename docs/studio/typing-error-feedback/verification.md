# Source verification · 2026-10-11

Scope: typing-error feedback only, based on release repository `18ac500220750949349a29d441ed5c428ee006c7`. No build, deployment, public change or browser use.

## Final program checks

- `LINGOTRACE_FROZEN_V65_DIR=/tmp/lingotrace-frozen-v65-audit node --import tsx --test --test-concurrency=2 studio/core/*.test.ts studio/scene/*.test.ts`: 1,913 passed, zero failures/skips. Includes actual handler extraction and old-writer compatibility.
- `node --experimental-strip-types --test --test-concurrency=2 studio/media/*.test.mjs`: 853 passed, zero failures, one pre-existing optional actual-MediaRecorder fixture skip (854 total).
- HUD library: 93 passed, zero failures/skips. The same invocation also passed seven new cue/renderer tests (100 total).
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passed.
- `git diff --check`: passed for the source/document patch.

Focused new coverage includes 15 audio-bus tests, 10 feedback-controller tests, five actual preference/settings-hook tests, six actual Studio native-handler tests and seven cue/renderer tests. It checks no mount autoplay, independent persisted off choice, unavailable storage, trusted activation, canceled/stale resume behavior inherited from the audio manager, no queued replay, typing/Check priority, hidden dictation, composition final-tail dedupe, pasted/deleted/synthetic input, unchanged attempts/score, hardware-vibration absence/refusal/error, recording/mute/reduced-motion isolation, wrong-letter-only motion and stable native geometry.

Independent read-only review found and prompted one recovery correction: audio activation failure must survive later hidden/pagehide events. A typing-only sticky snapshot-error latch now preserves that distinction until a trusted explicit settings retry; stale/canceled enable promises do not set it. Error → hidden/pagehide/interrupted → next trusted gesture and false-trusted retry regression tests pass. Independent re-review reported no remaining blocking findings.

An earlier concurrent full-suite run ended the transparent-renderer test process without an assertion diagnosis. That file subsequently passed all 23 tests in isolation, and the final complete lower-concurrency suite above passed. This is retained as execution evidence, not an explanation of earlier browser crashes or a claim of long-duration stability.

## Required later integration gates

The source is not yet browser-accepted or published. Verify the combined follow-playback/enlarged-input/error-feedback build, real gesture activation, visible/hidden inputs, actual error sound capture, focus/resize and recording boundaries in the integration environment. Physical speaker audibility, device vibration, genuine platform IME/mobile keyboard, microphone acoustic pickup and actual encoded recorder output are unverified here. An unsupported vibrate API must not block the rest of the app or be reported as a tested phone vibration.

Shared-file merge notes: preserve both workers' trusted input/composition hooks in Studio, with exactly the original single engine input/IME commit; keep follow-playback observation independent. In input-card, this patch only imports the short shake projection, adds optional transient state fields, and offsets wrong rendered runs without changing geometry/font/layout. Retain enlarged-input changes independently. SceneVisual adds only optional `typingErrorAt`.

## Reduced-motion independence follow-up

A narrow follow-up to `a547d412a1f6d19908b8d108ce890bc913f23745` decouples the new error sound from reduced motion. Reduced motion and the motion preference cancel only visual/device effects; they neither disable/cancel an enabled error sound nor prevent trusted gesture activation. The sound checkbox remains usable, and sound off/failure/ready/recovery status stays visible beside a separate motion-only explanation. Existing F03 behavior, all-monitor mute, explicit off, sticky failure state and recording bus isolation are unchanged.

Final focused verification: 66 audio/controller/settings/F03 tests passed, 18 actual host/renderer/F03 integration tests passed, and nonincremental TypeScript and diff checks passed. Independent parent review inspected the production/controller/settings/copy diff and separately ran all 19 feedback/settings tests successfully, with no blocking finding. The earlier aggregate counts describe the preceding full base run; this narrow patch is not represented as a new full-suite/build/browser run. No publication or physical-device verification was performed.
