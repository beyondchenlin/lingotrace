# Practice history controls and retained segments (v42 candidate)

Baseline: published v41 / 816f186840f8b36dcaa1b420ebda34d77437fdb2. PRD v1.4.6 remains the formal baseline; this versioned implementation note applies the 2026-10-09 user-approved OFF/ON rule. No Practice adoption or legacy score migration is included.

## User-visible behavior

The existing Settings panel now distinguishes practice history from video recording. OFF stops current-page capture immediately, revokes pending writes and persists a content-free setting. If the setting fails, the page remains stopped and says the setting was not saved. ON retains only subsequent permitted source events, without resetting the live draft, attempt, training clock or score. An in-flight ON can be canceled with OFF.

Untouched legacy-default users retain their existing complete-snapshot save/restore path. After using the control, complete historical snapshots remain unchanged. New retained data is a permission-filtered projection (`lingotrace-history-segment-v1`, partial coverage, non-replayable) of the existing Training v1 source events. It does not create rewards or a second score model. Cross-boundary or ambiguous text/answers are redacted; missing data is not zero. Clearing the draft establishes a fresh text boundary. No full snapshot is written under segment mode, including ON.

The history panel has separate complete-record and partial-segment views, both paginated and readonly. JSON and CSV for a retained segment preserve the same facts, nulls and redaction markers; final repository existence/identity checks guard download delivery. Current-page full JSON/CSV export remains an explicit user action and now warns that it may contain temporary content that was not automatically retained.

A refreshed or bfcache-restored page cannot replay partial segments as a complete live session, or inherit an old page's permit. It starts temporary and explains that retained history is still available. The user can explicitly choose “从现在记录练习历史”. This action does not reset the current practice. An explicit new round preserves OFF and only continues recording when the prior page already held an active recording capability. Unknown settings/recovery failures are never cleared merely by clicking New Round.

## Safety and compatibility

Same-transaction generation, head and permit checks enforce persistence. Settings notifications contain no learning content; peer pages reread the actual configuration. Every Studio automatic save, including visibility and exit handling, routes through the adapter. Late callbacks cannot announce a canceled ON or reset a destroyed page. Write failure keeps live training usable and offers retry/export; no raw-snapshot fallback exists.

The first explicit toggle installs an IndexedDB connection-version fence (1 to 2) without transforming stores, indexes or existing values. There is no content migration, deletion, cleanup, cloud synchronization, AI call or device permission change. Existing sessions/events/latest are not rewritten by segment storage. Partial segments cannot supply a complete calendar, total learning time, reconstructed CPM, or aggregate score.

Published v41 opens version 1 explicitly. Its versionchange handler closes the old handle; after the version-2 barrier commits, any old reopen/write is refused by IndexedDB. If a connection refuses to close, the toggle fails visibly to local OFF/settings unsaved, and its later upgrade callback is aborted rather than silently activating. Releasing that blocker requires an explicit retry. If the barrier commits but setting storage fails, DB2 remains; retry does not downgrade or alter old facts. Old v41 history/restore also needs refreshed current assets. A rollback must therefore retain the version-aware repository, write fence and segment handling; unmodified v41 is not a safe rollback. Offline browser eviction and interrupted final writes cannot be guaranteed against; unsaved/pending writes are not labeled saved.

## Evidence before publication

- Reviewed adapter commit 76eba62: immutable source projection, repository controls and recorder.
- Independent adapter review: two discovered privacy/retry defects fixed; OFF sentinel content absent from all isolated sessions/events/meta stores and retained exports; live engine still scored the same temporary answers.
- Independent UI/lifecycle review: canceled ON, settings restore failure, bfcache status, new-round recovery and late callback issues fixed.
- Final program regression: 524 core/scene tests + 57 media tests passed; TypeScript and Next static build passed.
- Actual shipped Studio functions are exercised by studio-history-lifecycle.test.ts; storage tests use fake-indexeddb, not a browser or user's database.
- The Canvas renderer, accepted responsive geometry/motion, TrainingEngine, camera/recording modules, story and HUD library sources remain unchanged.

The exact v41 repository source is frozen as a hash-checked test fixture; focused tests cover actual old-class write refusal, blocked late-upgrade cancellation, preservation, retry and future-version rejection. Earlier OFF-only development candidates were never published.

Browser OFF/ON, actual IndexedDB readback, cross-tab settings, refresh, exports and visual smoke checks remain pending until the candidate is published and tested. Native OS IME, physical devices and forced process termination are not covered by these program tests.
