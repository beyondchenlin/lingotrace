# Local context bookmarks: F13 subset

Base: `7f32c94ded91e356178a17b2221719b72aa904ca` (published v60).
This is an integrated candidate description; publication and actual browser
acceptance are separate evidence. Full F13 is still incomplete.

## Approved scope and source

PRD v1.4.9 F13 / P17, T82 R5 and T103 R4 specify selecting a word or
phrase and keeping its original sentence version, material and time interval,
with return to that original context. This batch implements that complete local
bookmark loop for the existing original café course. It does not implement
explainable review scheduling, retest outcomes, pronunciation comparison,
lexical/daily totals or a new Practice data model.

The entry is inside an already-submitted row in the current round review, plus
an existing settings entry to the local library. Unsubmitted rows keep their
reference and draft hidden. Native start/end word selectors choose a contiguous
span of the actual canonical reference, including original punctuation between
words. Saving requires an explicit action and an actual verified original media
lease with a usable, finite duration containing the whole cue.

The main stage, semantic colours, idle animation, layout and input are unchanged.
No learning event is emitted by bookmark selection, saving, library read or
playback. Current per-cue drafts, attempts and earned values remain owned by the
existing Training engine. Returning from the library returns to the same draft.

## Persistence and exact provenance

`context-bookmark-v1` stores only a canonical reference, exact selection offsets
and text, a creation time and an independent save UUID. The reference pins
material/version/cue/text/start/end plus the original media ID and SHA-256:
`22fc25ade368f351cda21951916e559ff359cf1ac8419fbfa5444e050cdbf740`.
The bytes are the unchanged `/studio-assets/06-cafe.mp4`.

This new binding is created at the user's save action. It does not claim which
media an older attempt used. Existing legacy history remains unavailable for
media reattachment; there is no Training database migration or rewritten fact.
The new independent IndexedDB database is `lingotrace-context-bookmarks-v1`.
It remains independent of the automatic-history setting: turning automatic
history off does not prevent an explicit save and does not create any automatic
bookmark. No answer, draft, score, XP, due time or review task is stored.

The stable content key makes same-reference/span saves idempotent. Read and add
run in one readwrite transaction, including across tabs. A successful request
alone is insufficient: saving waits for transaction commit and then rereads the
actual record. Removal requires the displayed save UUID and compares it within the same
readwrite transaction before deleting; stale tabs cannot remove a fresh
same-key incarnation. The UI rereads the actual list after a conflict. Removal
also commits and rereads; re-creation by another tab is a
conflict rather than a false removed-success receipt. Removal followed by a new
save receives a fresh UUID even within the same millisecond. Corrupt, additional
fields, unsupported versions or changed canonical bindings are unavailable and
never repaired, guessed or silently overwritten. Read/list on a nonexistent
library aborts the initial upgrade instead of initializing a database.

Only content-free change notifications travel between same-origin tabs.
Subscribers and focus refresh reread real storage, invalidate prepared playback,
and stop removed/replaced selections. Storage failure is shown as failure,
not an empty library or zero achievement. An empty library states no bookmarks.

## Verified, isolated playback

The lesson and dedicated preview share one refcounted original-media pool: one
fetch and Blob URL per retained generation, with a transient SHA-256 buffer.
The digest buffer and Blob are not stored again in bookmark records or a cache.
Last release revokes the URL; last pending release aborts loading; obsolete
results cannot create a retained URL. Ordinary lesson rendering may use an
unverified fallback, but saving and bookmark playback then fail closed.

The user selects a bookmark, explicitly requests verification/preparation and
then presses a separate ready-only Play button. Preparation rereads the saved
incarnation both before and after media verification; it never autoplays.
Playback invokes native video.play synchronously from the second user gesture,
checks exact canonical version/hash/range and actual finite duration, and stops
at the cue end. A selected source that changes is stopped rather than substituted.
Explicit retry can replace a failed verified-media generation without breaking
an active ordinary-lesson lease.

This dedicated preview is not the stage video or a recording input. It follows
course volume, course mute and all-monitor mute. Main lesson playback pauses
before a preview starts. Preview playback is blocked and immediately silenced
through recording preparation, capture, and stopping; the synchronous blocker is
set before captureStream or the selected recording audio graph is constructed.
No new audio node, capture stream or recording track is created. The existing
white-noise exclusion and explicit recording audio choices remain unchanged.

Selection replacement, refresh, repository notification, focus, hidden/pagehide,
recording and unmount invalidate pending operations. Hidden/pagehide clears the
preview source and lease; return never reloads or plays automatically. Closing
the panel disposes listeners, timers and media resources. Recording ending also
never resumes the preview automatically.

## Verification and remaining acceptance

Program tests exercise the actual eligibility/save handler and submitted-only
review JSX, independent IDB transactions and readback errors, concurrent saves,
corrupt/unknown source data, stale incarnation, hash/range/duration failures,
media pool refcounts and cancellation, preview bounds, native-play failures,
monitor/recording guards and background/disposal. Hook-level UI tests cover the
actual asynchronous prepare/play/remove flow and stale-result cancellation.

Before publication, run the complete core/scene, media, HUD suites, TypeScript,
production build and the additive publication-tree preservation check. Keep v60
as the stable same-site rollback identity. Only after independent frozen-code
review should the candidate be published for normal HTTPS acceptance.

Required real-browser checks: empty library; hidden dictation stays hidden;
explicit word and phrase save, duplicate save, reload persistence, exact selected
reference and bounded original clip; monitor mute/volume; return to unchanged
draft; cancel/re-add; concurrent same-library tabs; keyboard access and close
cleanup. Actual encoded recording isolation and true hidden-page behavior must
be claimed only if exercised in a supported independent test instance. Existing
recording-store lease and pending file-upload approval must not be bypassed.
No browser-acceptance or full-F13 completion is inferred from program tests.

Frozen-candidate gate results: core/scene 850 passed; media 338 passed with the
same one optional encoded-MediaRecorder-fixture test skipped; HUD library 93
passed. The media count includes 25 actual library-hook lifecycle tests and 63
new media controller/pool cases. TypeScript and production build passed. The
additive assembly preserved all 125 protected v60 publication files initially and
all 130 protected candidate files after review fixes, adding five and three
dependencies respectively. All 98 tracked main scene/HUD-library/media source
files are byte-identical to v60; this is source preservation evidence, not a new
browser screenshot or actual recording result.

Independent-review fixes include conditional deletion by saved incarnation,
truthful conflict refresh, superseded native Play-promise ownership and ignoring
a stale pause event when the element is already playing. Both media races were
reproduced as failing program tests before their fixes; canceled/hidden/recording
and disposed late-play silence remains covered. These are controlled event
sequence tests, not a claim the races occurred in the live browser.
