# v20: isolate recording input requests

Baseline v19 source: 5b23a8801a3a3094818320ba08abfd9453560f7d. Before editing, an isolated Node harness transpiled the actual Studio helper functions and used the actual SceneRecorder with synthetic MediaStream tracks, encoder and store. It requested no real camera/microphone or screen access.

## Reproduced before the fix

1. Request A waited for a microphone, was canceled, and request B started. A's late result then changed B's video and microphone tracks from live to ended through shared cleanup, while the recorder still said recording.
2. After a prior recording was saved, closing the panel while the next microphone request waited did not cancel it. The late result started recording after the panel closed.
3. After a raw microphone track ended, the mixed audio output stayed live; the recorder continued with an audio label of microphone, no error, and nine already-committed bytes.

## Bounded change

Every explicit start request now owns its own canvas, microphone and mixed destination resources. Canceled late successes release only their own tracks; late failures cannot release or announce changes for a newer request. Closing the panel cancels pending preparation regardless of the prior saved/error state. A request already handed to the recorder stops through the existing drain/finalization path.

The controller additionally observes caller-owned raw microphone input tracks. It checks them before and after the asynchronous metadata write, then listens for ended events during recording. A disconnected raw input triggers the existing interrupted-source path, drains accepted writes, marks the result incomplete and releases the caller's own mix at the terminal transition. Caller-owned camera streams are unaffected. Input observation does not transfer raw-track ownership to the recorder.

This changes no media permission scope, capacity thresholds, retention rules or storage chunk format. Camera/microphone requests remain explicit-click actions; tests use synthetic inputs only. Synthetic lifecycle tests are not a claim that a physical microphone, OS permission chooser or browser-specific encoder has been verified.

The separate scoring fix is documented in V20-ZERO-REFERENCE.md. The v19 final browser acceptance ledger is preserved separately; it is not a claim that these v20 changes already passed browser review.

## Program validation

All 39 media tests pass, including 15 new tests against actual transpiled Studio helper/subscription/download code and request resource ownership. Cases cover late success/rejection, cancellation after saved/error, delayed audio resume, pending metadata creation, leaving the record panel, stale stop notifications, raw mic interruption with preserved queued/committed output, and course-only/silent recording. These execute no real browser permission request.
