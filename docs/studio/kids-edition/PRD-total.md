# Kids / cartoon edition (total)

**Status:** planned after HUD rescue mid-checkpoint  
**SoT:** v1.4.8 + transparent-learning-hud v77 + fixed-pace; kids edition is a **presentation theme pack**, not a second training engine.

## Purpose
Offer a cartoon / softer visual edition that feels friendly for younger learners while preserving the same practice facts, scoring, media ownership, and HUD feedback language (goal / trend / flow remain glanceable).

## In scope
- Theme tokens: palette, plate alpha, type warmth, glyph weight — applied to existing Canvas HUD + DOM chrome.
- Optional softer standby motion (respect `prefers-reduced-motion`).
- Entry switch: Studio setting + remembered local preference; default remains current pro/game HUD.
- Portrait + landscape parity for the same theme.

## Out of scope
- New scoring, separate history store, cloud admin, or different materials contract.
- Replacing training engine / input projector / recording pipeline.

## Acceptance (first vertical)
1. Theme toggle does not remount TrainingEngine or reset draft/media.
2. Goal ring, trend, and flow remain visible and readable in both themes.
3. Desktop landscape anchors match established HUD; only surface styling changes.
4. Reduced-motion freezes decorative cartoon accents the same way as pro HUD.
