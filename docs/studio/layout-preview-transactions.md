# Manual layout preview, apply, cancel and undo

Base: v57 `330205c4ae35f05949cd9e4a938019ec48a158d5`. PRD v1.4.8 P175–176/P198 and T182 R5 require validated preview distinct from application, a way back to the prior configuration, and no retroactive rewriting of encoded video. This batch implements that complete transaction for the existing manual geometry editor and three existing stage composition modes. It does not claim the entire F04 JSON/style/locks/AI system is finished.

## User journey

Open the existing Layout panel to try its existing modes, preview the default layout, or enter the existing drag/keyboard geometry editor. These changes are a page-memory candidate. Explicit Apply accepts the candidate, saves the existing orientation-specific geometry preference, and returns to training. Cancel/close restores the captured original. In the geometry editor Escape rolls back a live drag first; a subsequent Escape cancels the entire preview. Pointer cancellation rolls back that gesture. Lost pointer capture ends the gesture and keeps its partial position as an uncommitted preview, as before; it never implies saved application.

The last effective application on each orientation has one page-memory undo snapshot. Undo checks that the current applied configuration still equals that application's result, restores the prior geometry/mode, and writes that prior geometry through the existing preference path. It does not remove a prior user preference, guess from timestamps, or roll back training data. No-op Apply does not erase a useful undo. Canceling a preview does not erase the prior undo. A refresh discards the uncommitted draft and undo memory; the existing last saved geometry remains the only persisted preference. The three course/camera composition modes remain page state, as before; no new mode persistence or migration was introduced.

## Isolation and recording

`LayoutTransactions` is in-memory only. It uses `parseResponsiveArrangement` for the same existing landscape/portrait bounds. Canvas and the existing native hit geometry both consume the preview, so what is edited is what is shown. This changes no default rectangles, main training page artwork, metrics, attempts, scores, media assets, privacy permissions, or saved-record schemas.

Because the recorder captures the same canvas, previews are mutually exclusive with recording preparation, active encoding, and finalization. Entering preview checks the live recording controller and owned input resource, not just React state. Starting recording or opening its panel during a preview refuses with an explicit Apply/Cancel instruction and preserves the draft. It does not secretly apply it, drop it, or stop a running recording. A live recording-state change during a drag cancels the preview and restores the original. Only applied geometry can be recorded. Existing encoded files are never rewritten by Cancel/Undo.

Direction changes restore the old orientation's captured applied value before caching it, then load the other orientation's existing preference. Portrait usable-height changes invalidate the candidate. Apply synchronously checks current direction/height as well, closing the window before the later React cancellation effect. Hidden/pagehide cancel the draft; foreground does not reapply it. UI focus returns after editing/inert state is removed, and stage keyboard media shortcuts stay blocked while editing.

## Verification boundaries

Tests cover original preference preservation, cancel/no-op apply/undo, separate orientations, bounded geometry, changed configuration conflicts, synchronous portrait-height and direction interleaving, recording preparation/owned resources/active/stopping guards, reverse start-record guard before capture/audio/permissions, late drag callbacks, save failure visibility, and unchanged draft/attempt/reward facts. The independent reviewer also executes the actual editor gesture handlers, not a rewritten approximation. Full regression uses the real pre-existing WebM fixture.

Cloud browser evidence is recorded separately for actual cancellation, Escape, Apply/Undo, native input focus, persisted geometry after reload, recording mutual exclusion, and real downloaded composition. Program evidence does not establish physical phone rotation, native IME, camera/microphone capture, or browser background events when the automation environment cannot produce them. No denied localhost or prior rejected volume action is retried.
