# LingoTrace · Detailed PRD v77

Status: implemented and independently reviewed. Bounded cloud-browser acceptance is complete for runtime/test source badc0086afe7013081655598c11c01557660a6ed; controlled same-site release approved on 2026-10-11. Physical-device and post-publication browser checks are not claimed. Base: 655cf9b0ba0f30e52852f269eb8dbe455c69a9d0. Earlier compact-typing, listening-bounded and v48/v54 requirements remain retained in their original files. This increment changes presentation only where explicitly listed below.

Release evidence and limits: [v77 release verification](release-verification-v77.md). This status update leaves the reviewed requirements below unchanged.

## Evidence and changed clauses

| ID | Before / evidence | Changed requirement | Impact / boundary |
| --- | --- | --- | --- |
| HUD-01 | Screenshot red box 1: wide bordered listening/history row above the scene | Listening and history are small in-video glyphs, with a dismissible compact overlay for full controls | Remove the above-video layout footprint; keep every existing player/history action |
| HUD-02 | Red box 2: huge Chinese instructional pill | Render no subtitle box when reference text is hidden; optional small “Listen · Type” cue belongs inside the input area | No automatic reference exposure and no fake subtitle |
| HUD-03 | Red box 3: placeholder and Enter/Shift instructions | Default to a single neutral word underline; no large placeholder or routine keyboard instructions; show only relevant assisted/paused/result state | Native textarea and original submit/newline semantics remain; no expected-length encoding |
| HUD-04 | Red box 4: opaque keyboard/select widgets and nearby confirmation tile | Reusable transparent glyph buttons; guidance lives behind a settings glyph; check/next is a quiet glyph without a filled tile | Visible focus and minimum 44 CSS px interaction targets survive |
| HUD-05 | User: mobile OR portrait keyboard hidden; landscape may use lower third | Hide by default for mobile or portrait even after a desktop preference. Keyboard is passive, light and transparent, below typing. Suppress it while software-keyboard occlusion is observed | No second software keyboard, no synthesis of input and no changes to event evidence |
| HUD-06 | User: video defaults to original size, controls independent of HUD | 1× means decoded intrinsic CSS dimensions, clamped to available viewport; 0.5× halves requested size; Fit expands within viewport; Fullscreen invokes the browser API. Media aspect is preserved | Unknown intrinsic dimensions use bounded fallback; image/video loading lifecycle stays unchanged |
| HUD-07 | User: HUD follows video or remains fixed reference size | Keep normalized existing anchors. Follow-video scales components with scene; fixed-reference uses a documented CSS reference size and safety-clamps oversized components. Add small/normal/large size choice | One geometry projection must drive Canvas, DOM and recorded Canvas. No unrelated anchor rearrangement |
| HUD-08 | Existing listening and training evidence contracts | Hidden listening must suppress answer-target keys, reference text, assisted masks and the neutral typing cue (the existing Practice Target goal HUD remains); real error/storage/recording/permission messages remain | No scoring, training history, audio transport ownership, privacy or media-lifecycle edits |

## Interaction and layout

- Default resting view contains transparent goal/trend/flow HUD, compact camera, quiet typing baseline and compact media controls. The absent subtitle is genuinely absent.
- In-video listening/history entry stays discoverable. Expanded controls may use a readable translucent backing, but they are not a permanent toolbar and do not resize the video. Escape and an explicit close action dismiss the overlay without ending playback or changing input.
- Guidance choices preserve typed letters/words and explicitly assisted reference-length letters/words. Strict hidden listening disables or ignores reference guidance. Selecting an assisted choice continues using the existing exposure function.
- The browser textarea is the editable source of truth. DOM text, Canvas recording text and underlines share exact browser line, selection, scroll and composition geometry. CSS must not fake a replacement text editor.
- Check/next retains its native form action, keyboard semantics and accessible name. Pointer and keyboard focus remain distinguishable without a permanent outlined form.
- Desktop keyboard is a passive observed-input visual and can be toggled. Portrait/mobile starts hidden, but the user may explicitly reveal it; observed software-keyboard suppression always takes priority. Entering an observed software-keyboard state temporarily suppresses the passive keyboard without destroying the user's desktop preference.
- Existing goal, flow, trend, title, counter and camera anchor positions remain. The keyboard and typing region are the authorized layout changes. Very small scenes safety-clamp HUD sizing rather than clipping or overlapping controls.
- HUD reference: desktop 960 CSS px wide and portrait 430 CSS px wide at normal size. Default Follow retains the original proportional composition. Fixed-reference compensates for scene scale at those reference sizes; small/normal/large are 0.8/1/1.15. Safety clamps preserve bounded component rectangles and accessible controls.

## Required verification

- Geometry/property tests: input above keyboard, all active hit targets bounded, shared DOM/Canvas rectangles, fixed versus follow scaling, native-size clamp, no intrinsic upscaling at 1×, distinct Fit and Fullscreen.
- Rendering tests: no inactive caption pill; no routine Enter/Shift copy; constant empty underline; strict hidden listening has zero reference text, guide slots, target keys or typing cue; keyboard light alpha treatment.
- Native editor tests: typed letters/words, assisted modes and marking, selection, IME interrupted/repeated flows, paste, long text and scroll, touch focus, submission and next.
- Listening checks: entry/start, pause/play, current-repeat, continuous, speed, repeat count/gap, help, follow text, switch to typing, finish, temporary export, saved-record export and retry/error visibility. Existing pause/cadence changes must remain cherry-pick compatible.
- Responsive browser visual inspection (do not persist/upload screenshots unless separately requested): desktop empty/typing/listening/panels/keyboard, portrait empty/focused, landscape short viewport, each display/HUD mode, plus fullscreen where supported.
- Preserve existing recording, permission, history and scoring tests. Aggregate/build coordinated to avoid concurrent heavy jobs. No publication from this branch.

Presentation sizing detail: decoded video aspect is independent of the Canvas scene aspect. Native/half video is contained and letterboxed without stretching; Fullscreen changes only the available container and preserves the chosen video size. On very short views, a minimum readable control surface may scroll vertically while the actual video remains clamped to the usable width and height, excluding observed software-keyboard occlusion.

Small-scene transport policy: at sub-1× scene scale, the seek rail has its own row and listening/history/play/previous/next/mute share a non-overlapping 44 CSS-pixel control row. The glyphs stay unfilled. Individual cue targets are omitted only when their actual timing gaps cannot accommodate 44-pixel targets; the visible timing marks, previous/next controls and an explicit Sentence selector retain cue navigation.

Independent review correction: shown landscape keyboard occupies 30% of the established scene and sits over the video, with typing above it and a single compact media-control row. Normal landscape sizes keep the original scene height; tiny safety layouts may scroll without using that control tail to shrink the video picture. Focused native typing has a straight subtle baseline and caret, not a rounded form outline.
