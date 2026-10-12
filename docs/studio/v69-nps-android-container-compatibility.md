# v69 — NPS playback container compatibility

## User report and limit

The Android screenshot on 2026-10-10 reports `[metadata; MEDIA_4; ready=0; network=3]` before the hidden verifier has called play or handed off to the lesson. It establishes native metadata/source rejection after complete fetch and SHA validation. It does not establish a duration, autoplay, MIME, permission, or specific Android decoder cause. Cloud desktop playback cannot establish the affected phone's outcome.

The original has signed-negative composition offsets encoded under ctts version 0 and unset avcC reserved bits. These are observed noncanonical packaging features. Current Chromium and ExoPlayer contain tolerance, so these features are compatibility risks rather than a proven cause of this phone's failure.

## Bounded change

- Keep the immutable original NPS Material, all 11 cues, original MP4 and source hash, captions, attempts, history, partial exact schemas, review task identities and exports unchanged.
- Use a separate fixed playback descriptor for the same NPS source: original source identity plus independently named/hashed lossless MP4 representation. No runtime arbitrary URL fallback, no coffee fallback, no re-encoding, no new audio track, no new capture permission.
- The media pool fetches and hashes the fixed representation. `actualSha256` always means the fetched bytes, and differs from the original source SHA. `isVerifiedCourseMediaLease` checks original source identity, exact authorized representation tuple and actual representation SHA. The preview, retained handoff and main/review player all use that check.
- The original Cafe descriptor/lease keeps its prior shape and behavior. The ongoing NPS-bookmark work is not included.
- Existing one-fetch/hash shared lifetime, cancellation, recording guards, cue boundaries and submillisecond duration margin remain in place. Failed representation verification does not reset the old round. A main-decoder error after new-round commitment retains that round and allows explicit verified reload.
- The source panel links a public dual-hash provenance manifest. Persisted material export continues to describe the original reference, never falsely claiming that the playback representation is the original file.
- Native media errors additionally show a local-only sanitized message of at most 160 characters. Source URLs and control characters are removed. No telemetry or diagnostic upload was added.

## Exact assets

Original source: `nps-connie-lau-education-ranger-video-v1`, 19,584,717 bytes, SHA-256 `b2ea5fa763a5687961606061afbef1b7619fcaff3ccd04b3e0b9f14584ffa642`.

Playback: `nps-connie-lau-lossless-mp4-v1`, 19,581,425 bytes, SHA-256 `1ae4ef4410aa49a86a654303c7fe52ef26b86484e22fae234911bb2ec1c46526`.

Method: FFmpeg stream copy, faststart, `movie_timescale=48000`, then only two avcC reserved-bit bytes normalized (03/01 → FF/E1). The ordinary 1000-timescale remux was rejected because it shortened the last AAC packet by 16 samples.

All 1,301 video and 2,033 audio packets match per-stream payload SHA, PTS, DTS, duration, size, flags and skip-samples data. Full decoded framehash files are identical, SHA-256 `802fad2706aa9f731420c0d3d1996aa7ca8bdc297245c920150ed764a8caa5f9`. Video duration remains 43.366667 seconds. This proves equivalence under FFmpeg's interpretation; it is not phone playback or independent caption listening verification.

## Program validation

- New media representation contract: 31 failures before implementation; 35 passing cases after.
- Actual host focus: 37 passing cases, including exact source/representation identity, wrong bytes, missing/altered variant, old-round preservation, one fetch, cancel/hidden/recording/dispose, main failure and explicit retry.
- Full core/scene: 1,352 passing.
- Full media: 527 passing; 1 existing optional browser-encoder skip.
- Typecheck passed. Build and final frozen resource checks are recorded in the release evidence.

Normal HTTPS and the reporting Android device must be reported separately. No claim that the Android issue is resolved is made by these program checks.
