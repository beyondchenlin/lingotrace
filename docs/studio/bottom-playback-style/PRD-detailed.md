# LingoTrace · Unified playback detailed amendment

Status: source candidate, 2026-10-11. Baseline: `1b693e483b44ddcf3a8c746d15cc543ccb076986`.

## Evidence and superseded clauses
Four supplied images were inspected as pixels: 20261011-094515 / 094516 show the thick hidden-keyboard bottom extension versus the desired video-overlay strip; 094729 / 094730 show a keyboard-only separate window (its white OS title bar is unwanted) versus the current Below layout that incorrectly moves the whole input and playback below the video. The intended result is a keyboard-only embedded lower region.

BP-01 amends prominent-typing PT-03 and PT-05 placement only. The two landscape text lines, actual font bounds and 44px Check/status controls remain unchanged. Hidden and Below now place the input card immediately above the upper playback strip, reserving a small gap. Ordinary 1280-native retains height 941 rather than extending to 1103 logical pixels (about 845 CSS pixels).

BP-02 keeps one source of player geometry. `inputCardGeometry` exposes the upper `playerTop` separately from total `stageHeight`; `applyInputCardLayout` supplies the same real play/previous/next/mute/seek/listening/cue-marker targets to native controls and the Canvas. At widths ≥560 CSS pixels, the strip is 60px high. Narrow landscape and portrait retain the 116px two-row safety layout. The strip reuses the existing adaptive translucent HUD backing; no opaque replacement CSS or duplicate controls are added.

BP-03 supersedes PT-05's old Below card-after-video rule. Hidden and Below first compute the identical upper input/control surface. Only Below appends the passive keyboard after both the upper player and actual contained picture. It remains 150–260 CSS pixels tall, with only the ordinary geometry gap above/below. There is no document Picture-in-Picture request or new window. Existing separately requested popout behavior is untouched.

BP-04 prevents secondary collisions without changing saved preferences. Hidden/Below relocate a colliding flow panel above the card, preserving its dimensions; only the necessary upper clearance is reserved. They share the existing bounded right-inset collision projection and quiet helper hit area with Inside. The compact camera entry uses this safe helper/trend lane. A separately shown caption sits above the card instead of underneath the relocated input. Primary goal/title/trend, counter, media rectangle and source aspect remain unchanged.

BP-05 anchors the overall scene shading to the upper player bottom, not the appended Below keyboard height. With the same media/state, hidden and Below have byte-identical upper Canvas pixels at logical rendering resolution. The keyboard receives the existing neutral lower Canvas background, without a window title strip. Inside keeps its prior geometry and shading.

BP-06 retains bounded safety scrolling for small/short/half-size cases. Minimum landscape glyph size (30px), the complete two-line viewport and 44px real controls are not reduced to force fitting inside a small picture. In those constrained cases the shared upper surface may extend beyond actual video pixels. It neither upscales media nor places a second input/player under the keyboard. Portrait's existing separate stack and placement independence are unchanged.

## Scope fences
No changes to `Studio.tsx`, native-input capture/scroll/render functions, answer value or selection, grading, sessions/history/storage, sounds/haptics, lesson/video ownership, seek handlers, permissions, recordings, dependencies, assets, other styles or the Follow runtime. The only runtime changes are shared presentation geometry, compact-camera placement and caption/gradient placement in the existing renderer.

## Verification contract
- Matrix: 320, 430, 560, 640, 692, 960, 1165, 1280, 1672, 1920 CSS-pixel landscape widths × half/native/Fit × Inside/hidden/Below.
- Assert 44px targets, no editor/control/HUD collisions, seek-to-marker ratio identity, real range thumb alignment, shared upper hidden/Below geometry, unchanged primary/media anchors, bounded lower keyboard and portrait independence.
- Convergence: portrait/landscape × hidden/shown × Inside/Below × 320/640/1280 widths × 180/720/1080 heights × half/native, with 16 repeated layout/fit calculations.
- Saved-arrangement matrix covers 200 hidden/Below combinations with positive secondary panels and no primary/input/control collision.
- Pixel test uses the real renderer and local synthetic media to compare the entire upper hidden and Below Canvas. It does not claim native DOM, media playback, browser screenshot or recording-file validation.
- Before/after program frames use the actual NPS source video at 1 second: 1280 Inside, hidden and Below; 640 half Below; 960 hidden; 390 portrait. The script accepts output and baseline checkout arguments; its input `nps-source-frame.png` is extracted from the unchanged NPS source. These images do not include native DOM-only icons, so browser controls still require the browser gate.
- Earlier Below tests are updated only where their assertions explicitly encoded the superseded whole-card-below behavior. Existing source, media and unrelated scene checks remain required.

## Release gate
Build and actual browser QA are owned by the main integration task. Inspect keyboard toggles and Inside/Below with shown/hidden reference, long draft/caret/scroll, actual playback/seek and recording layout at ordinary/short/portrait sizes. The separate reported Chrome error 9 and native scroll/parity findings are not attributed to or resolved by this style patch.


## Subsequent scoped verification record — 2026-10-11

The candidate-stage statements above are preserved as historical handoff context; this later record updates only status and evidence, without changing requirements. The integrated runtime source is `90b7c3fa3a1ab5dfd39e29becb5af3434462f93d`. Source review, 2,029 core/scene tests (zero skips), 897 media tests (one pre-existing optional recording-fixture skip), TypeScript and the production build passed. The independent final source review passed 97 focused checks.

Actual dot-cloud Chromium accepted the scoped native UI repairs: the original 156-character narrow draft, caret/selection/scrolling, a new committed Café save followed by normal reload, Below keyboard-only placement, the thin footer, and the requested HUD background top/left edges. Unchanged error-preference, reduced-motion and locale independence checks come from the earlier exact 4d6 browser run; they were not all repeated in R2. This is a bounded UI gate, not whole-PRD or user visual acceptance. See `../main-ui-v82-release-verification.md`.

Media remains outside this acceptance: Café still displayed a native playback error in the HTTP preview, and NPS was blocked by its HTTPS qualification rule. Historical Chromium error9 incidents remain unexplained. Physical-phone/OS IME, vibration, audible effects, speech synchrony, camera hardware and actual recorded output were not verified. No new typing Follow runtime is included in this main-site release; the separate public QA Follow candidate remains independently gated. Publication and the final release commit are established only by the saved-version/deployment receipt, followed by the separate production HTTPS smoke.
