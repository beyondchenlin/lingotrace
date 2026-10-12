# Video palette: integrated candidate

Base: `d567cd04057c696450650eef1e354877f4b3b24e` (published v59).
This document describes the independent F07 implementation candidate. It is not a
claim of publication or real-browser/device acceptance.

## Scope and source clauses

PRD v1.4.9 F07, P169–179, P180–189 and T182: an explicit, local-only video colour
choice; independent pixel-read capability; first usable decoded frame or slow
following; manual lock; failure fallback; lifecycle cleanup; preview and recording
share the current scene. Default is OFF on every page load. Existing approved
green standby and amber training colours, correctness colours, fonts, positions,
sizes, HUD energy/timing, input state and training facts remain unchanged.

This is the existing video's decorative colour control, not a general HUD JSON
editor, ten-theme implementation, AI layout service or engineering re-renderer.
Settings live only in the existing settings panel, with no new on-stage banner.
There is no new network request, permission, dependency, persistent record,
camera/microphone source, history migration, scoring rule or recording-retention
change. The original built-in café video is sufficient to exercise the feature.

## User flow

- OFF leaves the existing rendering path intact and allocates no sampling canvas.
- First-frame captures the first usable decoded frame after the explicit choice,
  or after a new video becomes ready. It does not autoplay or seek and stays fixed.
- Slow follow samples the existing lesson video at up to 8 Hz. Pausing stops the
  timer; a user seek permits one new sample. Seeking resets cross-location
  smoothing. Hidden/pagehide stops sampling, and returning never starts playback.
- Reduced motion keeps a static capture even when the selected mode is follow.
- Fix current palette retains that snapshot across seeks, mode changes and source
  replacement. Unlock resumes the selected mode using the new source as needed.
  OFF explicitly clears the lock and returns to the original palette.
- Images and camera video are never sampled. Unlocked unavailable/failed reads
  fall back to the original palette, with the reason in settings. A new source
  resets the failed sampler; security errors are not bypassed or polled.
- Explicit mode/lock changes take effect on subsequent shared Canvas frames.
  There is no uncommitted palette preview, and no change rewrites recorded frames.

## Data and rendering boundaries

`video-palette.ts` owns one disposable, dedicated 96×54 sampling canvas. It never
reads the main scene/recording canvas. Black borders are cropped, the lower
subtitle region is downweighted, black/white frames use the safe fallback, white
flashes retain the last valid result, and low-chroma scenes retain hue continuity.
The controller has source generations plus timer epochs so canceled or obsolete
callbacks cannot publish later colours. Manual lock remains authoritative even
if the video emits a playback error; unlocking then falls back to default. Native
media failure is retained while OFF and reported only after enabling. A genuinely
decoded loadeddata frame may recover playback failure; pixel-read/security
failure cannot use that path and requires a new source/reset.

The pure analyser produces only four bounded hex colour slots: decorative frame,
glow, dark glass top and bottom. Smoothing uses approximately 600 ms normally and
250 ms for a cut, with bounded lightness changes. These are reversible engineering
parameters, not learning/achievement thresholds. Palette samples update an
existing scene ref; React receives only changed control/status snapshots.

`SceneVisual.palette` is optional. `paintTransparentScene` validates it and changes
only the decorative frame/glow and tinted glass helpers. Semantic tone, every
text colour, correctness feedback, animation clocks and `responsiveLayout` are
unchanged. Activated glass uses a dark backing so its light text remains readable.
Invalid slots are treated as OFF. `SceneRecorder` continues to capture that exact
same Canvas, with no alternative render, audio or media path.

The hook is owned by Studio outside conditional panels. Reopening settings does
not create a second sampler. Unmount clears subscriptions, timers, canvas state
and the scene palette; late callbacks cannot update the next instance.

## Program verification

Focused tests cover:

- Strict slot validation, all hue/saturation/lightness output bounds, black/white
  rejection, chromatic frames, letterboxing, subtitle weighting, flash handling,
  low-chroma hue, and bounded smoothing.
- OFF/first-frame/follow, pause and seek, hidden/pagehide/pageshow, reduced motion,
  lock across source/mode/error, unlock, late callbacks, read failure and recovery,
  disposal, no video play/pause/seek writes and no per-sample React updates.
- Actual settings JSX and hook ownership; source resets precede media replacement.
- Same text, text colour, geometry and facts with/without palette in landscape and
  multiple portrait heights; unchanged standby timing and reduced-motion rules;
  deterministic common preview/recording frames; protected replay; dark-glass
  text contrast above 4.5 against a worst-case white backdrop.

A one-time comparison against the unmodified d567cd0 renderer produced identical
PNG SHA256 values for all five OFF fixtures: landscape standby/live, portrait
standby at 840, portrait live at 1080 and reduced-motion portrait at 1400. These
are program images, not browser screenshots. The benchmark is likewise a local
Node analyser measurement, not a browser/input/recording performance result.

Final candidate checks: core/scene 813 passed; media 249 passed and one existing
encoded-MediaRecorder-fixture test skipped because its optional fixture was not
supplied; HUD library 93 passed. TypeScript and production build passed. The
initial additive publication-tree assembler preserved 96 existing files and
added 20 shared dependencies while updating both Studio routes. The review-fix
assembly preserved 122 current protected files and added 3 dependencies. Seven
new regression cases cover errors during OFF/manual lock for both modes, valid
loadeddata recovery, and pixel-read failure remaining blocked, including a later media error during OFF. No publication
occurred before this frozen candidate was reviewed.

## Browser acceptance still required

Use normal UI with the built-in original video; no file upload is necessary.

1. Fresh page is OFF and preserves the original main stage. Select first-frame
   without autoplay/seek; verify it becomes fixed once video data is available.
2. Select follow, play, pause, and seek. Test lock, change modes/material, unlock,
   OFF, and reopening settings. Check reduced motion, true hidden/return and
   source failure/recovery where the browser permits controlled evidence.
3. Keep a real draft/result and original layout through every control change.
   Verify standby/first-edit colours and text/correctness remain unchanged in
   landscape and portrait.
4. Start ordinary stage recording with the existing explicit audio choices;
   switch allowed colour modes, stop, preview and inspect the actual encoded
   file. Settings must not be captured; recorded colours should be the live
   scene at each time. This is distinct from deterministic renderer tests.
5. Record actual browser/version/viewport, analysis/interaction cost and a
   meaningful session window. Physical-device tests and broad media-source
   compatibility remain separate claims.

No browser/upload approval is inferred from these program checks. The unrelated
v59 normal-file-picker acceptance remains a separate pending operation.
