# Mobile width, native phrase window, and explicit sentence Follow

Date: 2026-10-11. Incremental requirements on published v84 release `8c5a465ad70734c440c9dea70e05b8e3f75956c5` (runtime `6d59a33def4c339bcf64a5663776f104f96b9f11`). All earlier requirements and delivery records remain retained. This appendix supersedes only the earlier whole-stage portrait fitting, continuously scrolling portrait input presentation, and unintegrated Follow availability described below.

## User issue and direct evidence

The new phone screenshot shows black side margins around the entire learning stage and an oversized, clipped long reference sentence with an input scrollbar. It also shows an actual NPS video frame and `00:01 / 00:43`, with no Loading state or renderer interruption dialog. It does not establish the previously observed NPS response-body failure as the cause of this playback complaint. The user wants full-width mobile learning, readable short text sections, and the corresponding original video and audio to follow typing speed.

The published v84 fixed native mirror/Range cache integrity. It did not deliver a typing-to-media Follow controller. Ordinary committed input only notified the existing listening observer; the earlier QA Follow implementation was not integrated in the published Studio. That missing functionality is now explicitly addressed.

## Required behavior

1. Portrait learning uses the available screen width. Extra stage height is accommodated by page flow rather than scaling the whole learning interface down. Video remains independently contained at its original aspect ratio and existing size preference; there is no new cropping.
2. The portrait editor displays two or three complete native word-wrapped lines, with a bounded one-line fallback only if actual available input height requires it. The window advances by whole native lines with the active caret and returns on selection or backspace. No horizontal/manual input scrolling is required. Necessary vertical page scrolling remains allowed.
3. Complete cue text and textarea value remain unchanged. The window is presentation only: one original sentence, one existing submission, and the existing attempt/scoring/history truth. No phrase completion earns sentence credit. Hidden/listening/replay protections remain in force.
4. A compact, localized Start Follow control sits beside typing, outside its line slots. It requires a genuine user gesture and a verified, registered NPS source already admitted for the current session/cue. The same video element supplies the original moving picture and audio track. No cue-sound substitute is used.
5. Follow estimates sentence-level speed from actual committed input, smoothly changing the native playback rate from 0.5× to 1.5×. It does not seek per letter/word, infer speed from correctness, or manufacture word timestamps. After 1.5 seconds without input it slows toward 0.5× and continues to the registered subtitle sentence boundary, then stops without advancing the next sentence.
6. Explicit pause/cancel, Hidden, blur/background, source/cue changes, recording, modal workflows, unsafe native events, or invalid ownership stop Follow immediately. IME preedit pauses; only an eligible committed final input can resume that active composition wait. Restore never autoplays.
7. Verified built-in native play and existing audio-route resume begin synchronously within the explicit gesture. Async completion remains owned, and the interface does not announce Follow success until both complete. Late completion or rejection may not silence a newer media owner.
8. Software-keyboard focus favors the input and Check/Next, including nearby Follow and ordinary transport when the viewport fits them. HUD decoration must not force shrinking the input.

## Acceptance and limits

Program verification must cover full-width portrait/keyboard geometry, complete native line slots and cursor alignment, Unicode/IME/selection, Hidden noninterference, input/history/export neutrality, media admission and late-owner safety, input-speed policy, sentence-boundary stop, and bounded startup/buffering. Earlier mirror recovery, recording, subtitle, persistence, and media identity tests remain required.

The registered NPS boundaries originate from official subtitles; they are not independently acoustically aligned word or syllable timestamps. Exact word-level following remains unimplemented. Pure and actual-handler tests do not establish Android sound output, autoplay policy success, or real browser playback. Build, actual-browser audio/video, and Android acceptance must be reported separately; no unpublished candidate may be described as already fixed on the user's phone. The earlier NPS response-body failure and cloud Chromium error 9 remain separate unresolved observations unless new evidence establishes their cause.
