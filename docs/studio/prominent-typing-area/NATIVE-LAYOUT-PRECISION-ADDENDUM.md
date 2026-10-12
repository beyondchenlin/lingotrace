# Used-width precision: actual Chrome evidence and correction

Date: 2026-10-11. Source base: `4d6e573`. Main product release remains on hold pending a new-build browser retest.

## What the first correction did not establish

The first fractional-width patch preserved a computed CSS width string instead of integer clientWidth. Its deterministic ASCII tests passed, but the exact main-only 4d6e573 browser retest still showed duplicated last lines and two caret positions. Those tests were not proof of Chrome's actual layout. The earlier 252.046875px native-width hypothesis did not match the live page.

The browser's allowed DOM-attribute read showed the existing hidden mirror assigned `width:252.031px`. No application state, editing value or frozen build was changed during diagnosis.

## Independent real-browser experiment

A normal, separate engineering fixture copied the actual input-card source and app CSS and loaded the exact bundled mono WOFF (SHA256 `f70905f100ed52d7b478fe41450072b1bf7d85978ee68631b9cf863e08ffda1b`). It measured only its own synthetic 156-character draft and DOM. No injection, evaluate, CDP, DevTools, private browser state, or existing product tab access was used.

For the 274.03125px viewport, Chrome reported:

- Native textarea border box: DOMRect 264.03125px; computed CSS string `264.031px`.
- Reassigning the computed string produces a smaller 264.015625px border box.
- Original mirror: computed content width `252.016px`, actual border box 264.015625px, 15 lines, caret y=498px.
- A native textarea clone kept at exact 264.03125px width has intrinsic scrollHeight 467px.
- The same native clone assigned the rounded computed string has intrinsic scrollHeight 537px.
- Difference: 70px, precisely two 35px lines. Font loaded; internal textarea scrollTop was 0; baseline offset was a normal 23px.

This isolates a second precision loss: CSSOM width serialization loses a fraction of Blink's 1/64px layout unit; assigning that string to the mirror rounds down another unit. Both integer clientWidth and the first computed-string correction can therefore put native and mirror on opposite sides of a word-wrap boundary.

## Minimal repair

Refine the CSS-implied border-box width using the exact DOMRect width when the two agree within serialization precision. Convert either box model to border-box first, then subtract padding, borders and only the textarea's own scrollbar once. Do not divide the CSS measurement by sceneScale; scene scaling is applied only to returned logical geometry.

A materially different, zero, missing or non-finite visual rect keeps the computed layout-width fallback. This protects against using ordinary scale/rotation bounds as CSS layout width. Studio's current editor/ancestor layout is untransformed. This proximity guard is not a general proof against every arbitrary ancestor transform; generic fractional padding precision remains a separate possible concern, while the actual failing input uses exact 6px padding.

No width epsilon is added. Font, line-height, native value/selection/focus, IME behavior, live color feedback, dual native/Canvas ownership, playback/HUD geometry and recording pipeline remain unchanged.

## Real-browser candidate result

Changing only the width helper in the same independent fixture produced:

- Native and mirror border box both 264.03125px.
- 13 mirror lines, caret y=428px, outer scrollTop342px (previously15/498/412).
- White native glyphs and green Canvas projection visibly aligned, including the final editable.x.
- The second nearby viewport also corrected; the four other fixture widths retained their previous line counts.

This establishes the mechanism and candidate correction in real Chrome. It does not replace the integrated product retest of paste, native final x, caret movement, selection, long-draft scroll, reference hiding, portrait/landscape, Inside/Below and recording.

## Reproduction and regression

Run `node scripts/native-input-projection-fixture.mjs /absolute/output-directory`, serve that directory normally, and open it through an allowed ordinary browser workflow. It displays its own source/font hashes and native/mirror metrics. The output contains only synthetic QA text. The generator does not build or change the app.

Unit regressions cover exact DOMRect versus rounded CSS string, both box models, borders, own versus outer scrollbar, invalid or transformed rect fallback, multiple scene scales, and no artificial width padding. Existing threshold, font invalidation, IME non-mutation, selection, scroll, reference, recorded projection and Below/restore integration tests remain active.

### Final source validation

- Core/scene: 2,017 passed, 4 intentionally skipped, 0 failed; bounded concurrency2.
- Media: 897 passed, 1 intentionally skipped, 0 failed.
- TypeScript: no-emit, non-incremental check passed.
- Independent source review closed the wide-width serialization-guard edge case with tests at1030.03125,1102.046875,2644.03125 and9999.984375px plus1.1× visual-transform fallback. Final helper uses half the last digit of observed six-significant-digit CSS serialization as a comparison tolerance; it never adds that tolerance to the content width.
- Final source hash: input-card SHA256 `29905dfdec22f64cc12dc11bd045ac7d9227bfc9d6adb06d31dbc6e3658a2d7b`. The real-browser fixture evidence above tested the same narrow-width correction before the wide-width guard expansion; integrated-product QA remains required.
- No app build or deployment was performed by this patch's worker. Shared assets/dependencies were read through temporary symlinks and are excluded from the commit.
