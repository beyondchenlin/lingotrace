# Read-only record calendar

This implements the traceable date-entry part of PRD148 F08, P216 and P225–P231, subject to the production partial-history restriction in P439. It is **not** the complete learning-minute heatmap, a streak, a daily score, or a claim of full-day collection coverage. No thresholds or reward rules are introduced.

## Source and date contract

- Production legacy snapshots contribute only saved `events[].wallTime`.
- Production partial segments contribute only retained `facts[].wallTime`, including the occurrence of redacted facts without recovering their text.
- `updatedAt`, session creation dates, segment admission/ending metadata, attempt summary dates, active-time counters and the live in-memory engine never supply missing event dates.
- Timestamps must be valid Gregorian ISO instants with an explicit Z or numeric offset. Ambiguous or invalid times remain unlocated, with visible counts. Empty segments establish no practice date.
- The selected IANA display zone is explicit, initially taken from the browser when valid (UTC fallback), and is never persisted. Monday starts the visible week. Changing zone re-reads/re-buckets facts; it does not migrate facts, allocate durations or grant rewards.

Every evidenced date has partial coverage; every absent date is unknown. A complete saved session is not a complete observed day. There is no historical OFF interval journal in the current schema. The current OFF setting may be shown separately, never painted onto past dates.

## Read and navigation contract

Both source families are scanned through all existing repository pages. List sort metadata does not filter the selected month. Reads use existing short-lived read-only history connections; no new storage/index/version is created. Invalid/stale/missing records and failed pages preserve an incomplete state; cancellation never turns missing dates into zero.

The ephemeral index contains only record identifiers, material identifiers/versions, distinct date labels, source revision metadata and an exact SHA-256 source identity. It retains no answer cache. Date projection yields in bounded event batches; the scan yields between pages and record batches. Existing repository validation and single-source canonical hashing still have per-record processing cost; this is not an unlimited-size performance claim.

Month navigation cancels pending selection but does not discard an all-date scan. Zone changes, refresh, cancellation and disposal fence previous jobs. A date click rereads and hashes the source. The existing full/partial detail panel rereads again through an identity guard, then retains its original guarded export behavior. Calendar detail mode cannot navigate unrelated history lists under the selected date heading.

## UI and acceptance

The existing history panel gains one calendar tab. Month navigation, accessible date buttons, a date-list alternative and original-record links stay inside that panel. Marks are categorical full-record/partial-segment presence, not numerical heat levels. Main Studio layout, animation, attempts, scoring, current drafts and privacy settings are untouched.

Program coverage includes explicit-zone validation, impossible/leap dates, offsets, DST/midnight, month boundaries, both source families beyond 100 records, unknown/empty/OFF evidence, source drift, malformed pagination, cancellation, late results and guarded detail handoff. Actual cloud-browser navigation is a separate acceptance result; physical-device acceptance is not inferred from these tests.
