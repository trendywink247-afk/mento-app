# The final design board — artboard sources (snapshot 2026-09-19)

The live board is a Claude "Design" canvas: https://claude.ai/artifact/SWQyjqF1e5nBwDuCWZcjyr
These are its artboard files (`*.dc.html`), copied here so the port has an exact, versioned source for
copy, sizes, colours, order and motion. Images are `/_blob/…` URLs that only resolve on the board; the
same art lives in `apps/mobile/assets/`. Mentor Reading 1 is deliberately NOT in this folder (private).

- `A01`–`A39` — every screen, in flow order (see `FINAL_SPEC.md` for the wiring table and the shared arrival choreography).
- `T01`–`T07`, `T90`, `T91` — motion prototypes, the transition system, the companion behaviour (`TRANSITIONS_SPEC.md`, `ROAM_SPEC_V2.md`).
- `X90`, `X91` — press feel.
- `EXPLORE_SPEC.md` — direction A's design system as used on the board. **The app's tokens win** (`theme/tokens.ts`, `theme/motion.ts`): port the design, not the raw hex or the raw milliseconds.
