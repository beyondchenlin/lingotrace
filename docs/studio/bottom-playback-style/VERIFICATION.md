# Unified playback / keyboard-only Below verification

2026-10-11. Source baseline: `1b693e483b44ddcf3a8c746d15cc543ccb076986`. This is source/program-render evidence, not a deployed result.

## Completed
- Inspected all four supplied reference images and the before/after generated program frames.
- Added 35 focused tests: 30 width/media-mode cases, repeated fit convergence, portrait placement independence, 200 saved arrangements, complete upper hidden/Below pixel parity, and source ownership fences.
- Core + scene: **1987 passed, 0 failed, 0 skipped**, including the frozen-v65 compatibility fixture. Command: `LINGOTRACE_FROZEN_V65_DIR=/tmp/lingotrace-frozen-v65-audit node --import tsx --test --test-concurrency=2 studio/core/*.test.ts studio/scene/*.test.ts`; exit 0.
- Media: **897 passed, 0 failed, 1 existing recording-fixture skip** (898 total). Command: `node --experimental-strip-types --test --test-concurrency=2 studio/media/*.test.mjs`; exit 0.
- TypeScript: `tsc --noEmit --incremental false`; exit 0. Whitespace/diff check passed.
- The native style/capture/scroll/input-paint portion of `input-card.ts`, from the Pixel-valued native styles marker onward, is byte-identical to baseline (SHA-256 `af55b213ff5b054492818879f25d41ecfe45c4d617265d5a3fc94295188bc82e`). Native long-draft repair is a separate task and must be jointly checked after integration.
- Runtime scope: 3 existing presentation files only. Existing media assets, native host/handlers, core data, dependencies and lock file are unchanged.

## Program frames
The evidence directory `lingotrace-bottom-playback-evidence` holds before/after frames and `geometry.json`, plus final test logs and primary-frame hashes. The renderer uses an unchanged NPS source frame at 1 second and the actual enlarged text/feedback renderer. Native DOM-only buttons are outside this program-frame method.

- 1280 hidden: Canvas output height changes from 845 to 721 pixels. Logical upper height becomes the original 941, with a 60 CSS-pixel player over the video.
- 1280 Below: input/reference, Check, HUD and player remain in that identical upper surface. Only the keyboard is appended; no window/title strip is drawn or requested.
- 1280 Inside and 390 portrait: preserved presentation, also rendered before/after.
- 640 half Below and 960 hidden: retain minimum text/action dimensions; safety scrolling can extend the shared upper surface. These are documented constrained-size exceptions, not claims that every small picture fits all controls.

Use `node --import tsx scripts/render-bottom-playback.ts OUTPUT_DIR BASELINE_CHECKOUT` after placing the extracted unchanged source frame at `OUTPUT_DIR/nps-source-frame.png`. The script does not launch a browser.

## Test-environment corrections
An initial media pass reused an older shared subtitle-workbench source and failed four unrelated preview tests. The final pass uses exact HEAD workbench text files; asset bytes remain shared, not copied. A concurrent rerun had a subtitle-resources test-process failure without a diagnostic assertion; the cause was not established. The final sequential suites use concurrency 2 and both passed. The initial missing entry HTML and frozen fixture were also supplied before the final run. None of these setup corrections changed product source.

## Still required
Independent review result is delivered separately. No build, deployment, CUA/browser screenshot, live NPS playback, actual recording output, physical IME or OS keyboard test was performed in this task. The final integrated candidate must run the browser checks for keyboard show/hide, Inside/Below, reference visibility, playback/seek and portrait long draft/caret/scroll. Chrome error 9 and reported native/Canvas scroll parity remain separate release gates.
