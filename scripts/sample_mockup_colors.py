"""Sample exact colours from the design mockups (docs/Mockups) for token calibration.

Usage:  py scripts/sample_mockup_colors.py
Prints the median colour of small patches at fractional (x, y) coordinates per image,
so token hex values in apps/mobile/theme/tokens.ts trace back to real pixels.
"""

from __future__ import annotations

import statistics
from pathlib import Path

from PIL import Image

MOCKUPS = Path(__file__).resolve().parent.parent / "docs" / "Mockups"
P = "WhatsApp Image 2026-06-08 at "

# (file, label, fx, fy) — fx/fy are fractions of width/height; patch is 9x9 px.
SAMPLES: list[tuple[str, str, float, float]] = [
    # Landing — cream bg, navy CTA, lavender mountains
    (P + "10.31.05 AM (1).jpeg", "landing.bg", 0.50, 0.17),
    (P + "10.31.05 AM (1).jpeg", "landing.cta-navy", 0.50, 0.72),
    (P + "10.31.05 AM (1).jpeg", "landing.headline-ink", 0.30, 0.455),
    (P + "10.31.05 AM (1).jpeg", "landing.accent-lavender-word", 0.52, 0.555),
    (P + "10.31.05 AM (1).jpeg", "landing.mountains", 0.18, 0.875),
    # Age — picker card fill
    (P + "10.31.05 AM (2).jpeg", "age.bg", 0.50, 0.10),
    (P + "10.31.05 AM (2).jpeg", "age.picker-card", 0.50, 0.76),
    (P + "10.31.05 AM (2).jpeg", "age.accent-word", 0.43, 0.368),
    # Email — input border zone / bg
    (P + "10.31.06 AM.jpeg", "email.bg", 0.50, 0.30),
    (P + "10.31.06 AM.jpeg", "email.icon-circle", 0.50, 0.438),
    # Connecting — guideline icon tint
    (P + "10.31.06 AM (1).jpeg", "connecting.bg", 0.50, 0.05),
    (P + "10.31.06 AM (1).jpeg", "connecting.icon-tint", 0.19, 0.51),
    (P + "10.31.06 AM (1).jpeg", "connecting.footer-card", 0.50, 0.895),
    # Companion picker — lavender bg, purple CTA, white card
    (P + "10.31.22 AM (3).jpeg", "companion.bg", 0.50, 0.28),
    (P + "10.31.22 AM (3).jpeg", "companion.cta-purple", 0.50, 0.878),
    (P + "10.31.22 AM (3).jpeg", "companion.card", 0.29, 0.40),
    (P + "10.31.22 AM (3).jpeg", "companion.swatch-purple", 0.10, 0.627),
    # Chat — cream-pink bg, surfaces, tab bar
    (P + "10.31.07 AM.jpeg", "chat.bg", 0.50, 0.45),
    (P + "10.31.07 AM.jpeg", "chat.header-card", 0.50, 0.16),
    (P + "10.31.07 AM.jpeg", "chat.tabbar-active-pill", 0.143, 0.922),
    (P + "10.31.07 AM.jpeg", "chat.received-bubble", 0.40, 0.558),
    # Chat with reply — SENT bubble tint (the key one)
    (P + "10.31.07 AM (1).jpeg", "chat.sent-bubble", 0.68, 0.348),
    (P + "10.31.07 AM (1).jpeg", "chat.sent-text", 0.475, 0.336),
    # Options sheet — sheet surface + icon tints
    (P + "10.31.08 AM (2).jpeg", "sheet.surface", 0.50, 0.36),
    (P + "10.31.08 AM (2).jpeg", "sheet.icon-purple-tint", 0.136, 0.419),
    (P + "10.31.08 AM (2).jpeg", "sheet.icon-orange-tint", 0.136, 0.594),
    (P + "10.31.08 AM (2).jpeg", "sheet.icon-green-tint", 0.136, 0.682),
    (P + "10.31.08 AM (2).jpeg", "sheet.icon-red-tint", 0.136, 0.768),
    # Reflection — lavender bg + purple Finish
    (P + "10.31.12 AM (2).jpeg", "reflection.bg", 0.50, 0.08),
    (P + "10.31.12 AM (2).jpeg", "reflection.finish-purple", 0.50, 0.939),
    (P + "10.31.12 AM (2).jpeg", "reflection.slider-card", 0.50, 0.70),
    # Mentors list — chips, availability dot
    (P + "10.31.08 AM (1).jpeg", "mentors.bg", 0.50, 0.155),
    (P + "10.31.08 AM (1).jpeg", "mentors.filter-pill", 0.17, 0.188),
    # My Chats — serif ink, active filter pill
    (P + "10.31.21 AM (2).jpeg", "chats.active-pill", 0.137, 0.228),
    (P + "10.31.21 AM (2).jpeg", "chats.bg", 0.50, 0.12),
]


def median_patch(img: Image.Image, fx: float, fy: float, r: int = 4) -> tuple[int, int, int]:
    w, h = img.size
    cx, cy = int(w * fx), int(h * fy)
    rs, gs, bs = [], [], []
    for x in range(max(cx - r, 0), min(cx + r + 1, w)):
        for y in range(max(cy - r, 0), min(cy + r + 1, h)):
            px = img.getpixel((x, y))
            rs.append(px[0])
            gs.append(px[1])
            bs.append(px[2])
    return (
        int(statistics.median(rs)),
        int(statistics.median(gs)),
        int(statistics.median(bs)),
    )


def main() -> None:
    cache: dict[str, Image.Image] = {}
    for fname, label, fx, fy in SAMPLES:
        path = MOCKUPS / fname
        if fname not in cache:
            cache[fname] = Image.open(path).convert("RGB")
        r, g, b = median_patch(cache[fname], fx, fy)
        print(f"{label:32s} #{r:02X}{g:02X}{b:02X}   ({fname[-18:]} @ {fx:.2f},{fy:.2f})")


if __name__ == "__main__":
    main()
