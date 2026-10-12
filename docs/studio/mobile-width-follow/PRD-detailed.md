# Mobile width and sentence Follow: implementation and verification contract

Date: 2026-10-11. Companion to `PRD-total.md`; additive to all v84 and earlier documents. Published baseline is `8c5a465ad70734c440c9dea70e05b8e3f75956c5`. Public assets, source hashes, subtitle times, assembler, dependency versions, and lockfile are not changed by this increment.

## 1. Proven source gaps

- Portrait surface fitting used total expanded scene height as a scale constraint. Adding input/keyboard height could shrink the complete stage and leave side margins. The viewport CSS variable also inherited that fit. Red geometry tests reproduce a 320px available width becoming 300px; the candidate locks portrait width to available CSS width while preserving independent `containLearningMedia` limits.
- v84's native committed input had no active Follow media controller. The earlier isolated QA modules are selectively integrated rather than replacing the published Studio and its native-input/renderer fixes.
- Built-in corrected Play awaited an async wrapper around synchronous registry identity validation before native `play()`. This unnecessarily crossed a microtask boundary. The candidate uses the identical synchronous built-in predicate, with exact current source URL, media lease/SHA identity, duration, session, cue, token, and visibility checks preserved. Local saved-reference validation remains asynchronous. Actual-handler red/green tests verify built-in native play and existing audio resume are invoked in the explicit call stack. This identifies a gesture risk, not a proven diagnosis of the user's phone audio failure.

## 2. Geometry and native editing

`fitLearningSurface` uses portrait available width independently of scene height. Existing landscape policy and independent video containment remain. The portrait CSS width is 100% of the available stage container. The logical renderer, native input, DOM controls, and recording retain their shared geometry.

`portraitInputViewportPlan` uses the actual DOM Range caret line and measured line height. It selects a whole-line page of at most three rows and reserves blank final slots so scroll clamping cannot clip the caret between rows. `syncInputViewport` keeps full textarea value, full reference projection, and native line breaks. It sets programmatic vertical page offset and zero horizontal offset; the portrait viewport hides manual scrollbars. The canvas projection clips to the same complete native row slots. DOM fractional height close to integer `clientHeight` is preserved, avoiding a three-row window becoming two solely due to rounding. Desktop scroll behavior is unchanged.

The window is not a new target, tokenizer, attempt, or timing source. It never clamps text content, truncates characters, or synthesizes phrase submissions. Partial words, emoji/ZWJ, combining marks, newlines, long tokens, caret direction, selection, backspace, font-size changes, and reflow use the existing native editing facts. The v84 mirror integrity checks and `translate=no` learning-surface protection remain.

`inputHeaderControls` partitions the existing helper row into disjoint reference and Follow touch targets, outside input rows. Compact localized reference text avoids colliding with the control. `learningFocusScroll` includes Follow and ordinary Play if all controls fit, otherwise preserves input and Check/Next first. It scrolls the page, not a scaled-down stage.

## 3. Follow ownership and policy

Studio validates the current session; the controller consumes a scope containing material/reference/cue/source/owner identity. Host identity comparison uses declared fields, independent of JSON property order. Entry requires a valid registered NPS source and finite ready media, supported authenticated beforeinput, exposed reference, active editable practice, and no conflicting recording/listening/replay/modal/renderer failure. Blocked entry does not steal focus or stop an existing ordinary media owner.

Start takes ownership and performs one cue-start seek. Rate begins at 0.8×, uses eligible appended graphemes over the measured input window, stays between 0.5× and 1.5×, and slews at no more than 0.25 per second. Paste, synthetic mutation, preedit, deletion/replacement, and invalid provenance cannot fabricate positive typing speed. Correctness is not an estimator input.

After 1500ms without committed input, state remains `following` with `idle-coasting`; rate approaches 0.5× and playback continues until the registered subtitle cue end. New eligible input resumes estimation without another play/seek. Native time updates are handled by Follow before the older ordinary cue-end rewind branch. At cue end the host pauses, releases ownership, and reports ended; later typing cannot restart it. The user retains existing Check and Next decisions.

Composition wait, explicit cancellation, unsafe state transitions, stale requests, and source replacement are bounded by the existing owner fences. Legitimate same-source buffering requires observed `waiting`/`stalled` under an admitted command; later `playing` does not grant a fresh external play request. Initial seek and native readiness transitions must remain within the original admitted command and original deadline, never broaden general entry or reset the timeout. Error, hidden/background, recording, source/owner drift, and manual external seek remain invalid.

Audio-route resume and native `play()` are started in the same gesture. A wrapped route promise and native promise are both observed; only the current owner can report success or perform cleanup. Route rejection stops its own Follow playback without deleting the draft; late rejection cannot pause a newer ordinary owner. No new audio source or generated voice is introduced.

## 4. Evidence and validation

- Width red/green and size matrix: 320–640 CSS px, 220–1200 available height, keyboard shown/hidden, half/native/fit video; media aspect ratio and input width preserved.
- Native-window program tests: whole rows, forward/backward selection, backspace/page reversal, final-page blank slots, fractional height, font sizing, Unicode/empty/newline/long-token behavior, Hidden invariance, unchanged full training truth, and matching canvas clipping. These deterministic DOM Range fixtures are not Android screenshots.
- Follow policy/host tests: estimated rate and idle coasting, no word seek, bounded commands, admission/source identity, buffered recovery, same-owner lifecycle, cancellation, composition, and stale promise ownership.
- Actual Studio handler tests: discoverable localized control, trusted Start, history/export neutrality, ordinary Play compatibility, Hidden privacy, recording interruption, IME commit deduplication, source guard reuse, synchronous gesture calls, deferred success, and route rejection/new-owner cleanup.
- Retained full suites, non-incremental typecheck, independent review, final source identity, and resource-safe build/browser verification remain release gates. Test logs distinguish fixture/materialization issues from source regressions; original failure logs are retained.

## 5. Release reporting and rollback

This is a candidate until an exact-source build and approved same-site publication succeed. Retain v84 and earlier release trees and rollback identities. Do not silently substitute old bundles or fresh media paths. Browser checks should cover full-width portrait, native keyboard focus, long reference/draft pages, real video motion and audibility on explicit Start, typing-rate readback, idle sentence stop, cancellation, and Hidden safety. A cloud error 9 or lack of build space is a verified blocker to that stage, not evidence of Android correctness. No claim of exact phonetic synchronization is authorized by sentence-level subtitle timing.
