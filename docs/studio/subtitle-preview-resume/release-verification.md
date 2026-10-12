# Subtitle native-preview recovery · Release verification

Date: 2026-10-11. Status: source, independent review, build and bounded prepublication cloud-browser checks passed. The saved-version/deployment receipt records publication identity separately; this document does not claim a future production smoke result.

## Exact reviewed implementation

- Source: `219d6088929ecf6cc885551ad95f873ec5e231e6`.
- Base reviewed runtime: `bed4ad4dcb7ceb2a502b5634cc436d7e9e491210`.
- Only production change: `public/subtitle-workbench/main.js`, keeping a native pause/resume preview bounded with a deduplicated animation-frame checker and shared range guard.
- Changed served asset SHA-256: `2c590b8f07711e38ac4f1d52ee59dfb18c6f292d52ad1e750313d98303d82b3d`.
- BUILD_ID: `HAhKxJqwm6ZcE4jssIg4r`.
- Frozen build: 335 files; canonical path/hash manifest SHA-256 `5656ee6854375a7b4ff9ef34fbe1bf4bd396e768e981108994b460524e9184d2`.

The release preserves the four published v77/v78 status and verification documents byte-for-byte. It includes 31 prior immutable assets; all 196 overlapping immutable asset paths have identical hashes. The complete deploy payload has 366 files, canonical path/hash manifest SHA-256 `74f4553259fad909d350706f85e2bbe4f53e91039f4346d7ff8bfe650c1bd3ba`. The 117 unaffected protected public assets are unchanged. This supplement's final status and evidence are the only documentation changes layered on the reviewed source and retained release history.

## Verification

- 1,838 core/scene tests passed, no failures or skips.
- 823 media tests passed, no failures; one pre-existing optional recorded-MediaRecorder fixture skipped.
- 93 HUD tests passed, no failures or skips.
- TypeScript and actual static-export build passed.
- Independent review passed 94 focused checks plus seven additional production-handler probes.
- Actual cloud Chromium native controls: [1,2]-second preview pause/resume stopped at 2.010498 seconds; near-end seek/resume stopped at 2.006987. Out-of-range native seeks paused and cleared preview scope; subsequent explicit ordinary playback reached five seconds. Active-preview media replacement reset to zero paused. Normal page exit and Back during ordinary playback restored paused without media error. Studio records remained intact. No model download was started.

## Limits

The browser used a synthetic tone and authored subtitles, not speech-recognition evidence. Observed 7–11 ms endpoint overshoot does not prove sample/frame accuracy. Specific queued-event ordering is tested at the source level. Physical audio/device quality, real phone/touch/IME, microphone/camera, recorded-output parity, background visibility, ASR quality and full offline operation were not verified. User visual acceptance is not claimed.

## Release continuity

The existing public site remains the publication target with its audience preserved. Prior v78 release `9b5ef22aaae0a8d2701f2869b7e14378a56ee0a6` and its exact saved archive remain the rollback baseline. No storage clearing, data migration, extra UI feature or model/resource change is part of this correction.
