#!/usr/bin/env node
// Convert a gesetze-im-internet.de gii-norm XML export (German federal law, e.g. the Grundgesetz) into clean, structured
// Markdown — one `### Art. N — Heading` per article under the law's section (gliederungseinheit) hierarchy — plus a
// machine-readable article index (id, num, heading, section path). The <P> paragraphs already carry their own (n)
// markers, so they are kept verbatim. Footnotes (fussnoten) and metadata are dropped; the enacted text is kept.
//
//   node scripts/gii-to-md.mjs <in.xml> <out.md> [<out.index.json>] [--title "..."]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseXml, find, findAll, textOf } from './xml-lite.mjs';
import { fontSafe } from '../src/font-safe.js';

// Render one list item (<DD>, with its <DT> marker) by walking it in DOCUMENT ORDER: text runs become lines, a nested
// <DL> (anywhere inside, e.g. GG Art. 73 Nr. 10 → a)/b)/c), even wrapped in an <LA>) recurses one indent deeper. This
// keeps the intro text, the sub-list and any trailing text in order and separate, instead of flattening or dropping them.
function renderItem(marker, dd, indent, lines) {
  let buf = '', first = true;
  const flush = () => { const t = buf.replace(/\s+/g, ' ').trim(); if (t) { lines.push(`${indent}- ${first && marker ? marker + ' ' : ''}${t}`.trimEnd()); first = false; } buf = ''; };
  const walk = (n) => {
    if (n.text != null) { buf += n.text; return; }
    if (n.tag.toLowerCase() === 'br') { buf += ' '; return; }
    if (n.tag === 'DL') { flush(); renderDL(n, indent + '  ', lines); return; }
    for (const c of n.children || []) walk(c);
  };
  for (const c of dd.children || []) walk(c);
  flush();
  if (first && marker) lines.push(`${indent}- ${marker}`); // a marker whose item had no text of its own
}

// Render a <DL> enumeration (German law: <DT>1.</DT><DD><LA>…</LA></DD>) as Markdown list items.
function renderDL(dl, indent, lines) {
  const kids = (dl.children || []).filter((k) => k.tag === 'DT' || k.tag === 'DD');
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].tag === 'DT') {
      const dt = textOf(kids[i], { skip: ['DL'] });
      const dd = kids[i + 1]?.tag === 'DD' ? kids[i + 1] : null;
      if (dd) { renderItem(dt, dd, indent, lines); i++; } else lines.push(`${indent}- ${dt}`);
    } else renderItem('', kids[i], indent, lines);
  }
}

function contentMd(content) {
  const lines = [];
  for (const ch of content.children || []) {
    if (ch.tag === 'P') {
      // The enumeration <DL> is nested INSIDE the <P>; emit the paragraph's own text, then the list as its own lines
      // (otherwise textOf flattens "…über: 1.die…;2.die…" onto one run-on line).
      const own = textOf(ch, { skip: ['DL'] }); if (own) lines.push(own, '');
      for (const dl of findAll(ch, 'DL')) { renderDL(dl, '', lines); lines.push(''); }
    } else if (ch.tag === 'DL') { renderDL(ch, '', lines); lines.push(''); }
  }
  return lines;
}

function convert(xmlPath, title) {
  const root = parseXml(readFileSync(xmlPath, 'utf8'));
  const dok = find(root, 'dokumente') || root;
  const norms = findAll(dok, 'norm');
  const out = [`# ${title}`, ''];
  const index = [];
  let path = [];
  for (const norm of norms) {
    const md = find(norm, 'metadaten') || { children: [] };
    const enbez = textOf(find(md, 'enbez') || { children: [] });
    const titel = textOf(find(md, 'titel') || { children: [] });
    const glied = find(md, 'gliederungseinheit');
    const text = find(norm, 'textdaten') && find(find(norm, 'textdaten'), 'text');
    const content = text && find(text, 'Content');
    const body = content ? contentMd(content) : [];
    const hasBody = body.join('').trim().length > 0;
    if (/^Art\b/.test(enbez)) {
      const numPart = enbez.replace(/^Art\.?\s*/, '');
      index.push({ id: 'art-' + numPart.toLowerCase(), num: 'Art. ' + numPart, heading: titel, path: [...path] });
      out.push(`### Art. ${numPart}${titel ? ' — ' + titel : ''}`, '', ...body);
    } else if (glied) {
      const bez = textOf(find(glied, 'gliederungsbez') || { children: [] });
      const gtitel = textOf(find(glied, 'gliederungstitel') || { children: [] });
      const label = [bez, gtitel].filter(Boolean).join(' ');
      if (label) { out.push(`## ${label}`, ''); path = [label]; }
    } else if (hasBody) { // Präambel / Eingangsformel / Schlussformel
      out.push(`## ${enbez || 'Präambel'}`, '', ...body);
    }
  }
  const text = fontSafe(out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n');
  return { md: text, index };
}

const args = process.argv.slice(2);
const titleIdx = args.indexOf('--title');
const title = titleIdx !== -1 ? args[titleIdx + 1] : 'Grundgesetz für die Bundesrepublik Deutschland';
const positional = args.filter((a, i) => a !== '--title' && args[i - 1] !== '--title');
const [inPath, outPath, indexPath] = positional;
if (!inPath || !outPath) { console.error('usage: node scripts/gii-to-md.mjs <in.xml> <out.md> [<out.index.json>] [--title "..."]'); process.exit(1); }
const { md, index } = convert(inPath, title);
writeFileSync(outPath, md);
if (indexPath) writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.error(`${outPath}: ${md.length.toLocaleString('en-US')} chars, ${index.length} articles — "${title}"`);
