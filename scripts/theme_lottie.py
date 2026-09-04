"""Theme a Lottie (.json or .lottie zip) into the Mento palette.

Usage:  python scripts/theme_lottie.py <in.lottie|in.json> <out.json>

Remaps every color property — static fills/strokes, animated keyframes, and
gradient stops — onto Mento tokens by HSL role:
  dark inks        -> #2B2B2B / #4A4540 (two tiers preserve layering)
  grays            -> muted ink family
  saturated colors -> terracotta family by lightness (accent / accentSoft / pale)
  near-white       -> kept (crisp on clay)

The goal: any free Lottie reads as if drawn for Mento. Licences stay documented
in apps/mobile/assets/lottie/README.md.
"""
from __future__ import annotations

import base64
import colorsys
import io
import json
import sys
import zipfile
from pathlib import Path

INK = (0x2B / 255, 0x2B / 255, 0x2B / 255)          # #2B2B2B charcoal
INK2 = (0x4A / 255, 0x45 / 255, 0x40 / 255)         # #4A4540
INK_MUTED = (0x6E / 255, 0x6A / 255, 0x64 / 255)    # #6E6A64
ACCENT = (0xA2 / 255, 0x53 / 255, 0x3A / 255)       # #A2533A terracotta
ACCENT_SOFT = (0xC9 / 255, 0x74 / 255, 0x4F / 255)  # #C9744F
PALE = (0xF6 / 255, 0xD9 / 255, 0xCB / 255)         # #F6D9CB
LIGHT_GRAY = (0xE6 / 255, 0xDF / 255, 0xD3 / 255)   # #E6DFD3 clay border


def remap_rgb(r: float, g: float, b: float) -> tuple[float, float, float]:
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    if l > 0.92:
        return (r, g, b)  # whites stay crisp
    if s < 0.12:  # grays and blacks
        if l < 0.16:
            return INK
        if l < 0.30:
            return INK2
        if l < 0.62:
            return INK_MUTED
        return LIGHT_GRAY
    # saturated colors -> indigo family by lightness
    if l < 0.28:
        return INK2 if s < 0.5 else (0x7E / 255, 0x3F / 255, 0x2B / 255)  # terracotta edge
    if l < 0.52:
        return ACCENT
    if l < 0.74:
        return ACCENT_SOFT
    return PALE


def remap_color_array(k: list) -> None:
    """[r,g,b(,a)] in place."""
    r, g, b = remap_rgb(*[max(0.0, min(1.0, float(x))) for x in k[:3]])
    k[0], k[1], k[2] = r, g, b


def remap_gradient_stops(k: list) -> None:
    """Gradient data: [pos,r,g,b, pos,r,g,b, ...] (alpha stops may trail)."""
    i = 0
    while i + 3 < len(k):
        r, g, b = remap_rgb(
            *[max(0.0, min(1.0, float(x))) for x in (k[i + 1], k[i + 2], k[i + 3])]
        )
        k[i + 1], k[i + 2], k[i + 3] = r, g, b
        i += 4


def is_rgb_list(k) -> bool:
    return (
        isinstance(k, list)
        and 3 <= len(k) <= 4
        and all(isinstance(x, (int, float)) for x in k)
    )


def walk(o, count: list[int]) -> None:
    if isinstance(o, dict):
        ty = o.get("ty")
        if ty in ("fl", "st") and isinstance(o.get("c"), dict):
            c = o["c"]
            if c.get("a") == 1 and isinstance(c.get("k"), list):
                for kf in c["k"]:  # animated: remap every keyframe endpoint
                    for key in ("s", "e"):
                        if is_rgb_list(kf.get(key)):
                            remap_color_array(kf[key])
                            count[0] += 1
            elif is_rgb_list(c.get("k")):
                remap_color_array(c["k"])
                count[0] += 1
        if ty in ("gf", "gs") and isinstance(o.get("g"), dict):
            gk = o["g"].get("k")
            stops = gk.get("k") if isinstance(gk, dict) else None
            if isinstance(stops, list) and all(isinstance(x, (int, float)) for x in stops):
                remap_gradient_stops(stops)
                count[0] += 1
        for v in o.values():
            walk(v, count)
    elif isinstance(o, list):
        for v in o:
            walk(v, count)


def load_animation(path: Path) -> dict:
    data = path.read_bytes()
    if data[:2] == b"PK":  # .lottie = zip; animation lives in animations/*.json
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = [n for n in z.namelist() if n.startswith("animations/") and n.endswith(".json")]
            if not names:
                raise SystemExit(f"no animations/*.json inside {path}")
            anim = json.loads(z.read(names[0]))
            # Embed any raster assets (images/*) as data URIs — a standalone .json
            # must carry everything the zip did, or image layers render broken.
            files = {n.split("/")[-1]: n for n in z.namelist() if "/images/" in n or n.startswith("images/")}
            for a in anim.get("assets", []):
                p = a.get("p")
                if p and not str(p).startswith("data:") and p in files:
                    ext = p.rsplit(".", 1)[-1].lower()
                    mime = "image/png" if ext == "png" else f"image/{ext}"
                    a["p"] = f"data:{mime};base64," + base64.b64encode(z.read(files[p])).decode()
                    a["u"] = ""
                    a["e"] = 1
            return anim
    return json.loads(data.decode("utf-8"))


def main() -> None:
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    anim = load_animation(src)
    count = [0]
    walk(anim, count)
    anim["nm"] = f"{anim.get('nm', src.stem)} (Mento themed)"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(anim, separators=(",", ":")), encoding="utf-8")
    print(f"{src.name}: {count[0]} color props remapped -> {dst} ({dst.stat().st_size // 1024}KB)")


if __name__ == "__main__":
    main()
