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

function contentMd(content) {
  const lines = [];
  for (const ch of content.children || []) {
    if (ch.tag === 'P') { const t = textOf(ch); if (t) lines.push(t, ''); }
    else if (ch.tag === 'DL') {
      const kids = (ch.children || []).filter((k) => k.tag === 'DT' || k.tag === 'DD');
      for (let i = 0; i < kids.length; i++) {
        if (kids[i].tag === 'DT') {
          const dt = textOf(kids[i]); const dd = kids[i + 1]?.tag === 'DD' ? textOf(kids[i + 1]) : '';
          lines.push(`- ${[dt, dd].filter(Boolean).join(' ')}`); if (dd) i++;
        } else { const dd = textOf(kids[i]); if (dd) lines.push(`- ${dd}`); }
      }
      lines.push('');
    }
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
