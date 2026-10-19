// The /v page: verify a Typogram in the browser. No upload — the file is read locally and checked with Web Crypto.
// All work is in src/verify-web.js (shared, testable); this file is only the page wiring (drop/pick/URL + rendering).
import { verifyTypogram } from '../../src/verify-web.js';

const $ = (id) => document.getElementById(id);
const drop = $('drop'), fileInput = $('file'), urlInput = $('url'), goBtn = $('go');
const result = $('result'), badge = $('badge'), reason = $('reason'), detail = $('detail');

// Fetch an issuer's key file. Same-origin (this site) always works; another issuer's domain is blocked by the page's
// content-security policy (connect-src 'self'), which the UI explains rather than reporting as tampering.
async function fetchKeyfile(issuer) {
  const url = issuer === location.hostname ? '/.well-known/tgart-keys.json' : `https://${issuer}/.well-known/tgart-keys.json`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const LABEL = { VERIFIED: 'VERIFIED', UNSIGNED: 'UNSIGNED', TAMPERED: 'TAMPERED', NO_DATA: 'NOT A TYPOGRAM', ERROR: 'CANNOT CHECK', INFO: 'CANNOT FETCH KEY' };

function render(res, name) {
  // A signed work from another domain whose key we cannot fetch under this page's CSP is informational, not tampering.
  let state = res.state;
  if (res.state === 'TAMPERED' && /could not fetch the key/.test(res.reason || '') && res.issuer && res.issuer !== location.hostname) {
    state = 'INFO';
    res = { ...res, reason: `This work is signed by ${res.issuer}, whose key is on another domain — this page can only fetch keys from ${location.hostname} (content-security policy). Run \`tg verify\` to check it.` };
  }
  badge.className = 'badge ' + state;
  badge.textContent = LABEL[state] || state;
  reason.textContent = res.reason || (state === 'VERIFIED' ? `Signed by ${res.issuer}, and the picture is unchanged.` : state === 'UNSIGNED' ? 'The picture, its embedded text and the stored hash agree — but it carries no signature.' : '');
  const rows = [];
  if (name) rows.push(['file', name]);
  if (res.issuer) rows.push(['issuer', res.issuer]);
  if (res.kid) rows.push(['key id', res.kid]);
  if (res.created) rows.push(['signed', res.created]);
  if (res.hash) rows.push(['identity hash', res.hash]);
  if (res.storedHash && res.storedHash !== res.hash) rows.push(['stored hash', res.storedHash]);
  const expect = (location.hash || '').replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{64}$/.test(expect) && res.hash) rows.push(['expected hash', expect + (expect === res.hash ? ' — matches' : ' — DOES NOT MATCH')]);
  detail.replaceChildren();
  for (const [k, v] of rows) { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; detail.append(dt, dd); }
  result.classList.add('show');
}

async function check(text, name) {
  badge.className = 'badge'; badge.textContent = 'Checking…'; reason.textContent = ''; detail.replaceChildren(); result.classList.add('show');
  try { render(await verifyTypogram(text, { fetchKeyfile }), name); }
  catch (e) { render({ state: 'ERROR', reason: String(e && e.message || e) }, name); }
}

function readFile(f) {
  if (!f) return;
  const r = new FileReader();
  r.onload = () => check(String(r.result), f.name);
  r.onerror = () => render({ state: 'ERROR', reason: 'could not read the file' }, f.name);
  r.readAsText(f);
}

drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener('change', () => readFile(fileInput.files[0]));
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); readFile(e.dataTransfer.files[0]); });

async function verifyUrl() {
  const u = urlInput.value.trim();
  if (!u) return;
  try {
    const r = await fetch(u, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await check(await r.text(), u.split('/').pop() || u);
  } catch (e) { render({ state: 'ERROR', reason: `could not fetch ${u}: ${e && e.message || e} (only files on ${location.hostname} can be fetched here)` }, u); }
}
goBtn.addEventListener('click', verifyUrl);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyUrl(); });
