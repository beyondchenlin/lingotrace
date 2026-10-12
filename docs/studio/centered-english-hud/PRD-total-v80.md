# LingoTrace · Total PRD v80

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
