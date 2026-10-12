# PRD v1.4.8 F08 recorded metrics: overview addendum

Date: 2026-10-12. This is an additive implementation record; the original v1.4.8 PRDs and all earlier delivery records remain unchanged. It does not declare F08 or the whole PRD complete.

## Requirement and delivered slice

The original detailed PRD, section 14 (page 19), requests daily/weekly figures, explicit statistical time zone, numeric accessible calendar details and source access. Section 15 (page 20) requires fact-based recomputation, stable identities, daily/weekly distinct sets, local-midnight and DST treatment, union of overlapping time, and unknown rather than zero for missing coverage. The partial-history restriction remains in force.

The existing production record calendar already indexed saved full-session events and partial-segment facts by occurrence date. This increment adds:

- Selected date and its Monday–Sunday week: recorded submissions, recorded first-completed sentences, recorded distinct matched terms, and only provable legacy input-active minutes.
- A Today shortcut, date-button accessible numeric labels and a list alternative.
- Per-metric session/event provenance with links through the existing guarded original-record reread. A reliable interval spanning intermediate dates also makes its contributing records reachable on those dates.
- Explicit unknown fields, incomplete coverage, excluded-conflict notices, and documented metric definitions in Chinese and English.

No heatmap threshold, mastery level, streak, achievement or reward rule is introduced. Training HUD, grading, attempts, recording settings, storage schema and exports are unchanged.

## Meaning of the figures

Recorded submissions count retained submit-request identities, deduplicated by session + attempt. Pending, redacted or ultimately discarded requests remain recorded submission occurrences; they are not successful judgments or completed exercises.

Recorded first-completed sentences use a safely linked full record's saved `firstCompletion`. They are deduplicated by session + material + material version + cue and assigned to the source full judgment date. Partial records do not contain this field and cannot manufacture it.

Recorded distinct matched terms use only safely linked saved `match.expected` results. Daily and weekly sets are independent; weekly terms are not the sum of daily distinct counts. This is not evidence of vocabulary mastery.

Input-active minutes retain Training's old input-time definition, excluding listening, IME composition, idle and dialog time. Only retained endpoint/elapsed-time agreement and source consistency admit an interval. Others remain unknown. This is explicitly **not** the PRD's complete learning/practice-duration measure, which can include observable listening, reading and thinking without keys.

## Still open

- The PRD-complete practice-duration collection contract, registry and unified snapshots.
- Historical collection coverage intervals, full-day confirmed-zero evidence, first visit/practice semantics and device/account coverage.
- Approved fixed heatmap thresholds, metric switching, achievements and broader profile/summary integration.
- Final aggregate validation, production build and deployed browser acceptance for this increment. Source-focused tests do not substitute for these stages.

Implementation details and verification boundary: [detail addendum](./prd-v1.4.8-f08-recorded-metrics-detail-20261012.md).
