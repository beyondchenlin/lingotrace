# Portrait metadata synchronization correction

Baseline: public v30, source 37e79aced08d8a18e386cc609fad1549f1e55932. The cloud Chrome browser reported duration 72 / readyState 4 / currentTime 27.70231, while the duration label remained 00:12 and the seek maximum remained 12.

The original module only registered loadedmetadata, never read already-loaded metadata, and omitted durationchange. A test extracts that exact baseline handler and reproduces the stale controls until another event is emitted. This confirms the initialization gap; it does not establish network or browser scheduling internals.

The new presentation-only timing binding registers its observers then synchronizes immediately. Metadata and duration changes keep the label and maximum current. Unknown, nonfinite and zero durations display --:-- and disable seek. Valid seek requests are bounded by the current finite media duration. Synchronization never seeks or autoplays. CSS, layout, media bytes, shared HUD code, training, story and stored data are unchanged.

Eight targeted tests and strict targeted TypeScript checks passed. Independent read-only review found no must-fix issue. Actual public browser verification must follow publication. The cloud browser's supported API has no viewport-size control; its page-selected 430px portrait container is not evidence of a physical phone or OS keyboard.

Tests: node --import tsx --test previews/portrait/tests/media-time.test.ts
Type check: node_modules/.bin/tsc --ignoreConfig --noEmit --skipLibCheck --strict --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --types node previews/portrait/src/media-time.ts previews/portrait/tests/media-time.test.ts
