// JS port of uyijara/core/money.py: whole so'm and whole dollars; dollars become so'm only for comparing.
import { fdiv } from './clock.js';

export const UZS = 'UZS';
export const USD = 'USD';
export const CURRENCIES = [UZS, USD];
export const DEFAULT_RATE = 12_800;
export const LIMITS = { UZS: [300_000, 300_000_000], USD: [25, 25_000] };
const DIGITS = /^[0-9]{1,9}$/;
const GROUPED = /^[0-9]{1,3}(?:[.,][0-9]{3}){1,2}$/;
const MLN = /^([0-9]{1,3})(?:[.,]([0-9]{1,2}))?(?:mln|млн|million|миллион)$/;
const USD_MARKS = ['$', 'usd', 'dollar', 'долл', 'доллар'];
const UZS_MARKS = ["so'm", 'so‘m', 'soʻm', 'сум', 'сўм', 'som', 'sum', 'uzs'];
const NNBSP = String.fromCharCode(0x202f);

export class PriceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export const divRound = (a, b) => fdiv(2 * a + b, 2 * b);
export const roundTo = (n, step) => divRound(n, step) * step;
export const group = (n) => (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const toUzs = (amount, currency, rate) => (currency === USD ? amount * rate : amount);
export const fromUzs = (uzs, currency, rate) => (currency === USD ? divRound(uzs, rate) : uzs);

export function checkRange(amount, currency) {
  if (!CURRENCIES.includes(currency)) throw new PriceError('currency');
  const [lo, hi] = LIMITS[currency];
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < lo || amount > hi) throw new PriceError('range');
  return amount;
}

export function parsePrice(text, currency = UZS) {
  if (typeof text === 'boolean') throw new PriceError('format');
  if (typeof text === 'number' && Number.isInteger(text)) return [checkRange(text, currency), currency];
  let s = String(text ?? '').trim().toLowerCase().slice(0, 40);
  let cur = currency;
  for (const mark of USD_MARKS) {
    if (s.includes(mark)) {
      cur = USD;
      s = s.split(mark).join('');
    }
  }
  for (const mark of UZS_MARKS) {
    if (s.includes(mark)) {
      cur = UZS;
      s = s.split(mark).join('');
    }
  }
  s = s.split(' ').join('').split('\xa0').join('').split(NNBSP).join('').replace(/^\.+|\.+$/g, '');
  const m = MLN.exec(s);
  let value;
  if (m && cur === UZS) value = Number(m[1]) * 1_000_000 + Number((m[2] ?? '0').padEnd(2, '0')) * 10_000;
  else if (DIGITS.test(s)) value = Number(s);
  else if (GROUPED.test(s)) value = Number(s.replace(/[.,]/g, ''));
  else throw new PriceError('format');
  return [checkRange(value, cur), cur];
}
