# LingoTrace · Prominent typing area amendment

Status: source candidate, 2026-10-11. This paired amendment extends the v81 requirements and preserves every earlier PRD. It is not a publication or browser-acceptance claim.

## User need
The three supplied learning-screen photographs request a larger, more prominent typing display. The useful reference is the relationship within the learning canvas: large English text, a visible current typing position, modest supporting imagery, and quiet secondary actions. The surrounding livestream UI, people, physical keyboard and incorrect example sentences are not product requirements.

## Outcome
- Make actual editable English glyphs substantially larger, rather than enlarging an empty card.
- Give sentences a broad, centered safe region and natural wrapping. Keep the shown complete-cue block stable as the learner types; keep the sole native textarea, its caret, selection, IME and Canvas/recording measurements aligned.
- Keep Check, actual error feedback and playback controls reachable. Retain the low-opacity HUD treatment without adding an outer frame.
- Preserve native video pixels, source aspect, the ten style systems, and the Inside / Below video keyboard options. Mobile or portrait startup continues to hide the passive keyboard.
- Prefer one-screen ordinary desktop practice. When the larger text collides with secondary content, make bounded view-only adjustments to the right-hand inset and left-hand flow panel. Only constrained views extend enough to remain usable.

## Measurable acceptance
- At a 1280 CSS-pixel landscape learning canvas, English glyph size is about 46 CSS pixels, up from about 26; the safe text line spans at least 86% of the canvas before complete-cue centering.
- Landscape font is bounded to 30–64 CSS pixels; portrait is 28–38. At ordinary 320–640 portrait widths, safe text width is at least 86%.
- Two complete landscape text lines, or three portrait lines, fit before native vertical scrolling. No horizontal clipping of a long English word or loss of actual draft characters is introduced.
- The standard 1280×720 native source retains its original picture pixels and ordinary Inside scene height. A 960-wide scene remains below 720 CSS pixels tall.
- No overlap between the actual editor and Check, error summary, playback controls or adjusted HUD content. Action targets remain at least 44 CSS pixels.
- Hidden typing uses a viewport-derived full-width safe region. No current or past reference length, width, count or scroll extent is consulted.

## Boundaries
This amendment does not change scoring, answer checking, achievements, persistence, media playback ownership or error-cue semantics. Hardware/OS keyboard behavior, actual IME, device audio and browser recording are separate checks. An exact integrated build, independent review and browser visual acceptance remain release gates.


## Subsequent scoped verification record — 2026-10-11

The candidate-stage statements above are preserved as historical handoff context; this later record updates only status and evidence, without changing requirements. The integrated runtime source is `90b7c3fa3a1ab5dfd39e29becb5af3434462f93d`. Source review, 2,029 core/scene tests (zero skips), 897 media tests (one pre-existing optional recording-fixture skip), TypeScript and the production build passed. The independent final source review passed 97 focused checks.

Actual dot-cloud Chromium accepted the scoped native UI repairs: the original 156-character narrow draft, caret/selection/scrolling, a new committed Café save followed by normal reload, Below keyboard-only placement, the thin footer, and the requested HUD background top/left edges. Unchanged error-preference, reduced-motion and locale independence checks come from the earlier exact 4d6 browser run; they were not all repeated in R2. This is a bounded UI gate, not whole-PRD or user visual acceptance. See `../main-ui-v82-release-verification.md`.

Media remains outside this acceptance: Café still displayed a native playback error in the HTTP preview, and NPS was blocked by its HTTPS qualification rule. Historical Chromium error9 incidents remain unexplained. Physical-phone/OS IME, vibration, audible effects, speech synchrony, camera hardware and actual recorded output were not verified. No new typing Follow runtime is included in this main-site release; the separate public QA Follow candidate remains independently gated. Publication and the final release commit are established only by the saved-version/deployment receipt, followed by the separate production HTTPS smoke.
