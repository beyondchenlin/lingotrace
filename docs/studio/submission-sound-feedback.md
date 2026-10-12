# Submission sound feedback and monitor/recording separation

Baseline: live v54 `9ea23f8c87b4d1b93477dcb76820cc4eb45b0385`, plus documentation-only commit `d788facf91147d3717b0f3ba00fe1ea262b61090`.

## Approved behavior

The explicit live Studio submit handler alone consumes the new Training v1 attempt. `firstCompletion` wins over `errors === 0`; otherwise the cue is correction. Completion means this session's first full completion of that cue, not the end of a course. Existing conditions, grading, attempts and rewards are unchanged. Input, hidden unchecked answers, restoration, event replay, duplicate confirmation and history views produce no new cue. No inference is made from decorative HUD energy.

Submission cues are disabled initially, explicitly enabled in existing settings, and have an independent 0–100% volume. They are locally generated short PCM tones, never speech, an external asset or a model. A 320 ms limiter drops rather than queues extra cues; at most one voice exists. Exact attempt-ID dedupe is memory-only and bounded; reaching its protective limit fails closed with a reload-required message rather than evicting identifiers and replaying them.

All-listening mute controls speaker monitoring only, including the saved-recording preview; it does not rewrite the recorded file. It retains cue/white-noise enable preferences; removing mute does not replay past submissions. Course mute and course volume remain course-monitor controls. The existing course graph is normalized to unity at the media source, with separate pre-monitor recording and monitor gain. Only an explicit gesture resumes a suspended course context. Microphone input has no speaker connection.

Recording inputs are independently and explicitly selected before each recording: course, microphone, submission cues. All selections default off and lock during preparation/recording. Starting a recording does not enable cues. Cue enable/volume can change during recording and affect the selected live cue bus, including any current short tail; they never replay past cues. Recording source choices do not change mid-recording. White noise and standby effects have no digital connection to the recording graph. An enabled physical microphone may capture ambient speaker sound; this design cannot promise acoustic isolation.

## Lifecycle and accessibility

Pause and modal opening cancel current cue tails; a whole-practice pause also turns off white noise. Changing cue/new round cancels tails. Hidden/pagehide/interrupted submission contexts disable cues until another explicit enable, without queued playback. Disable/dispose invalidate pending enable, stop/disconnect voices and release bridges. Recording cleanup is request-owned: stale cleanup cannot detach the next recording. Recording mix-context failure is shown truthfully and never requests microphone permission as a workaround.

Reduced-motion preference disables cue and white-noise audio; returning to normal does not re-enable either. Each control is labeled, volume bounds are enforced, errors remain visible, and existing textual results are available without sound. Main Studio canvas geometry, HUD motion, input box and accepted colors are unchanged; controls stay within existing settings/recording panels.

## Verification contract

Program tests cover actual submit behavior against TrainingEngine, actual settings/hook code, bounded exact dedupe, rate limiting, canceled/late resumes, hidden/pagehide, independent monitoring/recording, shared course source ownership and recording lifecycle. Existing scoring/history/privacy regression suites remain required. Node audio graph fixtures prove program behavior only.

Actual public cloud-browser tests separately exercise gestures, submission results, settings and actual downloaded recordings. Analyze real encoded audio/PCM to distinguish selected cue audio from no-audio recordings and verify muted monitoring does not remove selected source audio. This does not itself prove physical-speaker audibility, microphone behavior or physical-device/browser compatibility. Any background behavior not actually triggered in the cloud browser stays explicitly unverified. No localhost workaround is attempted.

No new storage schema, history migration, recording retention, automatic download, outside transmission, microphone/camera permission or paid service is introduced. The future follow-reading/recorded-speech task chain is outside this batch, so this delivery does not claim every future F03 requirement complete.

## F03 mix interruption follow-up (v73 candidate)

The recording-owned mix must be running after explicit resume; resolving resume alone is not success. Each selected-audio recording owns a statechange listener. A later non-running mix cancels remaining preparation or requests the existing recording cutoff before releasing only that request's inputs. No shared course context is closed or automatically resumed, no source choice or permission is changed, and no previous cue is replayed. Silent recordings do not depend on an old mix context.

Accepted committed, queued and final encoder data drain before the existing incomplete outcome is assigned with AUDIO_MIX_INTERRUPTED. Earlier encoder/storage failures retain precedence. There is no metadata schema migration: the existing status/complete/stopReason fields carry the outcome. UI wording distinguishes known committed bytes from an empty/unconfirmed recording. Request/input/recorder ownership and the stopping-state guard prevent stale events or an interruption after an ordinary cutoff from changing a different recording.

## Renderer-recovery modal cancellation follow-up (source candidate)

The renderer recovery/terminal dialog is an existing native modal and follows the same cue-tail cancellation rule as ordinary panels. Its failure entry synchronously cancels both current submission-cue audio and immediate typing-error sound/motion/haptics before opening the dialog. It retains explicit sound preferences, does not replay the consumed attempt on recovery, and does not disable white noise or change recording source selection. Existing renderer-failure recording cutoff remains in place.

Regression evidence executes the actual failure handler and modal effect with real audio/feedback controllers and tracked native-node fixtures. It covers correction/correct/first-completion tails in both recovering and terminal states, pending explicit enable without delayed playback, and the existing privacy-safe error display. These are source/program checks, not physical audio, encoded recording, or mobile-browser acceptance; this change neither diagnoses the underlying renderer failure nor completes every future F03 requirement.
