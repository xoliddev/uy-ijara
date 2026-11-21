// New listing: every field, and the live "tavsiya etilgan narx" panel — the fair band for this flat in this district,
// recalculated as the landlord types, with a marker showing where their price falls before they publish.
import { AMENITIES, BUILDINGS, RENOVATIONS, AUDIENCES } from '../shared/listing.js';
import { parsePrice, toUzs } from '../shared/money.js';
import { bandMoney, shownVerdict, signed } from '../shared/i18n.js';
import { roomSvg } from './art.js';
import { bandBar, phoneSheet, price, T } from './parts.js';
import { debounce, h, haptic } from './util.js';

const SEEDS = [11, 202, 3003, 404, 5005, 606];
export const blankForm = () => ({ district: 'chilonzor', rooms: 2, area: '', floor: '', floors: '', building: 'brick',
  renovation: 'cosmetic', furnished: 0, pets: 0, audience: 'any', amenities: [], address: '', note: '', photo_seed: SEEDS[0],
  priceText: '', currency: 'UZS' });

function draftOf(d) {
  const out = { district: d.district, rooms: d.rooms, area: Number(d.area) || 50, floor: Number(d.floor) || 1,
    floors: Math.max(Number(d.floors) || 1, Number(d.floor) || 1), building: d.building, renovation: d.renovation,
    furnished: d.furnished, pets: d.pets, audience: d.audience, amenities: d.amenities, address: d.address || '-----',
    note: d.note, photo_seed: d.photo_seed, currency: d.currency };
  try {
    [out.price, out.currency] = parsePrice(d.priceText, d.currency);
  } catch { /* no price yet: the band alone */ }
  return out;
}

export function openForm(ctx) {
  const d = ctx.state.form ?? (ctx.state.form = blankForm());
  const body = ctx.page('form');
  const live = h('section', { class: 'ui-live', 'data-testid': 'live-band', 'aria-live': 'polite' });
  let seq = 0;
  const update = debounce(async () => {
    const draft = draftOf(d);
    const mine = ++seq;
    try {
      const ev = await ctx.api.preview(draft);
      if (mine !== seq) return;
      const lines = [h('small', {}, ctx.T('app.live_band'))];
      if (ev.band) {
        const [lo, hi] = bandMoney(T(ctx), ctx.lang, ev.band, draft.currency, ctx.rate);
        lines.push(h('p', { 'data-testid': 'suggest', html: ctx.T('fair.suggest', { lo, hi }) }));
        lines.push(bandBar(ctx, ev, draft.price ? toUzs(draft.price, draft.currency, ctx.rate) : null, draft.currency));
      } else {
        lines.push(h('p', { class: 'ui-muted' }, ctx.T('fair.no_band')));
      }
      if (ev.pct !== undefined && ev.pct !== null && draft.price) {
        lines.push(h('p', { class: `ui-yours is-${shownVerdict(ev)}`, 'data-testid': 'live-verdict' }, ctx.T('fair.your_price', {
          price: price(ctx, draft.price, draft.currency), verdict: ctx.T(`verdict.${shownVerdict(ev)}`), pct: signed(ev.pct) })));
      }
      live.className = `ui-live is-${ev.verdict ? shownVerdict(ev) : 'none'}`;
      live.replaceChildren(...lines);
    } catch (err) {
      if (mine === seq) live.replaceChildren(h('p', { class: 'ui-muted' }, ctx.T(`err.${err.code}`)));
    }
  }, 120);
  const set = (key, value) => { d[key] = value; update(); };
  const input = (key, attrs) => {
    const el = h('input', { class: 'ui-input', value: d[key], 'data-testid': `form-${key}`, ...attrs });
    el.addEventListener('input', () => set(key, el.value));
    return el;
  };
  const choice = (key, values, label) => h('div', { class: 'ui-chips', role: 'group' }, values.map((v) => h('button', {
    type: 'button', class: `ui-chip sel${d[key] === v ? ' on' : ''}`, 'data-testid': `form-${key}-${v}`,
    onclick: (e) => { set(key, v); e.currentTarget.parentNode.querySelectorAll('.ui-chip').forEach((c) => c.classList.toggle('on', c === e.currentTarget)); },
  }, label(v))));
  const toggle = (key, label) => h('label', { class: 'ui-switch' }, h('input', { type: 'checkbox', checked: Boolean(d[key]),
    'data-testid': `form-${key}`, onchange: (e) => set(key, e.target.checked ? 1 : 0) }), h('i', { 'aria-hidden': 'true' }),
  h('span', {}, label));
  const field = (label, ...kids) => h('label', { class: 'ui-field' }, h('span', {}, label), ...kids);
  const district = h('select', { class: 'ui-input', 'data-testid': 'form-district', onchange: (e) => set('district', e.target.value) },
    ctx.districts.map((x) => h('option', { value: x.id, selected: d.district === x.id }, x.name[ctx.lang])));
  const audience = h('select', { class: 'ui-input', 'data-testid': 'form-audience', onchange: (e) => set('audience', e.target.value) },
    AUDIENCES.map((a) => h('option', { value: a, selected: d.audience === a }, ctx.T(`audience.${a}`))));
  const amen = h('div', { class: 'ui-chips' }, AMENITIES.map((a) => h('button', { type: 'button',
    class: `ui-chip sel${d.amenities.includes(a) ? ' on' : ''}`, onclick: (e) => {
      d.amenities = d.amenities.includes(a) ? d.amenities.filter((x) => x !== a) : [...d.amenities, a];
      e.currentTarget.classList.toggle('on');
    } }, ctx.T(`amenity.${a}`))));
  const styles = h('div', { class: 'ui-styles' }, SEEDS.map((s) => h('button', { type: 'button',
    class: `ui-style${d.photo_seed === s ? ' on' : ''}`, 'aria-label': `${ctx.P('app.photo_style')} ${s}`,
    html: roomSvg(s, 'living'), onclick: (e) => {
      d.photo_seed = s;
      styles.querySelectorAll('.ui-style').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
    } })));
  const cur = h('button', { class: 'ui-chip sel on cur', type: 'button', 'data-testid': 'form-currency', onclick: () => {
    d.currency = d.currency === 'UZS' ? 'USD' : 'UZS';
    cur.textContent = d.currency === 'UZS' ? (ctx.lang === 'ru' ? 'сум' : "so'm") : '$';
    update();
  } }, d.currency === 'UZS' ? (ctx.lang === 'ru' ? 'сум' : "so'm") : '$');
  const publish = h('button', { class: 'ui-btn', type: 'button', 'data-testid': 'form-publish', onclick: async () => {
    const go = async () => {
      const draft = draftOf(d);
      if (!draft.price) throw Object.assign(new Error('price'), { code: 'price' });
      const made = await ctx.api.createListing({ ...draft, address: d.address });
      haptic(ctx.tg, 'success');
      ctx.state.form = null;
      ctx.closePage();
      ctx.toast(ctx.T('new.published'));
      ctx.state.justMade = made.id;
      await ctx.refresh();
    };
    try {
      if (!ctx.me.phone) phoneSheet(ctx, async () => { ctx.me = await ctx.api.me(); await go(); });
      else await go();
    } catch (err) { ctx.fail(err); }
  } }, ctx.T('btn.publish'));
  body.replaceChildren(h('div', { class: 'ui-pad form' }, h('h2', { class: 'ui-title' }, ctx.T('app.new')),
    field(ctx.T('app.district'), district), field(ctx.T('app.rooms'), choice('rooms', [1, 2, 3, 4, 5, 6], String)),
    h('div', { class: 'ui-grid3' }, field(ctx.T('app.area'), input('area', { inputmode: 'numeric', maxlength: 3 })),
      field(ctx.T('app.floor'), input('floor', { inputmode: 'numeric', maxlength: 2 })),
      field(ctx.T('app.floors'), input('floors', { inputmode: 'numeric', maxlength: 2 }))),
    field(ctx.T('card.building'), choice('building', BUILDINGS, (b) => ctx.T(`building.${b}`))),
    field(ctx.T('card.renovation'), choice('renovation', RENOVATIONS, (r) => ctx.T(`renovation.${r}`))),
    toggle('furnished', ctx.T('btn.furnished')), toggle('pets', ctx.T('btn.pets')),
    field(ctx.T('audience.title'), audience), field(ctx.T('card.amenities'), amen),
    field(ctx.T('app.photo_style'), styles),
    field(ctx.T('app.address'), input('address', { maxlength: 120 })), field(ctx.T('app.note'), input('note', { maxlength: 300 })),
    field(ctx.T('app.price'), h('div', { class: 'ui-row' }, input('priceText', { inputmode: 'text', maxlength: 20,
      placeholder: '5 200 000', 'data-testid': 'form-price' }), cur)),
    live, publish));
  update();
}
