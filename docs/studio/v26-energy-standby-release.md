# v26 asymmetric standby energy and optional sound

Base: v25 source 1d220c983d8304bbec0c0094b130383e6c9f3e97. The desktop layout, input and player rectangles are unchanged.

## Motion contract

A pure explicit-clock envelope has charge, fast accelerating attack, critically damped decay and low dwell. An immutable bank of eight slightly different cycles repeats after 23,900 ms; sampling remains bounded even at long uptime. The first cycle charges for 280 ms, attacks for 190 ms, decays for 1,480 ms and dwells for 920 ms. Goal/number, trace, rhythm and player sample the same clock at lags 0/70/130/190 ms. There is no random timer, autonomous media seek, flashing screen or brightness strobe.

The standby trace uses 75 ms display samples to retain its short attack. Its pre-entry trace is an explicitly synthetic repeating-bank history, not old measured training. All readouts remain labeled 待开始 / 尚未统计 and remain excluded from facts, scores, rewards, storage and exports. The first real changed committed input still immediately selects actual metrics; no multiplier is applied to real achievement. Reduced motion is a fixed frame and silences this optional effect.

## Optional sound

The Settings switch is off on every new page. Only its explicit user gesture creates and resumes an independent AudioContext. Two soft normalized sine harmonics follow the same energy for pitch and gain, with 10 ms parameter smoothing to avoid frame-step clicks. Peak digital gain is capped at 0.014; actual speaker loudness depends on device volume. When course audio is playing unmuted, this effect is reduced to 18% of its own current level.

Disable and pagehide release the sound graph; document hiding and inactive/live/replay/fixture/reduced states mute it. Pending enables cannot revive a disabled/disposed graph. Returning from the background can sound only while the previously opted-in switch remains enabled and standby is active. A bfcache pagehide turns the switch off; it requires another user gesture to unlock.

This sound graph connects only to its own speaker destination. It does not enter the Canvas recorder's existing lesson/microphone audio mix. The record panel explains this; an explicitly enabled microphone may still capture physical speaker sound. No microphone, camera or screen permission is requested by this feature.

## Evidence and acceptance

Pure envelope/timeline/presentation/Canvas tests plus fake AudioContext lifecycle tests cover bounded variation, attack/decay contrast, phase lags, reduced motion, no fact/media mutation, default silence, ducking, visibility, cancel/re-enable/dispose races and cleanup errors. The actual renderer generated exact 1672×941 and 1920×1080 phase images and a silent seven-second 1280×720 program clip. These are program evidence, not browser capture or listening validation.

Before final acceptance, the published candidate needs browser confirmation of fresh/reopened standby, visibly sharp attack and slower fall, real-input takeover, optional gesture sound/ducking/background stop, reduced motion, and a short synthetic composite recording. No physical capture or new device matrix is claimed. The v25 saved source/version remains the rollback boundary.
