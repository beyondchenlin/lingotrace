# Batch 2B acceptance record

Date: 2026-10-08. Data patch baseline: `f9cd7f61dc965744a54932ba5f8b4f83054c809f` (batch2A). The checkout also contains separately committed HUD work, which this data patch does not include or modify. Public v22 remains `3921e15e2b43a02509c6f288b1099c0fe6982f1f`.

## Passed evidence

- 45 new program checks: 12 canonical redaction tests and 33 repository/export tests, using the actual implementation with fake-indexeddb.
- Full regression: primary runner 150/150 and media runner 42/42. The primary runner's legacy training file separately reports 16 internal assertions. Strict TypeScript passed.
- Local `next build --webpack` completed static generation for `/studio`. The Site assembly/push/deployment commands were not run; the public UI was not changed.
- Independent review compared a complex v1 command sequence against the actual frozen old reducer, with byte-identical snapshots/replay. It also passed 960 sequential deletions over 80 legal multi-round histories.
- All three standalone QA drivers ran and read back in Node with fake-indexeddb, explicitly reporting `non-browser-harness`. This verifies the drivers, not an actual browser.

## Closed findings and retained regressions

- A caller-supplied redaction ID could retain a removed original event ID. The core and repository now reject that collision before committing.
- A later clear/session delete could be followed by an older deletion receipt or load result containing an obsolete snapshot. Superseded receipts now retain truthful deletion success but return no snapshot/permit; invalidated loads reject after their final observer notification.
- A history-only deletion could originally issue a new recording permit. Renewal now requires an explicitly supplied permit that was valid before deletion. New read-only instances, OFF→ON, another session/instance, and older repeated-delete permits cannot reopen history for recording.
- Formatter properties are captured once and private cached payloads are revoked on invalidation. Native async sinks are rejected before invocation; the supported handoff is synchronous. A wrapper deliberately concealing asynchronous work violates the sink contract and cannot make externally retained bytes revocable.
- Final export-read injection proves same-page deletion prevents sink invocation. With another instance, observed order is deletion requested → synchronous sink → deletion committed, because the final readonly transaction blocks the foreign deletion commit until handoff. A previously committed foreign generation change rejects delivery.
- Failure after a request succeeds still rolls back all durable stores. A valid live a2 tail survives deletion of a1; OFF cannot backfill an unrecorded tail. Whole-session deletion also removes its attempt tombstones.

## Not verified or not integrated

- Real browser origin/materialization remains blocked from the earlier bounded attempts. No actual Chrome/Firefox/WebKit reload was executed for these data batches.
- The public product UI, its current snapshot caches and its existing v22 data repository do not import this development data layer. Repository-owned export handles are revoked; full application-cache integration is not claimed.
- No native keyboard/IME/device capture, real quota exhaustion, long-duration recording, AI, cloud sync, or credentials were introduced or tested here.
- Assessment selection/regrade candidates, stable reward identity, review-instance scheduling and conflict-safe imports remain later independent batches.
- Deletion cannot recall already downloaded files or arbitrary immutable copies outside application ownership. The approved future history export path is the repository's opaque preparation/delivery API; the low-level serializer is not an authorization boundary.

The combined standalone harness is in `qa/data-development/`, outside the exported app. It uses only fresh random development databases and requires explicit button clicks. It is ready for a supported browser origin when available.
