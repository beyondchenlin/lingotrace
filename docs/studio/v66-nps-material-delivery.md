# v66 candidate: fixed-source NPS test material

Baseline: v65, source `18eaf70df62231e949a608f976c444c68cf84970`.
Status at authoring: isolated candidate; no v66 publication or normal HTTPS acceptance yet.

## Delivered software scope

The existing material panel offers an explicit choice between the retained original café course and the independent NPS Connie Lau education-ranger clip. Confirmation means ending the current round and creating a new practice. It does not change the reference in an old attempt. Preparation checks the detached media before crossing the saved old-session boundary. The host locks input/exposure/cue selection, verifies session/event/cue/material/privacy boundary after the flush, and checks again immediately before the synchronous new session. Pre-commit cancellation/failure leaves the original learning state. A post-commit failure is visibly blocked; it does not silently reset to café.

The new round has 11 stable cues, an empty draft, hidden reference and zero attempts. The existing Training reducer supplies input, submission, scoring, replay and exports. Its score and timing rules are unchanged. Saved attempts can be inspected and explicitly scheduled through the existing manual review-task flow. No automatic interval/mastery threshold has been added. NPS correction and context bookmarking are unavailable and labelled as such.

## Immutable source and media contract

NPS source: https://www.nps.gov/media/video/view.htm?id=7FE78A9F-1C89-4CDE-9BFD-DD0D0E4DE2CB

Credit: National Park Service. Source item credits NPS without a copyright symbol, with the official U.S. Government/public-domain basis. This is not a worldwide legal or personality-rights guarantee and does not imply endorsement by NPS or the speaker. No new AI, account, media permission or upload is involved.

Original MP4 is retained byte-for-byte: 19,584,717 bytes, SHA-256 `b2ea5fa763a5687961606061afbef1b7619fcaff3ccd04b3e0b9f14584ffa642`; nominal duration 43.366667 seconds. The original VTT SHA is `0ce3a2e3c8f1acb7a0d78eda6f3d8e4afbc7ef1ee5ffc503e2f150979b6146b5`. The independent sentence-map version is bound to SHA `24ea8d06860298369f97e850df7069eb7e9b468ef2ad5df6468f6e868289eedc`. Text is unchanged, merged by sentence punctuation; the final official 43.960 endpoint alone is clamped to 43.366 seconds. No claim of independent sentence-level acoustic alignment or music-free audio is made.

The mandatory `builtinReference` is a separate immutable built-in-source binding, never a café correction/parent relationship. It includes source URLs, original/normalized caption hashes, map version/hash, credit, original video identity/hash/byte length/duration. The entire material must exactly match the catalogue. Actual playback uses the selected verified blob lease, actual SHA, declared SHA, media ID, source/currentSrc and actual finite duration. The declared/decoded NPS duration tolerates at most 1 ms; a saved review target retains the actual measured value. NPS has no café, 72-second, or unverified URL fallback. Metadata failure, source mismatch and later decode error fail closed. Unknown duration is unavailable, not a factual zero-second clip.

Two independently owned media pools prevent a café lease from satisfying NPS. Detached verification does not play audio. Course listening and recording use the existing course audio router/selected lesson element; preview recording isolation and all-monitor/course mute rules remain. New source generation, cancellation, pause, cue change, backgrounding and disposal invalidate old playback ownership and clean up owned leases. The stage geometry, renderers, CSS, semantic colors and default palette setting are unchanged.

## Storage and old-client boundary

Coffee/corrected-coffee stay on `lingotrace-session-v1`, byte-compatible with v65. Only exact NPS uses `lingotrace-session-builtin-v1` in its full snapshot and every event. The repository checks the stored snapshot profile against its first event before replay. No IndexedDB upgrade, old-row rewrite, `latest` hiding or privacy-setting change was introduced.

Partial history stays `lingotrace-history-segment-v1` with the existing exact keys/facts. Only the existing `rules.trainingSchemaVersion` value records the actual new profile. There is no complete-source sidecar and no reconstruction of a full practice from partial facts. OFF persists neither new answers nor a resumable practice pointer. A refreshed OFF/segment page remains a fresh temporary practice until an explicit permitted action.

Frozen v65 full restore visibly rejects the NPS profile, disables input/submission, and does not write or alter permissions. Its already-published catch still displays the initial café preview in a different, zero-attempt engine; it never loads the NPS reference/results into that engine. This limitation is explicit: the guarantee is no answerable/writable mixed NPS-reference/café-media round, not removal of old immutable JS's initial preview. Frozen v65 partial history reads/exports the existing exact schema and genuine profile string; bootstrap returns `saved:null` and never replays NPS or fills in results. An older café writer may legitimately save its own distinct session and become latest without changing retained NPS bytes.

Rollback to v65 preserves NPS records, but the old client cannot resume them. A compatible new client is required to resume that full NPS round. No destructive downgrade or synthetic café reference is used to make it appear available.

## Test evidence boundaries

- Source package: original file SHA/decode checks from the public-domain source research; those are not live application acceptance.
- Candidate unit and actual-host-function suites: immutable registry/profile, old-byte equivalence, full/partial repository, real saved review sources/transactions, dual-pool/strict media, input/selection/cancellation/privacy/CAS and no default reference reveal. DOM/media device boundaries are synthetic.
- Frozen v65 design probes: eight cases, plus two actual new-writer → old Studio bootstrap/media/input/save/permission probes. These execute frozen source functions with isolated fake IndexedDB, not a mounted browser.
- Normal HTTPS acceptance: pending independent code review, controlled same-site publication and UI verification. No candidate code test is described as browser, human listening or device evidence.
- Real microphone/camera hardware and new real-source encoded-recording acceptance are not inferred from the earlier v64 original-media sample.

See the final frozen evidence index for exact commands, counts, source commit and publication/readback identifiers. Existing v65 remains the rollback baseline until that gate completes.

## Frozen candidate validation, 2026-10-10

`npm test`: 1,276 core/scene tests passed; 483 media tests passed and one pre-existing optional recording fixture skipped. `npm run typecheck`, `npm run build`, and `git diff --check` passed. The new real-host workflow suite contributes 21 cases. The new repository suite contributes 18 cases, including old-v65 NPS-task rejection with unchanged coffee task usability. The two real-new-writer/frozen-Studio probes also pass.

Both built entrypoints reference `809-33f6807945fa3ef2.js`; all referenced resources exist. The 86 prior immutable framework/chunk/manifest files remain byte-identical to v65 for already-open old pages. The 53 protected scene/source/original-media files checked against v65 are unchanged. Eight complete café/corrected-café snapshot, JSON, CSV and partial export hashes match the frozen v65 implementation.

Old tests were adapted only where actual-host extraction needed the added helper/import/state dependencies. The old review-task test body is byte-identical after extracting its shared fixture. Three frozen-v62 test casts are type-only. One architecture assertion now permits the single read-only built-in catalogue import in the saved-attempt projection; it still rejects engine, scoring, storage or media dependencies. No old behavioral assertion was weakened to accept new grading or retention semantics.
