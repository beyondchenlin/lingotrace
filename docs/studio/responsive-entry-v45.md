# v45: consistent public training entry

Baseline: v44 `be3c4804b57dc1ba1b3f881c40982d8c5552ade6`.

The reported portrait regression was reproduced in the actual dot cloud Chromium window at 504×757 CSS pixels. `/studio/` created a 900px-wide fixed landscape stage, clipped horizontally; `/portrait-preview/` used the already accepted responsive controller and fit its 371.8×709px stage into the same window. The root `/` still opened the older five-style HUD runtime. These three entry points had different behavior even though their protected files had remained unchanged since earlier releases.

The formal `/studio/` now passes the same `responsive` prop as `/portrait-preview/`. Its automatic orientation, height fitting, Canvas rendering, native input/hit geometry, animation, storage and recording controller are the existing implementation. No renderer, style sheet, training data, score, clock or privacy code changed. The existing layout selector is now available through both training URLs. The root has an authored same-origin redirect to `/studio/`, with a normal link fallback and an archive link; the JavaScript path retains query and fragment. The old `/portrait-preview/` URL and all `/demo/` routes remain supported.

This is an entry-point correction, not a new mobile implementation or a claim that native phone keyboards have been tested. Root redirects replace the current history item. No automatic camera, microphone or recording starts.

Build from the precise source using `npx next build --webpack` and the selective `scripts/assemble-studio-metric.mjs`; the latter applies `public/index.html` and preserves all other non-training resources byte-for-byte. The static export check now permits the explicitly changed root and still checks archived routes. The older default `assemble-site.mjs` full shared-asset replacement remains a pre-existing build limitation; it was not used for this release.

Validation: three route/navigation/assembly checks plus the existing 27 viewport/layout checks; all 545 core/scene and 57 media checks, typecheck, direct Next build and static export validation passed. Independent source and assembled-artifact review plus actual public browser acceptance are reported separately in the task FINAL-ACCEPTANCE. Physical OS keyboard, native IME, real-device sensors and all browsers are outside this bounded pass. Rollback retains v44 and its data/privacy fixes, but would restore the reported entry mismatch.

The private result-card batch was paused before any files were written. It is not part of this source or publication.
