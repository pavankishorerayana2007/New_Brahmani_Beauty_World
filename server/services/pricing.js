// Server-side authority for prices, distance and delivery charges.
// Distance logic is a direct port of the frontend's, so buyer-side previews match.
const { FAR_KM, FREE_DELIVERY_FROM, STANDARD_DELIVERY } = require('../config/constants');

const fin = (p) => Math.round(p.price * (1 - (p.discount_pct || 0) / 100));

const rad = (x) => (x * Math.PI) / 180;
const hh = (t) => {
  let h = 5381;
  for (const c of String(t)) h = ((h * 33) ^ c.codePointAt(0)) >>> 0;
  return h;
};
const fa = (l) => (l ? [l.a, l.c, l.p].filter(Boolean).join(', ') : '');

/** Distance shop -> buyer. GPS (haversine) when both have it, else a PIN-code estimate. */
function distance(a, b) {
  if (a && b && a.gps && b.gps && a.lat != null && b.lat != null && a.lng != null && b.lng != null) {
    const dl = rad(b.lat - a.lat);
    const dg = rad(b.lng - a.lng);
    const x = Math.sin(dl / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dg / 2) ** 2;
    return { km: Math.max(0.1, Math.round(2 * 6371 * Math.asin(Math.sqrt(x)) * 10) / 10), estimated: false };
  }
  const pa = +(a && a.p);
  const pb = +(b && b.p);
  if (pa && pb) {
    const d = Math.abs(pa - pb);
    const km = d
      ? Math.min(90, Math.round((3 + d * 2.5) * 10) / 10)
      : Math.round((0.8 + (hh(fa(a).toLowerCase() + fa(b).toLowerCase()) % 38) / 10) * 10) / 10;
    return { km, estimated: true };
  }
  return { km: 5, estimated: true };
}

const isFar = (km) => km > FAR_KM;
const standardDelivery = (subtotal) => (subtotal && subtotal < FREE_DELIVERY_FROM ? STANDARD_DELIVERY : 0);
const suggestedFarCharge = (km) => 49 + Math.ceil(Math.max(0, km - FAR_KM)) * 10;

const addrKey = (a) => [a.a, a.c, a.p].join('|').toLowerCase();
/** lines: [[ 'P12', 2 ], ...] -> "P12:2,P3:1" (sorted) */
const itemsKey = (lines) => lines.map(([i, q]) => i + ':' + q).sort().join(',');

module.exports = { fin, fa, distance, isFar, standardDelivery, suggestedFarCharge, addrKey, itemsKey };
