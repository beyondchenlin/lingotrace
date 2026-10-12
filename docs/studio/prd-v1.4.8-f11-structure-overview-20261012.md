# F11 subtitle structure and revision notices: bounded delivery

Date: 2026-10-12. Implementation base: `7b414419ae73146f88b444e77e5a0c76cc1f6935` (published v88).

This is an additive, functional slice of the original independent v1.4.8 overview
(F11) and detailed PRD section 2, with section 17's original-assessment boundary.
It preserves the 161 prior documents, including v63's historical scope and the
v48/HUD/input/media/score single-source contracts. It does not replace those
contracts or treat all of F11 as finished.

## User flow

1. Open the existing current-sentence editor. Its actual current reference reveal
   is recorded through the existing Training exposure path.
2. Choose ordinary text/time correction, merge with the following same-material
   sentence, or split the current sentence into two. Merge keeps the combined
   original outer range; split keeps the original range and requires an explicit
   internal split point. The original range can be prepared and previewed before
   completing the new text. There is no automatic sentence boundary or text split.
3. Fill the complete merged text or both split texts and explicitly confirm the
   new structure. The following original sentence's hidden text is not displayed
   by choosing merge; use the original audio to fill the merged text. The form
   warns about multi-speaker or misaligned material.
4. Save an immutable local version after proving exact media identity and actual
   duration. The operation creates new unit IDs and parent/child lineage. It does
   not create attempts, complete units, award words, rescore or switch the current
   round. Edited text/time and structural edits invalidate the prior preview proof
   and confirmation. Repeated unchanged saves reuse the save-request identity.
5. Explicitly select a saved version and use the existing guarded end-current /
   start-new-round action. Old permitted work is safely flushed before the new
   reference session starts. It starts at the first newly created unit and shows
   that reference through the existing explicit confirmation flow.
6. Open a saved complete history record, directly or from the calendar. The record
   shows direct or subsequent verified reference revisions affecting its original
   sentence numbers. Old text, answers, grades and exported facts remain intact.

## Boundaries

- Original café media and its verified local reference descendants only. No
  imported track editing, cross-media merge, AI, upload or new persistent access.
- Merge is two adjacent units; split is one unit into two. Both use finite valid
  times and scorable nonempty texts. Unknown duration, overlapping boundaries,
  unknown per-unit metadata and unverified ancestry are refused, not repaired.
- Ordinary v63 correction remains compatible. Structural versions use a v2
  binding inside the existing insert-only library; legacy rows are not rewritten.
- History notices require a complete retained material and a fully verified local
  version chain. Partial records are not expanded or guessed. Missing/corrupt
  sources yield incomplete/unknown notices, never “unchanged”.
- Candidate regrading, currentAssessmentId selection, reward contribution
  replacement, revised task migration and corrected-version bookmarks are not
  implemented. This slice supplies no automatic adoption or score replacement.

See the accompanying detail document for identity, read fencing and verification.
