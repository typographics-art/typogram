// Pure aggregation for the market ledger: orders + catalog pricing -> per product kind and per work.
// No network, no PII: only product kind, work id, quantity, revenue, country.
const KINDS = [
  ['Framed poster', /frame/i], ['Canvas', /canvas/i], ['Mug', /mug/i], ['T-shirt', /t-?shirt|apparel/i],
  ['Tote bag', /tote|bag_product/i], ['Poster', /poster|flat_/i],
];
export const kindOf = (s) => (KINDS.find(([, re]) => re.test(String(s || ''))) || ['Other'])[0];

// order: { country, currency, items: [{ productUid|title, workId, quantity, price }] } (already normalised by the collectors)
export function aggregate(orders, pricing) {
  const baseByKind = {};
  for (const p of pricing?.products || []) baseByKind[kindOf(`${p.label} ${p.gelatoUid}`)] ??= p.base;
  const kinds = {}, works = {};
  let revenue = 0, units = 0;
  for (const o of orders) for (const it of o.items || []) {
    const q = Number(it.quantity) || 0, r = (Number(it.price) || 0) * q;
    const k = kindOf(it.productUid || it.title), w = it.workId || 'unknown';
    for (const [m, key] of [[kinds, k], [works, w]]) { const e = (m[key] ??= { units: 0, revenue: 0, base: 0 }); e.units += q; e.revenue += r; e.base += (baseByKind[k] || 0) * q; }
    revenue += r; units += q;
  }
  const finish = (m) => Object.fromEntries(Object.entries(m).map(([k, e]) => [k, { ...e, revenue: +e.revenue.toFixed(2), base: +e.base.toFixed(2), contribution: +(e.revenue - e.base).toFixed(2) }]));
  return { orders: orders.length, units, revenue: +revenue.toFixed(2), kinds: finish(kinds), works: finish(works) };
}

// Funnel step: sessions -> orders. Returns null instead of a rate when the denominator is too small to mean anything.
export const conversion = (orders, sessions, minSessions = 200) => (sessions >= minSessions ? +(orders / sessions * 100).toFixed(2) : null);
