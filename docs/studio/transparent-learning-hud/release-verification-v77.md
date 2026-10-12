# LingoTrace v77 release verification

Recorded 2026-10-11 for the controlled update of the existing public LingoTrace Site. This note records verified evidence before publication; the final Sites version/deployment record identifies the containing release commit.

## Identity and scope

- Reviewed runtime/test source: `badc0086afe7013081655598c11c01557660a6ed`.
- Same Site: `appgprj_6ac5ccefb20481918a883afab8a483b4`, public access revision 2, https://lingotrace-training-demo.beyond-chenlin.chatgpt.site/studio/.
- Full source relative to live v76 includes the earlier pause, subtitle-timing, cadence and course-admission changes. The separate 32-file R2-relative list is not the complete live-relative change set.
- Frozen build: 346 files, 178,759,661 bytes; BUILD_ID `LqGip-a0UfHy6PxsCXyCS`; canonical path/hash tree SHA-256 `089c99715bcefb79050dd96f919bf6be6fedf6a59abc7915b2658daf182612b8`.
- The release adds only this evidence note and the Detailed PRD status/evidence update to the reviewed source. Runtime/test and frozen build bytes are unchanged. Earlier PRDs and all requirement clauses are preserved.

## Verified evidence

- Exact-source aggregate: 1,788 core/scene tests passed with no skips; 815 media tests passed with one identified pre-existing recorded-MediaRecorder fixture skip; 93 HUD-library tests passed with no skips. TypeScript and production static export passed.
- Independent review approved exact badc008, including 32 focused tests and 560 range-coordinate probes. Prior aebc707 geometry review passed 22 focused tests and 72 additional combinations.
- Actual cloud-browser inspection of aebc707 verified the replacement landscape/portrait HUD, native input/selection/submission, 1×/0.5×/Fit sizing and aspect, HUD sizing, café listening, global pause and blocked controls, canceled-repeat recovery and two-total-pass counting. The final two fixes do not change those flows.
- Actual badc008 browser retest: visible rail 0/25/50/75/100% mapped to 0/18/36/54.05/72 seconds on the 72-second café fixture. Native drag and Arrow/Home/End passed. This is UI alignment evidence, not frame-accurate seek proof.
- Native Fullscreen set `:fullscreen` on MAIN and changed the action to Exit fullscreen; native Escape cleared it and restored the label. Cloud host chrome remained visible.

## Limits and follow-through

Cloud browser and automated tests do not verify fully immersive physical OS presentation, real phones, OS IME/software-keyboard hardware, camera/microphone, encoded recording output, or genuine document-hidden transitions. The minor heavy/outlined large-landscape text observation remains disclosed; no displaced baseline or functional obstruction was established. No end-user visual acceptance is claimed.

Post-publication HTTPS smoke is a separate check and is not claimed by this pre-publication note. The previous NPS client-blocking limitation is not represented as resolved by the café evidence.

Rollback remains the retained archive-backed v76 version `appgprj_6ac5ccefb20481918a883afab8a483b4~appgver_37e8cf902db48191bf6bb59bb41f844b`, source `98faf71bd72b09d346e0b89b72fa6a99fc363edc`. Public media and models are preserved; the only intentional non-runtime asset edits are the reviewed subtitle-workbench code/UI files plus timing.js.
