# Camera OFF compact entry (camera-only PRD 1.4.12)

Baseline: v71 `de7622e6c6281960310f8cf37aa5a78d07a837fa`.

## Implemented scope

- In the live lesson-primary layout, camera OFF/requesting/error uses a 32 CSS-pixel icon and a separate 44 CSS-pixel native button target. Canvas and DOM use the same derived geometry, measured against the actual stage rectangle. Opening this control only opens the existing camera settings panel.
- Camera ON, camera-primary, split, reference fixture and saved arrangements retain their original geometry. The compact calculation never writes layout preferences. Existing layout editing, presets, preview/apply/cancel/undo are unchanged.
- The video-only request is synchronously guarded against repeats. Cancellation/closing pending settings, page exit, unmount, disconnect and stale acquisition/play outcomes release their owned streams without clearing a newer one. ON requires a live video track and a ready frame with nonzero dimensions.
- Camera-off recording retains the existing REC timer on the shared Canvas. Recording inputs, course playback, Training, repositories, source identities and permissions are unchanged.

## Evidence at freeze

- `npm test`: 1,580 core/scene passed; 697 media passed, one existing optional skip.
- `npm run typecheck` and `npm run build`: required before freeze; build log retained with delivery evidence.
- Added 73 geometry tests, 14 actual renderer tests and 14 extracted real host-handler/effect tests. The six changed OFF-render assertions fail against frozen v71 and pass on this candidate.
- Frozen-render comparison: twelve orientation/camera/layout groups. ON and non-lesson layouts are pixel-identical; lesson-OFF differences are contained within the original camera region. This is synthetic program evidence, not physical-camera acceptance.
- Existing browser's applied portrait layout was exported before publication for later normal-UI comparison. No camera/microphone permission was requested or accepted for testing.

## Delivery gates and boundaries

A frozen candidate requires independent code review before same-site deployment. Normal HTTPS testing must verify the exact new DOM chunks, OFF icon and hit target in portrait/landscape, keyboard/settings access, retained layout export and old learning facts. Physical ON camera, camera permission dialogs and device-specific capture remain unverified unless separately authorized and actually exercised.

This change does not implement paused listening/demo, NPS bookmarks, round-closure storage, simulated keyboard or new achievement requirements. v71 playback fixes and old immutable assets must remain intact.
