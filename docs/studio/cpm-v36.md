# v36: honest five-second input rate in review

Baseline: accepted v35 `e94abb60f1e70e00681a41d1ec846b3106398450`. PRD v1.4.4 section 5 remains the metric contract. This batch fixes the review's misleading CPM label. Stage geometry, continuous visual energy, media/camera/recording, storage schema and Practice adoption are unchanged.

## Preserved legacy meaning

`TrainingSnapshot.pace` and `paceTimeline` keep the exponential visual-energy meaning and version. Existing raw events, attempts, results, first answers and credit are not migrated or rewritten. New same-text native replacements may add observation points with unchanged energy; old logs replay identically. The old reference-only rendering remains explicitly simulated.

## Additive facts and projection

New `inputCommitted.nativeEdit` provenance has version `dom-edit-v1`, event kind, native inputType, and actual native insertion data (not copied paste contents). This is optional for reading old events. A committed manual insertion with unchanged final text is recorded without increasing draft version, energy, attempt count or credit. A same-task final IME input tail is consumed once after compositionend; later intentional replacement remains distinct. A DOM event does not prove a physical keyboard was used.

`inputRateTimeline` version `input.cpm.5s.v1` is a read-only projection exported additively in JSON and matching CSV records. It uses native inserted graphemes, not length differences or energy. CPM is 12 times the count in the left-open, right-closed window `(t−5000ms,t]`; WPM is only CPM/5. Wrong letters count. Paste, explicit deletion, undo/redo, drop and browser replacement do not. Missing/unknown legacy operation data yields unavailable, including shrinking edits; missing Intl.Segmenter also yields unavailable. Unicode/ICU-version cross-runtime qualification remains untested.

An uninterrupted observed window under five seconds is null / sampling. Freeze reasons, offline gaps and clock discontinuities restart coverage. Unavailable and sampling points are not plotted as zero or bridged. A fully observed window without qualifying input is zero. Standby animation creates no events or samples.

Examples: one `a` at 0s, `bc` at 1s and `de` at 2s gives null at 4.999s, 48 CPM at 5s, 24 at 6s, and 0 at 7s. Native selection replacement `hello→he` with data `e`, followed by intentional same-text replacement with data `e`, gives two characters (24 CPM) within a complete window; text-diff reconstruction incorrectly gave zero. The legacy energy example was 20 initially and 3.7775 at 5s, formerly mislabeled as 4 characters/minute.

## Explicit implementation gaps

The current TrainingEngine freezes its practice/observation timeline during IME composition. Final IME data is retained once, but repeated compositions can remain sampling indefinitely; measured IME numeric rates are not complete. The future decision is to separate input-rate observation time from practice time. For example, five final IME graphemes committed across five wall-clock seconds should eventually be comparable to a documented 60-CPM observation without counting composition intermediates. This batch neither lowers that PRD requirement nor silently changes freeze timing.

Physical keyboard/OS IME and browser-specific native event order require actual-browser validation. The current automatic tests use deterministic event evidence. No Practice cutover, legacy data migration, dual writes, calendar UI, AI or cloud synchronization is included.

## Release boundary

The controlled assembler updates `/studio/` and `/portrait-preview/` to the same corrected review/export/native-evidence code, retaining existing public assets and all story/root/demo bytes. The accepted renderer and CSS files are unchanged from v35. The six-file history foundation is a separate main commit `c5c22bd6bae0075b111e9af09829425ad4db4c51`, excluded from this public release. Browser acceptance is recorded separately from program tests/build.
