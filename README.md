# LingoTrace · five sports HUD demo pages

Static, device-local English training prototype based on the selected five visual concepts and the 2026-10-07 PRD (F01–F08). No accounts, cloud upload, AI grading, or payment. This release replaces the v7 media-sidebar presentation.

## Run

Serve `dist` with any static HTTP server. Example: `python -m http.server 4173 --directory dist`. Camera and screen capture require a secure browser context (HTTPS or browser-recognized localhost), and explicit visitor clicks. Five routes contain real index files, so refresh works on ordinary static hosting:

- `/demo/01-fitness-flow/`
- `/demo/02-precision-arena/`
- `/demo/03-pace-runner/`
- `/demo/04-aero-hud/`
- `/demo/05-rhythm-quest/`

`/` opens style 01. In-app style changes retain the same video element, capture controller, draft, and learning session. Each direct page starts with its corresponding original clean café scene. To compare the exact same media frame, switch styles within the app or choose the same local file.

## Structure

- `dist/hud/learning.js`: versioned normalization, word alignment, true incremental rewards, temporary input pace, event and JSON/CSV export model.
- `dist/hud/ui.js`: five style routing, permanent media element, HUD/console, free layout and keyboard alternatives, camera and recording UI.
- `dist/hud/hud.css`: five distinct visual component systems and responsive safe docking.
- `dist/hud/capture-store.js`: explicit camera/screen APIs, MediaRecorder lifecycle, IndexedDB chunks and metadata, seven-day local cleanup and retention.
- `dist/media/hud`: original generated still imagery encoded as narrated image videos. Not real filmed footage. `rights.json` records source.
- Old app/workbench source remains unreferenced for historical traceability. New logic never loads it or regrades its original answers against the new course.

## Data and feedback

The café course has 12 original cues (6 seconds each). Fresh HUD values start at zero. A word position can add to confirmed words once per round; cue completion requires no edit errors. Submission uses word edit distance with deterministic maximum-match tie handling. Submitted text is compared locally, never called AI scoring. Hint, subtitle exposure, paste, first/repeat, exact alignment and source versions accompany results.

Input pace is an activity indicator: +20 per committed typed grapheme, exponential decay with a 3-second time constant. Paste and deletion do not create pace. Listening, pause, composition, checking, closed/hidden page, and review freeze it. Durable achievements never decay. A new round resets only after an explicit confirmation; export first if needed.

Legacy synthetic data stays separately labeled (4 summaries, 13 attempts; 100 words/22 errors/78%; same 25 words 8→3 errors,68→88%). Existing v1 device-local state is included in export without migration or destructive mutation. None enters live HUD counts.

## Media and layout

Local video/image files use object URLs only, revoked on replacement/unload. `object-fit:contain` preserves any aspect ratio. They have no bound reference transcript, so grading is disabled. Default cue video has play, seek, speed, volume, repeat and subtitle controls. Video/HUD can move/scale with handles or keyboard and drawer controls; widths are constrained to safe boundaries. Layout saved by style and viewport; phones use safe docking to keep input/submit visible. Resetting layout does not reset learning or recordings.

## Capture and local storage

No media permission prompt occurs on load. Camera opens only after its explicit button; video only, no microphone. Screen recording is always a visible entry but starts only after a fresh click and browser source choice. Both audio options default off. Actual capture source/audio appears while recording. The capture preview itself is never embedded into the captured surface.

Recordings are written as ordered chunks to IndexedDB, not retained as a whole in memory during recording. Stop waits for final chunks and metadata commit; write/quota/backlog failure stops capture and marks incomplete. Normal recordings must be previewed in a real browser; interrupted chunks are best-effort bytes and may not decode individually or together.

Unretained recordings expire seven days after normal stop, or last commit for interrupted data. Cleanup runs at startup, visibility return and periodic executable checks. Closed pages cannot promise punctual deletion. Browser clearing/eviction/private mode may remove files earlier. Download is a separate explicit action and means “download initiated”; browser retention is a separate pin. Neither guarantees permanent persistence. No automatic deletion of unexpired data for space.

Limits: 30 minutes,512MiB export,16MiB pending write cap; capacity warning below10% or projected2minutes remaining. Configurable in CaptureController. Web Locks protects concurrent recovery on supported browsers; other environments visibly require single-page use.

## Validation and limits

Automated pure learning tests and26 simulated capture/storage tests cover data integrity, normalization, correction/deduplication, tempo freezing, no prompt on initialization, permissions canceled/denied, stream cleanup, chunk ordering, quota failure, interrupted recovery and retention. These do not prove real camera hardware or system screen capture.

Candidate requires actual browser visual/interaction checks against all5 reference images. Real camera/microphone capture and a real screen chooser are not invoked by automated QA without specific device authorization. Mobile getDisplayMedia is generally unavailable; the app reports actual missing capability and suggests system recording. Frame-rate,200% zoom,soft keyboard,hardware audio mixing,real crash recovery and cross-browser results belong in the release test report, with untested items identified.

## v9 targeted browser follow-up

The v8 independent browser pass saw all five distinct HUD scenes and exercised real text submission/state preservation plus synthetic-stream MediaRecorder/IndexedDB/download/retention/expiry/quota flows. Real camera devices and real OS source selection remain untested.

This candidate fixes the four reported layout defects: subtitles follow actual console height; resize/move handles use a stage-level interaction layer; phone media occupies a full separate visible block before subtitle/console; style05 top controls have a solid high-contrast surface and unavailable phone drag handles are hidden. In compact style05, left widgets move upward when a result expands the protected console. Targeted browser recheck is still required.

## v10 PRD 1.1 adaptation candidate

- Actual CSS layout/visual viewport geometry is tracked separately from DPR. A short-landscape dock supports phone rotation; keyboard mode preserves editable nodes and protects the input/submit group. Resize/orientation/visualViewport events share one frame-scheduled layout path. Rotating during a drag cancels that gesture instead of saving into another orientation. Console growth reapplies saved normalized layouts against the current safe bounds without overwriting saved positions.
- Explicit “电视 / 远距模式” in Tools enlarges the five component systems, adds adjustable2/3/5/7% screen safety margins and visible D-pad focus. Input caret/range/select native arrows stay usable; checkbox confirmation and visible file triggers are explicit. Actual TV remote and viewing distance remain untested.
- Original authored samples (about1MiB each) load fully as local Blob playback sources. This provides local seeking using a browser-local source. The v9 observed response lacked Range headers and reported seekable zero, but the original request headers were not retained; server Range rejection is not established. Seek controls enable only when the browser reports a real seekable range; queued positioning is applied only when ready.
- Recording preflight and new chunks use byte-verified ArrayBuffer records for WebKit IndexedDB compatibility, while reading legacy Blob records. Conversion is serialized before each transaction; the bounded pending queue remains. No camera/screen permission or upload is introduced by preparation.
- Current automated checks:48 passing (8 learning,34 capture/storage,6 viewport and keyboard/remote geometry checks). Browser engine, phone/tablet virtual keyboard, physical rotation, real TV/remote, actual camera and OS screen chooser are separate verification categories; this candidate does not claim those devices are all supported or tested.

## v11 targeted compatibility corrections

A reported media error while loading an authored Blob sample now triggers one attempt using that same original same-origin URL. The UI announces compatibility playback; no user-agent switch disables features, and seeking remains governed by real seekable ranges. If both paths fail, it shows the error. Local-file/recording preview failures stay explicit; successful storage/download bytes are distinct from successful decoding, especially in the Windows WebKit test environment.

Short-landscape media height is budgeted from the actual console, subtitle and active recording notice. It retains contain and uses condensed HUD widgets when height is scarce. Quest widgets stack with measured gaps on phone and compact when the tablet console grows; its progress ring remains circular. TV Back first closes the open dialog; the adjustable safety margin now also governs the top toolbar.

These are candidate fixes awaiting targeted browser checks. They do not convert desktop-engine or synthetic capture evidence into physical Safari/phone/TV/device-capture verification.

## v12 final targeted candidate

Quest far-view stacks the two left HUD cards using their rendered height and a20px gap. Its console starts after the configured screen margin, measured left-column width and24px spacing, so changing2/3/5/7% safety margins does not push the cards behind the input panel. This isolated change requires the adjacent-margin browser recheck; all device/recording limitations above remain.
