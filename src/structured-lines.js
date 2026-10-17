// iCalendar (.ics, RFC 5545) and vCard (.vcf, RFC 6350) as one model: content lines grouped in components.
//   component = { c: "VEVENT", p: [[name, value, [params]?], ...], k: [component, ...] }
// Values and parameters are kept exactly as written after unfolding (escapes such as \n and \, are not interpreted),
// so reading and writing again gives the same lines; only the folding of long lines (75 octets) is regenerated.
import { TgdError } from './structured-json.js';
import { textOf } from './structured-model.js';

const NAME = /^(?:[A-Za-z0-9-]+\.)?[A-Za-z0-9-]+$/;

function unfold(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

/** Splits "NAME;P=1;Q=\"a:b\":value" into name, params and value (quotes protect ":" ";" ","). */
function splitLine(line, n) {
  let i = 0, inQ = false;
  const parts = [];
  let start = 0, nameEnd = -1;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (!inQ && c === ';') { parts.push(line.slice(start, i)); start = i + 1; }
    else if (!inQ && c === ':') { parts.push(line.slice(start, i)); nameEnd = i; break; }
  }
  if (nameEnd < 0) throw new TgdError('syntax', `Line ${n}: no ":" in a content line`);
  const [name, ...params] = parts;
  if (!NAME.test(name)) throw new TgdError('syntax', `Line ${n}: bad property name ${JSON.stringify(name.slice(0, 30))}`);
  for (const p of params) if (!/^[A-Za-z0-9-]+=/.test(p)) throw new TgdError('syntax', `Line ${n}: bad parameter ${JSON.stringify(p.slice(0, 30))}`);
  return { name, params, value: line.slice(nameEnd + 1) };
}

export function readLines(bytes, { type = 'icalendar', limits } = {}) {
  const lines = unfold(textOf(bytes));
  const maxDepth = limits?.maxDepth ?? 16, maxLines = limits?.maxLines ?? 2_000_000;
  if (lines.length > maxLines) throw new TgdError('limit', 'Too many lines');
  const items = [], stack = [];
  lines.forEach((raw, idx) => {
    if (raw === '') return;
    const { name, params, value } = splitLine(raw, idx + 1);
    const up = name.toUpperCase();
    if (up === 'BEGIN') {
      if (stack.length >= maxDepth) throw new TgdError('limit', 'Components are nested too deeply');
      const comp = { c: value, p: [], k: [] };
      (stack.length ? stack.at(-1).k : items).push(comp);
      stack.push(comp);
    } else if (up === 'END') {
      const top = stack.pop();
      if (!top || top.c.toUpperCase() !== value.toUpperCase()) throw new TgdError('syntax', `Line ${idx + 1}: END:${value} does not match${top ? ` BEGIN:${top.c}` : ' anything'}`);
    } else {
      if (!stack.length) throw new TgdError('syntax', `Line ${idx + 1}: a property outside BEGIN \u2026 END`);
      stack.at(-1).p.push(params.length ? [name, value, params] : [name, value]);
    }
  });
  if (stack.length) throw new TgdError('syntax', `BEGIN:${stack.at(-1).c} is never closed`);
  if (!items.length) throw new TgdError('syntax', 'No BEGIN \u2026 END component found');
  const strip = (c) => { if (!c.k.length) delete c.k; else c.k.forEach(strip); };
  items.forEach(strip);
  return { data: { kind: type, items }, lossy: ['folding of long lines (written again at 75 octets)', 'blank lines'] };
}

/** Folds a content line at 75 octets without cutting a UTF-8 character. */
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0; limit = 74; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function writeLines(block) {
  const m = block.model;
  const out = [];
  const go = (c) => {
    out.push(fold(`BEGIN:${c.c}`));
    for (const [name, value, params] of c.p || []) {
      const line = name + (params?.length ? ';' + params.join(';') : '') + ':' + value;
      if (/[\r\n]/.test(line)) throw new TgdError('shape', 'A property value contains a line break; it must be written as \\n');
      out.push(fold(line));
    }
    for (const k of c.k || []) go(k);
    out.push(fold(`END:${c.c}`));
  };
  (m.items || []).forEach(go);
  const vcard = m.kind === 'vcard';
  return { bytes: new TextEncoder().encode(out.join('\r\n') + '\r\n'), name: String(block.name || 'data').replace(/\.[^.]*$/, '') + (vcard ? '.vcf' : '.ics'), mime: vcard ? 'text/vcard' : 'text/calendar' };
}
