// JS port of uyijara/i18n.py: locale templates with escaped params and the formatters every screen needs.
// Used by the Mini App and by the browser demo's bot simulator, so every screen reads the same locale JSON.
import { civil, hhmm, localDay, localMinute, weekday } from './clock.js';
import { fromUzs, group, roundTo, USD } from './money.js';

export const DOTS = { cheap: '🟢', fair: '🔵', expensive: '🔴', few: '⚪' };
export const MINUS = '−';

export class Raw {
  constructor(html) {
    this.html = String(html);
  }

  toString() {
    return this.html;
  }
}

export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function render(template, params = {}) {
  return template.replace(/\{(\w+)\}/g, (m, k) => {
    if (!(k in params)) return m;
    const v = params[k];
    return v instanceof Raw ? v.html : escapeHtml(v);
  });
}

export const normLang = (code) => (code && String(code).slice(0, 2).toLowerCase() === 'ru' ? 'ru' : 'uz');

/** t(lang, key, params) over {uz, ru} catalogs, falling back to Uzbek, then to the key. */
export function makeT(catalogs) {
  return (lang, key, params) => {
    const l = normLang(lang);
    const template = catalogs[l]?.[key] ?? catalogs.uz?.[key] ?? key;
    return render(template, params);
  };
}

export const money = (t, lang, amount, currency) => t(lang, currency === USD ? 'fmt.usd' : 'fmt.uzs', { n: group(amount) });
export const inCurrency = (uzs, currency, rate) => (currency === USD ? roundTo(fromUzs(uzs, currency, rate), 10) : uzs);
export const signed = (pct) => (pct > 0 ? `+${pct}%` : pct < 0 ? `${MINUS}${-pct}%` : '0%');
export const title = (t, lang, x) => t(lang, x.building === 'house' ? 'title.house' : 'title.flat', { rooms: x.rooms });
export const districtName = (lang, did, dmap) => dmap[did].name[normLang(lang)];

export function verdictLine(t, lang, ev) {
  if (!ev) return '';
  return `${DOTS[ev.verdict]} ${t(lang, `verdict.${ev.verdict}`)}${ev.pct === null ? '' : ` ${signed(ev.pct)}`}`;
}

export function fairText(t, lang, x, ev, dmap, rate) {
  const district = districtName(lang, x.district, dmap);
  if (ev.verdict === 'few') return t(lang, 'fair.few', { district, n: ev.n });
  const expected = money(t, lang, inCurrency(roundTo(ev.expected, 10_000), x.currency, rate), x.currency);
  const scope = t(lang, `fair.scope_${ev.scope}`, { district, n: ev.n, rooms: x.rooms, lo: ev.rooms_lo, hi: ev.rooms_hi, expected });
  const tail = ev.verdict === 'fair' ? t(lang, 'fair.pct_fair', { pct: signed(ev.pct) })
    : t(lang, `fair.pct_${ev.verdict}`, { pct: Math.abs(ev.pct) });
  let out = `${scope} ${tail}`;
  if (ev.suspicious) out += `\n${t(lang, 'fair.suspicious')}`;
  return out;
}

export const factorsText = (t, lang, factors) => factors.map(([k, p]) => `${t(lang, `factor.${k}`)} ${signed(p)}`).join(', ');

export const bandMoney = (t, lang, band, currency, rate) => band.map((b) => money(t, lang, inCurrency(b, currency, rate), currency));
export const bandText = (t, lang, band, currency, rate) => bandMoney(t, lang, band, currency, rate).join(' – ');

export function dateLabel(t, lang, ms) {
  const [, month, day] = civil(localDay(ms));
  return normLang(lang) === 'uz' ? `${day}-${t(lang, `month.${month}`)}` : `${day} ${t(lang, `month.${month}`)}`;
}

export function slotLabel(t, lang, start, now) {
  const day = localDay(start);
  const today = localDay(now);
  const time = hhmm(localMinute(start));
  if (day === today) return t(lang, 'slot.today', { time });
  if (day === today + 1) return t(lang, 'slot.tomorrow', { time });
  const [, month, d] = civil(day);
  return t(lang, 'slot.date', { wd: t(lang, `wd.${weekday(day)}`), d, month: t(lang, `month.${month}`), time });
}

export function ago(t, lang, thenMs, nowMs) {
  const minutes = Math.max(0, Math.floor((nowMs - thenMs) / 60_000));
  if (minutes < 1) return t(lang, 'ago.now');
  if (minutes < 60) return t(lang, 'ago.min', { n: minutes });
  if (minutes < 1440) return t(lang, 'ago.hour', { n: Math.floor(minutes / 60) });
  return t(lang, 'ago.day', { n: Math.floor(minutes / 1440) });
}

export const clock = (ms) => hhmm(localMinute(ms));
