# LingoTrace · Prominent typing area detailed amendment

Source baseline: `18ac500220750949349a29d441ed5c428ee006c7` (the full v81 release source). Status: candidate, 2026-10-11. All prior requirement and release documents remain preserved.

## Evidence and clauses changed
The user's 2026-10-11 request, “看看这些图片，打字显示区域的占比要大，要突出，我们的也需要优化”, accompanies three photographed learning screens. All three images were inspected. English text dominates the learning screen, can take two lines, and uses conspicuous typing marks. This is a proportion reference, not a request to reproduce the surrounding livestream interface, faces, furniture, physical keyboard or example grammar.

PT-01 supersedes v81 UI-02's 420 CSS-pixel hidden block cap. The hidden region is determined only by the viewport and neutral padding. Shown complete-cue centering still depends on the full explicitly visible reference, never the changing typed prefix. Natural wrapped lines share a centered paragraph region; they do not independently re-center each newly typed prefix. The established native textarea remains the only editable value.

PT-02 changes the shared input geometry, not CSS alone. Landscape font is clamp(30 CSS px, 60 logical pixels, 64 CSS px); portrait is clamp(28 CSS px, 34 logical pixels, 38 CSS px). Line height is 1.25 times that exact font. Native textarea, measured native mirror, ghost continuation, selection, underline/error runs and recording Canvas consume this same geometry. The normal 1280px scene uses 45.93 CSS-pixel glyphs versus the former 26.03px.

PT-03 widens the centered landscape region to 90% of the scene before its neutral outer and text padding, yielding roughly 86% usable text width at desktop sizes. Portrait uses 10 logical-pixel exterior margins, with small scale-aware padding. It preserves two landscape and three portrait complete line heights, then scrolls the complete native value and ghost together. Check and the status row stay below the editor, with no error removal or control overlay. No larger empty vertical wrapper is introduced.

PT-04 prioritizes text within the existing style system. Primary goal, title, trend, counter and original video pixels remain unchanged. Only in Inside landscape, a colliding right-hand inset keeps its right edge and aspect while moving into the gap below the upper-right trend; the lane reserves at least 44 CSS pixels of height without enlarging an already smaller saved inset. A colliding flow panel moves beside the passive keyboard, retaining its existing left/right side and edge where safe; a saved central position is temporarily docked into the nearest safe side lane instead of being collapsed. Only the width reduction needed for separation is applied. A custom inset that would overlap a primary HUD or reference action after relocation falls back to the right safe lane. The reference toggle's invisible hit area is limited to its quiet helper region, away from the primary goal and inset. The compact, disabled-camera entry uses that same safe right lane below the trend and above the editor, instead of being forced up across the trend label by the larger card. Its visible size remains 32px and hit area 44px. Saved user arrangements are not rewritten. Below video and portrait do not apply these collision adjustments.

PT-05 retains one-screen ordinary desktop practice. A native 1280×720 picture retains the 1672×941 logical scene. Around 960 CSS pixels wide, a small scene-height extension protects text and controls while remaining under a 720px available height; tiny or genuinely short views may scroll. The passive keyboard remains inside the original picture in ordinary landscape. Below still starts after the actual contain-rendered video rectangle and retains its established 150–260px height policy. It never forces Fit or upscales a native source.

## Verification contract
1. Test geometry at landscape 320, 560, 692, 960, 1280, 1672 and 1920 CSS pixels, and portrait 320, 390, 430 and 640, with Inside, Below and hidden keyboards.
2. Assert actual font pixels, content-width ratios, paragraph center, native style/Canvas line-height identity, minimum action targets and no editor/control/HUD collisions. Assert no mutation of base or saved geometry.
3. Exercise a real-font, two-line sentence, longer native drafts and scroll-to-caret reachability. Retain the existing native selection, composition, tab/newline, partial-word ghost, live feedback and checked-feedback regressions.
4. Check source type safety and complete core/scene/media suites. Compare before/after same-renderer program frames separately from browser screenshots.
5. Before publication, independently review the integrated source and build once; inspect the ordinary/short/portrait browser layouts, show/hide reference, long input and error row, Inside/Below, native caret/selection/ghost parity, and a secondary inset when enabled. Physical IME and OS keyboard remain unverified unless actually exercised.

## Candidate evidence
- New proportional/collision/long-input matrix: 39 tests, including 100 custom-arrangement combinations, 60 fixed/follow HUD settings and 90 compact-camera hit-area combinations.
- Source type check: passed with no emit and no incremental output.
- Same-renderer before/after frames: 1280 Inside, 960 Inside, 1280 Below, and 390 portrait. These are program frames, not browser screenshots. Their inaccessible-video sampling fallback may make the existing adaptive HUD backing darker than a live readable source.
- Final regression counts and independent review are recorded in `VERIFICATION.md` after completion. No build or deployment is performed by this amendment task.


## Subsequent scoped verification record — 2026-10-11

The candidate-stage statements above are preserved as historical handoff context; this later record updates only status and evidence, without changing requirements. The integrated runtime source is `90b7c3fa3a1ab5dfd39e29becb5af3434462f93d`. Source review, 2,029 core/scene tests (zero skips), 897 media tests (one pre-existing optional recording-fixture skip), TypeScript and the production build passed. The independent final source review passed 97 focused checks.

Actual dot-cloud Chromium accepted the scoped native UI repairs: the original 156-character narrow draft, caret/selection/scrolling, a new committed Café save followed by normal reload, Below keyboard-only placement, the thin footer, and the requested HUD background top/left edges. Unchanged error-preference, reduced-motion and locale independence checks come from the earlier exact 4d6 browser run; they were not all repeated in R2. This is a bounded UI gate, not whole-PRD or user visual acceptance. See `../main-ui-v82-release-verification.md`.

Media remains outside this acceptance: Café still displayed a native playback error in the HTTP preview, and NPS was blocked by its HTTPS qualification rule. Historical Chromium error9 incidents remain unexplained. Physical-phone/OS IME, vibration, audible effects, speech synchrony, camera hardware and actual recorded output were not verified. No new typing Follow runtime is included in this main-site release; the separate public QA Follow candidate remains independently gated. Publication and the final release commit are established only by the saved-version/deployment receipt, followed by the separate production HTTPS smoke.
