# Mobile one-screen P0 (detailed)

## Trigger
`responsiveLayout` sets `practiceCompact` when portrait height < 940 (phone CSS ≈390×844 → logical ~930).

## Layout (HUD rescue)
- Media backdrop fills the stage above thin transport (picture contain-fits inside).
- Goal (UL), trend (UR), title (top), flow (LL) keep uniform 0.58 scale as layered chrome over media (v33 anchors + v77 transparent HUD).
- Input card + Check + thin transport pack toward the bottom; optional 2-line input on short phones.
- Charts are never omitted from `hudPanelContentRects` or the transparent renderer.

## Keyboard
- `defaultKeyboardVisible(mobile|portrait)` remains false
- `visualViewport` + `learningFocusScroll` keep input/Check reachable when OS keyboard opens
- Sheet tools hide while software keyboard is open

## Acceptance
Without gutting HUD on ~390×844: goal ring, trend, flow, typing, Check, thin transport visible and readable. Desktop landscape matches pre-P0 anchors. No chip-sized stand-ins for charts.
