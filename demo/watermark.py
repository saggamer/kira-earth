"""Renders the SI-disclosure watermark (transparent PNG, top-right pill) for the demo video. Needs Pillow.
usage: python demo/watermark.py OUT.png "text" [width=1920] [center_x=1070]
The default centre sits in the gap between the search box and the tool buttons of the 1920-px recording."""
import sys
from PIL import Image, ImageDraw, ImageFont

out, text = sys.argv[1], sys.argv[2]
W = int(sys.argv[3]) if len(sys.argv) > 3 else 1920
CX = int(sys.argv[4]) if len(sys.argv) > 4 else 1070
FONTS = ["/System/Library/Fonts/HelveticaNeue.ttc", "/System/Library/Fonts/Helvetica.ttc",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
def font(size, bold=False):
    for f in FONTS:
        try:
            return ImageFont.truetype(f, size, index=1 if bold and f.endswith(".ttc") else 0)
        except OSError:
            continue
    return ImageFont.load_default()
body, badge = font(22), font(17, bold=True)
img = Image.new("RGBA", (W, 84), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
tag = "AI · SI"
tw = d.textlength(tag, font=badge); bw = d.textlength(text, font=body)
pad, gap = 18, 12
w = pad + tw + 20 + gap + bw + pad
x0, y1 = CX - w / 2, 24
x1, y0 = x0 + w, y1 + 46
d.rounded_rectangle([x0, y1, x1, y0], radius=23, fill=(8, 11, 18, 205), outline=(255, 255, 255, 70), width=1)
bx0 = x0 + pad
d.rounded_rectangle([bx0, y1 + 10, bx0 + tw + 20, y0 - 10], radius=13, fill=(167, 139, 250, 255))
d.text((bx0 + 10, y1 + 12), tag, font=badge, fill=(10, 13, 20, 255))
d.text((bx0 + tw + 20 + gap, y1 + 10), text, font=body, fill=(238, 242, 248, 255))
img.save(out)
print("wrote", out)
