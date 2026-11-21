// The bot, simulated in the page (ports uyijara/bot/handlers_*.py): the same buttons, callback data and texts.
// Messages are {id, from: 'bot' | 'me', html, kb, at}; pressing a button edits that message like Telegram does.
import { fmtPhone } from '../shared/listing.js';
import { AREA_FILTERS, AUD_FILTERS, BUDGETS, SORTS } from '../shared/search.js';
import { districtName, money, slotLabel, title, verdictLine } from '../shared/i18n.js';
import { Refused } from './backend.js';

const strip = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const REASONS = ['scam', 'price', 'rented', 'other'];

export class BotSim {
  constructor(backend, uid, t, views, { onChange = () => {}, onAlert = () => {}, onApp = () => {} } = {}) {
    Object.assign(this, { b: backend, uid, t, v: views, onChange, onAlert, onApp });
    this.messages = [];
    this.ids = 1;
    this.after = null;
  }

  get user() { return this.b.user(this.uid); }
  get lang() { return this.user.lang; }

  push(screen, from = 'bot') {
    const msg = { id: this.ids++, from, html: screen.html, kb: screen.kb ?? [], at: this.b.nowMs() };
    this.messages.push(msg);
    this.onChange();
    return msg;
  }

  show(id, screen) {
    const msg = id && this.messages.find((m) => m.id === id);
    if (!msg) return this.push(screen);
    Object.assign(msg, { html: screen.html, kb: screen.kb ?? [] });
    this.onChange();
    return msg;
  }

  guard(fn, typed = false) {
    try {
      return fn();
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      const key = this.t(this.lang, `err.${e.code}`) === `err.${e.code}` ? 'err.generic' : `err.${e.code}`;
      if (typed) return this.push({ html: this.t(this.lang, key) });
      this.onAlert(strip(this.t(this.lang, key)));
      return null;
    }
  }

  start() {
    this.push({ html: '/start' }, 'me');
    this.after = null;
    this.push(this.v.mainMenu(this.lang, this.user, true));
  }

  type(text) {
    this.push({ html: text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }, 'me');
    if (this.after) {
      this.guard(() => this.gotPhone(text), true);
      return;
    }
    this.push(this.v.mainMenu(this.lang, this.user));
  }

  /** The "share contact" button: the demo phone's own fictional number. */
  shareContact(phone) {
    this.push({ html: this.t(this.lang, 'demo.contact') }, 'me');
    this.guard(() => this.gotPhone(phone), true);
  }

  gotPhone(text) {
    const phone = this.b.setPhone(this.uid, text);
    this.push({ html: this.t(this.lang, 'phone.saved', { phone: fmtPhone(phone) }) });
    const next = this.after;
    this.after = null;
    if (next?.startsWith('q:')) return this.slots(null, Number(next.slice(2)));
    return this.push(this.v.mainMenu(this.lang, this.user));
  }

  results(id, f, page = 0) {
    const { filter, items, total } = this.b.search(this.uid, f ?? this.b.lastFilter(this.uid));
    const p = items.length ? Math.max(0, Math.min(page, Math.floor((items.length - 1) / 5))) : 0;
    return this.show(id, this.v.results(this.lang, filter, items, total, p));
  }

  slots(id, lid) {
    const x = this.b.card(this.uid, lid);
    if (x.own) throw new Refused('own_listing');
    if (!x.slots.length) throw new Refused('slot_taken');
    return this.show(id, this.v.slots(this.lang, x, this.b.nowMs()));
  }

  landlordHome(id) {
    const mine = this.b.myListings(this.uid);
    return this.show(id, this.v.landlordHome(this.lang, mine.filter((x) => x.status === 'active').length,
      mine.reduce((s, x) => s + x.pending, 0)));
  }

  /** A button press. Unknown or tampered data gets the same "stale button" answer as the real bot. */
  press(id, data) {
    const r = this.guard(() => this.route(id, String(data)));
    if (r === false) this.onAlert(strip(this.t(this.lang, 'err.stale')));
  }

  route(id, data) {
    const [kind, ...p] = data.split(':');
    const lang = this.lang;
    const now = this.b.nowMs();
    const num = (s) => (/^\d{1,9}$/.test(s ?? '') ? Number(s) : null);
    if (kind === 'n') {
      const to = p[0];
      if (to === 'menu') return this.show(id, this.v.mainMenu(lang, this.user));
      if (to === 'lang') { this.b.setLang(this.uid, lang === 'uz' ? 'ru' : 'uz'); return this.show(id, this.v.mainMenu(this.lang, this.user)); }
      if (to === 'search') return this.show(id, this.v.pickDistrict(lang, this.b.districts));
      if (to === 'viewings') return this.show(id, this.v.viewings(lang, this.b.myViewings(this.uid), now));
      if (to === 'saved') return this.show(id, this.v.subs(lang, this.b.mySubs(this.uid)));
      if (to === 'save') {
        this.b.addSub(this.uid, this.b.lastFilter(this.uid));
        this.onAlert(strip(this.t(lang, 'search.saved')));
        return this.show(id, this.v.subs(lang, this.b.mySubs(this.uid)));
      }
      if (to === 'landlord') return this.landlordHome(id);
      if (to === 'requests') return this.show(id, this.v.requests(lang, this.b.incoming(this.uid), now));
      return false;
    }
    if (kind === 'w') {
      const f = this.b.lastFilter(this.uid);
      if (p[0] === 'd' && (p[1] === '-' || p[1] in this.b.dmap)) {
        f.district = p[1] === '-' ? '' : p[1];
        this.b.search(this.uid, f, 0);
        return this.show(id, this.v.pickRooms(lang));
      }
      if (p[0] === 'r' && ['0', '1', '2', '3', '4'].includes(p[1])) {
        f.rooms = Number(p[1]);
        this.b.search(this.uid, f, 0);
        return this.show(id, this.v.pickBudget(lang, f));
      }
      const n = num(p[1]);
      if (p[0] === 'b' && n !== null && n < BUDGETS.length) {
        [f.price_min, f.price_max] = BUDGETS[n];
        f.currency = 'UZS';
        return this.results(id, f);
      }
      return false;
    }
    if (kind === 'f') {
      const f = this.b.lastFilter(this.uid);
      const n = num(p[1]);
      const limits = { s: SORTS.length, g: 10, m: 2, p: 2, a: AUD_FILTERS.length, z: AREA_FILTERS.length, x: 1 };
      if (!(p[0] in limits) || n === null || n >= limits[p[0]]) return false;
      if (p[0] === 'g') return this.results(id, f, n);
      if (p[0] === 's') { f.sort = SORTS[n]; return this.results(id, f); }
      if (p[0] === 'm') f.furnished = n;
      if (p[0] === 'p') f.pets = n;
      if (p[0] === 'a') f.audience = AUD_FILTERS[n];
      if (p[0] === 'z') f.min_area = AREA_FILTERS[n];
      return this.show(id, this.v.filters(lang, this.b.search(this.uid, f, 0).filter));
    }
    const n0 = num(p[0]);
    if (kind === 'l' && n0) return this.show(id, this.v.card(lang, this.b.card(this.uid, n0), now));
    if (kind === 'q' && n0) {
      if (!this.user.phone) {
        this.after = `q:${n0}`;
        return this.push({ html: this.t(lang, 'phone.ask'), kb: [[{ text: this.t(lang, 'btn.share_phone'), contact: true }]] });
      }
      return this.slots(id, n0);
    }
    if (kind === 't' && n0) return this.show(id, this.v.sent(lang, this.b.requestViewing(this.uid, n0), now));
    if (kind === 'rp' && n0 && ['0', '1', '2', '3', '4'].includes(p[1])) {
      if (p[1] === '0') { this.b.card(this.uid, n0); return this.show(id, this.v.reportAsk(lang, n0)); }
      this.b.report(this.uid, n0, REASONS[Number(p[1]) - 1]);
      this.onAlert(strip(this.t(lang, 'report.done')));
      return this.show(id, this.v.mainMenu(lang, this.user));
    }
    if (kind === 'v' && n0 && ['c', 'y', 'n'].includes(p[1])) {
      if (p[1] === 'c') {
        const v = this.b.cancelViewing(this.uid, n0);
        if (v.landlord_id === this.uid) return this.show(id, this.v.requests(lang, this.b.incoming(this.uid), now));
        return this.show(id, this.v.viewings(lang, this.b.myViewings(this.uid), now));
      }
      this.b.decide(this.uid, n0, p[1] === 'y');
      return this.show(id, this.v.requests(lang, this.b.incoming(this.uid), now));
    }
    if (kind === 'sd' && n0) {
      this.b.deleteSub(this.uid, n0);
      return this.show(id, this.v.subs(lang, this.b.mySubs(this.uid)));
    }
    return false;
  }

  /** Something the bot sends on its own (backend event). Returns the new message. */
  deliver(ev) {
    const lang = this.lang;
    const t = this.t;
    const about = (v) => {
      const x = this.b.row(v.listing_id);
      return { x, title: title(t, lang, x), district: districtName(lang, x.district, this.b.dmap), when: slotLabel(t, lang, v.start_at, this.b.nowMs()) };
    };
    if (ev.type === 'new_request') {
      const a = about(ev.v);
      return this.push({ html: t(lang, 'notify.new_request', { tenant: this.b.name(ev.v.tenant_id), title: a.title, district: a.district, when: a.when }),
        kb: [[{ text: t(lang, 'btn.accept'), data: `v:${ev.v.id}:y` }, { text: t(lang, 'btn.decline'), data: `v:${ev.v.id}:n` }]] });
    }
    if (ev.type === 'decided') {
      const a = about(ev.v);
      const owner = this.b.user(ev.v.landlord_id);
      const html = ev.v.status === 'accepted'
        ? t(lang, 'notify.accepted', { when: a.when, title: a.title, district: a.district, address: a.x.address, name: owner.name,
          phone: owner.phone ? fmtPhone(owner.phone) : '—' })
        : t(lang, 'notify.declined', { title: a.title, district: a.district, when: a.when });
      return this.push({ html, kb: [[{ text: t(lang, 'btn.view'), data: `l:${ev.v.listing_id}` }]] });
    }
    if (ev.type === 'cancelled') {
      const a = about(ev.v);
      return this.push({ html: t(lang, 'notify.cancelled', { title: a.title, district: a.district, when: a.when }) });
    }
    if (ev.type === 'expired') {
      const x = this.b.row(ev.x.id);
      return this.push({ html: t(lang, 'notify.expired', { title: title(t, lang, x), district: districtName(lang, x.district, this.b.dmap) }) });
    }
    if (ev.type === 'alert') {
      const x = this.b.row(ev.hit.listing_id);
      const ev2 = this.b.pool().evals[x.id];
      return this.push({ html: t(lang, 'notify.alert', { title: title(t, lang, x), district: districtName(lang, x.district, this.b.dmap),
        price: money(t, lang, x.price, x.currency), verdict: verdictLine(t, lang, ev2) }),
      kb: [[{ text: t(lang, 'btn.view'), data: `l:${x.id}` }], [{ text: t(lang, 'btn.app'), app: `#l=${x.id}` }]] });
    }
    return null;
  }
}
