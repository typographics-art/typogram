// Phase-H test vectors: fixed inputs with their exact hash, signature and key-statement signature, so ANY implementation
// (ours, a third party's) can confirm it computes the same. The fixture key is TEST-ONLY — never a real issuer key. These
// same vectors are published in docs/verification.md. Ed25519 signing is deterministic (RFC 8032), so the signatures are fixed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sigString, signHash, verifyHash, signKeyStatement, verifyKeyStatement, publicKeyOf } from '../src/sign.js';
import { canonicalText } from '../src/secret.js';

const FIXTURE_PEM = '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIHlvlGcnEOzBB57Kfl4qwWXDuqgUKZDHQRaw4pW4gAWX\n-----END PRIVATE KEY-----\n';
const PUB = 'XRu2mLhQPwPKdsX9OIZPABnvmbs75lBMY5bZpxDaDc0';
const HASH = 'ae0e6d06855b7d6ba1262802cfd647809b1610543f7639b8ea34fc7d271751b4';
const sha256hex = (s) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
const FIELDS = { hash: HASH, issuer: 'example.org', kid: '2026-01', created: '2026-01-01' };

test('vector: the fixture public key derives from the fixture private key', () => {
  assert.equal(publicKeyOf(FIXTURE_PEM), PUB);
});

test('vector: canonical text and the identity hash', () => {
  assert.equal(canonicalText('Hello, Typogram.'), 'Hello, Typogram.');
  assert.equal(sha256hex(canonicalText('Hello, Typogram.')), HASH);
});

test('vector: the signature string and the (deterministic) signature over the hash', () => {
  assert.equal(sigString(FIELDS), `tgart-sig-v1\n${HASH}\nexample.org\n2026-01\n2026-01-01`);
  const sig = signHash(FIELDS, FIXTURE_PEM);
  assert.equal(sig, 'RK2rjedhhgh_JYPgCd3ZcZ3u74km4EPCbjwSRwn6JAe2jFGooWbGjI6x4sj5NKzxoZkYIMLzubArKFWrHvCUDQ');
  assert.equal(verifyHash({ ...FIELDS, signature: sig }, PUB), true);
});

test('vector: the key-statement self-signature is reproducible and verifies', () => {
  const stmt = signKeyStatement({ issuer: 'example.org', kid: '2026-01', publicKey: PUB, created: '2026-01-01' }, FIXTURE_PEM);
  assert.equal(stmt.sig.signature, 'CsESxGVwGYddLmBK9otg9XqrExe5PbirsVU2_qESx7-LEMJSBmnrNGoUlLUSao-78GyC_6m4F3oKPZZZ9y1TDg');
  assert.equal(verifyKeyStatement(stmt).ok, true);
});
