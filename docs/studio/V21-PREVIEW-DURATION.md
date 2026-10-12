# v21: honest recording duration status

The parent reported that nine silent synthetic VP9/WebM recordings in the actual Windows browser initially exposed duration=Infinity, then finite3.08–3.13second durations after full playback. The code previously displayed only native controls and an error notice, so it gave no explanation of unknown duration. These observations do not establish a specific encoding/muxing cause or initial seek support.

The preview now displays loading, unknown, browser-reported finite duration, or failure states. Metadata/durationchange/ended events only read the media element. A finite nonnegative value, including zero, is reported as the browser's duration. Unknown duration is not called corrupt. If playback ends but duration is still unknown, the notice says so. Neither currentTime nor recording wall time is substituted for total duration.

Native playback controls remain. No automatic play, seek, remuxing or duration metadata injection was added. Switching/closing previews resets state; a URL identity check and keyed video discard old preview events. Error state does not suggest playback is guaranteed. Duration recognition alone does not prove that every seek position is available.

Three program tests cover unknown→known, zero/error/ended, and the actual Studio event handler's stale-URL rejection and lack of automatic playback/seeking. Actual browser playback/seek usability is still a separate check; audio mixing and synchronization remain untested.

Standards consulted: https://html.spec.whatwg.org/multipage/media.html#dom-media-duration and https://html.spec.whatwg.org/multipage/media.html#dom-media-currenttime .
