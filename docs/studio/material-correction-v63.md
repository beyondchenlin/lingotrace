# v63: current-cue local reference correction

Base: v62, `c50e27116050a652d0b43b368ef0a46fc952cf0b`.

This implements the approved F11 text/start/end correction subset on the existing
Training engine. It is not full F11: merge/split lineage, imported subtitle
tracks, regrading, AI transcription and corrected-version bookmarks are outside
this increment. Existing original-version bookmarks remain available.

## Complete flow

The material panel opens either the local reference list or an explicit
current-cue editor. Opening the editor actually exposes that cue's reference and
records the reveal first. Cancelling edits does not undo that real exposure.
The editor displays no other cue's hidden reference text.

Edit text and start/end, prepare the exact original-media clip, explicitly
preview if desired, then save a new local immutable reference. Saving does not
start a new practice, create an attempt or grant words/XP. The library can be
reloaded; entries show metadata until explicitly starting a selected version.

“End this round and start a new practice with this version” safely flushes the
old permitted boundary, creates a new session on the exact edited cue, connects
its writer and waits for the existing active segment intent to obtain its real
permit. It then really shows the selected reference confirmation and records
that reveal before typing is enabled. Hidden/pending confirmation does not
silently become an unassisted first answer.

The new answer uses the embedded new reference. Old answers, references, scores,
attempt conditions and event prefixes remain attached to the old session.

## Reference identity and storage

`local-reference.ts` and `local-reference-repository.ts` use a separate
insert-only IndexedDB store. No Training database version or existing row is
migrated. Each receipt verifies the complete canonical material digest, complete
receipt digest, parent material/version/digest, and exactly one cue's old/new
text/start/end. Cue IDs, count and order are stable; unrelated metadata cannot
be changed under a correction request.

A fixed save-request identity is retained through failed retries and returns the
same stored receipt. The same version or request cannot name different content.
Concurrent siblings remain distinct; there is no automatic “latest” adoption or
delete/overwrite operation. Success requires validated readback.

Only new material versions receive the optional `localReference` envelope.
Absence in old data stays absence. New metadata is strictly validated without
tightening the pre-existing validation of legacy materials.

## Real exposure, compatibility and privacy boundaries

Complete Training events may add `referenceExposure` to an existing real
`hintExposed(kind: reveal)`. This identifies the correction editor or corrected
reference confirmation. Existing Conditions, Draft, Attempt, scores and rule
versions are unchanged. A read-only projection uses only matching
session/material/version/cue evidence before that attempt's submit boundary;
a later editor visit cannot relabel an old attempt.

Missing provenance means “not recorded”, never false, zero, complete or
unassisted. Partial history retains its exact existing reveal-only schema and
reports no cause. It does not gain a full reference, extra metadata, sidecar or
old OFF-period exposure. Frozen v62 segment readers keep accepting new partial
facts. Frozen v62 full replay preserves the optional complete-event fields.

Full allowed legacy sessions can restore the exact corrected material. OFF or
partial recording still restores no current practice: only the explicit
reference library is recoverable there. No complete Training snapshot is stored
to work around that permission boundary. Full user-initiated JSON/CSV retains
raw additive facts; partial exports keep their limited coverage.

## Transition and media safeguards

The new-version transition locks explicit input, exposure and selection while it
captures and checks session, sequence, full material identity/digest, cue and
privacy generation. Target readback, old flush and final permission read all
revalidate the same boundary. The caller repeats boundary and write-status checks
synchronously immediately before reset, including the async helper-return gap.
Dirty tails, pending saves, errors, CAS conflicts
and stale targets prevent reset. The pre-existing ordinary restart implementation
is otherwise unchanged; the new flow does not copy its weaker dirty-and-error
predicate.

Preview reuses the existing original-media Blob pool and a dedicated non-recorded
video. No second persistent large-file copy, new audio graph or recording track
is introduced. Preview is blocked synchronously for preparing/recording/stopping,
obeys course/all-listening mute, and stops/releases on close, hide, source change
or late cancelled promises. Saving requires the current exact preview proof.

Corrected-course playback separately requires the saved exact material, verified
actual media hash, actual source lease and matching finite duration. It does not
inherit the ordinary course's URL fallback or the 72-second display default.
Unknown/unavailable corrected duration uses zero only as an internal disabled
control sentinel; the existing Canvas displays “媒体时间待就绪” and the seek
accessibility label explicitly says unknown/unavailable, not a factual zero.
A cue switch revokes the corrected-play owner; a late cancelled native promise
cannot resume it or pause a newer explicit owner. These are defensive program
negative tests, not confirmed browser-standard production races.
Each explicit corrected play rereads the library; missing or mismatched data
keeps historical text/scores but prevents verified playback/correction. Ordinary
original-course behavior and original bookmarks remain unchanged.

## Verification boundary

The candidate includes focused library, field compatibility, component-handler,
media-identity and actual Studio host-flow tests, plus the existing regression
suites. Test-only frozen v62 source checks legacy replay and fixed-boundary
JSON/CSV identity. Synthetic encoder/media fixtures are program evidence, not
an actual encoded recording or physical browser-background claim.

Independent frozen-code review and normal HTTPS browser acceptance must be
completed before calling this delivered. Their final results are recorded with
the publication artifact; a successful build alone is not browser acceptance.
