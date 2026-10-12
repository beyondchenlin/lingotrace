# Saved Training v1 history HUD — bounded v43

Base: public v42 source `577b2923b8232a44cc497dcdf19d7403e58b0ecf`.

## Scope and data contract

The existing complete-history detail now adapts its selected, structurally validated Training v1 snapshot to the shared HUD library. It is a read-only production history view, not a fixture catalogue and not adoption of the isolated Practice engine. Stage layout, motion, input/scoring, media, automatic-recording controls, partial-history storage, and export paths are unchanged.

`projectLegacyHistoryHud` uses version `legacy-history-hud-v1`, explicit source `legacy-training-snapshot`, the retained session ID and sequence, and embedded material evidence. It never reads the current material catalogue. It rechecks the saved boundary and rejects a missing/mismatched material version or partial-record type instead of manufacturing a denominator.

- Words: original `earnedWords`, labelled as the original Training v1 confirmation rule. No realignment, rescoring or inferred unique vocabulary.
- Completion: original `completedCueIds.length` over the versioned material cues embedded in the same saved snapshot and matching `sessionStarted`. This is this material's completion ratio, not a universal learning score.
- Input rate: exact points from the existing `input.cpm.5s.v1` / `input.cpm.5s.v2` derivation. Unit is committed manual graphemes/minute. Energy values are not used. Sampling, pauses and unavailable observations remain null. Historical v1 limitations and v2 observation coverage remain visible.
- v42 partial segments do not supply these cumulative metrics, completion ratio or a reconstructed full CPM history. No zeros are substituted. Their existing separate retained-event view remains available.

## Shared appearances

Numeric words, progress ring/track, and trend line/time-bars use the same immutable metrics and existing `renderHudScene`. A selector changes only the node type, never values, timestamps, versions or the saved snapshot. Complete-history view is static; it does not simulate new observations or restart standby effects. Canvas falls back to visible text if drawing fails. Essential values, source labels, point details and selectors are native DOM.

The library schema gains only an additive explicit source discriminator. No registry, measurement formula or component implementation is replaced. Catalogue fixtures retain their existing labels and artifacts.

Trend windows retain every source point in source order. They split at observation run/segment boundaries, measured-path/null boundaries, version changes, repeated/reversed wall timestamps, and the existing library's 4096-point limit. They do not sort, deduplicate, average, interpolate, or bridge discontinuities. Coordinates are exact elapsed wall-time offsets from each window's recorded origin; original timestamps and point IDs remain in the projection and point table. A single-point domain has 1 ms of drawing padding only, explicitly not extra observation. All windows remain selectable; the initial window is the first containing measured values when available.

## Persistence and privacy

There are no save/delete/setting/permission operations in this adapter or view. The existing repository reader owns the selected immutable snapshot, navigation/lifetime invalidation and final guarded export. Style selection is transient React state and is discarded when the selected record changes. Original JSON/CSV remain the existing saved-history export, not chart data or recalculated outcomes. Retained full records and permission-filtered partial segments remain separate. No migration, new TrainingEngine or double writes are introduced.

## Verification and rollback

Program checks cover unchanged saved values, version evidence, partial rejection, v1/v2/null/clock boundaries, long-window pagination, both render styles at narrow/wide chart widths, no store mutations and original exports unchanged. Fake IndexedDB checks are isolated program tests, not browser-storage claims. Independent review and final public cloud-browser results are recorded separately in the task's `FINAL-ACCEPTANCE.json` after they occur.

Browser acceptance must compare an already saved nonzero record across both progress and rate styles, read null coverage, check actual Canvas output and selectors, and compare retained raw exported facts before/after. Stage and other-route preservation must be checked by source/artifact hashes. Physical phone/OS IME and all-browser compatibility are outside this increment.

Rollback to v42 restores the prior complete-history view while retaining the v42 IDB connection barrier and record controls. Do not roll back to an unprotected pre-v42 writer after a user has activated that barrier.
