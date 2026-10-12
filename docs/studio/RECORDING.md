# Canvas composite recording controller

Copy `scene-recorder.ts` and `recording-storage.d.ts` beside the existing, unchanged `recording-storage.js`. The included JS file is a byte-for-byte copy of that adapter for standalone synthetic tests. No Site or UI files are changed by this artifact.

## API

- `new SceneRecorder(config?)`
- `prepare(): Promise<void>` opens/probes IndexedDB, recovers interrupted records, and removes expired unpinned records. It requests no media permissions.
- `subscribe(() => void): () => void` and `getSnapshot()` provide an immutable stable snapshot for `useSyncExternalStore`.
- `start(stream, { audioLabel, source: 'canvas-composite' }): Promise<void>`
- `stop(): Promise<RecordMeta>` resolves after final data, the stop event, pending writes, and metadata finalization. A failed recording resolves with incomplete metadata when a row exists; inspect `complete`, `status`, and snapshot `error`. It rejects only when there is no record to return. Repeated stop returns the last saved result.
- `list(): Promise<RecordMeta[]>`, `blob(id): Promise<Blob>`, `retain(id, boolean): Promise<RecordMeta>`, `remove(id): Promise<boolean>`
- `dispose(): Promise<void>` stops/drains an active recorder, releases tracks, closes the store, and releases the lock.

Snapshot has `state: 'idle' | 'recording' | 'stopping' | 'saved' | 'error'`, `recordingId`, `startedAt`, committed `bytes`, `error: { code, message } | null`, `warning: string | null`, and `audioLabel`. During `start()`'s metadata write, state remains idle; keep the Start action disabled while its promise is pending. `error` state can still have committed, exportable incomplete data. No incomplete file is guaranteed playable.

## Caller responsibilities

1. Prepare once while the page mounts. Show errors and warning text; disable record until preparation succeeds. Dispose the old instance before preparing a replacement so React Strict Mode remounts cannot retain its Web Lock.
2. On an explicit user click, create the Canvas capture stream. Draw the background, lesson cards, camera pixels, drawings, and other intended content on that Canvas. The independent camera stream stays caller-owned; this controller never receives or stops it.
3. Attach only explicitly selected audio. Clone audio tracks that another feature owns before attaching them, or use a caller-owned mixed destination stream; stopping the composite stops every track in it. Label the actual selected audio. A stream with no audio always displays `无音频`.
4. Pass that complete stream to `start()`. After preconditions succeed, ownership transfers even if encoder/storage setup later fails. A call rejected because the controller is unprepared/disposed/already active has not accepted ownership, so caller must release its newly created stream. Avoid mutating the stream's tracks after handing it over.
5. Only after `stop()` settles is the recording ready to list/export. Use returned metadata `extension` for the download filename. `blob()` produces a Blob but performs no download and does not pin. Revoke any object URL the UI creates. `retain()` is a separate user choice.

This records the Canvas composition; it is not browser/window/screen capture. The module contains no `captureStream`, `getDisplayMedia`, `getUserMedia`, camera, audio mixing, or media permission request.

## Storage and limits

- Existing IndexedDB adapter commits each ArrayBuffer chunk and its index metadata atomically; controller writes serially and keeps no full-recording chunk array in memory.
- Default queue bound: 16 MiB of accepted chunk payload, including the current write; default recording/export bound: 512 MiB; default duration: 30 minutes; MediaRecorder timeslice: 1 second. Configuration may lower these limits but cannot raise them. A browser may still deliver a single chunk larger than the queue cap; it is discarded and recording becomes incomplete. Blob/ArrayBuffer conversion has transient memory overhead beyond the payload cap.
- A chunk that would exceed size/queue limits is discarded. Accepted queued chunks drain unless a storage write fails. Quota, encoder, source, backlog, or finalization failures preserve committed bytes as incomplete. A missing stop event times out rather than hanging forever. Browser crashes can leave a recording row for the next `prepare()` to recover.
- Normal recordings expire seven days after stopping. Interrupted/incomplete recordings expire seven days after their last committed chunk (or start if empty). Cleanup runs at startup and when listing; pinned rows survive expiry cleanup. Unpinning does not reset expiry. Cleanup rechecks retention atomically using the adapter's actual `remove(id, { expiredAt })` signature.
- Cleanup cannot run after the page/browser closes. IndexedDB is local to this browser/profile/origin and can be evicted or cleared. Pinning is not permanent durability; download important recordings. No upload, account storage, or background retention guarantee is provided.
- A lifetime Web Lock shares the existing `dbName:capture-controller` lock namespace. Browsers without Web Locks always expose a single-tab warning; the fallback cannot guarantee safety across concurrent tabs.
- `metadataFinalizationFailed` means the returned incomplete metadata could not be committed; reopen/prepare to recover the persisted row before exporting.

## Verification

From this folder with Node 24+: `node --test scene-recorder.test.mjs`. Tests use synthetic streams, tracks, MediaRecorder events, and an in-memory store only. They do not access camera, microphone, screen, browser media permissions, or an actual IndexedDB backend. Actual browser MediaRecorder compatibility and Canvas composition remain the application's integration responsibility.
