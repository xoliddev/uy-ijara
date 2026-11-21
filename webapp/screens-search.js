// Search tab: a forgiving text search (Latin or Cyrillic), quick filters, the map with pins coloured by the fair-price
// verdict, the list sorted by fair-price score / newest / cheapest, and "notify me about new listings like these".
import { AREA_FILTERS, AUD_FILTERS, SORTS } from '../shared/search.js';
import { createMap } from './map.js';
import { name, price, shortPrice, since, thumb, verdictBadge } from './parts.js';
import { debounce, h, haptic } from './util.js';

const VERDICTS = ['cheap', 'fair', 'expensive', 'few'];

function mapFor(ctx) {
  if (!ctx.mapView) {
    const el = h('div', { class: 'ui-map', 'data-testid': 'map' });
    const view = createMap(el, { attribution: ctx.T('map.attrib'), onPick: (id) => ctx.openListing(id) });
    ctx.mapView = { el, view };
  }
  return ctx.mapView;
}

function chip(label, on, onclick, testid) {
  return h('button', { class: `ui-chip sel${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on), onclick,
    'data-testid': testid }, label);
}

function moreSheet(ctx, f, apply) {
  ctx.sheet(ctx.T('btn.filters'), (close) => {
    const toggle = (key, label) => h('label', { class: 'ui-switch' },
      h('input', { type: 'checkbox', checked: Boolean(f[key]), 'data-testid': `flt-${key}`,
        onchange: (e) => { f[key] = e.target.checked ? 1 : 0; } }), h('i', { 'aria-hidden': 'true' }), h('span', {}, label));
    const aud = h('select', { class: 'ui-input', 'data-testid': 'flt-audience', onchange: (e) => { f.audience = e.target.value; } },
      AUD_FILTERS.map((a) => h('option', { value: a, selected: f.audience === a }, ctx.T(`audience.${a || 'any'}`))));
    const area = h('select', { class: 'ui-input', 'data-testid': 'flt-area', onchange: (e) => { f.min_area = Number(e.target.value); } },
      AREA_FILTERS.map((a) => h('option', { value: a, selected: f.min_area === a }, a ? ctx.T('area.n', { n: a }) : ctx.T('area.0'))));
    return [toggle('furnished', ctx.T('btn.furnished')), toggle('pets', ctx.T('btn.pets')),
      h('label', { class: 'ui-field' }, h('span', {}, ctx.T('audience.title')), aud),
      h('label', { class: 'ui-field' }, h('span', {}, ctx.T('app.min_area')), area),
      h('button', { class: 'ui-btn', type: 'button', 'data-testid': 'flt-apply', onclick: () => { close(); apply(); } },
        ctx.T('btn.show_results'))];
  });
}

export async function renderSearch(ctx, body) {
  const f = ctx.state.filter;
  const { el, view } = mapFor(ctx);
  const run = async () => {
    try {
      const res = await ctx.api.search(f);
      ctx.state.res = res;
      Object.assign(f, res.filter);
      paint(res);
    } catch (err) { ctx.fail(err); }
  };
  const rerender = () => renderSearch(ctx, body);
  const q = h('input', { class: 'ui-search', type: 'search', value: f.q, maxlength: 64, autocomplete: 'off',
    placeholder: ctx.P('app.search_ph'), 'aria-label': ctx.P('app.search_ph'), 'data-testid': 'search' });
  q.addEventListener('input', debounce(() => { f.q = q.value; run(); }, 250));
  const district = h('select', { class: 'ui-input slim', 'aria-label': ctx.P('app.district'), 'data-testid': 'district',
    onchange: () => { f.district = district.value; run(); } },
  h('option', { value: '' }, `${ctx.T('app.district')}: ${ctx.T('district.any')}`),
  ctx.districts.map((d) => h('option', { value: d.id, selected: f.district === d.id }, d.name[ctx.lang])));
  const rooms = h('div', { class: 'ui-chips nowrap', role: 'group', 'aria-label': ctx.P('app.rooms') },
    [0, 1, 2, 3, 4].map((n) => chip(n === 0 ? ctx.T('btn.any') : n === 4 ? '4+' : String(n), f.rooms === n,
      () => { f.rooms = n; rerender(); }, `rooms-${n}`)));
  const max = h('input', { class: 'ui-input slim num', inputmode: 'numeric', maxlength: 11, 'data-testid': 'price-max',
    placeholder: ctx.P('app.price_to'), value: f.price_max ? String(f.price_max) : '' });
  max.addEventListener('input', debounce(() => {
    const n = Number(max.value.replace(/\D/g, '').slice(0, 9));
    f.price_max = Math.min(Number.isFinite(n) ? n : 0, f.currency === 'USD' ? 25_000 : 300_000_000);
    if (f.price_min > f.price_max && f.price_max) f.price_min = 0;
    run();
  }, 350));
  const cur = h('button', { class: 'ui-chip sel on cur', type: 'button', 'data-testid': 'currency',
    onclick: () => { f.currency = f.currency === 'UZS' ? 'USD' : 'UZS'; f.price_min = 0; f.price_max = 0; rerender(); } },
  f.currency === 'UZS' ? (ctx.lang === 'ru' ? 'сум' : "so'm") : '$');
  const extra = Number(f.furnished) + Number(f.pets) + Number(Boolean(f.audience)) + Number(Boolean(f.min_area));
  const more = chip(`${ctx.T('btn.filters')}${extra ? ` · ${extra}` : ''}`, extra > 0, () => moreSheet(ctx, f, rerender), 'more');
  const sort = h('div', { class: 'ui-seg', role: 'tablist', 'aria-label': ctx.P('app.sort') }, SORTS.map((s) => h('button', {
    type: 'button', class: f.sort === s ? 'on' : '', 'data-testid': `sort-${s}`, onclick: () => { f.sort = s; rerender(); },
  }, ctx.T(`btn.sort_${s}`))));
  const legend = h('div', { class: 'ui-legend' }, VERDICTS.map((v) => h('span', { class: `ui-key is-${v}` }, ctx.T(`verdict.${v}`))));
  const count = h('p', { class: 'ui-count', 'data-testid': 'count' });
  const save = h('button', { class: 'ui-chip', type: 'button', 'data-testid': 'save-search', onclick: async () => {
    try {
      await ctx.api.addSub(f);
      haptic(ctx.tg, 'success');
      ctx.toast(ctx.T('app.saved_search'));
    } catch (err) { ctx.fail(err); }
  } }, ctx.T('btn.save_search'));
  const list = h('section', { class: 'ui-list', 'data-testid': 'results' });

  function paint(res) {
    view.setPins(res.items.map((x) => ({ id: x.id, lat: x.pin_lat, lon: x.pin_lon, label: shortPrice(ctx, x),
      verdict: x.eval?.verdict ?? 'few', title: name(ctx, x), active: ctx.pageId === x.id })));
    count.textContent = ctx.P('app.found', { n: res.total });
    list.replaceChildren(...(res.items.length ? res.items.map((x) => h('button', {
      type: 'button', class: `ui-card is-${x.eval?.verdict ?? 'few'}`, 'data-testid': `card-${x.id}`, onclick: () => ctx.openListing(x.id),
    }, thumb(x), h('span', { class: 'ui-card-main' },
      h('span', { class: 'ui-card-top' }, verdictBadge(ctx, x.eval), h('b', { class: 'ui-price' }, price(ctx, x.price, x.currency))),
      h('b', { class: 'ui-card-title' }, name(ctx, x)),
      h('span', { class: 'ui-meta' }, `${x.area} m² · ${x.floor}/${x.floors} · ${since(ctx, x.updated_at)}`))))
      : [h('p', { class: 'ui-hint' }, ctx.T('search.none'))]));
  }

  body.replaceChildren(h('div', { class: 'ui-filters' }, q, h('div', { class: 'ui-row' }, district, more),
    rooms, h('div', { class: 'ui-row' }, max, cur), sort), el, h('div', { class: 'ui-under-map' }, legend),
  h('div', { class: 'ui-row between pad' }, count, save), list);
  requestAnimationFrame(() => view.invalidate());
  view.invalidate();
  await run();
}
