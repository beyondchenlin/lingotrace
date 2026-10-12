# HUD v0.3 — isolated same-metric presentation lab

Scope: `studio/hud-library/` and this document only. The training page, story page, app routes, practice/data ledger, database, recorder, dependencies and lockfile are not part of this change. No deployment is performed.

## Ownership and backup before edits

- This batch owns the HUD schema/registry/renderer, two additional presentation renderers, semantic variant metadata, an isolated fixture preview, tests and this document.
- The data worker owns `studio/core/practice-*` and its data documents. The workers exchange only a readonly projection contract; neither edits the other's files.
- Pre-change HUD sources and v0.1/v0.2 documents were archived outside the repository before modification. A SHA-256 manifest captured app/core/components/scene/media and dependency files so unchanged UI/media paths can be verified separately from concurrent data work.
- Backup archive SHA-256: `23715e128d8f542f87571102f1c174757aec06ecc5468841f105ca6f293069ab`.

## Verified starting point

Seven metric families were implemented. Only the input-event pulse already had two shapes (`wave-scan` and `event-stems`). The schema already supported node sizes/anchors, colors, font settings, opacity, text outlines, local backplates and reduced motion. The two existing developer pages exposed only a subset of those settings. No same-metric variant selector, production PracticeSnapshot adapter, public HUD route or new recording integration existed.

## Planned small batch

1. Reuse `TrendMetric` without converting it into grouped or aggregated data: offer line and time-positioned bars. Bars require an explicit scale containing zero; missing/paused points remain gaps, and actual zero has its own marker.
2. Reuse `ProgressMetric` unchanged: offer a ring and a horizontal progress track. Both need an explicit positive denominator to show a percentage; unknown totals remain unavailable. Over-target text preserves the true supplied ratio even when the track fills.
3. Reuse input events for wave/stem selection. These are typing/committed-IME display effects, not measured audio or ECG/heart-rate data.
4. Keep numeric, grouped-duration/count bars, target interval and calendar in the same selector, but do not make incompatible diagrams available just because they look appealing.
5. Add an isolated presentation lab with fixture-source labels, semantic compatibility reasons, normal/no-data/missing/paused/error controls, accent/size settings and side-by-side same-metric comparisons.

All new samples are explicitly fixed fixture data. The pre-existing input demonstration remains separate. Styles never alter source observations, grades or outcomes. Data-adapter implementation remains the data layer's later integration task.

## Delivered behavior

- `presentationOptions` exposes ten curated options across the existing seven metric families. It separates semantic compatibility from temporary observation availability. A saved compatible presentation may show no-data; an incompatible data shape is not rendered in a misleading form.
- Timestamped line/bars retain the same metric object, points, unit and provenance. Bars do not infer intervals or aggregate observations. A zero baseline is mandatory; actual zero marks and missing-slot marks differ.
- Ring/track retain the same supplied numerator and denominator. Missing totals do not produce 0%; explicit zero numerator with a positive total is valid. Over-target quantities keep their supplied value and ratio.
- The independent style lab exposes fixed dataset choice, ten semantically gated presentation choices, normal/no-data/missing/paused/error states, width/height clamped to each component's registered minimum, accent color, reduced motion and same-source side-by-side comparisons. It has no persistent settings or data writes.
- Missing input-event coverage suppresses the waveform with a message; the system does not invent events, audio samples or heart-rate observations.
- The progress track allocates non-overlapping text columns with an explicit 16px gap, including the registered 270×160 minimum and long valid quantities.

## Additive static handoff

`node studio/hud-library/showcase/build-static.mjs /tmp/lingotrace-hud-v03-static` produces a standalone `/hud-library/` subtree outside the repository. The script refuses repository-local output and never writes app/dist/out or deploys. The main presentation lab is `/hud-library/`; existing isolated specimens are `/hud-library/basic/` and `/hud-library/groups/`. Navigation stays within that subtree. JavaScript and CSS assets are bundled locally, with no runtime third-party dependency requests. The main lab and groups page use fixed fixtures; the basic page additionally retains its clearly labeled, ephemeral page-input demo. Neither source connects to saved training records.

Only the produced `hud-library/` directory may be added to the site's served root. Do not replace the entire site, or modify training/story routes. `manifest.json` lists relative filenames, byte counts and SHA-256 values. `INSTALL.txt` outside the subtree describes this bounded handoff.

## Verification and limits

- 93 focused tests pass, including the original library checks, semantic eligibility, the same metric object across presentations, exact provenance/units, zero vs missing, signed time bars with explicit zero scale, unknown progress totals, source labeling, size/color settings and the minimum-size long-number regression.
- HUD-only TypeScript checking passes with `npx tsc --project studio/hud-library/tsconfig.json --noEmit`.
- Program-rendered same-metric comparison pixels were inspected. Independent code/render review rechecked the long-number correction and found no remaining component must-fix issues.
- All 46 protected app/UI/media/dependency files captured before this batch retained their original hashes. The parallel data worker's files are excluded from that statement and are never changed by this batch.
- A supported cloud-browser attempt could not reach the transient localhost service. Browser interactions have not passed acceptance. No blocked direct-Chromium route was retried.
- Program PNGs are fixed fixtures and explicitly marked as program renderings, not browser screenshots. Real-browser acceptance can follow publication of the standalone path. No public deployment, real-data adapter, user-database access, training-page change, story-page change or new recording integration is included.
