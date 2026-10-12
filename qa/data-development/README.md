# Development data browser checks

This directory is not in `public/`, the exported Site, or the production app. Run only as an isolated QA page with original deterministic fixture input. It never opens v22 or other existing user databases. It creates random development databases and retains them for the explicit page-reload checks.

From the repository root, build the bundle using the already locked transitive esbuild tool:

```sh
npm exec -- esbuild scripts/data-browser-entry.ts --bundle --platform=browser --format=iife --global-name=PracticeDataQA --define:process.env.NODE_ENV='"development"' --outfile=qa/data-development/data-browser.js
node qa/data-development/serve.mjs 8765
```

The server binds only to 127.0.0.1 and serves only the HTML and bundle. It accepts no writes or upload endpoint. Keep the same origin and tab for reload. Stop the server with Ctrl-C.

1. Record browser/version and SHA256 of the HTML and bundle.
2. Open the printed URL in the supported QA browser. Confirm the initial state says no operations have run.
3. Click **Run isolated batches 1 + 2A + 2B**. Inspect the actual visible result; `executionEnvironment` must be `browser` for a real-browser claim.
4. Click **Reload page**, then **Verify after reload**. Check all three batch results and exact digests.
5. Record failures verbatim, including the operation and browser. Do not call an environment/materialization failure a data failure or a pass.

Batch1 covers fixed material/references, first submission and revisions, exposure, mode, manual pause, canonical native IndexedDB readback, and JSON/CSV equivalence. Batch2A covers current-page OFF, no backfill, request-success-before-abort, injected preference failure, durable cross-instance generations, whole-session deletion/clear, and tombstones after reload. Batch2B covers attempt-level physical erasure while retaining a2, every-store rollback and content checks, scoped one-shot exports, and remote deletion during asynchronous formatting. The temporary method injections are restored in `finally`.

The checks do not cover native keyboard/IME, audio capture, actual capacity exhaustion, production UI wiring, production deletion UI, review scheduling, awards, import, or physical user devices. Running the same driver with fake-indexeddb in Node is only a program check and reports `non-browser-harness`.
