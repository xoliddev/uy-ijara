// JS port of uyijara/core/fair.py: "Narx adolatlimi?" — median standard price per m² of comparables (same district,
// same rooms → ±1 room → whole district), outliers dropped by the modified z-score, integer quality coefficients.
import { fdiv } from './clock.js';
import { divRound, roundTo, toUzs } from './money.js';

export const MIN_COMPARABLES = 5;
export const CHEAP_PCT = -10;
export const EXPENSIVE_PCT = 10;
export const BAND_PCT = 10;
export const BAND_STEP = 50_000;
export const RENOVATION = { none: -12, cosmetic: 0, euro: 10, designer: 20 };
export const BUILDING = { panel: -4, brick: 0, monolith: 6, house: 3 };
export const FURNISHED = 8;
export const FIRST_FLOOR = -5;
export const LAST_FLOOR = -4;
export const SUSPICIOUS_PCT = -35;
export const FEW_SCORE = 1_000_000;
export const SUSPICIOUS_SCORE = 900_000;

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) throw new Error('empty');
  return n % 2 ? s[fdiv(n, 2)] : fdiv(s[n / 2 - 1] + s[n / 2], 2);
}

export function madTrim(xs) {
  if (!xs.length) return [];
  const med = median(xs);
  const mad = Math.max(median(xs.map((x) => Math.abs(x - med))), fdiv(med, 20), 1);
  return xs.filter((x) => Math.abs(x - med) * 6745 <= 35_000 * mad);
}

export function factors(l) {
  const out = [];
  const r = RENOVATION[l.renovation];
  if (r) out.push([`renovation_${l.renovation}`, r]);
  const b = BUILDING[l.building];
  if (b) out.push([`building_${l.building}`, b]);
  if (l.furnished) out.push(['furnished', FURNISHED]);
  if (l.building !== 'house' && l.floors > 1) {
    if (l.floor === 1) out.push(['floor_first', FIRST_FLOOR]);
    else if (l.floor === l.floors && l.floors >= 5) out.push(['floor_last', LAST_FLOOR]);
  }
  return out;
}

export const quality = (l) => 100 + factors(l).reduce((s, [, p]) => s + p, 0);
export const standardPpm = (l, rate) => fdiv(toUzs(l.price, l.currency, rate) * 100, l.area * quality(l));

export function comparables(target, pool, rate) {
  const rooms = target.rooms;
  const same = pool.filter((x) => x.district === target.district && x.id !== target.id);
  const groups = [['rooms', (x) => x.rooms === rooms], ['near', (x) => Math.abs(x.rooms - rooms) <= 1], ['district', () => true]];
  for (const [scope, keep] of groups) {
    const values = same.filter(keep).map((x) => standardPpm(x, rate));
    if (values.length >= MIN_COMPARABLES) {
      const kept = madTrim(values);
      if (kept.length >= MIN_COMPARABLES) return { scope, values: kept, n: kept.length, n_all: values.length };
    }
  }
  return { scope: 'few', values: [], n: same.length, n_all: same.length };
}

const byWeight = (a, b) => Math.abs(b[1]) - Math.abs(a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

export function estimate(target, pool, rate) {
  const comp = comparables(target, pool, rate);
  const top = factors(target).sort(byWeight).slice(0, 3);
  const out = { scope: comp.scope, n: comp.n, n_all: comp.n_all, factors: top, rooms_lo: Math.max(1, target.rooms - 1),
    rooms_hi: target.rooms + 1, expected: null, band: null };
  if (comp.scope === 'few') return out;
  const expected = fdiv(median(comp.values) * target.area * quality(target), 100);
  const lo = roundTo(fdiv(expected * (100 - BAND_PCT), 100), BAND_STEP);
  const hi = roundTo(fdiv(expected * (100 + BAND_PCT), 100), BAND_STEP);
  return { ...out, expected, band: [lo, hi] };
}

export function verdictOf(pct) {
  if (pct <= CHEAP_PCT) return 'cheap';
  if (pct >= EXPENSIVE_PCT) return 'expensive';
  return 'fair';
}

export function evaluate(target, pool, rate) {
  const est = estimate(target, pool, rate);
  if (est.expected === null) return { ...est, verdict: 'few', pct: null, price_uzs: null, score: FEW_SCORE, suspicious: false };
  const price = toUzs(target.price, target.currency, rate);
  const pct = divRound((price - est.expected) * 100, est.expected);
  const suspicious = pct <= SUSPICIOUS_PCT;
  return { ...est, verdict: verdictOf(pct), pct, price_uzs: price, score: suspicious ? SUSPICIOUS_SCORE + pct : pct, suspicious };
}

export function evaluateAll(listings, rate) {
  return Object.fromEntries(listings.map((x) => [x.id, evaluate(x, listings, rate)]));
}

export function whereInBand(priceUzs, [lo, hi]) {
  const span = Math.max(hi - lo, 1);
  const pos = 10 + divRound((priceUzs - lo) * 80, span);
  return Math.max(0, Math.min(100, pos));
}
