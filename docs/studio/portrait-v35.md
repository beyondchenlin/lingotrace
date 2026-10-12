# v35 notice threshold correction

Bounded follow-on to v34. Actual browser resizing from500×550 to500×757 showed a conditional compact-space notice could keep itself visible because its own row reduced the scale below the threshold. The decision now uses space before the notice; fitting reserves the measured row only after that decision. Same-height fresh load and resize return must agree. No geometry, render, data, storage, media or original public Studio/story changes.

The new fixed regression checks repeated short→normal returns and fresh-normal equality; orientation remains independent of the notice. Final browser readback is recorded separately from program validation.
