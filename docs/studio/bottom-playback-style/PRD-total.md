# LingoTrace · Unified playback and keyboard-only Below amendment

Status: source candidate, 2026-10-11. Baseline: `1b693e483b44ddcf3a8c746d15cc543ccb076986`. Every earlier PRD and release document remains preserved. This paired amendment is not a build, publication or real-browser acceptance claim.

## User need
The first two supplied images request one consistent bottom playback style: the thin translucent strip over the video in the keyboard-visible example, including when the keyboard is hidden. The next two images clarify Below: only the passive keyboard belongs outside the video, with no white desktop-window title strip. The native editor, shown reference/subtitle, Check, playback and HUD remain on their upper learning surface.

## Outcome
- Use the same translucent playback renderer and 60 CSS-pixel landscape strip in Inside, hidden-keyboard and Below states where one row fits.
- At ordinary 1280-wide native 720p, hidden keyboard keeps the original 1672×941 logical upper surface. Its Check row and playback stay over the picture; it no longer creates a thick dark extension below it.
- Below appends only the passive keyboard to the same page and shared recording Canvas. Its upper input/HUD/playback geometry and shading exactly match hidden keyboard. The separately available keyboard popout is preserved and is not invoked by choosing Below.
- Preserve the real editor, native input/IME ownership, complete draft, selection/scroll measurements, scoring, live feedback, playback/seek ownership and all existing controls. Keep action targets at least 44×44 CSS pixels.
- Keep Inside, Below, Show/Hide keyboard, portrait, half/native/Fit and HUD sizing choices independent. Native and half modes never upscale actual video pixels.

## Acceptance
1. Ordinary landscape has one thin 60px playback strip; narrow/portrait views keep the established two-row 116px safety layout rather than overlap targets.
2. Switching hidden ↔ Below does not move the upper editor, Check/status, playback, HUD or camera target. Only the lower keyboard and total surface height change.
3. Keyboard-only Below is entirely outside the contain-rendered picture, follows the upper player, and has 150–260 CSS-pixel height with a small gap. It creates no window and no browser/OS title bar.
4. No editor overlap with the real playback controls, cue targets, Check/status or adjusted HUD. Saved arrangements are never rewritten.
5. For constrained half-size, short, or narrow views, minimum glyph/target sizes take priority over one-screen fitting. A bounded vertically scrollable control surface may extend below the actual picture; the video remains unscaled and the keyboard remains a distinct lower region. Ordinary 1280-native satisfies full video-overlay placement.
6. Source tests, independent review, exact integrated build and actual browser acceptance remain separate gates. Program frames are labeled as program frames.

## Preserved requirements
Earlier prominent-typing, centered-English HUD, live letter/error feedback, media ownership, and independent Follow requirements are unchanged except for the explicit Below placement corrections in the paired detailed amendment. Unaccepted Follow runtime is not introduced into this main-source candidate.


## Subsequent scoped verification record — 2026-10-11

The candidate-stage statements above are preserved as historical handoff context; this later record updates only status and evidence, without changing requirements. The integrated runtime source is `90b7c3fa3a1ab5dfd39e29becb5af3434462f93d`. Source review, 2,029 core/scene tests (zero skips), 897 media tests (one pre-existing optional recording-fixture skip), TypeScript and the production build passed. The independent final source review passed 97 focused checks.

Actual dot-cloud Chromium accepted the scoped native UI repairs: the original 156-character narrow draft, caret/selection/scrolling, a new committed Café save followed by normal reload, Below keyboard-only placement, the thin footer, and the requested HUD background top/left edges. Unchanged error-preference, reduced-motion and locale independence checks come from the earlier exact 4d6 browser run; they were not all repeated in R2. This is a bounded UI gate, not whole-PRD or user visual acceptance. See `../main-ui-v82-release-verification.md`.

Media remains outside this acceptance: Café still displayed a native playback error in the HTTP preview, and NPS was blocked by its HTTPS qualification rule. Historical Chromium error9 incidents remain unexplained. Physical-phone/OS IME, vibration, audible effects, speech synchrony, camera hardware and actual recorded output were not verified. No new typing Follow runtime is included in this main-site release; the separate public QA Follow candidate remains independently gated. Publication and the final release commit are established only by the saved-version/deployment receipt, followed by the separate production HTTPS smoke.
