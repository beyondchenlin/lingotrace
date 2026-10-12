# Subtitle native-preview recovery · Total PRD

## Purpose
Keep an existing subtitle-boundary preview truthful when the user pauses, seeks and resumes through native media controls.

## Functions
- Retain the existing selected preview bounds during native pause.
- Resume one bounded playback checker when native playback resumes inside those bounds.
- Stop and clear a bounded preview when playback leaves either endpoint or its media becomes unusable.
- Preserve ordinary full-media playback, local-only processing and all saved subtitle/source history.

## Acceptance
1. Preview [1,2], native pause, one consumed animation frame, then native resume at1.3 re-arms exactly one checker.
2. Native resume before start or at/after end cannot continue under an unenforced retained preview; both animation-frame and timeupdate paths enforce the same range.
3. Repeated native events do not duplicate checkers, revive canceled playback, or start sound while hidden or computing.
4. Ordinary full-media playback remains available; ending a bounded preview does not rewrite cue timing, text, draft provenance or source media.
5. Focused production-callback regressions, independent review and exact build pass; actual native-control browser verification is reported separately before publication.

## Verified status · 2026-10-11

Implementation, independent source review, aggregate checks, exact build and bounded cloud-browser native-control acceptance are complete for source `219d6088929ecf6cc885551ad95f873ec5e231e6`. The requirements above are unchanged. Publication identity and subsequent public smoke are recorded separately after the native deployment result. See [release verification](release-verification.md) for scope and limitations.
