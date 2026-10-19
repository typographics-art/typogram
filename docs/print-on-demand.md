# Print on demand — the gallery works

The fifteen gallery works are made to be printed and sold: posters, prints, cards, mugs, pillows, shirts.
Each is a picture built entirely from a text that the buyer already cares about — Earthrise set from Genesis
(which the Apollo 8 crew read from orbit on Christmas Eve 1968), Lincoln from his Cooper Union speech, the
Mona Lisa from Walter Pater's essay about her, the Wanderer from Nietzsche. The selling point is exactly
that: the image *is* the text, close up you read it, across the room you see the picture, and it verifies.

## Rights

Every work is free to sell commercially — the text is public domain, the image is public domain, and the
setting of the text into the image is the original work of typographics-art.org. The full basis, with a
verified free source for each image, is in [image-rights.md](image-rights.md). Keep a product-side note that
the works are historical / public domain and that no institutional or governmental endorsement is implied.

## Making the print masters

```
node scripts/build-prints.mjs            # every work in gallery/works.json
node scripts/build-prints.mjs great-wave mona-lisa   # only these
```

Output goes to `prints/`:

- `prints/<id>.png` — one master per work.
- `prints/manifest.json` — id, title, the text it is set from, licence, pixel size, print size, DPI. This
  is the seed for a product catalog.

The PNG masters are large and are **not** committed (they are regenerated from the signed artwork on demand);
`prints/manifest.json` is committed.

### Spec

- **Long side 7200 px = 24 inches at 300 DPI**; the short side follows each work's own aspect ratio (so a
  portrait is 16.4 × 24 in, a landscape 24 × 16.5 in). 7200 px on the long side prints cleanly to the common
  poster sizes — 300 DPI at 24 in, still ~245 DPI stretched to 36 in.
- **sRGB**, resolution stamped so a print shop reads the right physical size.
- The master is rasterised from the exact, signed `gallery/<id>.svg` — the picture and its signature are
  untouched, a print is just a higher-resolution view of the published artwork.

### Why Chrome then MuPDF

A Typogram sets each glyph at its own weight and width (Roboto Flex variable axes), and only Chrome renders
those axes faithfully — a plain SVG rasteriser flattens every glyph to one weight and ruins the picture. So
the pipeline prints the SVG to a one-page PDF in Chrome at the physical size, then rasterises that page at
300 DPI with MuPDF (`mutool`), which the project already trusts for Chrome's Type-3 glyph PDFs. The result is
pixel-faithful to what the website shows; at the print's higher resolution the glyph strokes are finer, so a
master reads a touch lighter and sharper than the small gallery preview.

## Selling them

The storefront and fulfilment — a shop of our own plus a print partner (Gelato for posters in the EU,
Printful for apparel), and the product catalog on `zentrale.astrioncore.app` — are the operator's and
AstrionCore's to set up. This repo produces the masters and the catalog seed; `manifest.json` carries the
text, licence and size each listing needs.
