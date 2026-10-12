# v19: readable recording failures

Scope: one presentation fix after the v18 browser review. The recording panel no longer serializes its diagnostic object as JSON. A small allowlisted formatter produces a readable reason and a recovery note based on committed bytes. Unknown object/string errors receive a generic message. Raw messages, stacks, causes and other fields are not rendered. The original recorder failure remains unchanged for internal diagnosis; this patch adds no logging, transmission, diagnostic download or storage changes.

For a quota failure with committed bytes, the notice says storage is insufficient and recording stopped, and directs the user to try downloading the existing fragments from local recordings. It explicitly warns that fragments may not play. With zero or invalid committed bytes it does not promise a preserved download. Error codes supported by the formatter retain their specific useful reason; arbitrary code names and string contents are never echoed.

## Tests

Four new program tests cover quota objects, string codes and DOMException; arbitrary or JSON-looking strings and unknown errors; zero/invalid committed bytes; and malformed diagnostic getters. Existing recording/storage tests continue to verify stop, serialized writes, committed bytes and download behavior. These are program tests, not additional browser or physical-device verification.

## v18 browser acceptance received from the parent

The independent Windows browser review exercised actual encoding and IndexedDB. Capacity thresholds, refresh, missing-API/rejection degradation and approximately ten-second polling passed. Low capacity did not automatically stop recording; two consecutive recordings were saved and downloaded. A controlled write failure preserved 401189 already-committed bytes with the original hash and permitted download. Injected clock advancement past seven days deleted unretained test records and their blocks while retained test records remained.

Capacity failure and clock advancement were injected in an isolated test context. The review did not fill the physical disk, wait seven real days, or use a real camera. It does not establish guaranteed retention, actual device recording, or full browser/device compatibility. The only reported v18 issue was the JSON error notice addressed here; v19 still needs a focused real-browser check of that notice. All earlier visual fidelity limitations and unrelated deferred gaps remain as recorded.
