// Structure of a source document, for the Read and Machine views: the same text a work is set from, split
// into sections with stable IDs and into paragraphs, so people can navigate it and machines can cite a part.
//
// This runs on the SOURCE text, which still has its line breaks. The finished work keeps the text 1:1 in
// reading order but normalises whitespace to single spaces (see normalizeText), so paragraph and heading
// boundaries live in the source, not in what a machine reads back from the picture. The checksum over the
// canonical text ties the two together: canonical(source) === canonical(read-back of the work).

const HEADING = [
  // Markdown ATX headings: the number of '#' is the level.
  // (a function, not /^(#{1,6})\s+(.+?)\s*#*$/: that expression took quadratic time on a heading with a long run of spaces inside)
  { match: (t) => { const m = /^(#{1,6})\s+/.exec(t); if (!m) return null; const body = t.slice(m[0].length); let k = body.length; while (k > 0 && body[k - 1] === '#') k--; while (k > 0 && /\s/.test(body[k - 1])) k--; return body ? [t, m[1], body.slice(0, Math.max(1, k))] : null; }, level: (m) => m[1].length, title: (m) => m[2] },
  // "CHAPTER 1. Loomings." / "Chapter 12" — books.
  { re: /^(chapter\s+[0-9ivxlc]+\b\.?)\s*(.*)$/i, level: () => 2, title: (m) => (m[2] ? `${m[1]} ${m[2]}` : m[1]) },
  // "Art. 5" / "Article 12" / "Section 3" / "§ 4" — laws and policies.
  { re: /^((?:art\.?|article|section|§)\s*[0-9]+[a-z]?\b\.?)\s*(.*)$/i, level: () => 2, title: (m) => (m[2] ? `${m[1]} ${m[2]}` : m[1]) },
  // A short ALL-CAPS line on its own (ETYMOLOGY., CONTENTS) — a heading, not a sentence.
  { re: /^([A-Z][A-Z0-9 .,'’:\-]{2,60})$/, level: () => 2, title: (m) => m[1], extra: (m) => m[1].replace(/[^A-Za-z]/g, '').length >= 3 },
];

const slug = (s) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'section';

function headingOf(line) {
  const t = line.trim();
  if (!t) return null;
  for (const h of HEADING) {
    const m = h.match ? h.match(t) : t.match(h.re);
    if (m && (!h.extra || h.extra(m))) return { level: h.level(m), title: h.title(m).trim() };
  }
  return null;
}

/**
 * Splits source text into sections (by detected headings) and paragraphs (by blank lines). IDs are unique
 * slugs of the heading, so a passage keeps the same anchor across versions as long as the heading is the same.
 * @returns {{ sections: {id,level,title,paragraphs:string[],text:string}[], paragraphs: number, headings: number }}
 */
export function structuredText(source) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const sections = [];
  const seen = new Map();
  let cur = { id: 'start', level: 1, title: '', lines: [] };
  const push = () => { if (cur.lines.length || cur.title) sections.push(cur); };
  for (const line of lines) {
    const h = headingOf(line);
    if (h) {
      push();
      let id = slug(h.title), n = seen.get(id) || 0;
      seen.set(id, n + 1);
      if (n) id = `${id}-${n + 1}`;
      cur = { id, level: h.level, title: h.title, lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  push();
  let paragraphs = 0;
  const out = sections.map((s) => {
    const paras = s.lines.join('\n').split(/\n[ \t]*\n+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
    paragraphs += paras.length;
    return { id: s.id, level: s.level, title: s.title, paragraphs: paras, text: paras.join('\n\n') };
  }).filter((s) => s.title || s.paragraphs.length);
  return { sections: out, paragraphs, headings: out.filter((s) => s.title).length };
}

/** SHA-256 of a string, as lowercase hex (Web Crypto; Node 20+ and browsers). */
export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
}
