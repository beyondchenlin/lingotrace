# v70: bounded NPS AAC transport compatibility

## Trigger and evidence

The user's v69 Android screenshot reports native `PipelineStatus::DEMUXER_ERROR_DETECTED_AAC` at metadata, MEDIA_4 / ready=0 / network=3. v69's normalized container did not resolve that phone. Both original and normalized files carry AAC-LC (AudioSpecificConfig 1190), not an identified xHE-AAC stream. The exact vendor error is not identified in the upstream Chromium versions inspected. Historical Chromium Android code distinguishes Blob from the platform URL path; that supports this bounded same-bytes transport comparison, not a claim that the current device's root cause is proven.

## Scope and immutable identity

Default playback still uses fully verified Blob bytes. NPS alone permits one metadata retry on the fixed same-origin content-addressed URL after native code 4 and the exact raw message above. Whitespace, prefixes, suffixes, general MEDIA_4, hash, MIME, network, timeout and duration failures do not qualify. Main playback may perform the same one retry if private verification succeeded on Blob but the main element itself encounters that exact error. No automatic audible play is introduced.

Source Material remains `b2ea5fa763a5687961606061afbef1b7619fcaff3ccd04b3e0b9f14584ffa642`. Playback representation remains `1ae4ef4410aa49a86a654303c7fe52ef26b86484e22fae234911bb2ec1c46526`, 19,581,425 bytes. It is copied to a full-SHA filename; original and v69 URLs are retained byte-for-byte. There is no audio/video re-encoding, subtitle change, source/reference rewrite, Training event/attempt/partial schema change, storage migration, bookmark expansion or scoring change. `playback-variant-v2.json` declares the explicit URL/transport contract.

## Verification and lifecycle

The initial fetch requires HTTPS same origin, exact final URL, basic response, no redirect, video/mp4 MIME, nonempty bytes and actual SHA-256. A private WeakMap grants only a live pool-created holder the direct conversion capability. Copying fields cannot forge it. Conversion is idempotent, per holder, and preserves shared fetch/hash ownership. Releasing either view invalidates both views of that holder, not unrelated holders.

The verifier's actual valid transport is captured before retaining a separate holder, rechecked after acquisition, and applied to the main holder. The main element validates live ownership, src/currentSrc, actual duration and registered cue bounds; source snapshots are updated together. Cancellation, recording, hidden, navigation, disposal and stale errors do not change a newer source. Direct failures include actual transport and remain unavailable without changing the saved round. All media uses anonymous same-origin loading; preview/recording audio selection rules remain unchanged.

The initial JavaScript fetch is cryptographically checked. A native video's later HTTP request is not JavaScript SRI and its currentSrc is not a network redirect trace. The direct route relies on this deployment preserving the fixed same-origin content-addressed resource. Unknown URLs and unknown transports are rejected. Old assets must never be overwritten.

## Isolated actual-path check

`/media-transport-check/` accepts no URL input and is not linked from the main stage. Its explicit button fetches and verifies only the fixed NPS resource, then chooses direct transport for metadata, manual playback, first/second/last cue seek and decoded Canvas/PNG checks. It has no Training engine, IndexedDB, localStorage, learning score, upload or permission request. Stop, hide, pagehide and unmount release its own source. This is an explicit direct-path check, not an artificial claim to reproduce the phone's native AAC error.

## Evidence gates

- Core/scene tests, media tests, typecheck and build must pass on the frozen candidate.
- New pool/controller suite covers raw-error exactness, one retry, shared ownership, response identity, MIME/type/hash failures, forged or released capability and lifecycle.
- Actual extracted Studio host suite covers verifier-to-main direct handoff, main-only AAC retry, repeated failure, cancellation/hidden/recording/disposal, retained old round and no autoplay.
- Independent code review precedes same-site release. Build outputs must be supplemented with all 104 v69 immutable assets; deploy the frozen dist, not an isolated rebuild.
- Actual HTTPS normal app and isolated direct page require separate verification. Desktop direct metadata/play/seek/Canvas success does not prove the AAC trigger happened naturally or that the affected Android now succeeds. The user's device remains the final compatibility check.

This delivery is a media compatibility hotfix only. The paused NPS bookmark work and all other incomplete PRD capabilities remain outside it.
