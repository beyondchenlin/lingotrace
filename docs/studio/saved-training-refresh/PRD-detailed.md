# Saved practice refresh recovery · Detailed PRD

## Established cause and prior contract

The v68 default-course implementation intentionally selected NPS for every ordinary entry without `?resume=`, even when the latest committed record was café. Its host tests explicitly asserted that behavior. It had no current-tab committed selection. Consequently, a same-tab reload was handled as a fresh ordinary entry. Separately, reference visibility was initialized by `useState(true)` on every mount and had no retained preference. Keyboard placement used localStorage, explaining why Below could survive while the course and reference choice did not.

The 2026-10-11 refresh requirement distinguishes first/new-tab entry from same-tab recovery and supersedes only the conflicting reload part of that behavior. Existing historical documentation remains unchanged. Source history traces the NPS default to commit `53699dc`; the same default implementation is byte-identical in published v81 (`18ac500`), the main-only baseline (`1b693e4`) and reported QA v2 (`324c0f7`), with SHA-256 `b8744c7736bc886b32cf1de9260eeceb3553f769bd79e712ac998439bfd213a9`. This is not evidence that new typing geometry erased records.

## Selection and storage contract

Precedence is explicit resume → committed tab selection → original NPS default. Explicit resume never depends on successfully reading an unrelated tab locator. Named selection reads the exact history session (or its complete listening envelope), not global latest; it then rechecks legacy-default permission. The tab sequence is a minimum committed watermark, so later committed edits to the same session remain recoverable. The one-time URL sequence remains an exact comparison.

The tab adapter stores `{version:1, sessionId, sequence}` under a versioned sessionStorage key. The production repository receipt must be persisted, error-free, have no pending writes, match the current engine's session, and not exceed its observed sequence. Only complete legacy permission can write this pointer. A verified stored bootstrap may establish the pointer directly. Storage failure is caught and shown; it never changes repository records or falsely promises refresh recovery.

Repository and recorder subscriptions enforce current page-generation ownership. A delayed save from the old course may legitimately finish in IndexedDB but cannot steal the new current course's tab locator. OFF/enabling/segment transitions remove the locator. Disposal releases subscriptions; stale callbacks do not act for a newer page. Original history and event formats are untouched.

The reference display preference is a separate shown/hidden value with no answer content. It is restored before media readiness; unreadable/invalid settings fail hidden. This does not call engine reveal, submit or audio functions. Existing reference exposure provenance continues unchanged.

## Visible states

- Boot is pending until the selected saved record and permission are validated.
- Failure retains the existing restore-failed presentation, disabled saving/answers and Settings → reopen to restore control.
- Tab-storage failures expose “Refresh recovery unavailable” in the practice status and a persistent explanation in Data and Settings. Successful IndexedDB data remains available in history/export.
- Dirty or pending legacy writes show saving. A previous persisted repository receipt must not label newer unsaved edits “Saved on this device”.

## Verification plan and boundaries

Automated tests use the actual IndexedDBTrainingRepository and TrainingHistoryRecorder with fake-indexeddb and a Storage-API session adapter, plus extracted actual Studio bootstrap/lifecycle functions. They cover:

- repeated reload via new repository instances on the same database and same tab storage;
- byte-equivalent sessions/events/meta before and after read-only recovery, including old attempts;
- committed café selection despite newer NPS global latest; a new empty tab retaining NPS default;
- delayed commit, failed real object-store write, retry, course switch with old completion, OFF, disposal;
- explicit resume priority, invalid/missing/too-old targets, privacy changes during read;
- sessionStorage failures and independent hidden-reference persistence;
- host visible restore failure without loading or saving a blank fallback.

The actual browser report is an observation of the unpatched QA release, not proof of fixed browser behavior. No browser scripting, DevTools, direct browser IndexedDB access, camera, microphone or audio capture was used for this source repair. Real-browser regression checks and visual review remain required after authorized integration/build/publication. No build or deployment belongs to this source-only delivery.

## Upgrade boundary

An already-open older build has never written this tab locator. First loading the new build cannot infer its previous choice without guessing global latest, so existing retained sessions stay accessible through the explicit History → continue action. Fixed-browser acceptance starts with a selection and confirmed save made while the new build is running, then a normal reload. No synthetic locator is injected into a browser to manufacture recovery evidence.


## Subsequent scoped verification record — 2026-10-11

The candidate-stage statements above are preserved as historical handoff context; this later record updates only status and evidence, without changing requirements. The integrated runtime source is `90b7c3fa3a1ab5dfd39e29becb5af3434462f93d`. Source review, 2,029 core/scene tests (zero skips), 897 media tests (one pre-existing optional recording-fixture skip), TypeScript and the production build passed. The independent final source review passed 97 focused checks.

Actual dot-cloud Chromium accepted the scoped native UI repairs: the original 156-character narrow draft, caret/selection/scrolling, a new committed Café save followed by normal reload, Below keyboard-only placement, the thin footer, and the requested HUD background top/left edges. Unchanged error-preference, reduced-motion and locale independence checks come from the earlier exact 4d6 browser run; they were not all repeated in R2. This is a bounded UI gate, not whole-PRD or user visual acceptance. See `../main-ui-v82-release-verification.md`.

Media remains outside this acceptance: Café still displayed a native playback error in the HTTP preview, and NPS was blocked by its HTTPS qualification rule. Historical Chromium error9 incidents remain unexplained. Physical-phone/OS IME, vibration, audible effects, speech synchrony, camera hardware and actual recorded output were not verified. No new typing Follow runtime is included in this main-site release; the separate public QA Follow candidate remains independently gated. Publication and the final release commit are established only by the saved-version/deployment receipt, followed by the separate production HTTPS smoke.
