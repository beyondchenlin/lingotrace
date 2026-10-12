# LingoTrace Follow typing sentence level beta

## Detailed PRD draft

Date: 2026-10-11. Delivery status: this separate main-site source candidate retains the Follow requirement and these paired PRDs, but does not include the unaccepted Follow runtime. Follow remains implemented on the separate QA v2 candidate `324c0f7f68cb4d58f2382355d989034306b200e8`; its source and deterministic host tests passed, while successful real-browser NPS Follow playback and trusted typing acceptance remain pending. Current NPS response-body loading failures are not proof that Follow works. The main-site candidate independently carries prominent typing, typing-error feedback, and bounded local media-body diagnostics. No main-site publication or Follow acceptance is claimed. Historical source evidence: `1b46f53195f7a1c86637d72555a972fe1d4a78dd`; Follow host baseline: `55bf7b7d05efca200127151dd8b9aa3bd5499c97`.

This proposal adds optional pace-following within one shown sentence. It does not replace the current playback repair, change default dictation, certify NPS word timing, or claim a working product or native playback verification. Existing PRDs and their incomplete requirements remain in place.

## Source evidence and qualification

The following facts were read from the baseline's actual files, without changing them:

- `public/studio-assets/nps-connie/connie-lau-education-ranger.en.vtt`: 21 timing intervals, including one empty 0.000–0.770 opening interval; 20 intervals have caption text.
- `public/studio-assets/nps-connie/sentences.json`: 11 sentence rows merged by punctuation. It explicitly states that the official boundaries are not independently acoustically aligned. Only the terminal endpoint is clamped from 43.960 to 43.366 seconds.
- `studio/core/builtin-material.ts`: the same 11 cue texts/ranges are bound to the NPS material, official captions, sentence-map digest and original media identity. Original media reference duration is 43.366667 seconds.
- The source pack does not contain qualified per-word onset/offset times. The first sentence, 0.770–1.530, lasts only 0.760 seconds. Several other sentences last less than three seconds. Some may finish before a reliable fresh typing-rate estimate exists.

A sentence-level nominal rate includes punctuation, spacing and any silence inside the caption-derived interval. It is an approximate text pace, not a measured speech rate. Reference-display interpolation, matching typed text, playback percentage or a word counter cannot upgrade these sources to acoustic word alignment.

Primary provenance is retained in the source pack's `SOURCE-AND-RIGHTS.md` and `manifest.json`. Its existing official [NPS item page](https://www.nps.gov/media/video/view.htm?id=7FE78A9F-1C89-4CDE-9BFD-DD0D0E4DE2CB) and [caption URL](https://www.nps.gov/nps-audiovideo/closed-caption/7E7A533E-9794-282E-6B1CBB4348556B45.vtt) identify the published source; this design does not assert a fresh external retrieval or acoustic review.

## Relationship to the current repair

REPAIR-01: reproduce and fix the current playback/cue mismatch against the pre-existing playback contract. Record its own failing reproduction, corrected behavior, scope, tests and verification limits. This design does not assert that the precise defect or cause has already been established.

FOLLOW-01: the beta changes playback control deliberately and therefore needs its own design decision, implementation review and acceptance. Keep its source change, tests and release claims distinguishable from REPAIR-01. The repair must work with Follow off. No retiming or media substitution may be smuggled in as a controller change.

## Entry and eligibility

FOLLOW-02: render an off-by-default “Follow typing · sentence estimate · Beta” control in the existing Typing & display popover, without moving the accepted HUD anchors. The exterior status/control appears only after explicit opt-in; its layout requires browser acceptance. English remains the canonical default; add equivalent Simplified Chinese copy through the existing shared dictionaries. Do not infer preference from browser locale or save an active Follow state across reloads.

Before entry, require all of the following:

1. The ordinary typing mode owns the active, verified NPS media and current registered sentence cue.
2. The current reference is already visibly shown through the existing genuine exposure path. Follow must not reveal the answer or change Show/Hide by itself.
3. The native media has finite duration and a playable current range with validated start/end. Existing source/lease/hash/transport qualification remains authoritative; no new URL fallback is allowed.
4. The page is visible and the practice is active, with no history/read-only view, review/check operation, modal blocker, source transition, restore failure or disposal.
5. No listening-mode player, subtitle preview or another controller owns playback. No recording is starting, recording or stopping.
6. The native editor can supply genuine committed-input provenance. Unknown or unsupported input behavior does not activate adaptive control.

Disabled copy must name the actionable prerequisite, such as “Show reference to use Follow typing” or “Follow typing is unavailable while recording.” Hidden mode shows no answer length, target pace, word count, cue-derived geometry or derived adaptive rate.

FOLLOW-03: “Start Follow” is an explicit user gesture with nearby copy stating: “Adjusts video and its original audio to your typing pace within this sentence. Pauses when you stop typing. Sentence-level estimate; words may not line up exactly.” Also state that playback is bounded to this sentence. Enabling a checkbox, loading a setting or rendering a saved page is insufficient to start sound.

The gesture pauses ordinary playback, cancels its current repeat/boundary owner, snapshots the previous ordinary manual rate, validates the new ownership epoch, positions once at the current cue's start, and requests playback at the warm-up rate. Do not restore an old repeat automatically when Follow ends. If playback is rejected or the seek/range cannot be established, remain paused and require another explicit Start Follow; no retry loop or alternative audio source.

## One source and one clock

FOLLOW-04: the active native lesson media element is the only owner of original-source audio/video time. Set its positive `playbackRate`; retain its existing approved audio routing, monitor/mute behavior and picture aspect/size. Native pitch preservation, when available, should remain enabled; report unsupported or audibly poor behavior rather than replacing the audio pipeline.

Do not introduce a second audio element, audio-buffer resynthesis, voice generation, server processing, time-stretch library, re-encoding, track duplication, a fabricated silent fallback, or source-byte changes. Existing explicitly selected monitor/recording routes are not new authorization for mixing.

The allowed time repositioning is the one explicit Start Follow seek and later explicit manual Replay/seek actions. The pace controller never writes `currentTime` for a character, matched word, catch-up correction, timer tick or rate update. Stopping near an endpoint is a native-browser scheduling operation, not sample/frame-accurate editing.

## Temporary typing pace

FOLLOW-05: derive a temporary committed-grapheme throughput from the same native input-provenance boundary used by real typing. Do not feed the controller by replaying history, synthetic key events, passive keyboard animation, energy/achievement counters or reference-prefix correctness. It may subscribe to existing committed-input notifications read-only; it must not emit new Training events or change existing CPM definitions. The host’s broad input-visibility callback is not proof of qualifying append input: the baseline also calls it for paste, deletion and middle edits.

Eligible input is an observed direct committed append at the end of the current draft, including a final IME commit exactly once. Mid-draft insertion is excluded from adaptive speed even when it is a genuine user edit. Use the product's existing Unicode grapheme segmentation consistently for both inserted text and the shown sentence. Do not introduce an English-only physical-key count or treat an IME selection as many keystrokes.

Exclude paste/drop, deletion, cut, undo/redo, mid-draft insertion, selection replacement, autofill/autocorrect/replacement-text operations, programmatic edits, history restore, composition preedit, canceled composition and events whose actual committed insertion cannot be established. These edits continue normally in the native editor and keep their existing learning semantics. A paste, mid-draft edit or replacement does not cause seek, play, speed-up or completion; if it changes the draft while Follow is running, pause and return to explicit Start Follow so resumed control cannot be mistaken for following pasted text. Simple deletion pauses adaptive playback and requires explicit resume; it never runs media backward. Unknown provenance exits adaptive control visibly.

No answer-comparison step is needed for pace. Wrong manually typed letters count as committed activity for this temporary control exactly as real corrections do; they earn no credit until the existing explicit Check. A fast incorrect draft must not trigger a jump, success state or automatic Next. The existing scorer remains the authority for checked differences and learning outcomes.

### Proposed estimator and tuning constants

These constants make an initial implementation testable. They remain draft choices until human typing/listening trials validate them.

- Warm-up rate: 0.80×.
- Adaptive range: 0.50–1.50×.
- Update interval: no more often than every 200 ms of monotonic time.
- Input sample window: at most the last 3 seconds within the current source/cue/Follow ownership segment.
- Qualification: at least 1 second of observable coverage and two distinct eligible commits separated by at least 250 ms. Before qualification, retain the warm-up rate. A single large IME commit cannot by itself qualify a new segment.
- Idle threshold: 1.5 seconds since the last eligible committed insertion, or since Start Follow when no insertion has arrived. Long observation gaps, backward time or an unobserved interval invalidate the estimate.
- Rate change limit: at most 0.25 rate units per wall-clock second; only apply a change when its magnitude is at least 0.02. Integrate smoothing from real elapsed monotonic time with a bounded interval, never a long suspended-tab catch-up.

For a valid shown sentence, let N be its grapheme count and D its validated end minus start in seconds. The nominal sentence pace is N / D. Let R be eligible inserted graphemes divided by the observed duration of the current trailing window. The target rate is R / (N / D), clamped to 0.50–1.50×, then smoothed as above. Reject zero/invalid N, invalid D and non-finite values. Read back the actual native rate for display and scheduling; never display an unapplied target as current speed.

Example using an authored test fixture: N = 60, D = 6, so nominal pace is 10 graphemes/second. Observed input of 5 graphemes/second requests 0.50×; 10 requests 1.00×; 20 is capped at 1.50×. The smoothing limit still applies. This example establishes controller arithmetic only, not NPS speech timing or a promise that typed and spoken words match.

Do not use matched-prefix length divided by target length to seek or estimate an exact spoken word. Do not display this temporary estimate as WPM, CPM, fluency, attention, comprehension, accuracy or a durable achievement. The UI may show only actual media speed and the current control state.

## Pauses and control ownership

FOLLOW-06: own-idle pause preserves the current media position and armed current-cue scope, clears the stale speed estimate, and shows “Paused for typing.” A new eligible committed insertion can resume from the same position at warm-up speed under that still-active scope. No seek occurs. Resume must use a current-scope guarded native play request, not a generic player Play method that may replay at the sentence end. Recheck the endpoint before requesting play and after its promise settles. A renewed browser play denial ends the scope and presents explicit Start Follow. User focus loss, manual pause, lifecycle interruption or a different owner is never treated as an idle pause.

IME composition starts a conservative media pause without counting or revealing preedit. The composition's final genuine commit is admitted once and may resume only if the same ownership epoch remains eligible. Canceled composition does not resume. A single commit after a long composition returns to warm-up until the fresh estimator qualifies. This is committed-input throughput, not a claim to observe each physical IME keystroke.

FOLLOW-07: at the current sentence end, pause and end the Follow scope. Typing after this cannot restart playback or move to the next sentence. Show “Sentence ended. Replay or check when ready.” Even when typing appears finished before the audio, play through only until the approved boundary or another pause condition; never jump to the end or infer successful completion.

Use a current-owner boundary checker during active playback, re-evaluated after accepted rate changes and native play events, with native time events as a secondary guard. Validate both lower and upper bounds and the actual current source on every admission path. An out-of-range native position pauses and disarms without silently seeking back. Browser QA must record observed boundary overshoot; no fixed sample-accurate guarantee is made. A material spill into the following sentence blocks beta release on that tested path. The caption-derived endpoint itself may cut a speech tail or include neighboring speech even when the controller meets its time bound; acoustic review must distinguish source-boundary quality from controller overshoot. Do not silently retime the original material to make the test pass.

FOLLOW-08: explicit user controls always win:

- Manual Pause immediately pauses and disarms Follow. Later typing cannot restart it.
- Manual Play, Replay or seek cancels Follow first and uses the ordinary explicit command. Restore the saved ordinary rate only if the controller still owns the old adaptive write; never undo the new manual command.
- Manual speed selection cancels Follow and applies exactly the user's selected speed, including rates outside the beta range. Do not overwrite it with a saved value.
- Check, Next, cue/source change, Hide reference, entering listening/history/review, practice pause, blur, visibility loss, pagehide, unmount, recording start and errors cancel the scope and its timers/pending play permission. They do not automatically re-arm on return.
- Source change or a newer playback owner revokes the old controller's right to write pause/rate/position at all. Cleanup must not pause or retune a newer source.
- Turning Follow off while it still owns playback leaves media paused and restores the prior ordinary rate. It does not resume sound.

Native `ratechange`, `pause`, `seeking`, `playing` and asynchronous play settlement must be attributed to the current explicit controller command or treated conservatively as outside/manual control. Do not rely on a single unscoped Boolean that can mistake a late event for current authority. Unattributable events relinquish adaptive control. Rate writes should carry generation/expected-value ownership so a late expected event cannot override an intervening manual action.

Every asynchronous play resolution/rejection and scheduled boundary callback rechecks source identity, cue, owner generation, shown-reference state, document visibility, practice blockers and recording state. Stale success cannot make media audible or disarm/retune a newer owner. Fail closed to a paused, explicit manual action; do not silently switch source or fabricate successful playback.

## Privacy history and recording boundaries

FOLLOW-09: the controller is temporary playback state with no repository, scoring, review-task, history-writer or export capability. Do not add stored fields or migrations. Retain only bounded recent input counts/timestamps and necessary current owner/rate state in memory; do not keep raw additional keystroke/text logs. Clear these on scope end and every privacy/lifecycle boundary.

Ordinary genuine edits and explicit checks still create whatever the existing user-approved input/history paths already create. Starting Follow from already-playing ordinary media first releases that existing listening freeze and enters idle exactly as the existing explicit Pause action would. This one handoff is not byte-neutral; no added Follow timing/input/attempt events are permitted. Starting from an already-paused practice has no such handoff, and control-only execution must preserve its entire training snapshot and fixed-time exports. The beta adds no automatic input, attempt, submit, learning timer, completion, reward or listening observation. It never turns media progress into typed progress, earned words, active practice time or listening credit. Existing metrics may change only from the same genuine actions and their established rules.

FOLLOW-10: Hide reference must synchronously revoke Follow before hidden rendering, scrub target-derived transient pace/labels/geometry and restore paused ordinary playback. Starting from an already hidden page does not read hidden reference length for this feature. Differential tests with different hidden target texts must yield identical feature UI and automatic control behavior for the same external actions. Follow does not auto-show the answer or weaken existing assisted-exposure attribution.

FOLLOW-11: F03 recording is an explicit exclusion. Follow cannot arm while recording is preparing, running or stopping. Recording start cancels Follow and restores ordinary paused playback before the existing capture/audio-attachment workflow proceeds. No mixed-audio implementation, microphone/camera selection, permission change, audio graph, track ownership, encoded output or simultaneous listening-and-recording feature is introduced. Do not route this beta through the listening player merely to reuse its rate API: that API has fixed rate choices and its rate changes seal observation boundaries. Any future integration with that player would require a separate observation-integrity design and tests. Ending recording does not auto-resume Follow. Existing recording tests and known limitations remain mandatory regression evidence; real hardware and audible/encoded-output quality are unverified until separately exercised.

## User interface and accessibility

Use existing control styling and minimum touch targets, shared language keys, native focus and editor semantics. Do not capture Space, Enter or arrow keys while the native editor owns them. No timer, rate update or media event moves focus, the caret or reference text. The explicit Start Follow action may focus the native input once with preventScroll as a direct entry action; pointer and keyboard activation must both work. This is not a stale focused-state override: an actual later blur disarms.

State copy should distinguish Off, Starting, Following at actual rate, Paused for typing, Sentence ended, Manual control and Unavailable/error. Explain the reason for any required restart. Announce state changes sparingly; do not make assistive technology speak every character or rate tick. Reduced motion removes animated decoration without changing core playback control.

The beta name, help and status must never say “word-synced,” “exact synchronization,” “speech detected” or “AI aligned.” Reuse existing error details rather than replacing a native/source problem with a success state. Short-sentence warm-up and slow-typing limits must remain discoverable in help.

## Acceptance matrix

All cases below are requirements, not results. Fixtures must be labeled as such; actual browser and physical-device observations must be recorded separately.

### A Source and arithmetic

- A01: off on first load, reload, restored session and each new cue; no play call, new input event, permission, network request or source fetch caused solely by the feature.
- A02: NPS identity and validated 11-cue map only; unknown/stale/altered source, invalid/zero range, non-finite duration and missing reference fail closed. Keep the existing terminal-boundary tolerance; do not extend cues.
- A03: the 60-grapheme/6-second fixture requests 0.50×, 1.00× and capped 1.50× for R = 5, 10 and 20. Test both bounds, warm-up, minimum samples, deadband, update cap and maximum rate slope.
- A04: no typed letter, word completion or control tick writes currentTime. Compare unchanged original-source audio/video asset hashes and source ownership before and after.
- A05: very short NPS cue 1 may remain at warm-up and end before adaptation. Show ordinary sentence-end behavior; do not manufacture prior pace, word timing or extra media.

### B Input integrity

- B01: direct committed Unicode graphemes produce temporary rate samples; wrong text has no automatic score effect. Selection/caret editing stays native.
- B02: composition start pauses; preedit contributes zero; final commit is admitted once despite a following duplicate input event; cancellation does not resume. Distinguish synthetic composition tests from actual platform IME.
- B03: paste/drop, replacement, autofill, delete, undo/redo, programmatic input and restored draft produce no synthetic speed. Test the pause/restart behavior and unchanged draft/learning provenance for each.
- B04: long IME sessions, multi-grapheme commit, no commits, repeated keys and unknown input metadata cannot create non-finite, unbounded or falsely word-aligned behavior.
- B05: cue change, visibility/focus loss, backward monotonic time and long unobserved gap clear observations; returning does not reuse or backfill a prior rate.

### C Native playback and races

- C01: Start Follow seeks once to cue start and requests playback only from the explicit gesture. Original audio/video remain one element; actual native speed is the displayed speed.
- C02: own-idle pause occurs after 1.5 seconds without eligible input; eligible resumed typing can play from the held position only under the same armed epoch. No repeated auto-play retries.
- C03: sentence-end stops and disarms; later input does not replay or advance. Check/Next remain explicit. Record real endpoint overshoot at 0.50×, 0.80×, 1.00× and 1.50×.
- C04: manual pause, seek, speed and replay immediately take precedence. Late rate events and stale play settlement cannot restore adaptive control or overwrite the selected manual speed.
- C05: pause/idle/resume races, rapid repeated Start/Stop, hidden during pending play, source/cue replacement, media error, native range escape, mode switch and disposal leave no active stale checker or audible restart.
- C06: browser rejected/clamped/unsupported rate and failed play remain truthful and manually recoverable. No synthetic/re-encoded audio workaround. Unknown native events relinquish control.

### D Existing contracts

- D01: with Follow off, repair regressions and ordinary practice/listening/hidden dictation behave as before.
- D02: different hidden targets produce identical feature pixels/accessibility/state/control outputs under equivalent actions. Show/Hide and assisted-exposure evidence retain existing semantics.
- D03: compare real input events, attempts, earned words, rewards, metric rules, stored snapshots and JSON/CSV exports with control-only activity versus no controller. No new automatic events or schema fields. Ordinary real user actions retain their existing effects.
- D04: restoring/history/replay never re-arms; no repository writes arise from timers, rate changes, media progress or idle pauses.
- D05: recording start disarms Follow before existing capture preflight, including late play callbacks. Recording preparation, running and stopping block entry. F03 source/audio choices and cleanup remain byte/behavior-compatible; camera/microphone are not requested for this feature.
- D06: reference-visible layout, English/Chinese text, narrow portrait, Inside/Below keyboard placement, native caret/IME and accessible focus remain usable without changing accepted HUD geometry.

### E Release evidence

Require focused actual-handler tests, existing aggregate core/media/HUD tests, type checking, exact production build, independent review and real browser checks against that exact candidate. Use existing repository commands and frozen-source fixtures where required. Preserve failed runs, skips and untested conditions in the report.

Actual browser checks must exercise real native playback with the original verified source when accessible and report source restrictions without bypassing them. Decoded video frames or synthetic sound fixtures alone cannot certify human-audible original speech, device output or audio/video perceptual synchronization. Physical mobile keyboard, real IME, pitch quality, headphones/speakers and hardware recording remain separately labeled until tested. No publication or user acceptance is inferred from successful automated checks.

## Future word aligned mode

A future exact-word design needs source-bound word onset/offset evidence, a declared quality/confidence model, handling of silence/punctuation/overlap, mapping from corrected transcript tokens to immutable media, and human acoustic verification for representative difficult boundaries. Existing timing/text edits must invalidate affected alignment until requalified; sentence interpolation cannot fill missing word times.

That work also needs a clear word-following policy for mistakes, backspaces, repeated words, reordered text, paste, IME and arbitrary seeks. Forced alignment or other processing requires separately chosen technology, privacy/data-transfer boundaries, cost and source rights where relevant. No model download, upload, API use or retiming is authorized by this draft.

Even qualified word timestamps do not make variable-speed playback sample-accurate or guarantee exact speech/caret lockstep. Define measurable tolerance and test it before any such claim. Keep the sentence beta honestly labeled until that separate capability is qualified.

## Repository source index

All paths below are relative to the inspected baseline, and are evidence or retained contracts rather than files changed by this proposal:

- `public/studio-assets/nps-connie/connie-lau-education-ranger.en.vtt`
- `public/studio-assets/nps-connie/sentences.json`
- `public/studio-assets/nps-connie/manifest.json`
- `public/studio-assets/nps-connie/SOURCE-AND-RIGHTS.md`
- `studio/core/builtin-material.ts`
- `studio/components/Studio.tsx`
- `studio/media/listening-player.ts`
- `docs/studio/ime-cpm-v39.md`
- `docs/studio/listening-cadence-PRD-detail.md`
- `docs/studio/listening-whole-practice-pause-v76.md`
- `docs/studio/centered-english-hud/PRD-total-v80.md`
- `docs/studio/centered-english-hud/PRD-detailed-v80.md`
- `docs/studio/subtitle-preview-resume/PRD-detailed.md`
- `docs/studio/RECORDING.md`

Preparing the original design pair changed no production source, bundled media, existing PRD, saved record or deployment. The later separate candidate adds the policy, input adapter, native host, optional Studio UI and tests; no bundled media, recording pipeline, saved schema or deployment is changed.

## Current policy and host-candidate evidence

`studio/core/typing-follow-policy.ts` and its companion test remain a pure deterministic controller. They are now imported only by this separate Follow candidate, not by the v80 or consolidated letter/media release. 109 focused tests and TypeScript pass. Independent review reproduced and then verified fixes for unexpected native-rate readback under an old write token, unobserved draft-revision changes, and duplicate revision notifications. The policy stores counts/times and exact source/cue ownership only; raw input text is not retained. It can emit a one-time start-cue intent, conditional native rate/pause/resume/restoration intents, and no grading or repository action.

The original independently reviewed policy logic is unchanged; its obsolete “unwired” comment was corrected when integrating this candidate. Current policy SHA-256: `db6510d6cbb01c7f84c739706b1b9c3e1f93c7aed77d2a0512288a759b212850`. Reviewed tests SHA-256: `1ee158fb62cb63debf69219f1d7d9cd0243e5df607a3ddae36b1337dde45eff6`.

The host candidate adds 100 passing focused deterministic tests: 17 genuine-input adapter cases, 34 native-host cases and 49 actual extracted Studio-handler cases. Covered edges include failed/clamped rate writes, guarded prior-rate restoration, unavailable native seek ranges, synchronous ordinary-play pause before asynchronous admission, delayed native play/pause/rate/seek events, rejected native play versus an aborted play that queued an event, newer ordinary/Follow ownership, source change, manual Pause through editor blur, IME final-commit deduplication, passive-restored gating, hidden-reference differential UI, recording-start cancellation and one-time explicit editor focus.

Snapshot/export neutrality is checked from initially paused practice. The already-playing ordinary handoff is separately compared against the existing explicit Pause delta. Neither case permits automatic input, attempts, scoring or new Follow timer/history events. Final independent host review is clear. Bounded core/scene tests pass 2,109/2,109 with the frozen-source archive enabled; media tests pass 823/824 with one pre-existing actual-MediaRecorder-fixture skip. Final no-incremental TypeScript checking passes. This is automated candidate evidence, not browser/audio acceptance.

The UI uses the existing Typing & display entry while off. Only explicit opt-in renders the external status/control, whose actual native-rate display stays separate from fixed manual-rate choices and from recorded canvas output. Its active/ended layout, real native event scheduling, endpoint overshoot, original speech/pitch quality and device interaction still require exact-build browser testing. Prior candidate 8443568 completed its production build after correcting temporary-build-directory module resolution to the same locked dependency tree. Its unchanged source assets and all frozen artifact hashes were verified. The later prerequisite-message-only refinement awaits a new isolated build because workspace disk headroom is low.

A passing reducer or authored event queue is not evidence of browser audio, native boundary precision or a delivered Follow feature. The candidate remains on the separate `55bf7b7` lineage and has not been published.


## Released-baseline integration

The candidate now sits on released source `55bf7b7d05efca200127151dd8b9aa3bd5499c97`. It retains the exact bounded/cached live-letter projection from `d74f0c4`, the current-frame listening snapshot reuse from `9cd54e2`, and both v81 requirement documents from `55bf7b7`. Full Follow Studio integration was checked byte-for-byte against the preserved candidate with only those two released navigation edits applied. The new Follow feature is not part of that release.


## Verification run notes

Current focused coverage totals 209 Follow tests (109 policy, 17 input, 34 host and 49 actual Studio handlers), plus 7 locale tests: 216/216 pass. Independent review reran 88 focused host/input/Studio and existing media-ownership/retry cases, with no remaining concrete blocker in that reviewed scope. Delayed background events retain bounded, source-scoped issued tickets; failed no-start requests and native source-load resets invalidate tickets explicitly rather than guessing event provenance from elapsed time.

Earlier default-concurrency aggregate attempts included fixture adaptation errors and a whole NPS media-test process failure; isolated reruns passed. After rebasing, sparse checkout removed the manually materialized public directory, producing asset/font ENOENT failures in one aggregate attempt. No product fallback was added. All 54 public files were rematerialized from the unchanged source pack and checked against the exact released Git blobs before the final successful aggregate. The failed attempts remain in the task evidence and are not described as successful runs.

Final aggregate command uses the existing frozen-v65 archive and test concurrency 2:

```sh
LINGOTRACE_FROZEN_V65_DIR="$FROZEN_V65_DIR" node --import tsx --test --test-concurrency=2 studio/core/*.test.ts studio/scene/*.test.ts
node --experimental-strip-types --test --test-concurrency=2 studio/media/*.test.mjs
```

The one media skip remains an existing browser-produced MediaRecorder fixture requirement; passing deterministic recording regressions does not verify camera, microphone, speaker/headphone or encoded-output behavior.


## Browser-discovered prerequisite-message correction

The real 8443568 UI correctly disabled Follow for the café course and kept the default-off exterior bar absent, but its Typing & display popover gave no visible current prerequisite or accessibility description. The render-only correction adds English/Chinese current reasons for recording, the active listening player, unsupported course, hidden/unshown reference, paused/restored practice, read-only mode and loading. The disabled button references a unique visible description with `aria-describedby`; no default-off exterior bar is introduced.

Concrete review/replay/layout/editing blockers take precedence over an explicit Hide state, while source-loading-only read-only state retains its loading guidance. Bilingual combined-state and hidden-target-equality tests cover this distinction. Independent re-review passed 107 focused checks, including all ten concrete read-only origins without accessing a hidden target. Native host, policy, input adapter and the eligibility predicate are unchanged. This correction still needs verification on its own new browser build; no real NPS playback or word synchronization is inferred from café gating checks.
