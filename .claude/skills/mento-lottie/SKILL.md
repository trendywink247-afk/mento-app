---
name: mento-lottie
description: Use when adding, sourcing, theming, or wiring Lottie or other animated art assets into the Mento app.
---

# Mento Lottie intake pipeline

Every animated asset goes through the same five gates. No exceptions — license and reduced-motion are T&S-adjacent.

## Steps

1. **Source + license.** Free/licensed only (LottieFiles free tier / Lottie Simple License). Record source URL + license in the table in `apps/mobile/assets/lottie/README.md` **before** wiring. LottieFiles pages are bot-blocked: fetch the per-page asset URL from the rendered DOM via headless browser; the shared hero asset on the page is a decoy.
2. **Re-theme.** `python scripts/theme_lottie.py <in.lottie|json> <out.json>` — remaps all fills/strokes/gradients onto Mento tokens by HSL role and inlines `.lottie` rasters. Output goes to `apps/mobile/assets/lottie/`.
3. **Contact-sheet review.** Render the themed asset on the warm-cream bg and *look at it*. Rejection precedent: outlines that vanish on cream; raster-based (unthemable) files.
4. **Wire.** Reusable tiles: register in `LOTTIE_TILES` (`components/art/LottieTile.tsx`). Bespoke placements: `LottieView` directly. Web gotchas (both mandatory): set `style` **and** `webStyle` (web ignores `style`); guard unmount with a `leaving` state or DotLottie crashes with "ImageData width 0" on route teardown — pattern in `app/index.tsx`.
5. **Reduced motion.** Every Lottie needs a static fallback (`LottieTile` → `SceneTile`; bespoke → a coded still scene). No looping art under reduce.

## Prove

Screenshot the placement at 390×844 with 0 page errors + `npx tsc --noEmit` clean (full gate: **mento-verify**).

## Known limits

- The baked palette is static — Lottie art does **not** follow the companion accent (accepted trade-off, documented in CLAUDE.md).
- No audio, ever. An asset with an embedded soundtrack concept doesn't belong here.

Output: asset filename, README license row added, where it's wired, and the proof results.
