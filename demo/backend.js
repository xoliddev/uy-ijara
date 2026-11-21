// In-browser stand-in for the server: the same rules as uyijara/service.py and landlord.py, on the JS port of the
// core. Nothing leaves the browser. The clock can be moved forward to watch slots, expiry and alerts.
import { evaluate, evaluateAll } from '../shared/fair.js';
import { normalizePhone, ListingError } from '../shared/listing.js';
import { alertDue, defaultFilter, MAX_SUBS, normalize, run, SearchError } from '../shared/search.js';
import { world } from '../shared/seedgen.js';
import { checkRequest, contactsVisible, move, ViewingError } from '../shared/viewing.js';
import { DEFAULT_RATE } from '../shared/money.js';
import { installLandlord } from './backend-landlord.js';

const HOUR = 3_600_000;
const PUBLIC = ['id', 'district', 'rooms', 'area', 'floor', 'floors', 'building', 'renovation', 'furnished', 'pets', 'audience',
  'amenities', 'price', 'currency', 'note', 'photo_seed', 'pin_lat', 'pin_lon', 'status', 'published_at', 'updated_at',
  'expires_at', 'landlord_id'];
const EVAL = ['verdict', 'pct', 'expected', 'band', 'scope', 'n', 'n_all', 'factors', 'rooms_lo', 'rooms_hi', 'suspicious', 'score',
  'price_uzs'];
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const copy = (o) => structuredClone(o);

export class Refused extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function guard(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ListingError) throw new Refused(`l_${e.code}`);
    if (e instanceof SearchError) throw new Refused('filter');
    if (e instanceof ViewingError) throw new Refused(e.code);
    throw e;
  }
}

export class DemoBackend {
  constructor({ now = () => Date.now(), districts, people, rate = DEFAULT_RATE, admins = [] }) {
    Object.assign(this, { realNow: now, offset: 0, districts, rate, admins: new Set(admins), version: 0, cache: null });
    this.dmap = Object.fromEntries(districts.map((d) => [d.id, d]));
    this.listeners = new Set();
    const w = world(districts, people, this.nowMs());
    this.users = Object.fromEntries(w.users.map((u) => [u.id, { ...u, lang: 'uz', last_filter: null }]));
    this.listings = w.listings.map((x) => ({ ...x, hidden: 0 }));
    this.slots = w.slots.map((s, i) => ({ id: i + 1, ...s, status: 'open' }));
    this.viewings = [];
    for (const r of w.requests) {
      const s = this.slots.find((x) => x.listing_id === r.slot[0] && x.start_at === r.slot[1]);
      s.status = 'held';
      const x = this.listings.find((l) => l.id === s.listing_id);
      this.viewings.push({ id: this.viewings.length + 1, slot_id: s.id, listing_id: x.id, tenant_id: r.tenant_id,
        landlord_id: x.landlord_id, status: 'pending', created_at: r.created_at, decided_at: null });
    }
    this.subs = [];
    this.hits = new Set();
    this.reports = [];
  }

  // ── clock and events ──
  nowMs() { return this.realNow() + this.offset; }
  skipHours(n) { this.offset += n * HOUR; this.tick(); this.emit({ type: 'clock', now: this.nowMs() }); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }
  changed() { this.version += 1; }
  tick() {
    const due = this.expireDue();
    for (const x of due.listings) this.emit({ type: 'expired', to: x.landlord_id, x });
    for (const hit of this.runAlerts()) this.emit({ type: 'alert', to: hit.user_id, hit });
  }

  // ── users ──
  user(uid) { return this.users[uid]; }
  setLang(uid, lang) {
    if (!['uz', 'ru'].includes(lang)) throw new Refused('generic');
    this.users[uid].lang = lang;
  }
  setPhone(uid, phone) {
    const clean = guard(() => normalizePhone(phone));
    this.users[uid].phone = clean;
    return clean;
  }
  name(uid) { return this.users[uid]?.name ?? ''; }

  // ── pool and verdicts ──
  pool() {
    if (!this.cache || this.cache.v !== this.version) {
      const now = this.nowMs();
      const live = this.listings.filter((x) => x.status === 'active' && !x.hidden && x.expires_at > now);
      this.cache = { v: this.version, live, evals: evaluateAll(live, this.rate) };
    }
    return this.cache;
  }
  public(x, ev) {
    return { ...copy(pick(x, PUBLIC)), eval: ev ? copy(pick(ev, EVAL)) : null, landlord_name: this.name(x.landlord_id) };
  }
  row(lid) {
    const x = this.listings.find((l) => l.id === lid);
    if (!x) throw new Refused('not_found');
    return x;
  }

  // ── search ──
  normalize(data) { return guard(() => normalize(data, new Set(Object.keys(this.dmap)))); }
  lastFilter(uid) {
    const f = this.users[uid].last_filter;
    try { return f ? this.normalize(f) : defaultFilter(); } catch { return defaultFilter(); }
  }
  search(uid, data, limit = 60) {
    const f = this.normalize(data);
    this.users[uid].last_filter = copy(f);
    const { live, evals } = this.pool();
    const ids = run(f, live, evals, this.rate, this.dmap);
    const items = ids.slice(0, limit).map((id) => this.public(live.find((x) => x.id === id), evals[id]));
    return { filter: f, items, total: ids.length };
  }
  openSlots(lid) {
    const now = this.nowMs();
    return this.slots.filter((s) => s.listing_id === lid && s.status === 'open' && s.start_at > now)
      .sort((a, b) => a.start_at - b.start_at).slice(0, 12).map((s) => ({ id: s.id, start_at: s.start_at }));
  }
  card(uid, lid) {
    const x = this.row(lid);
    const own = x.landlord_id === uid;
    const visible = x.status === 'active' && !x.hidden && x.expires_at > this.nowMs();
    if (!visible && !own && !this.admins.has(uid)) throw new Refused('not_found');
    const { live, evals } = this.pool();
    const ev = evals[lid] ?? evaluate(x, live, this.rate);
    const out = this.public(x, ev);
    out.slots = this.openSlots(lid);
    const mine = this.viewings.filter((v) => v.listing_id === lid && v.tenant_id === uid && ['pending', 'accepted'].includes(v.status)).at(-1);
    out.my_viewing = mine ? this.viewing(mine.id) : null;
    out.own = own;
    out.contact = own || (mine && contactsVisible(mine.status))
      ? { address: x.address, lat: x.lat, lon: x.lon, phone: this.users[x.landlord_id]?.phone ?? null } : null;
    return out;
  }

  // ── viewings (tenant side) ──
  viewing(vid) {
    const v = this.viewings.find((r) => r.id === vid);
    if (!v) throw new Refused('not_found');
    return { ...v, start_at: this.slots.find((s) => s.id === v.slot_id).start_at };
  }
  requestViewing(uid, slotId) {
    if (!this.users[uid]?.phone) throw new Refused('no_phone');
    const now = this.nowMs();
    const s = this.slots.find((x) => x.id === slotId);
    const x = s && this.row(s.listing_id);
    if (!s || x.status !== 'active' || x.hidden || x.expires_at <= now) throw new Refused('not_found');
    const pending = this.viewings.filter((v) => v.tenant_id === uid && v.status === 'pending').length;
    const already = this.viewings.some((v) => v.tenant_id === uid && v.listing_id === x.id && ['pending', 'accepted'].includes(v.status));
    guard(() => checkRequest(s.status, s.start_at, now, pending, x.landlord_id === uid, already));
    s.status = 'held';
    const v = { id: this.viewings.length + 1, slot_id: s.id, listing_id: x.id, tenant_id: uid, landlord_id: x.landlord_id,
      status: 'pending', created_at: now, decided_at: null };
    this.viewings.push(v);
    const out = this.viewing(v.id);
    this.emit({ type: 'new_request', to: x.landlord_id, v: out });
    return out;
  }
  withContacts(v, uid) {
    const x = this.row(v.listing_id);
    const { evals } = this.pool();
    const out = { ...v, listing: this.public(x, evals[x.id]), contact: null };
    if (contactsVisible(v.status)) {
      const other = this.users[uid === v.tenant_id ? v.landlord_id : v.tenant_id] ?? {};
      out.contact = { phone: other.phone ?? null, name: other.name ?? '', address: x.address, lat: x.lat, lon: x.lon };
    }
    return out;
  }
  myViewings(uid) {
    const live = (s) => (['pending', 'accepted'].includes(s) ? 0 : 1);
    return this.viewings.filter((v) => v.tenant_id === uid).map((v) => this.viewing(v.id))
      .sort((a, b) => live(a.status) - live(b.status) || b.start_at - a.start_at).slice(0, 20).map((v) => this.withContacts(v, uid));
  }
  cancelViewing(uid, vid) {
    const v = this.viewings.find((r) => r.id === vid && (r.tenant_id === uid || r.landlord_id === uid));
    if (!v) throw new Refused('not_found');
    try { move(v.status, 'cancel'); } catch { throw new Refused('state'); }
    v.status = 'cancelled';
    v.decided_at = this.nowMs();
    const s = this.slots.find((x) => x.id === v.slot_id);
    if (['held', 'booked'].includes(s.status)) s.status = 'open';
    const out = this.viewing(vid);
    this.emit({ type: 'cancelled', to: uid === v.tenant_id ? v.landlord_id : v.tenant_id, v: out });
    return out;
  }

  // ── saved searches and reports ──
  addSub(uid, data) {
    const f = this.normalize(data);
    if (this.subs.filter((s) => s.user_id === uid).length >= MAX_SUBS) throw new Refused('too_many_subs');
    const sub = { id: this.subs.length + 1, user_id: uid, filter: f, created_at: this.nowMs() };
    this.subs.push(sub);
    return copy(sub);
  }
  mySubs(uid) { return this.subs.filter((s) => s.user_id === uid).map(copy); }
  deleteSub(uid, sid) {
    const i = this.subs.findIndex((s) => s.id === sid && s.user_id === uid);
    if (i < 0) throw new Refused('not_found');
    this.subs.splice(i, 1);
  }
  runAlerts() {
    const { live } = this.pool();
    const fired = [];
    for (const s of this.subs) {
      for (const x of live) {
        const key = `${s.id}:${x.id}`;
        if (this.hits.has(key) || !alertDue(s, x, this.rate, this.dmap[x.district])) continue;
        this.hits.add(key);
        fired.push({ sub_id: s.id, user_id: s.user_id, listing_id: x.id });
      }
    }
    return fired;
  }
  report(uid, lid, reason) {
    if (!['scam', 'price', 'rented', 'other'].includes(reason)) throw new Refused('generic');
    const x = this.row(lid);
    if (x.landlord_id === uid || x.status !== 'active') throw new Refused('not_found');
    if (this.reports.some((r) => r.listing_id === lid && r.reporter_id === uid)) throw new Refused('already_reported');
    this.reports.push({ id: this.reports.length + 1, listing_id: lid, reporter_id: uid, reason, status: 'open' });
    if (this.reports.filter((r) => r.listing_id === lid && r.status === 'open').length >= 3) {
      x.hidden = 1;
      this.changed();
    }
  }
}

installLandlord(DemoBackend, Refused, guard);
