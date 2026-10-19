// Render the verified-issuer list on /keys from keys/registry.json. Progressive: the page's fetch URLs and explanation
// are in the HTML; this only fills the live issuer table. Same-origin fetch, revalidated, DOM API only (no innerHTML).
const esc = (s) => String(s == null ? '' : s);
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };

function render(reg) {
  const box = document.getElementById('issuers');
  box.replaceChildren();
  const issuers = (reg && Array.isArray(reg.issuers)) ? reg.issuers : [];
  if (!issuers.length) { box.appendChild(el('p', 'No issuers listed yet.')); return; }
  const table = el('table');
  const thead = el('thead'), htr = el('tr');
  for (const h of ['Issuer', 'Keys', 'Verified']) htr.appendChild(el('th', h));
  thead.appendChild(htr); table.appendChild(thead);
  const tbody = el('tbody');
  for (const e of issuers) {
    const tr = el('tr');
    const td1 = el('td');
    const a = el('a', esc(e.issuer)); a.href = esc(e.verifiedVia || `https://${e.issuer}/.well-known/tgart-keys.json`); a.className = 'issuer';
    td1.appendChild(a);
    const td2 = el('td');
    for (const k of (e.keys || [])) { const s = el('span', `${k.alg || 'Ed25519'}:${k.kid}`, 'kid'); s.style.marginRight = '10px'; td2.appendChild(s); }
    const td3 = el('td');
    td3.appendChild(el('span', e.verifiedAt ? `✓ ${e.verifiedAt}` : '—', e.verifiedAt ? 'v' : ''));
    tr.append(td1, td2, td3);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  box.appendChild(table);
  const note = el('p');
  note.style.color = 'var(--muted)'; note.style.fontSize = '14px';
  note.append(document.createTextNode(`Registry ${esc(reg.spec || '')}, updated ${esc(reg.updated || '')}. `));
  const raw = el('a', 'Raw JSON'); raw.href = 'keys/registry.json'; note.appendChild(raw);
  box.appendChild(note);
}

try {
  const reg = await (await fetch('keys/registry.json', { cache: 'no-cache' })).json();
  render(reg);
} catch {
  const box = document.getElementById('issuers');
  box.replaceChildren();
  const p = el('p'); p.append(document.createTextNode('Could not load the registry. Open '));
  const a = el('a', 'keys/registry.json'); a.href = 'keys/registry.json'; p.append(a, document.createTextNode(' directly.'));
  box.appendChild(p);
}
