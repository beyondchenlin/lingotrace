# Existing recording: local muted copy

PRD148 F09, T258 R3–R4 and P262–P264. Entry is inside the existing recording library only.

## User flow

Choose a finalized recording, explicitly consent to removal of **all mixed audio**, generate a temporary copy, play its real preview, then explicitly download it. The picture, burned-in subtitles, faces and typed content remain. This is neither selective voice removal nor de-identification. Download does not change browser retention.

The source recording is read through the existing `SceneRecorder.blob(id)` API. No recording row, training event, score, attempt, history setting or retention policy is written. The temporary copy is not added to the recording store and is not uploaded. The filename is generic. Closing, cancelling, changing source or leaving the foreground discards the temporary preview and invalidates pending work.

## Supported implementation

No external codec, model, service or package is added. A bounded WebM parser removes audio track entries and corresponding audio blocks by replacing them with same-length, zero-filled EBML Void elements. Video compressed payloads, timestamps and byte offsets remain unchanged. The result is reparsed before exposure. This deliberately limited path rejects MP4, unsupported codecs/structures, corrupt and incomplete files rather than relabelling or muting only the player. The input ceiling is 256 MiB.

The browser independently decodes source and output with separate detached, silent video elements. It must provide drawable video frames, matching dimensions and valid finite durations. The output must reach the last retained video timestamp and cannot extend beyond the original duration (with a small browser rounding tolerance). Removing a final audio-only tail can shorten the inferred total duration; both actual browser-reported totals are displayed. Video frames/timestamps are not padded or altered. Streaming WebM initially reporting Infinity gets a bounded EOF seek on these private elements; no playback is started automatically and no lesson playback state is used. If native duration/decoding cannot be confirmed, no download is offered.

The visible preview is the actual output file, with normal controls and no autoplay. A manual play is required before enabling its download. Later playback errors discard the output. Native decode checks supplement byte-level structural preservation; they are not a claim to have viewed every frame of every possible input.

## Lifecycle and verification

The controller owns its AbortController, generation tokens, result Blob and object URL. Every asynchronous boundary is fenced. Generation and download are separate operations; finishing a job can never download. Recording/preparation disables the copy entry. The exporter never takes ownership of the live recorder, microphone, camera, lesson video or mix nodes.

Program tests cover malformed and unsupported containers, audio removal, preserved video payload/timestamps, consent, duplicate actions, stale reads/processing/decode, cancellation, source switching, close/dispose/background cleanup, URL ownership, download errors and native verifier cleanup. Actual cloud-browser and independent media-file checks are recorded separately from these tests. Physical-device, microphone and camera verification are not inferred from cloud tests.

Format references: [EBML RFC 8794](https://www.rfc-editor.org/rfc/rfc8794.html), [Matroska elements](https://www.matroska.org/technical/elements.html), [block structure](https://www.matroska.org/technical/notes.html).
