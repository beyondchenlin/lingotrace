# v25 page-entry standby and cue timeline

Base: v24 source c0cecd95bf81cba21dd6b7d5afbeac8d4a8ea919. This is a limited update to the existing desktop /studio/; no training database migration or isolated 2B integration.

## Observable behavior

Each mount, restored round, bfcache return, and explicit new round primes a transient PageInputGate. Existing drafts, attempts and earned words are preserved. A new changed committed draft version immediately selects actual warm-amber metrics; typing, final IME text, paste and deletion qualify. IME intermediate text and metadata do not. Clearing, pausing and cue selection do not return to standby after the gate opens. Reduced motion remains static. An old saved manual pause still blocks practice input; it does not suppress the new page's standby animation until the user explicitly pauses this page.

Standby stays mint with “待开始” and “待机动效，尚未统计本次输入”; restored sessions also say their records are preserved. The simulated readouts/trace never enter the engine, history, awards or JSON/CSV. Labels are painted into the same Canvas used for recording. Recovery failure is explicit, blocks new answers and automatic/manual saves of the fallback session, and offers reload recovery. Starting a new round remains an explicit existing action.

The line-only player now spans the input container's width below it, without a background card or fullscreen icon. Fullscreen remains in Settings. Known bound cue timestamps produce twelve original-course markers; unbound/unknown media gets no invented cue markers. Click selects a cue; dragging across a cue target seeks continuously instead of triggering a click. Previous/next buttons select actual adjacent cues. All controls and cue hit targets remain within the 1672×941 design stage and its 1920×1080 projection.

Outside editable/form controls, dialogs, reference/replay and layout editing, Space plays/pauses and Left/Right selects a previous/next cue. IME and modifier shortcuts are left untouched. Holding Space does not toggle repeatedly. Selecting a cue does not score it. A standby-only light travels at most 2.8% of the rail and the play triangle moves at most 2.5px; the renderer never writes media time. Explicit playback, seek or cue interaction permanently selects the real playhead for the page entry.

## Verification

- 22 page-entry/presentation tests, 10 timeline-contract tests, 15 Canvas/geometry tests.
- Full primary runner: 215 passing; media runner: 42 passing. The existing training suite also contains 16 internal assertions. TypeScript and static build pass.
- Independent review identified and closed modifier forwarding, restore-failure manual-save protection, invalid-file duration reset, and cue-target drag interception issues.
- Actual renderer program frames inspected at 1672×941 and 1920×1080. These are not browser screenshots.
- Browser acceptance pending for the published candidate: preserved old draft/results on refresh, first changed input, bfcache, player marker click/drag, safe shortcuts, bottom hit clipping, reduced motion and a synthetic recording containing the state labels. Native IME/real capture and additional devices are not claimed.

## Rollback

The v24 saved version is appgprj_6ac5ccefb20481918a883afab8a483b4~appgver_d5628f9ff118819195d5d12b63b4058b. Its archive and source remain intact. Public access and legacy root/demo routes are preserved.
