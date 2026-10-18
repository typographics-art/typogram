// The issuer-signature core (src/sign.js): Ed25519 over the identity hash, key files, lookup. Pure, no DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIG_SPEC, sigString, generateIssuerKey, publicKeyOf, signHash, verifyHash, buildKeyfile, findKey,
  KEY_SPEC, canonicalJson, signKeyStatement, verifyKeyStatement, keyStatementDigest,
} from '../src/sign.js';

const HASH = 'a'.repeat(64);
const FIELDS = { hash: HASH, issuer: 'typographics-art.org', kid: '2026-10', created: '2026-10-18' };

test('sigString: fixed spec tag, fixed order, newline-joined, fields validated', () => {
  assert.equal(sigString(FIELDS), `${SIG_SPEC}\n${HASH}\ntypographics-art.org\n2026-10\n2026-10-18`);
  assert.throws(() => sigString({ ...FIELDS, issuer: 'a\nb' }), /newline/);
  assert.throws(() => sigString({ ...FIELDS, kid: '' }), /required/);
});

test('sign/verify: a genuine signature verifies; a wrong field or key does not', () => {
  const key = generateIssuerKey({ created: '2026-10-18' });
  assert.equal(key.publicKey, publicKeyOf(key.privatePem), 'the published public key matches the private key');
  const signature = signHash(FIELDS, key.privatePem);
  assert.equal(verifyHash({ ...FIELDS, signature }, key.publicKey), true, 'the real signature verifies');

  // tamper: any changed field breaks verification (the signature is over all four + the hash)
  assert.equal(verifyHash({ ...FIELDS, hash: 'b'.repeat(64), signature }, key.publicKey), false, 'a changed hash fails');
  assert.equal(verifyHash({ ...FIELDS, issuer: 'evil.example', signature }, key.publicKey), false, 'a changed issuer fails');
  assert.equal(verifyHash({ ...FIELDS, created: '2026-10-19', signature }, key.publicKey), false, 'a changed date fails');

  // a different issuer key cannot verify this signature
  const other = generateIssuerKey();
  assert.equal(verifyHash({ ...FIELDS, signature }, other.publicKey), false, 'a different key fails');

  // a mangled signature or key never throws, just returns false
  assert.equal(verifyHash({ ...FIELDS, signature: 'not-base64url!!' }, key.publicKey), false);
  assert.equal(verifyHash({ ...FIELDS, signature }, 'garbage'), false);
});

test('key file: build and look up by kid + alg, honouring revoked and expired', () => {
  const sign = generateIssuerKey();
  const kf = buildKeyfile('typographics-art.org', [
    { kid: '2026-10', publicKey: sign.publicKey, created: '2026-10-18' },
    { kid: 'old', publicKey: generateIssuerKey().publicKey, created: '2025-01-01', revoked: true },
    { kid: 'past', publicKey: generateIssuerKey().publicKey, created: '2025-01-01', expires: '2025-12-31' },
    { kid: 'x1', alg: 'X25519', publicKey: 'xxxx', created: '2026-10-18' },
  ]);
  assert.equal(kf.issuer, 'typographics-art.org');
  assert.equal(kf.keys[0].use, 'sign');
  assert.equal(kf.keys[3].use, 'seal', 'an X25519 key defaults to use=seal (for Phase I)');

  assert.equal(findKey(kf, { kid: '2026-10' }), sign.publicKey, 'the live signing key is found');
  assert.equal(findKey(kf, { issuer: 'typographics-art.org', kid: '2026-10' }), sign.publicKey);
  assert.equal(findKey(kf, { issuer: 'evil.example', kid: '2026-10' }), null, 'a wrong issuer is refused');
  assert.equal(findKey(kf, { kid: 'old' }), null, 'a revoked key is refused');
  assert.equal(findKey(kf, { kid: 'past', at: '2026-10-18' }), null, 'an expired key is refused');
  assert.equal(findKey(kf, { kid: 'x1' }), null, 'an Ed25519 lookup does not return the X25519 key');
  assert.equal(findKey(kf, { kid: 'x1', alg: 'X25519' }), 'xxxx', 'the X25519 key is found when asked for by alg');
  assert.equal(findKey(kf, { kid: 'missing' }), null);
});

test('end to end: a signature made for one hash is specific to that text', () => {
  const key = generateIssuerKey();
  const sig1 = signHash({ ...FIELDS, hash: 'c'.repeat(64) }, key.privatePem);
  assert.equal(verifyHash({ ...FIELDS, hash: 'c'.repeat(64), signature: sig1 }, key.publicKey), true);
  assert.equal(verifyHash({ ...FIELDS, hash: 'd'.repeat(64), signature: sig1 }, key.publicKey), false);
});

// ---- the self-contained signed key statement ----
test('canonicalJson: sorts object keys recursively, deterministic', () => {
  assert.equal(canonicalJson({ b: 1, a: [{ y: 2, x: 1 }] }), '{"a":[{"x":1,"y":2}],"b":1}');
  assert.equal(canonicalJson(undefined), 'null');
});

test('key statement: a fresh statement self-verifies; no predecessor means predSig is null', () => {
  const key = generateIssuerKey({ created: '2026-10-18' });
  const st = signKeyStatement({ issuer: 'typographics-art.org', kid: '2026-10', publicKey: key.publicKey, created: '2026-10-18' }, key.privatePem);
  assert.equal(st.spec, KEY_SPEC);
  const r = verifyKeyStatement(st);
  assert.equal(r.ok, true);
  assert.equal(r.selfSig, true);
  assert.equal(r.predSig, null);
  assert.equal(r.issuer, 'typographics-art.org');
});

test('key statement: tampering with a signed field breaks the self-signature', () => {
  const key = generateIssuerKey();
  const st = signKeyStatement({ issuer: 'typographics-art.org', kid: 'k1', publicKey: key.publicKey }, key.privatePem);
  assert.equal(verifyKeyStatement({ ...st, issuer: 'evil.example' }).ok, false, 'changed issuer fails');
  assert.equal(verifyKeyStatement({ ...st, created: '2000-01-01' }).ok, false, 'changed date fails');
  assert.equal(verifyKeyStatement({ ...st, publicKey: generateIssuerKey().publicKey }).ok, false, 'swapped public key fails');
});

test('key statement: adding an anchor after signing does NOT break the signature', () => {
  const key = generateIssuerKey();
  const st = signKeyStatement({ issuer: 'x.org', kid: 'k1', publicKey: key.publicKey }, key.privatePem);
  st.anchors.push({ type: 'opentimestamps', reference: 'deadbeef' });
  assert.equal(verifyKeyStatement(st).ok, true, 'anchors are outside the signed core');
});

test('key statement: rotation — the predecessor endorses the new key', () => {
  const oldKey = generateIssuerKey({ created: '2026-01-01' });
  const newKey = generateIssuerKey({ created: '2026-10-18' });
  const st = signKeyStatement(
    { issuer: 'x.org', kid: '2026-10', publicKey: newKey.publicKey, predecessor: { kid: '2026-01', publicKey: oldKey.publicKey } },
    newKey.privatePem,
    { predecessorPem: oldKey.privatePem },
  );
  const r = verifyKeyStatement(st);
  assert.equal(r.ok, true);
  assert.equal(r.selfSig, true);
  assert.equal(r.predSig, true, 'the predecessor signature verifies');

  // a forged predecessor endorsement (signed by the wrong key) fails
  const forged = signKeyStatement(
    { issuer: 'x.org', kid: '2026-10', publicKey: newKey.publicKey, predecessor: { kid: '2026-01', publicKey: oldKey.publicKey } },
    newKey.privatePem,
    { predecessorPem: generateIssuerKey().privatePem },
  );
  const rf = verifyKeyStatement(forged);
  assert.equal(rf.predSig, false, 'a wrong predecessor key does not verify');
  assert.equal(rf.ok, false);
});

test('key statement: an expired statement is not ok', () => {
  const key = generateIssuerKey();
  const st = signKeyStatement({ issuer: 'x.org', kid: 'k1', publicKey: key.publicKey, expires: '2025-12-31' }, key.privatePem);
  assert.equal(verifyKeyStatement(st, { at: '2026-10-18' }).ok, false);
  assert.equal(verifyKeyStatement(st, { at: '2026-10-18' }).expired, true);
  assert.equal(verifyKeyStatement(st, { at: '2025-06-01' }).ok, true, 'still valid before expiry');
});

test('key statement: digest is stable and changes with the core', async () => {
  const key = generateIssuerKey();
  const st = signKeyStatement({ issuer: 'x.org', kid: 'k1', publicKey: key.publicKey }, key.privatePem);
  const d1 = await keyStatementDigest(st);
  assert.match(d1, /^[0-9a-f]{64}$/);
  st.anchors.push({ type: 'rekor', reference: 'z' });
  assert.equal(await keyStatementDigest(st), d1, 'anchors do not change the digest');
  const d2 = await keyStatementDigest({ ...st, kid: 'k2' });
  assert.notEqual(d2, d1, 'a core change changes the digest');
});
