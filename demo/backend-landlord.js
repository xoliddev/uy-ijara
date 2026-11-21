// Landlord actions for the in-browser backend (ports uyijara/landlord.py): own listings only, duplicates refused,
// the live band, slots, accept / decline, and the 30-day lifetime.
import { estimate, evaluate } from '../shared/fair.js';
import { approxPoint, expiresAt, fingerprint, ownerKey, validate } from '../shared/listing.js';
import { checkTime, MAX_OPEN_SLOTS, move } from '../shared/viewing.js';

const DRAFT = { district: 'chilonzor', rooms: 2, area: 50, floor: 2, floors: 5, building: 'brick', renovation: 'cosmetic', furnished: 0,
  pets: 0, audience: 'any', amenities: [], price: 5_000_000, currency: 'UZS', address: '-----', note: '', photo_seed: 1 };
const EDITABLE = ['price', 'currency', 'note', 'furnished', 'pets', 'amenities', 'renovation', 'audience', 'address'];
const LIVE = ['active', 'paused'];

export function installLandlord(Backend, Refused, guard) {
  const p = Backend.prototype;

  p.preview = function preview(uid, data) {
    if (!data || typeof data !== 'object') throw new Refused('generic');
    const hasPrice = ![null, undefined, '', 0].includes(data.price);
    const draft = { ...DRAFT };
    for (const k of Object.keys(DRAFT)) if (data[k] !== null && data[k] !== undefined) draft[k] = data[k];
    const clean = guard(() => validate(draft, new Set(Object.keys(this.dmap))));
    clean.id = Number.isInteger(data.id) ? data.id : null;
    const pool = this.pool().live.filter((x) => x.id !== clean.id);
    return { ...(hasPrice ? evaluate(clean, pool, this.rate) : estimate(clean, pool, this.rate)), has_price: hasPrice };
  };

  p.owned = function owned(uid, lid) {
    const x = this.listings.find((l) => l.id === lid && l.landlord_id === uid);
    if (!x) throw new Refused('not_found');
    return x;
  };

  p.myListings = function myListings(uid) {
    const { evals } = this.pool();
    const rank = (s) => (s === 'active' ? 0 : 1);
    return this.listings.filter((x) => x.landlord_id === uid && x.status !== 'removed')
      .sort((a, b) => rank(a.status) - rank(b.status) || b.id - a.id).slice(0, 50)
      .map((x) => ({ ...this.public(x, evals[x.id]), address: x.address, hidden: x.hidden,
        pending: this.viewings.filter((v) => v.listing_id === x.id && v.status === 'pending').length, slots: this.openSlots(x.id) }));
  };

  p.checkDuplicates = function checkDuplicates(uid, clean, skip = 0) {
    const fp = fingerprint(clean, this.rate);
    const key = ownerKey(uid, clean);
    const twin = this.listings.some((x) => LIVE.includes(x.status) && x.id !== skip
      && (fingerprint(x, this.rate) === fp || ownerKey(x.landlord_id, x) === key));
    if (twin) throw new Refused('duplicate');
  };

  p.createListing = function createListing(uid, data) {
    if (!this.users[uid]?.phone) throw new Refused('no_phone');
    const clean = guard(() => validate(data, new Set(Object.keys(this.dmap))));
    if (this.listings.filter((x) => x.landlord_id === uid && LIVE.includes(x.status)).length >= 20) throw new Refused('too_many_listings');
    this.checkDuplicates(uid, clean);
    const now = this.nowMs();
    const id = Math.max(...this.listings.map((x) => x.id)) + 1;
    const [pinLat, pinLon] = approxPoint(id, this.dmap[clean.district]);
    this.listings.push({ ...clean, id, landlord_id: uid, lat: null, lon: null, pin_lat: pinLat, pin_lon: pinLon, status: 'active',
      hidden: 0, published_at: now, updated_at: now, expires_at: expiresAt(now) });
    this.changed();
    this.emit({ type: 'changed' });
    return this.card(uid, id);
  };

  p.updateListing = function updateListing(uid, lid, changes) {
    if (!changes || typeof changes !== 'object' || !Object.keys(changes).length || Object.keys(changes).some((k) => !EDITABLE.includes(k))) {
      throw new Refused('generic');
    }
    const x = this.owned(uid, lid);
    if (x.status === 'removed') throw new Refused('not_found');
    const clean = guard(() => validate({ ...x, ...changes }, new Set(Object.keys(this.dmap))));
    this.checkDuplicates(uid, clean, lid);
    Object.assign(x, pick(clean, EDITABLE), { updated_at: this.nowMs() });
    this.changed();
    return this.card(uid, lid);
  };

  p.setStatus = function setStatus(uid, lid, action) {
    const x = this.owned(uid, lid);
    const now = this.nowMs();
    const moves = { pause: ['active'], resume: ['paused'], renew: ['active', 'paused', 'expired'] };
    if (!moves[action]?.includes(x.status)) throw new Refused('state');
    if (action === 'pause') x.status = 'paused';
    else if (action === 'resume') {
      if (x.expires_at <= now) throw new Refused('expired');
      x.status = 'active';
    } else {
      if (x.status === 'expired') this.checkDuplicates(uid, x, lid);
      x.status = x.status === 'paused' ? 'paused' : 'active';
      Object.assign(x, { expires_at: expiresAt(now), updated_at: now });
    }
    this.changed();
    return this.card(uid, lid);
  };

  p.addSlot = function addSlot(uid, lid, startAt) {
    const x = this.owned(uid, lid);
    if (!LIVE.includes(x.status)) throw new Refused('state');
    guard(() => checkTime(startAt, this.nowMs()));
    if (this.openSlots(lid).length >= MAX_OPEN_SLOTS) throw new Refused('too_many_slots');
    const s = this.slots.find((r) => r.listing_id === lid && r.start_at === startAt);
    if (!s) this.slots.push({ id: this.slots.length + 1, listing_id: lid, start_at: startAt, status: 'open' });
    else if (s.status === 'cancelled') s.status = 'open';
    return this.openSlots(lid);
  };

  p.removeSlot = function removeSlot(uid, lid, slotId) {
    this.owned(uid, lid);
    const s = this.slots.find((r) => r.id === slotId && r.listing_id === lid && r.status === 'open');
    if (!s) throw new Refused('slot_taken');
    s.status = 'cancelled';
    return this.openSlots(lid);
  };

  p.incoming = function incoming(uid) {
    const rank = (s) => (s === 'pending' ? 0 : 1);
    return this.viewings.filter((v) => v.landlord_id === uid && ['pending', 'accepted'].includes(v.status)).map((v) => this.viewing(v.id))
      .sort((a, b) => rank(a.status) - rank(b.status) || a.start_at - b.start_at).slice(0, 30)
      .map((v) => ({ ...this.withContacts(v, uid), tenant_name: this.name(v.tenant_id) }));
  };

  p.decide = function decide(uid, vid, accept) {
    const v = this.viewings.find((r) => r.id === vid && r.landlord_id === uid);
    if (!v) throw new Refused('not_found');
    let status;
    try { status = move(v.status, accept ? 'accept' : 'decline'); } catch { throw new Refused('state'); }
    const s = this.slots.find((r) => r.id === v.slot_id);
    if (accept && s.start_at <= this.nowMs()) throw new Refused('slot_time');
    Object.assign(v, { status, decided_at: this.nowMs() });
    s.status = accept ? 'booked' : 'open';
    const out = this.withContacts(this.viewing(vid), uid);
    this.emit({ type: 'decided', to: v.tenant_id, v: this.viewing(vid) });
    return out;
  };

  p.expireDue = function expireDue() {
    const now = this.nowMs();
    const gone = this.listings.filter((x) => LIVE.includes(x.status) && x.expires_at <= now);
    for (const x of gone) x.status = 'expired';
    const late = this.viewings.filter((v) => v.status === 'pending' && this.viewing(v.id).start_at <= now);
    for (const v of late) Object.assign(v, { status: 'expired', decided_at: now });
    if (gone.length) this.changed();
    return { listings: gone.map((x) => ({ id: x.id, landlord_id: x.landlord_id })), viewings: late };
  };
}

function pick(o, keys) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}
