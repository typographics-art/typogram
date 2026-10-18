// DigiByte anchor plugin for Typogram key statements — WANTED, not yet implemented. See README.md in this folder for the
// design and acceptance criteria. Implement the two functions below against the shared anchor contract (../README.md) and make
// anchors/digibyte/digibyte.test.js pass. This file intentionally throws until then.

export const type = 'digibyte';
export const title = 'DigiByte';

const todo = (what) =>
  new Error(`digibyte anchor: ${what} is not implemented yet — contributions welcome, see anchors/digibyte/README.md`);

/**
 * Write the identity digest to DigiByte as an OP_RETURN output and return a compact reference (at least the txid, ideally a
 * self-contained SPV proof). Costs a small network fee; needs a funded wallet. Keep tests on testnet.
 * @param {string} digestHex 64-char lowercase hex (SHA-256 of the signed key statement)
 * @returns {Promise<string>} the reference to store in tgart.anchors[].reference
 */
export async function anchor(digestHex) {
  void digestHex;
  throw todo('anchor');
}

/**
 * Check that `reference` proves `digestHex` was written on DigiByte, and return the attested block time.
 * @param {string} digestHex 64-char lowercase hex
 * @param {string} reference the value produced by anchor()
 * @returns {Promise<{ ok: boolean, time: string|null, detail?: string }>}
 */
export async function verify(digestHex, reference) {
  void digestHex; void reference;
  throw todo('verify');
}
