// Small pieces shared by the Mini App screens: prices, verdict badges, the fair-band bar, thumbnails, phone sheet.
import { whereInBand } from '../shared/fair.js';
import { ago, bandMoney, districtName, fairText, factorsText, money, shownVerdict, signed, slotLabel, title } from '../shared/i18n.js';
import { fromUzs, group, USD } from '../shared/money.js';
import { roomSvg } from './art.js';
import { h, haptic } from './util.js';

const tf = (ctx) => (_lang, key, params) => ctx.T(key, params);
export const T = tf;
export const price = (ctx, amount, currency) => money(tf(ctx), ctx.lang, amount, currency);
export const name = (ctx, x) => `${title(tf(ctx), ctx.lang, x)}, ${districtName(ctx.lang, x.district, ctx.dmap)}`;
export const when = (ctx, ms) => slotLabel(tf(ctx), ctx.lang, ms, ctx.now);
export const since = (ctx, ms) => ago(tf(ctx), ctx.lang, ms, ctx.now);

/** "5,4 mln" / "$470" — the label on a map pin. */
export function shortPrice(ctx, x) {
  if (x.currency === USD) return `$${group(x.price)}`;
  const tenths = Math.round(x.price / 100_000);
  return `${Math.floor(tenths / 10)}${tenths % 10 ? `,${tenths % 10}` : ''} ${ctx.lang === 'ru' ? 'млн' : 'mln'}`;
}

export function verdictBadge(ctx, ev, big = false) {
  const v = shownVerdict(ev);
  const pct = ev && ev.pct !== null ? ` ${signed(ev.pct)}` : '';
  return h('span', { class: `ui-badge is-${v}${big ? ' big' : ''}`, 'data-testid': `verdict-${v}` },
    h('i', { 'aria-hidden': 'true' }), `${ctx.T(`verdict.${v}`)}${pct}`);
}

export const thumb = (x) => h('span', { class: 'ui-thumb', html: roomSvg(x.photo_seed, x.building === 'house' ? 'yard' : 'living') });

/** The fair band as a bar: cheap zone, fair zone (the band itself), expensive zone, and where this rent falls. */
export function bandBar(ctx, ev, priceUzs, currency) {
  if (!ev?.band) return h('p', { class: 'ui-muted', html: ctx.T('fair.no_band') });
  const [lo, hi] = bandMoney(tf(ctx), ctx.lang, ev.band, currency, ctx.rate);
  const bar = h('div', { class: 'ui-band', 'data-testid': 'band' },
    h('span', { class: 'z cheap' }), h('span', { class: 'z fair' }), h('span', { class: 'z expensive' }));
  if (priceUzs) {
    const pos = whereInBand(priceUzs, ev.band);
    bar.append(h('b', { class: `ui-mark is-${ev.verdict ? shownVerdict(ev) : 'fair'}`, style: `left:${pos}%`, 'data-pos': String(pos) }));
  }
  return h('div', { class: 'ui-band-wrap' }, bar, h('div', { class: 'ui-band-labels' }, h('span', {}, lo), h('span', {}, hi)));
}

export function verdictBlock(ctx, x, ev) {
  const t = tf(ctx);
  const box = h('section', { class: `ui-verdict is-${shownVerdict(ev)}`, 'data-testid': 'verdict' },
    h('div', { class: 'ui-verdict-top' }, h('small', {}, ctx.T('verdict.title')), verdictBadge(ctx, ev, true)),
    h('p', { class: 'ui-fair-text' }, fairText(t, ctx.lang, x, ev, ctx.dmap, ctx.rate).split('\n')[0]));
  if (ev.band) box.append(bandBar(ctx, ev, ev.price_uzs, x.currency));
  if (ev.factors?.length) {
    box.append(h('div', { class: 'ui-factors' }, h('small', {}, ctx.T('fair.factors')),
      h('div', { class: 'ui-chips' }, ev.factors.map(([k, p]) => h('span', { class: `ui-chip ${p > 0 ? 'up' : 'down'}` },
        `${ctx.T(`factor.${k}`)} ${signed(p)}`)))));
  }
  if (ev.n_all > ev.n) box.append(h('p', { class: 'ui-muted' }, ctx.T('fair.trimmed', { n: ev.n_all - ev.n })));
  if (ev.suspicious) box.append(h('p', { class: 'ui-warn', 'data-testid': 'suspicious' }, ctx.T('fair.suspicious')));
  box.dataset.factors = factorsText(t, ctx.lang, ev.factors ?? []);
  return box;
}

export function approxUzs(ctx, x) {
  return x.currency === USD ? h('small', { class: 'ui-muted' }, ctx.T('fmt.approx_uzs', { n: group(x.price * ctx.rate) })) : null;
}

export const inListingCurrency = (ctx, uzs, currency) => (currency === USD ? fromUzs(uzs, currency, ctx.rate) : uzs);

/** Ask for the phone once (viewing requests and new listings need it), then continue. */
export function phoneSheet(ctx, then) {
  ctx.sheet(ctx.T('app.my_phone'), (close) => {
    const input = h('input', { class: 'ui-input', inputmode: 'tel', maxlength: 20, placeholder: ctx.P('app.phone_ph'),
      'data-testid': 'phone-input' });
    const save = h('button', { class: 'ui-btn', type: 'button', 'data-testid': 'phone-save', onclick: async () => {
      try {
        await ctx.api.setPhone(input.value);
        haptic(ctx.tg, 'success');
        close();
        await then();
      } catch (err) { ctx.fail(err); }
    } }, ctx.T('app.save'));
    return [h('p', { class: 'ui-muted', html: ctx.T('phone.ask').split('\n')[0] }), input, save];
  });
}
