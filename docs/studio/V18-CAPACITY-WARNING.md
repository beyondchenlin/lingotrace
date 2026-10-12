# v18: advisory capacity estimates only

The formal Studio recorder now uses StorageManager.estimate when available. This is an estimate of the origin's quota/usage, not physical free disk space or a promise that a future write will succeed.

## Behavior

- Check when local recording storage is prepared, when the recording panel opens, on recording start, and every10seconds while recording. A manual refresh is also available.
- Warn when estimated remaining quota is strictly below10%, OR estimated headroom is strictly below120seconds at the rate used for this check. Exactly10%/120seconds alone is not low.
- Rate is at least the configured encoding bitrate. Before start the estimate includes configured video and audio; during a recording it reflects the presence of an audio track and the larger of configured bitrate versus committed bytes divided by elapsed recording time. This is an approximation, not a countdown.
- Low capacity never automatically stops or refuses recording. The user can continue, or use the existing Stop/Save control. A compact capacity notice remains in the recording banner after the panel closes.
- Unsupported APIs, rejection, invalid values and a1.5second timeout display an explicit inability to estimate. Recording remains available if the existing storage/encoder prerequisites pass.
- Actual QuotaExceededError still follows the existing safe stop path, preserves committed chunks and marks the recording incomplete. It is not swallowed by an estimate warning.
- Estimate polling is cleared at stop/finish/dispose. Generation guards discard late results belonging to an earlier/stopped session; estimates do not overwrite recorder error, lock warning, retention or score state.

No storage.persist request, permission prompt, record deletion or retention-rule change was added. Existing7day expiry remains startup/list-triggered and best-effort; retained records are unchanged. No new claim is made about browser eviction, guaranteed7day retention, or independently playable interrupted chunks.

## Tests and scope

Four estimate-monitor tests and three recorder integration tests cover strict boundaries, unsupported/failed/invalid/timeout paths, read deduplication, low-to-normal recovery, late responses, advisory continuation, manual final drain, retained rows, quota failure and stopped polling. They use synthetic recorders/stores/providers, not a full browser or filled disk. The existing66checks remain applicable; total73checks cover the candidate.

The independent v17 acceptance ledger remains at V17-FINAL-ACCEPTANCE.json. Its capacity-warning omission is addressed by this candidate, pending browser validation. Other listed microphone/cancellation, zero-reference, multi-ratio/device and expiry-integration gaps were not changed in this batch.

## Focused browser check

Use a disposable QA context with synthetic data. Override only the test context's estimate result to exercise normal, low-ratio, low-time, missing API, rejection and timeout; do not request persistence or fill the real disk. Verify warning visibility after closing the panel, continued capture, manual stop, downloaded playable synthetic recording and normal score/export behavior. Verify a stopped request's late response cannot alter the next session. Actual quota failure must be tested separately with a controlled failing write and already-committed test chunks; an estimate warning is not evidence of that failure path.
