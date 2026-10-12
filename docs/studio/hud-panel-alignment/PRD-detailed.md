# LingoTrace HUD panel edge alignment: detailed amendment

Status: source candidate based on `4d6e573d7cc1f3170ea8bf88069198f99fcb1303`.

## Evidence and exact change

The supplied NPS screenshot uses a 1280px-wide stage. Existing landscape content rectangles were independently padded by 7 logical pixels horizontally and 6 vertically. This produced:

- Practice Target left 25, Input Flow left 43: an 18 logical-pixel difference, about 13.78 CSS pixels at 1280px.
- Practice Target top 48, title top 32, Input Trend top 34: a 16 and 2 logical-pixel difference from the title rail, about 12.25 and 1.53 CSS pixels.

The corrected default landscape plates share left 25 and top 32. Goal extends upward 16 logical pixels, Trend upward 2, and Flow leftward 18. Their opposite edges and all content rectangles stay in place. Title remains at its previous boundary. A Flow panel explicitly moved horizontally retains its own padded position. Portrait keeps its separate stacked title and existing rectangles.

## Scope and invariants

A presentation-only helper supplies actual plate extents to both the existing Canvas background draw and local luminance sampling. Adaptive alpha limits, continuous luminance mapping, smoothing, sampling cadence, reduced-motion behavior, and failure handling remain unchanged. No external service, frame persistence, or new permission is introduced.

Native/Canvas input, typography, keyboard placement, media contain sizing, Fixed/Follow anchors, custom-layout storage, scoring, and replay semantics are not modified. This increment is independent of the native textarea long-draft precision repair.

## Verification

- Regression first reproduced the old top-edge mismatch using actual Canvas pixels.
- Default and customized geometry tests cover desktop/portrait, Fixed/Follow, sizes 0.8/1/1.15, native/half/Fit, Inside/Below/hidden keyboard, and narrow-to-wide surfaces.
- Actual Canvas edge scans cover 960/1280/1672/1920 widths and Fixed/Follow with Inside/Below placement.
- Renderer sampling tests inspect the normalized regions passed to the adaptive controller.
- Programmatic NPS before/after frames compare every painted text command, font, color, and transform against the baseline and check state immutability.
- Source review and relevant aggregate tests must pass before integration. Program frames are not browser screenshots; same-Canvas recording wiring is not an end-to-end MediaRecorder acceptance claim.


## Subsequent scoped verification record — 2026-10-11

The candidate-stage statements above are preserved as historical handoff context; this later record updates only status and evidence, without changing requirements. The integrated runtime source is `90b7c3fa3a1ab5dfd39e29becb5af3434462f93d`. Source review, 2,029 core/scene tests (zero skips), 897 media tests (one pre-existing optional recording-fixture skip), TypeScript and the production build passed. The independent final source review passed 97 focused checks.

Actual dot-cloud Chromium accepted the scoped native UI repairs: the original 156-character narrow draft, caret/selection/scrolling, a new committed Café save followed by normal reload, Below keyboard-only placement, the thin footer, and the requested HUD background top/left edges. Unchanged error-preference, reduced-motion and locale independence checks come from the earlier exact 4d6 browser run; they were not all repeated in R2. This is a bounded UI gate, not whole-PRD or user visual acceptance. See `../main-ui-v82-release-verification.md`.

Media remains outside this acceptance: Café still displayed a native playback error in the HTTP preview, and NPS was blocked by its HTTPS qualification rule. Historical Chromium error9 incidents remain unexplained. Physical-phone/OS IME, vibration, audible effects, speech synchrony, camera hardware and actual recorded output were not verified. No new typing Follow runtime is included in this main-site release; the separate public QA Follow candidate remains independently gated. Publication and the final release commit are established only by the saved-version/deployment receipt, followed by the separate production HTTPS smoke.
