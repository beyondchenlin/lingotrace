# LingoTrace HUD component library v0.1

Status: isolated developer implementation and program-rendered specimens. This is a reusable technical and visual baseline, **not final HUD visual acceptance**, a redesigned training screen, or a deployed public route. No paid assets, new chart library, dependency changes, user database reads/writes, or modifications to the existing app/scene renderer are included.

## First release inventory

| Component ID/type | Implemented behavior | Minimum logical size |
| --- | --- | --- |
| `numeric` | Supplied exact value, declared display precision and unit; no grading | 190 × 136 |
| `trend-line` | Supplied observations, explicit null/paused/missing segments and maximum-gap rule | 270 × 180 |
| `input-pulse` | Optional deterministic event-driven `wave-scan`, or precise `event-stems` | 270 × 180 |
| `progress-ring` | Explicit numerator/denominator with an honest unknown-total state | 220 × 220 |
| `bar-chart`, `target-band`, `calendar-heatmap` | Registry entries marked `planned`; not renderable | Not implemented |

These are independent transparent components, not four rectangular score cards. Thin local scales, a controlled accent palette and restrained typography provide a common language. Each node can independently enable a local backplate and text outline for contrast on changing media. Program specimens are for inspection, not proof of browser contrast over all possible media. Generic motion-graphics HUD references inspired the component system; no commercial template or protected asset was copied.

## Directory boundary

```text
studio/hud-library/
  schema.ts                 readonly scene / metric / node / clock contract
  tokens.ts                 shared colors, typography and spacing
  registry.ts               implemented and explicitly planned capabilities
  projection-adapter.ts     authoritative projection integration boundary only
  validate.ts               runtime validation before any canvas mutation
  layout.ts                 pure anchors, safe clamp, grid/guide snap, alignment
  metrics.ts                display-only state, gaps and pulse waveform helpers
  renderer.ts               one Canvas compositor for all consumers
  HudCanvas.tsx             thin React canvas host; caller supplies clock
  components/               numeric, trend, pulse, ring and text helpers
  tests/ + layout.test.ts   focused deterministic tests
  showcase/                 isolated temporary-input and fixture developer harness
```

Nothing in this directory is imported by the public app in this batch. `showcase/` is not exported from the library entry point. The native textarea demo is not a new production input ledger or a replacement for the existing input-event projection.

## Data and node contract

`HudScene` requires its own `schemaVersion: 1`, logical `size`, a contained `safeBounds`, readonly nodes and a readonly metric map. This display protocol version is **not** the ledger version `lingotrace-practice-v1`.

Every node declares:

- `id`, implemented `type`, `schemaVersion`, human label/optional description
- `metricBinding`: exact `metricKey`, `metricVersion`, `schemaVersion`, `unit`, `source`
- `position`, `size`, one of nine `anchor` values, bounded integer `zIndex`
- shared color slots: text, muted, accent, accentSoft, track, guide, warning, error
- typography family/numericFamily/labelSize/valueSize; opacity in 0..1
- optional backplate color/opacity, optional text-outline color/width
- motion `subtle` or `none`; the explicit render clock additionally carries `reducedMotion`
- component-specific numeric precision, trend maximum gap, or pulse window/visualization

Every metric declares `metricId`, `metricVersion`, display `schemaVersion`, unit, source, quality, observedAtMs, sourceEventIds and state. Supported sources are `practice-projection`, `input-event`, and visibly labeled `fixture`. Quality is `measured`, `estimated` or `unmeasured`; unmeasured facts render as no-data, never a measured zero. Estimated source quality is visibly identified. A metric identity/version/unit/source mismatch rejects the scene. Unknown schemas, nonfinite values, duplicate IDs, undersized/out-of-safe-bounds nodes and unsupported components also reject before painting.

Metric payloads:

- Number: finite `value` or `null`
- Trend: strictly time-ordered `points` with `atMs`, `value|null`, `quality`, `sourceEventIds`, optional active/missing/paused state; explicit time and value domain
- Input pulse: actual committed event `id`, `atMs`, source typed/ime/paste/delete/other and nonnegative integer addedGraphemes
- Progress: nonnegative `numerator|null` and `denominator|null`

All `atMs`, observedAtMs, frozenAtMs and render clock timestamps must use a single caller-owned monotonic timeline. Do not mix ledger wall-clock UTC milliseconds with animation-frame-relative time. A future integration adapter owns that conversion and preserves actual `inputCommitted.eventId` values. The demo uses clearly local `local-input-*` IDs only.

## Truthful states and drawing rules

- `ready`: a supplied measured or estimated value. A real supplied zero is allowed.
- `no-data`: show a dash/message; no fabricated zeros, simulated trend history or outcome.
- `paused`: require `frozenAtMs`; moving pulse position freezes. Trend pause boundaries must be supplied as explicit null/paused points by the projection adapter. The renderer never bridges them.
- `error`: visible error/message without stale numeric result pretending to be current.
- Empty, all-missing, or unmeasured trends are unavailable. Time gaps exceeding maxGapMs split the line; missing points and pause boundaries stay open. Out-of-value-domain observations reject instead of silently clamping data. Points outside the explicit time window are clipped from display without changing the supplied history. Straight lines between supplied samples are presentation, not new observations.
- Pulse activity is input rhythm, never physiological heart rate. No BPM label exists. Only positive typed and committed IME events trigger waveforms. Paste/deletion do not create a pulse. Each eligible event drives a fixed short kernel; no randomness or autonomous beat occurs. An idle window returns to baseline.
- `event-stems` retains exact event locations. Reduced motion and explicit `none` automatically use this static preset, anchored to the latest observed event; new input can update a static visualization, but idle clock ticks cannot drift it.
- Ring denominator `0` or `null`, or null numerator, yields unknown-total/no-data, **not 0%**. An explicit zero numerator with positive denominator is valid 0%. Over-target values retain their actual percentage while the circular arc stops at a full turn.
- Formatting/precision does not mutate source values. Ring percentages are a display ratio of explicit facts, not a score. No XP, accuracy, proficiency, pronunciation or reward is derived here.

The render API is `renderHudScene(ctx, scene, clock, {clear?})`. It has no timers, Date.now, random generation, DOM input listeners, database access or writes. It initializes compositing, dash, shadow and filter state independently of the caller while preserving the caller’s coordinate transform and external clip. It sorts a copied node list by zIndex/id, clips to safe bounds and each component, restores caller drawing state, and returns accessible descriptions. Canvas current paths are not preserved by save/restore: hosts must not carry an unfinished path across this compositor call. The default is transparent compositing; standalone preview asks to clear. Preview and any future recording call the **same renderer with the same frame**. No media recorder is implemented or activated in this batch.

The caller controls canvas backing size, DPR and font readiness. Same inputs, font environment, target transform and clip give deterministic pixels. This does not claim byte-identical rasterization across browser engines or operating systems. `HudCanvas` is a thin React host and requires an explicit clock; scheduling stays outside the library.

## Existing-data integration, deliberately not implemented

`ProjectionAdapter<Snapshot>` defines a pure readonly projection-to-`MetricFrame` boundary, with source ledger version named separately. Production should project existing authoritative events rather than create a second set of keypress facts. Paint must never replay a full ledger, change grades or update persistence.

Reserved bindings are marked unimplemented:

- `input.cpm.5s.v1`: requires an actual observed five-second selector and explicit graphemes/minute conversion. Legacy visual energy is not CPM.
- `text.firstSubmission.wordMatch.v1`: requires the immutable first submission and its existing alignment rule, not a new grading formula.
- `practice.activeMs.v1`: authoritative observed active milliseconds only.
- `practice.completedAttemptCount.v1`: practice completion remains distinct from evaluation completion and target success.

Without an adapter, these values remain unmeasured. The existing PracticeSnapshot, current UI, training rules, recorder and user database are unchanged.

## Layout foundation

Pure helpers include anchor resolution; safe-bound clamping with a structured error when the minimum cannot fit; deterministic grid snapping; edge/center guide snapping with explicit matched guides; and left/right/top/bottom/horizontal-center/vertical-center selection alignment. Inputs are immutable. Invalid/nonfinite geometry rejects. The clamp protects exact floating-point containment, tested with 10,000 deterministic fractional cases. There is no drag/drop editor or AI skin generator in this batch.

## Isolated development showcase

Run from the repository root:

```sh
node studio/hud-library/showcase/serve.mjs
# localhost only: http://127.0.0.1:4196
```

The existing esbuild installation bundles React into `/tmp/lingotrace-hud-showcase`; app routes, `dist`, `out` and locks are untouched. The fixture mode clearly labels fictional supplied values. The separate native-textarea mode holds temporary state in memory only, refreshes empty, and never opens IndexedDB or localStorage. Its four display values are observed added graphemes, a cumulative commit series, event-driven input rhythm and an explicitly described 40-grapheme demo target. These are not word correctness or learning progress. IME is committed once; paste/deletion/undo/redo/drop/replacement/autofill do not add typed effort; pause creates gaps and blocks input.

This harness is sealed for later browser acceptance. Browser-only event ordering, physical IME, screen scaling, actual media compositing and recording parity remain **not tested** in v0.1. The local server starting or bundle building does not count as browser verification. No deployment is authorized or performed.

## Verification commands and evidence

```sh
node --import tsx --test studio/hud-library/layout.test.ts studio/hud-library/tests/*.test.ts
npx tsc --noEmit --incremental false
node --import tsx studio/hud-library/showcase/render-fixtures.ts /tmp/lingotrace-hud-v01
```

The program renderer writes one labeled specimen contact sheet and four transparent single-component PNGs. These are **program-rendered fixtures, not browser screenshots**. Test scope includes immutable input, schema/binding rejection, actual gaps, unknown denominator, typed/IME versus paste/deletion, finite-support event waves, idle return, paused/low-motion/static pixel stability, safe clipping/context restore and all four data states. Final counts and source hashes are recorded separately in the delivery report so later changes cannot silently inherit an old pass.
