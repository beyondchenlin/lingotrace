# NPS real-video test material — bounded v66 scope draft

Status: frozen bounded design, independently conditionally approved. Isolated candidate implementation now authorized; no online data changes or deployment yet.

## User-facing unit

Add one explicit choice in the existing material panel: “结束当前轮，使用 NPS 真人片段新开练习”. Keep cafe as the existing default and keep its original bytes/IDs/reference versions unchanged. New sessions can listen to 11 cues, type and submit using the existing scorer, save/read/export actual evidence, and use v65 explicit-date task/retest flow. No NPS correction, bookmarks, speaking assessment, AI, storyline or new permission in this batch. The main stage geometry/anchors/standby motion remain unchanged. The existing no-reference local file route remains preview-only.

## Immutable data mapping

- Exact NPS MP4: b2ea5fa763a5687961606061afbef1b7619fcaff3ccd04b3e0b9f14584ffa642, 19,584,717 bytes, 1280×720, 30fps, duration reference 43.366667s. Bundle under a new same-origin asset path, never overwrite 06-cafe.mp4.
- Material ID: nps-connie-lau-education-ranger-7fe78a9f. New immutable reference version derived from the sentence map digest; stable new cue IDs per original 11-row map. No alias to cafe IDs.
- Official VTT retained verbatim with SHA 0ce3a2e3c8f1acb7a0d78eda6f3d8e4afbc7ef1ee5ffc503e2f150979b6146b5. Derived map retains text, combines official caption boundaries by punctuation, explicitly clamps only final end 43.960→43.366. No assertion of human acoustic alignment or absence of background music.
- Separate builtin-reference binding contains registry identity, official source/caption identities, derived map identity and exact media ID/hash/expected duration. It is not local-reference-v1 and has no invented editedCueId/parent correction.
- Credit: National Park Service, official source link, U.S. public-domain copyright basis and non-endorsement. No NPS mark extraction as product branding.

## Compatibility contract under independent review

Ordinary generic v1 Material + a new optional field is unsafe: exact v65 Training/repository accepts the NPS record, then actual loadDemo selects cafe. Frozen red evidence is in frozen-v65-media-compatibility.mts and frozen-v65-media-red.log (2 red assertions; cafe and unknown-event-schema controls pass).

Frozen contract: only new registered NPS sessions use lingotrace-session-builtin-v1 in both snapshot and every event, with mandatory independent builtinReference. Keep SCHEMA_VERSION=lingotrace-session-v1 for coffee. Coffee and all old snapshots/events/attempts/JSON/CSV remain v1 byte-compatible; no global migration, no IDB upgrade and no latest-pointer workaround. Mandatory builtin binding must match the registry and event/snapshot schema. Mixed schema, unsupported or altered binding must fail closed. Grading/event meanings stay the existing rule versions.

New loadLatest must compare stored snapshot profile with first-event profile before replay, rejecting mismatches instead of silently normalizing them. The frozen v65 reducer rejects unknown event schema immediately; changing only the top-level snapshot schema is insufficient because loadLatest replays events. Old history list should show an individual unsupported record, not discard the rest. Old open cafe sessions can still work on their own identities; they must never overwrite a new NPS session or claim its reference is cafe. A refreshed/rollback old client must visibly reject unsupported recovery and stop saving/answering. Its historical startup error path may load its initial cafe preview; that cannot be represented as correct NPS recovery. Eight independent frozen probes now prove the old catch has restoreFailed, disabled input/submit, no save/new-round/permission writes, a distinct initial cafe session with zero attempts, and unchanged retained bytes/latest. The root explicitly accepts this boundary; it does not require changing the immutable old preview. Same-site publication still waits for actual candidate and HTTPS gates.

Partial fields and exact shapes stay unchanged. Projector accepts explicitly supported full-session schemas and writes the actual discriminator to its existing rules.trainingSchemaVersion string. Frozen old partial reader intentionally reads that string, and partial bootstrap still returns saved:null. It never reconstructs NPS answers/reference or a writer permit. No builtin binding, answers or hidden source sidecar is added to partial records. Eight frozen probes include old partial list/load and parsed JSON/CSV/protected export roundtrip, with saved:null/temporary/awaiting-segment bootstrap and no NPS auto-replay or catch-up. The actual new writer must still rerun the same compatibility gates.

## Minimal integration and safety gates

- New immutable built-in catalogue/module, second asset and attribution/reference files.
- Studio material choice, safe explicit transition and dynamic disclosure. Remove “synthetic cafe” description only when NPS is actually selected. Retain source/version/timing provenance in existing material panel.
- Parameterize verified media acquisition/preview authority by an explicit registered descriptor, keeping the cafe wrapper/default unchanged. One temporary digest buffer, exact actual SHA, bounded finite actual duration check and owned Blob/abort cleanup. No unverified URL or 72-second fallback for NPS.
- Extend isKnownReference and review target validation only to the exact registered NPS snapshot; use its own pool/hash/media ID in verifyReviewMedia/loadReviewMaterial and startup restoration. Existing task schema/atomic winner/source proof do not change.
- New-media preparation is locked against answer/exposure/cue/privacy races. Validate detached source before crossing the old saved boundary; cancellation/hash/metadata failure before commit preserves the old round and its owned media. Final synchronous boundary recheck follows successful flush, not a stale promise result. After any new admission failure, show blocked state/explicit exit, never silently turn it into cafe or score with mismatched media.
- Actual new course playback and palette/recording consume the same selected source; NPS correction/bookmark actions explicitly say unsupported. Course mute and explicit recording choices stay existing.

Required isolated gates: frozen v65 full/partial bootstrap+media/UI/save behavior; old cafe full/partial/export bytes; new missing/altered binding; actual media mismatch; cancel/late load/source switch; no default reference leak in DOM/AX/Canvas; old-boundary CAS conflict; saved real attempt/task successor/later; OFF and partial unknown/restore limits. Only after these and independent frozen code review may the existing same-site release workflow be considered. Otherwise keep the material candidate isolated.

HTTPS acceptance will use clearly identified QA data and actual normal media playback, sentence loop, hidden typing, stored reference/attempt export, explicit-date retest and unchanged old cafe record. Soundtrack or caption precision will only be described to the extent actually checked. The source pack's decode/frame checks do not claim human listening.

Independent design report: builtin-profile-design-review.md, SHA256 645ac9d0c21d2a9ebf87fcd571b5fae5833a773529d9c789fa13fd5b05a5586f. Source pack sentence-map SHA256 24ea8d06860298369f97e850df7069eb7e9b468ef2ad5df6468f6e868289eedc.
