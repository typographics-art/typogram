#!/usr/bin/env node
// Create one Shopify product per (gallery work × Gelato template) via Gelato's create-from-template API,
// as DRAFTS (not visible), filling each template's image placeholder with the work's hosted master URL.
// Gelato then generates the mockups and syncs each product to the connected Shopify store in the background.
//
//   GELATO_API_KEY=... node scripts/gelato-create-products.mjs [--visible] [--template <id>] [--work <id>]
//
// - Enumerates the Shopify store (type=shopify) and the template store (type=template) automatically.
// - Templates are the "products" in the template store; GET /v1/templates/{id} gives variants + placeholders.
// - Idempotent: skips a (work, template) whose product title already exists in the Shopify store.
// - DRAFT by default (isVisibleInTheOnlineStore:false) so products can be reviewed before publishing;
//   --visible publishes them live. Retail prices are set on the Shopify side (per gallery/pricing.json).
//   No order is placed — this only creates listings.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = process.env.GELATO_API_KEY;
if (!KEY) { console.error('set GELATO_API_KEY (from Infisical /gelato)'); process.exit(1); }
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const H = { 'X-API-KEY': KEY, 'Content-Type': 'application/json' };
const EC = 'https://ecommerce.gelatoapis.com/v1';
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const visible = args.includes('--visible');
const onlyTemplate = flag('--template');
const onlyWork = flag('--work');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const labelFor = (t) => (/t-?shirt|tee|crewneck/i.test(t) ? 'T-shirt' : /mug/i.test(t) ? 'Mug' : /canvas/i.test(t) ? 'Canvas' : /frame/i.test(t) ? 'Framed poster' : /tote/i.test(t) ? 'Tote bag' : /poster|print/i.test(t) ? 'Poster' : t.split(' ')[0]);
const materialFor = (l) => ({ 'Poster': 'premium matte paper (200 gsm)', 'Canvas': 'gallery-wrapped canvas', 'Framed poster': 'framed premium paper', 'Mug': 'white ceramic', 'T-shirt': 'soft cotton', 'Tote bag': 'cotton canvas' }[l] || 'premium stock');
const categoryTag = (l) => (/Poster|Canvas|Framed/.test(l) ? 'Wall art' : l === 'Mug' ? 'Drinkware' : l === 'T-shirt' ? 'Apparel' : 'Accessories');
// Sales copy — the selling point (the picture is made of the text), the material, provenance. Set at creation only.
const describe = (w, label) => [
  `<p><strong>${w.caption}</strong></p>`,
  `<p>A <em>typogram</em>: the whole picture is made of the text itself — read the words up close, see the image from across the room.</p>`,
  `<p>Printed on ${materialFor(label)} and made to order, shipped from within the EU. Part of the Typographics Art collection — <a href="https://typographics-art.org">typographics-art.org</a>.</p>`,
  `<p><small>Set from: ${w.source}</small></p>`,
].join('');

const stores = (await (await fetch(`${EC}/stores`, { headers: H })).json()).stores || [];
const shop = stores.find((s) => s.type === 'shopify');
if (!shop) { console.error('no connected shopify store'); process.exit(1); }
// The template store (type=template, "Product templates") is NOT returned by GET /stores — it is a hidden,
// account-level store reachable only by its id (from the dashboard template URL). Override with env if needed.
const tplStoreId = process.env.GELATO_TEMPLATE_STORE || '0083c266-0c11-4a23-96f2-45d7984577cd';

let templates = (await (await fetch(`${EC}/stores/${tplStoreId}/products?limit=100`, { headers: H })).json()).products || [];
if (onlyTemplate) templates = templates.filter((t) => t.id === onlyTemplate);
if (!templates.length) { console.error('no templates found'); process.exit(1); }

let works = JSON.parse(readFileSync(join(ROOT, 'prints', 'catalog.json'), 'utf8')).works;
if (onlyWork) works = works.filter((w) => w.id === onlyWork);

// --replace: delete all existing products first (to refresh title/description/tags, which are create-only).
if (args.includes('--replace')) {
  const all = (await (await fetch(`${EC}/stores/${shop.id}/products?limit=250`, { headers: H })).json()).products || [];
  console.log(`--replace: deleting ${all.length} existing products…`);
  for (const p of all) { await fetch(`${EC}/stores/${shop.id}/products/${p.id}`, { method: 'DELETE', headers: H }); await sleep(400); }
}
// existing product titles in the shop, for idempotency
const existing = new Set(((await (await fetch(`${EC}/stores/${shop.id}/products?limit=250`, { headers: H })).json()).products || []).map((p) => p.title));

let made = 0, skipped = 0, failed = 0;
for (const tpl of templates) {
  const label = labelFor(tpl.title);
  const full = await (await fetch(`${EC}/templates/${tpl.id}`, { headers: H })).json();
  const tplVariants = full.variants || [];
  const placeholderNames = [...new Set(tplVariants.flatMap((v) => (v.imagePlaceholders || []).map((p) => p.name)))];
  console.log(`\ntemplate "${tpl.title}" -> label "${label}": ${tplVariants.length} variants, placeholders [${placeholderNames.join(', ')}]`);
  for (const w of works) {
    const title = `${w.title} — ${label}`;
    if (existing.has(title)) { skipped++; console.log(`  skip (exists): ${title}`); continue; }
    const variants = tplVariants.map((v) => ({
      templateVariantId: v.id,
      imagePlaceholders: (v.imagePlaceholders || []).map((p) => ({ name: p.name, fileUrl: w.masterUrl })),
    }));
    const tags = ['Typographic Art', 'Typogram', label, categoryTag(label), 'Public domain', w.id];
    const body = { templateId: tpl.id, title, description: describe(w, label), isVisibleInTheOnlineStore: visible, tags, salesChannels: ['web'], variants };
    const r = await fetch(`${EC}/stores/${shop.id}/products:create-from-template`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    if (r.status === 200) { made++; const j = await r.json(); console.log(`  created: ${title}  (${j.id})`); }
    else { failed++; console.log(`  FAIL ${r.status}: ${title}  ${(await r.text()).slice(0, 160)}`); }
    await sleep(1200); // pace the API
  }
}
console.log(`\n${made} created, ${skipped} skipped (already existed), ${failed} failed. Gelato syncs mockups + Shopify in the background (~1 min each). ${visible ? 'LIVE' : 'DRAFTS — review and publish in Shopify.'}`);
