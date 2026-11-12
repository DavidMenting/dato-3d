"""Draw part numbers on contact sheets. Usage: python3 scripts/label_sheet.py cad/out drum"""
import sys, json, glob, os
from PIL import Image, ImageDraw, ImageFont

out, product = sys.argv[1], sys.argv[2]
def font(size):
    for p in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"):
        try: return ImageFont.truetype(p, size)
        except Exception: pass
    return ImageFont.load_default()

for jp in sorted(glob.glob(f"{out}/{product}-labels-*.json")):
    d = json.load(open(jp))
    im = Image.open(f"{out}/{d['raw']}").convert("RGB")
    dr = ImageDraw.Draw(im)
    big = "-q" in jp or "34" in jp
    f = font(22 if "-q" in jp else 15 if "34" in jp else 12)
    placed = []
    for l in sorted(d["labels"], key=lambda l: (l["y"], l["x"])):
        t = str(l["n"]); x, y = l["x"], l["y"]
        w = dr.textlength(t, font=f); h = f.size
        box = (x - w / 2, y - h / 2, x + w / 2, y + h / 2)
        # nudge away from earlier labels
        for dy in (0, -h, h, -2 * h, 2 * h):
            b = (box[0], box[1] + dy, box[2], box[3] + dy)
            if not any(b[0] < p[2] and b[2] > p[0] and b[1] < p[3] and b[3] > p[1] for p in placed):
                box = b; break
        placed.append(box)
        dr.text((box[0], box[1] - 2), t, font=f, fill=(220, 0, 0), stroke_width=2, stroke_fill=(255, 255, 255))
        dr.ellipse((x - 2, y - 2, x + 2, y + 2), fill=(220, 0, 0))
    dst = f"{out}/{d['image']}"
    im.save(dst)
    print("labelled", dst, len(d["labels"]))
