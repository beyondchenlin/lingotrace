# PRD v1.4.8 F08 recorded metrics: detailed addendum

Date: 2026-10-12. Companion to the [overview addendum](./prd-v1.4.8-f08-recorded-metrics-overview-20261012.md). The historical [record-calendar contract](./readonly-record-calendar.md) describes the earlier date-only slice; its source privacy, read-only and incomplete-coverage boundaries remain applicable. This addendum extends the ephemeral projection and UI, without changing any original facts or old document.

## Source and projection contract

`studio/core/record-calendar-metrics.ts` accepts structurally admitted legacy full records or partial segments. It never calls the engine, reducer, replay or alignment scorer, never reads the live engine, and never looks up a current material version. The scanner traverses both source families and every page, then incrementally combines compact evidence. Refresh/zone-change/disposal fences remain the existing reader's responsibility.

Persisted raw text is processed only inside each source projection. The accumulator retains identities, hashed comparison/term evidence, dates, interval endpoints and provenance, not raw answers, drafts or alignment arrays. Public snapshots contain numeric values, unknown counts and session/event/record IDs only. No new storage, cache, analytics upload, permission or recording collection is introduced.

The source key is `(sessionId, sourceEventId)`. Same-source evidence is merged across records and pages. Overlapping known fields must agree; absent/redacted fields do not assert an alternative value. Contradictory rules, occurrence time, type, cue/material context, retained text, result, duration or interval predecessor quarantine the affected evidence. All attempt identities claimed by a colliding source ID are quarantined, independent of scan order. Late-page conflicts retract earlier contributions.

## Numeric definitions

1. Submissions: distinct `(sessionId, attemptId)` with retained `submitRequested` facts. Repeated requests map to their earliest safely dated occurrence. Inconsistent context/answer or unlocatable duplicates cannot establish that date. Counts are requests, not accepted judgments or completed exercises.
2. First-completed sentences: a full saved attempt must match its judgment's identity, time, cue, rule, input version, active counter and embedded reference, and have a preceding matching saved request. Only that full judgment's own date supplies completion time. Saved `firstCompletion: true` is deduplicated by session/material/version/cue. `false` can establish a recorded zero contribution; absence remains unknown. A partial record never supplies the missing flag.
3. Matched terms: a saved judgment must have a preceding retained request with the same attempt, cue/context, rules and answer. Different effective judgments for the same attempt are ambiguous and excluded. Saved alignment gets structural cross-checks (valid unique expected positions/counts, matching text for `match`, bounded errors), without calculating a new score. Exact saved expected terms are hashed and set-deduplicated separately per date and per week. No term text is put in the calendar view.
4. Input-active time: only `timeAdvanced` evidence is eligible. A full record must have a matching saved active-counter increment; a partial fact must explicitly say `observed`. An immediately preceding retained source occurrence must supply the start. Its wall interval and `deltaMs` must agree to floating-arithmetic epsilon (0.000001 ms); rounding uncertainty or shifted clocks do not create a guessed interval. Explicit retained pauses/composition gates contradicting an active claim are rejected. Known frozen facts are excluded rather than mislabeled missing active time. A missing predecessor, boundary-unknown duration or inconsistent endpoint leaves this metric unknown.

Admitted intervals use the existing `practice-calendar.ts` IANA/DST splitter. Daily and weekly duration is the union of all admitted intervals across records, sessions and pages. It is not the sum of per-tab elapsed counters. The UI labels this as **recorded input-active minutes (legacy definition)** and publishes its exclusions; it does not implement the full section 14 duration definition.

## Missingness, UI and provenance

Every evidenced day/week still has `partial` coverage. A completed scan means only that the currently retained readable rows were scanned; it never proves full-day observation. Absent dates and metric fields are unknown, not zero. Unknown contributions remain visible beside a known lower bound. Current history OFF is a separate present setting and does not paint a historical OFF journal.

Metric cards show counts/units and a collapsible list of the contributing or unresolved source-event identities. Links invoke the existing exact-identity reread; the original full/partial panels keep their guarded export behavior. Week links can open a record on another date, so the detail heading shows original event dates, rather than falsely labeling it as the selected day. Source text stays inside the existing original-record detail.

Calendar markers remain categorical F/P presence. Proven cross-day interval contributions supply source links even on intermediate dates with no event endpoint. Date-button accessible names carry numeric values and unknown state, and a date-list alternative remains available. No color/intensity bins were chosen.

## Verification and remaining acceptance

The new focused tests cover real full/partial counts; repeat/import/source and attempt identity dedupe; completion-date authority; partial missing fields; separate weekly term sets; pending/redacted/unavailable requests; malformed result structures; conflicting rules and source ordering; order-independent event and interval conflicts; safe cross-midnight/time-zone/DST intervals; union of overlaps; explicit pause/composition contradictions; rounding-uncertain time; and absence of answers in public snapshots.

Reader integration tests cover numeric accumulation over 101 records/two pages, late-page retraction (100 → 99), cross-family identity merge, source reread and time-zone rebucketing. UI integration tests cover day/week cards, units, unknown counts, source buttons, conflict notices and intermediate-day interval links. Existing calendar cancellation, race, pagination, exact-source selection and read-only IndexedDB checks are retained.

An independent source reviewer supplied separate adversarial probes. Their discovered ordering/association cases were fixed with named regression tests before the final source verdict. Root integration owns aggregate tests, production build and deployed browser acceptance; no build or deployment is performed by this slice. These stages must be reported separately, and this addendum does not assert they have passed.
