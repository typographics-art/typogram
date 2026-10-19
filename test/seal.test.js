// Phase I2 sealed format core (cli/seal.mjs): a sealed text is a cleartext envelope + an age-armor payload. These guard
// the round-trip (seal → open with the recipient identity), that a wrong identity cannot open it, sealed detection, and
// that a recipient is required. The CLI (tg seal / tg open / tg verify) is tested separately against the rendered Typogram.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateX25519Identity, identityToRecipient } from '../vendor/age-encryption.mjs';
import { sealText, openSealedText, isSealed } from '../cli/seal.mjs';

test('seal → open round-trips with the recipient identity', async () => {
  const id = await generateX25519Identity();
  const recipient = await identityToRecipient(id);
  const plaintext = '# Secret\n\nThe eagle lands at dawn.\n';
  const { text, mode, recipients, cipher } = await sealText({
    plaintext, title: 'Sealed note', sender: 'typographics-art.org',
    recipients: [{ issuer: 'example.org', kid: '2026-10', publicKey: recipient }], created: '2026-10-19',
  });
  assert.equal(mode, 'sealed');
  assert.equal(cipher, 'age-v1');
  assert.deepEqual(recipients, [{ issuer: 'example.org', kid: '2026-10' }]);
  assert.ok(isSealed(text));
  assert.match(text, /^# Sealed note/);
  assert.match(text, /From: typographics-art\.org/);
  assert.match(text, /To: example\.org:2026-10/);
  assert.equal(await openSealedText(text, { identities: [id] }), plaintext);
});

test('a wrong identity cannot open a sealed work', async () => {
  const id = await generateX25519Identity();
  const { text } = await sealText({
    plaintext: 'secret', title: 't', sender: 's.org',
    recipients: [{ issuer: 'a.org', kid: 'k', publicKey: await identityToRecipient(id) }],
  });
  const wrong = await generateX25519Identity();
  await assert.rejects(() => openSealedText(text, { identities: [wrong] }));
});

test('two recipients: either identity opens the same sealed work', async () => {
  const a = await generateX25519Identity(), b = await generateX25519Identity();
  const { text } = await sealText({
    plaintext: 'to both', title: 't', sender: 's.org',
    recipients: [{ issuer: 'a.org', kid: 'ka', publicKey: await identityToRecipient(a) }, { issuer: 'b.org', kid: 'kb', publicKey: await identityToRecipient(b) }],
  });
  assert.equal(await openSealedText(text, { identities: [a] }), 'to both');
  assert.equal(await openSealedText(text, { identities: [b] }), 'to both');
});

test('isSealed is false for a plain text, and open rejects it', async () => {
  assert.equal(isSealed('# Hello\n\nJust text.\n'), false);
  await assert.rejects(() => openSealedText('# Hello\n\nJust text.\n', { identities: ['x'] }), /not a sealed work/);
});

test('seal requires at least one recipient', async () => {
  await assert.rejects(() => sealText({ plaintext: 'x', title: 't', sender: 's.org', recipients: [] }), /recipient/);
});
