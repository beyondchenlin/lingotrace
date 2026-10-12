# 06 visual baseline and current verification limits

Reference:1672×941 original06-training-studio.png. Primary component positions follow that coordinate system;1920×1080 uses one scale for Canvas and matching DOM hit regions. Fonts, spacing, caption width, input bounds, enter icon, HUD separators and playback geometry are checked against the reference. This is not a claim that all generated artwork pixels are mathematically identical.

The reference photograph is reused only in rectangular regions outside every original UI mask. The top header,camera inset,subtitle,input console and lower HUD/player are excluded from those photo patches; a test verifies zero intersection. Imagegen-cleaned background fills excluded regions. All visible HUD,text,input values,progress and playback controls are rendered afresh. The reference camera photo is used only inside the explicitly marked comparison fixture; normal startup does not show a fictional active camera or recorder.

Normal operation starts at0 and uses real data. Reference fixture has68/24/4 and illustrative positions and is clearly marked, read-only and blocked from recording; no fixture score is added to the event log. Main product tools are opened from the top-left title so they do not alter the default reference composition. Recording always exposes a real Stop control.

Programmatic frames at1672×941 and1920×1080 are produced by scripts/render-scene.ts using the same Canvas renderer. They verify paint geometry and allow direct pixel inspection; they do not verify browser font rendering, DOM hit alignment, native input/IME, IndexedDB refresh, media decoding or final encoded video playback. Those need a real browser. Current cloud Chromium launch is blocked by socket EPERM and a newly requested official browser download failed; no bypass was attempted.

Required next acceptance: real browser same-size reference fixture and fresh-state screenshots; real typing/correction/IME/paste; long input scrolling; playback/seek; layout switching; blur/read-only timing; keyboard dialog focus; a short Canvas composite recording using authorized synthetic sources; storage/reload/export parity. Actual camera/microphone devices remain a separate explicit test.

## v14 progress and remaining differences

The large numbers now use upright bold type, glass tones/transparency are closer to the warm reference, and player tracks/icons were adjusted. Reference camera REC backing uses a clean photo-strip extension with newly drawn metadata. These remain program-render comparisons: exact font glyphs, small label tracking, blur/material texture and vector icon geometry still differ from the generated source. The conspicuous reference-fixture annotation is an intentional truthful addition.

Free desktop layout and the actual pace/gap chart are now implemented and have focused pure tests. Two static-review findings were fixed: moving a valid media rectangle no longer resizes it before drag, and editor focus is scheduled after the native modal closes. Actual pointer hit geometry, native focus/keyboard behavior and browser encoded-media output still need browser evidence. A custom-layout program frame is included, not presented as a browser screenshot.
