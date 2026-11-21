// Mini App entry inside Telegram: validate nothing here (the server does), just pass initData along.
// "#l=5" in the URL (the bot's "Xaritada ochish" button on a listing) opens that listing's page.
import { normLang } from '../shared/i18n.js';
import { httpApi } from './api.js';
import { mountApp } from './ui.js';
import { h, loadShared } from './util.js';

const tg = window.Telegram?.WebApp;
const root = document.getElementById('app');
const shared = await loadShared();

if (!tg?.initData) {
  root.replaceChildren(h('p', { class: 'ui-outside' }, shared.catalogs.uz['app.open_in_telegram']),
    h('p', { class: 'ui-outside' }, shared.catalogs.ru['app.open_in_telegram']));
} else {
  tg.ready();
  tg.expand();
  const api = httpApi(tg.initData);
  const me = await api.me().catch(() => null);
  const lang = me?.lang ?? normLang(tg.initDataUnsafe?.user?.language_code);
  const app = mountApp(root, { api, ...shared, lang, tg });
  const m = /^#l=(\d{1,9})$/.exec(window.location.hash);
  if (m) app.openListing(Number(m[1]));
}
