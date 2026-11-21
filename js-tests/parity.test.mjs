// The JS port of the core must give exactly what the Python core gives (shared/test_vectors.json).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as clock from '../shared/clock.js';
import * as fair from '../shared/fair.js';
import * as i18n from '../shared/i18n.js';
import * as listing from '../shared/listing.js';
import * as money from '../shared/money.js';
import * as search from '../shared/search.js';
import * as seedgen from '../shared/seedgen.js';
import * as text from '../shared/text.js';
import * as viewing from '../shared/viewing.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const V = read('../shared/test_vectors.json');
const districts = read('../shared/data/districts.json');
const people = read('../shared/data/people.json');
const dset = new Set(districts.map((d) => d.id));
const dmap = Object.fromEntries(districts.map((d) => [d.id, d]));
const RATE = V.rate;
const ERRORS = [money.PriceError, listing.ListingError, search.SearchError, viewing.ViewingError];

function res(fn) {
  try {
    return { ok: fn() };
  } catch (e) {
    if (ERRORS.some((E) => e instanceof E)) return { error: e.code };
    throw e;
  }
}

test('text folding (Latin, Cyrillic, Uzbek and Russian spellings)', () => {
  for (const v of V.words) assert.deepEqual(text.words(v.in), v.out, v.in);
});

test('Tashkent calendar and clock, including New Year', () => {
  for (const v of V.civil) assert.deepEqual(clock.civil(v.day), v.out, String(v.day));
  for (const v of V.local) {
    assert.equal(clock.localDay(v.ms), v.day);
    assert.equal(clock.localMinute(v.ms), v.minute);
    assert.equal(clock.weekday(v.day), v.wd);
  }
});

test("money: whole so'm and dollars, mln, grouping, conversion", () => {
  for (const v of V.div_round) assert.equal(money.divRound(v.a, v.b), v.out, `${v.a}/${v.b}`);
  for (const v of V.group) assert.equal(money.group(v.n), v.out);
  for (const v of V.parse_price) assert.deepEqual(res(() => money.parsePrice(v.in, v.cur)), v.out, String(v.in));
  for (const v of V.convert) {
    assert.equal(money.toUzs(v.a, v.c, RATE), v.to);
    assert.equal(money.fromUzs(v.a, v.c, RATE), v.from);
  }
});

test('fair price: median, outlier trim, factors, verdicts for the whole city', () => {
  for (const v of V.median) assert.equal(fair.median(v.in), v.out, JSON.stringify(v.in));
  for (const v of V.mad_trim) assert.deepEqual(fair.madTrim(v.in), v.out, JSON.stringify(v.in));
  const active = V.seed.listings.filter((x) => x.status === 'active');
  for (const v of V.factors) {
    const l = active.find((x) => x.id === v.id);
    assert.deepEqual(fair.factors(l), v.out);
    assert.equal(fair.quality(l), v.q);
  }
  const evals = fair.evaluateAll(active, RATE);
  assert.deepEqual(Object.keys(evals).sort(), Object.keys(V.evals).sort());
  for (const [id, e] of Object.entries(V.evals)) assert.deepEqual(evals[id], e, `listing ${id}`);
  for (const v of V.estimate) assert.deepEqual(fair.estimate(v.in, active, RATE), v.out, JSON.stringify(v.in));
  for (const v of V.band_pos) assert.equal(fair.whereInBand(v.p, v.band), v.out);
});

test('listing validation, floors, phones, cleaning, approximate pin', () => {
  for (const v of V.validate) assert.deepEqual(res(() => listing.validate(v.in, dset)), v.out, v.name);
  for (const v of V.floor) assert.deepEqual(res(() => listing.parseFloor(v.in)), v.out, v.in);
  for (const v of V.phone) assert.deepEqual(res(() => listing.normalizePhone(v.in)), v.out, v.in);
  for (const v of V.fmt_phone) assert.equal(listing.fmtPhone(v.in), v.out);
  for (const v of V.clean) assert.equal(listing.clean(v.in, v.n), v.out, String(v.in));
  for (const v of V.approx) assert.deepEqual(listing.approxPoint(v.id, dmap[v.d]), v.out);
});

test('search filters, text search and sorting over the seeded city; saved-search matching', () => {
  const active = V.seed.listings.filter((x) => x.status === 'active');
  const evals = fair.evaluateAll(active, RATE);
  for (const v of V.search) {
    const f = search.normalize(v.in, dset);
    assert.deepEqual(f, v.norm, JSON.stringify(v.in));
    assert.deepEqual(search.run(f, active, evals, RATE, dmap), v.out, JSON.stringify(v.in));
  }
  for (const v of V.normalize_bad) assert.deepEqual(res(() => search.normalize(v.in, dset)), v.out, JSON.stringify(v.in));
  for (const v of V.alerts) {
    const l = v.listing ?? active.find((x) => x.id === v.l);
    assert.equal(search.alertDue(v.sub, l, RATE, dmap[l.district]), v.out, String(v.l));
  }
});

test('viewing slots: presets (also on New Year\'s Eve), times, requests, moves', () => {
  for (const v of V.presets) assert.deepEqual(viewing.presets(v.now), v.out, String(v.now));
  for (const v of V.check_time) assert.deepEqual(res(() => viewing.checkTime(v.t, V.now)), v.out, String(v.t));
  for (const v of V.check_request) assert.deepEqual(res(() => viewing.checkRequest(...v.in) ?? null), v.out, JSON.stringify(v.in));
  for (const v of V.moves) assert.deepEqual(res(() => viewing.move(v.s, v.a)), v.out, `${v.s}/${v.a}`);
});

test('seed generator gives the same city as Python', () => {
  assert.deepEqual(seedgen.world(districts, people, V.now), V.seed);
  const later = seedgen.world(districts, people, V.seed_nye.now);
  assert.equal(later.listings.length, V.seed_nye.count);
  assert.deepEqual(later.slots.slice(0, 3), V.seed_nye.slots);
  assert.deepEqual(later.listings[0], V.seed_nye.first);
});

test('texts: the fair-price sentence, verdict tags, bands, slot times, dates, "N min ago" (uz and ru)', () => {
  const t = i18n.makeT({ uz: read('../shared/locales/uz.json'), ru: read('../shared/locales/ru.json') });
  const active = V.seed.listings.filter((x) => x.status === 'active');
  const evals = fair.evaluateAll(active, RATE);
  for (const v of V.texts) {
    const x = active.find((l) => l.id === v.id);
    const e = evals[x.id];
    assert.equal(i18n.fairText(t, v.lang, x, e, dmap, RATE), v.fair, `${v.id} ${v.lang}`);
    assert.equal(i18n.verdictLine(t, v.lang, e), v.verdict);
    assert.equal(i18n.factorsText(t, v.lang, e.factors), v.factors);
    assert.equal(e.band ? i18n.bandText(t, v.lang, e.band, x.currency, RATE) : null, v.band);
    assert.equal(i18n.title(t, v.lang, x), v.title);
    assert.equal(i18n.money(t, v.lang, x.price, x.currency), v.money);
  }
  for (const v of V.slot_labels) assert.equal(i18n.slotLabel(t, v.lang, v.t, v.now), v.out, `${v.lang} ${v.t}`);
  for (const v of V.dates) assert.equal(i18n.dateLabel(t, v.lang, v.ms), v.out);
  for (const v of V.ago) assert.equal(i18n.ago(t, v.lang, V.now - v.d, V.now), v.out);
});
