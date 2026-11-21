// A listing's page: drawn photos and floor plan, "Narx adolatlimi?" with the band bar and the biggest factors, facts,
// the approximate area on a map, viewing slots -> request, and contacts only after the landlord accepts.
import { fmtPhone } from '../shared/listing.js';
import { galleryKinds, roomSvg } from './art.js';
import { createMap } from './map.js';
import { approxUzs, name, phoneSheet, price, since, verdictBlock, when } from './parts.js';
import { planSvg } from './plan.js';
import { h, haptic } from './util.js';

const REASONS = ['scam', 'price', 'rented', 'other'];

function gallery(ctx, x) {
  const names = Object.fromEntries(['living', 'bedroom', 'kitchen', 'bath', 'hall', 'balcony']
    .map((k) => [k, ctx.P(`app.${k}`)]));
  const slides = galleryKinds(x).map((k, i) => h('figure', { class: 'ui-slide', html: roomSvg(x.photo_seed, k, i) }));
  slides.push(h('figure', { class: 'ui-slide plan', 'data-testid': 'plan',
    html: planSvg({ rooms: x.rooms, area: x.area, balcony: x.amenities.includes('balcony'), house: x.building === 'house' }, names) },
  h('figcaption', {}, ctx.T('app.plan'))));
  const dots = h('div', { class: 'ui-dots' }, slides.map((_, i) => h('i', { class: i ? '' : 'on' })));
  const strip = h('div', { class: 'ui-gallery', 'data-testid': 'gallery' }, slides);
  strip.addEventListener('scroll', () => {
    const i = Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth));
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
  }, { passive: true });
  return h('div', { class: 'ui-gallery-wrap' }, strip, dots, h('small', { class: 'ui-caption' }, ctx.T('app.photos')));
}

function facts(ctx, x) {
  const yes = ctx.T('card.yes');
  const no = ctx.T('card.no');
  const rows = [[ctx.T('card.area'), `${x.area} m²`], [ctx.T('card.floor'), `${x.floor}/${x.floors}`],
    [ctx.T('card.building'), ctx.T(`building.${x.building}`)], [ctx.T('card.renovation'), ctx.T(`renovation.${x.renovation}`)],
    [ctx.T('card.furnished'), x.furnished ? yes : no], [ctx.T('card.pets'), ctx.T(x.pets ? 'card.pets_yes' : 'card.pets_no')],
    [ctx.T('audience.title'), ctx.T(`audience.${x.audience}`)]];
  return h('dl', { class: 'ui-facts', 'data-testid': 'facts' }, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

function contactBlock(ctx, c) {
  const osm = `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=17/${c.lat}/${c.lon}`;
  return h('div', { class: 'ui-contact', 'data-testid': 'contact' },
    h('p', { html: ctx.T('card.contact', { address: c.address, phone: c.phone ? fmtPhone(c.phone) : '—' }).replace(/\n/g, '<br>') }),
    h('div', { class: 'ui-row' }, c.phone ? h('a', { class: 'ui-btn small', href: `tel:${c.phone}` }, fmtPhone(c.phone)) : null,
      c.lat ? h('a', { class: 'ui-btn small ghost', href: osm, target: '_blank', rel: 'noopener' }, ctx.T('app.open_map')) : null));
}

function viewingBlock(ctx, x, reload) {
  const box = h('section', { class: 'ui-box', 'data-testid': 'viewing' });
  if (x.own) {
    box.append(h('button', { class: 'ui-btn ghost', type: 'button', onclick: () => ctx.go('landlord') }, ctx.T('btn.landlord')));
  } else if (x.my_viewing) {
    const v = x.my_viewing;
    box.append(h('p', { 'data-testid': 'my-request' }, ctx.T('card.my_request', { when: when(ctx, v.start_at),
      status: ctx.T(`view.status.${v.status}`) })),
    h('button', { class: 'ui-btn ghost small', type: 'button', onclick: async () => {
      try { await ctx.api.cancelViewing(v.id); await reload(); } catch (err) { ctx.fail(err); }
    } }, ctx.T('btn.cancel')));
  } else if (x.slots.length) {
    const ask = (slot) => async () => {
      const send = async () => {
        await ctx.api.requestViewing(slot.id);
        haptic(ctx.tg, 'success');
        ctx.toast(ctx.T('view.sent', { when: when(ctx, slot.start_at) }));
        await reload();
      };
      try {
        if (!ctx.me.phone) {
          phoneSheet(ctx, async () => { ctx.me = await ctx.api.me(); await send(); });
          return;
        }
        await send();
      } catch (err) { ctx.fail(err); }
    };
    box.append(h('h4', {}, ctx.T('card.slots')), h('div', { class: 'ui-chips' }, x.slots.map((s) => h('button', {
      class: 'ui-chip slot', type: 'button', 'data-testid': `slot-${s.id}`, onclick: ask(s) }, when(ctx, s.start_at)))));
  } else {
    box.append(h('p', { class: 'ui-muted' }, ctx.T('card.no_slots')));
  }
  if (x.contact) box.append(contactBlock(ctx, x.contact));
  else box.append(h('p', { class: 'ui-lock' }, h('i', { 'aria-hidden': 'true' }), ctx.T('card.location')));
  return box;
}

function reportSheet(ctx, id) {
  ctx.sheet(ctx.T('report.ask'), (close) => REASONS.map((r) => h('button', { class: 'ui-btn ghost', type: 'button',
    'data-testid': `report-${r}`, onclick: async () => {
      try {
        await ctx.api.report(id, r);
        close();
        ctx.toast(ctx.T('report.done'));
      } catch (err) { ctx.fail(err); }
    } }, ctx.T(`report.${r}`))));
}

export async function renderDetail(ctx, id, keepScroll = false) {
  const x = await ctx.api.listing(id);
  ctx.now = x.now ?? ctx.now;
  const scroll = keepScroll ? ctx.pageEl?.scrollTop ?? 0 : 0;
  const body = keepScroll && ctx.pageEl ? ctx.pageEl.querySelector('.ui-page-body') : ctx.page('detail');
  const reload = () => ctx.refresh();
  const mapEl = h('div', { class: 'ui-map small', 'data-testid': 'area-map' });
  const amen = x.amenities.length ? h('div', { class: 'ui-chips' }, x.amenities.map((a) => h('span', { class: 'ui-chip' },
    ctx.T(`amenity.${a}`)))) : null;
  body.replaceChildren(gallery(ctx, x),
    h('div', { class: 'ui-pad' },
      h('h2', { class: 'ui-title', 'data-testid': 'detail-title' }, name(ctx, x)),
      h('p', { class: 'ui-bigprice' }, h('b', {}, price(ctx, x.price, x.currency)), ` ${ctx.T('fmt.per_month')} `, approxUzs(ctx, x)),
      x.eval ? verdictBlock(ctx, x, x.eval) : null,
      viewingBlock(ctx, x, reload),
      facts(ctx, x), amen,
      x.note ? h('p', { class: 'ui-note' }, `${ctx.T('card.note')}: ${x.note}`) : null,
      mapEl,
      h('p', { class: 'ui-muted' }, [x.landlord_name ? ctx.T('card.landlord', { name: x.landlord_name }) : '',
        ctx.T('card.updated', { ago: since(ctx, x.updated_at) })].filter(Boolean).join(' · ')),
      x.own ? null : h('button', { class: 'ui-link', type: 'button', 'data-testid': 'report', onclick: () => reportSheet(ctx, id) },
        ctx.T('btn.report'))));
  if (ctx.pageEl) ctx.pageEl.scrollTop = scroll;
  const map = createMap(mapEl, { attribution: ctx.T('map.attrib'), interactive: false, zoom: 13 });
  map.setArea(x.pin_lat, x.pin_lon, x.eval?.verdict ?? 'few');
  requestAnimationFrame(() => map.invalidate());
}
