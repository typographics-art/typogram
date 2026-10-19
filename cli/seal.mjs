// Phase I2 — sealed Typograms (encrypted mode). A sealed work is one text in two parts: a cleartext ENVELOPE (title,
// sender, recipients, date, an optional table of contents, and the seal) followed by the PAYLOAD — the ciphertext as
// age ASCII armor. The image layer is set from both, so a person sees who it is for and that it is sealed; a machine
// recovers the armor and, with the right private key, the contents. The whole text is hashed and signed (Phase H), and
// `tg verify` checks the signature BEFORE anything is decrypted. Encryption is age (X25519) via the vendored library;
// no own crypto. This module is the format core (seal/open text); the CLI renders, signs and reads the Typogram.
import { Encrypter, Decrypter, armor } from '../vendor/age-encryption.mjs';

const PAYLOAD_RE = /-----BEGIN AGE ENCRYPTED FILE-----[\s\S]*?-----END AGE ENCRYPTED FILE-----/;

/** A recipient's display name in the envelope: "issuer:kid" when both are known, else its label. */
const recipientName = (r) => (r.issuer && r.kid ? `${r.issuer}:${r.kid}` : r.label || 'recipient');
/** What `tgart.recipients` records for a recipient: {issuer,kid} when known, else {label}. No public key is stored. */
const recipientMeta = (r) => (r.issuer && r.kid ? { issuer: r.issuer, kid: r.kid } : { label: r.label || 'recipient' });

/**
 * Build the sealed text. `recipients` are `{ publicKey, issuer, kid } | { publicKey, label }`, where publicKey is an age
 * recipient ("age1…"). Returns `{ text, mode:'sealed', recipients:[{issuer,kid}|{label}], cipher:'age-v1' }`. The caller
 * renders + signs the text.
 */
export async function sealText({ plaintext, title, sender, recipients, created = new Date().toISOString().slice(0, 10), toc }) {
  if (!recipients || !recipients.length) throw new Error('seal: at least one recipient is required');
  const enc = new Encrypter();
  for (const r of recipients) enc.addRecipient(r.publicKey);
  const armored = armor.encode(await enc.encrypt(typeof plaintext === 'string' ? new TextEncoder().encode(plaintext) : plaintext));
  const lines = [`# ${title}`, '', 'Sealed · age v1 — encrypted, open with your key.', `From: ${sender}`,
    `To: ${recipients.map(recipientName).join(', ')}`, `Date: ${created}`, ''];
  if (toc) lines.push(toc, '');
  lines.push(`«TYPOGRAM» sealed — signed by ${sender} · verify at ${sender}/v`, '', armored, '');
  return { text: lines.join('\n') + '\n', mode: 'sealed', recipients: recipients.map(recipientMeta), cipher: 'age-v1' };
}

/** True if this text carries an age payload (is a sealed work). */
export const isSealed = (text) => PAYLOAD_RE.test(text);

/**
 * Read the cleartext envelope fields from a sealed text. These lines are part of the hashed, signed image layer, so
 * `tg verify` trusts THEM (not the free-form `tgart` JSON, which is not covered by the signature) when it shows who a
 * sealed work is from, to and with which cipher. Returns `{ from, to, date, cipher }` (any may be null).
 */
export function parseEnvelope(text) {
  const line = (re) => { const m = re.exec(String(text)); return m ? m[1].trim() : null; };
  return {
    from: line(/^From:\s*(.+)$/m),
    to: line(/^To:\s*(.+)$/m),
    date: line(/^Date:\s*(.+)$/m),
    cipher: (/^Sealed\s*·?\s*(age v\d+)/im.exec(String(text)) || [])[1] || null,
  };
}

/**
 * Decrypt a sealed text with one or more age identities ("AGE-SECRET-KEY-1…"). Returns the plaintext as a string.
 * Caller must verify the signature first — `tg open` does, and refuses to decrypt anything that is not VERIFIED.
 * (Named `openSealedText` to not clash with `src/index.js`'s `openSealed`, which opens a sealed *data* record, not a work.)
 */
export async function openSealedText(text, { identities }) {
  const m = PAYLOAD_RE.exec(text);
  if (!m) throw new Error('not a sealed work: no age payload found');
  if (!identities || !identities.length) throw new Error('open: an age identity is required to decrypt');
  const dec = new Decrypter();
  for (const id of identities) dec.addIdentity(id);
  return new TextDecoder().decode(await dec.decrypt(armor.decode(m[0]), 'uint8array'));
}
