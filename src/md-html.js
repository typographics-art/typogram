// Renders the data-layer Markdown of a Typogram to real HTML (true h1–h6, p, table, pre/code, ul/ol, blockquote), using the
// project's own Markdown reader (src/structured-md.js) — no new dependency. This is the DATA view of the HTML Typogram: the
// article a person and a machine both read, next to the picture. It is CSP-safe: everything is escaped, raw HTML blocks are
// shown as text (never injected), and link/image URLs are restricted to safe schemes, so hostile source cannot run anything.
import { readMarkdown } from './structured-md.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const ALIGN = { l: 'left', r: 'right', c: 'center' };

// A URL is kept only if it is relative or uses a safe scheme. Browsers strip C0 controls and whitespace before resolving a
// scheme (so "\x01javascript:…" runs on click), so strip those first, then allow only safe schemes or relative URLs.
const cleanUrl = (u) => String(u).replace(/[\u0000- \u007f]/g, '');
const hasScheme = (s) => /^[a-z][a-z0-9+.\-]*:/i.test(s);
function linkUrl(u) { const s = cleanUrl(u); return !hasScheme(s) ? s : (/^(https?|mailto):/i.test(s) ? s : '#'); }
function imgUrl(u) { const s = cleanUrl(u); return !hasScheme(s) ? s : (/^(https?|data):/i.test(s) ? s : ''); }

/** Inline Markdown as safe HTML. Links, images and code spans are parked as opaque tokens BEFORE escaping, so the emphasis
 *  passes can never rewrite generated markup, and every attribute value is escaped (including ' ). */
function inline(s) {
  const toks = [];
  const park = (html) => { toks.push(html); return `\u0000${toks.length - 1}\u0000`; };
  let t = String(s);
  t = t.replace(/`([^`]+)`/g, (_, c) => park(`<code>${esc(c)}</code>`));
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^)]*)?\)/g, (_, alt, url) => { const u = imgUrl(url); return park(u ? `<img src="${esc(u)}" alt="${esc(alt)}">` : esc(alt)); });
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^)]*)?\)/g, (_, text, url) => park(`<a href="${esc(linkUrl(url))}">${esc(text)}</a>`));
  t = esc(t);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*(?!\s)([^*]+?)\*/g, '$1<em>$2</em>').replace(/(^|[^_\w])_(?!\s)([^_]+?)_/g, '$1<em>$2</em>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => toks[Number(i)]);
}

function item(blocks) { // a tight single-paragraph list item renders inline, without a wrapping <p>
  return blocks.length === 1 && blocks[0].t === 'p' ? inline(blocks[0].x) : renderBlocks(blocks);
}

function table(b) {
  const cell = (tag, c, i) => `<${tag}${b.align[i] ? ` style="text-align:${ALIGN[b.align[i]]}"` : ''}>${inline(c)}</${tag}>`;
  const head = `<tr>${b.head.map((c, i) => cell('th', c, i)).join('')}</tr>`;
  const rows = b.rows.map((r) => `<tr>${r.map((c, i) => cell('td', c, i)).join('')}</tr>`).join('');
  return `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}

function renderBlocks(blocks) {
  let out = '';
  for (const b of blocks) {
    switch (b.t) {
      case 'h': { const l = Math.min(6, Math.max(1, b.l)); out += `<h${l}>${inline(b.x)}</h${l}>`; break; }
      case 'p': out += `<p>${inline(b.x)}</p>`; break;
      case 'hr': out += '<hr>'; break;
      case 'code': out += `<pre><code${b.lang ? ` class="language-${esc(b.lang)}"` : ''}>${esc(b.x)}</code></pre>`; break;
      case 'quote': out += `<blockquote>${renderBlocks(b.b)}</blockquote>`; break;
      case 'html': out += `<pre class="rawhtml">${esc(b.x)}</pre>`; break; // raw HTML in the source is shown as text, never injected
      case 'table': out += table(b); break;
      case 'ul': out += `<ul>${b.items.map((it) => `<li>${item(it)}</li>`).join('')}</ul>`; break;
      case 'ol': out += `<ol${b.start && b.start !== 1 ? ` start="${b.start}"` : ''}>${b.items.map((it) => `<li>${item(it)}</li>`).join('')}</ol>`; break;
      default: break;
    }
  }
  return out;
}

/** The data-layer Markdown as safe HTML blocks. Front matter, if any, is shown verbatim in a <pre>. */
export function markdownToHtml(md) {
  if (!md) return '';
  try {
    const { data } = readMarkdown(String(md));
    const front = data.front ? `<pre class="front">${esc(data.front)}</pre>` : '';
    return front + renderBlocks(data.blocks || []);
  } catch {
    return `<pre>${esc(md)}</pre>`;
  }
}
