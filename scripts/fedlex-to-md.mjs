#!/usr/bin/env node
// Convert a Fedlex Akoma Ntoso XML (Swiss federal law, e.g. SR 101 Bundesverfassung) into clean, structured
// Markdown — one `### Art. N — Heading` per article with numbered paragraphs, under the law's title/chapter/section
// hierarchy — plus a machine-readable article index (id, num, heading, the heading path above it).
//
//   node scripts/fedlex-to-md.mjs <in.akn.xml> <out.md> [<out.index.json>]
//
// The Markdown is the authoritative source set on the one-pager (so `tg verify` holds: page text == source). The
// index rides in the data layer (JSON-LD hasPart) so a machine can address a single article precisely. Footnotes
// (authorialNote) and cross-reference markup are dropped; the body text and paragraph numbers are kept verbatim.
import { readFileSync, writeFileSync } from 'node:fs';

const AKN = 'http://docs.oasis-open.org/legaldocml/ns/akn/3.0';

// --- a minimal, dependency-free XML tree parser (the AKN export is well-formed, no DTD/CDATA) ---
function parseXml(xml) {
  xml = xml.replace(/^﻿/, '').replace(/<\?xml[^>]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  let i = 0;
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const decode = (s) => s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m));
  while (i < xml.length) {
    if (xml[i] === '<') {
      const close = xml[i + 1] === '/';
      const end = xml.indexOf('>', i);
      let tagText = xml.slice(i + 1 + (close ? 1 : 0), end).trim();
      const selfClose = tagText.endsWith('/');
      if (selfClose) tagText = tagText.slice(0, -1).trim();
      const sp = tagText.search(/\s/);
      const name = (sp === -1 ? tagText : tagText.slice(0, sp)).replace(/^[a-zA-Z0-9]+:/, '');
      if (close) { stack.pop(); }
      else {
        const node = { tag: name, attrs: {}, children: [] };
        if (sp !== -1) for (const m of tagText.slice(sp).matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) node.attrs[m[1].replace(/^[a-zA-Z0-9]+:/, '')] = decode(m[2]);
        stack[stack.length - 1].children.push(node);
        if (!selfClose) stack.push(node);
      }
      i = end + 1;
    } else {
      const next = xml.indexOf('<', i);
      const text = xml.slice(i, next === -1 ? xml.length : next);
      if (text) stack[stack.length - 1].children.push({ text: decode(text) });
      i = next === -1 ? xml.length : next;
    }
  }
  return root;
}

const find = (node, tag) => node.children?.find((c) => c.tag === tag);
const findAll = (node, tag) => node.children?.filter((c) => c.tag === tag) || [];

// Inline text of a node: concatenate descendant text, drop footnotes, turn <br/> into a space, collapse whitespace.
function inlineText(node) {
  let out = '';
  const walk = (n) => {
    if (n.text != null) { out += n.text; return; }
    if (n.tag === 'authorialNote') return;      // footnotes: not part of the enacted text
    if (n.tag === 'br') { out += ' '; return; }
    for (const c of n.children || []) walk(c);
  };
  for (const c of node.children || []) walk(c);
  return out.replace(/\s+/g, ' ').trim();
}

// Paragraph numbers as "(n) " — font-safe, and keeping the bis/ter/quater suffixes (plain ASCII letters Roboto Flex
// has). Only exotic characters are dropped, so "3bis"/"3ter"/"3quater" stay distinct instead of all collapsing to "3".
const paraMark = (num) => { const n = String(num || '').replace(/[^0-9a-zA-Z]/g, ''); return n ? `(${n}) ` : ''; };

function articleMd(art) {
  const num = inlineText(find(art, 'num') || { children: [] });          // "Art. 8"
  const heading = inlineText(find(art, 'heading') || { children: [] });  // "Rechtsgleichheit"
  const lines = [`### ${num}${heading ? ' — ' + heading : ''}`, ''];
  // A list item's own text, EXCLUDING its num and any nested list (those recurse) — so a sub-list (e.g. Art. 141
  // Abs. 1 lit. d → 1./2./3.) is not flattened into the parent line.
  const itemBody = (it) => (it.children || []).filter((c) => c.tag !== 'num' && c.tag !== 'blockList').map((c) => inlineText({ children: [c] })).join(' ').replace(/\s+/g, ' ').trim();
  const emitItem = (it, indent) => {
    const n = inlineText(find(it, 'num') || { children: [] }).trim();
    const body = itemBody(it);
    if (n || body) lines.push(`${indent}- ${n ? n + ' ' : ''}${body}`.trimEnd());
    for (const sub of findAll(it, 'blockList')) {
      const intro = find(sub, 'listIntroduction'); if (intro) { const t = inlineText(intro); if (t) lines.push(`${indent}  ${t}`); }
      for (const sit of findAll(sub, 'item')) emitItem(sit, indent + '  ');
    }
  };
  const emitContent = (content, lead = '') => {
    for (const ch of content.children || []) {
      if (ch.tag === 'p') { const t = inlineText(ch); if (t) lines.push(lead + t, ''); }
      else if (ch.tag === 'blockList') {
        // The paragraph mark goes on the list's introduction only, never on each item (which was "(1) - a. …").
        const intro = find(ch, 'listIntroduction'); if (intro) { const t = inlineText(intro); if (t) lines.push(lead + t, ''); }
        for (const it of findAll(ch, 'item')) emitItem(it, '');
        lines.push('');
      }
    }
  };
  const emitTable = (tbl) => {
    for (const tr of findAll(tbl, 'tr')) {
      const cells = [...findAll(tr, 'th'), ...findAll(tr, 'td')].map((c) => inlineText(c)).filter(Boolean);
      if (cells.length) lines.push(cells.join(' — '), '');
    }
  };
  // Walk an article body in document order. Paragraphs carry their number; a subdivision or proviso (e.g. the
  // transitional provisions of Art. 196/197, whose paragraphs are nested one level down) emits its heading and recurses.
  const emitBody = (node) => {
    for (const ch of node.children || []) {
      if (ch.tag === 'num' || ch.tag === 'heading' || ch.tag === 'authorialNote') continue;
      if (ch.tag === 'paragraph') emitContent(find(ch, 'content') || { children: [] }, paraMark(inlineText(find(ch, 'num') || { children: [] })));
      else if (ch.tag === 'content') emitContent(ch);
      else if (ch.tag === 'subdivision' || ch.tag === 'proviso') {
        const label = [inlineText(find(ch, 'num') || { children: [] }), inlineText(find(ch, 'heading') || { children: [] })].filter(Boolean).join(' ');
        if (label) lines.push(`**${label}**`, '');
        emitBody(ch);
      } else if (ch.tag === 'p') { const t = inlineText(ch); if (t) lines.push(t, ''); }
      else if (ch.tag === 'blockList') emitContent({ children: [ch] });
      else if (ch.tag === 'table') emitTable(ch);
    }
  };
  emitBody(art);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

const HIER = new Set(['title', 'chapter', 'section', 'subdivision', 'part', 'level', 'book']);

function convert(xmlPath) {
  const root = parseXml(readFileSync(xmlPath, 'utf8'));
  const akn = find(root, 'akomaNtoso'), act = find(akn, 'act');
  const meta = find(act, 'meta');
  // Title from FRBRname (de)
  let title = 'Bundesverfassung der Schweizerischen Eidgenossenschaft';
  const ident = find(meta, 'identification'); const work = ident && find(ident, 'FRBRWork');
  if (work) for (const n of findAll(work, 'FRBRname')) if ((n.attrs.lang === 'de' || !n.attrs.lang) && n.attrs.value) { title = n.attrs.value; break; }
  const body = find(act, 'body');
  const out = [`# ${title}`, ''];
  const index = [];

  const preamble = find(act, 'preamble');
  if (preamble) { // Präambel: keep the enacted preamble paragraphs
    const pts = []; const walk = (n) => { if (n.tag === 'authorialNote') return; if (n.tag === 'p') { const t = inlineText(n); if (t) pts.push(t); } (n.children || []).forEach(walk); };
    walk(preamble);
    if (pts.length) { out.push('## Präambel', '', ...pts.flatMap((p) => [p, '']));  }
  }

  const walk = (node, path, depth) => {
    for (const child of node.children || []) {
      if (child.tag === 'article') {
        const id = (child.attrs.eId || '').replace(/_/g, '-'); // art_8 → art-8
        const num = inlineText(find(child, 'num') || { children: [] });
        const heading = inlineText(find(child, 'heading') || { children: [] });
        index.push({ id, num, heading, path: [...path] });
        out.push(articleMd(child), '');
      } else if (HIER.has(child.tag)) {
        const num = inlineText(find(child, 'num') || { children: [] }).replace(/:\s*$/, '');
        const heading = inlineText(find(child, 'heading') || { children: [] });
        if (heading === 'Sachverzeichnis') continue; // the alphabetical subject index is a navigation aid, not enacted text
        const label = [num, heading].filter(Boolean).join(': ');
        if (label) { out.push(`${'#'.repeat(Math.min(6, depth))} ${label}`, ''); }
        walk(child, label ? [...path, label] : path, depth + 1);
      } else {
        walk(child, path, depth);
      }
    }
  };
  walk(body, [], 2);

  // Normalise exotic hyphens/invisibles the Fedlex XML carries to glyphs Roboto Flex has (else they fall back):
  // non-breaking/plain hyphen U+2011/2010 → "-", soft hyphen U+00AD removed, narrow/no-break spaces → a space.
  const md = out.join('\n').replace(/\n{3,}/g, '\n\n').trim().replace(/[‐‑]/g, '-').replace(/­/g, '').replace(/[   ]/g, ' ') + '\n';
  return { title, md, index };
}

const [, , inPath, outPath, indexPath] = process.argv;
if (!inPath || !outPath) { console.error('usage: node scripts/fedlex-to-md.mjs <in.akn.xml> <out.md> [<out.index.json>]'); process.exit(1); }
const { title, md, index } = convert(inPath);
writeFileSync(outPath, md);
if (indexPath) writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.error(`${outPath}: ${md.length.toLocaleString('en-US')} chars, ${index.length} articles — "${title}"`);
