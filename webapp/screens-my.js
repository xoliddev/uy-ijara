// "Ko'rishlar" tab: my viewing requests (with the address and phone once accepted) and my saved searches.
import { fmtPhone } from '../shared/listing.js';
import { name, price, verdictBadge, when } from './parts.js';
import { h } from './util.js';

function subLabel(ctx, f) {
  const parts = [f.district ? ctx.dmap[f.district].name[ctx.lang] : ctx.T('district.any')];
  if (f.rooms) parts.push(f.rooms === 4 ? ctx.T('rooms.4') : ctx.T('rooms.n', { n: f.rooms }));
  if (f.price_max) parts.push(`≤ ${price(ctx, f.price_max, f.currency)}`);
  if (f.furnished) parts.push(ctx.T('btn.furnished').toLowerCase());
  if (f.q) parts.push(`«${f.q}»`);
  return parts.join(' · ');
}

export async function renderMy(ctx, body) {
  const [vs, subs] = await Promise.all([ctx.api.viewings(), ctx.api.subs()]);
  ctx.now = vs.now ?? ctx.now;
  const items = vs.items.map((v) => {
    const x = v.listing;
    const c = v.contact;
    return h('article', { class: `ui-res ${v.status}`, 'data-testid': `viewing-${v.id}` },
      h('div', { class: 'ui-row between' }, h('b', {}, name(ctx, x)), h('span', { class: `ui-status ${v.status}` },
        ctx.T(`view.status.${v.status}`))),
      h('div', { class: 'ui-row' }, verdictBadge(ctx, x.eval), h('span', { class: 'ui-muted' },
        `${price(ctx, x.price, x.currency)} · ${when(ctx, v.start_at)}`)),
      c ? h('p', { class: 'ui-contact', 'data-testid': 'my-contact',
        html: ctx.T('card.contact', { address: c.address, phone: c.phone ? fmtPhone(c.phone) : '—' }).replace(/\n/g, '<br>') }) : null,
      h('div', { class: 'ui-row' }, h('button', { class: 'ui-btn small ghost', type: 'button', onclick: () => ctx.openListing(x.id) },
        ctx.T('btn.view')),
      ['pending', 'accepted'].includes(v.status) ? h('button', { class: 'ui-btn small ghost', type: 'button', onclick: async () => {
        try { await ctx.api.cancelViewing(v.id); ctx.refresh(); } catch (err) { ctx.fail(err); }
      } }, ctx.T('btn.cancel')) : null));
  });
  const saved = subs.items.map((s) => h('div', { class: 'ui-sub', 'data-testid': `sub-${s.id}` }, h('span', {}, subLabel(ctx, s.filter)),
    h('button', { class: 'ui-chip', type: 'button', onclick: async () => {
      try { await ctx.api.delSub(s.id); ctx.refresh(); } catch (err) { ctx.fail(err); }
    } }, ctx.T('btn.delete'))));
  body.replaceChildren(h('div', { class: 'ui-pad' },
    h('h4', {}, ctx.T('btn.viewings')), ...(items.length ? items : [h('p', { class: 'ui-hint' }, ctx.T('view.none'))]),
    h('h4', {}, ctx.T('app.subs')), ...(saved.length ? saved : [h('p', { class: 'ui-hint' }, ctx.T('search.subs_none'))])));
}
