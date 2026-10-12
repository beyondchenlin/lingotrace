# LingoTrace decision record

Record date: 2026-10-12 (UTC). This is a project-context summary of the preserved product documents and frozen source, not a transcript. “Current” below means the contract for the latest frozen candidate, unless a published version is named explicitly. Existing original PRDs and the main README remain unchanged.

## D01. Keep facts, derived views and decoration separate

**Retained foundation.** Actual committed native input and the existing Training engine are the answer/result sources. Canvas motion, reference-follow text, virtual keys, listening cadence and standby numbers cannot create typed input, attempts, earned words or learning evidence. Explicit Check remains the scorer entry. Scores are local deterministic comparison results, not AI judgments or English ability grades.

A repeat Check cannot award the same result again. Old attempts, first-answer conditions, reference exposure, paste/IME provenance and versioned scoring remain historical facts. New displays must read those facts rather than create parallel scoring state.

**Sources:** `docs/studio/BASELINE.md`, `DATA-CONTRACT.md`; `studio/core/training.ts`; execution-calibrated v1.4.8 F01/F02/F12.

## D02. Fixed pace is the latest primary training direction

**Latest confirmed direction, implemented only in the unpublished candidate.** The goal is actual typing at the video's chosen audio pace. Fixed 1× is the default for eligible fresh practice; 0.5×, 0.8×, 1×, 1.25× and 1.5× are explicit alternatives. Input speed, mistakes and idle time cannot change fixed playback speed. The original material's 1× is a rate condition, not a difficulty or skill level.

Earlier v85 explicit Follow and v93 trusted-typing auto-entry were adaptive. They are not described retroactively as fixed pace. The candidate keeps adaptive Follow as deliberately selected assistance, with its existing 0.8× start, bounded 0.5–1.5× behavior and idle coasting. No automatic adaptive fallback is allowed when a fixed exercise is difficult or playback fails.

**Sources:** paired `docs/studio/fixedpace-calibration/` PRDs; `typing-follow-policy.ts`; `Studio.tsx`; historical paired `mobile-width-follow/` and `typing-autoentry/` PRDs.

## D03. Automatic entry remains narrow and revocable

**Retained v93 interaction model, routed to fixed pace by the candidate.** A qualifying trusted tail append can consume one opportunity to start a fresh eligible sentence. The native play request and audio-resume request stay in the eligible user-gesture chain. Draft entry does not wait for media or storage promises.

Loading, restoring, focusing, returning to the foreground and showing the reference do not start audio. A manual stop, failed first admission or used opportunity must not turn later characters into repeated playback attempts. Explicit Start/retry remains the user's way back in. Automatic start is not automatic Check or Next.

**Sources:** paired `typing-autoentry/` PRDs; `typing-follow-input.ts`, `typing-follow-policy.ts`, `Studio.tsx`.

## D04. Source and playback ownership are hard boundaries

**Retained safety/consistency contract.** One verified native media element provides sound, picture, time and actual rate. Admission uses the registered material/reference/media identities, actual digest and finite valid duration. Scoped source/cue/owner/epoch/command identities prevent a delayed event from pausing or changing a newer owner.

Fixed/adaptive training currently admits only the verified original NPS material with reference visibly shown, active editable foreground input and no conflicting owner or recording. Café, corrections, arbitrary local files, hidden dictation, separate ListeningPlayer, replay and read-only history do not gain this new control path merely because they can display video.

Do not loosen identity checks or substitute another material to make a failed path look successful. Rate settings must be read back from the native element before claiming they took effect. User manual control and recording handover take priority over preserving a measurement.

**Sources:** fixed-pace and media-playback-ownership PRDs; `typing-follow-policy.ts`, `studio/media/typing-follow-host.ts`; NPS v66–v71 records.

## D05. The new finish difference is temporary, signed and conservative

**Bounded candidate addition.** The only new timing result is:

`final trusted append time − observed registered sentence-end time`

A negative value means the final append happened earlier; a positive value means later. It requires a new attributable input chain, a continuous eligible run, an actual observed endpoint and the same-revision existing Check attempt with zero errors. An earlier Check that stops playback before observing the endpoint cannot be used to predict an endpoint. Completing the draft early is not enough until the endpoint is observed.

Missing evidence is unknown, not zero. No calculation from sentence duration, final text length, CPM, activeMs, decorative energy or submit-click time can replace native endpoint observation. A subtitle boundary is not an acoustic speech endpoint; no word-by-word latency, millisecond-precision claim, pass threshold, ranking or overall ability score follows from this value.

The observer is page-local and bounded. It does not persist text or keystrokes, alter the schema, write history, appear in exports/achievements/share cards/recorded Canvas, rescore attempts or operate playback. Refresh cannot recover a missing timing result.

**Sources:** fixed-pace detailed PRD §5; `studio/core/fixed-pace-finish.ts`; `Studio.tsx`.

## D06. Reference assistance and input discontinuities remain visible

**Retained principle with a conservative fixed-mode choice.** Visible reference is assistance, including at 1×. Adaptive completion cannot prove original-speed unaided performance. Missing assistance history does not prove there was no help. Hidden mode must not expose answer-derived DOM, Canvas, keyboard, sound, read-screen or recording information.

Fixed-mode composition-start interrupts the continuous measurement; the eventual real IME text still enters the existing editor once, without automatically reviving the timing cycle. Paste, deletion, replacement, undo and unknown provenance cannot stand in for a complete trusted-append chain. Existing drafts may play at a fixed rate but cannot be retroactively counted as fresh full-sentence timing evidence.

Known mute, zero course volume or unavailable/unknown audio routing prevents a valid listening/typing timing claim. A page-observed audio route does not prove audible system/headphone output or comprehension.

**Sources:** fixed-pace detailed PRD §§3–6; source input/observer tests; original hidden/reference exposure contracts.

## D07. Preserve native editing and shared scene geometry

**Retained implementation direction.** One complete native editor owns text, selection, undo, paste and IME. The visible projection and Canvas use shared geometry; rendering does not replace real input. Native media pixels and reachable controls are protected. The Below keyboard choice adds passive in-page keys without creating another editor/window. Phone/portrait pages default to hiding the page keyboard and do not intentionally summon the system keyboard.

Recent work repairs long drafts, measurement mirrors, portrait recovery and full-width typing. These implementation fixes are not blanket phone, keyboard, visual or accessibility acceptance. Historical visual references and intentional deviations remain documented instead of being silently rewritten.

**Sources:** `prominent-typing-area/`, `native-mirror-integrity/`, `portrait-render-recovery/`, `bottom-playback-style/`, `mobile-width-follow/`; `BASELINE.md`.

## D08. Local history must respect permission gaps and immutable evidence

**Retained data boundary.** A visible in-memory or pending result is not “saved.” Full records and partial segments have different evidence coverage. Recording OFF stops new permitted writes; ON does not scan old answers or backfill a gap. A partial record cannot reconstruct a complete prior session, hidden answer or writer permit. Late transactions and old readers must respect the current session/control epoch.

Old records, original answers, original reference versions and prior exports remain intact. New NPS material uses its own registered schema/binding; older clients must reject unsupported recovery safely rather than misidentify NPS as café. There is no global migration merely to add a new mode or metric.

**Sources:** `DATA-CONTRACT.md`, `data-v2a-*`, `data-v2b-*`, `automatic-history-*`, `v66-nps-material-*`, `v68-nps-default-and-load-recovery.md`.

## D09. Calendar totals describe retained evidence, not complete learning

**Published bounded functionality; broader F08 remains open.** Recorded submissions count retained request identities, not necessarily successful judgments. First-completed sentences need safely linked full results. Distinct matched terms are independent daily/weekly sets and are not vocabulary mastery. Legacy input-active minutes exclude frozen/listening/IME/idle intervals and cannot be renamed complete practice time.

Use explicit IANA timezone, actual occurrence dates, independent weekly deduplication and source links. Unknown coverage stays unknown. Partial records do not manufacture full completion facts, and missing data is not a confirmed zero. No heatmap thresholds, streak, reward or achievement rule is created by the recorded-metrics increment.

v91 preserves Training metrics contained in listening-session records; v92 uses a scoped final snapshot for their verification. The calendar whole-file failure later seen during candidate validation is still unresolved and must be recorded separately from these published implementation identities.

**Sources:** paired F08 recorded-metrics PRDs; `record-calendar*.ts`; v91/v92 source commits and receipts.

## D10. Corrections create versions; adoption and reassessment are separate

**Published bounded F11 functionality.** Original café text/time corrections and supported merge/split create immutable local reference versions with identity and lineage. Merge covers adjacent units; split requires explicit internal timing and complete texts. Exact media identity/duration and valid nonoverlapping times are required. Changing editor mode must not silently discard an unsaved subtitle draft.

Saving a version does not create attempts, award results, rescore history or switch the live round. Using it requires the existing explicit safe transition. Historical revision notices require a verified source/version chain; incomplete evidence cannot say “unchanged.” Candidate reassessment, contribution replacement and review-task migration remain separate unimplemented work.

**Sources:** paired F11 structure PRDs; `material-correction-v63.md`; local-reference/revision-impact source; v89 and v90 source history.

## D11. Review tasks use explicit dates and real committed results

**Bounded review sub-loop.** Task identity and provenance derive from actual durable Training facts. Users explicitly choose due dates/timezones and the following date; the first eligible committed result advances an occurrence exactly once. Wrong or assisted results keep their actual conditions. Planning, canceling and rescheduling do not score an answer or invent mastery.

No automatic interval model, assumed passing threshold, old-result catch-up, automatic latest-reference adoption or corrected-task migration is implied. Unsupported/missing media or evidence is unavailable. A safe retest transition must preserve the old permitted work and respect hidden-reference rules.

**Sources:** `v65-review-tasks-delivery.md`; `review-tasks.ts`, `review-task-storage.ts`, `review-task-source.ts`, `review-due-time.ts`.

## D12. Speaker monitoring and recording sources stay independent

**Retained F03/F05 contract.** Submission tones are opt-in and consume only a new explicit real result: first completion takes precedence over correct, otherwise correction. They do not announce old history/replay as a new success. White noise is independent and has no digital connection to the recording mix. All-monitor mute changes speaker monitoring, not selected recording tracks.

Course, microphone and submission cues are separately selected for a recording, default off, and locked during preparation/recording. Starting recording does not itself enable cues or infer permission to use hardware. Pause/modal/background/cancel and late asynchronous callbacks must not restart sound or recording. Background recording cuts off and preserves already committed segments; return to foreground does not auto-resume. A physical microphone may capture room sound even when digital buses are isolated.

The fixed-pace feature adds no microphone/camera, audio log, capture track, upload, AI service or retention change. Actual audible output, device capture and encoded-file behavior require separately scoped evidence.

**Sources:** `submission-sound-feedback.md`, `independent-white-noise.md`, `RECORDING.md`; v86/v88 implementation history; fixed-pace detailed PRD.

## D13. Preserve history additively and distinguish every release layer

**Release/data integrity decision.** Original PRDs and status notes are historical records. Later addenda may change the current contract but do not rewrite prior documents to claim a release or acceptance earlier than it happened. The main README stays intact; these project records provide the current navigation and corrections.

Implementation source, source tree, build ID, generated runtime release, Site version and public HTTP identity are distinct. Old runtime archives and immutable asset URLs remain available for traceability and rollback. A source-only/projected GitHub import may have different commit IDs; keep original-to-imported mappings. Proposed backup refs are not proof that those refs exist remotely.

The source contains earlier static demo/runtime material for history. Preserve it as history; never treat it as a fresh build of `b828503`. Creating or updating GitHub records does not trigger or authorize a Site publication.

**Sources:** version map, build/publication/HTTP receipts, `scripts/assemble-site.mjs`, fixed-pace manifest.

## D14. Do not weaken tests to remove a release blocker

**Current gate.** The frozen candidate is source-reviewed but its full validation is blocked. All 208 files were attempted; the final calendar subprocess was SIGKILLed after 7/13 cases. The latest unique result is 3,848 pass, 1 file-process failure and 1 skip, not a full pass.

The count-only and public-lifecycle experiments both failed after 2/13 cases and remain unapplied separate records. Their helper/probe successes do not establish a whole-file/full-suite fix or a proven resource root cause. Do not apply either patch as part of GitHub import, merge them opportunistically, delete hard cases or reinterpret missing cases as successes.

Future investigation must preserve test meaning and bind any approved new change to a new exact source identity. A clean source gate, new build, publication, resource readback and actual browser/phone/audio acceptance are distinct requirements. No old result may be relabeled as evidence for a new candidate.

**Sources:** `candidate-fixedpace/MANIFEST.json`, `SUMMARY.md`, final serial summary; both separately named unapplied experiment manifests and READMEs; `ANCILLARY-IMPORT-MANIFEST-V2.json`.

## Evidence precedence

For current implementation, read the exact source plus the latest applicable additive PRD. For a historical publication, use that version's publication receipt and matching public-identity/build records. For validation, use the exact candidate manifest and unaltered logs. An old document's “candidate” wording does not cancel a later verified release; a later version number or successful import does not erase a failed test or unobserved acceptance item.
