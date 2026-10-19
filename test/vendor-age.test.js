// The vendored age library (vendor/age-encryption.mjs) must round-trip: encrypt to an X25519 recipient, decrypt with
// its identity, and reject a wrong identity. Guards the committed bundle (Phase I sealed mode builds on it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Encrypter, Decrypter, armor, generateX25519Identity, identityToRecipient } from '../vendor/age-encryption.mjs';

test('vendored age: X25519 encrypt → armor → decrypt round-trips', async () => {
  const id = await generateX25519Identity();
  const recipient = await identityToRecipient(id);
  assert.match(recipient, /^age1/);
  const enc = new Encrypter(); enc.addRecipient(recipient);
  const armored = armor.encode(await enc.encrypt(new TextEncoder().encode('sealed payload')));
  assert.match(armored, /BEGIN AGE ENCRYPTED FILE/);
  const dec = new Decrypter(); dec.addIdentity(id);
  const pt = new TextDecoder().decode(await dec.decrypt(armor.decode(armored), 'uint8array'));
  assert.equal(pt, 'sealed payload');
});

test('vendored age: a wrong identity cannot decrypt', async () => {
  const enc = new Encrypter(); enc.addRecipient(await identityToRecipient(await generateX25519Identity()));
  const ct = await enc.encrypt(new TextEncoder().encode('secret'));
  const dec = new Decrypter(); dec.addIdentity(await generateX25519Identity());
  await assert.rejects(() => dec.decrypt(ct, 'uint8array'));
});
