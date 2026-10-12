# Data batch1: isolated development API, no UI integration

Base: public v22 source3921e15e2b43a02509c6f288b1099c0fe6982f1f. This local batch leaves the published UI, geometry, original recorder and legacy training/repository modules unchanged. It is not a completed user journey and is not approved for production persistence.

## Runnable parts

- `PracticeEngine`: one canonical versioned event stream; material/unit/reference identities, immutable reference snapshots, fixed-mode logical attempts, first submission plus revisions, round-local exposure, manual/video pause distinction and deterministic replay. It reuses the existing alignment/grapheme primitives and installs no DOM input listeners.
- `DevelopmentPracticeRepository`: requires an explicit `lingotrace-dev-data-*` database. No production name or default is accepted; production builds/runtime explicitly refuse construction and storage opening. `events` stores facts exactly once; `heads` stores only revision metadata. One transaction appends events and updates a head. Reads rebuild projections by replay. Identical prefixes are idempotent; divergent histories fail without replacement; stale prefixes preserve the newer state. Reading an older saved revision never clears a newer write failure; read metadata/errors and write state are distinct.
- `exportPracticeSnapshot(snapshot, exportedAt)`: captures one validated boundary for JSON and CSV. Events and derived views are labeled separately; export is not a new completion or reward.
- `scripts/data-batch1-browser.ts`: an executable isolated browser check, bundled as `LingoDataBatchOneQA` by the installed esbuild tool. It uses native browser IndexedDB when run in a browser and deterministic original fixture inputs, not a camera, microphone or native keyboard.

## Commands for review

`npm ci` installs the locked dependencies. `npm run typecheck` and `npm test` run existing plus new data tests. `fake-indexeddb6.2.5` is a development dependency for API/transaction failure tests; those tests alone do not establish durable browser storage.

Use the supplied development-only `index.html` and bundled `data-batch1-browser.js` on a dedicated blank test origin in a clean browser context. Do not use the production Site page or an opaque about:blank/data: origin. Click Run, Reload, then Verify. Only random QA database/session identifiers and the expected digest are kept in this page's sessionStorage so the explicit reload check can find its fixture. Native IndexedDB writes are performed by the page's user-triggered test buttons, not by a read-only browser evaluator.

The underlying APIs are `runPracticeDataBatchOneQA()` and `verifyPracticeDataReload({databaseName,sessionId,snapshotSHA256})`. Both must pass; the reported `executionEnvironment` distinguishes a real browser run from the preliminary emulated Node harness. The script creates random developer-only databases and never opens `lingotrace-studio-v1` or user recordings. Its legacy compatibility fixture also uses a fresh developer DB. Do not report this as a connected product UI or real device test.

## Future connection boundary

The existing controller must select a single fact writer when this contract is eventually adopted. Do not subscribe the old and new engines to the same user input, dual-write histories, infer old logical attempts, or silently convert existing v22 data. Any migration needs a backed-up explicit mapping and compatibility acceptance. This batch contains no migration or production cutover.

Before integration, a separate batch must implement current-page record-off fencing, durable permission/generation checks, deletion precedence and dependent cleanup, callback isolation, assessment selection/regrade candidates, stable award identity, review-instance scheduling and safe backup import conflicts. Interfaces or linkage proposals for those items are not implemented features. Existing facade may expose no new controls until those boundaries are accepted.

Manual pause here blocks data input/submission and freezes practice time; it does not operate video or media tracks. The later controller must separately stop/interruption-finalize single-utterance audio and ongoing screen recording according to the reviewed pause policy. No encoded tail tolerance, audio completion, AI speech score, XP or review scheduling is fabricated in this data batch.
