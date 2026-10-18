// Markdown as a structured document model instead of raw text (docs/structured-data.md §Markdown).
//
// The reader understands a documented subset of CommonMark/GFM block structure: ATX and setext headings, paragraphs,
// bullet and ordered lists (nested, tight or loose), block quotes, fenced and indented code, thematic breaks, GFM
// tables, HTML blocks, and a leading --- front matter block (kept verbatim as text). Inline markup (emphasis, links,
// code spans, images) stays as written inside the text of a block, so no inline information is lost; what is
// normalised is the block syntax: bullets become "-", setext headings become "#", indented code becomes a fence,
// table columns are re-aligned. The model is exact: write(read(x)) reads back to the same model (a fixpoint).
import { TgdError } from './structured-json.js';
import { textOf } from './structured-model.js';

const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
/**
 * An ATX heading line, as the regular expression /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/ matched it (same
 * `exec` result: [line, hashes, content], content undefined for a bare "###"; `test` too), in linear time: that
 * expression took quadratic time on "# a" followed by a long run of spaces (80 000 spaces: 6 seconds, 1 MB: many minutes).
 */
const ATX = {
  head: /^ {0,3}(#{1,6})(?=[ \t]|$)/,
  exec(l) {
    const m = this.head.exec(l);
    if (!m || /[\n\r\u2028\u2029]/.test(l)) return null; // what `.` cannot match
    const rest = l.slice(m[0].length);
    if (rest === '') return [l, m[1], undefined];
    const blank = (c) => c === ' ' || c === '\t';
    let a = 0;
    while (a < rest.length && blank(rest[a])) a++;
    const body = rest.slice(a);
    let end = body.length;
    while (end > 0 && blank(body[end - 1])) end--;
    let h = end;
    while (h > 0 && body[h - 1] === '#') h--;
    let k = end;
    if (h < end && h > 0 && blank(body[h - 1])) { k = h; while (k > 0 && blank(body[k - 1])) k--; } // the optional closing sequence
    return [l, m[1], body.slice(0, k)];
  },
  test(l) { return this.exec(l) !== null; },
};
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BULLET = /^( {0,3})([-+*])([ \t]+|$)/;
const ORDERED = /^( {0,3})(\d{1,9})([.)])([ \t]+|$)/;
const HTML_START = /^ {0,3}(?:<!--|<\/?(?:address|article|aside|blockquote|body|center|dd|details|div|dl|dt|fieldset|figure|footer|form|h[1-6]|header|hr|html|li|main|nav|ol|p|pre|section|summary|table|tbody|td|th|thead|tr|ul|script|style)(?:[\s/>]|$))/i;
const TABLE_SEP = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

const expandTabs = (l) => { let col = 0, out = ''; for (const ch of l) { if (ch === '\t') { const n = 4 - (col % 4); out += ' '.repeat(n); col += n; } else { out += ch; col++; } } return out; };
const indentOf = (l) => /^ */.exec(l)[0].length;
const isBlank = (l) => /^[ \t]*$/.test(l);
/** `s.replace(/[ \t]+$/, '')` in linear time (the regular expression took quadratic time on a long run of spaces followed by a letter). */
const trimEndBlank = (s) => { let e = s.length; while (e > 0 && (s[e - 1] === ' ' || s[e - 1] === '\t')) e--; return s.slice(0, e); };

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; } else if (s[i] === '|') { cells.push(cur.trim()); cur = ''; } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

function startsBlock(l, next, inParagraph) {
  if (FENCE.test(l) || ATX.test(l) || HR.test(l) || /^ {0,3}>/.test(l) || HTML_START.test(l)) return true;
  const b = BULLET.exec(l), o = ORDERED.exec(l);
  if (b && (!inParagraph || l.slice(b[0].length).trim() !== '')) return true;
  if (o && (!inParagraph || (o[2] === '1' && l.slice(o[0].length).trim() !== ''))) return true;
  return !!(l.includes('|') && next !== undefined && TABLE_SEP.test(next) && splitRow(l).length === splitRow(next).length);
}

/** True if a blank line separates two things in the item (blank lines inside a fenced code block do not count). */
function blankOutsideFence(body) {
  let fence = null;
  for (const l of body) {
    const m = FENCE.exec(l);
    if (fence) { if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`).test(l)) fence = null; continue; }
    if (m) { fence = m[2]; continue; }
    if (l === '') return true;
  }
  return false;
}

export function parseBlocks(lines, depth = 0, limits = {}) {
  if (depth > (limits.maxDepth ?? 32)) throw new TgdError('limit', 'Markdown nesting is too deep');
  const blocks = [];
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const l = lines[i];
    if (isBlank(l)) { i++; continue; }
    let m;
    if ((m = FENCE.exec(l))) {
      const fence = m[2], ind = m[1].length, body = [];
      i++;
      while (i < n && !(new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`).test(lines[i]))) { body.push(lines[i].replace(new RegExp(`^ {0,${ind}}`), '')); i++; }
      i++;
      blocks.push({ t: 'code', ...(m[3] ? { lang: m[3] } : {}), x: body.join('\n') });
      continue;
    }
    if ((m = ATX.exec(l))) { blocks.push({ t: 'h', l: m[1].length, x: (m[2] || '').trim() }); i++; continue; }
    if (HR.test(l)) { blocks.push({ t: 'hr' }); i++; continue; }
    if (/^ {0,3}>/.test(l)) {
      const inner = [];
      while (i < n && !isBlank(lines[i])) {
        if (/^ {0,3}>/.test(lines[i])) inner.push(lines[i].replace(/^ {0,3}> ?/, ''));
        else if (inner.length && !isBlank(inner.at(-1)) && !startsBlock(lines[i], lines[i + 1], true)) inner.push(lines[i]); // lazy continuation
        else break;
        i++;
      }
      blocks.push({ t: 'quote', b: parseBlocks(inner, depth + 1, limits) });
      continue;
    }
    const bm = BULLET.exec(l), om = ORDERED.exec(l);
    if ((bm || om) && !HR.test(l)) {
      const ordered = !!om, marker = om ? om[3] : bm[2];
      const items = [];
      let tight = true, start = om ? Number(om[2]) : 1, sawBlank = false;
      while (i < n) {
        const mm = ordered ? ORDERED.exec(lines[i]) : BULLET.exec(lines[i]);
        if (!mm || (ordered ? mm[3] : mm[2]) !== marker || HR.test(lines[i])) break;
        const markerEnd = mm[1].length + (ordered ? mm[2].length + 1 : 1);
        const rest = lines[i].slice(mm[0].length);
        const contentIndent = rest === '' || mm[0].length - markerEnd > 4 ? markerEnd + 1 : mm[0].length;
        const first = lines[i].slice(Math.min(contentIndent, lines[i].length));
        const body = [first.length ? first : ''];
        i++;
        let blankBefore = false;
        while (i < n) {
          const nl = lines[i];
          if (isBlank(nl)) { body.push(''); i++; blankBefore = true; continue; }
          if (indentOf(nl) >= contentIndent) { body.push(nl.slice(contentIndent)); i++; blankBefore = false; continue; }
          if (!blankBefore && !BULLET.test(nl) && !ORDERED.test(nl) && !startsBlock(nl, lines[i + 1], true) && body.some((b) => b !== '') && !isBlank(body.at(-1))) { body.push(nl.trimStart()); i++; continue; } // lazy continuation
          break;
        }
        let trailingBlank = 0;
        while (body.length && body.at(-1) === '') { body.pop(); trailingBlank++; }
        if (blankOutsideFence(body)) tight = false;
        if (trailingBlank && i < n && (ordered ? ORDERED.exec(lines[i]) : BULLET.exec(lines[i])) && (ordered ? ORDERED.exec(lines[i])[3] : BULLET.exec(lines[i])[2]) === marker) sawBlank = true;
        items.push(parseBlocks(body, depth + 1, limits));
      }
      if (sawBlank) tight = false;
      blocks.push({ t: ordered ? 'ol' : 'ul', ...(ordered && start !== 1 ? { start } : {}), ...(tight ? {} : { tight: false }), items });
      continue;
    }
    if (l.includes('|') && i + 1 < n && TABLE_SEP.test(lines[i + 1]) && splitRow(l).length === splitRow(lines[i + 1]).length) {
      const head = splitRow(l);
      const align = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'c' : /^:-+$/.test(c) ? 'l' : /^-+:$/.test(c) ? 'r' : null));
      i += 2;
      const rows = [];
      while (i < n && !isBlank(lines[i]) && !startsBlock(lines[i], lines[i + 1], false)) {
        const r = splitRow(lines[i]);
        while (r.length < head.length) r.push('');
        rows.push(r.slice(0, head.length)); i++;
      }
      blocks.push({ t: 'table', align, head, rows });
      continue;
    }
    if (HTML_START.test(l)) {
      const body = [];
      const comment = /^ {0,3}<!--/.test(l);
      while (i < n && (comment ? !body.join('\n').includes('-->') : !isBlank(lines[i]))) { body.push(lines[i]); i++; }
      blocks.push({ t: 'html', x: body.join('\n') });
      continue;
    }
    if (indentOf(l) >= 4) {
      const body = [];
      while (i < n && (indentOf(lines[i]) >= 4 || isBlank(lines[i]))) { body.push(lines[i].slice(4)); i++; }
      while (body.length && body.at(-1).trim() === '') body.pop();
      blocks.push({ t: 'code', x: body.join('\n') });
      continue;
    }
    // paragraph (possibly a setext heading)
    const para = [];
    while (i < n && !isBlank(lines[i])) {
      if (para.length && /^ {0,3}(=+|-+)[ \t]*$/.test(lines[i])) {
        blocks.push({ t: 'h', l: lines[i].trim()[0] === '=' ? 1 : 2, x: para.map((p) => p.trim()).join(' ') });
        i++; para.length = 0; break;
      }
      if (para.length && startsBlock(lines[i], lines[i + 1], true)) break;
      para.push(lines[i].replace(/^[ \t]+/, '')); i++;
    }
    if (para.length) { para[para.length - 1] = trimEndBlank(para.at(-1)); blocks.push({ t: 'p', x: para.join('\n') }); }
  }
  return blocks;
}

export function readMarkdown(bytes, { limits } = {}) {
  let text = textOf(bytes).replace(/\r\n?/g, '\n');
  let front;
  const fm = /^---[ \t]*\n([\s\S]*?\n)?---[ \t]*(?:\n|$)/.exec(text);
  if (fm) { front = (fm[1] || '').replace(/\n$/, ''); text = text.slice(fm[0].length); }
  const blocks = parseBlocks(text.split('\n').map(expandTabs), 0, limits);
  return {
    data: { kind: 'markdown', ...(front !== undefined ? { front } : {}), blocks },
    lossy: ['block syntax is normalised (bullets, heading style, fences, table alignment)', 'blank-line layout between blocks', 'link reference definitions and footnotes stay as paragraph text',
      'front matter is kept as text, not interpreted', 'tabs in indentation become spaces'],
  };
}

// ---- writer -------------------------------------------------------------------------------------------------------
const fenceFor = (x, ch = '`') => { let n = 3; for (const m of x.matchAll(new RegExp(`${ch === '`' ? '`' : '~'}+`, 'g'))) n = Math.max(n, m[0].length + 1); return ch.repeat(n); };

export function writeBlocks(blocks, depth = 0, tight = false) {
  const out = [];
  let prev = null;
  for (const b of blocks) {
    const alt = prev && prev.t === b.t && (b.t === 'ul' || b.t === 'ol'); // two lists in a row stay two lists: use the other marker
    prev = b;
    switch (b.t) {
      case 'h': out.push('#'.repeat(b.l) + (b.x ? ' ' + b.x : '')); break;
      case 'p': out.push(b.x); break;
      case 'hr': out.push('---'); break;
      case 'html': out.push(b.x); break;
      case 'code': { const f = fenceFor(b.x); out.push(`${f}${b.lang || ''}\n${b.x}${b.x === '' ? '' : '\n'}${f}`.replace(/\n\n(`+|~+)$/, '\n$1')); break; }
      case 'quote': out.push(writeBlocks(b.b, depth + 1).split('\n').map((l) => (l ? '> ' + l : '>')).join('\n')); break;
      case 'table': {
        const row = (cells) => '| ' + cells.join(' | ') + ' |';
        out.push([row(b.head), row(b.align.map((a) => (a === 'c' ? ':---:' : a === 'l' ? ':---' : a === 'r' ? '---:' : '---'))), ...b.rows.map(row)].join('\n'));
        break;
      }
      case 'ul': case 'ol': {
        const loose = b.tight === false;
        const parts = b.items.map((item, k) => {
          const marker = b.t === 'ul' ? (alt ? '*' : '-') : `${(b.start ?? 1) + k}${alt ? ')' : '.'}`;
          const pad = ' '.repeat(marker.length + 1);
          const body = writeBlocks(item, depth + 1, !loose).split('\n');
          return body.map((l, j) => (j === 0 ? `${marker} ${l}` : l ? pad + l : '')).join('\n').replace(/^(-|\d+\.) $/, '$1');
        });
        out.push(parts.join(loose ? '\n\n' : '\n'));
        break;
      }
      default: throw new TgdError('shape', `Unknown Markdown block ${JSON.stringify(String(b.t))}`);
    }
  }
  // two adjacent lists or a list after a paragraph need a separator that cannot merge them: a blank line is enough here
  return out.join(tight ? '\n' : '\n\n');
}

export function writeMarkdown(block) {
  const m = block.model;
  const head = m.front !== undefined ? `---\n${m.front}${m.front === '' ? '' : '\n'}---\n\n` : '';
  return { bytes: new TextEncoder().encode(head + writeBlocks(m.blocks || []) + '\n'), name: String(block.name || 'data').replace(/\.[^.]*$/, '') + '.md', mime: 'text/markdown' };
}
