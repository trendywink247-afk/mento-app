"""WCAG AA gate for Mento's tokens. Fails (exit 1) if any text/surface pair is below
4.5:1 (normal text) — the accent set on white, the oat ground, AND the lavender
"ritual" surface, the semantic colours, muted ink, and ink on every tint. Run from
the repo root:

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
    block_text = re.sub(r'//[^\n]*', '', block.group(0))
    return dict(re.findall(r"(\w+): '(#[0-9A-Fa-f]{6})'", block_text))


def lum(h: str) -> float:
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (1, 3, 5))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a: str, b: str) -> float:
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def mix(a: str, b: str, t: float) -> str:
    """Mirror of mix() in theme/companion.ts."""
    c = lambda i: format(round(int(a[i : i + 2], 16) * (1 - t) + int(b[i : i + 2], 16) * t), "02x")
    return f"#{c(1)}{c(3)}{c(5)}"


def looks(tokens: str, base: dict[str, str]) -> dict[str, dict[str, str]]:
    """The Light and Dark overrides in tokens.ts layered over the pastel base."""
    out = {}
    for name in ("LIGHT", "DARK"):
        block = re.search(rf"const {name}: ColorMap = \{{[\s\S]*?\n\}};", tokens)
        if not block:
            sys.exit(f"{name} not found")
        text = re.sub(r"//[^\n]*", "", block.group(0))
        out[name.lower()] = {**base, **dict(re.findall(r"(\w+): '(#[0-9A-Fa-f]{6})'", text))}
    return out


def appearance_pairs(tokens: str, companion: str, base: dict[str, str]) -> list[tuple[str, str, str, float]]:
    pairs: list[tuple[str, str, str, float]] = []
    wash_dark = dict(re.findall(r"(\w+): '(#[0-9A-Fa-f]{6})'", re.search(r"const WASH_DARK = \{([^}]*)\}", tokens).group(1)))
    ink_dark = dict(re.findall(r"(\w+): '(#[0-9A-Fa-f]{6})'", re.search(r"const WASH_INK_DARK = \{([^}]*)\}", tokens).group(1)))
    for look, c in looks(tokens, base).items():
        for key in ("ink", "inkMuted", "success", "warning", "danger"):
            for ground in ("bg", "surface", "bgLavender"):
                pairs.append((f"{look}: {key} on {ground}", c[key], c[ground], 4.5))
        if look == "dark":
            for k in ("green", "orange", "danger", "indigo"):
                w = {"green": "green", "orange": "orange", "danger": "danger", "indigo": "indigo"}[k]
                pairs.append((f"dark: wash ink {k} on its wash", ink_dark[k], wash_dark[w], 4.5))
            pairs.append(("dark: dangerInk on dangerWash", c["dangerInk"], wash_dark["danger"], 4.5))
            for name, block in re.findall(r"(\w+): \{ (accent: '#[^}]*) \}", companion):
                a = dict(re.findall(r"(\w+): '(#[0-9A-Fa-f]{6})'", block))["accent"]
                ground, accent = "#0F1419", mix(a, "#FFFFFF", 0.5)
                tint = mix(a, ground, 0.8)
                pairs.append((f"dark {name}: accent on bg", accent, c["bg"], 4.5))
                pairs.append((f"dark {name}: accent on surface", accent, c["surface"], 4.5))
                pairs.append((f"dark {name}: dark text on accent", ground, accent, 4.5))
                pairs.append((f"dark {name}: ink on tint", c["ink"], tint, 4.5))
                pairs.append((f"dark {name}: accent on tint", accent, tint, 4.5))
                ink = mix(a, "#FFFFFF", 0.74)
                pairs.append((f"dark {name}: ink on tint", ink, tint, 4.5))
                pairs.append((f"dark {name}: ink on surface", ink, c["surface"], 4.5))
                pairs.append((f"dark {name}: ink on bg", ink, c["bg"], 4.5))
    return pairs


def main() -> int:
    tokens = (ROOT / "tokens.ts").read_text(encoding="utf-8")
    companion = (ROOT / "companion.ts").read_text(encoding="utf-8")
    colors = hexes("colors", tokens)
    white, oat, ink = colors["surface"], colors["bg"], colors["ink"]
    ritual = colors["bgLavender"]
    pairs: list[tuple[str, str, str, float]] = []  # (label, fg, bg, min)
    for key in ("ink", "inkMuted", "success", "warning", "danger"):
        pairs.append((f"{key} on white", colors[key], white, 4.5))
        pairs.append((f"{key} on oat", colors[key], oat, 4.5))
        pairs.append((f"{key} on ritual", colors[key], ritual, 4.5))
    pairs.append(("accentSoft on oat (large text only)", colors["accentSoft"], oat, 3.0))
    for name, block in re.findall(r"(\w+): \{ (accent: '#[^}]*) \}", companion):
        vals = dict(re.findall(r"(\w+): '(#[0-9A-Fa-f]{6})'", block))
        pairs.append((f"{name}: white on accent", vals["onAccent"], vals["accent"], 4.5))
        pairs.append((f"{name}: accent on white", vals["accent"], white, 4.5))
        pairs.append((f"{name}: accent on oat", vals["accent"], oat, 4.5))
        pairs.append((f"{name}: accent on ritual", vals["accent"], ritual, 4.5))
        pairs.append((f"{name}: ink on tint", ink, vals["accentTint"], 4.5))
        # Board port (2026-09-19): the accent sits on its own tint as LARGE display text
        # only (the date wheels' selected value); small labels on a tint face use the edge.
        pairs.append((f"{name}: accent on tint (large only)", vals["accent"], vals["accentTint"], 3.0))
        pairs.append((f"{name}: edge on tint", vals["accentEdge"], vals["accentTint"], 4.5))
    pairs += appearance_pairs(tokens, companion, colors)
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
