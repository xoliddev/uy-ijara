// JS port of uyijara/core/seedgen.py: the same 60 fictional listings, relative to "now".
import { MIN_MS, fdiv } from './clock.js';
import { quality } from './fair.js';
import { AMENITIES, approxPoint, expiresAt, h32 } from './listing.js';
import { DEFAULT_RATE, divRound, roundTo, USD, UZS } from './money.js';
import { presets } from './viewing.js';

export const PLAN = [['chilonzor', '222222221113334'], ['yunusobod', '22222133314'], ['mirzo-ulugbek', '222213334'],
  ['yakkasaroy', '2221323'], ['mirobod', '122232'], ['olmazor', '221323'], ['shayxontohur', '23'], ['sergeli', '21'],
  ['uchtepa', '2'], ['yashnobod', '3']];
const BASE_AREA = { 1: 36, 2: 54, 3: 72, 4: 92, 5: 115, 6: 140 };
export const DEMO_LANDLORD = 3001;
export const STORY_EXPENSIVE = 2;
export const STORY_CHEAP = 5;
export const SUSPICIOUS = 8;
export const OUTLIER = 22;
export const PAUSED = 37;
export const LANDLORD_OTHER = 18;
const PINS = {
  [STORY_EXPENSIVE]: { noise: 128, renovation: 'cosmetic', building: 'panel', floor: 1, floors: 5, furnished: 0, area: 52,
    currency: USD, landlord_id: 3005, age_min: 6 * 1440 + 200 },
  [STORY_CHEAP]: { noise: 80, renovation: 'euro', building: 'brick', floor: 4, floors: 9, furnished: 1, area: 58, currency: UZS,
    landlord_id: DEMO_LANDLORD, audience: 'any', pets: 1, amenities: ['ac', 'washer', 'fridge', 'internet', 'balcony', 'elevator'],
    age_min: 2 * 1440 + 75 },
  [SUSPICIOUS]: { noise: 45, currency: UZS, furnished: 1, age_min: 95 },
  [OUTLIER]: { noise: 250, renovation: 'designer', building: 'monolith', floors: 16, floor: 12 },
  [LANDLORD_OTHER]: { landlord_id: DEMO_LANDLORD, currency: UZS },
  [PAUSED]: { landlord_id: DEMO_LANDLORD, currency: UZS, status: 'paused' },
};
const pick = (pin, key, fallback) => (key in pin ? pin[key] : fallback);
const BUILD = ['panel', 'panel', 'panel', 'panel', 'panel', 'brick', 'brick', 'brick', 'monolith', 'monolith'];
const RENO = ['none', 'none', 'cosmetic', 'cosmetic', 'cosmetic', 'cosmetic', 'euro', 'euro', 'euro', 'designer'];
const AUD = ['any', 'any', 'any', 'any', 'any', 'family', 'family', 'students', 'students', 'women'];

function attrs(lid, district, rooms, nowMs) {
  const h = h32(`seed:${lid}`);
  const pin = PINS[lid] ?? {};
  let building = BUILD[(h >>> 4) % 10];
  if (rooms >= 3 && (h >>> 4) % 10 === 9) building = 'house';
  building = pick(pin, 'building', building);
  let floors;
  if (building === 'house') floors = 1 + ((h >>> 6) % 2);
  else if (building === 'monolith') floors = 9 + ((h >>> 6) % 8);
  else floors = (building === 'panel' ? [4, 5, 9] : [3, 4, 5])[(h >>> 6) % 3];
  floors = pick(pin, 'floors', floors);
  const floor = pick(pin, 'floor', building === 'house' ? 1 : 1 + ((h >>> 18) % floors));
  const am = h32(`am:${lid}`);
  let amenities = AMENITIES.filter((_, k) => (am >>> k) & 1);
  if (floors < 5) amenities = amenities.filter((a) => a !== 'elevator');
  const out = {
    id: lid, district: district.id, rooms, area: pick(pin, 'area', BASE_AREA[rooms] + (h % 13) - 4), floor, floors, building,
    renovation: pick(pin, 'renovation', RENO[(h >>> 8) % 10]),
    furnished: pick(pin, 'furnished', (h >>> 12) % 10 < 7 ? 1 : 0),
    audience: pick(pin, 'audience', AUD[(h >>> 14) % 10]),
    pets: pick(pin, 'pets', (h >>> 17) % 10 < 3 ? 1 : 0),
    amenities: pick(pin, 'amenities', amenities),
    landlord_id: pick(pin, 'landlord_id', 3002 + ((h >>> 5) % 9)),
    photo_seed: 1 + ((h >>> 7) % 9999),
    status: pick(pin, 'status', 'active'),
    note: '',
  };
  const noise = pick(pin, 'noise', 88 + ((h >>> 24) % 28));
  const uzs = roundTo(fdiv(fdiv(district.ppm * out.area * quality(out), 100) * noise, 100), 50_000);
  const currency = pick(pin, 'currency', (h >>> 9) % 10 < 2 ? USD : UZS);
  out.currency = currency;
  out.price = currency === USD ? Math.max(25, roundTo(divRound(uzs, DEFAULT_RATE), 10)) : uzs;
  const street = district.streets[(h >>> 20) % district.streets.length];
  const house = 1 + ((h >>> 11) % 60);
  out.address = building === 'house' ? `${street} ko'chasi, ${house}-uy`
    : `${street} ko'chasi, ${house}-uy, ${1 + ((h >>> 13) % 80)}-xonadon`;
  const e = h32(`exact:${lid}`);
  out.lat = (Math.floor(district.lat * 100_000 + 0.5) + (e % 2001) - 1000) / 100_000;
  out.lon = (Math.floor(district.lon * 100_000 + 0.5) + ((e >>> 11) % 2001) - 1000) / 100_000;
  [out.pin_lat, out.pin_lon] = approxPoint(lid, district);
  const age = pick(pin, 'age_min', 30 + ((h >>> 3) % (25 * 1440)));
  const minute = fdiv(nowMs, MIN_MS);
  out.published_at = (minute - age) * MIN_MS;
  out.updated_at = Math.max(out.published_at, (minute - 5 - ((h >>> 13) % 900)) * MIN_MS);
  out.expires_at = expiresAt(out.published_at);
  return out;
}

export function listings(districts, nowMs) {
  const byId = Object.fromEntries(districts.map((d) => [d.id, d]));
  const out = [];
  let lid = 0;
  for (const [did, plan] of PLAN) {
    for (const ch of plan) {
      lid += 1;
      out.push(attrs(lid, byId[did], Number(ch), nowMs));
    }
  }
  return out;
}

export function slots(rows, nowMs) {
  const times = presets(nowMs);
  const out = [];
  for (const x of rows) {
    if (x.status !== 'active') continue;
    let picks;
    if (x.id === STORY_CHEAP) picks = times.slice(0, 3);
    else if (x.id === LANDLORD_OTHER) picks = [times[0], times[3]];
    else if (x.id % 3 === 0) picks = [times[1], times[4]];
    else continue;
    for (const t of picks) out.push({ listing_id: x.id, start_at: t });
  }
  return out;
}

export function world(districts, people, nowMs) {
  const rows = listings(districts, nowMs);
  const free = slots(rows, nowMs);
  const taken = free.find((s) => s.listing_id === LANDLORD_OTHER);
  const requests = [{ slot: [taken.listing_id, taken.start_at], tenant_id: 1002, created_at: (fdiv(nowMs, MIN_MS) - 42) * MIN_MS }];
  return { users: [...people.landlords, ...people.tenants], listings: rows, slots: free, requests, landlord: DEMO_LANDLORD };
}
