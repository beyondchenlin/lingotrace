# Compact input candidate validation

Baseline: v75 / 380788d951d37e819ea1a7b2fa3cb0edcafc8ca6. Isolated branch: compact-typing-v75.

- TypeScript: passed.
- Full suite: 1,642 core/scene tests passed; media suite 789 passed, one existing skip; zero failures.
- Focused tests execute the actual Studio hint handlers with synthetic boundaries: assistance is recorded before slots appear; typed-only modes create no training events; hiding hints preserves assistance; cue change expires guidance; reference/builtin/fixture/replay/local-preview/pause/composition gates fail closed.
- Canvas tests cover five HELLO underlines, one word underline, empty strict mode with zero slots, grapheme masking, minimum control size, selector/input nonoverlap, shared native multiline geometry, selection and scrolling.
- First-load mobile/coarse pointer or portrait is hidden even when an old desktop preference says visible. Orientation/resize update that default until the visitor explicitly toggles it in the mounted page; manual choice then wins. No visibility/mode action calls focus or writes the textarea.
- Actual Canvas program renders were inspected in desktop and portrait, strict empty, HELLO, letter guidance and word guidance. The render script is reproducible. These are not browser screenshots and do not show DOM-only selectors.
- Real browser editing, OS IME, mobile OS keyboard/selection, camera hardware, and actual MediaRecorder output remain unverified for this new revision. Existing browser task owns the pending browser call and was not touched.

Guided slots now have a genuine shared outer scroll range even when the native draft is empty. One native textarea grows internally to the greater of browser-measured draft extent and masked scaffold extent, while its outer viewport remains compact. The outer offset is captured for Canvas, and real edit/selection events reveal the caret without resetting manual scaffold scrolling. Red-to-green geometry tests cover a 300-unit scaffold in a 60-unit empty editor and the transition back to strict input. Narrow portrait controls stack into separate 44 CSS-pixel rows at .3/.414 scales. Assisted accessibility status announces slot/word counts only after exposure; strict status remains neutral. Actual browser wheel/touch, native selection auto-scroll, IME/undo and potential internal-scroll bounce still need browser verification. No new persistent learning schema or database migration is added. No push/deploy performed.
