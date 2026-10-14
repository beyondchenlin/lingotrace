# Mobile one-screen P0 (detailed)

## Trigger
`responsiveLayout` sets `practiceCompact` when portrait height < 940 (phone CSS ≈390×844 → logical ~930).

## Layout
- Slim title strip (~40px)
- Full-width 16:9 media near top
- Input card (2 lines) immediately under media
- Check + thin transport at bottom of the same portrait height
- Charts parked as chips; renderer skips paint when `practiceCompact`

## Keyboard
- `defaultKeyboardVisible(mobile|portrait)` remains false
- `visualViewport` + `learningFocusScroll` keep input/Check reachable when OS keyboard opens
- Sheet tools hide while software keyboard is open

## Acceptance
Without scroll on ~390×844: video, current sentence affordance, typing area, Check, thin transport visible. Charts not dominating. No fake standby percentage ring.
