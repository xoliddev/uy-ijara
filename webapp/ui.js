// The Mini App: mountApp(root, opts) renders into `root` and keeps all state per instance, so the browser demo can
// run two of them (the tenant's and the landlord's phones) side by side.
import { makeT } from '../shared/i18n.js';
import { renderDetail } from './screens-detail.js';
import { renderLandlord } from './screens-landlord.js';
import { renderMy } from './screens-my.js';
import { renderSearch } from './screens-search.js';
import { applyTheme, h, haptic, plain } from './util.js';

const LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 10.6V21h7v-6h5v6h7V10.6z" fill="currentColor"/></svg>';

export function mountApp(root, { api, catalogs, districts, lang = 'uz', tg = null, onLang = null, start = null }) {
  const t = makeT(catalogs);
  const ctx = {
    root, api, tg, lang, districts, me: null, now: Date.now(), rate: 12_800, tab: start,
    dmap: Object.fromEntries(districts.map((d) => [d.id, d])),
    state: { filter: null, res: null, form: null },
    t, T: (key, params) => t(ctx.lang, key, params), P: (key, params) => plain(t(ctx.lang, key, params)),
    toast, sheet, fail, refresh, go, openListing, page, closePage,
  };
  root.classList.add('ui');
  applyTheme(root, tg);
  const head = h('header', { class: 'ui-head' });
  const tabs = h('nav', { class: 'ui-tabs', role: 'tablist' });
  const body = h('main', { class: 'ui-body' });
  const toasts = h('div', { class: 'ui-toasts', 'aria-live': 'polite' });
  root.replaceChildren(head, tabs, body, toasts);
  const screens = { search: renderSearch, my: renderMy, landlord: renderLandlord };

  function toast(html, kind = 'ok') {
    const el = h('div', { class: `ui-toast ${kind}`, html, role: 'status' });
    toasts.append(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3000);
  }

  function fail(err) {
    haptic(tg, 'error');
    const code = err?.code ?? 'generic';
    toast(ctx.T(catalogs[ctx.lang][`err.${code}`] ? `err.${code}` : code.startsWith('l_') ? 'err.l_generic' : 'err.generic'), 'bad');
  }

  /** Bottom sheet inside this app instance. `build(close)` returns the sheet's content nodes. */
  function sheet(title, build) {
    root.querySelector('.ui-backdrop')?.remove();
    const close = () => {
      wrap.classList.add('out');
      setTimeout(() => wrap.remove(), 160);
    };
    const panel = h('section', { class: 'ui-sheet', role: 'dialog', 'aria-label': plain(title) },
      h('div', { class: 'ui-sheet-head' }, h('h3', { html: title }),
        h('button', { class: 'ui-x', type: 'button', 'aria-label': ctx.P('app.close'), onclick: close }, '×')));
    const wrap = h('div', { class: 'ui-backdrop', onclick: (e) => { if (e.target === wrap) close(); } }, panel);
    panel.append(...[build(close)].flat().filter(Boolean));
    root.append(wrap);
    return close;
  }

  /** A full-screen page over the tabs (a listing's card) with its own "⬅️ Orqaga". */
  function page(testid) {
    ctx.pageEl?.remove();
    const back = h('button', { class: 'ui-back', type: 'button', 'data-testid': 'page-back', onclick: () => closePage() },
      ctx.T('btn.back'));
    const inner = h('div', { class: 'ui-page-body' });
    const el = h('section', { class: 'ui-page', 'data-testid': testid }, h('div', { class: 'ui-page-bar' }, back), inner);
    root.append(el);
    ctx.pageEl = el;
    return inner;
  }

  function closePage() {
    ctx.pageEl?.remove();
    ctx.pageEl = null;
    ctx.pageId = null;
  }

  async function openListing(id) {
    ctx.pageId = id;
    try {
      await renderDetail(ctx, id);
    } catch (err) {
      closePage();
      fail(err);
    }
  }

  function paintHead() {
    head.replaceChildren(h('div', { class: 'ui-brand' }, h('span', { class: 'ui-logo', html: LOGO }), h('b', {}, ctx.T('app.title'))),
      h('button', { class: 'ui-lang', type: 'button', 'data-testid': 'app-lang', onclick: switchLang }, ctx.T('app.lang')));
    const list = [['search', 'app.tab_search'], ['my', 'app.tab_my'], ['landlord', 'app.tab_landlord']];
    tabs.replaceChildren(...list.map(([id, key]) => h('button', {
      class: `ui-tab${ctx.tab === id ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(ctx.tab === id),
      'data-testid': `tab-${id}`, onclick: () => go(id),
    }, ctx.T(key))));
  }

  async function switchLang() {
    const next = ctx.lang === 'uz' ? 'ru' : 'uz';
    try {
      await api.setLang(next);
    } catch (err) {
      fail(err);
      return;
    }
    ctx.lang = next;
    root.lang = next;
    onLang?.(next);
    refresh();
  }

  function go(tab) {
    closePage();
    ctx.tab = tab;
    root.dataset.screen = tab;
    refresh();
  }

  let painting = Promise.resolve();
  function refresh() {
    painting = painting.then(async () => {
      try {
        ctx.me = await api.me();
        ctx.now = ctx.me.now ?? Date.now();
        ctx.rate = ctx.me.rate ?? ctx.rate;
        if (!ctx.state.filter) ctx.state.filter = ctx.me.filter;
        if (!ctx.tab) ctx.tab = 'search';
        root.dataset.screen = ctx.tab;
        paintHead();
        await screens[ctx.tab](ctx, body);
        if (ctx.pageId) await renderDetail(ctx, ctx.pageId, true);
      } catch (err) {
        fail(err);
      }
    });
    return painting;
  }

  refresh();
  return { refresh, go, ctx, openListing, get tab() { return ctx.tab; } };
}
