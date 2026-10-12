# Long-record argument-limit regression

Scope: remove unbounded function-argument spreads from recorded input-rate extrema, chart peak, and rate export record append. No events/points are truncated; metric versions, arithmetic, fields, order, storage, and UI are unchanged.

Baseline: f220944a877240650ce9ec5cbf16f7b4ee49e8e7 (published v48).

Run from this checkout:

    node --stack_size=128 --import tsx qa/long-record/reproduce.ts
    NODE_ENV=production node --stack_size=128 --import tsx qa/long-record/chart-render.ts
    npm test
    npm run typecheck
    npm run build
    node --import tsx --test validation/*.test.mjs

The 128 KiB V8 stack is a controlled argument-limit test, not a browser/device performance claim. It makes the genuine limit reproducible at 16,002 valid replayed events without benchmarking the existing immutable reducer's quadratic history cost. The fixture uses legal observation-only samples during a composition interval and stores no candidate text. There is no production stack change.

2026-10-09 results:
- Baseline controlled fixture: replay succeeds; deriveInputRateTimeline line 156 throws RangeError: Maximum call stack size exceeded.
- Baseline default Node stack: Math.min/max and push with 200,000 arguments each throw RangeError.
- Repaired fixture: 16,002 events, 16,001 input-rate points; complete JSON (66,529,929 characters), CSV (31,405,381 characters), five legacy HUD windows retaining all 16,001 points.
- Actual React server render: 15,996 measured SVG circles, 16,001-point picker; no argument-limit exception. This is program verification, not cloud-browser or real-device qualification.
- Thirty legacy/observed small snapshots including standby, pause, wall-clock reversal and IME: whole timelines, JSON and CSV identical to baseline (temporary baseline imports removed after comparison).
- Independent review: three-file arithmetic/order diff accepted, 11 boundary chart element trees identical, 200,000-point chart computation succeeds versus baseline RangeError (hooks/chart input stubbed only for this independent isolated test).
- 620 core/scene/media tests and 48 validation tests pass; typecheck and production build pass.

No claim of unlimited session capacity or real-device IME qualification. Existing replay and full export still require time/memory proportional to their representations, and replay retains its existing quadratic cost. Browser and publication evidence is reported separately.
