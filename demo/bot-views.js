// JS port of uyijara/bot/views.py and views_landlord.py: the same screens, locale keys and callback data
// ("w:d:chilonzor", "l:5", "v:3:y"...), as {html, kb} where kb rows hold {text, data} or {text, app}.
import { fmtPhone } from '../shared/listing.js';
import { AREA_FILTERS, AUD_FILTERS, BUDGETS, SORTS } from '../shared/search.js';
import * as I from '../shared/i18n.js';

const PAGE = 5;
const esc = (s) => I.escapeHtml(s);

export function makeViews(t, dmap, rate) {
  const b = (text, data) => (data.startsWith('@app') ? { text, app: data.slice(4) } : { text, data });
  const back = (lang, data) => [b(t(lang, 'btn.back'), data)];
  const grid = (buttons, n) => Array.from({ length: Math.ceil(buttons.length / n) }, (_, i) => buttons.slice(i * n, i * n + n));
  const S = (html, kb) => ({ html, kb: kb.filter((r) => r.length) });
  const money = (lang, a, c) => I.money(t, lang, a, c);
  const title = (lang, x) => I.title(t, lang, x);
  const dname = (lang, id) => I.districtName(lang, id, dmap);
  const when = (lang, ms, now) => I.slotLabel(t, lang, ms, now);
  const roomsLabel = (lang, n) => (n >= 4 ? t(lang, 'rooms.4') : t(lang, 'rooms.n', { n }));

  function summary(lang, f) {
    const parts = [f.district ? dname(lang, f.district) : t(lang, 'district.any')];
    if (f.rooms) parts.push(roomsLabel(lang, f.rooms));
    const bi = f.currency === 'UZS' ? BUDGETS.findIndex(([lo, hi]) => lo === f.price_min && hi === f.price_max) : -1;
    if (bi > 0) parts.push(t(lang, `budget.${bi}`));
    else if (bi < 0 && f.price_max) parts.push(`≤ ${money(lang, f.price_max, f.currency)}`);
    if (f.furnished) parts.push(t(lang, 'btn.furnished').toLowerCase());
    if (f.pets) parts.push(t(lang, 'btn.pets').toLowerCase());
    if (f.audience) parts.push(t(lang, `audience.${f.audience}`).toLowerCase());
    if (f.min_area) parts.push(t(lang, 'area.n', { n: f.min_area }));
    if (f.q) parts.push(`«${esc(f.q)}»`);
    return parts.join(' · ');
  }

  const V = {
    summary,
    mainMenu(lang, user, hello = false) {
      return S(t(lang, hello ? 'start.hello' : 'start.menu'), [[b(t(lang, 'btn.search'), 'n:search')],
        [b(t(lang, 'btn.saved'), 'n:saved'), b(t(lang, 'btn.viewings'), 'n:viewings')], [b(t(lang, 'btn.landlord'), 'n:landlord')],
        [b(t(lang, 'btn.app'), '@app')], [b(t(lang, 'btn.lang'), 'n:lang')]]);
    },
    pickDistrict(lang, districts) {
      return S(t(lang, 'search.district'), [...grid(districts.map((d) => b(d.name[lang], `w:d:${d.id}`)), 3),
        [b(t(lang, 'district.any'), 'w:d:-')], back(lang, 'n:menu')]);
    },
    pickRooms: (lang) => S(t(lang, 'search.rooms'), [[1, 2, 3, 4].map((n) => b(roomsLabel(lang, n), `w:r:${n}`)),
      [b(t(lang, 'btn.any'), 'w:r:0')], back(lang, 'n:search')]),
    pickBudget(lang, f) {
      return S(t(lang, 'search.budget'), [...grid(BUDGETS.slice(1).map((_, i) => b(t(lang, `budget.${i + 1}`), `w:b:${i + 1}`)), 3),
        [b(t(lang, 'budget.0'), 'w:b:0')], back(lang, `w:d:${f.district || '-'}`)]);
    },
    results(lang, f, items, total, page) {
      if (!total) {
        return S(`${summary(lang, f)}\n\n${t(lang, 'search.none')}`, [[b(t(lang, 'btn.filters'), 'f:x:0'),
          b(t(lang, 'btn.save_search'), 'n:save')], back(lang, 'n:search')]);
      }
      const start = page * PAGE;
      const shown = items.slice(start, start + PAGE);
      const head = t(lang, 'search.results', { n: total, shown: total > PAGE ? t(lang, 'search.shown', { n: shown.length }) : '',
        sort: t(lang, `btn.sort_${f.sort}`) });
      const lines = shown.map((x, i) => `<b>${start + i + 1}.</b> ${I.verdictLine(t, lang, x.eval)} · ${title(lang, x)}, ${dname(lang, x.district)}\n`
        + `${x.area} m² · ${x.floor}/${x.floors} · <b>${money(lang, x.price, x.currency)}</b>`);
      const rows = shown.map((x, i) => [b(`${start + i + 1}. ${money(lang, x.price, x.currency)} · ${x.area} m²`, `l:${x.id}`)]);
      rows.push(SORTS.map((s, i) => b((f.sort === s ? '• ' : '') + t(lang, `btn.sort_${s}`), `f:s:${i}`)));
      if (start + PAGE < items.length) rows.push([b(t(lang, 'btn.more'), `f:g:${page + 1}`)]);
      rows.push([b(t(lang, 'btn.filters'), 'f:x:0'), b(t(lang, 'btn.save_search'), 'n:save')]);
      return S([`${summary(lang, f)}\n${head}`, ...lines].join('\n\n'), [...rows, back(lang, 'n:search')]);
    },
    filters(lang, f) {
      const aud = AUD_FILTERS.indexOf(f.audience);
      const area = Math.max(0, AREA_FILTERS.indexOf(f.min_area));
      return S(t(lang, 'search.filters'), [
        [b((f.furnished ? '✓ ' : '') + t(lang, 'btn.furnished'), `f:m:${1 - f.furnished}`), b((f.pets ? '✓ ' : '') + t(lang, 'btn.pets'), `f:p:${1 - f.pets}`)],
        [b(`${t(lang, 'audience.title')}: ${t(lang, `audience.${f.audience || 'any'}`)}`, `f:a:${(aud + 1) % AUD_FILTERS.length}`)],
        [b(AREA_FILTERS[area] ? t(lang, 'area.n', { n: AREA_FILTERS[area] }) : t(lang, 'area.0'), `f:z:${(area + 1) % AREA_FILTERS.length}`)],
        [b(t(lang, 'btn.show_results'), 'f:g:0')], back(lang, 'f:g:0')]);
    },
    card(lang, x, now) {
      const ev = x.eval;
      const parts = [`<b>${title(lang, x)}, ${dname(lang, x.district)}</b>\n<b>${money(lang, x.price, x.currency)}</b> ${t(lang, 'fmt.per_month')}`];
      const block = [`<b>${I.verdictLine(t, lang, ev)}</b> — ${t(lang, 'verdict.title')}`, I.fairText(t, lang, x, ev, dmap, rate)];
      if (ev.factors.length) block.push(`${t(lang, 'fair.factors')} ${I.factorsText(t, lang, ev.factors)}`);
      if (ev.band) {
        const [lo, hi] = I.bandMoney(t, lang, ev.band, x.currency, rate);
        block.push(t(lang, 'fair.band', { lo, hi }));
      }
      parts.push(block.join('\n'));
      parts.push(`${t(lang, 'card.area')}: ${x.area} m² · ${t(lang, 'card.floor')}: ${x.floor}/${x.floors} · ${t(lang, 'card.building')}: ${t(lang, `building.${x.building}`)}`);
      parts.push(t(lang, 'card.landlord', { name: x.landlord_name }) + ' · ' + t(lang, 'card.updated', { ago: I.ago(t, lang, x.updated_at, now) }));
      const mine = x.my_viewing;
      if (mine) parts.push(t(lang, 'card.my_request', { when: when(lang, mine.start_at, now), status: t(lang, `view.status.${mine.status}`) }));
      if (x.contact) parts.push(t(lang, 'card.contact', { address: x.contact.address, phone: x.contact.phone ? fmtPhone(x.contact.phone) : '—' }));
      else parts.push(`<i>${t(lang, 'card.location')}</i>`);
      const rows = [];
      if (x.own) rows.push([b(t(lang, 'btn.landlord'), 'n:landlord')]);
      else if (mine) rows.push([b(t(lang, 'btn.cancel'), `v:${mine.id}:c`)]);
      else if (x.slots.length) rows.push([b(t(lang, 'btn.request'), `q:${x.id}`)]);
      else parts.push(t(lang, 'card.no_slots'));
      rows.push([b(t(lang, 'app.open_map'), `@app#l=${x.id}`)]);
      if (!x.own) rows.push([b(t(lang, 'btn.report'), `rp:${x.id}:0`)]);
      return S(parts.join('\n\n'), [...rows, back(lang, 'f:g:0')]);
    },
    slots: (lang, x, now) => S(t(lang, 'view.ask'), [...grid(x.slots.map((s) => b(when(lang, s.start_at, now), `t:${s.id}`)), 2), back(lang, `l:${x.id}`)]),
    sent: (lang, v, now) => S(t(lang, 'view.sent', { when: when(lang, v.start_at, now) }), [[b(t(lang, 'btn.viewings'), 'n:viewings')], back(lang, `l:${v.listing_id}`)]),
    reportAsk: (lang, lid) => S(t(lang, 'report.ask'), [...['scam', 'price', 'rented', 'other'].map((r, i) => [b(t(lang, `report.${r}`), `rp:${lid}:${i + 1}`)]),
      back(lang, `l:${lid}`)]),
    viewings(lang, items, now) {
      if (!items.length) return S(t(lang, 'view.none'), [back(lang, 'n:menu')]);
      const lines = [t(lang, 'view.mine')];
      const rows = [];
      for (const v of items) {
        const x = v.listing;
        lines.push(t(lang, 'view.line', { title: title(lang, x), district: dname(lang, x.district), when: when(lang, v.start_at, now),
          status: t(lang, `view.status.${v.status}`) }));
        if (v.contact) lines.push(t(lang, 'card.contact', { address: v.contact.address, phone: v.contact.phone ? fmtPhone(v.contact.phone) : '—' }));
        if (['pending', 'accepted'].includes(v.status)) {
          rows.push([b(`${title(lang, x)} · ${when(lang, v.start_at, now)}`, `l:${x.id}`), b(t(lang, 'btn.cancel'), `v:${v.id}:c`)]);
        }
      }
      return S(lines.join('\n\n'), [...rows, back(lang, 'n:menu')]);
    },
    subs(lang, items) {
      if (!items.length) return S(t(lang, 'search.subs_none'), [back(lang, 'n:menu')]);
      return S([t(lang, 'search.subs'), ...items.map((s, i) => `${i + 1}. ${summary(lang, s.filter)}`)].join('\n'),
        [...items.map((s, i) => [b(`${i + 1}. ${t(lang, 'btn.delete')}`, `sd:${s.id}`)]), back(lang, 'n:menu')]);
    },
    landlordHome: (lang, active, pending) => S(t(lang, 'landlord.home', { active, pending }), [
      [b(t(lang, 'btn.my_listings'), '@app'), b(t(lang, 'btn.new_listing'), '@app')],
      [b(t(lang, 'btn.requests') + (pending ? ` (${pending})` : ''), 'n:requests')], back(lang, 'n:menu')]),
    requests(lang, items, now) {
      if (!items.length) return S(t(lang, 'landlord.no_requests'), [back(lang, 'n:landlord')]);
      const lines = [t(lang, 'landlord.requests')];
      const rows = [];
      for (const v of items) {
        const w = when(lang, v.start_at, now);
        lines.push(t(lang, 'landlord.request_line', { tenant: v.tenant_name, title: title(lang, v.listing), district: dname(lang, v.listing.district),
          when: w, status: t(lang, `view.status.${v.status}`) }));
        if (v.contact) lines.push(t(lang, 'notify.accepted_landlord', { when: w, name: v.contact.name, phone: v.contact.phone ? fmtPhone(v.contact.phone) : '—' }));
        if (v.status === 'pending') rows.push([b(`${t(lang, 'btn.accept')}: ${v.tenant_name}, ${w}`, `v:${v.id}:y`), b(t(lang, 'btn.decline'), `v:${v.id}:n`)]);
      }
      return S(lines.join('\n\n'), [...rows, back(lang, 'n:landlord')]);
    },
  };
  return V;
}
