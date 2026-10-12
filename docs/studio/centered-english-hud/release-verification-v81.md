# LingoTrace v81 · Integrated release verification

Date: 2026-10-11. Exact-source review, build and the exercised functional cloud-desktop browser gate passed with limitations. This note precedes native publication and public smoke; their final identities/results are recorded separately. Full-PRD, user visual acceptance, physical-device and crash-resolution claims are not made.

## Exact scope and identity

Reviewed source: `55bf7b7d05efca200127151dd8b9aa3bd5499c97`. Formal base: published v80 `1b46f53195f7a1c86637d72555a972fe1d4a78dd`. The candidate combines assisted live-letter matching/difference feedback with the separately reviewed media-playback ownership race correction. It adds early neutral capacity limits, bounded/reused feedback buffers and same-frame listening-state reuse. Complete drafts, saved history and formal grading are not truncated or rewritten. Input-following adaptive speed is not included.

BUILD_ID: `aj-C5EZBRf9WPfudVoo0V`. Current runtime: `615-ff2308398fe25fa5.js`; Studio page: `page-c513053458f2b1fc.js`. All 590 reviewed non-dist source files and 388 deployed payload files were verified. Canonical payload-manifest SHA-256: `a04ba2e67d6155b34fc4389a4e864ccdc6686a9dce89eebd6c2b2ee2f1eb65a4`. All 246 immutable overlaps match. All 118 protected public assets and 130 earlier documents are unchanged. The retained v80 checkout remains clean. Only the paired v81/media status-evidence updates and this note are layered onto the reviewed source.

## Verification

- 1,900 core/scene tests passed, zero failures/skips; 823 media tests passed with one pre-existing optional recorded-MediaRecorder fixture skip; 93 HUD tests passed, zero failures/skips.
- Strict TypeScript and the exact production static-export build passed.
- Independent letter review covered 94 tests, 647 Unicode characters/1,941 combinations and native-gap probes. Integrated media review confirmed the ownership patch and four race probes. Root's final capacity and navigation reviews reran 72 and 19 focused checks. A 1,000-case comparison preserved normal-size feedback ranges.
- Actual a489 cloud-browser coverage: live green/straight and red/wavy native character feedback, middle edits and Tab/newline paste, neutral hidden mode, no live formal attempts, explicit checked priority/edit invalidation, café listening navigation, responsive layouts and retained locale/drafts.
- Actual final 55bf gate: all 388 manifest entries verified and replacement runtime HTTP 200 observed; saved Chinese preference/draft recovered; correct/error native edits recomputed feedback; Hide removed reference and answer-derived color/validity hints; Listen Next/Previous moved to 6/0 seconds; Continue → Let me type retained the draft and stayed paused. Roughly two minutes passed without additional error 9. Final checks cover the changed identity and focused functional delta, not every earlier matrix cell or a stress benchmark.

## Unresolved and unverified

Two earlier QA pages, including a489 and an older preview, showed Chromium error 9. Cause remains unresolved. Normal reload restored saved data and about four minutes of single-QA-page recovery passed. Neither the performance correction nor the short final pass establishes a crash fix, long-duration or multi-tab stability. Existing listening observation-history snapshot work still grows with history.

NPS response-body loading remains limited. Static native-audio packet evidence is distinct from actual audible quality or lip-sync acceptance; the user's unspecified original sound/picture symptom is not claimed resolved. Genuine device IME/mobile OS, Safari, camera/microphone, real recording/recorded-clip feedback, audible native-track synchronization and portrait source-media import remain unverified. The existing optional MediaRecorder skip remains a skip.

The earlier partial-i18n, small half-size Inside safety-extension and other v80 limitations remain. Original assets, recordings/privacy contracts, source timings and formal scoring are unchanged. No screenshots or private QA records are packaged.

## Release continuity

The same existing public site and access revision 2 remain the target. Exact v80, v79, v78 and v77 saved versions/archives are retained for rollback. The final native receipt, rather than a self-referential future commit in this note, identifies the saved version, release commit and deployment. Actual public smoke must be reported separately.
