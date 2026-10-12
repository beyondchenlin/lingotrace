# Continuous IME observation for CPM (v39)

Baseline and rollback: v38 / 5fcd7a81c2704d3dce7a1f781f977d1dec5bb169. No migration or historical rewrite. The accepted geometry, renderer, animation, recording and pause-cutoff behavior stay unchanged.

## Approved rule

User approval: Sentinel_4b86caa8dcd48191aa868b2158b0a976, 2026-10-09 06:18 UTC, replying to the proposal to keep observing during IME selection, count only final committed characters once, and retain practice-time and score rules. This does not authorize adopting Practice or mixing legacy results.

The observation window begins with this page's first actual committed edit or native compositionstart. Page standby is never observation coverage. Compositionstart and timer samples carry timing only: no preedit or candidate text. Final native compositionend data provides inserted Unicode graphemes; the existing same-task input-tail guard prevents counting it again. Direct typing and IME remain distinguishable in source events and the includesIME flag.

CPM is 12 × manually committed graphemes in the left-open, right-closed last 5000 observation milliseconds. WPM is CPM / 5 only. An incomplete window is null. A complete observable window containing no committed characters may be measured zero; this is input rate, never a score. An unchanged-draft, explicit-empty IME cancellation does not itself reset coverage or emit a new inputCommitted in the opted-in engine, and produces no attempt or reward. Missing data=null or inconsistent empty data with changed text is unavailable, not assumed zero.

The observer uses performance.now through the engine's monotonic clock, independently of activeMs. Composition and the old idle flag do not freeze this observer. Actual input/window focus loss, manual pause, background, existing modal/listening/checking/review blockers, cue changes, page lifecycle, refresh/new run, backward monotonic readings and unobserved gaps reset coverage. Composition temporarily bypasses the old review marker until its final commit; actual focus loss still wins. A 2500ms inter-sample limit protects observability of the existing approximately one-second sampler. It is not a learning-pause command, idle judgement, or attention measurement.

## Versioned evidence and history

New events may carry inputObservation with version input-observation-v1, page/run identity, segment, monotonic atMs, observing/suspended state, blocker reasons, and restart reason. A new inputObservationSampled event carries no text and changes no practice-time, visual energy, score, attempt or reward fields. It is emitted during composition when the old practice timer is frozen. Both ordinary actions and timer samples share this one existing event stream and IndexedDB snapshot/event transaction.

New CPM points are input.cpm.5s.v2 with windowClock=input-observation-v1 and explicit run/segment identity. Their plot still uses recorded wall time for display; wall-clock reversal splits the plotted line but cannot inflate the monotonic rate. Legacy points retain input.cpm.5s.v1 and recorded-wall-time windows. Old missing native data/observation evidence is not invented. Mixed histories retain the v1 prefix and start a fresh v2 interval. Refresh never restores a running observation clock or backfills the elapsed offline interval.

The existing production TrainingEngine is still in use. This change creates no separate database, candidate log, raw-key ledger, permission or background collector. Observation evidence travels through the same save queue and restore-failure guard as current local practice. The new development-only Practice recording/deletion fences are not bypassed or adopted; their production integration remains a separate pending decision. Pure projections never save anything. Existing user records and the old source remain recoverable.

## Deterministic acceptance examples

- First selection lasting six observed seconds, followed by final “你好”: 24 CPM, activeMs remains zero during selection, no attempt or reward.
- Three final commits at 1.5s “你”, 3s “好啊”, 4.5s “！” in coverage beginning at 0: at 5s, 48 CPM / 9.6 WPM-equivalent. Practice activeMs remains 1500ms under its existing composition exclusions.
- Six consecutive one-second selections each commit “你”: at 6s the (1s,6s] window contains five characters, 60 CPM. Composition-only intervals do not reset the window.
- Cancellation has no inserted text; after complete coverage its rate may be zero. Unknown final native data is null/unavailable. A later actual focus loss or manual pause resets coverage.
- Resuming from pause/blur/background or reopening requires a fresh complete window. Past samples, attempts, drafts and earned results are not recomputed as new evidence.

Tests use the real engine, reducer, selectors, export and an isolated fake-indexeddb adapter; they do not constitute native OS IME testing. Real browser testing must separately state whether it used native direct text input, simulated composition or an actual platform IME. No camera/microphone device capture is required. The v38 silent-Canvas pause contract remains a regression gate. Unicode/ICU and cross-browser IME ordering remain qualification limits.
