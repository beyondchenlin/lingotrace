# Explicit read retry for saved Training v1 history

Baseline: v50, c8362e16eb02fe8f5754b127439de67aeab78b66.

PRD 1.4.8 requires visible recoverable failure states and an explicit retry path (T138 R7, P448), while browsing/exporting historical records must not switch current training (P451). Partial-history reads already have an explicit retry path. The full Training v1 history view only offered a global list refresh, losing a failed detail/page target and requiring manual reconstruction after stale export failures.

This change retains the failed read target only in memory and adds a retry control only when the reader reports a retryable failure. A retry repeats the original list, page cursor or selected record read. An export failure installs a read action, never a download action: users inspect the reread record and explicitly request a fresh download. No automatic retry loop, persistence, migration, alternate permission path, new score or export format is introduced.

New actions, successful completion, back/navigation and disposal clear the old action. Epoch fences and reentrant-listener checks prevent stale asynchronous completions from restoring obsolete state or a retry target. Concurrent clicks cannot duplicate an in-progress retry.

Recognizable malformed/unsupported records, invalid query/sink contracts and explicit permission exceptions are not marked retryable. All retries still pass the original repository validation and permissions. Existing repository code converts some underlying browser errors to a generic read-failed code; this UI cannot recover the lost error classification. For such generic failures, an explicit same-path read is possible, with no permission bypass or alternate route.

Cloud browser success-path checks are separate from mocked I/O failure and lifecycle tests. We do not corrupt a real saved record or change browser storage permissions merely to induce an error. Physical-device, storage-fault and forced-process-termination behavior remains unqualified.

## Candidate validation, 2026-10-09

- 115 new reader retry checks (including named subtests) and three actual Panel JSX/SSR/control-callback checks pass. With the existing 12 Reader checks, the independent targeted run is 130/130.
- Full suite: 701 core/scene tests, 57 media tests, 48 validation tests (806 total); typecheck, production build and diff checks pass.
- Real fake-indexeddb repository tests preserve stored bytes/save status and current engine input; stale export revalidation still requires a fresh explicit download click.
- Independent review passed exact target capture, mutable Date/ArrayBuffer/nested IDB keys, duplicate-click suppression, stale completions, reentrant listeners, readable-error classification, and no automatic export/retry.
- Main Studio, scene/layout, training/scoring, repository, media and app source have no changes from v50.
- Production browser verification is performed after the authorized same-Site deployment. Localhost access previously denied by browser policy is not retried. No real record corruption or browser permission changes are used to simulate failures.
