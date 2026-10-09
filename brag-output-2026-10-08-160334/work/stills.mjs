import { chromium } from 'playwright-core';
const times = process.argv.slice(2).map(Number);
const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('console', m => console.log('console:', m.text()));
page.on('pageerror', e => console.log('err:', e.message));
await page.goto('file://' + new URL('./video.html', import.meta.url).pathname);
await page.evaluate(() => window.ready);
for (const t of times) {
  await page.evaluate((t) => window.render(t), t);
  await page.screenshot({ path: `stills/t${t.toFixed(2)}.png` });
}
await browser.close();
