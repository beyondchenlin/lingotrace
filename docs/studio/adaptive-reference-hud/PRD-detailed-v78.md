# LingoTrace · Detailed PRD v78

Status: implementation, independent source review, exact aggregate/build verification and bounded preserved-origin cloud-browser recovery acceptance are complete for source bed4ad4dcb7ceb2a502b5634cc436d7e9e491210. Controlled same-site release approved on 2026-10-11; post-publication and physical-device checks are separately scoped. Runtime base badc0086afe7013081655598c11c01557660a6ed, published in v77 release b834152bbb6fa36ab9e5ff15ff3e3f2234c03d67. Preserve all prior PRDs, including the v77 presentation increment. Only the changed clauses below supersede them.

Verification details, source identity and remaining limits: [v78 release verification](release-verification-v78.md). This status update preserves every reviewed requirement below.

## Evidence and explicit changes

| Clause | Prior behavior / evidence | New requirement | Impact and boundary |
| --- | --- | --- | --- |
| ADAPT-01 | Supplied 1406×815 screenshot: white goal/title/trend/flow, input and keyboard disappear over bright NPS grass/sky | Sample each HUD region's local source-video luminance; dark backing opacity is a continuous linear function of luminance. Smooth temporal response is separate from that linear mapping | No fixed light/dark steps or threshold switching. Endpoints only bound legal opacity/readability; no palette or scoring semantics change |
| ADAPT-02 | Source pixels may be blocked or unavailable | Use a readable conservative backing and report fallback honestly in settings. Sample a tiny local scratch surface only; never read back the main recording Canvas | No upload, stored frames, network request, media reload/CORS mutation or microphone/camera permission |
| PANEL-01 | User calls the secondary settings menu low-quality | Unify typography, spacing, field groups, selects, toggles and button rows in a restrained charcoal-glass HUD panel | Keep all current controls, labels, errors, 44px hit areas, native selects, Escape/outside dismissal and focus return |
| TYPE-01 | v77 HUD-03 defaulted to a neutral empty underline; screenshot typing text is too small/narrow | Enlarge the input area and font. Default to the complete current cue in pale reference text; actual input changes the corresponding visible glyph positions | This supersedes v77's empty-only default. Native textarea remains the sole editable value; no reference characters are inserted into its value |
| TYPE-02 | v77 reference was hidden until explicit reveal | Add direct Show/Hide reference control; hidden dictation reveals no expected text, length, masks or target keys | User hide choice persists across cue changes for this page. Full reference remains scrollable, not silently truncated. Already-seen exposure is not erased by hiding |
| FACT-01 | Existing hinted/revealed conditions and real-input observations | Showing the reference is retained in a bounded tab-scoped pending-disclosure marker keyed by exact session/material/version/cue identity, without answer text or typed input. Before the next actual edit or submit, the existing reveal condition is applied once | Painting alone must not start restored practice, earn words, create input events, replay sound, or rewrite historical attempts. The marker is distinct from scored facts and persists only until tab closure/new session or privacy OFF. Privacy OFF removes the marker immediately; already-seen current-page exposure remains in memory. Storage failure withholds preview and classifies uncertain subsequent actions as assisted, with a visible explanation. No schema, history-policy or grading change |
| PARITY-01 | Canvas is the recorded scene; native editor is interactive | Share font, wrapping, glyph positions, selection/scroll and backing geometry between display and recording | Keep current media ownership, native-size/half/Fit/fullscreen, Fixed/Follow anchors and mobile/portrait keyboard behavior |

## Reference-guided typing

- The initial reference is a visual guide, not an answer value. User input is brighter, while untyped reference characters remain pale. This is not an early score or correctness verdict.
- Position correspondence is grapheme-aware. Editing, deletion, paste and composition keep the real textarea string unchanged. Extra actual input remains visible; line wrapping and scrolling retain the full native draft and remaining guide.
- A small assisted/reference label and accessible mode description make the condition understandable. The hide toggle itself has a clear accessible name and at least 44 CSS-pixel target.
- Strict hidden listening takes priority over the page reference preference. Hidden mode also ignores assisted length guides and old separately revealed subtitles, so no answer-derived glyph count survives.
- Full-cue rendering applies only when the current scored material/reference is ready and admission has settled. Unbound local media stays unscored, existing blocked/recovery/review states remain truthful.

## Brightness adaptation

- Region geometry uses the same projected scene rectangles as drawing and DOM. Translate each region into the contained source-picture coordinate system; letterbox-only areas are already dark and are excluded from sampling, using the minimum backing; settings reports that no sampling is needed when all HUD regions are letterboxed. Partial regions use the measured picture intersection weighted by its area, with letterbox area counted as black.
- Current continuous mapping: alpha = 0.30 + 0.48 × mean regional relative luminance; a 600 ms time constant interpolates alpha independently. Reduced motion uses stable 0.78 fallback and performs no sampling.
- At most four tiny reads per second; intermediate frames only interpolate alpha. Source changes discard old samples. Background/pause/reduced-motion behavior must be bounded and avoid animation flicker; reduced-motion may use the documented stable fallback.
- CORS/read failure cannot break scene rendering or recording, trigger source reload, create repeated unbounded reads or imply adaptive measurement succeeded. No sensitive frame data is persisted or transmitted.

## Verification plan

- Pure tests: linear intermediate mapping, temporal convergence/no steps, region separation, rate bounds, source identity resets, unavailable/tainted fallback and privacy boundaries.
- Native/reference tests: empty full cue, grapheme replacement, deletion, mismatch without premature scoring, extra/long/multiline/pasted/composed input, scroll parity, hidden zero-leak, cue identity changes and reveal-condition timing without phantom input.
- Host tests: current admission/readiness, restored preview, actual input and submit, old history immutable, listening-hidden priority, assistance not reset by hide.
- Geometry and rendering: enlarged font/area, portrait/short landscape, 44px controls, unchanged anchor positions, readable bright/dark panels and the same recorded HUD.
- Independent source review, focused tests, exact aggregate/typecheck/build, then sole-owner browser visual and native-editor checks. No screenshot persistence/upload unless separately requested; root owns same-site publication.

Changed legacy test clauses: minimum native font/line height changes from 16/22 to 21/29 CSS px; the hidden editor’s quiet label changes from Listen · Type to Dictation · Show reference. Legacy extracted handlers explicitly provide no painted reference exposure; new exposure tests exercise the real helper and TrainingEngine. All grading/history tests retain their previous expected facts.

Reference continuation uses the real native draft-end geometry. It never rewraps an already-typed partial word to match the expected word: any remaining pale suffix continues from that actual end and wraps into the next line. Strict hidden listening suppresses both mask/reference inputs before viewport sizing and removes the entire editor region from focus/AT; no hidden expected-length scroll extent survives.

Native draft-end measurement is independent of the current selection and includes pasted trailing tabs; pale continuation starts after the actual tab advance. The existing explicit reveal action still marks the reveal condition before displaying it, while automatic preview painting remains passive. Legacy handler fixtures initialize the page preference explicitly rather than weakening their assistance assertions.

Actual white-ramp browser acceptance found that limiting typing backing to the textarea left the existing keyboard/settings/check glyphs and local-media status on bare white. The typing region therefore uses the complete existing input-card bounds, including its action/status row. This changes only sampled/drawn backing coverage, not control positions, hit areas, layout anchors or recording geometry. White-source display/recording regression covers desktop and portrait action/status points.

## Verified record-type compatibility addendum

COMPAT-01 is an independently approved corrective increment, not a visual-design change. Actual QA reported an unreadable history row and recovery blocking. A separate real-repository reproduction established that a valid listening envelope followed by a newer Café Training record was incorrectly read as an unsupported Training schema. The preserved browser row itself remains unattributed until normal recovery confirms the effect.

The Training-only history reader now excludes a listening envelope only after full envelope validation against its actual stored primary key. Listening history remains readable through its existing typed reader. Malformed, unknown or key-mismatched records remain visible errors; no record, permission, scoring fact, active pointer, schema or bootstrap choice policy is rewritten. Pagination and ordering remain truthful even with listening-only pages.

Evidence: the initial mixed-record regression failed on the preceding UI candidate; 12 final targeted regressions and 105 nearby checks pass. Independent review of exact1372bf1 passed100 focused tests plus31 pagination probes. Integrated aggregate/build and ordinary recovery of the preserved QA origin are still required; fresh-origin visual acceptance is not a repair claim. The approved compatibility implementation is documented separately in ../listening-history-partition.md.
