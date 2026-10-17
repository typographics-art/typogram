#!/usr/bin/env python3
"""The intro picture of the README: gallery works side by side, each with its original photo as a small inset
in the lower right corner, so the work is seen whole and the comparison is still there.

    python3 scripts/build-intro.py tesla great-wave wanderer douglass     # writes assets/intro.jpg (needs Pillow)

Each work must exist in gallery/ (<id>.jpg) with its photo in gallery/photos/<id>.jpg.
"""
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ids = sys.argv[1:] or ['tesla', 'great-wave', 'wanderer', 'douglass']
H, GAP, BG = 620, 18, (13, 17, 23)


def fit_height(im, h):
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)


tiles = []
for work in ids:
    art = Image.open(os.path.join(ROOT, 'gallery', f'{work}.jpg')).convert('RGB')
    photo = Image.open(os.path.join(ROOT, 'gallery', 'photos', f'{work}.jpg')).convert('RGB')
    art = fit_height(art, H)
    tile = art.copy()
    inset = photo.copy()
    inset.thumbnail((round(art.width * 0.32), round(H * 0.32)), Image.LANCZOS)
    m = 12
    x0 = art.width - inset.width - m
    ImageDraw.Draw(tile).rectangle([x0 - 3, H - inset.height - m - 3, x0 + inset.width + 2, H - m + 2], fill=(255, 255, 255))
    tile.paste(inset, (x0, H - inset.height - m))
    tiles.append(tile)

W = sum(t.width for t in tiles) + GAP * (len(tiles) + 1)
canvas = Image.new('RGB', (W, H + 2 * GAP), BG)
x = GAP
for t in tiles:
    canvas.paste(t, (x, GAP))
    x += t.width + GAP
canvas.thumbnail((1600, 1600), Image.LANCZOS)
out = os.path.join(ROOT, 'assets', 'intro.jpg')
canvas.save(out, quality=84, optimize=True, progressive=True)
print(out, canvas.size, os.path.getsize(out), 'bytes')
