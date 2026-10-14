# Card carousel — Depth Deck + Magnetic Reveal (total)

**Status:** richer catalog shipped (fixed / dictation / kids / cafe-preview / assisted; dual-aspect; presentation only)  
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
- `cafe-preview` → cafe poster/video art only; CTA still opens verified NPS Studio (cafe is not a Studio fixed-pace material yet)
- `assisted` → `/studio/` with reference-visible practice

## Acceptance
1. Both motions respect `prefers-reduced-motion`.
2. Keyboard: Left/Right and focus-visible cards.
3. Opening a card into `/studio/` does not invent materials or change scoring.
4. Portrait phone and desktop landscape both show readable cards (not clipped titles).
5. Cafe preview copy must not claim Studio cafe fixed-pace training.
