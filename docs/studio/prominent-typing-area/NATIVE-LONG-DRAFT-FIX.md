# Fractional native input width correction

Date: 2026-10-11. Base: main candidate `1b693e483b44ddcf3a8c746d15cc543ccb076986`.

> Follow-up: the 4d6e573 browser retest still failed. Preserving the rounded computed-style string was insufficient. See NATIVE-LAYOUT-PRECISION-ADDENDUM.md for the actual Chrome measurements, the second precision loss, and the minimal repair. Earlier ASCII fixtures below establish a possible threshold mechanism, not the final browser cause.

## Observed blocker

Cloud Chrome QA v2 showed persistent overlapping last lines and two caret positions in a narrow portrait Inside layout after hiding the reference and pasting this 156-character draft:

```text
Could I have a coffee, please?
This is a longer QA draft with several words to verify natural wrapping and native scrolling.
The final line stays editable.x
```

Reported native inline styles: 28px font, 35px line height, 6px padding, 535.116px height. The settled 485×734 screenshot demonstrates the defect; the browser worker did not read live JS geometry properties. Therefore the exact native content width below is a source/font-derived reproduction fixture, not a claimed browser measurement.

## Isolated mechanism

`captureNativeInputDisplay` previously derived mirror content width from integer-rounded `textarea.clientWidth`. At a 300px portrait surface, its geometry gives a 274.0465px editor. A 10px outer thin scrollbar produces approximately 264.0465px textarea width. The relevant Blink 1/64px used-width fixture is 264.046875px, or 252.046875px content after padding.

The bundled mono font uses 2048 units/em and a 1229-unit Latin/space advance. At 28px, fifteen glyphs occupy 252.041015625px. Native content can fit them; a 252px integer-derived mirror cannot. Applying those two widths to the actual capture algorithm with deterministic ASCII pre-wrap Range geometry yields:

- Fractional content: 13 lines, last caret y=426 CSS px.
- Integer content: 15 lines, last caret y=496 CSS px.
- Difference: 70 CSS px, exactly two 35px lines.

The reported 535.116px height is also consistent with the portrait geometry scale (300/430); it was read from the live textarea style, not produced by this simplified glyph-height fixture. The exact 70px wrap difference is evidence for the wrapping defect, separate from the earlier Chrome error9, whose cause remains unestablished.

## Minimal repair

- Preserve computed CSS fractional width, account for box sizing, padding and borders, and subtract only a scrollbar owned by the textarea itself. The outer scrollbar is already represented in computed textarea width.
- Include this fractional content width in the existing capture cache key and keep fractional padding-box width through the returned display.
- Center a visible cue using the same measured native width. Hidden mode still uses only constant base padding and the actual draft; no answer-length dependency.
- If textarea growth changes content width by introducing an outer scrollbar, remeasure within the same sync call, bounded to three settling passes plus a final matching projection if that bound is exhausted. Transfer internal auto-scroll only once to the outer viewport.
- Compare numeric height before writing to avoid CSSOM decimal serialization causing repeated equivalent style writes.

No changes to draft values, selection, focus, IME events, input ownership, font sizes, video/layout geometry, baseline measurement, training facts, or recording pipeline.

## Verification

`native-input-width.test.ts` covers the exact draft, the fifteen-glyph threshold ±0.01px, width changes that leave integer clientWidth unchanged, font-swap invalidation, selection/backward caret, native scroll transfer, height-induced scrollbar reflow, hidden live/recorded Canvas geometry equality, and composition-value/selection preservation. The deterministic ASCII fixture is not used to claim browser IME or Unicode shaping correctness. Existing reference, live feedback, grapheme and input tests supplement it.

Browser release gate remains open until the integrated candidate passes the same narrow portrait sequence with the complete long draft, selection/caret movement, and Inside/Below/hidden-keyboard layouts. No build or browser was run for this source-only patch.

## Residual design risk

The prior screen design can render neutral native glyphs/caret together with their Canvas projection, while the same Canvas supplies recordings. This patch intentionally leaves that behavior unchanged to make the geometry correction independently testable. A future single-owner design must preserve native editing/IME and recorded glyph/caret output; it must not conceal an unresolved wrap mismatch or add start/stop recording flashes.

### Source validation completed

- TypeScript: `tsc --noEmit --incremental false` passed.
- Core + scene: 1,957 passed, 4 intentionally skipped, 0 failed (tsx, concurrency 2).
- Media: 897 passed, 1 intentionally skipped, 0 failed.
- Independent final review: 27 focused tests passed; an extra bound-exhaustion case with a real reference projection confirmed final reference lines, width, caret and scroll all derive from the same captured snapshot. No remaining code-review blocker.
- Full suite used the existing shared dependencies and a read-only public-assets symlink, neither included in the patch. An initial Node strip-only run was not a valid full-suite runner (unsupported TypeScript parameter properties/TSX and missing sparse assets); the complete supported tsx run above supersedes it.
