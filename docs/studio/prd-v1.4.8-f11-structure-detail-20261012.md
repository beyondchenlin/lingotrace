# F11 structural local references and read-only history impact

Date: 2026-10-12. Base: `7b414419ae73146f88b444e77e5a0c76cc1f6935`.
Primary requirement: detailed v1.4.8 PRD section 2 (page 7), immutable reference
versions and merge/split unit lineage; section 17 (page 22), preserved original
attempts and explicit assessment selection. This increment implements structure
and revision notices, not the deferred assessment/adoption system.

## Reference identity and admission

The existing explicit local reference database/store/schema remains unchanged and
insert-only. Existing `local-reference-v1` bindings and receipts remain readable
and retain their exact shape. Structural materials use `local-reference-v2` with
`lineage: { operation, parentUnitIds, unitIds }`. The track, language, parent
version and verified media binding retain the existing semantics.

Merge consumes exactly the current unit and its next neighbor. Split consumes
exactly the current unit. Generated IDs are `unit:<immutable material version>:1`
and, for split, `:2`; source unit IDs retire in that descendant and are not reused.
The full saved parent materials and digests preserve the original units forever.
A unit can still occur unchanged in a sibling historical branch. This is not ID
reuse or a mutable “latest” reference.

The receipt's existing `change.cueId` and `after` point to the first new unit, so
existing explicit-start code has a precise target. `before` is the first consumed
parent. Complete multi-unit relationships are in the v2 lineage, and complete
before/after texts remain in the immutable full parent/child material snapshots.
The receipt is not misrepresented as a single-text-edit delta: validation branches
on the binding version and checks every consumed/resulting unit and all remaining
material bytes. Ordinary correction after a structural version produces a v1
single-unit delta linked to that exact v2 parent, preserving the chain.

Structural admission enforces:
- Exact canonical parent material, full ancestry and media identity/duration.
- Exact contiguous parent IDs; exact deterministic new IDs; no parent ID retained
  in the descendant; unchanged order and bytes for unrelated cues/material data.
- Merge 2→1 or split 1→2 only; finite times, 0 ≤ start < end ≤ actual duration.
- Original outer boundaries retained. Split halves meet at one strict internal
  point. Consumed parents and unaffected adjacent boundaries must not overlap.
- All texts have scorable English/numeric content and are bounded at 8,000 chars.
- A consumed cue with extra metadata is refused. Translation, word alignment or
  speaker annotations cannot silently be dropped or applied to a different unit.

Library save keeps the existing unique request index, whole receipt digest,
recursive parent validation, transaction-time ancestor-byte checks, insert-only
conflict behavior and validated readback. Reusing an ancestor version cannot
resurrect its retired IDs; the existing row/identity conflict refuses the write.
Readers of older application versions that do not support v2 can reject those
new rows while preserving old v1 rows; this is not a downgrade migration.

## Actual editor and host flow

`MaterialCorrectionPanel` adds explicit modes, two split texts and an absolute
split-time input. Structural outer times are read-only and protected in handlers.
The next unit is identified by ID/time only. It never silently reveals its hidden
reference text. Users may prepare/preview the original range before writing the
new units; valid new structure and explicit confirmation are needed only to save.
Changing mode/text/time invalidates proof and confirmation. Clicking an already
selected mode does not discard the current draft. New unit summaries and stored
version lineage display no unrequested original-reference text.

The preview reuses the existing verified original-media pool and bounded,
non-recorded video. Recording, hidden-page, unmount, changed target and late media
leases retain the existing invalidation fences. `Studio.saveEditedReference`
checks structure confirmation, exact original outer range and the composed preview
text, then verifies parent and media again before inserting the receipt. The
ordinary edit path is unchanged except for dispatching the optional structure.

Saving alone never invokes Training or changes the current draft/attempt/score.
Starting is still a separate explicit action. Exact selected receipt readback,
old allowed-history flush, final boundary/permission recheck and synchronous reset
fence remain in use. Fresh practice has no inherited attempts or earned words.
Recording preparation/in-progress/stopping and current-round save failures block
transition as before. New structural playback accepts v2 only through the same
exact library/media validation; no ordinary URL or estimated-duration fallback.

## Read-only historical impact

`reference-revision-impact.ts` consumes only a repository `list/subscribe`
capability. The list has already recursively validated receipts against the exact
canonical café original. The historical material is anchored by its complete
canonical digest plus material ID/version, not by a matching title or cue ID.

A branch-local graph walk propagates historical unit origins through text/time,
merge and split edges. It labels directly connected and later descendants, including
split→text→merge→text chains, and preserves each sibling's independent lineage.
A missing middle reference, unmatched whole-material bytes or sibling-only chain
cannot label the history as affected. The projection contains metadata and IDs,
not corrected text, answers or score values.

`HistoryReferenceImpact` appears inside complete history detail, including the
calendar's original-record route. It reports original sentence numbers, revision
kind and version. It reads afresh on explicit refresh, library invalidation and
foreground return; new scope, refresh and disposal immediately invalidate old
results. Late/failed responses cannot restore obsolete notices. Read failure or
unreadable records is unknown/incomplete; an empty match is not proof that no
revision ever existed. Partial saved segments do not contain an invented complete
reference and are not joined by unit ID alone.

There is no new Training/task/assessment writer, export mutation, cache, permission,
background recording, network upload or reference adoption in this observer.

## Verification and remaining acceptance

New failing tests preceded the structural core and editor implementation. A review
also found that initial merge/split preview was incorrectly gated by completed new
text; two actual-component entry tests reproduced that failure before the gate
was separated. The final focused checks exercise the actual component handlers,
actual extracted Studio functions, Training engine, history recorder, IDB library
and bounded media controller; only React scheduling/browser media primitives are
fake. Coverage includes structure tampering, ID retirement, invalid ranges,
metadata rejection, repeated saves, chain readback, no automatic start, old
attempt/draft/export preservation, explicit new-unit practice and verified v2
playback. Historical tests use real reference builders and IDB, plus lifecycle,
StrictMode, cross-scope and out-of-order read tests.

Focused/typecheck/independent-review results are recorded with the implementation
handoff. This task does not build, deploy or claim real browser/hardware acceptance.
The root release gate must validate the final combined commit before publication.
