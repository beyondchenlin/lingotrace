# Listening cadence candidate: verification

Verified on 2026-10-11. Candidate only; no CUA, browser/audio acceptance, publication, or recording-policy expansion.

## Exact source

- Integrated R2 baseline: `655cf9b0ba0f30e52852f269eb8dbe455c69a9d0`.
- Paired additive PRD and failing-first projector tests: `73053e3ea78bf33a02e0d1d3036bc8afc4d8e503`.
- Independently reviewed and aggregate-tested production/test source: `d2ef920bfa1173a046406e0835967b0b55da729d`.
- [Total PRD addendum](listening-cadence-PRD-overview.md) and [detail PRD addendum](listening-cadence-PRD-detail.md) preserve the older documents and their delivery status.

## Results

- Full core/scene: **1,750 passed**, no failures or skips. Exact frozen-v65 source was supplied to the four historical compatibility tests, which validate historical hashes themselves.
- Full media: **815 passed**, no failures; one existing skip, `recorded MediaRecorder fixture: original and muted video bytes/timeline remain identical`. This skip is not treated as encoded-recording evidence.
- HUD library: **93 passed**, no failures or skips.
- TypeScript: passed.
- Next production build/static export: passed for Studio, portrait preview, media transport check and not-found routes. Release assembly and deployment were not run. Tracked `dist` remains unchanged.
- Git whitespace check: passed.

## Independent review of exact source

The separate reviewer found no remaining blocker in `d2ef920`:

- All 79 focused projector, actual native-player, host and Canvas renderer tests passed.
- 324 actual observation snapshots were byte-identical to the baseline across six native playback rates, including 850 active cadence reads. The traces cover native progress, pause, rate change, seeking, waiting/stall, background/foreground, rapid hidden/shown references, repeats, typing, and disposal.
- 42 baseline/candidate PNG pairs were byte-identical outside listening: landscape/portrait, three clocks, standby, live, paused, reduced-motion, replay, restore-failed and real-input states.
- Quantized native positions with 17 ms display reads / 100 ms media precision admit only actual progress and remain functional at 0.5 / 0.8 / 1 / 1.25 / 1.5 / 2×. Returned points are defensive copies.
- The exact Studio accessibility update block was executed through listening-reference → hidden → typing → replay. It distinguishes reference estimates from real input and updates even when both presentation modes are `live`.
- Hidden references erase graph points, derived scale, keys, text and any previously enabled Training subtitle. Reduced motion has no cadence trace.
- No Training input/submit, persistence schema/writer, listening-time protocol, or recording-start boundary change was found.

## Scope and integration

This is a temporary, explicitly estimated sentence-reference display in the existing panel. It cannot be treated as measured user typing, per-word acoustic alignment, correctness, attention or listening comprehension. Real observable listening time remains the existing observation protocol.

Any later HUD redesign must retain the standalone projector, player-only visual boundary, hidden-reference guards, static reduced-motion behavior, and non-live accessible explanation. Styling and layout changes require fresh checks on the resulting integrated source; these results do not certify a future combination. No automatic cherry-pick or deployment is authorized by this report.

The initial projector import failure and renderer behavior failures establish failing-first checks. A separate early hidden-subtitle expected-failure attempt terminated at test-file level without a clean assertion diagnostic; it is not claimed as a clean red regression. Its final regression and independent hidden-pixel comparisons pass.
