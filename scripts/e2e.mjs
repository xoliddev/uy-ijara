// Browser test of the demo at 1440 px and 375 px. Fails on any console error, page error or failed request.
//   PW_CHANNEL=chrome node scripts/e2e.mjs        (needs `playwright`: npm i --no-save playwright)
// Map tiles are answered locally with a blank image, so the test never depends on (or loads) openstreetmap.org.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const PORT = Number(process.env.E2E_PORT ?? 4298);
const BASE = process.env.E2E_URL ?? `http://127.0.0.1:${PORT}/`;
const server = process.env.E2E_URL ? null : await startServer(PORT);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const errors = [];
let checks = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks += 1;
};

async function open(width, height, lang = 'uz') {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'uz-UZ', timezoneId: 'Asia/Tashkent' });
  await ctx.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png',
    body: TILE, headers: { 'Access-Control-Allow-Origin': '*' } }));
  await ctx.addInitScript((l) => { try { localStorage.setItem('uyijara.demo.lang', l); } catch { /* */ } }, lang);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${width}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${width}] ${e.message}`));
  page.on('requestfailed', (r) => {
    // Leaflet cancels tiles it no longer needs when the map moves; an aborted tile is not an error.
    if (r.url().startsWith('https://tile.openstreetmap.org/') && r.failure()?.errorText === 'net::ERR_ABORTED') return;
    errors.push(`[${width}] request failed ${r.url()} ${r.failure()?.errorText}`);
  });
  await page.goto(BASE);
  await page.waitForSelector('body[data-ready="1"]', { timeout: 20_000 });
  return page;
}

const text = (page, sel) => page.locator(sel).innerText();
const has = (page, sel, s) => page.waitForFunction(([q, v]) => document.querySelector(q)?.innerText.includes(v), [sel, s], { timeout: 15_000 });
async function step(page, n) {
  await page.getByTestId(`story-${n}`).click();
  await page.waitForFunction((k) => document.querySelector(`[data-testid=story-${k}]`).classList.contains('done'), n, { timeout: 45_000 });
}
const show = async (page, mobile, who, pane) => {
  if (mobile) await page.getByTestId(`switch-${who}`).click();
  await page.getByTestId(`${who}-tab-${pane}`).click();
};

async function story(page, mobile) {
  ok((await text(page, '[data-testid=demo-badge]')).includes('brauzeringizda'), 'demo badge');
  if (mobile) {
    ok(await page.getByTestId('aziz-phone').isVisible(), 'tenant visible on a phone');
    ok(!(await page.getByTestId('nodira-phone').isVisible()), 'only one phone at a time');
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal scroll at 375 px');
  } else {
    ok(await page.getByTestId('nodira-phone').isVisible(), 'both phones at 1440 px');
  }
  const app = page.getByTestId('aziz-app');
  await step(page, 1);
  ok((await text(page, '[data-testid=aziz-chat]')).includes('Topildi: 8'), 'bot found 8 two-room flats in Chilonzor');
  await step(page, 2);
  await app.locator('.ui-pin.is-expensive').first().waitFor({ state: 'attached' });
  ok(await app.locator('.ui-pin.is-cheap').count() >= 2, 'green pins on the map');
  ok(await app.locator('.ui-pin').count() === 8, 'eight pins for the filter');
  await step(page, 3);
  ok((await text(page, '[data-testid=aziz-app] [data-testid=verdict]')).includes('22% qimmat'), 'the expensive one explains itself');
  ok(await app.getByTestId('plan').count() === 1, 'floor plan in the gallery');
  await step(page, 4);
  ok((await text(page, '[data-testid=aziz-app] [data-testid=verdict]')).includes('26% arzon'), 'the cheap one');
  ok(!(await text(page, '[data-testid=aziz-app] [data-testid=viewing]')).includes('+998'), 'no phone before acceptance');
  await step(page, 5);
  await show(page, mobile, 'nodira', 'chat');
  ok((await text(page, '[data-testid=nodira-chat]')).includes("Yangi so'rov"), 'landlord notified with buttons');
  await step(page, 6);
  await step(page, 7);
  await show(page, mobile, 'aziz', 'app');
  await has(page, '[data-testid=aziz-app] [data-testid=contact]', '+998 90 000 30 01');
  ok(true, 'contacts and the exact address after acceptance');
  await step(page, 8);
  await show(page, mobile, 'nodira', 'app');
  await has(page, '[data-testid=nodira-app]', '6 300 000');
  ok((await text(page, '[data-testid=nodira-app]')).includes('Adolatli'), 'new listing published with a fair verdict');
  await step(page, 9);
  await show(page, mobile, 'aziz', 'chat');
  ok((await text(page, '[data-testid=aziz-chat]')).includes('Saqlangan qidiruvingizga mos'), 'saved search fired');
}

async function outOfOrder(page) {
  await step(page, 9);
  await page.getByTestId('switch-aziz').click();
  await page.getByTestId('aziz-tab-chat').click();
  ok((await text(page, '[data-testid=aziz-chat]')).includes('Saqlangan qidiruvingizga mos'), 'step 9 first still works');
  await step(page, 3);
  ok((await text(page, '[data-testid=aziz-app] [data-testid=verdict]')).includes('qimmat'), 'then step 3');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'still no horizontal scroll');
}

async function miniApp(page) {
  await page.getByTestId('aziz-tab-app').click();
  const app = page.getByTestId('aziz-app');
  await app.getByTestId('count').waitFor();
  const before = await text(page, '[data-testid=aziz-app] [data-testid=count]');
  await app.getByTestId('search').fill('Чиланзар евро');
  await page.waitForFunction((b) => document.querySelector('[data-testid=aziz-app] [data-testid=count]').innerText !== b, before);
  const cards = app.locator('.ui-card');
  await cards.first().waitFor();
  ok((await cards.count()) >= 1 && (await cards.count()) < 15, 'Cyrillic search with a feature word');
  await cards.first().click();
  await app.getByTestId('gallery').waitFor();
  ok((await text(page, '[data-testid=aziz-app] [data-testid=detail-title]')).includes('Chilonzor'), 'listing page opens');
  await app.getByTestId('report').click();
  await app.getByTestId('report-price').click();
  await has(page, '[data-testid=aziz-app] .ui-toasts', 'Rahmat');
  ok(true, 'report sent');
  await app.getByTestId('page-back').click();
  await page.getByTestId('nodira-tab-app').click();
  const own = page.getByTestId('nodira-app');
  await own.getByTestId('new-listing').click();
  await own.getByTestId('form-area').fill('40');
  await own.getByTestId('form-price').fill('$900');
  await own.getByTestId('live-verdict').waitFor();
  ok((await text(page, '[data-testid=nodira-app] [data-testid=live-band]')).includes('Qimmat'), 'live band reacts to a typed dollar price');
  await own.getByTestId('page-back').click();
  await page.getByTestId('demo-lang').click();
  ok((await text(page, '[data-testid=demo-badge]')).includes('браузере'), 'Russian switch');
  await page.waitForFunction(() => document.querySelector('[data-testid=aziz-app]').innerText.includes('Поиск'));
  ok(true, 'Mini App in Russian');
}

try {
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    const page = await open(w, h);
    await story(page, w < 600);
    await page.context().close();
  }
  let page = await open(375, 812);
  await outOfOrder(page);
  await page.context().close();
  page = await open(1440, 900);
  await miniApp(page);
  await page.context().close();
  const phone = await open(375, 812, 'ru');
  ok((await text(phone, '[data-testid=demo-badge]')).includes('браузере'), 'opens in Russian on a phone');
  await phone.context().close();
  assert.deepEqual(errors, [], `console errors:\n${errors.join('\n')}`);
  console.log(`e2e: ${checks} checks passed at 1440 px and 375 px, 0 console errors`); // eslint-disable-line no-console
} finally {
  await browser.close();
  server?.close();
}
