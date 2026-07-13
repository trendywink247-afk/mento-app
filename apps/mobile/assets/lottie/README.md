# Themed Lottie assets (all free — Lottie Simple License, LottieFiles free tier)

Every file is remapped into Mento tokens by `scripts/theme_lottie.py` (repo root):
`python scripts/theme_lottie.py <in.lottie|json> <out.json>` — handles static
fills/strokes, animated keyframes, gradient stops, and embeds zip raster assets.

| File | Source (LottieFiles) | Used at |
|---|---|---|
| study-discussion.json | "Study discussion" | Landing hero |
| chat-loading.json | "Loading Chat" by bt comp | Chats empty state |
| notebook-writing.json | "Paper notebook writing" | Journals hub AI card |
| piggy-bank.json | "Piggy Bank" by Chris | Finance journal empty state |
| breathing-calm.json | "Calm" by Nick | registered (LOTTIE_TILES.breathing), unwired |

Rejected in visual review: coffee-cup (white outline invisible on cream),
no-data (raster-based, unthemable).

Rules: web needs `webStyle` (see LottieTile); reduced motion must render the
still SceneTile fallback; never let a DotLottie canvas live through route
teardown (see landing `leaving`).
