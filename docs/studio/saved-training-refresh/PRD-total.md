# Saved practice refresh recovery · Total PRD

Status: source candidate, 2026-10-11. Build, publication and real-browser acceptance are separate gates.

## Need and scope

A saved current café practice must come back after refreshing the same training tab: selected course/session, sentence, draft and retained results. Hiding the reference must remain hidden after refresh. First entry in a new tab retains the existing NPS default.

The observed QA failure was a café draft with “Saved on this device”, then a normal reload to empty NPS and reference shown. This establishes a failed restoration experience. It does not establish deletion of stored café history.

## Requirements

1. Explicit history continuation (`resume`, with its one-time exact sequence check) has highest priority. Otherwise, the current tab's committed practice locator is restored. Without either, keep the existing NPS default behavior.
2. The tab locator contains only version, session ID and last committed sequence. Answers, events, attempts and material remain in the existing IndexedDB repository. Never reconstruct a practice from locator data.
3. Record a locator only for an actual committed complete session belonging to the current engine. No placeholder/default-preview write, no old-course delayed callback taking ownership, no persistence of temporary/partial practice.
4. On refresh, validate the exact selected record and automatic-history permission before and after reading. A missing, invalid, older-than-committed, unreadable or no-longer-permitted selection is a visible recovery failure, with automatic saving paused and the existing reopen/retry entry. Do not silently fall back to NPS/latest, clear history or overwrite a record.
5. OFF removes the tab locator; old history remains retained under its existing controls. Failed removal must be visible. No privacy-gap record becomes a full-session recovery.
6. Remember reference visibility separately for the current tab. Failed or invalid visibility reads default to hidden. Restoring visibility neither plays sound nor creates new hints/attempts; existing exposure accounting remains authoritative.
7. A tab storage failure visibly says refresh recovery is unavailable, even if IndexedDB successfully retained the practice. Export guidance remains available. Dirty/debounced writes must show saving rather than the previous “Saved” receipt.
8. Older attempts and complete-session formats remain unchanged. No database schema upgrade, clearing, deletion or scoring migration.

## Acceptance

- Same-tab café save → reload restores exact session, sentence and draft; hidden reference remains hidden; no unsolicited sound.
- Explicit resume, switching between café/NPS, consecutive saves, interrupted/slow/failed saves, OFF and retry keep exact ownership and do not modify old records.
- A new independent tab keeps NPS default. Browsers may clone sessionStorage when duplicating a tab or opening a new page with an opener; those pages can inherit its saved selection.
- Storage failure and invalid/missing targets are visible; restore retry exists.
- Automated adapter/host tests are source evidence only. Real reload, storage availability, media readiness, browser crash recovery and device behavior require browser acceptance.

## Related requirements

[Detailed PRD](PRD-detailed.md). Earlier [v68 default contract](../v68-nps-default-and-load-recovery.md) and later visual/typing PRDs remain preserved. This amendment changes same-tab refresh selection only; it does not approve QA-only Follow playback or change the current visual design.


## Subsequent scoped verification record — 2026-10-11

The candidate-stage statements above are preserved as historical handoff context; this later record updates only status and evidence, without changing requirements. The integrated runtime source is `90b7c3fa3a1ab5dfd39e29becb5af3434462f93d`. Source review, 2,029 core/scene tests (zero skips), 897 media tests (one pre-existing optional recording-fixture skip), TypeScript and the production build passed. The independent final source review passed 97 focused checks.

Actual dot-cloud Chromium accepted the scoped native UI repairs: the original 156-character narrow draft, caret/selection/scrolling, a new committed Café save followed by normal reload, Below keyboard-only placement, the thin footer, and the requested HUD background top/left edges. Unchanged error-preference, reduced-motion and locale independence checks come from the earlier exact 4d6 browser run; they were not all repeated in R2. This is a bounded UI gate, not whole-PRD or user visual acceptance. See `../main-ui-v82-release-verification.md`.

Media remains outside this acceptance: Café still displayed a native playback error in the HTTP preview, and NPS was blocked by its HTTPS qualification rule. Historical Chromium error9 incidents remain unexplained. Physical-phone/OS IME, vibration, audible effects, speech synchrony, camera hardware and actual recorded output were not verified. No new typing Follow runtime is included in this main-site release; the separate public QA Follow candidate remains independently gated. Publication and the final release commit are established only by the saved-version/deployment receipt, followed by the separate production HTTPS smoke.
