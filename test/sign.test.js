// The issuer-signature core (src/sign.js): Ed25519 over the identity hash, key files, lookup. Pure, no DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIG_SPEC, sigString, generateIssuerKey, publicKeyOf, signHash, verifyHash, buildKeyfile, findKey,
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
