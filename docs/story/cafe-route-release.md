# Independent cafe picture-story sample

This adds only `/story/cafe/` to the existing static Site. `/studio/` remains the frozen v27 implementation at source c821b57bdd58bfa1d7aa76eef6dbd1b316241786. No Next build or existing route changes are required.

## Editable source and provenance

`dist/story/cafe/` is the canonical, editable static source for this sample, not a compiled-only artifact. Its HTML, four JavaScript files, original `story.json`, complete runtime JSON/JS, `scene-plan.json`, `media-manifest.json` and `SOURCE.txt` are copied byte-for-byte from the story author's reviewed `static-publish/` delivery. Nine original still assets cover eight stages, including the retained wide/woman matched cut at the counter. The author manifest is preserved at `docs/story/cafe-publish-manifest.json`; source and published media paths are mapped inside the sample.

There are eight stages, 24 original beginner-English dialogue units and eight fixed-answer exercises: entry, approach counter, order, pickup, find seat, drink coffee, read and exit. The package contains authored/AI-generated fictional adult content; it does not claim continuous real filmed movement or exhaustive copyright uniqueness of common beginner phrases.

Only the approved 19 public files are included. No QA movies, source-helper folders, dependency folders, private paths or external API resources are served. `scripts/check-cafe-story.mjs` verifies the allowlist, bytes/hashes, relative script resources, JSON/JS identity, reachable image layers and 136 preserved Studio source/published files.

## Prototype behavior

The first committed input triggers one approximately one-second gentle camera transition. Later characters do not restart it. A correct fixed-answer submission waits for a running transition to finish, then shows its response for 2.4 seconds before advancing once; manual continuation is available. Wrong/blank answers do not advance. Assisted continuation is counted separately from sample matches. The 44-second prearranged demonstration is explicitly labeled and uses its own presentation timing; it is not a user recording.

State is memory-only for this page. Reload or Restart resets this sample. It neither reads nor writes the Studio learning database, browser persistent storage, accounts, AI grading, microphone, camera or generated voice/video services. Future AI story/video/voice generation remains a plan, not an implemented capability.

## Verification and release boundary

The author reports 40 state checks after the one-second input change, camera numeric/source-pixel checks, and independent review. Route/resource checks and preserved-file hashes are separate release gates. Deployment success does not establish actual browser interaction, focus/IME, image decode, viewport fit or accessibility; those require the public-route browser task. This is an independent sample, not a complete production eight-stage learning system.

Rollback is the saved v27 Site version appgprj_6ac5ccefb20481918a883afab8a483b4~appgver_940d539f25008191a4c2d7e7347dfd69. Adding this route does not automatically navigate or add links inside the main Studio page.

## Display-state correction after the first public check

The initial eight-scene browser flow reached8/8 with7 matches and1 assisted completion. Two display-only issues were then corrected in author patch v3.4.2: image requests have per-asset pending/loaded/failed status and an explicit failed-image retry that preserves practice; reduced mode uses static-frame wording without changing timing. Only index.html, app.js, scene-camera.js and SOURCE.txt changed in the public package. Story JSON, images, scoring/advance rules and all Studio files are unchanged. The final public-route check for these two display states remains separate from the earlier full story flow.
