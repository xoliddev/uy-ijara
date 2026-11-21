// Demo page: the tenant's and the landlord's phones, the guided story (in order, all at once, or out of order),
// the live Tashkent clock and the language switch.
import { clock, makeT } from '../shared/i18n.js';
import { defaultFilter } from '../shared/search.js';
import { mountApp } from '../webapp/ui.js';
import { h, loadShared, plain } from '../webapp/util.js';
import { apiFor } from './api.js';
import { BotSim } from './bot.js';
import { makeViews } from './bot-views.js';
import { createPhone } from './phone.js';
import { AZIZ, createDemo, NODIRA } from './seed.js';
import { runStep, STEPS } from './story.js';

const shared = await loadShared(new URL('../shared/', import.meta.url), true);
const t = makeT(shared.catalogs);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
let lang = store.get('uyijara.demo.lang') === 'ru' ? 'ru' : 'uz';
const P = (key, params) => plain(t(lang, key, params));
const backend = createDemo({ districts: shared.districts, people: shared.people, lang });
const views = makeViews(t, backend.dmap, backend.rate);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const UIDS = [AZIZ, NODIRA];
const people = {
  [AZIZ]: { who: 'aziz', label: 'demo.tenant', role: 'demo.role_tenant' },
  [NODIRA]: { who: 'nodira', label: 'demo.landlord', role: 'demo.role_landlord' },
};
const phones = {};
const bots = {};
const apps = {};
let shown = AZIZ;

function refreshApp(uid, force = false) {
  const root = phones[uid].appRoot;
  if (!force && (root.querySelector('.ui-backdrop') || root.contains(document.activeElement))) return null;
  return apps[uid]?.refresh();
}

function focus(uid, pane) {
  phones[uid].show(pane);
  if (window.matchMedia('(max-width: 600px)').matches) pick(uid);
}

async function openApp(uid, hash = '') {
  focus(uid, 'app');
  const m = /^#l=(\d+)$/.exec(hash);
  if (m) await apps[uid].openListing(Number(m[1]));
  else await refreshApp(uid, true);
}

for (const uid of UIDS) {
  bots[uid] = new BotSim(backend, uid, t, views, { onChange: () => phones[uid]?.renderChat(), onAlert: (text) => phones[uid].alert(text) });
  phones[uid] = createPhone({
    who: people[uid].who, label: '', role: people[uid].role, bot: bots[uid], texts: { P }, now: () => backend.nowMs(),
    onOpenApp: (hash) => openApp(uid, hash), onShowApp: () => refreshApp(uid, true),
    onContact: () => bots[uid].shareContact(backend.user(uid).phone ?? '+998930001001'),
  });
}

backend.on((ev) => {
  if (['new_request', 'decided', 'cancelled', 'expired', 'alert'].includes(ev.type) && bots[ev.to]) {
    const msg = bots[ev.to].deliver(ev);
    if (msg) phones[ev.to].ping(msg.html);
  }
  for (const uid of UIDS) if (ev.type !== 'changed' || ev.by !== uid) refreshApp(uid);
});

// ── what the story does inside the Mini Apps ──
const $ = (uid, sel) => phones[uid].appRoot.querySelector(sel);
async function until(uid, sel, ms = 4000) {
  for (let i = 0; i < ms / 50; i++) {
    const el = $(uid, sel);
    if (el) return el;
    await wait(50);
  }
  throw new Error(`demo: ${sel} did not appear`);
}
function typeInto(el, text) {
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
const ui = {
  async search(uid, f) {
    const app = apps[uid];
    app.ctx.state.filter = { ...defaultFilter(), ...f };
    app.go('search');
    await app.refresh();
  },
  async open(uid, lid, at = 'verdict') {
    await apps[uid].openListing(lid);
    const el = await until(uid, `[data-testid=${at}]`);
    await wait(250);
    apps[uid].ctx.pageEl.scrollTop = Math.max(0, el.offsetTop - 50);
  },
  async clickSlot(uid, lid, sid) {
    if (apps[uid].ctx.pageId !== lid) await ui.open(uid, lid);
    (await until(uid, `[data-testid=slot-${sid}]`)).click();
    await until(uid, '[data-testid=my-request]');
  },
  async postFlat(uid, d, prices) {
    const app = apps[uid];
    app.go('landlord');
    await app.refresh();
    (await until(uid, '[data-testid=new-listing]')).click();
    const sel = await until(uid, '[data-testid=form-district]');
    sel.value = d.district;
    sel.dispatchEvent(new Event('change'));
    $(uid, `[data-testid=form-rooms-${d.rooms}]`).click();
    for (const [k, v] of [['area', d.area], ['floor', d.floor], ['floors', d.floors]]) typeInto($(uid, `[data-testid=form-${k}]`), String(v));
    $(uid, `[data-testid=form-building-${d.building}]`).click();
    $(uid, `[data-testid=form-renovation-${d.renovation}]`).click();
    if (d.furnished) $(uid, '[data-testid=form-furnished]').click();
    const aud = $(uid, '[data-testid=form-audience]');
    aud.value = d.audience;
    aud.dispatchEvent(new Event('change'));
    typeInto($(uid, '[data-testid=form-address]'), d.address);
    await wait(500);
    const price = $(uid, '[data-testid=form-price]');
    const pageEl = apps[uid].ctx.pageEl;
    pageEl.scrollTop = price.closest('.ui-field').offsetTop - 40;
    for (const target of prices) {
      typeInto(price, '');
      for (let i = 1; i <= target.length; i++) {
        typeInto(price, target.slice(0, i));
        await wait(110);
      }
      await until(uid, '[data-testid=live-verdict]');
      await wait(1300);
    }
    $(uid, '[data-testid=form-publish]').click();
    await until(uid, '[data-testid=new-listing]');
  },
};

// ── page ──
const timeEl = h('span', { class: 'demo-date', 'data-testid': 'demo-time' });
const badgeText = h('span');
const langBtn = h('button', { class: 'demo-btn', type: 'button', 'data-testid': 'demo-lang', onclick: () => setLang(lang === 'uz' ? 'ru' : 'uz') });
const resetBtn = h('button', { class: 'demo-btn', type: 'button', onclick: () => window.location.reload() });
const playBtn = h('button', { class: 'demo-btn solid', type: 'button', 'data-testid': 'play', onclick: () => play() });
const bar = h('header', { class: 'demo-bar' },
  h('a', { class: 'demo-logo', href: './' }, h('span', { class: 'demo-mark', html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 10.6V21h7v-6h5v6h7V10.6z" fill="currentColor"/></svg>' }), 'Uy Ijara'),
  h('span', { class: 'demo-badge', 'data-testid': 'demo-badge' }, h('span', { class: 'dot' }), badgeText),
  h('span', { class: 'demo-time' }, timeEl),
  h('div', { class: 'demo-tools' }, playBtn, langBtn, resetBtn,
    h('a', { class: 'demo-btn gh', href: 'https://github.com/xoliddev/uy-ijara', target: '_blank', rel: 'noopener' }, 'GitHub')));
const title = h('h1');
const lead = h('p');
const foot = h('p', { class: 'demo-foot' });
const env = { backend, bots, wait, focus, ui, done: new Set() };
let running = false;
async function step(i) {
  if (running) return;
  running = true;
  paintStory();
  try {
    await runStep(i + 1, env);
  } catch (err) {
    console.error(err); // eslint-disable-line no-console
    phones[shown].alert(P('err.generic'));
  }
  running = false;
  paintStory();
}
async function play() {
  for (let i = 0; i < STEPS.length; i++) if (!env.done.has(i + 1)) await step(i);
}
const storyBtns = STEPS.map((key, i) => h('button', { class: 'story-btn', type: 'button', 'data-testid': `story-${i + 1}`,
  onclick: () => step(i) }, h('b', {}, String(i + 1)), h('span')));
function paintStory() {
  const next = STEPS.findIndex((_, i) => !env.done.has(i + 1));
  storyBtns.forEach((b, i) => {
    b.lastChild.textContent = P(`demo.${STEPS[i]}`);
    b.classList.toggle('done', env.done.has(i + 1));
    b.classList.toggle('next', i === next && !running);
    b.disabled = running;
  });
  playBtn.disabled = running || next < 0;
}
const whoBtns = UIDS.map((uid) => h('button', { type: 'button', 'data-testid': `switch-${people[uid].who}`, onclick: () => pick(uid) }));
function pick(uid) {
  shown = uid;
  whoBtns.forEach((b, i) => b.classList.toggle('on', UIDS[i] === uid));
  for (const id of UIDS) phones[id].side.classList.toggle('show', id === uid);
}

function paintTexts() {
  document.documentElement.lang = lang;
  badgeText.textContent = P('demo.badge');
  timeEl.textContent = P('demo.time', { time: clock(backend.nowMs()) });
  langBtn.textContent = lang === 'uz' ? 'RU' : 'UZ';
  resetBtn.textContent = P('demo.reset');
  playBtn.textContent = P('demo.play');
  title.textContent = P('demo.title');
  lead.textContent = P('demo.lead');
  foot.textContent = P('demo.no_bot');
  whoBtns.forEach((b, i) => { b.textContent = P(people[UIDS[i]].label); });
  paintStory();
  for (const uid of UIDS) {
    phones[uid].renderLabels();
    phones[uid].side.querySelector('.side-label b').textContent = P(people[uid].label);
  }
}

function setLang(next) {
  if (next === lang) return;
  lang = next;
  store.set('uyijara.demo.lang', lang);
  for (const uid of UIDS) {
    backend.setLang(uid, lang);
    apps[uid].ctx.lang = lang;
    refreshApp(uid, true);
  }
  paintTexts();
}

setInterval(() => {
  timeEl.textContent = P('demo.time', { time: clock(backend.nowMs()) });
  for (const uid of UIDS) phones[uid].tick();
}, 15_000);

document.body.append(bar, h('section', { class: 'demo-intro' }, title, lead), h('nav', { class: 'story', 'aria-label': 'story' }, storyBtns),
  h('div', { class: 'who-switch', role: 'tablist' }, whoBtns),
  h('main', { class: 'demo-stage' }, phones[AZIZ].side, phones[NODIRA].side), foot);
for (const uid of UIDS) {
  apps[uid] = mountApp(phones[uid].appRoot, { api: apiFor(backend, uid), ...shared, lang, tg: { colorScheme: 'light' },
    onLang: (l) => setLang(l), start: uid === NODIRA ? 'landlord' : 'search' });
  bots[uid].start();
}
pick(AZIZ);
paintTexts();
document.body.dataset.ready = '1';
