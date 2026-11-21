// JS port of uyijara/core/listing.py: listing fields and their checks, phones, lifetime, duplicates, approximate pin.
import { DAY_MS } from './clock.js';
import { checkRange, PriceError, toUzs } from './money.js';

export const BUILDINGS = ['panel', 'brick', 'monolith', 'house'];
export const RENOVATIONS = ['none', 'cosmetic', 'euro', 'designer'];
export const AUDIENCES = ['any', 'family', 'students', 'women'];
export const AMENITIES = ['ac', 'washer', 'fridge', 'internet', 'parking', 'balcony', 'elevator', 'tv'];
export const ROOMS = [1, 6];
export const AREA = [12, 400];
export const FLOORS = [1, 40];
export const ADDRESS_MAX = 120;
export const NOTE_MAX = 300;
export const PHOTO_SEEDS = [1, 9999];
export const LIFETIME_MS = 30 * DAY_MS;
const FLOOR = /^\s*([0-9]{1,2})\s*[/\\|-]\s*([0-9]{1,2})\s*$/;
const CONTROL = new RegExp(`[\\x00-\\x1f\\x7f${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200f)}${
  String.fromCharCode(0x202a)}-${String.fromCharCode(0x202e)}${String.fromCharCode(0x2066)}-${String.fromCharCode(0x2069)}]`, 'g');

export class ListingError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export const clean = (text, limit) => Array.from(String(text ?? '').replace(CONTROL, ' ').split(/\s+/).filter(Boolean).join(' '))
  .slice(0, limit).join('');

export function whole(value, lo, hi, code) {
  let n;
  if (typeof value === 'string' && /^[0-9]{1,9}$/.test(value.trim())) n = Number(value.trim());
  else if (typeof value === 'number' && Number.isInteger(value)) n = value;
  else throw new ListingError(code);
  if (n < lo || n > hi) throw new ListingError(code);
  return n;
}

export function flag(value) {
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0' || value === null || value === undefined) return 0;
  throw new ListingError('flag');
}

export function parseFloor(text) {
  const m = FLOOR.exec(String(text ?? '').slice(0, 12));
  if (!m) throw new ListingError('floor');
  const floor = Number(m[1]);
  const floors = Number(m[2]);
  if (!(FLOORS[0] <= floor && floor <= floors && floors <= FLOORS[1])) throw new ListingError('floor');
  return [floor, floors];
}

export function normalizePhone(text) {
  let digits = String(text ?? '').slice(0, 32).replace(/[^0-9]/g, '');
  if (digits.length === 9) digits = `998${digits}`;
  if (digits.length !== 12 || !digits.startsWith('998') || digits[3] === '0') throw new ListingError('phone');
  return `+${digits}`;
}

export function fmtPhone(phone) {
  const d = phone.slice(1);
  return `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10, 12)}`;
}

export function validate(data, districts) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ListingError('generic');
  const { district } = data;
  if (typeof district !== 'string' || !districts.has(district)) throw new ListingError('district');
  const out = { district, rooms: whole(data.rooms, ...ROOMS, 'rooms'), area: whole(data.area, ...AREA, 'area') };
  const floor = whole(data.floor, ...FLOORS, 'floor');
  const floors = whole(data.floors, ...FLOORS, 'floor');
  if (floor > floors) throw new ListingError('floor');
  Object.assign(out, { floor, floors });
  for (const [key, allowed] of [['building', BUILDINGS], ['renovation', RENOVATIONS], ['audience', AUDIENCES]]) {
    if (!allowed.includes(data[key])) throw new ListingError(key);
    out[key] = data[key];
  }
  out.furnished = flag(data.furnished);
  out.pets = flag(data.pets);
  const amenities = data.amenities ?? [];
  if (!Array.isArray(amenities) || amenities.length > AMENITIES.length || amenities.some((a) => !AMENITIES.includes(a))) {
    throw new ListingError('amenities');
  }
  out.amenities = AMENITIES.filter((a) => amenities.includes(a));
  try {
    out.price = checkRange(data.price, data.currency);
  } catch (e) {
    if (e instanceof PriceError) throw new ListingError('price');
    throw e;
  }
  out.currency = data.currency;
  const address = clean(data.address, ADDRESS_MAX);
  if (address.length < 5) throw new ListingError('address');
  out.address = address;
  out.note = clean(data.note, NOTE_MAX);
  out.photo_seed = whole(data.photo_seed, ...PHOTO_SEEDS, 'photo');
  return out;
}

export const fingerprint = (l, rate) => `${l.district}|${l.area}|${toUzs(l.price, l.currency, rate)}|${l.photo_seed}`;
export const ownerKey = (landlordId, l) => `${landlordId}|${l.district}|${l.rooms}|${l.area}`;

const enc = new TextEncoder();
export function h32(text) {
  let h = 0x811c9dc5;
  for (const b of enc.encode(text)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function approxPoint(listingId, district) {
  const r = h32(`pin:${listingId}`);
  const lat = (Math.floor(district.lat * 100_000 + 0.5) + (r % 2401) - 1200) / 100_000;
  const lon = (Math.floor(district.lon * 100_000 + 0.5) + ((r >>> 12) % 2401) - 1200) / 100_000;
  return [lat, lon];
}

export const expiresAt = (startMs) => startMs + LIFETIME_MS;
