# Site v24: aligned controls and continuous standby presentation

Baseline is published v23, source `7811adb1adff718ebe58876d354f70b04e6641bb`. This increment changes only the transparent page's bottom alignment, edge treatment and prestart presentation. It does not connect the isolated data2B repository or change media permissions.

## Layout

At the 1672×941 design size, the player and input containers end at y879. Playback, text input and Confirm share a 64px control row centered at y832; the inner row ends at y864 with 15px bottom inset. Placeholder, Confirm label and playback time use actual font metrics to center their glyphs. The same coordinates supply DOM hit areas. Corner strokes are rounded and subdued; the dense cross marks become faint dots. No thick dashboard cards were restored.

## Standby is separate from training

A fresh untouched, scorable round has continuous mint standby motion: a moving gauge arc, gently varying decorative readings, a small synthetic trend and input-style pulses. Its Canvas labels say “待开始” and “待机动效，尚未开始统计”; each synthetic graph/readout also says it is not yet counted. It is not described as a separate demo, a heart rate or an achieved training result.

The first changed typed, pasted or finalized IME text immediately switches the round to amber “训练中” using actual state; no Confirm click is required. Draft versions keep this state after clearing the text, pausing, changing cues or going idle. Correct green and error coral remain fixed, independent of mode accent. Live pauses only decay/freeze actual observations; they never reintroduce virtual values.

The restored-session identity is retained for the entire saved round. Loading an existing record, including an untouched saved record, never receives standby fixtures. Unresolved or failed restoration suppresses fixtures and uses neutral “尚未恢复” wording. Only an explicit new-round reset creates fresh standby eligibility. Unscorable local media and historical replay do not receive synthetic statistics.

`transparent-presentation.ts` is pure and uses only the supplied clock/snapshot. Decorative data is internally marked presentation-only, never passed to TrainingEngine, recording-history storage, rewards or data exports. Reduced motion and prestart pause produce a fixed waiting view. The renderer includes its state labels in the same Canvas that the recorder captures, so a clip containing standby keeps the disclaimer.

## Verification boundary

15 presentation tests and 12 renderer/geometry tests pass, including immutable snapshots and byte-identical JSON/CSV over 1,440 rendered presentation steps per fresh/live state. Independent source/program-render review found no remaining blocker after correcting the failed-restoration wording. Additional probes check state latching, feedback colors, exact reduced-motion frames, recorded Canvas labels, baseline and optical text centers.

Full primary runner: 195 passing results. Media runner: 42 passing results. TypeScript and the static production build pass. Program frames at 1672×941 and 1920×1080 are available, but are not browser screenshots or recordings. Actual public-browser acceptance remains required for this candidate. No physical camera/microphone/screen capture is started by these tests.

Rollback is the existing saved public v23 version `appgprj_6ac5ccefb20481918a883afab8a483b4~appgver_f4b598bfe184819193a5d339ff315f4d`. v22 remains separately preserved. The prior v23 actual-browser checks are not represented as a rerun on v24.
