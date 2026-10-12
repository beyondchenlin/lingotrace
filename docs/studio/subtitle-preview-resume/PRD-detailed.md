# Subtitle native-preview recovery · Detailed PRD

Status: implemented and independently reviewed at exact source `219d6088929ecf6cc885551ad95f873ec5e231e6`, based on `bed4ad4dcb7ceb2a502b5634cc436d7e9e491210`. Exact-source checks/build and bounded cloud-browser native-control acceptance passed on 2026-10-11; publication remains a separately recorded native operation. Preserve the published v78 HUD and all earlier PRDs. No model, download, network, permission, platform or fee change.

## Existing approved requirement and actual failure

The subtitle-timing Detailed PRD §3 requires staged previews to follow their selected start/end range, and §6 requires actual playback-boundary callback coverage. The current native pause preserves playStart/playEnd, but the last animation frame consumes itself without rescheduling while paused. Native play only changes a label. Its timeupdate listener checks only the end.

An unchanged-source callback reproduction with a consumed Map-backed animation queue proves two failures: preview [1,2] → native pause → consume final frame → native resume at1.3 has no queued checker; the same resume at0.25 plays before the retained start, while2.1 plus timeupdate still stops at the old end. These are program-level reproductions, not physical/browser acceptance.

## Changed clause

PREVIEW-01: native resume within a still-owned bounded preview must re-arm exactly one current checker. Both the animation-frame and timeupdate paths use the same validity/start/end guard. Native pause remains a pause, and no automatic resume is introduced. Once an out-of-range preview is stopped and cleared, a later explicit ordinary play remains ordinary full-media playback, as with the existing end boundary.

Impact is confined to public/subtitle-workbench/main.js playback scheduling and its regressions. Timing edits, JSON/VTT protocols, source hashes, word-alignment qualification, training metrics, recorded HUD and v78 visuals do not change. Hidden/operation/cancel/media-switch ownership guards remain in force; old asynchronous play settlements cannot revive canceled previews.

## Verification

Use the actual production functions/listeners with a RAF queue that removes callbacks before executing them. Test native pause/resume inside range, before start, at/end, lower-bound timeupdate, repeated play events, ordinary full playback, hidden/operation guards and late canceled settlement. Run the existing subtitle/timing tests alongside the new cases. Review and browser-native controls are independent gates; no fixture is called real playback or frame-accurate seeking.

## Candidate evidence

The eight new actual-handler regressions produced four failures on the unchanged baseline and all pass after the correction. The full existing subtitle/timing group plus these cases passes94 tests with zero skips. TypeScript and diff checks pass. Independent review approved the exact source after 94 focused tests and seven additional actual-handler probes. Aggregate checks passed: 1,838 core/scene tests, 823 media tests (one unchanged optional recorded-MediaRecorder fixture skipped), and 93 HUD tests; TypeScript and the actual static-export build passed. These counts are software evidence, not physical-device verification.


## Actual native-control browser acceptance · 2026-10-11

On the exact frozen build, ordinary native controls paused a selected [1,2]-second preview at 1.110879, resumed through 1.236884, and stopped automatically at 2.010498 seconds. A separate native seek inside the range to 1.811387 followed by Play stopped at 2.006987. Before-start and after-end seeks stayed paused; after preview scope was cleared, a later explicit ordinary Play reached the normal five-second media end. Media replacement during an active preview reset the player to zero and paused without a delayed restart. Normal page exit and Back during ordinary playback restored a paused, error-free player. Existing Studio history was preserved.

The normal local chooser used an authored five-second tone and subtitle file, not speech or ASR evidence. No model download was started. Browser scheduling observations do not establish exact event-queue ordering or sample/frame-accurate stopping; observed endpoint overshoot was about 7–11 ms. Physical audio, real phone/touch/IME, camera/microphone, recorded output, background visibility, ASR quality and full offline operation were not verified. See [release verification](release-verification.md).
