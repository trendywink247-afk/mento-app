"""WCAG AA gate for Mento's tokens. Fails (exit 1) if any text/surface pair is below
4.5:1 (normal text) — the accent set on white AND on the oat ground, the semantic
colours, muted ink, and ink on every tint. Run from the repo root:

    python scripts/contrast_gate.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "apps" / "mobile" / "theme"


def hexes(name: str, text: str) -> dict[str, str]:
    """{key: '#RRGGBB'} for every `key: '#hex'` line inside the named const."""
    block = re.search(rf"export const {name}[\s\S]*?\n}} as const;", text)
    if not block:
        sys.exit(f"const {name} not found")
    return dict(re.findall(r"(\w+): '(#[0-9A-Fa-f]{6})'", block.group(0)))


def lum(h: str) -> float:
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (1, 3, 5))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a: str, b: str) -> float:
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def main() -> int:
    tokens = (ROOT / "tokens.ts").read_text(encoding="utf-8")
    companion = (ROOT / "companion.ts").read_text(encoding="utf-8")
    colors = hexes("colors", tokens)
    white, oat, ink = colors["surface"], colors["bg"], colors["ink"]
    pairs: list[tuple[str, str, str, float]] = []  # (label, fg, bg, min)
    for key in ("ink", "inkMuted", "success", "warning", "danger"):
        pairs.append((f"{key} on white", colors[key], white, 4.5))
        pairs.append((f"{key} on oat", colors[key], oat, 4.5))
    pairs.append(("accentSoft on oat (large text only)", colors["accentSoft"], oat, 3.0))
    for name, block in re.findall(r"(\w+): \{ (accent: '#[^}]*) \}", companion):
        vals = dict(re.findall(r"(\w+): '(#[0-9A-Fa-f]{6})'", block))
        pairs.append((f"{name}: white on accent", vals["onAccent"], vals["accent"], 4.5))
        pairs.append((f"{name}: accent on white", vals["accent"], white, 4.5))
        pairs.append((f"{name}: accent on oat", vals["accent"], oat, 4.5))
        pairs.append((f"{name}: ink on tint", ink, vals["accentTint"], 4.5))
    failed = 0
    for label, fg, bg, minimum in pairs:
        r = ratio(fg, bg)
        ok = r >= minimum
        failed += not ok
        print(f"{'OK  ' if ok else 'FAIL'} {label:38s} {r:5.2f} (min {minimum})")
    print(f"\n{len(pairs) - failed}/{len(pairs)} pairs pass")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
