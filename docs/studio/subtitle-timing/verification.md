# Subtitle boundary editor verification (candidate, not deployed)

Baseline: recovered and Git-blob-verified v76 release `98faf71bd72b09d346e0b89b72fa6a99fc363edc`. Implementation and additive overview/detail PRDs are scoped to the local subtitle workbench. The PRD pair was written before implementation, then clarified after independent review without enlarging scope.

## Verified by program checks

- Full core/scene suite: **1693 passed, 0 failed, 0 skipped**.
- Full media suite: **811 passed, 0 failed, 1 existing recorded-MediaRecorder-fixture skip**, 812 total. The added subtitle slice has 15 data tests and 7 pure/actual-callback UI tests; these are included in the media total, not additional counts.
- Typecheck: passed.
- Production build: passed (final artifact check recorded separately below).
- Actual recovered v76 reader accepts unchanged v1 output and rejects v2 timing output. New reader reopens a genuine old-reader-produced v1 and preserves its original history.
- Candidate repairs preserve original subtitle/model data, legal overlap and source order. New timing edits invalidate current word alignment. Unified text/time undo and branching replay validate all editable snapshot fields; malformed/tampered history is rejected.
- Actual DOM-event callbacks exercised numeric fields, mouse range controls, explicit 1/10/100 ms nudges, focus-local Space/arrows, native text/number focus preservation, pending text/time save isolation, cancel, unsaved download block, cue/version discard dialogs, boundary preview, fresh-duration errors, late play completion, visibility cancellation and conservative export duration.

The DOM substitute is program-level evidence. It does not establish rendered layout, actual audio output, touch, keyboard/IME on a device, or media timing precision.

## Independent review corrections

1. Export now shares the conservative current-player duration/source guard with editor save and preview. Identified 5 s media plus a later 8 s player duration cannot allow a preserved original 7 s cue to export.
2. Repaired source-cue out-of-bounds warnings remain visible as separate raw-current and raw-original risks; original measurement risk survives a later longer measurement. Revalidation budget reserves the new imported-source diagnostic.
3. The PRD explicitly describes boundary-only cancellation and existing text-transition discard. An explicit “discard and continue” cancels pending buffers before replacement; failed replacement preserves saved drafts but does not resurrect already-discarded staging.

## Reproducible setup and first-run failure

The first core run started while the lean sparse checkout was still expanding public media build inputs. It recorded 1688 pass, one missing NPS MP4 failure and four unavailable-v65 fixture skips. This is preserved in `first-run-setup-failure.txt`; it was a test setup race, not a missing asset in the recovered release.

The NPS input was then verified with `git hash-object` against the exact baseline Git blob. The immutable v65 archive was supplied using `LINGOTRACE_FROZEN_V65_DIR=/tmp/lingotrace-frozen-v65-audit`. The full final rerun passed as above. Installed package versions match package.json (including fake-indexeddb 6.2.5); only dependency packages are reused read-only, while source resolution stays in this candidate checkout.

Full logs: `/workspace/shared/lingotrace-subtitle-timing-evidence-20261011/`.

## Outstanding acceptance and scope

No browser or CUA session was operated by this implementation task. Root-owned rendered desktop/phone-size browser QA remains to be performed before deployment. No deployment, external subtitle/LLM request, added model, permission expansion, training-reference adoption, or change to the NPS access restriction occurred.

Waveform, merge/split, word realignment, automatic preview loop, formal confirmed-reference adoption and broad C acceptance are not part of this delivered slice. Native browser seek/stop has finite precision; millisecond controls do not imply frame-accurate or sample-accurate playback.
