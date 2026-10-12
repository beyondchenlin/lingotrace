# Read-only Training v1 history (v40)

Baseline and rollback: public v39, source `533121bbd44def687414fad6d7f3ba19b6893a2e`. PRD v1.4.6 remains the requirement baseline. The user's 2026-10-09 continuation request authorizes a bounded existing-engine history increment; it does not resolve the separate Practice adoption/old-new score policy decision.

## Delivered scope

The existing training Settings and current-round Review link to a local history dialog. It lists the latest 100 retained Training v1 sessions, opens an individual saved snapshot, shows its recorded outcomes, drafts, attempts and version labels, and explicitly downloads that selected snapshot as JSON or CSV. This is a read-only history view, not resuming an old attempt. The current live engine, draft, score and latest-session pointer are never replaced by selection. Source labels state that the present engine still uses this older structure.

The reader uses only the existing `lingotrace-studio-v1` database and its `sessions` store. It does not add tables, upgrade the database, create a new database for an empty history, write history projections, instantiate a TrainingEngine for a historical record, replay scores into storage, or import the development-only Practice repository. All new history queries are readonly transactions. They await previously queued saves and leave the repository's save status and errors alone.

Historical scores are the original stored values. Structural validation checks identity, schema, embedded material, attempts and event shape without rescoring. Corrupt or unsupported records are isolated with an unavailable state, not erased or counted as zero. A valid but unknown scoring/pace rule can still be displayed as stored; generating the current export format is rejected rather than attaching today's metric definition to an unknown rule. The live practice renderer, layout, motion, media permissions, recording path and pause-cutoff rules are unchanged.

## Truthfulness and coverage

- Each entry states Training v1 / saved local data, material and scoring versions, creation time, and separate save-update time.
- Each entry contains only that session's stored confirmed words, completed cues, attempts and practice time. There is no cross-session or old/new score aggregate.
- Empty history means no saved records are available in this browser, not zero learning. The view does not claim a complete calendar or collection interval. It cannot recover cleared browser storage.
- Newest 100 summaries are retained for display, with an explicit truncation message when older records exist. v1 lacks a date index, so the read scans a cursor; no schema migration is introduced for pagination.
- Date text uses the device's display timezone. This increment does not split sessions across local calendar days.
- The optional curve reads recorded event evidence with its existing v1/v2 coverage labels. It never fills missing samples or backfills IME evidence. An unsupported old curve degrades explicitly while stored outcomes remain visible.

## Read/export lifetime

Selection, refresh, back, closing, and component disposal invalidate previous in-flight reads and formatted export caches. The JSON and CSV for a selected snapshot share one export boundary and timestamp. Each explicit download rechecks the full stored snapshot in a readonly transaction; a missing or changed record does not reach the synchronous download handoff. A competing IndexedDB write cannot commit between that check and handoff. The UI also checks its current selection lifetime at the final sink. The application cannot revoke a file already downloaded outside its control.

These are read/export safeguards only. Production record-off and practice-data deletion are not added here; the broader PRD privacy controls and development Practice write/deletion generations remain unintegrated. This increment is not F01/F08 or privacy-completion acceptance, and it must not be described as the new Practice engine being live. The history view does not add an alternative save path that bypasses those future controls.

## Acceptance boundary

Program checks cover multiple real engine sessions persisted through the actual IndexedDB adapter with isolated fake-indexeddb; unchanged raw stores/latest/save error after reads; invalid records; exact stored scores; queued-write ordering; late selection/close/export callbacks; unknown rules; and the final export transaction. These are program tests, not real-browser IndexedDB evidence.

Publication acceptance separately exercises the same public route using the supported cloud browser: create/save two test sessions, read one without replacing the other, compare its visible facts with both downloaded formats, close and refresh while preserving the current draft, and inspect desktop/portrait dialog access. Native OS IME, physical mobile keyboards, cloud sync and full privacy controls are not qualified by this increment.
