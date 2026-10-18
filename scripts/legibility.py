#!/usr/bin/env python3
"""Scores previews written by scripts/legibility.mjs.

corr@300  Pearson correlation of brightness between the preview and the title card it was set to, both
          downscaled to 300 px wide (the page as a thumbnail).
corr@blur the same after a Gaussian blur of 1.2 px (the page seen from arm's length).
ocr       whether tesseract finds the title in the page shrunk to 150 or 240 px wide and enlarged again (what a
          thumbnail shows); three blur strengths and two page-segmentation modes, any hit counts.

Usage: legibility.py <outdir> <id>:<title> ...
"""
import sys, subprocess, re
import numpy as np
from PIL import Image, ImageFilter

out = sys.argv[1]
W = 300


def load(p, w=W):
    im = Image.open(p).convert('L')
    return im.resize((w, round(im.height * w / im.width)), Image.BOX)


def blur(im, r):
    return im.filter(ImageFilter.GaussianBlur(r))


norm = lambda s: re.sub(r'[^a-z0-9§]', '', s.lower())


def ocr(id_, title):
    best = ''
    for w, r in ((150, 0), (150, 0.8), (240, 1.2)):
        small = load(f'{out}/{id_}.jpg', w)
        im = small.resize((w * 4, small.height * 4), Image.BICUBIC)
        im = blur(im, r * 2) if r else im
        f = f'{out}/{id_}.ocr.png'
        im.save(f)
        for psm in ('6', '11'):
            txt = subprocess.run(['tesseract', f, '-', '--psm', psm], capture_output=True, text=True).stdout
            if norm(title) in norm(txt):
                return True, norm(txt)[:24]
            best = best or norm(txt)[:24]
    return False, best


print(f"{'example':28s} {'corr@300':>8s} {'corr@blur':>9s}  ocr")
for spec in sys.argv[2:]:
    id_, title = spec.split(':', 1)
    p = load(f'{out}/{id_}.jpg')
    t = load(f'{out}/{id_}.target.png').resize(p.size, Image.BOX)
    c1 = np.corrcoef(np.asarray(p, float).ravel(), np.asarray(t, float).ravel())[0, 1]
    c2 = np.corrcoef(np.asarray(blur(p, 1.2), float).ravel(), np.asarray(blur(t, 1.2), float).ravel())[0, 1]
    hit, txt = ocr(id_, title)
    print(f"{id_:28s} {c1:8.3f} {c2:9.3f}  {'READ' if hit else 'no  '} {txt!r}")
