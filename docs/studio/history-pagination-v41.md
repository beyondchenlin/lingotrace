# Read-only legacy history pagination (v41 candidate)

Baseline/rollback: public v40, source aaf773e93d4013de0518c01c996609a18dc5672f. This is a bounded correction to the existing PRD v1.4.6 history-view goal. It does not adopt Practice, change recording policy, alter a score, or migrate a record. OFF-only work remains on separate branch history-off-candidate.

## Confirmed defect and correction

v40 retained and displayed only the newest 100 summaries. It exposed hasMore as explanatory text, but gave no route to earlier records. The data existed but was inaccessible from the view.

The list now has previous/older batch buttons. Each query retains at most 100 summaries, using a timestamp plus primary-key cursor. Detail/back keeps the current batch. Only cursor boundaries are retained, not all historical snapshots. A failed next/previous read preserves the present batch and provides retry. Refresh starts at the latest records. Late replies after refresh, selection or close cannot replace the current view or trigger downloads.

The existing v1 database has no date index. Each batch still scans a readonly cursor; it does not create an index, upgrade the schema, or use an unbounded getAll. Sort order is saved updatedAt descending, then IndexedDB primary-key order ascending. Invalid or missing dates sort last; malformed records remain distinct unavailable entries. A removed boundary record does not prevent continuation because its key/time boundary is self-contained.

## Concurrent changes and truthfulness

Each batch is a fresh committed readonly view, not one long database snapshot. If another page changes a record's saved time across the boundary, refresh is the way to see its latest position. No claim of a frozen complete calendar is made. Cursor metadata is ephemeral, contains no answer or score, and is not exported.

Time labels continue to distinguish creation time and last saved time, displayed in the current device timezone. Version labels and unknown-rule export restrictions remain the v40 behavior. Empty first history, an emptied later batch, unreadable records, and failed reads have different states; none imply a zero learning score.

## Verification boundary

Program checks: multi-page traversal beyond 205 records with equal timestamps and malformed keys; cursor validation and mutation; deleted boundaries; unchanged stores/save status; retry/repeated clicks and view lifetime. These use the actual adapter with isolated fake-indexeddb, not a real browser. Separate cloud-browser readback is recorded in the final acceptance artifact.

The accepted stage layout, renderer, motion, input/IME, media/recording and TrainingEngine remain byte-identical in source. Story and HUD-gallery public resources remain protected by the normal two-route assembler. Physical mobile/OS IME and new record-policy controls are outside this patch.

Candidate gates: 417 core/scene and 57 media tests passed; full TypeScript and Next static build passed. Independent bounded review reran all 31 history/reader tests with no blocking finding. These gates are program evidence, not browser pagination qualification.
