# LingoTrace HUD panel edge alignment

Status: source candidate. No publication or browser acceptance is implied.

## Purpose

Correct the panel-background edges marked in the user's 2026-10-11 NPS screenshot: the Practice Target and Input Flow left edges, and the Practice Target, material title, and Input Trend top edges.

## Requirements

- Default landscape HUD backgrounds use one left rail and one top rail.
- Preserve the existing text, chart, content, control, and drag anchors; do not redesign the HUD or change font sizes.
- Keep Fixed/Follow scaling, native/half/Fit video sizing, Inside/Below/hidden keyboard, portrait layout, and saved custom positions.
- Use the visible background geometry for local adaptive-contrast sampling and draw it through the existing recordable Canvas.
- Preserve all real input, achievement, history, playback, and decorative/real-data boundaries.

## Acceptance

The three actual Canvas top edges and two actual left edges align at common scene/CSS sizes. Programmatic geometry and Canvas tests are required; browser verification and publication remain separate release gates. Earlier requirements remain in effect except for the background-boundary correction above.


## Subsequent scoped verification record — 2026-10-11

The candidate-stage statements above are preserved as historical handoff context; this later record updates only status and evidence, without changing requirements. The integrated runtime source is `90b7c3fa3a1ab5dfd39e29becb5af3434462f93d`. Source review, 2,029 core/scene tests (zero skips), 897 media tests (one pre-existing optional recording-fixture skip), TypeScript and the production build passed. The independent final source review passed 97 focused checks.

Actual dot-cloud Chromium accepted the scoped native UI repairs: the original 156-character narrow draft, caret/selection/scrolling, a new committed Café save followed by normal reload, Below keyboard-only placement, the thin footer, and the requested HUD background top/left edges. Unchanged error-preference, reduced-motion and locale independence checks come from the earlier exact 4d6 browser run; they were not all repeated in R2. This is a bounded UI gate, not whole-PRD or user visual acceptance. See `../main-ui-v82-release-verification.md`.

Media remains outside this acceptance: Café still displayed a native playback error in the HTTP preview, and NPS was blocked by its HTTPS qualification rule. Historical Chromium error9 incidents remain unexplained. Physical-phone/OS IME, vibration, audible effects, speech synchrony, camera hardware and actual recorded output were not verified. No new typing Follow runtime is included in this main-site release; the separate public QA Follow candidate remains independently gated. Publication and the final release commit are established only by the saved-version/deployment receipt, followed by the separate production HTTPS smoke.
