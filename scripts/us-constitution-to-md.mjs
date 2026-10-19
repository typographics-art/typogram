#!/usr/bin/env node
// Convert the National Archives "transcript" of the US Constitution into clean, structured Markdown: a Preamble,
// Article 1–7 (with their Sections) and Amendment 1–27. The Archives transcript is a faithful, accurate text (the
// govinfo pocket-edition PDF extraction had errors and interleaved editorial matter), published as clean HTML with
// `<h2>Article. N.` / `<h3>Section. M.` / `<h3>Amendment N` headings. Three pages make up the whole:
//   constitution-transcript (Preamble + Articles), bill-of-rights-transcript (Amend. 1–10), amendments-11-27 (11–27).
//
//   node scripts/us-constitution-to-md.mjs <cache-dir> <out.md> [<out.index.json>]
//   (expects us-constitution.html, us-bor.html, us-amend-11-27.html in <cache-dir>)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fontSafe } from '../src/font-safe.js';

const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100 };
const roman = (s) => { let n = 0; s = s.toUpperCase(); for (let i = 0; i < s.length; i++) { const v = ROMAN[s[i]]; if (v) n += v < (ROMAN[s[i + 1]] || 0) ? -v : v; } return n; };

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', sect: '§', deg: '°' };
const decode = (s) => s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (NAMED[e] ?? m));
const strip = (html) => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// Walk a page's headings and paragraphs in document order. onHeading(level, text); onPara(text, cls).
function walk(html, onHeading, onPara) {
  // Drop scripts/styles so their contents never leak as text.
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>|<p([^>]*)>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) onHeading(+m[1], strip(m[2]));
    else onPara(strip(m[4]), /class="[^"]*\bsmaller\b[^"]*"/i.test(m[3] || ''));
  }
}

const out = ['# The Constitution of the United States', ''];
const index = [];
// Editorial matter the Archives pages add around the enacted text (annotations, the display-copy note, the ratification
// lines not already in <p class="smaller">). No enacted article/amendment paragraph starts this way.
const EDITORIAL = /^(Note:|Passed by Congress\b|Ratified\b|The document on permanent display|All four pages of the document|The Preamble to The Bill of Rights)/i;
// The site footer/navigation trails the enacted text (after the signatures) on every page; once it starts, nothing
// after it on that page is content, so capture halts there.
const FOOTER = /^(Shop the National Archives|NationalArchivesStore|This page was last reviewed|For biographies of the non-signing|The U\.S\. National Archives|Back to )/i;
// A paragraph that is only a bare heading label (an "on this page" outline item), with no sentence, is navigation.
const NAV = /^(AMENDMENT\s+[IVXL]+|Section\s+\d+\.?|Article\s+[IVXL]+\.?)$/i;

// ---- Preamble + Articles + Sections (main transcript) ----
{
  const html = readFileSync(join(process.argv[2], 'us-constitution.html'), 'utf8');
  let mode = 'pre', curArticle = null, started = false, pre = [], stopped = false;
  walk(html, (lvl, text) => {
    if (stopped) return;
    if (FOOTER.test(text)) { stopped = true; return; }
    let mm;
    if ((mm = /^Article\.?\s*([IVXL]+)\.?$/i.exec(text))) {
      started = true; const n = roman(mm[1]); curArticle = n; mode = 'art';
      index.push({ id: `article-${n}`, num: `Article ${n}`, heading: '', path: [] });
      out.push(`## Article ${n}`, '');
    } else if (started && (mm = /^Section\.?\s*(\d+)\.?$/i.exec(text))) {
      const sn = mm[1];
      out.push(`### Section ${sn}`, '');
      if (curArticle) index.push({ id: `article-${curArticle}-section-${sn}`, num: `Section ${sn}`, heading: '', path: [`Article ${curArticle}`] });
    }
  }, (text, smaller) => {
    if (stopped || !text || smaller || EDITORIAL.test(text) || NAV.test(text)) return;
    if (FOOTER.test(text)) { stopped = true; return; }
    if (!started) { if (/^We the People/i.test(text) || pre.length) pre.push(text); }   // preamble sits before Article I
    else out.push(text, '');
  });
  if (pre.length) out.splice(2, 0, '## Preamble', '', ...pre.flatMap((p) => [p, '']));
}

// ---- Amendments ----
function amendments(file, pattern) {
  const html = readFileSync(join(process.argv[2], file), 'utf8');
  let cur = 0, stopped = false;
  walk(html, (lvl, text) => {
    if (stopped) return;
    if (FOOTER.test(text)) { stopped = true; return; }
    const mm = pattern.exec(text);
    if (mm) { const n = roman(mm[1]); cur = n; index.push({ id: `amendment-${n}`, num: `Amendment ${n}`, heading: '', path: [] }); out.push(`## Amendment ${n}`, ''); }
  }, (text, smaller) => {
    if (stopped || !cur || !text || smaller || EDITORIAL.test(text) || NAV.test(text)) return;
    if (FOOTER.test(text)) { stopped = true; return; }
    out.push(text, '');
  });
}
amendments('us-bor.html', /^Amendment\s+([IVXL]+)$/i);                 // 1–10
amendments('us-amend-11-27.html', /^Amendment\s+([IVXL]+)$/i);         // 11–27 (heading text "AMENDMENT XI")

const md = fontSafe(out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n');
writeFileSync(process.argv[3], md);
if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify(index, null, 2));
const arts = index.filter((x) => /^article-\d+$/.test(x.id)).length;
const secs = index.filter((x) => x.id.includes('section')).length;
const amds = index.filter((x) => x.id.startsWith('amendment')).length;
console.error(`${process.argv[3]}: ${md.length.toLocaleString('en-US')} chars, ${arts} articles, ${secs} sections, ${amds} amendments`);
