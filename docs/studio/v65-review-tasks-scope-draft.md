# F13 next delivery unit: user-scheduled local review and real retest
Baseline: v64 / 0b5b8bac3c47e24f29c253224118f10dac4f0b82.
This is the approved bounded implementation scope, amended after independent design review. Implementation remains a candidate until frozen-code review and HTTPS acceptance.

## Outcome
From a genuinely submitted and durably saved supported sentence, explicitly create a local review task for a user-chosen date/time. Reload the task list, see due state and the fixed reference/version, cancel safely, or explicitly end the current round and open a new retest. Before retesting, choose the next due time. The first valid result whose transaction commits successfully advances the instance once to exactly that chosen time. Display the actual result and its evidence link. Creating, reading, opening, cancelling or rescheduling tasks produces no learning, score or reward.

This is a complete manual-scheduling/retest sub-loop, not the entire F13. No automatic success/failure intervals, mastery threshold, FSRS, notifications, audio assessment, new storyline, AI or cross-device work is included.

## Exact requirement grounds (v1.4.10 detailed-review-full.txt)
- P18 / F13: saved words/sentences return to original segment, explanatory review tasks, records updated by actual retests.
- T104 R5: “按明确规则或用户选择安排到期任务”; creating tasks adds no learning; an actual retest creates a new attempt.
- P107: reviewTaskId, source attempt, object, reference and dueAt; duplicate creation does not duplicate; due/open/notification not learning; reviewInstance winner and dueAt atomically committed.
- P110: original attempts never migrate; revised source version requires explicit original/new/cancel choice, not implicit latest.
- P112: intervals not yet fixed; skipped or unevaluated does not invent success/failure or change plan.
- T94 R1/R3/R7 and P97: fixed reference, exposure/answer conditions and source event/session/attempt relationships; explicit new round, not washing same-round exposure.
- T251 R2 / P254 / P256: first successfully committed valid result wins, valid does not mean correct; later actual attempts remain evidence; cancelled/replaced instances cannot be advanced by late results.
The manual time is user intent, not a derived “passed/failed” memory interval.

## Existing code and actual gap
- Training Attempt and source facts already exist: studio/core/training.ts:43–49,58–71,198–228,359–366. No reviewTaskId/reviewInstance contract or production review task exists.
- Existing Studio submit uses TrainingEngine and keeps real scoring: components/Studio.tsx:329. It must remain the only answer/judgment source.
- RoundReview is a real submitted-cue entry point: components/RoundReview.tsx; unsubmitted reference stays hidden. Existing settings is the task-library entry; main Canvas/layout stays unchanged.
- Existing bookmark validates original-version media but has no source attempt: core/context-bookmark.ts:20–28,81–95. Do not transform every bookmark into a review task or infer a source attempt.
- Immutable v63 materials/verified media and safe transition boundary are reusable: core/local-reference.ts, core/reference-transition.ts:13–42, Studio.tsx:189–218. Old beginNewRound is not the safe transition template.
- Full Training and partial segment readers are separate. Partial facts: training-history-segment.ts:21–47; exact read schema: repository.ts:834–906. Recorded judgments have actual answer/alignment but do not contain full reference or complete assistance provenance.
- Isolated PracticeEngine is not production and has no review scheduling implementation. No engine switch is proposed.

## Frozen domain choices
1. Dates are explicit user choices. Store the exact UTC instant plus the entered local clock, IANA zone and displayed offset. Show local date/time + zone/offset in confirmation and list; ambiguous/nonexistent DST inputs must be rejected or explicitly disambiguated, not silently normalized. An already-past chosen instant is shown due; no “tomorrow” inference.
2. Stable task identity, independent save-request id, source attempt locator and fixed material/cue/reference digest. Repeat the same save request idempotently. Unique active-task key prevents two tabs double-creating the same source-attempt/target task; a distinct genuine source attempt is not silently merged.
3. Independent reviewInstanceId represents one occurrence. Its manual next-due choice is fixed before retesting and visible to all tabs. A competing changed choice is a revision conflict, not last-write-wins. Manual rescheduling or cancellation invalidates the prior instance explicitly; stale results cannot advance a replacement.
4. Any authentic nonempty scored text result under the existing rule can be an eligible result; correctness is shown, not used to invent a mastery/pass threshold. The first successful winner transaction advances once to the manually chosen time, even if the result has errors. Empty/reference-unscorable/unavailable/redacted/failed-save results do not advance.
5. Follow-up corrections and concurrent real submissions remain existing Training evidence. They do not advance the already-won instance again and do not overwrite its first committed winner.
6. Skip leaves the occurrence pending. Cancellation is a reversible/status operation, not permanent history deletion. Restoring a cancelled task requires a newly explicit due-date choice; there is no implicit fallback to the old date. No auto-created task and no notification permission.
7. At launch say explicitly “结束当前轮，按固定版本新开复测”. Preserve and flush the old round under the existing safe boundary before resetting. A failed CAS leaves the old round intact. Lock input, reveal, cue/material selection and duplicate launch through the transition; recheck the exact boundary next to synchronous reset.
8. Task list and launch preparation show identifiers/version/time but not the target answer before the new session begins. A request to see a reference during the new round produces the existing real reveal fact. No new independent/unaided claim beyond provable conditions; old and partial unknowns remain unknown.
9. Support current original cafe and valid immutable local corrections of that original media only. Recheck full material snapshot/digest, target cue and actual original media hash/duration. Missing library/failed media verification preserves task text/history but blocks playback/retest; no URL/72-second fallback.
10. A later source correction never silently updates a task. Show “固定原版/来源有新版” when ancestry proves this, and require explicit continue-original or cancel. Adopting a new revision, multi-object split/merge migration and full F13 migration remain later scope, clearly unavailable rather than auto-selected.

## Persistence and compatibility
Prefer new, strictly namespaced task/instance/request/winner records in the existing Training database meta store, e.g. review-task-v1:* and review-instance-v1:*.
- No database version upgrade, no new Practice writer, no rewrite/migration of existing sessions/events, no change to partial fact keys, no change to grading/time/earnedWords.
- Current old-client readers address fixed meta keys or only training-history-segment:* (repository.ts:599–604), so new task records are ignored. Prove this with frozen-v64 compatibility tests rather than assuming it.
- A separate database would not atomically recheck the history permission and recorded source with the review winner. Therefore use narrowly scoped repository methods/transactions in the existing DB, not a second fact engine.
- Task creation is an explicit reference/plan save. Bind it only to a read-back durable real submit/judgment. For a full snapshot require matching session/material/cue/attempt and source facts. For a segment require matching recorded request/result in the admitted segment and independently explicit fixed target reference; label historical coverage partial and assistance/reference provenance unknown. Never reconstruct a full attempt from a segment.
- Expose only the current segment locator/committed proof needed by this adapter; do not leak or recapture private drafts. The adapter may read a saved result; it does not call score/replay to manufacture one.
- A live retest binding holds task/instance, new session, target material digest/cue, and privacy generation. Before accepting a result, flush normal allowed history. In one transaction recheck actual saved source request/judgment, current control/generation, task revision, live instance and absence of winner, then commit winner+dueAt together.
- Integrate local OFF epoch/active transaction cancellation with the existing history fence so a delayed automatic task update cannot persist after OFF wins. A settings generation mismatch stops the advance. Existing task viewing/cancellation does not silently re-enable answer recording.
- OFF/unprepared/awaiting-permit cannot start a persistently tracked retest without the existing explicit recording permission action. Ordinary temporary practice remains usable; no task progress or hidden result copy is made.
- Refresh restores task lists independently. Only an allowed, fully saved legacy session may reattach the same practice; partial/OFF retains task/occurrence but must explicitly launch a new retest, never restore a fabricated full snapshot. Reopening a task is not completion.
- Missing/deleted source evidence becomes unavailable and cannot advance; no zero score. Existing Training JSON/CSV remains unchanged. Add a task-specific export with task/instance/source locators and truthful full/partial availability so the new relationship can be inspected without modifying old exports.

## Acceptance gates before any release
1. Empty library shows no result; create/read/reload/cancel/reschedule creates zero new Training attempts or earned words.
2. Manual time roundtrip across timezone, DST gap and fold; no hidden normalizing; due grouping by stored instant.
3. Same request retry, double click and two tabs without BroadcastChannel yield one active task; conflict returns stored row.
4. Fixed full material/cue/version/media hash+duration; corrected version and later changed ancestry never silently adopt latest.
5. Old round dirty/new event during flush/permission generation change/CAS failure: no reset and no lost tail.
6. Normal new retest adds real submit/judgment and new attempt; task links exact saved attempt/event IDs; existing score output identical.
7. Correct, incorrect and assisted results all retain original conditions; no invented pass threshold; partial assistance stays unknown.
8. First successful result transaction wins. Rollback does not reserve winner; loser attempts remain; duplicate delivery never advances twice.
9. Manual reschedule/cancel/newer revision during an in-flight result leaves old result but cannot advance replacement.
10. OFF before/during flush and winner commit, delayed promise, pagehide and stale tab: no covert retained result or auto-resume.
11. Full legacy refresh rebinds only exact saved state; partial refresh lists pending task without reconstructing practice; old v64 readers and exports unchanged.
12. Missing/corrupt task/source/media produces explicit unavailable/error, not empty/zero/success.
13. Hidden-answer DOM/Canvas/accessibility, reveal-before-submit and playback lifecycle checked. No new recording preview path or audio permissions.
14. Real HTTPS end-to-end with recognizable synthetic QA task and answer, export/readback source preserved, current old QA round backed up. Main layout/visual baseline unchanged.


## Independent design review amendments (accepted before implementation)
1. The winner transaction retains the immutable old occurrence winner, creates a fresh successor occurrence at exactly the selected next date, updates task.currentInstanceId and revision atomically. Successor has no chosen following date. Running and restored old sessions stay bound to the original instance forever; they never follow the task pointer. Reschedule/cancel/restore uses revision CAS and cannot revive invalidated instances.
2. Persist startup session→instance relation separately from actual result locators, under the same effective history permission after a real new session/segment has been saved/admitted. Persist real winner and loser attempt locators only by the fenced repository path, without copying private answers. Source relation validation requires matching request before judgment, same attempt/cue/session/material, matching recorded answer and words>0. No delayed candidate/locator queue survives OFF or gets scanned into a new generation. Exact legacy saved binding may restore; partial/OFF never recreates practice.
3. Startup plan/revision CAS precedes synchronous reset. Reset→new segment admission→saved binding is a still-locked transition. Failure cannot be called tracked practice, cannot back-associate later temporary answers and cannot silently enable history. Show an explicit retry/temporary-practice choice. The normal save and winner transactions remain separate with honest failure state; rollback of review records does not roll back or poison the already-saved Training answer.
4. Retest has its own hidden-answer start; do not call the entire startSavedReference flow (which reveals the answer and uses editedCueId). Verify task target cue and version. An explicit reveal uses ordinary exposeHint('reveal'), with no new referenceExposure enum value and no false corrected-confirmation provenance. Freeze/source exact compatibility tests cover this.
Independent review: independent-design-review.md, SHA256 93cc2793a5bd0365d2aeebe1d579197821b19bddd3cde4f35dca30bbe0b9b22c. The review's additional occurrence/privacy/startup/relation/refresh tests are mandatory implementation gates.
