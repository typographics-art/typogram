#!/usr/bin/env node
// Builds samples/data/: two small data files the generator offers under "Try it with a sample" (app#data).
// The data is invented (a fictional bakery), MIT licensed like the rest of the repository; the Excel file is written with
// this repository's own writer, so it is the same data as the CSV plus a second sheet, a formula and typed dates.
// Deterministic: running it again gives the same bytes. Run: node scripts/build-data-samples.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seal, decode, toFile } from '../src/structured.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'samples', 'data');
mkdirSync(OUT, { recursive: true });

let seed = 20261018;
const rnd = (n) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
const CUSTOMERS = ['Café Müller', 'Zoë & Söhne', 'Bäckerei Rot', 'Hotel Alpenblick', 'Kita Sonnenschein', 'Mensa Nord'];
const ITEMS = [['Sauerteigbrot', 4.8], ['Zopf', 5.2], ['Croissant', 1.9], ['Nussgipfel', 2.4], ['Roggenbrötchen', 1.1], ['Apfelkuchen', 18.5]];
const NOTES = ['', '', '', 'Lieferung vor 7 Uhr', 'ohne Nüsse', 'Rechnung, bitte', 'Abholung, 2 Kisten'];

const rows = [];
for (let i = 0; i < 30; i++) {
  const [item, price] = ITEMS[rnd(ITEMS.length)];
  const day = 1 + rnd(28);
  rows.push({ id: 1001 + i, date: `2026-09-${String(day).padStart(2, '0')}`, customer: CUSTOMERS[rnd(CUSTOMERS.length)], item, qty: 2 + rnd(40), price, note: NOTES[rnd(NOTES.length)] });
}
rows.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

const q = (s) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
const csv = ['Order,Date,Customer,Item,Qty,Price CHF,Note', ...rows.map((r) => [r.id, r.date, q(r.customer), r.item, r.qty, r.price.toFixed(2), q(r.note)].join(','))].join('\n') + '\n';
writeFileSync(join(OUT, 'bakery-orders.csv'), csv);

const total = rows.reduce((s, r) => s + r.qty * r.price, 0);
const grid = [['Order', 'Date', 'Customer', 'Item', 'Qty', 'Price CHF', 'Note'],
  ...rows.map((r) => [r.id, { $: 'd', v: r.date }, r.customer, r.item, r.qty, r.price, r.note || null])];
grid.push([null, null, null, 'Total qty', { $: 'f', f: `SUM(E2:E${rows.length + 1})`, v: rows.reduce((s, r) => s + r.qty, 0) }, null, null]);
const model = {
  kind: 'workbook',
  sheets: [
    { name: 'Orders', header: true, rows: grid },
    { name: 'Prices', header: true, rows: [['Item', 'Price CHF'], ...ITEMS.map(([n, p]) => [n, p])] },
  ],
};
const block = await decode(await seal(model, { format: 'xlsx', name: 'bakery-orders.xlsx', created: false }));
const xlsx = await toFile(block, 'xlsx', { formulas: true });
writeFileSync(join(OUT, 'bakery-orders.xlsx'), xlsx.bytes);

writeFileSync(join(OUT, 'index.json'), JSON.stringify([
  { file: 'bakery-orders.csv', format: 'csv', title: 'Bakery orders (CSV)', licence: 'MIT', note: 'Invented data: a fictional bakery. 30 orders.' },
  { file: 'bakery-orders.xlsx', format: 'xlsx', title: 'Bakery orders (Excel)', licence: 'MIT', note: 'The same orders with typed dates and a formula, plus a price sheet.' },
], null, 1) + '\n');
console.log(`samples/data: bakery-orders.csv ${csv.length} bytes, bakery-orders.xlsx ${xlsx.bytes.length} bytes, total CHF ${total.toFixed(2)}`);
