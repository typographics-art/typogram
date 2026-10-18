// A small in-memory limiter for the payment checks, which cost a call to the DigiByte node.
// Two limits: per client and for everybody together. Memory is bounded by construction: a request over the limit
// is refused WITHOUT being recorded, and the table of clients has a hard size (the oldest are dropped).

export function createLimiter({ perClient, global, windowMs = 60000, maxClients = 10000, now = Date.now }) {
  const clients = new Map(); // client -> timestamps of recent checks; Map order = least recently used first
  const all = [];
  return {
    /** True if this check is over a limit (and is not counted). */
    tooMany(client) {
      const t = now();
      while (all.length && t - all[0] >= windowMs) all.shift();
      // The client's own limit first: one client can never spend more than `perClient` of the shared budget.
      const recent = (clients.get(client) || []).filter((x) => t - x < windowMs);
      if (recent.length >= perClient) { clients.delete(client); clients.set(client, recent); return true; }
      if (all.length >= global) return true;
      recent.push(t); all.push(t);
      clients.delete(client); clients.set(client, recent);
      while (clients.size > maxClients) clients.delete(clients.keys().next().value);
      return false;
    },
    size: () => clients.size,
  };
}

/**
 * Which proxy header to believe, from the TRUST_PROXY setting. Behind a proxy every connection comes from the
 * proxy, so its header is the only way to tell clients apart — but a client can send any header itself. The
 * operator therefore names the ONE header the proxy in front overwrites, and only that one is read:
 *   cloudflare (or the older 1)  cf-connecting-ip, which Cloudflare sets itself
 *   xff                          the last x-forwarded-for entry, the one the nearest proxy added
 * Anything else (unset, 0) means no proxy: the connection's own address is used. Other values are refused.
 */
export function trustedHeader(value) {
  if (value === undefined || value === '' || value === '0') return false;
  if (value === 'cloudflare' || value === '1') return 'cloudflare';
  if (value === 'xff') return 'xff';
  throw new Error(`TRUST_PROXY=${JSON.stringify(value)} is not valid: use cloudflare, xff or leave it unset`);
}

/** The address a request came from, believing only the header `trustProxy` names (see trustedHeader). */
export function clientAddress(req, { trustProxy }) {
  if (trustProxy === 'cloudflare') {
    const cf = String(req.headers['cf-connecting-ip'] || '').trim();
    if (cf) return cf;
  } else if (trustProxy === 'xff') {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress || 'unknown';
}
