# LingoTrace · Total PRD v81

## Purpose
Make the learning HUD accessible in the learner’s chosen interface language, easier to read and act on, and flexible enough to use spare screen space without enlarging the video.

## Functions
- Key-based multilingual interface with English default and an explicit remembered language choice; first phase covers English and Simplified Chinese for Studio/HUD/settings/feedback, while original learning content and stored records stay unchanged.
- A centered, stable current-cue typing block with native editing and aligned pale reference; submitted mistakes are clearly red with non-color descriptions.
- Coherent lightweight Check/Next and Review differences controls and review surfaces.
- Inside video or Below video passive-keyboard placement; mobile and portrait start hidden, with the chosen placement remembered locally.
- Existing adaptive contrast, truthful assisted exposure, strict hidden dictation, scoring, media and recording guarantees remain intact. Course/retest notices accurately describe the retained Show/Hide choice and assisted reference exposure.

## Acceptance
1. First-phase Studio/HUD/settings/error/difference surfaces use shared English and Simplified Chinese dictionaries. English is the default, locale selection survives reload and updates DOM and recorded Canvas labels without restarting practice. Remaining surfaces are explicitly tracked for gradual coverage.
2. Short reference and typing blocks sit centrally and keep a stable origin while typing; native selection, paste, IME, tab/newline wrapping and recording match the visible editor. Hidden mode derives no width or text from the answer.
3. Check and Next share the HUD design and have clear localized accessible names and 44 CSS-pixel targets. Error summaries and review use readable red plus labels/symbols, only after an explicit check of the exact draft. Transient rewards stay within the status row without covering the reference control.
4. Inside retains the current overlay. Below places the keyboard outside the actual displayed video, uses available viewport space first, preserves native 0.5×/1× picture size and aspect, and safely scrolls on short screens. Both use the same scene/recording geometry.
5. Mobile/portrait defaults stay hidden and a native software keyboard takes priority. Explicit placement preference does not alter training history or media behavior.
6. Existing visible keyboard/pointer focus behavior remains unchanged; the earlier outer-frame question was explanatory, not removal approval.
7. Focused and aggregate regressions, exact production build, independent review and cloud-browser checks pass before same-site publication; physical-device limits remain explicit.


## Verified release preparation · 2026-10-11

The bounded phase-one implementation at exact source `1cccf9c3f2ad98baabff27eec33de5e11bfc06d7` passed independent review, aggregate software checks, an exact production build and the exercised cloud-desktop browser gate. The requirements above remain unchanged. This is not full-PRD, physical-device or user visual acceptance. Untranslated surfaces, recovered Chromium error 9, incomplete portrait-source import and other limits are recorded in [release verification](release-verification-v80.md). Publication identity and public smoke are separate later receipts.


## v81 focused addition · live reference-letter feedback · 2026-10-11

The user accepted the v80 visual result and requested immediate letter-color feedback first. Preserve its layout, controls, keyboard placement, language behavior and all previous releases. This addition changes presentation only; the v80 statements about explicit checking still govern scores, attempts, result summaries and submission sounds.

- While the reference is visibly available in assisted typing, entered matching letters are mint green with a straight underline; entered differences are red with a wavy underline. Editing, deletion and paste update on the next shared display frame.
- Use the existing checker normalization and grapheme boundaries with prefix-aware alignment. Missing/unentered characters have no invented typed error span; the untyped reference remains pale. Formal Check remains necessary to establish whole-word correctness and omissions.
- Strict hidden typing and hidden listening expose no live correctness, expected text, expected length or answer-dependent geometry through Canvas, DOM or accessibility. Hiding clears native live styling immediately. Existing exact checked results retain priority until the real draft changes.
- Keep one native textarea for caret, selection, scrolling, tab/newline input and composition. Provisional IME text remains neutral; its final committed text receives ordinary feedback.
- The same Canvas projection supplies on-screen and recorded colors. No new attempt, score, reward, sound trigger or persisted accuracy metric is produced by presentation.

Acceptance: focused edge-case tests, aggregate regression checks, typecheck, production build and independent review before the parent-run browser gate. Native-device IME, OS keyboard and actual recorded capture remain separately disclosed checks. The concurrent playback-speed request is tracked independently and is not silently included in this minimal addition.


## Companion media repair in this candidate

This release candidate also includes the separately reviewed media-owner race repair: mutually exclusive practice/listening playback ownership, stale asynchronous play rejection, and the pure-listening timeline following the actually playing cue. Original media bytes, embedded audio, source timings, scoring and attempts remain unchanged. The bounded requirements and race matrix are preserved in the [media ownership Total PRD](../media-playback-ownership/PRD-total.md) and [Detailed PRD](../media-playback-ownership/PRD-detailed.md). The later input-following variable-speed feature is not included in this candidate.


## Bounded presentation follow-up · 2026-10-11

The feedback projection must stop before normalizing oversized restored text, reuse neutral as well as colored projections, and keep its matrix and temporary row buffers bounded. These are display-only limits: native/restored drafts, saved events, formal checks and scores must never be truncated or rewritten. Canvas transport navigation reuses the listening state already read for that same frame, while ordinary control navigation keeps its existing fresh read.

A cloud-browser error 9 was observed during short-draft listening/navigation tests. These bounded-work changes address proven CPU/allocation paths but do not establish or resolve that crash's cause. Existing full listening-history snapshot cost grows with accumulated spans and remains a separately recorded limitation; no statistics/history rewrite is included. The required final bounded-candidate browser acceptance was subsequently exercised as recorded below; its limited pass does not certify stability.


## Final integrated verification status · 2026-10-11

Exact integrated source `55bf7b7d05efca200127151dd8b9aa3bd5499c97` passed independent source review, 1,900 core/scene checks (zero skips), 823 media checks (one pre-existing optional real MediaRecorder fixture skip), 93 HUD checks (zero skips), TypeScript and the production static-export build. The final capacity/navigation corrections were independently checked with 72 and 19 focused tests; 1,000 deterministic normal-size Unicode comparisons retained the prior feedback ranges. These are software evidence, not proof of browser crash resolution.

The broader a489 functional browser matrix passed live green/red native-letter feedback, middle edits and Tab/newline paste, neutral hidden mode, explicit checked precedence and stale-check removal, no live formal attempts, café listening/navigation, language persistence and responsive layout. After the final 55bf replacement, the exact 388-file manifest and actual requested replacement runtime were verified. Saved Chinese preference and draft recovered. Native correct/incorrect-letter edits recomputed colors; Hide removed reference/answer-derived colors and accessibility validity hints. Listen Next/Previous moved to 6/0 seconds. Continue → Let me type preserved the draft and left playback paused. The final roughly two-minute interaction window showed no additional error 9; it is a focused delta gate, not a complete repeat of the earlier matrix or stress test.

Earlier a489 and old QA pages displayed Chromium error 9 with unresolved cause. Reload recovered saved data; the earlier single-QA-page recovery remained usable for about four minutes. The performance bounds address demonstrated work/allocation paths and do not explain or establish a fix for that crash. Original listening-history snapshot costs still grow with accumulated spans; long-duration stability remains unverified. NPS response-body loading remains limited. Actual audible native-track quality/lip synchronization, genuine device IME/mobile OS, camera/microphone and recorded output were not verified. The user's unspecified original sound/picture symptom is not claimed resolved. Input-following adaptive speed is excluded.

This completes the bounded functional cloud-browser release gate with disclosed limitations, not full-PRD or user visual acceptance. Publication identity and subsequent actual public smoke are recorded separately after those operations. Requirements and earlier released PRDs remain unchanged.

See [integrated release verification](release-verification-v81.md).
