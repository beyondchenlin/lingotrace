# LingoTrace Follow typing sentence level beta

## Total PRD draft

Date: 2026-10-11. Delivery status: this separate main-site source candidate retains the Follow requirement and these paired PRDs, but does not include the unaccepted Follow runtime. Follow remains implemented on the separate QA v2 candidate `324c0f7f68cb4d58f2382355d989034306b200e8`; its source and deterministic host tests passed, while successful real-browser NPS Follow playback and trusted typing acceptance remain pending. Current NPS response-body loading failures are not proof that Follow works. The main-site candidate independently carries prominent typing, typing-error feedback, and bounded local media-body diagnostics. No main-site publication or Follow acceptance is claimed. Historical source evidence: `1b46f53195f7a1c86637d72555a972fe1d4a78dd`; Follow host baseline: `55bf7b7d05efca200127151dd8b9aa3bd5499c97`.

## First implementation candidate

An optional “Follow typing · sentence estimate · Beta” control is implemented for reference-visible typing practice. The candidate adjusts the original video's playback speed from genuine committed typing, keep its original audio and picture on the same native media clock, and stop at the current sentence boundary or when typing pauses.

The user's requested destination is media that follows the words being typed and their speed. This first proposal addresses typing pace within a sentence. Exact correspondence between a typed word and its spoken moment remains a separate future requirement. Approving or shipping the sentence-level beta must not mark that larger requirement complete.

## Source evidence and honest limit

The bundled official NPS VTT contains 21 intervals: one empty opening interval and 20 non-empty caption intervals. The existing material merges these into 11 sentence cues by punctuation. Its provenance explicitly says the timings were not independently acoustically aligned; the last endpoint was clamped from 43.960 to 43.366 seconds. Neither asset supplies reliable word timestamps. See the [detailed evidence and source index](PRD-detailed.md#source-evidence-and-qualification).

A sentence's text length divided by its duration can supply an estimated pace target. It cannot locate individual spoken words, prove acoustic word boundaries, or make uniform text interpolation into word-level synchronization.

## Scope

- A new, optional, off-by-default playback mode, initially restricted to the verified NPS material, current shown-reference typing cue, and a foreground active editor.
- One explicit “Start Follow” gesture in ordinary legacy typing (no active ListeningPlayer) authorizes current-cue playback and the described idle/resume behavior. Reload, new cue, source change, reference hiding and lifecycle interruptions require another explicit start.
- Original audio and video remain in the same native media element. Only bounded, smoothed positive playback-rate changes and conservative pauses are introduced. No new audio source, synthesis, stretching pipeline, re-encoding, frame generation or media-byte changes.
- Genuine committed append input provides a temporary pace estimate. IME preedit, paste, deletion, mid-draft edits, undo/redo, replacement/autofill and replayed or programmatic input never manufacture typing speed. Unknown input provenance falls back to ordinary manual playback.
- Stop at the sentence boundary even if the learner is still typing. Do not skip unheard media, seek to a character, auto-check an answer, auto-complete or advance the lesson. The learner retains Replay, Check and Next.
- Manual pause, seek, replay, speed selection or ordinary Play takes control back. Typing cannot silently reactivate Follow afterward.

## Existing behavior preserved

Ordinary typing and hidden-reference dictation keep their current default behavior. Hide reference disarms Follow before target-dependent control or presentation can continue. Normal listening, history/review, subtitle preview and other media owners remain separate.

Follow produces no automatic Training input events, attempts, scores, rewards, earned-word changes, automatic listening-observation records, schema changes or history rewrites. From initially paused practice, control-only start, idle, resume and end preserve the training snapshot and fixed-time exports. Starting while ordinary playback already owns the listening freeze first performs the same freeze/idle transition as the existing explicit Pause action; that ordinary handoff is not claimed to be snapshot-neutral. No additional timing events come from Follow timers or native play/pause callbacks. Real user edits and explicit Check/Next continue through their existing paths. Temporary controller data stays in memory and does not enter saved records or exports.

Follow is unavailable during recording preparation, recording and stopping. Starting recording first exits Follow and restores the prior ordinary playback setting while paused, then runs the existing recording flow. F03 audio selection/mixing, microphone/camera ownership, recording permissions and cleanup remain unchanged. Actual hardware and encoded-output verification are still outstanding.

## Separate the repair from the feature

The current media/cue playback defect must be fixed and verified against the existing approved behavior, independently of this proposal. It must not be hidden by changing playback semantics or enabling this beta. A passing repair does not establish the new feature; approving the new feature does not establish a repaired or word-aligned source.

## Required acceptance

1. The control and explanation consistently say “sentence-level” and “Beta” in English and Simplified Chinese; default is off with no automatic startup or sound.
2. The original audio and picture share one native clock through every change; no separate audio playback or per-character seeking occurs.
3. Proposed rate bounds are 0.50–1.50×, with 0.80× warm-up, at most five control updates per second and gradual changes. These are candidate tuning values, not validated optimal settings.
4. Idle, sentence-end, composition, focus/lifecycle, manual override, native errors and stale asynchronous playback all stop or relinquish control as defined in the detailed PRD.
5. Hidden-reference noninterference, unchanged scores/history/exports, source ownership and unchanged F03 boundaries pass focused and aggregate regressions.
6. Native browser QA verifies actual seeking, rate changes, pause/resume and single-source behavior. Boundary overshoot and device/browser limits are reported honestly; no sample-accurate, word-accurate, human-audible or physical-device claim is inferred from fixtures.
7. Implementation, independent review, exact-build verification and any release/publication require separate decisions and receipts. This document does not authorize publishing.

## Open decisions

- Whether the sentence-level beta is a useful first step for the user's intended word-following experience.
- Final tuning after human listening/typing trials, particularly very short sentences and learners slower than the minimum rate.
- The separately scoped source, accuracy, privacy, processing and review requirements for future real word timing.

The companion [detailed PRD](PRD-detailed.md) defines eligibility, ownership, temporary input estimates, transitions and acceptance cases.

## Candidate verification, 2026-10-11

The pure policy has 109 passing deterministic tests and independent read-only review. The separate input adapter, native host and actual extracted Studio handlers have another 100 passing focused tests (17 input, 34 host, 49 Studio). These tests use synthetic media/input events and authored asynchronous event queues; they do not establish browser audio, device output or acoustic synchronization. Independent host review is clear. The final core/scene aggregate passes 2,109/2,109 with the frozen-source archive enabled; the media aggregate passes 823/824 with one existing actual-MediaRecorder-fixture skip and no failures. Final no-incremental TypeScript checking passes.

The default-off entry stays inside the existing Typing & display popover, so an unused Follow control adds no exterior bar to the accepted page. After explicit opt-in, a separate DOM status/control may show the actual rate and waiting state; it is excluded from recorded canvas output. The opt-in layout still needs real browser checks.

The first candidate is restricted to the verified NPS ordinary typing path. Active ListeningPlayer in either mode, hidden reference, recording, source/loading failures and passive restoration block it. A genuine edit can activate a restored practice, after which another explicit Start is allowed. Native seekable ranges are checked before the one initial cue-start seek.

Exact production build and browser/audio acceptance remain pending. The separate live-letter/media-owner release does not include Follow; this candidate has not been published.
