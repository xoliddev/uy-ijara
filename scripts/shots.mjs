// README media from the real demo: desktop + phone screenshots (JPEG), an 800x500 portfolio thumbnail and a GIF of
// the fair-price + viewing flow. JPEG is encoded by the browser (canvas), the GIF by gifenc. Map tiles are real OSM.
//   PW_CHANNEL=chrome node scripts/shots.mjs [outDir]       (needs playwright + gifenc)
import { mkdirSync, writeFileSync } from 'node:fs';
import gifenc from 'gifenc';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const OUT = process.argv[2] ?? 'docs/media';
const PORT = Number(process.env.SHOTS_PORT ?? 4299);
mkdirSync(OUT, { recursive: true });
const server = await startServer(PORT);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });

async function open(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, timezoneId: 'Asia/Tashkent' });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('body[data-ready="1"]');
  return page;
}

/** PNG -> resized JPEG through the page's canvas. */
async function jpeg(page, png, name, w, h, crop = null) {
  const b64 = await page.evaluate(async ([src, W, H, c]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    g.imageSmoothingQuality = 'high';
    const [sx, sy, sw, sh] = c ?? [0, 0, img.width, img.height];
    g.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
    return cv.toDataURL('image/jpeg', 0.86).split(',')[1];
  }, [png.toString('base64'), w, h, crop]);
  writeFileSync(`${OUT}/${name}`, Buffer.from(b64, 'base64'));
  console.log('wrote', name); // eslint-disable-line no-console
}

const step = async (page, n) => {
  await page.getByTestId(`story-${n}`).click();
  await page.waitForFunction((k) => document.querySelector(`[data-testid=story-${k}]`).classList.contains('done'), n, { timeout: 60_000 });
};
const tiles = (page) => page.waitForFunction(() => {
  const imgs = [...document.querySelectorAll('.leaflet-tile')].filter((i) => i.offsetParent);
  return imgs.length && imgs.every((i) => i.complete);
}, null, { timeout: 15_000 }).catch(() => {});
const toPhones = (page) => page.evaluate(() => {
  const top = document.querySelector('[data-testid=aziz-phone]').getBoundingClientRect().top + window.scrollY;
  window.scrollTo(0, top - 70);
});

// desktop: the tenant's map with coloured pins next to the landlord's panel
let page = await open(1440, 900);
for (const n of [1, 2]) await step(page, n);
await page.getByTestId('nodira-tab-app').click();
await toPhones(page);
await tiles(page);
await page.waitForTimeout(900);
await jpeg(page, await page.screenshot(), 'demo-desktop.jpg', 1440, 900);

// thumbnail: the verdict page next to the live suggested band, on a dark card with the question
await step(page, 4);
await page.waitForTimeout(600);
const left = await page.getByTestId('aziz-phone').screenshot();
await step(page, 8);
await page.getByTestId('nodira-tab-app').click();
await page.getByTestId('nodira-app').getByTestId('new-listing').click();
const form = page.getByTestId('nodira-app');
await form.getByTestId('form-area').fill('54');
await form.getByTestId('form-floor').fill('3');
await form.getByTestId('form-floors').fill('9');
await form.getByTestId('form-price').fill('8 900 000');
await form.getByTestId('live-verdict').waitFor();
await page.waitForTimeout(3200); // let the "published" toast from step 8 fade out
await page.evaluate(() => {
  const pg = document.querySelector('[data-testid=nodira-app] .ui-page');
  pg.scrollTop = document.querySelector('[data-testid=nodira-app] [data-testid=live-band]').offsetTop - 260;
});
await page.waitForTimeout(500);
const right = await page.getByTestId('nodira-phone').screenshot();
const thumb = await page.evaluate(async ([a, b]) => {
  const load = async (s) => { const i = new Image(); i.src = `data:image/png;base64,${s}`; await i.decode(); return i; };
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const cv = document.createElement('canvas');
  cv.width = 1600;
  cv.height = 1000;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1600, 1000);
  grad.addColorStop(0, '#1d2330');
  grad.addColorStop(1, '#2b3446');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1600, 1000);
  g.fillStyle = '#f5f3ee';
  g.font = '800 84px -apple-system, Segoe UI, Roboto, sans-serif';
  g.fillText('Uy Ijara', 90, 250);
  g.font = '600 50px -apple-system, Segoe UI, Roboto, sans-serif';
  g.fillStyle = '#c9d1e0';
  g.fillText('Narx adolatlimi?', 90, 330);
  const chips = [['Arzon', '#14965a'], ['Adolatli', '#2f6fdb'], ['Qimmat', '#d6443a']];
  let x = 90;
  g.font = '700 34px -apple-system, Segoe UI, Roboto, sans-serif';
  for (const [label, color] of chips) {
    const w = g.measureText(label).width + 64;
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(x, 400, w, 64, 32);
    g.fill();
    g.fillStyle = '#fff';
    g.fillText(label, x + 32, 444);
    x += w + 18;
  }
  g.font = '500 30px -apple-system, Segoe UI, Roboto, sans-serif';
  g.fillStyle = '#9aa6bd';
  ['Telegram bot + Mini App', 'Toshkentda ijara: har bir e’lon', 'o‘xshash uylar bilan solishtiriladi'].forEach((s, i) => g.fillText(s, 90, 560 + i * 46));
  const h = 860;
  const draw = (img, dx) => g.drawImage(img, dx, 70, (img.width * h) / img.height, h);
  draw(ia, 700);
  draw(ib, 700 + (ia.width * h) / ia.height + 24);
  const out = document.createElement('canvas');
  out.width = 800;
  out.height = 500;
  const o = out.getContext('2d');
  o.imageSmoothingQuality = 'high';
  o.drawImage(cv, 0, 0, 800, 500);
  return out.toDataURL('image/jpeg', 0.88).split(',')[1];
}, [left.toString('base64'), right.toString('base64')]);
writeFileSync(`${OUT}/thumb.jpg`, Buffer.from(thumb, 'base64'));
console.log('wrote thumb.jpg'); // eslint-disable-line no-console
await page.context().close();

// phone: the cheap listing's verdict page
page = await open(390, 844);
for (const n of [1, 2, 3, 4]) await step(page, n);
await page.getByTestId('aziz-phone').scrollIntoViewIfNeeded();
await page.waitForTimeout(800);
await jpeg(page, await page.screenshot(), 'demo-mobile.jpg', 390, 844);
await page.context().close();

// GIF: map -> "Qimmat" -> "Arzon" -> slot -> accepted -> contacts -> new listing with the live band -> alert
page = await open(1280, 800);
const W = 840;
const H = 560;
const gif = GIFEncoder();
await step(page, 1);
await step(page, 2);
await toPhones(page);
await tiles(page);
const clip = await page.evaluate(() => {
  const a = document.querySelector('[data-testid=aziz-phone]').getBoundingClientRect();
  const b = document.querySelector('[data-testid=nodira-phone]').getBoundingClientRect();
  const x = Math.max(0, a.left - 30);
  const w = b.right + 30 - x;
  return { x, y: Math.max(0, a.top - 10), width: w, height: Math.round((w * 2) / 3) };
});
async function frame(delay = 160) {
  const png = await page.screenshot({ clip });
  const rgba = await page.evaluate(async ([src, w, h]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    return Array.from(g.getImageData(0, 0, w, h).data);
  }, [png.toString('base64'), W, H]);
  const data = Uint8Array.from(rgba);
  const palette = quantize(data, 128);
  gif.writeFrame(applyPalette(data, palette), W, H, { palette, delay });
}
await frame(1400);
for (const n of [3, 4, 5, 6, 7, 8, 9]) {
  await page.getByTestId(`story-${n}`).click();
  for (let k = 0; k < 40; k++) {
    await page.waitForTimeout(420);
    await frame(240);
    const finished = await page.evaluate((s) => document.querySelector(`[data-testid=story-${s}]`).classList.contains('done'), n);
    if (finished && k > 2) break;
  }
  await frame(1300);
}
await frame(2600);
gif.finish();
writeFileSync(`${OUT}/fair-price-flow.gif`, gif.bytes());
console.log('wrote fair-price-flow.gif'); // eslint-disable-line no-console
await browser.close();
server.close();
