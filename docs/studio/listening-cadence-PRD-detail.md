# Listening cadence visual completion: detail PRD addendum

Candidate based on source `655cf9b0ba0f30e52852f269eb8dbe455c69a9d0`. This accompanies [the total PRD addendum](listening-cadence-PRD-overview.md); it does not replace or change the delivery status of older PRDs.

## Separate presentation contract

1. A dedicated in-memory cadence projector has no Training engine, repository, history writer, input-event or attempt APIs. It receives only native media time/rate, monotonic display time, a native-player boundary token, lifecycle flags, and the existing estimated sentence-reference frame. Its frame is explicitly `estimated`, `sentence-reference`, and `ephemeral`. It is never part of any observation snapshot, stored record or export.
2. The value is reference grapheme count / sentence duration × native playback rate. This is uniform sentence interpolation, not detected speech, physical keystrokes, per-word timing, attention or understanding. A line may be flat within a sentence. It becomes visible only after reference text is actually present, so it cannot reveal reference-derived information before the existing reference presentation boundary.
3. Produce points only from successive foreground, shown-reference, active-listen, unblocked, non-waiting, non-seeking, playing native media samples with consistent forward progression. Sample at most every 200 ms; reject intervals over 1500 ms and progression differences over 0.12 media seconds. These conservative visual guard parameters do not change the existing listening-observed-v1 protocol. Retain at most a 30-second / bounded-point display window.
4. Pause, buffering/stall, seek, rate change, repeat restart, visibility change, mode/source transition, invalid media progress and cue change clear the trace before admitting a new pair. A hidden page or hidden reference returns no points, no rate, and a fixed scale independent of target contents. Returning to foreground/show-reference cannot replay a hidden tail. Old data must not reappear after an unobserved interval.
5. Reduced motion gives a static label in the existing panel without a moving trace. The DOM supplies an aria-live="off" description of estimated sentence-level following, no score contribution, and unchanged real listening-time observation. It does not announce each grapheme or sample. Hidden mode describes only the hidden state, with no target-derived number or cue identity.

## Host and renderer integration

- `ListeningPlayer.getState()` may reconstruct/update only the ephemeral visual projector. Existing observation sampling and all exported observation bytes remain unchanged. Its native lifecycle boundary token prevents bridges even when a seek lands near an apparently continuous time.
- `SceneVisual.listeningDisplay` carries the cadence frame alongside the existing text/key frame. No data flows into `TransparentInputProjector`, `TrainingEngine.input`, submit, rewards, attempts, CPM, accuracy, real input points/pulses or persistence.
- Active listening selects a non-standby presentation locally at render time. It never changes PageInputGate. Real goals and real input-flow values remain genuine; the existing fixed trend-panel geometry and all HUD anchors are preserved. Outside actual listening the prior standby remains unchanged.
- Hidden reference defensively suppresses cadence at both player and renderer boundaries, and suppresses any previously enabled Training subtitle. A renderer given different hidden reference text, keys or cadence payloads must paint identical target-dependent pixels. The chart uses no numeric derived scale when hidden, paused, missing, or reduced-motion.
- Type mode removes listeningDisplay and restores the previous real-input trend. Event replay continues to discard any live listeningDisplay. Recording still exits B before capture; this addendum does not authorize simultaneous B listening and recording.

## Tests required before implementation

- Projector rates 0.5 / 0.8 / 1, no first-sample fabrication, monotonic admitted native progress, bounded retention.
- No progress / jump / negative clock / long gap / boundary / cue / rate changes; paused, waiting, seeking, host-blocked, hidden, reference-off, mode-off, and reduced-motion states; fresh pair required after re-entry.
- Native-player integration proving actual listening spans/totals stay unchanged, including replay coverage union; shown/hidden reference cannot change observations, and exported observation has no cadence fields.
- Renderer pixels/labels: estimated listening panel only, genuine zero goal/input-flow before typing, hidden-payload noninterference, no cadence in replay, original typing render returns byte-for-byte.
- Non-live DOM explanation and actual host wiring, unchanged layout files and recording start boundary. Typecheck, focused and aggregate regressions, independent review of exact final source. Browser acceptance remains separate and unpublished.
