// "Uy egasi" tab, own listings only: incoming viewing requests (accept / decline), each listing with its verdict and
// band, price editing with the live band, pause / resume / renew, viewing times; and the "+ Yangi e'lon" form.
import { dateLabel, shownVerdict, signed } from '../shared/i18n.js';
import { parsePrice, toUzs } from '../shared/money.js';
import { fmtPhone } from '../shared/listing.js';
import { bandBar, name, price, T, thumb, verdictBadge, when } from './parts.js';
import { openForm } from './screens-form.js';
import { debounce, h, haptic } from './util.js';

function requestCard(ctx, v) {
  const act = (accept) => async () => {
    try {
      await ctx.api.decide(v.id, accept);
      haptic(ctx.tg, 'success');
      ctx.refresh();
    } catch (err) { ctx.fail(err); }
  };
  const c = v.contact;
  return h('article', { class: `ui-res ${v.status}`, 'data-testid': `incoming-${v.id}` },
    h('div', { class: 'ui-row between' }, h('b', {}, v.tenant_name), h('span', { class: `ui-status ${v.status}` },
      ctx.T(`view.status.${v.status}`))),
    h('span', { class: 'ui-muted' }, `${name(ctx, v.listing)} · ${when(ctx, v.start_at)}`),
    c ? h('p', { class: 'ui-contact', 'data-testid': 'tenant-contact' },
      ctx.P('notify.accepted_landlord', { when: when(ctx, v.start_at), name: c.name, phone: c.phone ? fmtPhone(c.phone) : '—' })) : null,
    v.status === 'pending' ? h('div', { class: 'ui-row' },
      h('button', { class: 'ui-btn small', type: 'button', 'data-testid': `accept-${v.id}`, onclick: act(true) }, ctx.T('btn.accept')),
      h('button', { class: 'ui-btn small ghost', type: 'button', 'data-testid': `decline-${v.id}`, onclick: act(false) },
        ctx.T('btn.decline'))) : null);
}

function priceEditor(ctx, x) {
  const live = h('div', { class: 'ui-live slim' });
  const field = h('input', { class: 'ui-input', value: String(x.price), maxlength: 20, 'data-testid': `edit-price-${x.id}` });
  const check = debounce(async () => {
    let p;
    try { p = parsePrice(field.value, x.currency); } catch { live.replaceChildren(h('p', { class: 'ui-muted' }, ctx.T('err.price'))); return; }
    try {
      const ev = await ctx.api.preview({ ...x, id: x.id, price: p[0], currency: p[1] });
      live.replaceChildren(bandBar(ctx, ev, toUzs(p[0], p[1], ctx.rate), p[1]), ev.pct === null || ev.pct === undefined ? ''
        : h('p', { class: `ui-yours is-${shownVerdict(ev)}` }, ctx.T('fair.your_price', { price: price(ctx, p[0], p[1]),
          verdict: ctx.T(`verdict.${shownVerdict(ev)}`), pct: signed(ev.pct) })));
    } catch (err) { ctx.fail(err); }
  }, 150);
  field.addEventListener('input', check);
  return h('div', { class: 'ui-edit' }, h('div', { class: 'ui-row' }, field, h('button', { class: 'ui-btn small', type: 'button',
    onclick: async () => {
      try {
        const [p, c] = parsePrice(field.value, x.currency);
        await ctx.api.updateListing(x.id, { price: p, currency: c });
        ctx.toast(ctx.T('app.save'));
        ctx.refresh();
      } catch (err) { ctx.fail(err.code ? err : { code: 'price' }); }
    } }, ctx.T('app.save'))), live);
}

function listingCard(ctx, x, presets) {
  const open = new Map(x.slots.map((s) => [s.start_at, s.id]));
  const run = (fn) => async () => { try { await fn(); ctx.refresh(); } catch (err) { ctx.fail(err); } };
  const status = x.hidden ? 'card.status_hidden' : x.status === 'paused' ? 'card.status_paused' : x.status === 'expired'
    ? 'card.status_expired' : null;
  const actions = [];
  if (x.status === 'active') actions.push(['btn.pause', () => ctx.api.setStatus(x.id, 'pause')]);
  if (x.status === 'paused') actions.push(['btn.resume', () => ctx.api.setStatus(x.id, 'resume')]);
  actions.push(['btn.renew', () => ctx.api.setStatus(x.id, 'renew')]);
  const times = h('div', { class: 'ui-chips' }, presets.map((t, i) => h('button', { type: 'button',
    class: `ui-chip sel${open.has(t) ? ' on' : ''}`, 'data-testid': `ptime-${x.id}-${i}`,
    onclick: run(() => (open.has(t) ? ctx.api.removeSlot(x.id, open.get(t)) : ctx.api.addSlot(x.id, t))) }, when(ctx, t))));
  let editor = null;
  const edit = h('button', { class: 'ui-chip', type: 'button', onclick: () => {
    if (editor) { editor.remove(); editor = null; return; }
    editor = priceEditor(ctx, x);
    edit.after(editor);
  } }, ctx.T('btn.edit_price'));
  return h('article', { class: `ui-own${ctx.state.justMade === x.id ? ' fresh' : ''}`, 'data-testid': `own-${x.id}` },
    h('div', { class: 'ui-own-top' }, thumb(x), h('div', {},
      h('b', {}, name(ctx, x)), h('div', { class: 'ui-row' }, h('span', { class: 'ui-price' }, price(ctx, x.price, x.currency)),
        status ? h('span', { class: 'ui-status' }, ctx.T(status)) : verdictBadge(ctx, x.eval)),
      h('small', { class: 'ui-muted' }, ctx.T('card.expires', { date: dateLabel(T(ctx), ctx.lang, x.expires_at) })))),
    x.eval?.band ? bandBar(ctx, x.eval, x.eval.price_uzs, x.currency) : null,
    h('div', { class: 'ui-row wrap' }, edit, ...actions.map(([key, fn]) => h('button', { class: 'ui-chip', type: 'button',
      'data-testid': `${key.slice(4)}-${x.id}`, onclick: run(fn) }, ctx.T(key))),
    h('button', { class: 'ui-chip', type: 'button', onclick: () => ctx.openListing(x.id) }, ctx.T('btn.view'))),
    h('small', { class: 'ui-muted' }, ctx.T('btn.slots')), times);
}

export async function renderLandlord(ctx, body) {
  const data = await ctx.api.landlord();
  ctx.now = data.now ?? ctx.now;
  const incoming = data.incoming.map((v) => requestCard(ctx, v));
  body.replaceChildren(h('div', { class: 'ui-pad' },
    h('button', { class: 'ui-btn', type: 'button', 'data-testid': 'new-listing', onclick: () => openForm(ctx) }, ctx.T('btn.new_listing')),
    h('h4', {}, ctx.T('btn.requests')), ...(incoming.length ? incoming : [h('p', { class: 'ui-hint' }, ctx.T('landlord.no_requests'))]),
    h('h4', {}, ctx.T('btn.my_listings')),
    ...(data.listings.length ? data.listings.map((x) => listingCard(ctx, x, data.presets))
      : [h('p', { class: 'ui-hint' }, ctx.T('landlord.none'))])));
}
