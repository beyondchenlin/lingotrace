# Transparent v6 / Site v23 candidate

The selected visual is `hud-v6-transparent-skin-demo.png`. This release changes the actual `/studio/` layout: transparent goal ring upper left, observed input rhythm lower left, observed trend upper right, camera inset on the right, compact central input and lower-left playback controls. The reference image is not used as a UI/background overlay. The existing original cafe media remains the source picture/video.

## Data and animation

- Goal: 24 confirmed word positions in the current training round. Earned words come from the existing TrainingEngine; fresh data starts at zero. The picture's 75%, 18/24, 12 and chart samples are not substituted into training.
- Commit count: changed inputCommitted events observed in the last 10 seconds, including editing/paste. Positive input energy and measured graphemes/second exclude paste and deletion, and count finalized IME input once.
- Trend: completed one-second observed bins, maximum 30-second visible history. Pause, background, missing observations and clock reversal create null gaps. Opening/restoring a session does not replay old typing as fresh activity.
- Motion: subtle decorative breathing, actual-input pulse strength with decay, media/page HUD entry and exit, and short feedback for confirmed words or fewer errors. Reduced-motion preference suppresses decorative interpolation; prior real input is shown as static ticks when frozen. Sound effects are not added in this candidate.
- Subscription and RAF rendering read performance.now(); a single captured timestamp supplies projection and Canvas painting. The same Canvas is the source for the existing composite recorder. This is shared code/state, not yet a claim that a browser-recorded clip passed QA.
- Existing reusable library types, trendSegments and inputWaveSamples are integrated. Its generic widget headers/footnotes do not match the selected v6 composition, so the scene paints the selected skin around those shared primitives. Other component types and isolated PracticeEngine/2B databases are not wired into the page.

## Preserved boundaries

Real DOM input and controls use the same scene rectangles. Long input remains horizontally scrollable. Four existing movable layers retain drag/resize/keyboard/dock/reset operation under new bounds; v6 preferences use a new key, leaving old v22 preferences intact. Legacy reference mode remains explicitly labeled with simulated figures and cannot score or record. Historical replay hides live input-frequency metrics and discards the live input's selection/scroll offsets.

Existing lesson/camera/local-media, local recorder, history/export and `/demo/` archive paths are retained. Capture still requires explicit user action. No backend, new credentials, AI, paid action, background recording or new repository is introduced.

## Checks and remaining acceptance

18 focused projector tests and 7 Canvas/geometry tests pass. The full primary runner reports 175 passing results and the media runner 42; TypeScript and the static build pass. Independent source/program-render review closed two replay issues: future input metrics leaking into historical snapshots and live input scroll hiding historical text.

Program frames were inspected at 1672×941 and 1920×1080. They are not browser screenshots. Candidate acceptance still needs the actual published page: layout/readability, normal and IME input/scroll, measured pulse and pause, reduced motion, file load/recovery, drag/keyboard/reset, full screen, and synthetic Canvas recording playback. No physical user camera/microphone/screen capture should be started by QA without explicit authorization. Mobile/Pad/TV layouts are not newly claimed by this desktop-first increment.

Rollback remains the existing public v22 saved version `appgprj_6ac5ccefb20481918a883afab8a483b4~appgver_9575e4227e6c8191abf21630d6b4c603`, source `3921e15e2b43a02509c6f288b1099c0fe6982f1f`. The pre-change source `bddfa868b27247480428d97d57fe15a56e0722b3` is also archived. No rollback is invoked merely because native-browser testing has not yet run.
