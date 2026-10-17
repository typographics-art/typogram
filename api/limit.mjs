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
      if (all.length >= global) return true;
      const recent = (clients.get(client) || []).filter((x) => t - x < windowMs);
      if (recent.length >= perClient) { clients.delete(client); clients.set(client, recent); return true; }
      recent.push(t); all.push(t);
      clients.delete(client); clients.set(client, recent);
      while (clients.size > maxClients) clients.delete(clients.keys().next().value);
      return false;
    },
    size: () => clients.size,
  };
}

/**
 * The address a request came from. Behind a proxy every connection comes from the proxy, so its header is the
 * only way to tell clients apart — but a client can send that header itself. It is therefore read ONLY when the
 * operator says a proxy that overwrites it sits in front (TRUST_PROXY=1): `cf-connecting-ip`, else the LAST
 * `x-forwarded-for` entry (the one the nearest proxy added).
 */
export function clientAddress(req, { trustProxy }) {
  if (trustProxy) {
    const cf = String(req.headers['cf-connecting-ip'] || '').trim();
    if (cf) return cf;
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress || 'unknown';
}
