# LingoTrace HUD component library v0.2 — grouped and calendar displays

This is the second isolated component batch, an additive expansion of the display schema version 1. It adds three independent transparent components, not a new dashboard or production adapter. The existing app, data ledger, database, media recorder and grading rules remain unchanged. The original four components retain their contracts.

## Data contract first

### Bar chart

`BarMetric` requires an explicit `grouping.kind` (`interval`, `sentence` or `category`), a grouping label, a shared quantity `unit`, 1–8 named groups, and a zero-based value domain. Every group has a stable ID, label, `value|null`, `coverage` and `sourceEventIds`. Interval groups additionally require a numeric start/end and an explicit seconds/milliseconds interval unit. Intervals must be ordered and non-overlapping; the renderer never bins or totals raw events.

Complete coverage requires a finite nonnegative quantity. A supplied 0 is visible as an actual zero. Unknown coverage requires null and is shown as unknown, not an empty bar mistaken for zero. Partial coverage may have an observed subtotal or null; a hatched marker and “partial” label preserve that distinction. Values outside the declared domain reject instead of being silently shortened to fit.

### Target interval

`TargetBandMetric` requires an explicit actual `value|null`, target `min|null` and `max|null`, and finite display scale. Known target bounds must satisfy min ≤ max and fit inside the supplied scale. An exact-point target (equal min/max) is allowed. A missing value or bound remains unavailable; it is never filled with zero.

The actual supplied number is always preserved when available. Below/above-target states are explicit. If actual value lies beyond the display scale, the visual marker becomes an outward arrow at the scale end and the actual number plus “outside scale” label remain visible. Positioning an overflow marker is not clipping or rewriting the metric value. The renderer does not infer a target or outcome from old attempts.

### Learning calendar heatmap

`CalendarMetric` requires a fixed inclusive `startDate`/`endDate`, explicit IANA timezone, caller-chosen Monday/Sunday week start, quantity unit, color domain, and one explicit day row for every date in the window. Dates are real Gregorian YYYY-MM-DD in 1900–2199; the window is at most 112 days. Missing/duplicate/out-of-order dates reject. Callers represent missing coverage with an explicit unknown day.

Each day has date, `value|null`, coverage (`complete`, `partial`, `unknown`) and provenance IDs. Complete 0 is an outlined zero-activity cell; unknown is a diagonally marked empty cell; partial coverage has a separate hatch/corner mark even if its observed subtotal is 0. Unknown must be null. Partial null remains partial/unavailable. Color intensity uses only the supplied domain and supplied value; out-of-domain values reject. No daily aggregation, date-to-timezone conversion, “today”, streak, ranking or invented history is computed by the renderer.

The timezone is displayed to identify the caller’s already-aggregated civil-date boundary. Pure Gregorian date helpers only lay out these explicit days into week columns and weekday rows. All fixture dates are fixed in source. Rendering does not read the current date or clock to create or shift a calendar window.

## State and integration boundaries

All three components follow the existing ready/no-data/paused/error states, readonly frame, explicit clock, tokens, local backplate/outline, opacity, anchors, safe bounds and accessibility description contracts. These new visualizations are naturally static; changing only clock cannot move them. Errors hide numeric content. No-data never becomes zero. The calendar still distinguishes unknown cells in its explicit supplied window.

Production integration remains a pure adapter from existing authoritative event projections to MetricFrame. No adapter or second set of production input facts is included. Samples are fixture data and are labeled both in the showcase and within each component.

## Implementation

The registry now marks all seven delivered component types implemented. New modules are `components/bar.ts`, `components/target-band.ts`, `components/calendar.ts`, `calendar.ts` and `validate-batch2.ts`. The existing renderer dispatches all seven types and uses the same state isolation and accessible-description path. No animation timers, recorders or source-data listeners were added.

| Component | Minimum logical size | Default logical size |
| --- | --- | --- |
| bar-chart | 320 × 230 | 480 × 270 |
| target-band | 320 × 180 | 480 × 250 |
| calendar-heatmap | 340 × 260 | 480 × 300 |

Partial coverage is itself a supplied fact: even when every partial row has a null quantity, its partial marks and accessible descriptions remain distinguishable from all-unknown rows. Such a frame does not acquire a fabricated zero. A target interval with unknown bounds can still show its separately supplied actual quantity with an unavailable-target label.

The developer server also offers the isolated second specimen page at `http://127.0.0.1:4196/batch2` after running `node studio/hud-library/showcase/serve.mjs`. It has fixed fixtures and state/contrast controls only. There is no production UI route or database hookup. Both first and second specimen pages bundle using already-installed dependencies.

## Verification

```sh
node --import tsx --test studio/hud-library/layout.test.ts studio/hud-library/tests/*.test.ts
npx tsc --project studio/hud-library/tsconfig.json --noEmit
node --import tsx studio/hud-library/showcase/render-batch2.ts /tmp/lingotrace-hud-v02
```

The focused suite passes 71 tests: the original 42 plus the new component/date/coverage checks. Gregorian arithmetic is also independently cross-checked across all 109,573 supported dates, including leap centuries, against explicit UTC-date calculations. The new shapes have ready/no-data/paused/error tests, immutable input tests, static-clock tests, minimum-size rendering, coverage pixel comparisons, range/interval rejection and exact overflow/unknown-target descriptions. Both showcase entrypoints bundle successfully.

An independent review identified and rechecked the all-partial-null coverage case before delivery. Its additional 120 malformed-input checks and 24 minimum-size/extreme-value rendering checks passed, with no remaining must-fix findings. The HUD-only TypeScript project passes. A whole-repository typecheck was green earlier in this batch, but is not claimed as the final aggregate result: the parallel data-2B branch is actively changing ledger unions and exports. Its in-progress errors are outside this component batch. No data-owner files were changed or reset.

The three single-component PNGs and contact sheet are program-rendered fixed-fixture examples, **not browser screenshots or final visual acceptance**. Real browser interactions, physical IME, media compositing, recording parity and public deployment remain untested/unperformed in this batch.
