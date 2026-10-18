import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, clientAddress, trustedHeader } from '../api/limit.mjs';

const clock = () => { let t = 1_000_000; return { now: () => t, tick: (ms) => { t += ms; } }; };

test('limiter: a client over its limit is refused, and the window slides', () => {
  const c = clock(), l = createLimiter({ perClient: 3, global: 100, now: c.now });
  assert.deepEqual([1, 2, 3, 4].map(() => l.tooMany('a')), [false, false, false, true]);
  assert.equal(l.tooMany('b'), false, 'another client is not affected');
  c.tick(60001);
  assert.equal(l.tooMany('a'), false, 'a minute later it may check again');
});

test('limiter: everybody together is limited, however many addresses they use', () => {
  const c = clock(), l = createLimiter({ perClient: 100, global: 5, now: c.now });
  const results = Array.from({ length: 8 }, (_, i) => l.tooMany(`ip-${i}`));
  assert.deepEqual(results, [false, false, false, false, false, true, true, true]);
});

test('limiter: one client cannot spend the shared budget, so it cannot lock the others out', () => {
  const c = clock(), l = createLimiter({ perClient: 3, global: 10, now: c.now });
  for (let i = 0; i < 100; i++) l.tooMany('attacker');
  assert.equal(l.tooMany('payer-1'), false);
  assert.equal(l.tooMany('payer-2'), false, 'the attacker used 3 of the 10, everybody else still has 7');
});

test('limiter: memory is bounded however many addresses are made up', () => {
  const c = clock(), l = createLimiter({ perClient: 5, global: 1_000_000, maxClients: 100, now: c.now });
  for (let i = 0; i < 5000; i++) l.tooMany(`spoof-${i}`);
  assert.ok(l.size() <= 100, `table holds ${l.size()} clients`);
});

test('limiter: a refused request is not recorded (hammering does not grow the state)', () => {
  const c = clock(), l = createLimiter({ perClient: 2, global: 2, now: c.now });
  l.tooMany('a'); l.tooMany('a');
  for (let i = 0; i < 1000; i++) assert.equal(l.tooMany('a'), true);
  c.tick(60001);
  assert.equal(l.tooMany('a'), false, 'after the window it works again: refused requests were not counted');
});

test('clientAddress: only the header the operator names is believed', () => {
  const req = (h) => ({ headers: h, socket: { remoteAddress: '10.0.0.7' } });
  assert.equal(clientAddress(req({ 'cf-connecting-ip': '203.0.113.9' }), { trustProxy: false }), '10.0.0.7', 'no proxy: a client-sent header is ignored');
  assert.equal(clientAddress(req({ 'x-forwarded-for': '1.1.1.1' }), { trustProxy: false }), '10.0.0.7');
  assert.equal(clientAddress(req({ 'cf-connecting-ip': '203.0.113.9' }), { trustProxy: 'cloudflare' }), '203.0.113.9');
  assert.equal(clientAddress(req({ 'x-forwarded-for': '6.6.6.6' }), { trustProxy: 'cloudflare' }), '10.0.0.7', 'cloudflare mode ignores x-forwarded-for, which a client can send itself');
  assert.equal(clientAddress(req({ 'x-forwarded-for': '6.6.6.6, 198.51.100.4' }), { trustProxy: 'xff' }), '198.51.100.4', 'the entry the nearest proxy added, not the one the client wrote');
  assert.equal(clientAddress(req({ 'cf-connecting-ip': '203.0.113.9' }), { trustProxy: 'xff' }), '10.0.0.7', 'xff mode ignores cf-connecting-ip');
  assert.equal(clientAddress(req({}), { trustProxy: 'cloudflare' }), '10.0.0.7');
});

test('trustedHeader: names the header, refuses guesses', () => {
  assert.equal(trustedHeader(undefined), false);
  assert.equal(trustedHeader('0'), false);
  assert.equal(trustedHeader('cloudflare'), 'cloudflare');
  assert.equal(trustedHeader('1'), 'cloudflare');
  assert.equal(trustedHeader('xff'), 'xff');
  assert.throws(() => trustedHeader('yes'), /TRUST_PROXY/);
});
