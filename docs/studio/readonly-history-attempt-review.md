# Read-only saved-attempt review

## Scope

Extend each existing saved Training v1 attempt detail with its own saved reference, answer, and word-alignment evidence. Show the saved material/cue/rule identity and embedded sentence range when verifiable. This remains a read-only compatibility view, not a Practice engine adoption or a new assessment.

Baseline is published v49, source 65eeb0f9ea4fa90d66f7ebd3236ffed1bf90523d. Main Studio canvas, layouts, standby numbers, first-edit transition, current training, scoring, privacy settings, exports, recording and saved records remain outside this change.

## Evidence boundary

Training v1 `Attempt` stores `reference`, `answer`, `alignment`, `sessionId`, `roundId`, `materialId`, `materialVersion`, `cueId`, and `ruleVersion`. The embedded material stores cue text and start/end seconds. The existing history reader validates the saved structure without running alignment or replay; new presentation must not substitute the current material catalogue or current grading output.

Missing or conflicting associations are unavailable, not guessed. Unsupported old scoring rules may still present their saved word-alignment evidence as historical evidence, without recalculating a score. The existing strict history reader continues to reject unreadable records. Partial/redacted histories are not reconstructed or routed into a full-attempt view.

## Why original-segment replay is unavailable here

Training v1 does not store a stable original media identity, immutable media version/hash, or a verified attempt-to-media binding. Studio also permits selecting a local video while retaining its training material identity. A matching cafe material ID/version alone therefore does not prove that today's bundled MP4 is the media heard during a historical attempt.

This release must not attach that MP4 by guess, borrow the current player's media, create a fake play button, autoplay, or change the live training cue. It explicitly explains the unavailable original media. Safe original-segment replay requires a separately approved forward-looking media identity contract; it cannot be retroactively invented for old records.

## Isolation

The added review is static React text. It requests no media or network data, creates no timers/effects, and has no playback, recording, engine or persistence controls. Closing, switching or refreshing history uses the existing reader lifetime fence; nothing in the added view can continue playback. Existing exports remain byte-for-byte based on their captured old snapshots.

Program checks and actual cloud-browser publication checks are recorded separately. No physical-device or native-IME qualification is implied.

## Candidate program evidence (2026-10-09)

- 15 defensive projection/view tests plus five actual component/history-panel SSR integration tests pass. Includes all four word kinds, exact stored spelling, legacy rules, missing fields, mismatched material/cue/session/round, changed current reference, invalid positions, escaping, paused-engine immutability, and no partial-history reconstruction.
- 583 core/scene tests, 57 media tests, and 48 validation tests pass (688 total); TypeScript and production build pass.
- Existing history lifecycle/read fences and recording lifecycle tests remain passing. The new component creates no media, effects, handlers or timers, so no new playback cleanup or recording mixing path exists.
- Production main Studio, scoring/repository/partial-history source, scene renderers and app styles are unchanged from v49.
- Independent review identified a malformed saved alignment position edge case; range, duplicate and ordering checks now mark the malformed items unavailable using saved `words` only. No retokenization or regrading was added.
- Candidate localhost browser QA was not attempted because that URL had already been denied by browser policy. The authorized existing public HTTPS Site is verified after deployment; this is distinct from the program checks.
