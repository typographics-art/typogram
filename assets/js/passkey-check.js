// The page script of passkey-check.html (a file, not an inline block, so the site's Content-Security-Policy needs no 'unsafe-inline' for scripts).
import { prfInput, factorFromPrf, createVault, openVault } from '../../src/keys-split.js';
import { toHex } from '../../src/crypt-codec.js';

const $ = (s) => document.querySelector(s);
const MSG = {
  en: { skip: 'Skip to content', h1: 'Passkey device check',
    envh: '1. This device', mkh: '2. Create a test passkey', tsh: '3. Test it', blh: '4. The result, to copy',
    make: 'Create test passkey', test: 'Run the test', copy: 'Copy the result', more: 'Why this matters',
    credId: 'Credential ID (not a secret). To test a passkey again later, or on another device it syncs to, paste the ID here before step 3.',
    madeOk: 'Test passkey created. Credential ID filled in below. Now run step 3.', madeNoPrf: 'Test passkey created, but this device did not say that it supports the PRF extension at creation. Step 3 shows whether it does when asked.',
    needHttps: 'Passkeys need a secure page (https). Open this page from typographics-art.org.', noWebauthn: 'This browser has no passkey support (WebAuthn).',
    cancelled: 'You cancelled, or the device refused. Nothing was changed.', failed: 'The device returned an error: {e}',
    needId: 'Create a test passkey first (step 2), or paste a credential ID.', running: 'Running … confirm on your device when it asks.',
    allGood: 'This passkey works as a key factor: it returns the same 32-byte secret for the same input, another one for another input, and opened the vault.',
    prfMissing: 'This device or browser did not return a PRF secret. It cannot be used as a key factor here; use the seed backup and a passphrase instead.',
    notStable: 'The secret was NOT the same twice. Do not use this passkey as a key factor.', vaultFail: 'The vault test failed: {e}',
    copied: 'Copied.', copyFail: 'Could not copy: select the text and copy it by hand.',
    k: { secure: 'Secure page (https)', webauthn: 'Passkeys (WebAuthn) in this browser', platform: 'Built-in authenticator available (fingerprint, face, PIN)', conditional: 'Passkey autofill supported', prfCreate: 'PRF reported at creation', prfGet: 'PRF secret returned when asked', len: 'Secret length', stable: 'Same input gives the same secret', differ: 'Another input gives another secret', vaultOpen: 'Vault opens with passkey and a second factor', vaultLock: 'Vault stays closed with the passkey alone', fp: 'Fingerprint of the factor', fp2: 'Fingerprint, another input', browser: 'Browser' },
    yes: 'yes', no: 'no', unknown: 'unknown', bytes: '{n} bytes' },
  de: { skip: 'Zum Inhalt springen', h1: 'Passkey-Geräteprüfung',
    lead: 'Versiegelte Daten können einen Passkey oder Sicherheitsschlüssel als einen Faktor nutzen: Das Gerät liefert ein Geheimnis, das sich nicht erraten lässt (die WebAuthn-PRF-Erweiterung). Ob das klappt, hängt von Browser und Gerät ab. Diese Seite testet es hier, in deinem Browser. Nichts wird irgendwohin gesendet und nichts gespeichert; der Passkey, den du erstellst, bleibt auf deinem Gerät.',
    mkp: 'Dein Gerät bittet dich um eine Bestätigung (Fingerabdruck, Gesicht, PIN oder ein Tipp auf den Schlüssel). Das erzeugt einen Test-Passkey nur für diese Website; du kannst ihn danach in den Passkey-Einstellungen deines Geräts löschen.',
    tsp: 'Fragt den Passkey dreimal nach seinem Geheimnis (zweimal mit derselben Eingabe, einmal mit einer anderen) und macht einen kleinen Tresortest: ein Tresor, der sich mit diesem Passkey plus einem zweiten Faktor öffnet und mit dem Passkey allein verschlossen bleibt. Du wirst jedes Mal um Bestätigung gebeten, wenn dein Gerät sie will.',
    blp: 'Dieser Block enthält nur technische Fakten (Browser, Unterstützung, Ja/Nein-Ergebnisse, einen kurzen Fingerabdruck). Er enthält keinen Schlüssel und nichts, was dich identifiziert. Schick ihn dem Projekt, um zu sagen, was auf deinem Gerät funktioniert.',
    foot: 'Der Fingerabdruck sind die ersten 4 Byte eines SHA-256 über einen aus dem Geheimnis des Passkeys abgeleiteten Wert: Derselbe Passkey und dieselbe Eingabe ergeben jedes Mal denselben Fingerabdruck, auch auf jedem Gerät, auf das er synchronisiert wird, falls die Plattform dort dasselbe Geheimnis liefert.',
    envh: '1. Dieses Gerät', mkh: '2. Test-Passkey erstellen', tsh: '3. Testen', blh: '4. Das Ergebnis zum Kopieren',
    make: 'Test-Passkey erstellen', test: 'Test ausführen', copy: 'Ergebnis kopieren', more: 'Warum das wichtig ist',
    credId: 'Credential-ID (kein Geheimnis). Um einen Passkey später oder auf einem anderen Gerät, auf das er synchronisiert wird, noch einmal zu testen, die ID vor Schritt 3 hier einfügen.',
    madeOk: 'Test-Passkey erstellt. Die Credential-ID ist unten eingetragen. Jetzt Schritt 3 ausführen.', madeNoPrf: 'Test-Passkey erstellt, aber dieses Gerät hat bei der Erstellung nicht gemeldet, dass es die PRF-Erweiterung kann. Schritt 3 zeigt, ob es das auf Nachfrage tut.',
    needHttps: 'Passkeys brauchen eine sichere Seite (https). Öffne diese Seite von typographics-art.org.', noWebauthn: 'Dieser Browser unterstützt keine Passkeys (WebAuthn).',
    cancelled: 'Du hast abgebrochen, oder das Gerät hat abgelehnt. Es wurde nichts verändert.', failed: 'Das Gerät meldet einen Fehler: {e}',
    needId: 'Erstelle zuerst einen Test-Passkey (Schritt 2) oder füge eine Credential-ID ein.', running: 'Läuft … bestätige auf deinem Gerät, wenn es fragt.',
    allGood: 'Dieser Passkey taugt als Schlüsselfaktor: Er liefert für dieselbe Eingabe dasselbe 32-Byte-Geheimnis, für eine andere Eingabe ein anderes, und hat den Tresor geöffnet.',
    prfMissing: 'Dieses Gerät oder dieser Browser hat kein PRF-Geheimnis geliefert. Es taugt hier nicht als Schlüsselfaktor; nimm stattdessen das Seed-Backup und eine Passphrase.',
    notStable: 'Das Geheimnis war NICHT zweimal dasselbe. Nimm diesen Passkey nicht als Schlüsselfaktor.', vaultFail: 'Der Tresortest ist fehlgeschlagen: {e}',
    copied: 'Kopiert.', copyFail: 'Kopieren nicht möglich: Text markieren und von Hand kopieren.',
    k: { secure: 'Sichere Seite (https)', webauthn: 'Passkeys (WebAuthn) in diesem Browser', platform: 'Eingebauter Authenticator verfügbar (Fingerabdruck, Gesicht, PIN)', conditional: 'Passkey-Autofill unterstützt', prfCreate: 'PRF bei der Erstellung gemeldet', prfGet: 'PRF-Geheimnis auf Nachfrage geliefert', len: 'Länge des Geheimnisses', stable: 'Gleiche Eingabe gibt das gleiche Geheimnis', differ: 'Andere Eingabe gibt ein anderes Geheimnis', vaultOpen: 'Tresor öffnet sich mit Passkey und zweitem Faktor', vaultLock: 'Tresor bleibt mit dem Passkey allein zu', fp: 'Fingerabdruck des Faktors', fp2: 'Fingerabdruck, andere Eingabe', browser: 'Browser' },
    yes: 'ja', no: 'nein', unknown: 'unbekannt', bytes: '{n} Byte' },
};
let lang = 'en';
try { lang = localStorage.getItem('tg-art.lang') || ((navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en'); } catch { /* default */ }
const t = (k, v = {}) => String(MSG[lang][k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v[n]);
const yn = (v) => (v === true ? t('yes') : v === false ? t('no') : t('unknown'));
const EN_TEXT = new Map([...document.querySelectorAll('[data-i18n]')].map((el) => [el.dataset.i18n, el.textContent]));
const state = { env: {}, res: {}, id: null };

const b64u = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const sha4 = async (bytes) => toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).slice(0, 8);
const say = (el, msg, kind) => { el.hidden = false; el.textContent = msg; el.className = 'msg ' + (kind || ''); };
const errText = (e) => (e?.name === 'NotAllowedError' || e?.name === 'AbortError' ? t('cancelled') : t('failed', { e: `${e?.name || 'Error'}: ${String(e?.message || e).slice(0, 160)}` }));

function render() {
  const k = MSG[lang].k, row = (name, value, cls) => `<tr><th>${name}</th><td${cls ? ` class="${cls}"` : ''}>${value}</td></tr>`;
  const e = state.env, r = state.res;
  $('#env').innerHTML = [
    row(k.browser, (navigator.userAgent.match(/(Firefox|Edg|Chrome|Version)\/[\d.]+/g) || [navigator.userAgent]).slice(0, 2).join(' ').replace(/[<&>]/g, '')),
    row(k.secure, yn(e.secure), e.secure ? 'ok' : 'bad'), row(k.webauthn, yn(e.webauthn), e.webauthn ? 'ok' : 'bad'),
    row(k.platform, yn(e.platform)), row(k.conditional, yn(e.conditional)),
  ].join('');
  const out = [];
  if ('prfCreate' in r) out.push(row(k.prfCreate, yn(r.prfCreate)));
  if ('prfGet' in r) out.push(row(k.prfGet, yn(r.prfGet), r.prfGet ? 'ok' : 'bad'));
  if (r.len != null) out.push(row(k.len, t('bytes', { n: r.len })));
  if ('stable' in r) out.push(row(k.stable, yn(r.stable), r.stable ? 'ok' : 'bad'));
  if ('differ' in r) out.push(row(k.differ, yn(r.differ), r.differ ? 'ok' : 'bad'));
  if ('vaultOpen' in r) out.push(row(k.vaultOpen, yn(r.vaultOpen), r.vaultOpen ? 'ok' : 'bad'));
  if ('vaultLock' in r) out.push(row(k.vaultLock, yn(r.vaultLock), r.vaultLock ? 'ok' : 'bad'));
  if (r.fp) out.push(row(k.fp, `<code>${r.fp}</code>`)); if (r.fp2) out.push(row(k.fp2, `<code>${r.fp2}</code>`));
  $('#res').innerHTML = out.join('');
  $('#block').value = JSON.stringify({ tool: 'passkey-check/1', at: new Date().toISOString(), page: location.origin, userAgent: navigator.userAgent, ...state.env, ...state.res, credentialReused: !!state.reused }, null, 2);
}

async function detect() {
  const e = state.env;
  e.secure = window.isSecureContext === true;
  e.webauthn = typeof window.PublicKeyCredential === 'function' && !!navigator.credentials?.create;
  try { e.platform = e.webauthn ? await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() : false; } catch { e.platform = null; }
  try { e.conditional = e.webauthn && PublicKeyCredential.isConditionalMediationAvailable ? await PublicKeyCredential.isConditionalMediationAvailable() : false; } catch { e.conditional = null; }
  const ok = e.secure && e.webauthn;
  $('#make').disabled = !ok; $('#test').disabled = !ok;
  if (!e.secure) say($('#makeMsg'), t('needHttps'), 'bad'); else if (!e.webauthn) say($('#makeMsg'), t('noWebauthn'), 'bad');
  render();
}

async function make() {
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { id: location.hostname, name: 'Typographics Art passkey check' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'passkey-check', displayName: 'Passkey check' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      extensions: { prf: {} },
    } });
    state.id = new Uint8Array(cred.rawId);
    $('#credId').value = b64u(state.id);
    const prf = cred.getClientExtensionResults?.().prf;
    state.res.prfCreate = prf ? prf.enabled === true : null;
    say($('#makeMsg'), state.res.prfCreate ? t('madeOk') : t('madeNoPrf'), state.res.prfCreate ? 'good' : '');
  } catch (e) { say($('#makeMsg'), errText(e), 'bad'); }
  render();
}

async function run() {
  const typed = $('#credId').value.trim();
  let id = state.id;
  if (typed) { try { id = unb64u(typed); state.reused = !(state.id && b64u(state.id) === typed); } catch { id = null; } }
  if (!id) return say($('#testMsg'), t('needId'), 'bad');
  say($('#testMsg'), t('running'));
  const r = (state.res = { prfCreate: state.res.prfCreate });
  const get = async (label) => {
    const x = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id }], userVerification: 'required', extensions: { prf: { eval: { first: await prfInput(label) } } } } });
    const first = x.getClientExtensionResults?.().prf?.results?.first;
    return first ? new Uint8Array(first) : null;
  };
  try {
    const a = await get('check/a'), b = await get('check/a'), c = await get('check/b');
    r.prfGet = !!(a && b && c);
    r.len = a ? a.length : null;
    if (!r.prfGet) { say($('#testMsg'), t('prfMissing'), 'bad'); return render(); }
    r.stable = toHex(a) === toHex(b);
    r.differ = toHex(a) !== toHex(c);
    const fa = await factorFromPrf(a);
    r.fp = await sha4(fa); r.fp2 = await sha4(await factorFromPrf(c));
    if (!r.stable) { say($('#testMsg'), t('notStable'), 'bad'); return render(); }
    // a small vault: this passkey plus a random second high-entropy factor, 2 of 2
    const seedFactor = crypto.getRandomValues(new Uint8Array(32));
    const { vault, secret } = await createVault([{ name: 'seed', key: seedFactor }, { name: 'passkey', key: fa }], { k: 2, mode: 'strict' });
    const opened = await openVault(vault, { seed: { key: seedFactor }, passkey: { key: await factorFromPrf(b) } });
    r.vaultOpen = toHex(opened.secret) === toHex(secret);
    try { await openVault(vault, { passkey: { key: fa } }); r.vaultLock = false; } catch { r.vaultLock = true; }
    const good = r.prfGet && r.stable && r.differ && r.vaultOpen && r.vaultLock;
    say($('#testMsg'), good ? t('allGood') : t('vaultFail', { e: 'see the table' }), good ? 'good' : 'bad');
  } catch (e) { say($('#testMsg'), errText(e), 'bad'); }
  render();
}

function setLang(l) {
  lang = l; document.documentElement.lang = l;
  document.documentElement.dataset.ready = '1';
  document.querySelectorAll('[data-i18n]').forEach((el) => { const v = l === 'en' ? EN_TEXT.get(el.dataset.i18n) : MSG.de[el.dataset.i18n]; if (v != null) el.textContent = v; });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === l)));
  document.title = l === 'de' ? 'Passkey-Geräteprüfung – Typographics Art' : 'Passkey device check – Typographics Art';
  render();
}
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => { setLang(b.dataset.lang); try { localStorage.setItem('tg-art.lang', b.dataset.lang); } catch { /* not remembered */ } }));
$('#make').addEventListener('click', make);
$('#test').addEventListener('click', run);
$('#copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#block').value); say($('#copyMsg'), t('copied'), 'good'); } catch { say($('#copyMsg'), t('copyFail'), 'bad'); } });
window.tgPasskeyCheck = { make, run, state };
await detect();
setLang(lang);
