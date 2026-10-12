# Batch 2A acceptance record

Date: 2026-10-08. Baseline: data batch1 `4f2e504a5407316b7aa4325f06536fffbffd0c06`; public v22 `3921e15e2b43a02509c6f288b1099c0fe6982f1f` remains unchanged.

## Passed at this boundary

- 21 deterministic adapter tests using the real `FencedPracticeRepository` and fake-indexeddb, not a substitute state machine. This covers synchronous OFF, preference-write failure, request-success-before-transaction-abort, cross-instance generations, physical whole-session deletion, clear rollback, orphan lineage, stale callbacks/permits, conflicting facts, and truthful read/write status.
- Independent reviewer reproduced subscriber reentrancy reversing durable toggle order and clear/admission order. Both were fixed by reserving the transaction queue position before notifying observers. Both ON/OFF directions and clear-to-new-segment now have passing regressions.
- Full regression: 105 primary runner results (one file also reports 16 internal training checks) plus 42 media tests, equivalent to 162 individual checks. Strict TypeScript passed. Batch1 implementation and the production UI/renderer/storage were not modified.
- The browser driver was executed with fake-indexeddb in Node and reports `executionEnvironment: non-browser-harness`. Its deterministic fixture readback and reload-function checks passed. This is a driver/program check, not browser acceptance.

## Native browser still blocked

The earlier official cloud browser was available but had no reachable approved origin for the standalone test page. The supported Windows Library materialization attempt and one bounded retry both returned HTTP 403; the package did not reach that executor. No actual browser ran these data tests, and these environment failures are neither data-test passes nor product failures.

`qa/data-development/` now provides a standalone button-driven page, bundle and loopback-only static server for both batches. It is outside `public/` and the exported Site. No server was left running or deployment made. A supported source/test origin can run the explicit page-reload checks later.

## Remaining product boundaries

- This repository is development-only and refuses production. Its new database namespace does not read or migrate user history.
- OFF stops future automatic history immediately on this page; failure to persist that preference is explicit. Cross-tab UI synchronization is deferred.
- ON requires an explicit new recorded session. It does not reset, submit, complete, award, or otherwise change the current temporary practice. This limitation must be addressed explicitly by any future controller.
- Deletion and clear operate on entire sessions. Deleting attempt a1 while preserving a2, dependent audio/assessment cleanup, request registries, selection/regrade, stable awards, review scheduling and conflict import remain separate batches.
- No product UI, actual user typing, physical media capture, real disk exhaustion, AI, credentials, cloud sync or public deployment is claimed.
