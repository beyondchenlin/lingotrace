# Listening B per-record wrapper candidate

Status: implementation/review candidate, not final acceptance or release approval. 2026-10-11.

## Scope and invariants

The first answer-bearing B layer must wait for a committed scope marker. Ordinary pre-B sessions and global recording settings remain unchanged until explicit B scope admission. No database version upgrade is introduced by this wrapper, and no Training round is reset. Existing OFF/ON controls retain their existing independent behavior.

Full legacy-default mode wraps the selected `sessions` row with `version: listening-session-v1`. The legacy `snapshot` property is a sentinel `{schemaVersion: listening-session-v1, events: null}`. The unchanged actual Training snapshot is retained as `trainingSnapshot`. `preBRecord` retains the exact previously committed legacy row, or null when no such row existed. It is a recovery receipt, never evidence that the current round was unassisted. The wrapper also includes immutable scope identity/admission sequence and versioned conditions evidence. Unknown keys, versions, invalid coordinates, identity mismatches and unsupported conditions fail validation.

The old reader rejects the sentinel schema; the old writer fails before its first mutation when it tries to access the sentinel event prefix. Compatibility claims require tests against frozen actual release code. Existing independent unwrapped sessions remain usable. The updated bare `saveSession` explicitly refuses a wrapped session.

## APIs and atomicity

- `beginListeningSessionScope(snapshot, {scopeId, startedAt, referenceVersion})` returns a page-local permit and committed wrapper. It checks legacy-default permission in the same transaction as sessions/events/meta writes, compares the stored immutable prefix and preserves the exact old row.
- `saveListeningSession(permit, snapshot, conditions, expectedRevision)` atomically persists the immutable Training prefix and conditions. Every actual submit after admission requires its exact request/attempt/cue/input-version boundary. Frozen assistance and exposure lists cannot change. Only pending disposition may advance to retained or discarded. Exact retries do not rewrite; stale or conflicting batches fail.
- `revokeListeningSessionScope` cancels queued/in-flight writes synchronously. OFF uses the existing epoch fence and aborts active transactions without first flushing. No post-OFF tail can be resubmitted with the old permit.
- `loadLatestListeningSession`, `loadListeningSession` and `listListeningSessions` are read-only. They never create storage or grant a writing permit.
- `resumeListeningSessionScope` is an explicit page action, verifies the complete unchanged durable envelope, and requires current legacy-default permission. The host must restore Training and its conditions together and downgrade future coverage after observation continuity is lost. It must never restore the pre-B receipt as a clean continuation of the same round.
- `deliverListeningSession` rechecks the complete wrapper under a readonly transaction before a synchronous export sink. Export retains the wrapper, conditions and receipt.

The browser presentation boundary is not an IndexedDB transaction. The marker therefore commits before display; actual visible presentation is captured synchronously in memory, then its append-only evidence is saved asynchronously. A crash between those steps leaves a B-marked scope, so missing evidence cannot imply independence. During submit, capture precedes the real engine submit, and conditions completion follows it synchronously. Host persistence must wait until that synchronous operation finishes; no fake input, attempt or request is manufactured.

## Partial/OFF privacy

`beginPartialListeningScope(segmentId, options)` requires the repository's live, page-local segment permit and persisted matching generation. It stores only a strict `meta` marker containing segment/session/material/reference identity, admission fact count and `coverage: unavailable`. It does not store a full snapshot, pre-B receipt, prior draft, answers, reference text or pre-admission exposure. Existing partial facts stay under their original projector's redaction rules. Partial assistance is unknown; this candidate does not claim complete negative exposure evidence for partial history. Consumers/exporters must retain this marker beside partial records rather than treating absence of positive sidecars as independence.

## Tests and remaining review

Repository tests cover exact old receipt preservation, unchanged database/settings, real assisted first submission, immutable boundary/prefix conflicts, missing boundaries, injected transactional failures, queued OFF cancellation, OFF-to-partial private-text exclusion, read/export roundtrip and permit resume/revocation. Standalone metric tests cover span/gap persistence separately. Independent frozen-release tests establish old-reader/old-writer fail-closed behavior. These tests are not a substitute for host/browser acceptance: marker-before-render ordering, native submit boundaries, restore coherence, partial display/export, and actual visibility/audio handling remain integration obligations.
