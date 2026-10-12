# Whole-practice pause media correction

Baseline: v37 / a60c1297f4a836d2b0cf97c9aec0c49cdd0964b0.
Rollback: redeploy that saved version; no schema migration or deletion is involved.

The v1.4.4 PRD preserves the v1.4.1 action contract (detailed section 8): whole-practice pause freezes input/submission/time, preserves draft/attempt, cuts and saves the current scene recording; resume must not restart capture. v1.4.5 does not alter this contract. Before this patch Studio.pauseTraining only froze practice and paused the lesson video. Recorder.stop already had a first-call logical stoppedAt and an asynchronous final-data/write drain.

| Command / condition | Immediate action | Later completion |
|---|---|---|
| Pause practice | Freeze current engine; pause lesson; invalidate pending recording request; call recorder.stop('练习暂停'); release only that request's composite/mix/mic inputs | Drain encoder final blobs and pending storage writes; preserve first stop time/reason; report complete/incomplete truthfully |
| Pause during permission / AudioContext preparation | Invalidate token and release current owned resources | A late stream is released by its canceled owner; no encoder starts |
| Pause during metadata creation | Mark recorder stop requested and release owned inputs | The pending start observes the stop flag and records incomplete status; it cannot start after resume |
| Resume practice | Remove the manual pause freeze | No video play, capture restart, answer submission, completion or reward |
| Explicit new recording | Allowed only after practice resumes and prior recorder finalizes | Creates a new segment with the existing optional audio choices |
| Repeat stop / late callback | Reuse that segment's stop promise; keep captured ownership identities | No automatic download, duplicate segment or new-session mutation |
| Late composition/input | Reject while paused; reject canceled composition after resume; restore committed draft | A genuine new composition can proceed normally |
| Video-only pause | Existing independent playback behavior | Does not trigger the whole-practice recording cutoff |

Single-utterance recording is absent from this first sample; no such feature or permission has been added. Camera preview and shared course-audio-to-speakers resources are independent and retained. The accepted renderer, geometry, styles, standby animation, scoring reducer, historical events, and isolated Practice repositories are unchanged.

MediaRecorder.stop() inactivates synchronously but queues final gathering/Blob/stop events. After requesting stop, ending owned tracks prevents new source content; tracks are not removed from the MediaStream. Encoder listeners remain installed and accepted/final chunks drain. This defines a logical cutoff, not a promise of zero codec/container tail on every browser. Reference: https://w3c.github.io/mediacapture-record/#dom-mediarecorder-stop

Verification: actual shipped Studio functions are extracted for isolation tests with the real TrainingEngine/SceneRecorder/RecordingInputResources. Only devices, encoder and storage fixtures are simulated. They cover active/backlogged recording, repeated stop, pending permission/metadata, late input/composition, resume, reset/disposal, saved bytes and explicit downloads. No physical camera/microphone permission is requested. Production browser and codec evidence must be listed separately after deployment; simulated composition does not establish native OS IME behavior.

Packaging uses the controlled two-route assembler for /studio/ and /portrait-preview/. All pre-existing public paths outside those routes are hash-checked and retained, including story and HUD library. New content-hashed dependencies may be added, never overwrite another route's existing assets. The preservation manifest records the exact baseline and file hashes.
