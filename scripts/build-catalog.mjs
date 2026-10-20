#!/usr/bin/env node
// The product catalog: every gallery work × the products it is sold as, with market-anchored retail prices.
// Combines the print masters' seed (prints/manifest.json) with the pricing config (gallery/pricing.json) into
// a ready-to-import catalog for a shop or a print-on-demand platform.
//
//   node scripts/build-catalog.mjs
//     -> prints/catalog.json  (full: each work with its products, prices and margins)
//     -> prints/catalog.csv   (flat: one row per work × product, for a spreadsheet or a shop import)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'prints', 'manifest.json'), 'utf8'));
const pricing = JSON.parse(readFileSync(join(ROOT, 'gallery', 'pricing.json'), 'utf8'));
const byKey = new Map(pricing.products.map((p) => [p.key, p]));

const pct = (retail, base) => Math.round(((retail - base) / retail) * 100);
const isSquare = (pixels) => { const [w, h] = pixels.split('x').map(Number); const r = w / h; return r >= 0.95 && r <= 1.05; };

const catalog = manifest.map((w) => {
  const keys = [...pricing.appliesTo.all, ...(isSquare(w.pixels) ? pricing.appliesTo.squareOnly : [])];
  const products = keys.map((key) => {
    const p = byKey.get(key);
    return { key, label: p.label, size: p.size, supplier: p.supplier, retail: p.retail, currency: pricing.currency, approxBase: p.approxBase, marginPct: pct(p.retail, p.approxBase) };
  });
  return { id: w.id, title: w.title, caption: w.caption, source: w.source, rights: w.rights, master: w.file, pixels: w.pixels, inches: w.inches, products };
});

writeFileSync(join(ROOT, 'prints', 'catalog.json'), JSON.stringify({ currency: pricing.currency, basis: pricing.basis, verify: pricing.verify, works: catalog }, null, 2) + '\n');

// Flat CSV, one row per work × product. Quote every cell and double internal quotes (captions carry commas/quotes).
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const header = ['work_id', 'title', 'product', 'size', 'supplier', 'retail', 'currency', 'approx_base', 'margin_pct', 'master_file', 'caption'];
const rows = [header.join(',')];
for (const w of catalog) for (const p of w.products) {
  rows.push([w.id, w.title, p.label, p.size, p.supplier, p.retail, p.currency, p.approxBase, p.marginPct, w.master, w.caption].map(cell).join(','));
}
writeFileSync(join(ROOT, 'prints', 'catalog.csv'), rows.join('\n') + '\n');

const skus = catalog.reduce((n, w) => n + w.products.length, 0);
console.log(`catalog: ${catalog.length} works, ${skus} work×product listings → prints/catalog.json + prints/catalog.csv`);
