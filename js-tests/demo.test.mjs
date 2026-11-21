// The browser demo's logic, headless: the city on any date (30 days in a row, across New Year), the guided story
// in order and out of order, contacts only after acceptance, one tenant per slot, forged buttons, the API stand-in.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { makeT } from '../shared/i18n.js';
import { apiFor } from '../demo/api.js';
import { BotSim } from '../demo/bot.js';
import { makeViews } from '../demo/bot-views.js';
import { AZIZ, createDemo, KAMOLA, NEW_FLAT, NODIRA, STORY_CHEAP, STORY_EXPENSIVE } from '../demo/seed.js';
import { runStep, STEPS, tap } from '../demo/story.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const shared = { districts: read('../shared/data/districts.json'), people: read('../shared/data/people.json') };
const t = makeT({ uz: read('../shared/locales/uz.json'), ru: read('../shared/locales/ru.json') });
const HOUR = 3_600_000;
const at = (iso, hh, mm = 0) => Date.parse(`${iso}T00:00:00Z`) + (hh - 5) * HOUR + mm * 60_000; // Tashkent time

function world(startMs, lang = 'uz') {
  let now = startMs;
  const backend = createDemo({ ...shared, now: () => now, lang });
  const views = makeViews(t, backend.dmap, backend.rate);
  const alerts = [];
  const bots = {};
  for (const uid of [AZIZ, NODIRA, KAMOLA]) {
    bots[uid] = new BotSim(backend, uid, t, views, { onAlert: (x) => alerts.push(x) });
    bots[uid].start();
  }
  backend.on((ev) => { if (ev.to && bots[ev.to]) bots[ev.to].deliver(ev); });
  return { backend, bots, alerts, advance: (ms) => { now += ms; } };
}

const last = (bot) => bot.messages.at(-1).html;
const all = (bot) => bot.messages.map((m) => m.html).join('\n');

test('the whole story works on 30 consecutive days, across New Year, morning and night', async () => {
  for (let d = 0; d < 30; d++) {
    const day = new Date(Date.parse('2026-12-17T00:00:00Z') + d * 86_400_000).toISOString().slice(0, 10);
    for (const hour of [0, 9, 23]) {
      const w = world(at(day, hour, 30));
      const { backend, bots } = w;
      const { evals } = backend.pool();
      assert.equal(evals[STORY_EXPENSIVE].verdict, 'expensive', day);
      assert.equal(evals[STORY_CHEAP].verdict, 'cheap', day);
      for (let n = 1; n <= STEPS.length; n++) await runStep(n, w);
      const v = backend.viewings.find((x) => x.tenant_id === AZIZ);
      assert.equal(v.status, 'accepted', `${day} ${hour}`);
      assert.match(all(bots[AZIZ]), /Uy egasi ko'rishni qabul qildi/);
      assert.match(all(bots[AZIZ]), /\+998 90 000 30 01/);
      assert.match(last(bots[AZIZ]), /Saqlangan qidiruvingizga mos yangi e'lon/);
      assert.ok(backend.listings.some((x) => x.address === NEW_FLAT.address && x.status === 'active'));
    }
  }
});

test('story steps clicked out of order still work, and running a step twice changes nothing', async () => {
  const w = world(at('2026-11-20', 14));
  await runStep(9, w); // needs a saved search and a new listing: both happen quietly first
  assert.match(last(w.bots[AZIZ]), /Saqlangan qidiruvingizga mos/);
  await runStep(7, w); // needs the request and the acceptance
  assert.equal(w.backend.viewings.find((x) => x.tenant_id === AZIZ).status, 'accepted');
  const before = JSON.stringify([w.backend.viewings, w.backend.subs, w.backend.listings.length]);
  for (const n of [5, 6, 8, 9, 1]) await runStep(n, w);
  assert.equal(JSON.stringify([w.backend.viewings, w.backend.subs, w.backend.listings.length]), before);
  assert.equal(w.backend.subs.length, 1);
});

test('bot: search wizard, verdicts in the list and on the card, contacts hidden until accepted', () => {
  const { backend, bots } = world(at('2026-11-20', 11));
  const aziz = bots[AZIZ];
  for (const re of [/^n:search$/, /^w:d:chilonzor$/, /^w:r:2$/, /^w:b:0$/]) tap(aziz, re);
  assert.match(last(aziz), /Topildi: <b>8<\/b>/);
  assert.match(last(aziz), /🟢 Arzon/);
  tap(aziz, /^f:g:1$/); // the expensive one is on the second page: the list is sorted by fair-price score
  tap(aziz, new RegExp(`^l:${STORY_EXPENSIVE}$`));
  assert.match(last(aziz), /🔴 Qimmat \+22%/);
  assert.match(last(aziz), /22% qimmat/);
  assert.doesNotMatch(last(aziz), /\+998/);
  tap(aziz, /^f:g:0$/);
  tap(aziz, new RegExp(`^l:${STORY_CHEAP}$`));
  tap(aziz, new RegExp(`^q:${STORY_CHEAP}$`));
  tap(aziz, /^t:\d+$/);
  assert.match(last(aziz), /So'rov yuborildi/);
  assert.match(last(bots[NODIRA]), /Yangi so'rov/);
  assert.equal(backend.card(AZIZ, STORY_CHEAP).contact, null);
  tap(bots[NODIRA], /^v:\d+:y$/);
  assert.match(backend.card(AZIZ, STORY_CHEAP).contact.phone, /^\+998900003001$/);
});

test('one tenant per slot, own listings only, forged buttons refused', () => {
  const { backend, bots, alerts } = world(at('2026-11-20', 11));
  const slot = backend.openSlots(STORY_CHEAP)[0].id;
  backend.requestViewing(AZIZ, slot);
  assert.throws(() => backend.requestViewing(KAMOLA, slot), { code: 'slot_taken' });
  assert.throws(() => backend.updateListing(AZIZ, STORY_CHEAP, { price: 1_000_000 }), { code: 'not_found' });
  assert.throws(() => backend.decide(AZIZ, 1, true), { code: 'not_found' });
  assert.throws(() => backend.createListing(NODIRA, { ...NEW_FLAT, price: 5_000_000, photo_seed: 202, district: 'chilonzor',
    area: 58, rooms: 2 }), { code: 'duplicate' });
  for (const data of ['l:99999', 'w:d:nowhere', 'f:s:7', 'zz:1', 'v:1:y', 'rp:5:9']) bots[AZIZ].press(bots[AZIZ].messages.at(-1).id, data);
  assert.equal(alerts.length, 6);
  assert.ok(alerts.includes("Bu tugma eskirgan. Bosh menyuni oching."));
  assert.ok(alerts.includes('Topilmadi yoki endi mavjud emas.'));
});

test('the Mini App API stand-in: same shapes, errors carry codes, Russian works', async () => {
  const { backend } = world(at('2026-12-31', 22), 'ru');
  const api = apiFor(backend, AZIZ);
  const me = await api.me();
  assert.equal(me.lang, 'ru');
  const res = await api.search({ district: 'chilonzor', rooms: 2, sort: 'cheap' });
  assert.equal(res.total, 8);
  assert.ok(res.items.every((x, i, a) => i === 0 || x.eval.price_uzs >= a[i - 1].eval.price_uzs));
  await assert.rejects(api.search({ rooms: 9 }), { code: 'filter' });
  const card = await api.listing(STORY_CHEAP);
  assert.equal(card.slots.length, 3);
  assert.equal(new Date(card.slots[0].start_at + 5 * HOUR).getUTCFullYear(), 2027); // tomorrow is in the new year
  const own = apiFor(backend, NODIRA);
  const pv = await own.preview({ ...NEW_FLAT, price: 8_900_000 });
  assert.equal(pv.verdict, 'expensive');
  const mine = await own.landlord();
  assert.equal(mine.incoming.length, 1);
  assert.equal(mine.incoming[0].contact, null);
});
