# Current-round correction loop

Base: v56 `3c7870c7579968fe7b5b5de80cca4126eeb22c74`. This batch completes the gap between the existing chronological submission chart and choosing a sentence to correct: find latest incorrect submissions by sentence, compare first/latest saved judgments and conditions, return to that sentence's unchanged draft, submit normally, and inspect the updated review.

## Scope and source

PRD v1.4.8 T118 R3 (word-level final matching), T127 R1 (input results/error evidence), P132–133 (samples, compatible conditions, no mastery inference). The existing total trajectory is retained. This is not F13 scheduled review, a new Practice data source, a first-independent-answer metric, or a new completion/reward rule.

`projectRoundReview` consumes the captured live/restored Training v1 snapshot only. Grouping uses cue identity and original attempt array order, not timestamps or modified dates. First/latest percentages, reference, answers, conditions, and error tokens are the existing judgment fields; no alignment is recomputed. Incompatible references/rules/identities are unavailable. Counts describe submitted sentences' latest results, not an achievement ledger: a once-completed sentence with a later erroneous submission is again a correction target without retracting its earned contribution. An unsent edited draft does not replace the latest judged result.

Unsubmitted rows contain only cue ID/index and status, with no reference or draft. The UI never renders unsubmitted text. Newer draft edits do not silently become answers. The first submission is labeled literally, never called independent, unaided, or mastered. The data is only the current in-memory round; OFF content is not persisted by opening the panel. Restoring a partial history does not reconstruct this view.

## Navigation and lifecycle

The panel is the existing review dialog, with one optional correction-only filter. Opening captures the same snapshot as the old chart and freezes the existing modal state. Continue is an explicit button; it checks current panel/round/material/cue/reference/attempt identity, restore status, pause, composition, preview/replay and media kind. A stale target does not navigate. Closing/unmounting leaves no timer or async request; repeat callbacks after close do nothing.

Valid continuation closes the native dialog synchronously (before focusing an input outside its inert modal subtree), without restoring focus to the old toolbar button, then invokes the existing `changeCue` entry point. That path preserves every draft, pauses/seeks course video without autoplay, clears displayed subtitles, focuses the input, cancels a prompt tail, and records only the existing normal cue-change event. It does not submit, replace draft text, create a review task, reset the round or issue sound/reward. An ongoing recording follows the existing cue-navigation behavior; no new recorder or microphone is started. Whole-practice pause remains a separate explicit action.

## Verification

Program tests execute the actual extracted Studio handler against the real TrainingEngine, in addition to projection and actual React render tests. They check per-cue grouping, error→correct→error, first/latest conditions, one original submission, unknown/incompatible data, long arrays, zero speculative scores, hidden reference/unsent draft, HTML escaping, both drafts retained, explicit pause/close/replay/preview/media guards, stale round/attempt targets, and normal follow-on correction without repeat completion credit. Full regression, build and independent review are recorded in the release evidence.

Cloud-browser verification must separately establish the real filter, expand/close, navigate to unchanged draft, correct/submit, reopen showing the updated result, plus unchanged main-canvas appearance. Physical devices/native IME are not implied by program or cloud-browser evidence. No local denied browser URL or rejected volume-upper-limit action is part of this batch.
