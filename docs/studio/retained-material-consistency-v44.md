# Retained material consistency — v44

Base: v43 `24e5bc1887138d8499020c203d3f7043f4048c95`.

The existing complete Training v1 restore path accepts the material embedded in a valid saved snapshot. Current review nevertheless used a fixed denominator of 12 and searched the current Cafe catalogue for sentence ordering. Successful Next also wrapped using that catalogue's length, while changeCue correctly rejected indexes outside the retained material. The media chooser rendered the same fixed catalogue rather than the engine's retained references.

This compatibility bug was reproduced with real TrainingEngine snapshots and the actual shipped JSX/callbacks: a two-cue retained material gave the wrong denominator and numbering, a 12-button chooser, and a rejected final-to-first Next. The normal published Cafe producer still creates its original 12-cue material. There is no evidence that ordinary current users have encountered differing-material records; the reproduction is a supported saved-snapshot boundary test.

The bounded correction reads review denominator and numbering from reviewSnapshot.material, and reads chooser title/count/IDs plus successful-Next wrapping from the current engine snapshot. It changes no attempt, score, clock, input, earned credit, persistence, recording, privacy controls or export. Navigation only selects an existing cue; it neither submits nor awards. The 24-word stage goal is a distinct existing practice target and is untouched. No new curriculum or layout is introduced.

The stock demo video remains the original Cafe media. Training v1 material does not carry generic media identity; this patch must not be described as support for arbitrary restored courses or automatic media rebinding. Local video/image choice remains preview-only under existing rules.

Tests execute the actual source JSX and submit/changeCue functions with real engines, including one/two/12 cues and a versioned reordered Cafe snapshot saved/read using isolated fake IndexedDB. Before/after failing-case evidence is retained outside the product. The complete saved-history HUD and original exports retain their own source boundary. Public browser checks cover the existing 12-cue workflow; synthetic restored-material tests are not browser-injected user data or physical-device tests.

Rollback is v43; retain the v42 connection-version writer protection and existing record controls.
