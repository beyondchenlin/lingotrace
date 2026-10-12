# Course admission: settle permitted writes before judging restore

Source baseline: integrated R2 `655cf9b0ba0f30e52852f269eb8dbe455c69a9d0`.

## Reproduced defect

The actual `startBuiltinPractice` handler awaited its own new-course flush, then
rejected any outstanding write as a restore failure. A queued ordinary flush can
overlap that write. The first write can succeed, leave the new snapshot exactly
saved and clean, and still leave `pendingWrites: 1`. The handler then latched a
restore error even when the second permitted write subsequently succeeded.

An exact-handler test reproduces this with real Training, the history recorder,
and IndexedDB, while controlling media and write completion timing. The same
regression is red on R2 and green here. This is a reproducible possible cause of
the browser's course-save warning, not proof of that particular browser timing.
The renderer crash remains unexplained.

## Scoped behavior

- Ordinary `flush()` behavior stays unchanged.
- Course admission drains relevant outstanding writes, captures current facts,
  and permits at most one further same-session tail capture. Remaining dirty
  facts still fail admission rather than being discarded or retried forever.
- Errors observed during the boundary remain failures even if another flush
  clears the visible status. A failure serial covers the final await-return gap.
- The boundary checks owner, recorder epoch, session, round, cue, material,
  recording mode and permission generation. It rereads the stored permission.
  The host synchronously asserts the returned receipt before admitting the course.
- A transition-owned abort signal releases waits on hidden/pagehide, disposal or
  cancellation. Completed media requests do not own this lifetime. Cancellation
  does not cancel or delete already permitted storage writes.
- Existing dirty/error/pending checks, privacy fences, and real restore-failure
  recovery remain in place. No attempts, scores, playback, or recording policy
  are created or changed by admission.

## Verification

- 21 new focused tests cover overlap success, late failure, later-cleared failure,
  bounded tail preservation, OFF/identity/disposal cancellation, hidden/pagehide
  in OFF and segment modes, permission changes, and final continuation timing.
- 68 focused admission, existing course/media-retry/lifecycle and recorder tests
  pass with zero skips.
- TypeScript and `git diff --check` pass.
- Independent review: nine additional cancellation/final-boundary regressions
  pass; no remaining blocking finding.
- Full aggregate/build and actual-browser retest are deferred to the integrated
  UI candidate. This source change does not publish or update any frozen dist.
