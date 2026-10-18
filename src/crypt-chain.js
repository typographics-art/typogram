// Sealed records on a blockchain (docs/encrypted-data.md section 7): the chain carries a COMMITMENT (a SHA-256 of the
// sealed record, in one OP_RETURN of at most 80 bytes); the record itself is stored off chain, at a place anyone can find
// from the commitment (content addressed). Whoever fetches the record checks it against the chain; only the holder of the
// key can open it. Nothing here talks to a real chain: `ChainAdapter` is the interface a host application implements
// (publish, fetch, verify), `FakeChain` + `FakeStore` + `FakeChainAdapter` are the reference implementation for tests.
// No dependency on any host application.
import { CryptError, fail, concat, equalBytes, sha256, toHex, fromHex, utf8 } from './crypt-codec.js';
import { parseRecord, openSealed, sealData, sealItem } from './crypt.js';

export const OP_RETURN_MAX = 80;
export const ANCHOR_MAGIC = utf8('TGA1');
export const ANCHOR_VERSION = 1;
export const HINT_MAX = OP_RETURN_MAX - 4 - 1 - 32; // 43 bytes

// ---- the on-chain payload ---------------------------------------------------------------------------------------
/**
 * The OP_RETURN payload: "TGA1" (4) + flags (1) + SHA-256 of the sealed record (32) [+ hint, at most 43 bytes] = 37 to 80 bytes.
 * flags: bit 0 = a hint follows (UTF-8: a short URL or label for a place that holds the record; never a secret).
 */
export function anchorPayload(commitment, hint) {
  if (!(commitment instanceof Uint8Array) || commitment.length !== 32) throw fail('bad-anchor', 'The commitment is a 32-byte SHA-256');
  const h = hint ? utf8(hint) : new Uint8Array(0);
  if (h.length > HINT_MAX) throw fail('payload-too-large', `The hint is ${h.length} bytes; at most ${HINT_MAX} fit next to the commitment`);
  return concat(ANCHOR_MAGIC, Uint8Array.of(h.length ? 1 : 0), commitment, h);
}
/** Reads a payload; throws bad-anchor for anything that is not ours. */
export function parseAnchorPayload(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 37 || bytes.length > OP_RETURN_MAX || !equalBytes(bytes.slice(0, 4), ANCHOR_MAGIC)) throw fail('bad-anchor', 'This output is not a Typographics Art anchor');
  const flags = bytes[4];
  if (flags & ~1) throw fail('bad-anchor', 'Unknown anchor flags');
  const hasHint = !!(flags & 1);
  if (hasHint !== bytes.length > 37) throw fail('bad-anchor', 'The anchor length does not match its flags');
  let hint = null;
  if (hasHint) { try { hint = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(37)); } catch { throw fail('bad-anchor', 'The anchor hint is not text'); } }
  return { commitment: bytes.slice(5, 37), hint };
}
/** The locking script of an OP_RETURN output carrying `payload` (OP_RETURN, then one push). */
export function opReturnScript(payload) {
  const n = payload.length;
  if (n > OP_RETURN_MAX) throw fail('payload-too-large', `An OP_RETURN carries at most ${OP_RETURN_MAX} bytes; this is ${n}`);
  return concat(Uint8Array.of(0x6a), n < 76 ? Uint8Array.of(n) : Uint8Array.of(0x4c, n), payload);
}
/** Fee estimate in satoshis for one input, one change output and one data output: size x relay fee x 2, never below the floor. */
export function estimateFeeSat(payloadBytes, { relayfeeSatPerKb = 100_000, floorSat = 10_000 } = {}) {
  const size = 10 + 148 + 34 + (11 + payloadBytes); // P2PKH input and change; data output: 8 value + 1 script length + OP_RETURN + 1 push length + payload
  return Math.max(floorSat, Math.ceil((size * relayfeeSatPerKb * 2) / 1000));
}

// ---- content addressing ------------------------------------------------------------------------------------------
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
function base32(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += B32[(value << (5 - bits)) & 31];
  return out;
}
/** The IPFS CID (version 1, raw codec, sha2-256, base32) that a file with exactly the bytes of the record has when added with raw leaves in one block (up to 256 KiB). */
export function recordCid(commitment) { return 'b' + base32(concat(Uint8Array.of(0x01, 0x55, 0x12, 0x20), commitment)); }

// ---- the interface a host implements ----------------------------------------------------------------------------
/**
 * What a host application provides. All methods are async and throw CryptError.
 *   publish(record, {hint}) -> { assetId, txid, commitment (hex), feeSat }
 *       stores `record` (bytes) where fetch() can find it from the commitment, and writes the anchor payload to the chain.
 *   fetch(assetId) -> { record, commitment (hex), txid, confirmations, hint }
 *       reads the anchor from the chain, gets the record, and returns it ONLY if its SHA-256 equals the commitment.
 *   verify(assetId, record) -> { ok, reason, confirmations, commitment }
 *       chain-only: does the anchor of `assetId` commit to exactly these bytes?
 */
export class ChainAdapter {
  async publish() { throw fail('not-implemented', 'publish is not implemented'); }
  async fetch() { throw fail('not-implemented', 'fetch is not implemented'); }
  async verify() { throw fail('not-implemented', 'verify is not implemented'); }
}

// ---- the reference implementation: a fake chain, a fake store ----------------------------------------------------
/** An in-memory chain of blocks holding transactions with one OP_RETURN each; persisted as JSON when a file is given. */
export class FakeChain {
  constructor({ network = 'fake', relayfeeSatPerKb = 100_000 } = {}) { this.network = network; this.relayfeeSatPerKb = relayfeeSatPerKb; this.height = 0; this.txs = new Map(); this.pending = []; this.counter = 0; }
  /** Broadcasts a transaction with one data output; returns the txid. It confirms when mine() runs. */
  async sendData(payload) {
    const script = opReturnScript(payload); // throws above the 80-byte limit
    const feeSat = estimateFeeSat(payload.length, { relayfeeSatPerKb: this.relayfeeSatPerKb });
    const txid = toHex(await sha256(concat(utf8(`fakechain/${this.network}/${this.counter++}/`), script)));
    this.txs.set(txid, { txid, script: toHex(script), feeSat, height: null });
    this.pending.push(txid);
    return { txid, feeSat, vout: 0 };
  }
  mine(blocks = 1) {
    for (let i = 0; i < blocks; i++) { this.height++; for (const id of this.pending) this.txs.get(id).height = this.height; this.pending = []; }
    return this.height;
  }
  /** Like getrawtransaction: { txid, script (hex), confirmations } or null. */
  getTx(txid) {
    const t = this.txs.get(txid);
    return t ? { txid, script: t.script, confirmations: t.height === null ? 0 : this.height - t.height + 1 } : null;
  }
  /** The data payload of a transaction's OP_RETURN output. */
  static dataOf(scriptHex) {
    const s = fromHex(scriptHex);
    if (s[0] !== 0x6a) throw fail('bad-anchor', 'The output is not an OP_RETURN');
    const [len, at] = s[1] === 0x4c ? [s[2], 3] : [s[1], 2];
    if (s.length !== at + len) throw fail('bad-anchor', 'The OP_RETURN push is malformed');
    return s.slice(at);
  }
  toJSON() { return { network: this.network, relayfeeSatPerKb: this.relayfeeSatPerKb, height: this.height, counter: this.counter, pending: this.pending, txs: [...this.txs.values()] }; }
  static fromJSON(j) {
    const c = new FakeChain({ network: j.network, relayfeeSatPerKb: j.relayfeeSatPerKb });
    Object.assign(c, { height: j.height, counter: j.counter, pending: j.pending });
    for (const t of j.txs) c.txs.set(t.txid, t);
    return c;
  }
}

/** A content-addressed store: put(bytes) -> locator (hex SHA-256), get(locator) -> bytes or null. In memory; `dir` makes it a directory of files. */
export class FakeStore {
  constructor() { this.map = new Map(); }
  async put(bytes) { const loc = toHex(await sha256(bytes)); this.map.set(loc, Uint8Array.from(bytes)); return loc; }
  async get(locator) { const b = this.map.get(locator); return b ? Uint8Array.from(b) : null; }
  delete(locator) { return this.map.delete(locator); }
  /** Test hook: put different bytes under a locator (a compromised store). */
  replace(locator, bytes) { this.map.set(locator, Uint8Array.from(bytes)); }
}

export class FakeChainAdapter extends ChainAdapter {
  /** @param {{minConfirmations?:number}} [o] a fetch of an anchor with fewer confirmations fails with `unconfirmed` */
  constructor(chain, store, { minConfirmations = 0 } = {}) { super(); this.chain = chain; this.store = store; this.minConfirmations = minConfirmations; }
  async publish(record, { hint } = {}) {
    if (!(record instanceof Uint8Array) || !record.length) throw fail('bad-record', 'The record is empty');
    const commitment = await sha256(record);
    await this.store.put(record);
    const { txid, feeSat, vout } = await this.chain.sendData(anchorPayload(commitment, hint));
    return { assetId: `fake:${this.chain.network}:${txid}:${vout}`, txid, commitment: toHex(commitment), feeSat };
  }
  async #anchor(assetId) {
    const m = /^fake:([^:]+):([0-9a-f]{64}):(\d+)$/.exec(String(assetId));
    if (!m || m[1] !== this.chain.network) throw fail('bad-asset', 'This is not an asset id of this chain');
    const tx = this.chain.getTx(m[2]);
    if (!tx) throw fail('not-found', 'The chain has no such transaction (yet)');
    const a = parseAnchorPayload(FakeChain.dataOf(tx.script));
    return { ...a, txid: m[2], confirmations: tx.confirmations };
  }
  async fetch(assetId) {
    const a = await this.#anchor(assetId);
    if (a.confirmations < this.minConfirmations) throw fail('unconfirmed', `The anchor has ${a.confirmations} of ${this.minConfirmations} required confirmations`);
    const record = await this.store.get(toHex(a.commitment));
    if (!record) throw fail('unavailable', 'The chain commits to a record, but no copy of it can be found: the anchor does not keep the data alive');
    if (!equalBytes(await sha256(record), a.commitment)) throw fail('commitment-mismatch', 'The stored record does not match the chain: it was replaced or damaged');
    return { record, commitment: toHex(a.commitment), txid: a.txid, confirmations: a.confirmations, hint: a.hint };
  }
  async verify(assetId, record) {
    let a;
    try { a = await this.#anchor(assetId); } catch (e) { if (e instanceof CryptError) return { ok: false, reason: e.code, confirmations: 0 }; throw e; }
    const ok = equalBytes(await sha256(record), a.commitment);
    return { ok, reason: ok ? undefined : 'commitment-mismatch', confirmations: a.confirmations, commitment: toHex(a.commitment) };
  }
}

// ---- the whole flow, adapter-agnostic ---------------------------------------------------------------------------
/**
 * Seals a TGD block (or a message with kind 'text') for a work and publishes the record. The key is returned to the caller
 * and never given to the adapter.
 * @returns {Promise<{assetId:string, key:string|null, txid:string, commitment:string, feeSat:number, record:string, cid:string}>}
 */
export async function publishSealed(adapter, workText, item, { seal = {}, hint } = {}) {
  if (seal.inline) throw fail('bad-option', 'A key that carries the record is not for publishing: publish the record, keep the key');
  // A published record can be attacked offline for ever: a password's strength is all that protects it then.
  if (seal.password !== undefined && !seal.allowPassword) throw fail('weak-for-chain', 'A record protected only by a password should not be published: anyone can try passwords on it for ever. Use a key, or pass allowPassword to accept the risk.');
  const { allowPassword, ...sealOptions } = seal;
  const sealed = item.kind === 'tgd' ? await sealData(workText, item.text, sealOptions) : await sealItem(workText, { kind: item.kind, payload: item.payload ?? utf8(item.text) }, sealOptions);
  const r = await adapter.publish(sealed.bytes, { hint });
  return { assetId: r.assetId, key: sealed.key, txid: r.txid, commitment: r.commitment, feeSat: r.feeSat, record: sealed.record, cid: recordCid(fromHex(r.commitment)) };
}
/** Fetches the record of an asset from the chain (verified against its commitment) and opens it with the key (or password). */
export async function openFromChain(adapter, assetId, workText, { key, password } = {}) {
  const f = await adapter.fetch(assetId);
  const opened = await openSealed(workText, { key, password, record: f.record });
  return { ...opened, assetId, txid: f.txid, confirmations: f.confirmations };
}
/** Is `recordText` (a `tgs1.` string) the one the asset commits to? */
export async function verifyAsset(adapter, assetId, recordText) { return adapter.verify(assetId, parseRecord(recordText).bytes); }
