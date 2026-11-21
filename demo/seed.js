// Demo people. The city itself (60 listings, slots, one waiting request) comes from the shared seed generator and
// is always relative to "now", so the demo works on any date and at any hour (also across New Year).
import { DemoBackend } from './backend.js';
import { LANDLORD_OTHER, STORY_CHEAP, STORY_EXPENSIVE } from '../shared/seedgen.js';

export const AZIZ = 1001; // the tenant: looking for a 2-room flat for his family
export const NODIRA = 3001; // the landlord: owns the "Arzon" flat in Chilonzor and one in Yunusobod
export const KAMOLA = 1002; // another tenant, already waiting for Nodira's answer
export { LANDLORD_OTHER, STORY_CHEAP, STORY_EXPENSIVE };
export const NEW_FLAT = {
  district: 'chilonzor', rooms: 2, area: 54, floor: 3, floors: 9, building: 'brick', renovation: 'cosmetic', furnished: 1, pets: 0,
  audience: 'family', amenities: ['fridge', 'washer', 'internet'], address: "Bog'bon ko'chasi, 7-uy, 12-xonadon", note: '',
  photo_seed: 202, currency: 'UZS',
};
export const TYPED_PRICES = ['8 900 000', '6 300 000']; // first too high, then inside the fair band
export const FINAL_PRICE = 6_300_000;

export function createDemo({ now, districts, people, lang = 'uz' }) {
  const b = new DemoBackend({ now, districts, people });
  for (const u of Object.values(b.users)) u.lang = lang;
  return b;
}
