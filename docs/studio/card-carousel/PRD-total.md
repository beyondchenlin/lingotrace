# Card carousel — Depth Deck + Magnetic Reveal (total)

**Status:** richer catalog shipped (fixed / dictation / kids / cafe fixed-pace / assisted; dual-aspect; presentation only)  
**SoT:** product shell / story surfaces; does not alter Studio training facts.

## Purpose
A premium card browser for lessons / scenes with two signature motions and dual-aspect video cards (portrait + landscape).

## Motions
1. **Depth Deck** — stacked cards with parallax depth, active card lifts; drag/swipe advances with inertia; reduced-motion falls back to cross-fade.
2. **Magnetic Reveal** — next card magnet-snaps into focus with edge glow; content (title, aspect thumb, CTA) reveals after settle.

## Dual-aspect video
- Each card declares `aspect: 'landscape' | 'portrait'`.
- Thumbnails/contain fit without cropping lesson identity art; Studio launch preserves chosen media.

## Catalog kinds (this vertical)
- `fixed-pace` → `/studio/`
- `dictation` → `/studio/?dictation=1` (hides reference for fixed dictation)
- `kids` → `/studio/?edition=kids`
- `cafe` → `/studio/?course=cafe` (verified original cafe video · SHA-bound fixed-pace; adaptive Follow remains NPS-only)
- `assisted` → `/studio/` with reference-visible practice

## Acceptance
1. Both motions respect `prefers-reduced-motion`.
2. Keyboard: Left/Right and focus-visible cards.
3. Opening a card into `/studio/` does not invent materials or change scoring.
4. Portrait phone and desktop landscape both show readable cards (not clipped titles).
5. Cafe cards must open `?course=cafe` Studio fixed-pace; do not claim adaptive Follow or acoustic word timing for cafe.
