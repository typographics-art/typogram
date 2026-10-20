#!/usr/bin/env node
// The product catalog: every gallery work × the products it is sold as, with market-anchored retail prices
// and the real Gelato base cost + margin. Combines the print masters' seed (prints/manifest.json) with the
// pricing config (gallery/pricing.json) into a ready-to-import catalog for a shop or for Gelato.
//
//   node scripts/build-catalog.mjs
//     -> prints/catalog.json  (full: each work with its products, prices, margins and Gelato product UIDs)
//     -> prints/catalog.csv   (flat: one row per work × product, for a spreadsheet or a shop import)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'prints', 'manifest.json'), 'utf8'));
const pricing = JSON.parse(readFileSync(join(ROOT, 'gallery', 'pricing.json'), 'utf8'));
const byKey = new Map(pricing.products.map((p) => [p.key, p]));

const pct = (retail, base) => Math.round(((retail - base) / retail) * 100);
const isLandscape = (pixels) => { const [w, h] = pixels.split('x').map(Number); return w > h; };

const catalog = manifest.map((w) => {
  const landscape = isLandscape(w.pixels);
  const products = pricing.appliesTo.all.map((key) => {
    const p = byKey.get(key);
    // Posters/framed/canvas carry an orientation in the Gelato UID; a landscape work uses the `hor` variant (same price).
    const gelatoUid = landscape ? p.gelatoUid.replace(/_ver$/, '_hor') : p.gelatoUid;
    return { key, label: p.label, size: p.size, retail: p.retail, currency: pricing.currency, base: p.base, marginPct: pct(p.retail, p.base), gelatoUid };
  });
  const masterUrl = `${pricing.masterBaseUrl}/${w.id}.png`;
  return { id: w.id, title: w.title, caption: w.caption, source: w.source, rights: w.rights, master: w.file, masterUrl, pixels: w.pixels, inches: w.inches, orientation: landscape ? 'landscape' : 'portrait/square', products };
});

writeFileSync(join(ROOT, 'prints', 'catalog.json'), JSON.stringify({ currency: pricing.currency, country: pricing.country, supplier: pricing.supplier, basis: pricing.basis, works: catalog }, null, 2) + '\n');

// Flat CSV, one row per work × product. Quote every cell and double internal quotes (captions carry commas/quotes).
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const header = ['work_id', 'title', 'product', 'size', 'supplier', 'retail', 'currency', 'base_cost', 'margin_pct', 'gelato_uid', 'master_url', 'caption'];
const rows = [header.join(',')];
for (const w of catalog) for (const p of w.products) {
  rows.push([w.id, w.title, p.label, p.size, pricing.supplier, p.retail, p.currency, p.base, p.marginPct, p.gelatoUid, w.masterUrl, w.caption].map(cell).join(','));
}
writeFileSync(join(ROOT, 'prints', 'catalog.csv'), rows.join('\n') + '\n');

const skus = catalog.reduce((n, w) => n + w.products.length, 0);
console.log(`catalog: ${catalog.length} works, ${skus} work×product listings → prints/catalog.json + prints/catalog.csv`);
