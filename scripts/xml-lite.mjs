// Minimal, dependency-free XML tree parser and helpers for the well-formed legal-text exports this repo converts
// (Fedlex Akoma Ntoso, gesetze-im-internet gii-norm). NOT a general XML parser: it assumes well-formed input with no
// DTD or CDATA and double-quoted attributes, and it strips namespace prefixes. Good enough for official law XML.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const decodeEntities = (s) => s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m));

export function parseXml(xml) {
  xml = xml.replace(/^﻿/, '').replace(/<\?xml[^>]*\?>/g, '').replace(/<!DOCTYPE[^>]*>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  let i = 0;
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  while (i < xml.length) {
    if (xml[i] === '<') {
      const close = xml[i + 1] === '/';
      const end = xml.indexOf('>', i);
      if (end === -1) break;
      let tagText = xml.slice(i + 1 + (close ? 1 : 0), end).trim();
      const selfClose = tagText.endsWith('/');
      if (selfClose) tagText = tagText.slice(0, -1).trim();
      const sp = tagText.search(/\s/);
      const name = (sp === -1 ? tagText : tagText.slice(0, sp)).replace(/^[a-zA-Z0-9]+:/, '');
      if (close) { if (stack.length > 1) stack.pop(); }
      else {
        const node = { tag: name, attrs: {}, children: [] };
        if (sp !== -1) for (const m of tagText.slice(sp).matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) node.attrs[m[1].replace(/^[a-zA-Z0-9]+:/, '')] = decodeEntities(m[2]);
        stack[stack.length - 1].children.push(node);
        if (!selfClose) stack.push(node);
      }
      i = end + 1;
    } else {
      const next = xml.indexOf('<', i);
      const text = xml.slice(i, next === -1 ? xml.length : next);
      if (text) stack[stack.length - 1].children.push({ text: decodeEntities(text) });
      i = next === -1 ? xml.length : next;
    }
  }
  return root;
}

export const find = (node, tag) => node.children?.find((c) => c.tag === tag);
export const findAll = (node, tag) => node.children?.filter((c) => c.tag === tag) || [];

/** Collapsed text of a node: descendant text joined, tags in `skip` pruned, `<br>`/`<BR>` turned into a space. */
export function textOf(node, { skip = [] } = {}) {
  let out = '';
  const walk = (n) => {
    if (n.text != null) { out += n.text; return; }
    if (skip.includes(n.tag)) return;
    if (n.tag.toLowerCase() === 'br') { out += ' '; return; }
    for (const c of n.children || []) walk(c);
  };
  for (const c of node.children || []) walk(c);
  return out.replace(/\s+/g, ' ').trim();
}
