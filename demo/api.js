// The Mini App's API, answered by the in-browser backend instead of HTTP (same shapes as uyijara/web.py).
// Errors carry the same codes the server would send, so the Mini App code is identical in both places.
import { presets } from '../shared/viewing.js';

export function apiFor(backend, uid) {
  const b = backend;
  const run = async (fn) => {
    try {
      return structuredClone(fn());
    } catch (e) {
      throw Object.assign(new Error(e.code ?? 'generic'), { code: e.code ?? 'generic' });
    }
  };
  const mut = (fn) => run(fn).then((r) => {
    b.emit({ type: 'changed', by: uid });
    return r;
  });
  return {
    me: () => run(() => {
      const u = b.user(uid);
      return { id: uid, name: u.name, lang: u.lang, phone: u.phone, admin: false, now: b.nowMs(), rate: b.rate,
        filter: b.lastFilter(uid) };
    }),
    setLang: (lang) => run(() => { b.setLang(uid, lang); return { lang }; }),
    setPhone: (phone) => mut(() => ({ phone: b.setPhone(uid, phone) })),
    search: (filter) => run(() => ({ ...b.search(uid, filter), now: b.nowMs() })),
    listing: (lid) => run(() => ({ ...b.card(uid, Number(lid)), now: b.nowMs() })),
    report: (lid, reason) => mut(() => { b.report(uid, Number(lid), reason); return { ok: true }; }),
    requestViewing: (slot) => mut(() => b.requestViewing(uid, Number(slot))),
    viewings: () => run(() => ({ items: b.myViewings(uid), now: b.nowMs() })),
    cancelViewing: (vid) => mut(() => b.cancelViewing(uid, Number(vid))),
    decide: (vid, accept) => mut(() => b.decide(uid, Number(vid), Boolean(accept))),
    subs: () => run(() => ({ items: b.mySubs(uid) })),
    addSub: (filter) => mut(() => b.addSub(uid, filter)),
    delSub: (sid) => mut(() => { b.deleteSub(uid, Number(sid)); return { ok: true }; }),
    landlord: () => run(() => ({ listings: b.myListings(uid), incoming: b.incoming(uid), presets: presets(b.nowMs()), now: b.nowMs() })),
    preview: (draft) => run(() => b.preview(uid, draft)),
    createListing: (listing) => mut(() => b.createListing(uid, listing)),
    updateListing: (lid, changes) => mut(() => b.updateListing(uid, Number(lid), changes)),
    setStatus: (lid, action) => mut(() => b.setStatus(uid, Number(lid), action)),
    addSlot: (lid, startAt) => mut(() => ({ slots: b.addSlot(uid, Number(lid), startAt) })),
    removeSlot: (lid, sid) => mut(() => ({ slots: b.removeSlot(uid, Number(lid), Number(sid)) })),
  };
}
