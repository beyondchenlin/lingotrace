# 练见 LingoTrace — interactive front-end prototype

A standalone, dependency-free, static demonstration. Working name only.

## Run
Serve `dist/` with any static web server, or open `dist/index.html`. Navigation uses hash routes.

## Implemented
- Dashboard, training room, session recap, growth/medals, data workspace
- Four original English sentences with optional browser speech synthesis, sentence loop, speed, hints and answer reveal
- Deterministic word-edit-distance feedback, input drafts and per-attempt context
- Simulated shadowing recording states (no microphone capture or assessment)
- Preset 30-minute recap plus separate real local interactive-attempt recap
- Transparent evidence/metric dialogs, growth/medal rules and local practice plan
- Real JSON/CSV exports, canvas PNG share-card download, copyable demo URL
- Clearly prewritten AI analysis UI with no model/network calls
- LocalStorage persistence, deliberate reset, paused timing on navigation/reload/background

## Boundaries
All preset achievements, curves and medals are synthetic examples, never user achievements. Local input is tagged separately. No backend, account, authentication, payment, cloud synchronization, real audio capture, professional pronunciation assessment, external AI call or automatic social sharing. Browser speech synthesis depends on installed/browser voices and only speaks the original sample text. Time is visible session time, not measured attention. CSV contains tabular summaries; JSON contains the complete implemented prototype facts and limitations, not a production event-sourcing schema.

## Data and privacy
No external dependencies, analytics, fonts, imagery, trackers or APIs. Local data is scoped to this browser. User-input rendering is HTML-escaped; spreadsheet-sensitive leading characters are escaped in CSV. Original sample sentences were authored for the prototype. Download files include explicit synthetic/local dataset tags and metric definition.

## Routes
`#home`, `#train`, `#review`, `#growth`, `#data`

## Visual-style demonstration (v5 candidate)

Two independent layouts share the same training state and fixtures: Command (modular graphite dashboard, target rings and baseline telemetry) and Orbit (spatial milestone map, soft atmosphere, centered training). The display preference is saved separately from learning data; switching does not reset the active route, drafts, hints, scores or plan. The share-card dialog produces two corresponding 1080×1350 PNG designs with identical evidence. Theme gallery and premium labels are only a visual-entitlement concept, with no real purchase, subscription or account. The children's direction is explicitly unavailable. Base sharing and JSON/CSV exports are never gated.
