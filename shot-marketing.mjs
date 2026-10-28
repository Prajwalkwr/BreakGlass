import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const OUT = '/home/user/.data/marketing';
await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const errors = [];
const widths = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 834, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
];
for (const w of widths) {
  const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${w.name}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${w.name} pageerror: ${e.message}`));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  let index = 0;
  let previous = -1;
  while (index < 40) {
    const y = index * w.height;
    await page.evaluate((target) => window.scrollTo(0, target), y);
    await page.waitForTimeout(280);
    await page.screenshot({ path: `${OUT}/${w.name}-${String(index).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 68 });
    index += 1;
    const current = await page.evaluate(() => window.scrollY);
    if (current === previous) break;
    previous = current;
  }
  console.log(`  ${index} frames`);
  const hidden = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.reveal:not(.reveal-in)')).map((el) => (el.textContent || '').slice(0, 60)),
  );
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const unloaded = await page.evaluate(() =>
    Array.from(document.images).filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.getAttribute('src')),
  );
  const total = await page.evaluate(() => document.body.scrollHeight);
  console.log(`${w.name}: height=${total} overflow=${overflow} hiddenReveals=${hidden.length} unloadedImages=${unloaded.length}`);
  if (hidden.length) console.log('   hidden:', hidden.slice(0, 6));
  if (unloaded.length) console.log('   unloaded:', unloaded.slice(0, 6));
  await ctx.close();
}
console.log('console errors:', errors.length ? errors.slice(0, 10) : 'none');
await browser.close();
