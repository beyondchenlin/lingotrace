# v37 isolated HUD style catalogue

Only `/hud-library/` is added: 13 runtime files and the exact frozen manifest (SHA256 `b62a992422c6d90775b747663ee3b336dcf5cbfbf9d796ad93142f2fa10b744b`). All 126 previously published files, including Studio, portrait, story and assets, remain byte-for-byte v36. No Next build is run.

Editable sources are `studio/hud-library/` at existing commit `6b3085f`, preserved by source merge `1dcbf79`. The catalogue exposes seven metric families and ten semantic presentation choices. Main catalogue and groups page use labeled fixed fixtures; the basic page additionally offers a labeled ephemeral page-input harness. None reads the saved Training/Practice databases, writes learning history, connects a production metric registry, or records a camera.

The frozen static directory was reproduced byte-for-byte from source. Its 93 specialized tests, isolated TypeScript check and independent static/code/render review passed. Actual-browser acceptance follows publication and is recorded separately. No new style or data rule was added for this delivery.

The source merge also preserves reviewed development-only history foundation `c5c22bd` as source files. It remains absent from the served production JavaScript. This merge is not a Practice adoption or migration.
