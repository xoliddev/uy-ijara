// Dev helper (not shipped in CI): run the story in Chrome and save screenshots after each step.
//   PW_CHANNEL=chrome node scripts/peek.mjs <outDir> [width] [height]
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const OUT = process.argv[2];
const W = Number(process.argv[3] ?? 1440);
const H = Number(process.argv[4] ?? 900);
const server = await startServer(4297);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.route('https://tile.openstreetmap.org/**', (r) => r.abort());
await page.goto('http://127.0.0.1:4297/');
await page.waitForSelector('body[data-ready="1"]');
const steps = (process.env.STEPS ?? '1,2,3,4,5,6,7,8,9').split(',').map(Number);
for (const n of steps) {
  await page.getByTestId(`story-${n}`).click();
  try {
    await page.waitForFunction((k) => document.querySelector(`[data-testid=story-${k}]`).classList.contains('done'), n, { timeout: 40_000 });
  } catch (e) {
    console.log('step', n, 'stuck; errors:', errors);
    await page.screenshot({ path: `${OUT}/stuck${n}-${W}.png` });
    throw e;
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/step${n}-${W}.png` });
}
console.log('errors:', errors);
await browser.close();
server.close();
