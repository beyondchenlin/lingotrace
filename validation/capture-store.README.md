# LingoTrace capture and local recording module

Standalone browser ES module, with no dependencies and no network calls. It does not operate a camera, screen chooser, microphone, or browser on import or construction. Real capture is requested only by explicitly invoked methods.

## Integration

```js
import { CaptureController } from './capture-store.js';

const capture = new CaptureController();
capture.addEventListener('change', ({ detail }) => renderCaptureStatus(detail));

// Page initialization: storage only. Enable Start only after this resolves.
await capture.prepare();

cameraButton.addEventListener('click', async () => {
  try {
    await capture.openCamera();
    cameraVideo.srcObject = capture.snapshot.cameraStream;
    cameraVideo.muted = true;
    cameraVideo.playsInline = true;
    await cameraVideo.play();
  } catch (error) { showError(capture.snapshot.error?.message || error.message); }
});

// Call directly from the gesture; do not await preparation or another dialog first.
recordButton.addEventListener('click', () => {
  capture.startRecording({
    systemAudio: systemAudioCheckbox.checked,
    microphone: microphoneCheckbox.checked,
  }).catch(error => showError(capture.snapshot.error?.message || error.message));
});

stopButton.addEventListener('click', async () => {
  await capture.stopRecording();
  renderRecordingLibrary(await capture.listRecordings());
});
```

Both audio checkboxes must initially be unchecked. Show the storage, capture-scope, audio, maximum-duration, and export-size explanation before the Start button. The screen chooser must be opened from a new direct click; opening a disclosure dialog and then automatically starting capture later loses that guarantee. Camera preview is a separate video-only stream. Never render the display capture stream back into the captured page; this module intentionally does not expose it in snapshots.

Handle `change` by assigning `cameraVideo.srcObject = detail.cameraStream` when it changes, including `null` after device removal. Use `autoplay`, `muted`, and `playsinline` on the preview. Theme changes should reuse the same controller and stream. `closeCamera()` does not stop the recording, and `stopRecording()` does not close the camera. Await `dispose()` when leaving a live app view. During an unresolved browser chooser, cancellation is logical: any stream granted afterwards is immediately stopped, but the app cannot dismiss the browser's picker on the user's behalf.

Do not claim a finished video exists until `recordingState === 'saved'` or returned metadata has `complete === true`. An incomplete recording can offer an explicitly labeled best-effort export; its chunks may not be playable. A controller's `bytes` counts committed bytes, not bytes still queued.

## Public API

`new CaptureController(config = {}, platform = {})` extends `EventTarget`. The optional second argument injects fake platform APIs for unit tests. Production callers normally use only `config`.

| API | Result / meaning |
| --- | --- |
| `prepare()` | Opens IndexedDB, writes and commits an ArrayBuffer, reads it back and verifies its exact bytes, removes the probe, recovers missing end markers, cleans expired data, and checks estimated space. Does not ask for media permission. |
| `openCamera(deviceId?)` | Requests video-only camera. Releases an existing preview before switching. Returns a stream or `null` if a pending request was canceled. |
| `closeCamera()` | Releases only camera-preview tracks, including pending-request invalidation. |
| `listCameras()` | Enumerates video inputs without requesting permission; unnamed inputs get neutral labels. |
| `startRecording({systemAudio:false,microphone:false})` | Must be called directly from a click after successful `prepare()`. Opens chooser synchronously, then optionally asks for microphone, creates metadata, and starts chunked recording. Resolves initial metadata, or `null` if canceled before starting. |
| `stopRecording()` | Idempotent for the active recording. Resolves after the final `dataavailable`, `stop`, queued commits, and metadata finalization. Returns final metadata or `null`. |
| `listRecordings()` | All local metadata, newest first. Includes incomplete/interrupted/deleting entries so the UI can be honest about them. |
| `getRecordingBlob(id)` | Materializes ordered chunks only on explicit preview/export. Does not pin, download, or delete. Rejects while active, for missing data, or above export limit. |
| `setRetained(id, boolean)` | Changes browser retention only. Unpin preserves the original expiration date; an already-expired recording becomes eligible for cleanup. |
| `deleteRecording(id)` | Deletes using a persistent, retryable `deleting` marker. UI must make the user's delete intent clear. |
| `cleanupExpired()` | Deletes only expired, unpinned, non-recording entries, plus retries already-marked deletions. Rechecks retention atomically before marking. |
| `dispose()` | Releases camera and recording resources, waits for finalization, removes timers/listeners, closes storage, and releases the browser lock. |

`change` event detail and `snapshot` contain:

- `cameraState`: `closed`, `requesting`, `open`, `error`
- `cameraStream`: preview stream or `null`
- `recordingState`: `idle`, `requesting`, `recording`, `stopping`, `saved`, `incomplete`, `error`
- `recordingId`, `startedAt`, `bytes`
- `error`: `null` or `{code, name, message, stage}`; user-facing message is Chinese
- `warning`: Chinese string or `null`
- `audioLabel`: actual supplied tracks, e.g. `无音频`, `含标签页音频`, `含麦克风`
- `captureSource`: browser-reported `browser`, `window`, `monitor`, or `unknown`; `null` before capture
- `prepared`: boolean

Metadata uses `status` values `recording`, `complete`, `incomplete`, `interrupted`, `deleting`; it records MIME, correct file extension, sequence count, committed bytes, start/end/last-commit timestamps, expiration, retention, audio request and actual audio label, source, limits, and reason for stopping. `complete` is set only after durable final metadata commit. If that final commit fails, returned metadata has `metadataFinalizationFailed: true`, while the stored recording marker is recovered on the next startup.

## Download and preview semantics

Use a separate explicit Download button. Get the Blob, generate a temporary object URL, and create an anchor whose `download` filename uses metadata's actual `extension`. Revoke the object URL after the browser has consumed it (not synchronously before the navigation). UI wording is “已发起下载”, because script cannot confirm the file was saved to the user's device. Download must not call `setRetained()` or `deleteRecording()` implicitly.

Preview is also explicit and only after stopping. Revoke its object URL when closing or replacing the preview. Label interrupted/incomplete playback as best effort; do not fabricate a thumbnail or promise each stored chunk is independently playable.

## Defaults and limits

| Configuration | Default |
| --- | --- |
| `dbName` | `lingotrace-recordings-v1` |
| `retentionMs` | 7 × 24 hours |
| `timesliceMs` | 1 second; this is a request, not a fixed chunk-size promise |
| `maxPendingBytes` | 16 MiB |
| `maxDurationMs` | 30 minutes |
| `maxExportBytes` | 512 MiB |
| `lowRemainingRatio` | 0.10 |
| `lowRemainingSeconds` | 120 |
| `estimateIntervalMs` | 10 seconds |
| `cleanupIntervalMs` | 60 seconds, plus startup and visibility recovery |
| `finalizeTimeoutMs` | 10 seconds; missing recorder completion becomes incomplete |
| `videoBitsPerSecond` | 2,500,000 |
| `audioBitsPerSecond` | 128,000 |

Chunk + index writes use one IndexedDB transaction, in serial order. Each queued recorder Blob is converted to an ArrayBuffer before opening that transaction, avoiding WebKit backends that reject Blob/File preparation. Conversion itself is serialized, and the chunk stays counted in `pendingBytes` until its commit finishes. New rows store `{data, encoding: 'arraybuffer', size}`; reads support both those rows and previous `{blob, size}` rows without changing the database schema. Exact payload size, type, sequence, and final reconstructed size are validated.

The recorder never accumulates a whole-session chunk array in app memory. A pending-byte cap limits retained write closures. ArrayBuffer conversion adds at most one extra in-flight chunk-sized application buffer; browser cloning/encoding may add implementation-dependent temporary memory, so `maxPendingBytes` is a queued-data limit, not a total process-memory guarantee. Browser-delivered oversized chunks may temporarily exist before the handler runs; the application immediately rejects those beyond its bound. On conversion, backlog, quota, storage, encoder, or size failure, capture stops, accepted pending writes drain where possible, committed chunks remain, and metadata is incomplete. It never deletes unexpired recordings to make room. The export-size cap also stops recording when a newly delivered chunk would cross the cap; that chunk is not retained and the result is incomplete.

Normal expiration is stop time plus seven days. Incomplete/recovered expiration is last committed time (or start time when no chunks exist) plus seven days. This is an application cleanup rule while the page can execute, not a guarantee of seven-day durability or on-time deletion when closed. Browser eviction, private browsing, clearing site data, origin changes, or power loss can remove data earlier. Browser pinning does not promise permanence; recommend downloading important recordings. The module never asks for persistent storage automatically.

Where Web Locks is supported, one controller owns this recording store until `dispose()` or page closure. Other tabs get a clear `ANOTHER_TAB` error, preventing them from “recovering” an active recording. Without Web Locks, the module displays a single-page-use warning; the host must ensure only one controller/page uses the same database. Cross-tab recovery cannot be guaranteed on those older/unsupported environments. Use one controller for all five themes.

Combined system/tab audio plus microphone uses AudioContext nodes feeding a MediaStreamDestination. Nothing connects to speakers. A missing/denied microphone or unavailable/suspended mixer fails visibly and releases the screen stream so the user can retry with a supported audio choice. This implementation does not guarantee echo-free real-world mixing; device tests remain necessary. An audio checkbox is not evidence of captured audio: only returned live tracks set the label.

## Verification

```sh
node --check hud-module-assets/capture-store.js
node --test hud-module-assets/capture-store.test.mjs
```

Current result: 34 passing targeted tests. The original 26 use fake tracks, capture APIs, recorder, storage adapter, timers, and audio mixer. They cover direct gesture invocation, video-only defaults, pending-permission cancellation, independent camera lifecycle, final-chunk ordering/draining, inactive-but-finalizing recorders, quota/backlog failures, mix topology, actual-audio labels, retention/recovery/deletion markers, size/duration limits, incomplete metadata, unsupported encoders, Web Locks ownership, and disposal. Eight additional tests exercise the production IndexedDB store using a minimal fake transactional database that rejects Blob persistence: exact binary round-trip/probe verification, legacy/mixed records, conversion before transaction creation, conversion failures, corrupt payload rejection, atomic rollback, and controller queue/final-stop behavior during delayed conversion.

Not tested here: actual browser IndexedDB persistence/eviction/quota, real camera/microphone permissions and hardware, chooser behavior, real codec files/playability, audio echo/quality, long recordings, browser background suspension, OS lock, browser crash/power failure, and mobile platform support. These simulated tests are not a real-device acceptance pass. The host should run an authorized desktop recording end-to-end and record browser/version/OS/source/MIME, then test Chrome/Edge, Firefox, and Safari separately as available.
