# LingoTrace project handoff

Record date: 2026-10-12 (UTC). This is a human-readable project record for source and history synchronization. It supplements the preserved main README and original PRDs; it does not replace them or rewrite their historical status.

## 1. Read this first

- **Official published baseline: Site v93.** Implementation source: `1797507bcc03890f4f1e23f3e40b8f76e533f962`; generated-release commit: `47a1df1df2918fb87a56b16d37b63bcda44d22be`; build ID: `y4bNufLX_o_ctS4DsphXx`.
- Public Studio: <https://lingotrace-training-demo.beyond-chenlin.chatgpt.site/studio/>. The retained anonymous HTTP receipt verified the exact v93 content at 2026-10-12 10:58:31 UTC. Publication was recorded at 10:59:04 UTC. These are recorded publication/asset-identity facts, not a new live check or device-acceptance claim.
- **Latest frozen development candidate:** `b8285030fe8889a1de894f7cfe4ecb91b4d3746a`, source tree `42261ce4c7289a5c43463b9349fe5096603955f7`. It contains the latest fixed-pace direction but is **not built or published**. Full validation remains blocked by an incomplete calendar test process.
- Fixed-pace implementation commit: `b178171d250ad02efcefecf563a16cf9b7a6d149`. The following `b828503` commit only supplies absent fixed-pace context to two older isolated fixtures; it does not change production logic.
- Importing source, Git history, documentation, receipts or experiments into GitHub does **not** publish a Site, turn a candidate into a release, or establish browser, phone or audio acceptance.
- Preserve old runtime archives and immutable assets. Keep source identities separate from generated-release identities. GitHub-imported/projected commit IDs, if different, require their own mapping to the original IDs above.

Companion records: [Decisions](DECISIONS.md) and [Release history](RELEASE_HISTORY.md).

## 2. Product purpose and latest confirmed direction

LingoTrace is a device-local English listening and typing practice tool with a dynamic HUD. Its long-term learning loop connects real input, explicit checks, traceable records, original-source review and deliberate retests. Visual activity, playback, statistics and earned results must remain distinguishable.

The latest confirmed training goal is to make the learner's actual typing keep up with the original video's chosen audio pace, aiming to finish a sentence around the time the sentence ends. The candidate therefore makes **fixed pace the primary mode**, defaulting to 1×. Typing slowly, stopping or making mistakes must not slow the video down and create the appearance of keeping up. The previous input-driven Follow remains available only as explicitly selected **adaptive assistance**.

This is a training aim, not evidence that muscle memory, comprehension, vocabulary mastery or overall English ability has been measured or improved. A reference-visible exercise is assisted even at 1×. The latest direction supersedes earlier adaptive-primary descriptions only for the new candidate; it does not change what v85/v93 actually implemented or how their historical results should be read.

### Bounded fixed-pace candidate behavior

1. Verified original NPS material, visible reference, foreground editable practice, valid media ownership and no recording conflict are required.
2. A fresh eligible exercise defaults to fixed 1×. Explicit choices are 0.5×, 0.8×, 1×, 1.25× and 1.5×. Choosing a mode or rate does not itself start playback.
3. The first qualifying trusted tail append can consume the existing one-shot auto-start opportunity. Explicit Start remains available. Load, restore, focus and return to foreground do not start sound; typing after a manual stop does not rearm auto-start.
4. One verified native video supplies both picture and original audio. It can seek once to the sentence start on admission, then runs at the chosen rate to the registered sentence end. It does not seek per character, auto-Check or auto-advance. Typing may continue after the video stops.
5. A page-local signed finish difference is available only after an actually observed sentence endpoint, a complete attributable trusted-input chain and an explicit existing Check with zero errors for the same revision. Negative means the final append preceded the observed endpoint; positive means it followed it.
6. Missing evidence remains unknown. Existing drafts, non-append edits, paste, composition interruption, manual playback changes, background/blur, buffering or observation gaps, and unavailable/unknown audio can invalidate timing. Text entry and the existing check result must still work honestly.
7. Fixed-mode IME composition conservatively interrupts continuous measurement. Adaptive mode retains its previous composition-wait behavior. This is a known experience boundary, not equivalent timing support for every input method.
8. Adaptive assistance retains its 0.8× start, 0.5–1.5× range and smooth idle coasting. It cannot be a silent fallback from fixed mode and produces no fixed-pace finish difference.

The endpoint is a browser-observed registered subtitle boundary, not an independently acoustically calibrated end of speech. A one-decimal display does not establish 0.1-second accuracy. There are no verified word timestamps, word-by-word lag measurement or approved synchronization success thresholds.

## 3. Current architecture and code map

The formal product is a Next.js static export with React/TypeScript controls, one native input and a persistent Canvas2D scene. The lockfile records Next.js 16.4.0, React 19.3.0, TypeScript 7.0.2 and Motion 14.0.0. Those are repository dependency identities, not recommendations to upgrade. There is no application account/cloud backend, AI grading or payment flow in this implementation.

Paths below are relative to the frozen source root:

| Area | Primary locations | Responsibility |
|---|---|---|
| Production entry and host | `app/studio/page.tsx`, `app/portrait-preview/page.tsx`, `studio/components/Studio.tsx` | Shared Studio, native input/media integration, explicit user actions and lifecycle/owner fences |
| Learning facts | `studio/core/training.ts`, `repository.ts` | Deterministic Training engine, attempts, versioned scoring, replay, persistence and read/write boundaries |
| Fixed/adaptive pacing | `studio/core/typing-follow-policy.ts`, `typing-follow-input.ts`, `studio/media/typing-follow-host.ts` | Admission, trusted edit provenance, pure policy and scoped native-media effects |
| Finish observation | `studio/core/fixed-pace-finish.ts`, `Studio.tsx` | Page-local observation and attribution; no scoring, persistence or playback authority of its own |
| Product wording | `studio/i18n/messages-studio.ts` | Bilingual mode, rate, result and limitation messages |
| Native geometry and rendered scene | `studio/scene/`, `app/studio/studio.css`, `app/studio/hud-panels.css` | Shared presentation geometry, real editor projection, HUD and capture rendering |
| Media and recording | `studio/media/`, `docs/studio/RECORDING.md` | Verified media, explicit audio sources, recording lifecycle and local storage |
| Calendar | `studio/core/record-calendar.ts`, `record-calendar-reader.ts`, `record-calendar-metrics.ts`, `studio/components/RecordCalendarPanel.tsx` | Read-only, provenance-backed recorded day/week metrics and original-record access |
| Reference revisions | `studio/core/local-reference.ts`, `local-reference-repository.ts`, `reference-revision-impact.ts` | Immutable local corrections/structure and verified history revision notices |
| Review loop | `studio/core/review-tasks.ts`, `review-task-storage.ts`, `review-task-source.ts`, `review-due-time.ts` | Explicit-date local task/retest sub-loop with original evidence and atomic occurrence handling |
| Source identity | `studio/core/builtin-material.ts`, media descriptors under `studio/media/` | Immutable material/reference/media identities, registered NPS boundaries and fail-closed acquisition |
| Static packaging | `scripts/assemble-site.mjs`, `next.config.ts` | Merge static Studio output while preserving archived routes and immutable prior assets |
| Historical demos | `dist/demo/`, `dist/hud/`, `previews/` | Preserved earlier implementations and evidence; not interchangeable with current Studio source |

The assembler preserves existing content-addressed `dist/_next` files and refuses a same-path/different-byte collision. It refreshes the intended Studio/preview/transport-check/assets/workbench outputs and retains archived demo routes. Do not remove historical assets merely because a newer entrypoint no longer references them.

## 4. What exists, and what is still incomplete

The following is a scope map, not a blanket acceptance statement. Earlier PRDs often say “candidate” because they record the state when written. Later release receipts establish later publication without editing those original documents.

### Implemented baseline capabilities retained by the candidate

- Real native typing, IME/paste provenance, explicit deterministic Check, versioned attempts, deduplicated earned target positions and consistent replay/export facts.
- Device-local full/partial history with explicit recording controls, read-only historical attempts, original-reference evidence and guarded calendar links.
- Verified NPS material plus preserved café material; verified source identity and safe new-round transitions; local files without a bound reference are not silently graded.
- Listening controls and estimated reference-follow/cadence presentation separated from actual typed input and scoring.
- Scene recording, explicit independent recording-source choices, speaker-monitor controls, opt-in submission tones, and separately controlled white noise without a digital recording-bus connection.
- Versioned café text/time corrections, bounded merge/split and verified reference-revision notices without rewriting old answers or scores.
- Explicit local review dates and real retests; the first eligible durable result can advance a task occurrence once to the explicitly chosen next date.
- Recorded day/week counts with metric provenance, explicit statistical timezone, source reread, incomplete coverage and unknown values.
- Recent source fixes for native measurement mirrors, portrait/render recovery, full-width typing, saved practice recovery, subtitle draft preservation, accurate submission announcements, calendar listening-record retention and bounded snapshot reads.

### Outstanding product goals

| Goal | Current boundary / remaining work |
|---|---|
| Fixed-pace release | Candidate source is implemented/reviewed, but exact full validation, new build, publication and actual device acceptance remain open. |
| Wider fixed-pace training | Hidden dictation, café/corrected/local material admission, continuous IME experience and more reliable sentence timing are not delivered by this candidate. |
| Unified statistics (F01/F08) | Complete practice-duration collection, coverage intervals, confirmed-zero days, unified registry/snapshots, broader summaries and approved heatmap thresholds remain open. Existing input-active minutes cannot be renamed full learning time. |
| Complete HUD/ten production themes (F04/F06) | Existing configuration/layout and gallery/demos do not establish the full versioned all-property configuration contract or ten fully integrated themes. Dedicated mobile/tablet/TV behavior needs its own evidence. |
| Recording parity (F05) | Code/synthetic/encoded-file checks and real camera/microphone/device acceptance are different layers. Full deterministic re-rendering and broad device parity are not implied. |
| Private end-of-round sharing (F09) | Existing saved-history cards and supported WebM muted copies do not establish the genuine end-round settlement/card flow, general video editing or de-identification. |
| Feedback/achievements (F10) | Presentation options must not alter facts or double-award; a complete achievement wall, ranks and learning ability claims remain outside the delivered scope. |
| References and reassessment (F11/F12) | Bounded immutable correction/merge/split exists. Imported-track editing, candidate reassessment adoption, contribution replacement and structure-driven task migration remain incomplete. |
| Full review loop (F13) | Explicit-date local tasks/retests are a bounded sub-loop. Automatic intervals, mastery policies, word-generated tasks, revision-choice migration, notifications and the full recording A/B loop are not complete. |
| Future courses (F14) | Broader reviewed scenario/course generation, AI services and cross-device features remain later work. |

The execution-calibrated v1.4.8 overview and detailed PRD preserve F01–F14. Their earlier prioritization identified subtitle-draft loss and restored-result announcement confusion; later v90 source changes address those bounded code issues. Actual acceptance remains separate, and those old issue descriptions should not be misreported as untouched implementation work.

## 5. Exact candidate verification boundary

This record summarizes existing evidence; no product tests were run to prepare it.

| Evidence | Recorded result | What it does not prove |
|---|---|---|
| New repository tests | 153 new cases: policy 41, observer 90, production-host 22; all new cases reported passing | A clean final full suite or physical interaction |
| Independent source/handler review | 12 final source/test/PRD file hashes bound; 10 external handler probes passed | Build, publication or device acceptance |
| Final full inventory | All 208 tracked Node test files were attempted using the same exact file set | Every test case completed |
| Final core/scene stage | 2,777 pass; 1 calendar-file process failure | A passing core stage |
| Final media stage | 922 pass; 1 skip | The missing real MediaRecorder fixture |
| Final HUD/library stage | 93 pass | Browser layout acceptance |
| Final legacy-preview stage | 56 pass | Current Studio device acceptance |
| Final unique total | **3,848 pass, 1 file-process failure, 1 skip** | Full validation success |
| TypeScript and diff check | Non-incremental typecheck and candidate-v93 diff check passed | Runtime/build acceptance |
| New build / publication | Neither performed for `b828503` | Any fixed-pace production release |

The calendar file is `studio/core/record-calendar-snapshot.test.ts`. Its final subprocess ended with **SIGKILL after 7 of 13 cases passed; 6 cases did not execute**. The recorded maximum reaped-process RSS was 825,676 KiB. The completed suite was expected to report 3,854 passes and 1 skip. The missing six cannot be counted as successes; the process failure is not an ordinary failed business assertion. SIGKILL and RSS do not establish the root cause.

Focused totals (472/472 and fixture-correction 128/128) overlap the full inventory and must not be added to it. The 10 independent probes are separate external evidence. The difference from the prior 3,701-pass baseline is currently 147 completed passes, not a contradiction of the 153 added cases: six old calendar cases did not run in the final attempt. The sole expected skip is the optional real MediaRecorder byte comparison without `WEBM_MEDIARECORDER_FIXTURE`.

Both resource experiments are archived separately and **failed, unapplied and uncommitted to the candidate**:

- Count-only spy experiment: 2/13 calendar cases passed, then SIGKILL. Limited helper review passed, but the file did not complete.
- Public IndexedDB lifecycle experiment: 2/13 passed, then SIGKILL; 11 unexecuted. A separate 1/1 public close/delete probe does not prove process-memory release or a full-suite fix. Its RSS cannot be treated as a directly comparable improvement.

Neither patch is product source, neither resolves the gate, and neither should be applied during archival synchronization.

## 6. Recommended continuation, with explicit stopping gates

1. Complete the authorized source/history synchronization and verify the destination contents against manifests. Preserve the main README, original docs, old runtime archives and separate failed experiments. Synchronization completion must be established by its own readback receipt.
2. When development resumes, diagnose the calendar whole-file failure in an isolated environment with appropriate resources. Preserve all 13 cases, the 100-row scenario, assertions, shared state and hooks. Do not obtain a green badge by pruning cases, suppressing errors, reducing scope or counting a single-file result as the full gate.
3. If a change is needed, create and review a distinct source candidate. Bind subsequent tests to its exact identity. Do not silently modify or relabel `b828503` or its existing failure evidence.
4. Run the full required inventory, non-incremental typecheck and diff check. `npm test` covers core/scene and media only; the final validation inventory also includes HUD/library and legacy-preview test files. Use the recorded 208-file manifest to avoid accidental omission. Report skips and process failures separately.
5. After a clean exact-candidate gate, make a fresh build, freeze and hash it, preserve prior runtime artifacts, and record source/build/release identities. Do not publish old v93 output under the new candidate's name.
6. Publish only through the separately authorized release workflow and verify anonymous public resources against the frozen build. This remains distinct from GitHub synchronization.
7. Exercise actual browser and phone behavior: trusted physical input/IME, 1× rate readback, video motion and original sound, sentence-end stop, late/early finish, invalidation paths, reference labels, mobile keyboard/layout and old-history compatibility. Protect existing practice data and obtain any required approval before ending an existing exercise or using camera/microphone capture.
8. Keep every unobserved browser, phone, audio, visual or encoded-recording scenario explicitly unaccepted. HTTP hashes and controlled Node events do not fill those gaps.

## 7. Evidence and document guide

Read the frozen source alongside these records:

- `docs/studio/fixedpace-calibration/PRD-total-fixedpace-calibration-20261012.md` and its detailed companion: current primary-mode contract, exact result meaning and remaining goals.
- `docs/studio/typing-autoentry/`: v93 trusted one-shot entry contract; `docs/studio/mobile-width-follow/`: v85 adaptive Follow; `docs/studio/typing-follow-sentence/`: earlier candidate history.
- `docs/studio/BASELINE.md`, `DATA-CONTRACT.md`, `RECORDING.md`: architecture and foundational fact/storage/capture boundaries.
- `docs/studio/prd-v1.4.8-f08-recorded-metrics-*-20261012.md`: bounded calendar metrics.
- `docs/studio/prd-v1.4.8-f11-structure-*-20261012.md`: bounded immutable merge/split and revision notices.
- `docs/studio/delivery-ledger-v49-v54.md`, `submission-sound-feedback.md`, `v65-review-tasks-delivery.md`, `v66-nps-material-*`, `v67`–`v71` media records: historical functional scope and limitations.
- `docs/studio/transparent-learning-hud/`, `adaptive-reference-hud/`, `centered-english-hud/`, `prominent-typing-area/`, `saved-training-refresh/`, `bottom-playback-style/`, `portrait-render-recovery/`, `native-mirror-integrity/`: presentation and recovery evolution.
- `PUBLISHED-VERSION-MAP.json`: original v82–v93 source/tree identities and proposed backup refs. Proposed names do not establish uploaded refs.
- Ancillary evidence destination namespaces: `published/v82/` through `published/v93/`, `candidate-fixedpace/`, `unapplied-experiment/`, `unapplied-experiment-public-lifecycle/`, and `uncommitted-history/`. These describe the selected archive layout; remote presence must be checked separately.
- `ANCILLARY-IMPORT-MANIFEST-V2.json`: 112 selected historical files, 3,171,351 bytes, including 98 inherited files and 14 additions. This is an evidence manifest, not a product release manifest. Historical upload-status fields describe their preparation time, not a new authorization or a current upload receipt.

The candidate preserves all 165 v93 product documents byte-for-byte and adds two fixed-pace PRDs, for 167 tracked document files. Project records contain product context, not raw conversations, user practice backups, credentials or unrelated projects. The complete older documents remain authoritative for details deliberately summarized here.
