# LingoTrace · Detailed PRD v81

Status: v81 exact integrated source `55bf7b7d05efca200127151dd8b9aa3bd5499c97` completed source review, exact build and the bounded functional cloud-browser gate with explicit limits. Earlier v80 evidence below is retained historical coverage; final v81 status is recorded at the end. Full-PRD, physical-device and user visual acceptance are not claimed.

## Evidence and changed clauses
The human request accompanying the 2026-10-11 05:23 reference image marks the confirmed-word label, trend placeholder, left-aligned input, Chinese error summary and isolated checkmark. It additionally requests central typing, obvious red errors and an inside/below-video keyboard choice for large displays with native-size video. The subsequent explicit i18n clarification supersedes English-only copy: default English, an explicit learner-selected interface language and gradual multilingual rollout. The earlier outer-frame question was traced to the whole-canvas focus-visible rule.

- UI-01 supersedes the initial English-only revision with key-based i18n. Canonical default is English; phase one adds en and zh-CN dictionaries and an explicit local preference. Do not infer a language from location or silently replace the default with browser language. Translate main Studio/HUD/settings/error/difference presentation and accessible names without changing stored content, identifiers, enum values, scoring or recovery decisions. Locale changes update DOM lang and the shared recorded Canvas without remounting practice/media/recording. Preserve full warnings. User-authored text/history stay untouched. Full application coverage remains an open goal; subtitle workbench and auxiliary legacy/authoring surfaces not converted in this phase must be listed in the verification report.
- UI-02 extends v78 reference presentation with a centered content block whose origin depends on the shown full current cue and available width, not each newly typed character. Native textarea remains the sole input. Long cues retain wrapping/scrolling. The shown block measures the complete cue once per font/viewport/reference geometry; typed prefixes never choose its width. Hidden mode uses a neutral centered block capped at 420 CSS pixels, independent of any previous or current cue; no target-derived text, count, width, accessibility node or scroll extent survives.
- UI-03 replaces the isolated check glyph and mismatched error/view-details treatment with the established translucent HUD vocabulary. Actual submitted replacement/extra words are red and distinguished without color; missing words appear as red labeled feedback after Check. The clicked summary opens a current checked-version difference card before the existing round/history review. Before an explicit exact-draft check, hidden dictation receives no answer-derived error hints. Edits invalidate stale feedback via the existing result selector.
- UI-04 adds a local presentation-only keyboard placement preference: Inside (default) and Below video. Inside preserves the current lower-third overlay. Below begins beneath the actual contain-rendered video rectangle, reserves real available page height, and never chooses Fit/upscales merely to fill the viewport. Input remains visible above the keyboard and camera/HUD anchors remain coherent. Safe scrolling is preferable to clipping on short views. Below uses a passive-keyboard height between 150 and 260 CSS pixels according to remaining viewport space; less space safely scrolls. The single shared scene geometry drives Canvas, DOM hit areas and recording.
- UI-05 preserves mobile OR portrait keyboard-hidden startup and software-keyboard suppression even with a saved Below preference. Passive keys never synthesize input. User may reveal/hide the keyboard explicitly.
- UI-06 records the outer-frame explanation only. Pointer-focus changes are deferred proposals, not implementation or acceptance requirements in this batch. Existing focus indicators and shortcuts remain unchanged.

## Semantic and privacy impact
No training or listening schema change; no inferred input events; no automatic reference text enters the draft, counts or scores. Existing reference-exposure marker and real-action reveal attribution remain authoritative. No new network, frame upload, model download or recording input. Contrast remains continuously linear and region-local with its honest inaccessible-source fallback. Native video size, mute/monitor isolation, recording cleanup and subtitle preview boundaries retain their approved contracts.

## Verification matrix
- i18n: key parity, English default, remembered explicit en/zh-CN selection, switching during active practice without reset, DOM/Canvas label parity, readable permission/storage/error dialogs and unchanged multilingual user data. Inventory phase-one coverage and remaining untranslated surfaces honestly.
- Centering: empty/short/long shown cue; partial word at wrap boundary; real tab/newline paste; moved selection; native caret and Canvas recording correspondence; typing changes do not move the block. Strict hidden state removes reference geometry.
- Feedback: wrong, extra, missing, success and edited-after-check; red plus descriptive labels; review dialog localized and matching panel style; native Enter/check/next unchanged.
- Keyboard placement: 3840×2160 viewport + 1280×720 source in native1×, half and Fit; short landscape; portrait/mobile startup hidden; software-keyboard suppression; resize, fullscreen, hide/show; minimum hit sizes and no pointer offset.
- Safety: existing core/media/HUD regressions with frozen-v65 fixtures, exact build and independent/browser review. Physical mobile OS keyboard, real IME and hardware recording remain explicit deferred checks unless actually exercised.

## Release status
The bounded cloud-desktop release gate passed with the limits below. Publication and public smoke are separately recorded after the native operation and actual public check; this document does not predict their outcome. Release-specific v77/v78 and subtitle-resume records remain preserved byte-for-byte by the publication union.

## Changed verification clauses
- The old square-only check-target assertion becomes an at-least-86×44 CSS-pixel labeled action assertion; non-overlap and the 44-pixel minimum remain enforced.
- Existing localized UI assertions now exercise English by default and/or both dictionaries; scoring/history expectations are unchanged. Handler harnesses provide the translator and select the stable inner StudioContent function after the new non-keyed provider wrapper.
- The bright-frame backing check samples the labeled action's interior rather than its intentionally light outline. Status/settings/keyboard regions retain their original backing probes and opacity requirements.

## Phase-one i18n coverage and open work
Implemented: main Studio/HUD, common settings and warnings, listening controls/history, training history/calendar, submission/review interfaces, accessible labels, remembered explicit en/zh-CN selection, and shared Canvas labels. UI-owned known diagnostic templates translate at the presentation boundary; canonical error values remain unchanged. Unknown diagnostics retain their full detail rather than being replaced by an inaccurate generic success/failure.

Still pending toward the user's all-interface goal: subtitle workbench, correction/context-bookmark authoring tools, free-layout editor/import details, muted-recording-copy tool, NPS transport check, and legacy result-card PNG labels. The first-phase language setting states this boundary. Additional languages are future dictionary additions, not promised as shipped. Learning text, custom titles, answers and archived payloads remain verbatim in every language.

Pre-freeze focused checks passed: 132 geometry/native/renderer checks; localization worker reports 92 host/locale and 182 affected-media checks plus separate review UI regressions. Final exact-source results: 1,871 core/scene tests passed with no skips; 823 media tests passed with one pre-existing optional recorded-MediaRecorder fixture skip; 93 HUD tests passed with no skips. TypeScript and the actual static-export build passed. Independent review of the final reward-placement delta passed 59 checks. The broader source review and final browser coverage are summarized below.

## Browser-found copy consistency correction
The initial v80 browser pass found the course confirmation still promising a hidden reference even though the approved current-cue guide defaults to shown and course/retest transitions retain the current Show/Hide choice. The confirmation and both course/retest success notices now state that choice and assisted exposure accurately in English and Simplified Chinese. No visibility setter, scoring, media, admission or persistence behavior changes. Saved-record preservation, temporary-content export warning, no-autoplay guarantee and actual-submission-only review scheduling remain explicit and regression-tested.

The browser also found the landscape transient gain label sharing the Reference control position. Transient rewards now use the existing width-clamped second status line in both orientations; actual error detail takes priority before any appended reward. The reference control and first-line error count remain separate. This changes text placement only. At very small native half-size scenes, Inside may use the already documented minimum-readable-control safety extension below the picture (about 19 CSS pixels in the inspected 640×360 case); targets are not shrunk to force containment, and Below remains the explicit separate placement mode.


## Actual browser gate and retained limits · 2026-10-11

The initial exact 2ab6ea4 build was exercised for default English, explicit remembered Simplified Chinese, preserved draft/media and restored saved results; centered full-cue guidance and native Tab/newline paste, selection and wrap-crossing input; checked red/wavy differences, edit invalidation and Next; Inside/Below at native, half and Fit, short landscape scrolling, portrait-window keyboard hiding and neutral hidden-reference geometry. This initial pass found two defects. Both were corrected, independently reviewed and rebuilt.

The final 1cccf9c freeze's 341-file manifest and actual requested replacement runtime were verified. All three course/retest notices were triggered in both languages. Landscape and portrait-window confirmation gain stays separate from Reference, error details take priority on the bounded second status line, and subsequent native input/locale/recovery operations passed. This combines the applicable initial matrix with the actual final changed-copy/reward/identity recheck; it does not claim every initial test was rerun on the final binary.

Two QA pages displayed Chromium error 9, with unresolved cause. Normal reload recovered saved results. After closing the extra QA page, about six minutes of final single-active-page operations completed without recurrence. This bounded observation does not establish long-run or multi-tab stability. An optional portrait source-media chooser timed out and was not retried; portrait source import/aspect boundaries remain unverified, separately from the passed portrait-window tests. At half-size Inside, the accepted small-scene safety extension remains as documented above.

Physical phones, OS software keyboard suppression, real platform IME, camera/microphone, recorded MediaRecorder output and physical 4K behavior were not exercised. Production HTTPS NPS transport was not recertified by the localhost browser gate. The earlier media fixture skip remains a skip. Full app-wide translation and user visual acceptance are not claimed. See [release verification](release-verification-v80.md).


## v81 small implementation supplement · 2026-10-11

### Request and bounded visual change
The user’s v80 screenshot shows visible assisted English text without timely per-letter feedback. Keep the accepted composition unchanged. Only the already-entered text gains green/straight matching marks and red/wavy difference marks. Reference ghost text keeps the existing pale style. No new status pill, global layout redesign, cue timing or playback behavior is introduced here.

### Comparison and display contract
1. Reuse the checker’s NFKC normalization, case folding, curly-apostrophe folding and English tokenization. Preserve native grapheme-to-UTF-16 origin ranges, including compatibility expansions. Never compare raw UTF-16 offsets against the reference.
2. Use minimum-edit alignment against a reference prefix, with maximum genuine matching positions as the tie-breaker. Later untyped reference text is not an error. Omissions have no fabricated input span and are confirmed only by the existing explicit Check. Repeated characters, middle insertions/deletions and multiword pastes re-align rather than shifting every subsequent character.
3. Matching normalized punctuation/whitespace separators stay neutral. An erroneous separator is indicated at its real native span; an erroneous newline receives a small wave at that real line end without inserted content. A normalization boundary inside one grapheme belongs to that whole glyph; wrong takes precedence within the glyph. Coalesce adjacent same-color runs only after determining indivisible-glyph status.
4. The exact current checked draft outranks live feedback. Existing submitted word-error ranges and non-color review remain authoritative; an edit removes stale checked feedback and resumes live feedback only if reference visibility permits.
5. Guard live projection with the already-approved visible-reference field. Reference hidden, background, replay, unavailable media/provenance, strict listening or composition must not introduce live correctness. A bounded eight-entry transient projection cache contains no persisted facts. Oversized comparison work is neutral rather than blocking native editing.

### Native editing, accessibility and recording
- The browser textarea retains its exact value, native selection/caret and scroll state. When Canvas paints colored runs, native glyph fill is transparent; the native caret and selection remain enabled.
- DOM visibility and aria-invalid derive from the same projection used by the Canvas. Hidden unsubmitted mode returns to neutral white and false aria-invalid independently of the reference. Hide and composition-start clear native live coloring synchronously.
- All letter marks are painted within the existing clipped input rectangle and measured native baselines, so the recorded Canvas and displayed HUD use identical geometry. No external font, editing widget or decorative input engine is added.

### Truthfulness and regression gates
The projection is pure. It does not submit, expose a new reference, mutate events, create attempts, update earned words or call submission audio. Existing reference-exposure provenance stays attached at the original real edit/submit boundaries. Existing Check and F03 audio tests must continue passing.

Cover: progressive prefixes; wrong letters; mid-sentence insertion/deletion and caret moves; repeated letters; paste; actual extra words; case/full-width text/curly apostrophes; tabs/newlines; combining marks/ligatures and single glyphs expanded to multiple tokens; valid nonoverlapping origin ranges; exact checked precedence/stale clearing; composing neutral; hidden-mode Canvas/DOM/AX; snapshot identity and score/attempt immutability; native geometry and shared recorded painting. Browser acceptance is an additional gate, not implied by these automated checks.

This is the requested first incremental feedback change. The later request for input-following playback speed is independently scoped and requires its own integration and acceptance. Preserve v80 PRDs and their verified release receipt unchanged.


## Companion media repair in this candidate

This release candidate also includes the separately reviewed media-owner race repair: mutually exclusive practice/listening playback ownership, stale asynchronous play rejection, and the pure-listening timeline following the actually playing cue. Original media bytes, embedded audio, source timings, scoring and attempts remain unchanged. The bounded requirements and race matrix are preserved in the [media ownership Total PRD](../media-playback-ownership/PRD-total.md) and [Detailed PRD](../media-playback-ownership/PRD-detailed.md). The later input-following variable-speed feature is not included in this candidate.


## Runtime capacity and acceptance limitation · 2026-10-11

- Feedback-only source lengths are checked before JSON cache keys, grapheme segmentation or normalization: more than 8,192 UTF-16 units on either side returns a shared neutral display. Normalized comparison sides are limited to 4,096 units and their cell product to 4,000,000. Drafts and reference records themselves remain complete.
- Accepted DP uses one bounded traceback matrix and four reused Uint32 rows. The conservative matrix upper bound is 4,008,193 bytes and the row storage upper bound 65,552 bytes, excluding bounded text/range bookkeeping. It does not allocate a new pair of rows for every input character.
- The eight-entry live cache also stores neutral/tokenless/over-cell-budget projections. Hidden/composing and raw-oversized cases stop before normalization. Exact checked coloring has one weakly keyed mapping cache; it cannot keep an old attempt alive. Formal checked feedback and score semantics remain separate and unchanged.
- Recovery regression creates and restores an 8,193-character engine draft, invokes neutral presentation repeatedly, and verifies the entire draft/snapshot remains unchanged. Normal-size Unicode/punctuation feedback was compared against the preceding frozen source in 1,000 deterministic cases without a difference.
- The Canvas transport-cue lookup takes the already-read current-frame listening state. Its omitted-argument path retains the existing fresh getState behavior for user navigation. No other observation reads, history retention, timing, save or statistics semantics change in this adjustment.

A controlled Node benchmark confirmed repeated uncached normalization before the guard fix: 5,000-character restored input against a 1,000-character reference constructed ten Segmenters in ten calls; after the fix it constructs one. Tokenless 2,000-character input changed from 100 to one Segmenter across 100 calls. The 2,000×2,000 accepted DP changed row allocation from about 32 MB across a cold call to about 32 KB. These are synthetic local evidence, not browser latency guarantees or a reproduction of error 9.

The media audit found one retained main RAF chain, fixed-size Canvas sampling caches and media cleanup that clears its interval/listeners/src on disposal. However, original full listening observation snapshots grow with spans and are still recomputed by the existing read paths, including after Let me type. Long-duration performance is an acknowledged unresolved limitation. A prior short-draft cloud-browser crash cannot be attributed to or cleared by these findings, even though a previous release showed a similar error. The final bounded browser gate has now been exercised as recorded below; preserve the earlier failed evidence and do not label the candidate stable from program tests alone.


## Final integrated verification status · 2026-10-11

Exact integrated source `55bf7b7d05efca200127151dd8b9aa3bd5499c97` passed independent source review, 1,900 core/scene checks (zero skips), 823 media checks (one pre-existing optional real MediaRecorder fixture skip), 93 HUD checks (zero skips), TypeScript and the production static-export build. The final capacity/navigation corrections were independently checked with 72 and 19 focused tests; 1,000 deterministic normal-size Unicode comparisons retained the prior feedback ranges. These are software evidence, not proof of browser crash resolution.

The broader a489 functional browser matrix passed live green/red native-letter feedback, middle edits and Tab/newline paste, neutral hidden mode, explicit checked precedence and stale-check removal, no live formal attempts, café listening/navigation, language persistence and responsive layout. After the final 55bf replacement, the exact 388-file manifest and actual requested replacement runtime were verified. Saved Chinese preference and draft recovered. Native correct/incorrect-letter edits recomputed colors; Hide removed reference/answer-derived colors and accessibility validity hints. Listen Next/Previous moved to 6/0 seconds. Continue → Let me type preserved the draft and left playback paused. The final roughly two-minute interaction window showed no additional error 9; it is a focused delta gate, not a complete repeat of the earlier matrix or stress test.

Earlier a489 and old QA pages displayed Chromium error 9 with unresolved cause. Reload recovered saved data; the earlier single-QA-page recovery remained usable for about four minutes. The performance bounds address demonstrated work/allocation paths and do not explain or establish a fix for that crash. Original listening-history snapshot costs still grow with accumulated spans; long-duration stability remains unverified. NPS response-body loading remains limited. Actual audible native-track quality/lip synchronization, genuine device IME/mobile OS, camera/microphone and recorded output were not verified. The user's unspecified original sound/picture symptom is not claimed resolved. Input-following adaptive speed is excluded.

This completes the bounded functional cloud-browser release gate with disclosed limitations, not full-PRD or user visual acceptance. Publication identity and subsequent actual public smoke are recorded separately after those operations. Requirements and earlier released PRDs remain unchanged.

See [integrated release verification](release-verification-v81.md).
