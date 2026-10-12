# Native listening whole-practice pause correction

Review candidate based on exact published v76 source `98faf71bd72b09d346e0b89b72fa6a99fc363edc`. No deployment or recording policy change is part of this correction.

## Verified defect and correction

The actual Studio whole-practice pause handler paused only the legacy lesson element. Continuous listening owns a different native video, so its audio could keep playing, or a queued repeat could restart it while practice was paused. The native play method also used the host pause/modal predicate only for observation eligibility, not playback admission.

The host now synchronously pauses both owners. Native-player pause already cancels delayed repeats, invalidates pending play commands, and seals the current observation boundary. Resume changes only practice state and does not start playback.

Native play checks the current host predicate before admission, on a late `playing` event, and after the play promise resolves. Delayed-repeat callbacks and explicit repeat admission also check it before seeking or starting media. Blocked controls preserve existing playback errors and the paused position. These checks do not interpret document visibility alone as a block: the approved continuously observed native-listen background subset remains available; hidden reference text remains absent.

No Training input, submit, scoring, source lease, Web Audio routing, permission, recording option, HUD layout, camera geometry, or mobile keyboard default is changed.

## Scope of evidence

- Five regressions failed against unchanged v76 before the correction: three native-player admission/repeat cases and two extracted actual Studio whole-pause cases. All pass with the correction.
- The Studio pause cases use the real player and Training engine with synthetic media. They preserve the actual draft, attempts and earned words, stop observation accumulation while paused, and do not create microphone/capture/audio-graph resources.
- Two additional extracted Studio recording-start tests inject a resolved or rejected transition promise. They prove capture and the selected legacy course-audio connection wait for that transition; a rejection starts neither capture nor audio. They do not claim that the injected transition performs real persistence.
- The actual Canvas renderer changes pixels for supplied automatic reference text and keys, hides both when requested, and leaves real draft/input/score state unchanged. This is renderer evidence, not encoded-media evidence.
- Six independent synthetic tests cover late promise resolution without `playing`, pause/resume before late resolution or rejection, existing decode error/help preservation, and permitted hidden playback. Independent final review found no blocking issues.

Current v76 recording behavior is intentionally retained: startup awaits `listening.beforeTransition()`, seals/exits B, restores the legacy lesson as scene media, and only then captures the Canvas and attaches explicitly selected audio. Simultaneous B listening and recording is not established by this change.

## Final validation

Against final production/test bytes:

- Full core/scene suite: 1,697 passed, zero failures or skips.
- Full media suite: 793 passed, zero failures, one pre-existing recorded-MediaRecorder-fixture skip.
- TypeScript check passed.
- Next production build/static export passed for Studio, portrait preview, media transport check, and not-found routes. The release assembly/deploy step was not run; tracked `dist` remains unchanged.
- Independent player suite: six passed.
- Git diff whitespace check passed.

The four frozen-v65 compatibility tests require the exact historical source. The test run restored `studio/core` from existing Git object `18eaf70df62231e949a608f976c444c68cf84970` and set `LINGOTRACE_FROZEN_V65_DIR`; the tests themselves verify historical file hashes. Their initial missing-path skips were resolved before final acceptance.

The first parallel aggregate media run produced one failure in the unchanged 5 ms metadata-timeout test (`course-media-verified-direct.test.mjs`, expected one load, observed zero). Its source SHA-256 remained identical to v76. An isolated rerun and subsequent full aggregate runs passed. The original failure log is retained alongside final validation, rather than replaced by an isolated-pass claim.

No physical device, audible playback, camera, microphone, browser capture, encoded recording, or CUA acceptance is claimed. No blocked external source was retried or bypassed.
