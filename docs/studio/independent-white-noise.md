# Independent white-noise listening

Scope: PRD148 P152–P153. White noise is default-off, does not depend on typing speed, and is not routed into the recording mix. This is a bounded F03 subfeature, not completion of all sound controls or the three submission-feedback sounds.

## Controls and ownership

The existing settings panel contains an explicit on/off checkbox and independent volume slider. No main training canvas or HUD is added. The audio owner lives with Studio, so closing the settings panel does not stop a deliberately enabled listening session. No preference is persisted: a fresh page starts off.

Only the explicit enable event creates/resumes its own AudioContext. The graph is a looping random-sample AudioBufferSource, its own gain, and that context's speaker destination. It has no media inputs, microphone permission, recorder destination, or reference to the lesson/standby audio contexts. Changing volume does not enable sound. The course mute button keeps its existing course-only meaning.

Visibility loss, pagehide, interrupted audio and disposal stop and disconnect the source and close the context. Returning to the page cannot restart it: another explicit enable is required. Reduced-motion preference disables this optional audio and returning to normal motion does not restart it. Failed activation is shown truthfully instead of silently retrying.

## Recording boundary

The new source is never digitally connected to the recording mix. The original course/microphone recording choices are untouched; there is no white-noise “include in recording” option. Independently enabled microphone capture can physically hear loudspeakers. The settings text states this limitation rather than promising removal of acoustic pickup.

## Verification boundary

Program tests verify waveform properties, volume bounds, graph isolation, delayed resume/toggle races, hidden/foreground behavior and full resource release. UI tests exercise the actual settings view and Studio-owned hook. Those are program evidence, not a listening test.

Cloud-browser verification checks real activation status and settings interactions, background stopping without resume, and a downloaded native Studio recording made with white noise enabled and course/microphone capture disabled. Independent container analysis can prove that recording has no audio track. This does not prove that a physical speaker was audible. The available cloud browser supplies no audio capture/listening channel; physical-device and hardware-acoustic acceptance remain unverified.
