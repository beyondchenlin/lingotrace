# Compact input amendment, 2026-10-10

Baseline: v75 / 380788d951d37e819ea1a7b2fa3cb0edcafc8ca6. Supplements the v1.4.14 overview F14 and detailed first-batch input/keyboard contract; no existing feature is removed.

## Overview amendment
Replace the boxed typing presentation and large confirmation button with a compact native editing surface, character or word underlines, and a small check/next control with a minimum 44 CSS-pixel hit area. Mobile/portrait defaults to the system keyboard, hiding the passive page keyboard until explicitly requested.

## Detailed amendment
One complete native textarea remains the editing authority, including IME, selection, undo, paste, real newlines, native wrapping and scroll. The default strict mode derives underline geometry only from the actual draft; an empty draft reveals no reference length. Optional letter/word hints explicitly expose reference-derived slots only after the existing hintExposed event marks this cue as assisted. Turning hints off does not erase assistance. A different cue/reference/session requires a fresh explicit hint selection. No new record schema, score, input source or database migration is introduced.

Display modes and keyboard visibility are presentation-only. Native and Canvas share line geometry, scrolling and underlines. Automatic listening display remains separate and cannot write native input, CPM, attempts or rewards. Existing submit/next, real error feedback, HUD/camera anchors, recording and rollback remain intact. Browser/IME/device/recording validation must be reported separately from programmatic tests.

Long empty guided cues share a bounded scroll container with the single native textarea. The editor may extend inside that container without expanding the visible box; full masked slots remain reachable before typing. Native edit/selection/IME boundaries request caret visibility, while manual scrolling alone does not reset it. Narrow portrait selectors stack with full 44px hit targets. Guided accessibility announces only assisted counts, never the expected text; default strict accessibility stays neutral.
