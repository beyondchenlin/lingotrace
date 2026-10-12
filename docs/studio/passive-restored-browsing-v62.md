# v62: restored-page browsing without unnecessary Training forks

Base: v61, `01113ad1821b52b7b7f410c4c0c6290157e0fac4`.
Scope: a runtime/write-boundary correction for restored full legacy history.
No new history schema, migration, score definition, conflict merge, writer lease
or privacy permission. Full F08/F13 delivery status is unchanged.

## Original failure and intended result

Normal v61 HTTPS QA produced two 230-event branches with an identical 226-event
prefix. Only modal freeze events differed; drafts, attempts, 13 earned words,
2 completed sentences and activeMs were unchanged. The existing same-transaction
CAS correctly refused the stale branch. The bug was unnecessary Training facts
from browsing, not corrupted learning results or a defective CAS.

The preserved frozen-v61 program red test reproduces restore-only sequence
230→231 and the pure-browsing second-page unsaved warning. It runs the actual
Studio handlers and repository against isolated fake IndexedDB. The prior real
browser screenshots/exports are retained separately; program reproduction is
not additional browser evidence.

## Implementation boundary

- `TrainingEngine` accepts a host opt-in only for initial, verified full legacy
  restoration. It still performs ordinary replay/composition/judgment recovery
  first. Full snapshot equality is required afterward; any recovery or derived
  mismatch retains the ordinary active/dirty path.
- A one-way runtime state holds only current modal/background/listening/idle
  conditions and focus. Passive sampling emits no event and accumulates no
  active time or observation coverage. The canonical snapshot stays untouched.
- First real input, same-text native edit, composition, submit, hint/reveal,
  cue/continue or explicit practice intent synchronously activates. Activation
  anchors the clock, directly emits current blocker differences without sampled
  `setFrozen` calls, then anchors again before the original command. Transient
  browsing changes are not queued or backfilled.
- Explicit course play/restart/playing-pause activates before asynchronous media
  callbacks. Both rendered and current media kind must be the course; reference,
  replay and other media do not supply that intent. Failed play does not invent
  listening, input observation or an attempt. Automatic callbacks update only
  runtime environment while passive. Paused seek and the independent bookmark
  preview remain browsing operations.
- Whole-practice pause/resume activates before the existing command. Saved
  paused/review facts remain intact. Active sessions never reenter passive on
  idle, modal, focus loss, page lifecycle or display PageInputGate reset.
- The recorder has a dedicated one-time initial stored-baseline admission.
  Its first notification is clean; it cannot erase dirty/in-flight writes.
  Ordinary connect remains dirty for legacy. Only the exact original, still
  untouched passive baseline may resume clean through bfcache. New facts,
  any write, generic reconnect or settings transitions revoke that capability.
- The original repository, permission transaction, full common-prefix CAS,
  partial-history projector and history bootstrap reader are unchanged.
  A stale page that later truly answers still cannot overwrite a peer's branch;
  its local answer remains available for export.

## Verification before independent review

- 103 new portable tests: 23 engine; 11 clean admission/write safety; 9 actual
  Studio restore/panel/visibility/pagehide/pageshow and two-page storage tests;
  60 original UI first-action/IME/media/clock handler tests.
- Full core/scene 953 passed; media 338 passed with the existing optional encoded
  fixture skip retained; HUD 93 passed. Typecheck and static build passed.
- The preserved real 230-event export also passed a separate candidate test:
  two pages repeatedly browse, hide, return and simulate bfcache; zero
  `saveSession` calls, identical raw events, learning facts, all stored rows and
  same-boundary JSON/CSV exports. No user database was altered by these tests.
- Long wait before first input on an unfrozen settled baseline does not add
  activeMs. A moving test clock verifies no reconciliation-time drift. Six-second
  IME, empty cancellation, final commit and native trailing-input dedup remain.
- True concurrent answers, remote OFF, pending ON, partial-history/recovery
  failures, active lifecycle boundaries and failed-write retry retain existing
  safety behavior. Pure browsing produces no false unsaved warning.
- Main scene/HUD sources and media are unchanged. The static assembler preserves
  existing non-target routes and shared assets, adding only new build chunks.

Normal HTTPS acceptance must follow independent frozen-source review and the
authorized same-site deployment. Real hidden-page/encoded-recording evidence is
separate from these program tests; the original pending upload/recording lease
is not touched. v61 remains the rollback version.
