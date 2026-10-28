import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const OUT = '/home/user/.data/marketing';
const browser = await chromium.launch({ args: ['--no-sandbox'] });

// 1. Mobile menu open
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
await m.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await m.getByRole('button', { name: 'Open menu' }).click();
await m.waitForTimeout(500);
await m.screenshot({ path: `${OUT}/menu-mobile.jpg`, type: 'jpeg', quality: 72 });
console.log('menu expanded:', await m.getByRole('button', { name: 'Close menu' }).getAttribute('aria-expanded'));
await m.keyboard.press('Escape');
await m.waitForTimeout(300);
console.log('after escape, expanded:', await m.getByRole('button', { name: 'Open menu' }).getAttribute('aria-expanded'));

// 2. CTA + footer desktop
const d = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await d.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await d.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await d.waitForTimeout(1200);
await d.screenshot({ path: `${OUT}/cta-footer.jpg`, type: 'jpeg', quality: 72 });

// 3. Privacy page
await d.goto('http://127.0.0.1:5173/privacy', { waitUntil: 'networkidle' });
await d.waitForTimeout(700);
await d.screenshot({ path: `${OUT}/privacy.jpg`, type: 'jpeg', quality: 72 });
console.log('privacy title:', await d.title());
await browser.close();
