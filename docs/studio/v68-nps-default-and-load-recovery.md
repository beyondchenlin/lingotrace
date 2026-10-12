# v68 — NPS default entry and verified-media load recovery

## User instruction and scope
The user explicitly requested on 2026-10-10 that opening the normal training entry load the NPS real-person video by default, and reported that selecting it displayed a video-load failure on Android. The report is treated as an actual user failure. Passing cloud QA on v67 does not refute it.

This delivery changes the ordinary host default and repairs two independently reproducible software failure chains. It does not claim a confirmed Android-specific root cause, does not auto-play sound, and does not change the existing stage geometry, metrics, visual anchors, grading, media bytes or caption text.

## Proven v67 failure chains
1. The detached verifier released its last pool lease before the lesson acquired the source. The actual host plus production pool therefore executed fetch/blob/SHA twice for the same 19,584,717-byte NPS file, revoking the first URL between stages. A failure of the second fetch occurred after the new session was selected and was incorrectly converted to a global history-restore failure, disabling retry. HTTP caching may avoid a second network transfer; the proof is two fetch/blob/hash operations, not guaranteed 39 MB wire traffic.
2. The catalogue already allowed a 1 ms NPS metadata margin, but the lesson and existing task comparison used exact duration equality. The same verified file reporting 43.366667 on one decoder and 43.366668 on another was rejected after preparation. This is an injected deterministic reproduction of an unsafe precision boundary, not a measurement from the user's Android device.

Original frozen v67 probes and output: `/workspace/shared/lingotrace-nps-default-v68/v67-diagnostic-probes/`. Source baseline: `036373f49d177c5a15eb5f73a6b8366b176d71dc`.

## Default and restoration contract
- TrainingEngine's global/default café semantics stay unchanged. Studio explicitly constructs a new NPS initial practice.
- The ordinary entry restores the most recently retained, exactly registered NPS complete session when automatic history permission is legacy-default. An old café latest pointer cannot silently replace this default.
- If there is no saved NPS session, the ready NPS preview is new and empty. Its runtime clock is deferred until first real nonempty input, and the narrow fresh-preview history admission never writes an empty replacement, claims a committed attempt, or changes meta.latest just by opening, loading, browsing, playing or pausing.
- Old café/corrected sessions remain unmodified in history. The existing history detail offers an explicit continue action. It flushes current permitted work under the existing locked transition boundary, rereads the exact selected snapshot and permission, and navigates with the selected session id/sequence. Failure or privacy gaps preserve the current page.
- Successful initial explicit restoration consumes the one-time sequence guard, while keeping the selected id for that chosen page's refresh. A later explicit new session clears the old resume selection. A normal entry with no resume parameter still selects NPS.
- OFF/segment states retain the existing saved:null privacy boundary. No complete old-session recovery across a gap, no raw answer backfill, and no new partial schema or permission shortcut.
- The original saved/passive restoration admission remains strict. Fresh-preview admission cannot erase dirty writes, pending operations, prior answers or recovery facts. No repository/CAS schema migration.

## Media contract
- An operation-owned temporary reservation retains the already hashed source across verification and lesson handoff. The lesson consumes that lease once; cancellation, stale selection, hidden state, recording block, failure and disposal release it. No permanent cache or alternate URL.
- Every strict lesson still checks media id, expected SHA, actual SHA, its source URL, session/material identity and actual metadata.
- Only the exact registered NPS identity with the same verified SHA permits ≤0.001 second decoder rounding differences. The actual duration must also remain within this margin of the registry and stored target. Every cue must end at or before the actual media duration. Café/corrected duration comparisons remain exact. Existing stored task targets are never rewritten.
- A media failure blocks NPS answer/submit until verified recovery but is not treated as history restoration failure. Reusing the normal reload action or play control retries the same current material/session. Recovery never silently substitutes café and never automatically starts sound.
- Existing error surfaces distinguish fetch/network/HTTP/body, hash, metadata, lesson decoding and runtime playback, with safe local numeric diagnostics. Source URLs, private answers and raw browser error messages are not included.

## Verification boundaries
- The public v67 MP4 returned HTTP 200/video/mp4 and the exact official SHA during this investigation. The cloud desktop browser reloaded it successfully at a 500 CSS-pixel width, readyState 4, 43.366667 seconds. These observations do not establish the user's Android result.
- Normal cloud Chromium has its incognito menu disabled; no policy change, database clearing or workaround was used to manufacture fresh-browser evidence. New-user and stored-user boot cases are independently exercised with the actual host and isolated real IndexedDB implementation in tests. Final released HTTPS evidence must be reported separately.
- NPS source/rights remain unchanged: National Park Service official public-domain basis, no endorsement, original MP4/VTT preserved, one explicit final subtitle clamp. No new AI, account, camera/microphone permission or external answer transmission.

## Candidate verification
Final implementation suite: 1,345 core/scene tests passed; 487 media tests passed with one existing optional skip. TypeScript check, production build and diff check passed. All 94 prior immutable assets are retained byte-identical, and both site entries reference existing final resources. All stage source and public media asset bytes remain identical to v67. Independent review and normal final HTTPS acceptance are separate release gates.

## Bounded failure diagnostic follow-up

After the first candidate freeze, failed duration checks add finite actual/expected/tolerance numbers to their existing error text. No comparison, timing margin, successful path, layout, storage or source identity changes. Three formatting tests cover exact values, nonfinite unknowns and input immutability. Final full gate: 1345 core/scene + 490 media pass, 1 pre-existing optional skip; typecheck/build pass.
