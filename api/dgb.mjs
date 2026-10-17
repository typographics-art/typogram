// DigiByte payment check for the paid API: a transaction pays if its outputs to our address add up to
// the price and it has enough confirmations. Read with `getrawtransaction <txid> true` from our own node
// (it runs with -txindex, so no wallet is needed).

export const TXID = /^[0-9a-f]{64}$/;

/**
 * What a transaction pays to `address`, and whether that is enough.
 * @param {object} tx  decoded transaction (getrawtransaction verbose)
 * @returns {{ ok: boolean, paidDgb: number, confirmations: number, reason?: string }}
 */
export function evaluatePayment(tx, { address, minDgb, minConfirmations }) {
  // Fail closed: a rule that is not a usable number would make every comparison below false (NaN).
  if (!address || !(Number.isFinite(minDgb) && minDgb > 0) || !(Number.isInteger(minConfirmations) && minConfirmations >= 0)) {
    return { ok: false, paidDgb: 0, confirmations: 0, reason: 'invalid_rules' };
  }
  let sats = 0;
  for (const out of tx?.vout || []) {
    const spk = out.scriptPubKey || {};
    const addresses = spk.address ? [spk.address] : spk.addresses || [];
    if (addresses.includes(address)) sats += Math.round(Number(out.value) * 1e8);
  }
  const confirmations = Number.isInteger(tx?.confirmations) ? tx.confirmations : 0;
  if (!Number.isSafeInteger(sats) || sats < 0) return { ok: false, paidDgb: 0, confirmations, reason: 'invalid_transaction' };
  const paidDgb = sats / 1e8;
  if (sats === 0) return { ok: false, paidDgb, confirmations, reason: 'no_output_to_address' };
  if (sats < Math.round(minDgb * 1e8)) return { ok: false, paidDgb, confirmations, reason: 'amount_too_low' };
  if (confirmations < minConfirmations) return { ok: false, paidDgb, confirmations, reason: 'not_confirmed' };
  return { ok: true, paidDgb, confirmations };
}

/** Calls the node's JSON-RPC. Returns { result } or { error: { code, message } }. */
export async function rpc(method, params, { url, user, password, timeoutMs = 15000 }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64') },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'tg-art', method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => ({ error: { code: res.status, message: `HTTP ${res.status}` } }));
  return body.error ? { error: body.error } : { result: body.result };
}

/** The decoded transaction, or null if the node does not know it (yet). */
export async function fetchTransaction(txid, conn) {
  const r = await rpc('getrawtransaction', [txid, true], conn);
  if (r.error) {
    if (r.error.code === -5) return null; // No such mempool or blockchain transaction
    throw new Error(`DigiByte node: ${r.error.message}`);
  }
  return r.result;
}
