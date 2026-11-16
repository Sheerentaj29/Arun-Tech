#!/usr/bin/env python3
"""Create logo test fixtures for the client-logo E2E test."""
import struct, zlib, os
from PIL import Image, ImageDraw

OUT = "/home/z/my-project/scripts/fixtures"
os.makedirs(OUT, exist_ok=True)

def make_logo(path, w=240, h=100, bg=(240,248,255), fg=(20,60,120), text="LOGO", fmt="PNG"):
    im = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(im)
    d.rectangle([4,4,w-5,h-5], outline=fg, width=3)
    d.text((w//2-30, h//2-10), text, fill=fg)
    im.save(path, fmt)
    print(path, os.path.getsize(path), "bytes")

# 1) PNG logo — initial upload
make_logo(f"{OUT}/logo-alpha.png", text="ACME")
# 2) JPEG logo — replace test (different color/size to prove swap)
make_logo(f"{OUT}/logo-beta.jpg", w=200, h=140, bg=(255,244,230), fg=(160,60,10), text="BETA", fmt="JPEG")
# 3) Oversized PNG (>5MB) — must be rejected by validation
im = Image.new("RGB", (60, 30), (200, 200, 200))
im.save(f"{OUT}/logo-huge-tmp.png")
with open(f"{OUT}/logo-huge-tmp.png","rb") as f: data = f.read()
with open(f"{OUT}/logo-huge.png","wb") as f:
    # Repeat IDAT-ish padding appended after IEND-end? No — must stay a *valid* PNG.
    # Simplest valid large PNG: scale pixel data via a big uncompressed chunk is complex;
    # instead make a large true image.
    big = Image.new("RGB", (3000, 3000))
    big.save(f"{OUT}/logo-huge.png")
os.remove(f"{OUT}/logo-huge-tmp.png")
print(f"{OUT}/logo-huge.png", os.path.getsize(f"{OUT}/logo-huge.png"), "bytes")
# 4) Invalid type — text file disguised with .png? No: genuine wrong-type file (.txt)
with open(f"{OUT}/logo-invalid.txt","w") as f: f.write("not an image")
print(f"{OUT}/logo-invalid.txt", os.path.getsize(f"{OUT}/logo-invalid.txt"), "bytes")
