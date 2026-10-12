# Batch 2B: attempt erasure and authorized history export

Status: isolated implementation and independent program review passed on 2026-10-08; native browser and product integration remain unverified. This is a development-data contract, not a claim that the public product supports deletion or that a real browser passed it. Batch2A remains frozen at `f9cd7f61dc965744a54932ba5f8b4f83054c809f`; v22 UI/storage remain separate.

## Why a new replay version is necessary

In the dependency fixture, a1 contains an initial answer, revision, hint, correction and timing; a2 retries it, submits a correct answer in 5 seconds, then retains a new unsubmitted draft. Removing a1's old rows directly breaks current-attempt timing and parent validation. Hiding its projection leaves the original answer in the canonical events. The fixture probe demonstrated both failures before implementation.

The deletion contract must physically replace the affected canonical facts. It must preserve a2's own answer, draft, reference, alignment, 5-second duration and honest assisted-exposure conditions. It must not convert deleting a1 into deleting a2 or reclassifying a2 as an unassisted first answer.

## Explicit v2 data version

Standalone v1 snapshots keep their existing shape and meaning. A deleted-history snapshot explicitly uses `lingotrace-practice-v2`; its mixed event stream is interpreted by the same reducer with added privacy cases. Ordinary surviving v1 events retain their IDs, sequence positions, envelopes and payloads. The ordinary input/word-alignment/clock reducer is shared.

Synthetic v2 records have exactly `schemaVersion`, a fresh opaque `eventId`, original `sequence` position, `sessionId`, and `payload`. They contain no original timestamps, event IDs, hashes, encoded original values, input sources, draft versions, grapheme counts, answers or alignment. Generic `erasedSlot` records do not reveal whether the replaced fact was input, submission, or elapsed time. Keeping these slots retains the structural event count so surviving event identities need not be rewritten; erasing even that structural count would require a separate whole-stream identity contract.

Only necessary semantic boundaries survive:

- An answer-free attempt anchor, with minimal unit/mode/reference lineage only when a surviving retry or mode switch requires it.
- The first-submission boundary that determines whether a later exposure happened before or after the round/unit's first submission. It is not a surviving submission, completion, score or reward.
- A tagged redacted exposure summary containing only unit and kind. It contributes honest assistance to a2 without retaining a1's detailed exposure timestamp or original event ID.
- Necessary resulting pause/video flags, with no original timing envelope.
- A terminal committed-redaction record and minimal attempt tombstone.

a1 never appears as a fake empty or zero-scored attempt. Normal attempt projections, counts and elapsed time include retained attempts only. Deleting the current attempt leaves no current attempt; it never jumps to an older attempt. Reusing the deleted stable ID is invalid. Repeated deletion is idempotent.

V2 validation requires committed targets, valid current lineage, contiguous sequence and exact schema fields. It rejects orphan synthetic records, synthetic records mislabeled as v1, original target-owned facts retained in a deleted stream, wrong or noncurrent parent anchors, duplicate IDs with altered content and timestamp-bearing synthetic records. A live engine cannot dispatch privileged redaction markers as ordinary practice commands.

## One durable deletion transaction

Only the isolated `lingotrace-dev-fenced-*` database upgrades, in place, to add minimal attempt tombstones. It does not copy the old answer-bearing session to another database, back up deleted content, or migrate v22. Schema upgrade and old v1 read compatibility require tests; old executable code opening the database with a fixed older IndexedDB version is not a rollback mechanism.

`deleteAttempt` synchronously fences that session's old permits and pending exports before awaiting storage. Its readwrite transaction reads control, parent head, canonical facts and session/attempt tombstones; checks permission and generations; replaces the session facts; updates the v2 head and deletion counters; and writes the minimal tombstone. Success is reported only after commit. Failure rolls back all stores and leaves local old permits revoked. No old callback may create a missing parent or append through an obsolete generation.

An optional current live snapshot can preserve a2's not-yet-saved tail only if its opaque permit, recording permission, durable generation and exact persisted prefix all pass inside that same transaction. A newer/divergent durable tail must not be overwritten. OFF forbids backfilling any unsaved tail. Without an accepted live tail, deletion operates on durable facts only; the caller must not silently replace a temporary off-period engine with an older returned snapshot.

After commit, a new permit may accompany the sanitized snapshot only when the caller supplied an original permit that was still valid before the deletion fence and current page/durable state still allows continuation. Historical deletion without that permission, a new instance that merely loaded history, OFF→ON, foreign permits and older repeated-delete permits return `permit: null`; deletion never admits an existing historical session for recording. A later OFF prevents permit issuance without turning a committed deletion into a failed deletion. A later deletion/clear that supersedes the receipt also suppresses its obsolete snapshot: `deleted: true, superseded: true, snapshot: null, permit: null`. Late loads are checked after their final observer notification so they cannot refill a cache after a newer deletion intent. A future controller must replace its own current snapshot with valid sanitized state while preserving legitimate current work; new data is not wired into the public UI yet.

## Export is a capability with a final check

`exportPracticeSnapshot` remains a low-level serializer for compatibility and deterministic tests. It can serialize arbitrary caller-owned old objects, so it is not the authorized new history UI path.

The authorized path is `prepareHistoryExport(sessionId, exportedAt)` followed by `deliverHistoryExport(handle, synchronousSink)`. Preparation reads current canonical repository facts and returns an opaque handle; it does not expose JSON, CSV, a Blob, or a snapshot. The repository owns the cached payload. Deletion, clear and disposal synchronously invalidate affected handles and pending preparations. A formatter finishing late cannot make an invalidated payload available again.

Final delivery reads the durable parent and generations again in a transaction, checks local deletion epochs, and hands off the JSON/CSV synchronously in that same request callback. It cannot await another operation between the final check and delivery. A foreign deletion transaction cannot commit between that check and handoff. Handles are instance-owned and one-shot; private payloads are dropped after delivery or invalidation. A clear, failed local deletion request, close, or remote committed generation change must also suppress stale delivery. Saved history can still be explicitly exported while recording is OFF.

The application must invalidate all snapshot/export caches it owns and route recorded-history downloads through this repository path. Already downloaded files and arbitrary immutable copies outside the application's control cannot be recalled. The new adapter is not connected to v22's current UI or existing stored history, so it does not claim to erase those independent copies.

## Verification gate

Tests were written before the new APIs existed. The 45 new deterministic checks cover dependency replay, raw contents of every persistent object store, JSON/CSV contents, current and unsent attempt deletion, retry/mode-switch exposure, repeated deletions, live-tail conflicts/OFF behavior, local and remote stale permits, transaction rollback, async formatter completion after delete/clear, final delivery generation, and v1/v22 regression. The full primary runner reports 150 passing results and the media runner 42; the legacy training file also reports its 16 internal checks. Strict TypeScript and the local Next static build passed. Independent review additionally compared against the actual frozen v1 reducer and exercised 960 continuous deletions across 80 lawful histories. Native-browser reload and actual application-cache behavior remain separately labeled until executed.

No audio/assessment/review/award stores exist in this isolated batch. Their later cascade rules are not claimed implemented by a tombstone or an interface alone. No cloud sync, AI or credentials are added.
