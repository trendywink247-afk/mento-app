"""Contact sheet for review: python scripts/companions/sheet.py <dir-with-pngs> <out.png>
Tiles every *.png in the folder (sorted) at 320px on a neutral grid with filenames."""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
files = sorted(src.glob("*.png")) + sorted(src.glob("*.webp"))
if not files:
    sys.exit(f"no images in {src}")
tile, cols = 320, 4
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tile, rows * (tile + 24)), (240, 236, 228))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert("RGBA")
    im.thumbnail((tile - 16, tile - 16))
    x, y = (i % cols) * tile + 8, (i // cols) * (tile + 24) + 8
    sheet.paste(im, (x, y), im)
    d.text((x, y + tile - 12), f.name, fill=(43, 43, 43))
sheet.save(dst)
print(dst, sheet.size, len(files), "images")
