// JS port of uyijara/core/search.py: filters, text search over places and features, sorting, saved-search matching.
import { AUDIENCES, clean } from './listing.js';
import { CURRENCIES, LIMITS, toUzs, UZS } from './money.js';
import { wordScore, words } from './text.js';

export const SORTS = ['fair', 'new', 'cheap'];
export const AUD_FILTERS = ['', 'family', 'students', 'women'];
export const ROOM_FILTERS = [0, 1, 2, 3, 4];
export const AREA_FILTERS = [0, 30, 45, 60, 80, 100];
export const BUDGETS = [[0, 0], [0, 3_000_000], [3_000_000, 5_000_000], [5_000_000, 8_000_000], [8_000_000, 12_000_000],
  [12_000_000, 0]];
export const MAX_SUBS = 5;
export const TERMS = {
  building_panel: ['panel', 'панель', 'панельный'],
  building_brick: ["g'isht", 'гишт', 'кирпич', 'kirpich'],
  building_monolith: ['monolit', 'монолит', 'novostroyka', 'новостройка'],
  building_house: ['hovli', 'ҳовли', 'дом', 'hovlili'],
  renovation_euro: ['yevro', 'евро', 'evro', 'euro'],
  renovation_designer: ['dizayner', 'дизайнерский', 'дизайн'],
  furnished: ['mebel', 'mebelli', 'мебель', 'меблированная'],
  pets: ['hayvon', 'hayvonlar', 'животные', 'питомцы'],
  audience_family: ['oila', 'oilaviy', 'семья', 'семейная'],
  audience_students: ['talaba', 'talabalar', 'студент', 'студенты'],
  audience_women: ['ayol', 'ayollar', 'qizlar', 'девушки', 'женщины'],
};
export const STOP = ['xona', 'xonali', 'komnata', 'комнатная', 'комнат', 'kvartira', 'квартира', 'uy', 'ijara', 'ijaraga',
  'аренда', 'arenda', 'снять', 'сдается', 'va', 'и', 'в'];
const TERM_KEYS = Object.fromEntries(Object.entries(TERMS).map(([k, v]) => [k, v.flatMap((t) => words(t))]));
const STOP_KEYS = STOP.flatMap((t) => words(t));

export class SearchError extends Error {
  constructor(code = 'filter') {
    super(code);
    this.code = code;
  }
}

export const defaultFilter = () => ({ district: '', rooms: 0, price_min: 0, price_max: 0, currency: UZS, furnished: 0, pets: 0,
  audience: '', min_area: 0, q: '', sort: 'fair' });

function int(v, lo, hi) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new SearchError();
  return v;
}

export function normalize(data, districts) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SearchError();
  const f = defaultFilter();
  for (const k of Object.keys(f)) if (k in data && data[k] !== null && data[k] !== undefined) f[k] = data[k];
  if (typeof f.district !== 'string' || (f.district && !districts.has(f.district))) throw new SearchError();
  if (!CURRENCIES.includes(f.currency) || !SORTS.includes(f.sort) || !AUD_FILTERS.includes(f.audience)) throw new SearchError();
  const hi = LIMITS[f.currency][1];
  const out = { district: f.district, rooms: int(f.rooms, 0, 4), price_min: int(f.price_min, 0, hi),
    price_max: int(f.price_max, 0, hi), currency: f.currency, furnished: int(f.furnished, 0, 1), pets: int(f.pets, 0, 1),
    audience: f.audience, min_area: int(f.min_area, 0, 400), q: typeof f.q === 'string' ? clean(f.q, 64) : '', sort: f.sort };
  if (out.price_max && out.price_min > out.price_max) throw new SearchError();
  return out;
}

export function keysFor(l, district) {
  let keys = [...words(district.name.uz), ...words(district.name.ru)];
  for (const alias of district.aliases ?? []) keys = keys.concat(words(alias));
  const tags = [`building_${l.building}`, `renovation_${l.renovation}`];
  if (l.furnished) tags.push('furnished');
  if (l.pets) tags.push('pets');
  for (const a of AUDIENCES.slice(1)) if (l.audience === 'any' || l.audience === a) tags.push(`audience_${a}`);
  for (const tag of tags) keys = keys.concat(TERM_KEYS[tag] ?? []);
  return keys;
}

export function textMatch(q, l, keys) {
  for (const w of words(q)) {
    if (/^\d+$/.test(w)) {
      const n = Number(w);
      if (n >= 1 && n <= 6 && l.rooms !== n) return false;
      continue;
    }
    if (STOP_KEYS.some((s) => [0, 1].includes(wordScore(w, s)))) continue;
    if (!keys.some((k) => wordScore(w, k) !== null)) return false;
  }
  return true;
}

export function matches(f, l, rate, keys = null) {
  if (f.district && l.district !== f.district) return false;
  if (f.rooms && (f.rooms === 4 ? l.rooms < 4 : l.rooms !== f.rooms)) return false;
  const price = toUzs(l.price, l.currency, rate);
  if (f.price_min && price < toUzs(f.price_min, f.currency, rate)) return false;
  if (f.price_max && price > toUzs(f.price_max, f.currency, rate)) return false;
  if (f.furnished && !l.furnished) return false;
  if (f.pets && !l.pets) return false;
  if (f.audience && l.audience !== 'any' && l.audience !== f.audience) return false;
  if (f.min_area && l.area < f.min_area) return false;
  return !f.q || (keys !== null && textMatch(f.q, l, keys));
}

export function sortKey(sort, l, ev, rate) {
  if (sort === 'new') return [-l.published_at, -l.id];
  if (sort === 'cheap') return [toUzs(l.price, l.currency, rate), -l.id];
  return [ev?.score ?? 1_000_000, -l.published_at, -l.id];
}

const cmp = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
};

export function run(f, listings, evals, rate, districts) {
  const hits = listings.filter((x) => matches(f, x, rate, f.q ? keysFor(x, districts[x.district]) : null));
  const keyed = hits.map((x) => [sortKey(f.sort, x, evals[x.id], rate), x.id]);
  keyed.sort((a, b) => cmp(a[0], b[0]));
  return keyed.map(([, id]) => id);
}

export function alertDue(sub, l, rate, district) {
  if (l.published_at < sub.created_at || l.landlord_id === sub.user_id) return false;
  return matches(sub.filter, l, rate, sub.filter.q ? keysFor(l, district) : null);
}
