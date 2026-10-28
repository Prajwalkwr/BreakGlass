/**
 * Marketing site verification.
 *
 *   npx tsx scripts/verify-marketing.ts
 *
 * Runs against the dev server (WEB_ORIGIN, default http://127.0.0.1:5173) and
 * checks the things a template rebuild usually gets wrong: navigation that
 * leads somewhere, CTAs that reach the real auth screens, metadata, keyboard
 * access, responsive overflow and reduced-motion behaviour. It writes nothing
 * except screenshots under .data/marketing.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Page } from 'playwright';

const WEB = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173';
const SHOTS = path.resolve('.data/marketing');

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function pageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function main() {
  await fs.mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  /* ---------------------------- desktop ---------------------------- */
  console.log('\nDesktop (1440×900)');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  const response = await page.goto(WEB, { waitUntil: 'networkidle' });
  check('home page responds 200', response?.status() === 200, `status ${response?.status()}`);
  check('document title is set', (await page.title()).includes('BreakGlass'));
  check(
    'meta description present',
    (await page.getAttribute('meta[name="description"]', 'content'))?.length! > 40,
  );
  check('og:title present', Boolean(await page.getAttribute('meta[property="og:title"]', 'content')));
  check('og:url present', Boolean(await page.getAttribute('meta[property="og:url"]', 'content')));
  check('canonical link present', Boolean(await page.getAttribute('link[rel="canonical"]', 'href')));
  check('exactly one h1', (await page.locator('h1').count()) === 1);
  check(
    'all landing-page icons are black',
    await page.locator('main svg.lucide').evaluateAll((icons) =>
      icons.every((icon) => getComputedStyle(icon).color === 'rgb(0, 0, 0)'),
    ),
  );
  check(
    'landing-page icon backgrounds are very light blue',
    await page.locator('main [class~="bg-[#eaf3ff]"]').evaluateAll((backgrounds) =>
      backgrounds.length > 0 &&
      backgrounds.every((element) => getComputedStyle(element).backgroundColor === 'rgb(234, 243, 255)'),
    ),
  );
  check(
    'agency number badges are black on the same very light blue',
    await page.locator('#for-agencies article > span:first-child').evaluateAll((badges) =>
      badges.length === 4 &&
      badges.every(
        (badge) =>
          getComputedStyle(badge).color === 'rgb(0, 0, 0)' &&
          getComputedStyle(badge).backgroundColor === 'rgb(234, 243, 255)',
      ),
    ),
  );
  check(
    'hero headline is the requested copy',
    (await page.locator('h1').innerText()).replace(/\s+/g, ' ').toLowerCase().includes('know when your clients’ websites break'),
  );

  // Every in-page nav target must exist.
  for (const hash of ['product', 'how-it-works', 'for-agencies']) {
    check(`#${hash} section exists`, (await page.locator(`#${hash}`).count()) === 1);
  }
  check(
    'removed sections stay absent',
    (await page.locator('#capabilities, #interface, #investigation').count()) === 0,
  );

  // Primary navigation and CTAs.
  const headerNav = page.locator('header nav[aria-label="Primary"] a');
  check('header exposes three primary links', (await headerNav.count()) === 3);
  const ctaHref = await page.locator('header a', { hasText: 'Start Monitoring' }).first().getAttribute('href');
  check('header CTA points at the real signup route', ctaHref === '/signup', String(ctaHref));
  const signInHref = await page.locator('header a', { hasText: 'Sign in' }).first().getAttribute('href');
  check('header sign-in points at the real login route', signInHref === '/login', String(signInHref));
  check('hero primary CTA is Start Monitoring', (await page.locator('main a', { hasText: 'Start Monitoring' }).first().getAttribute('href')) === '/signup');
  check('hero secondary CTA is an in-page link', (await page.locator('main a', { hasText: 'See How It Works' }).first().getAttribute('href')) === '#how-it-works');
  check(
    'numbered section labels are removed',
    !(await page.locator('#product, #how-it-works, #for-agencies').evaluateAll((sections) =>
      sections.map((section) => section.innerText).join('\n'),
    )).match(
      /(?:^|\n)\s*0[1-3]\s+(?:Product|How it works|For agencies)\s*(?:\n|$)/i,
    ) &&
      !(await page.locator('#cta-heading').locator('..').innerText()).match(/(?:^|\n)\s*04\s+Start\s*(?:\n|$)/i),
  );
  check('wordmark links home', (await page.locator('header a[aria-label="BreakGlass — home"]').getAttribute('href')) === '/');

  // Illustrative content is labelled as such.
  const body = await page.locator('body').innerText();
  const howItWorksCopy = await page.locator('#how-it-works').innerText();
  check(
    'how-it-works clarifies tests are optional',
    /Testing is optional[\s\S]*save a draft or activate/i.test(howItWorksCopy),
  );
  check(
    'how-it-works explains alert setup and development email outbox',
    /Configure email or Slack destinations in Settings[\s\S]*development outbox/i.test(howItWorksCopy),
  );
  check('removed illustrative preview stays absent', !/illustrative preview/i.test(body));
  check(
    'no invented social proof',
    !/trusted by|\bcustomers love\b|case stud(y|ies)|\d+ (agencies|teams|customers) (use|trust|rely)/i.test(body),
  );
  check('the page says it has no testimonials rather than inventing them', /no customer logos/i.test(body));
  check('deployment timing is explicitly context only', /deployments listed as timing context only/i.test(body));

  // Scroll through to reveal everything, then confirm nothing stayed hidden.
  let previous = -1;
  for (let index = 0; index < 40; index += 1) {
    await page.evaluate((y) => window.scrollTo(0, y), index * 900);
    await page.waitForTimeout(160);
    const current = await page.evaluate(() => window.scrollY);
    if (current === previous) break;
    previous = current;
  }
  check(
    'no content left hidden after scrolling',
    (await page.evaluate(() => document.querySelectorAll('.reveal:not(.reveal-in)').length)) === 0,
  );
  check('no horizontal overflow', (await pageOverflow(page)) === 0);

  // Images load lazily, so this runs after the scroll pass above.
  await page.waitForTimeout(800);
  const images = await page.evaluate(() =>
    Array.from(document.images).map((image) => ({
      src: image.getAttribute('src'),
      alt: image.getAttribute('alt'),
      complete: image.complete && image.naturalWidth > 0,
    })),
  );
  check(
    'all content images load',
    images.every((image) => image.complete),
    JSON.stringify(images.filter((image) => !image.complete).map((image) => image.src)),
  );
  check(
    'product section background artwork loads',
    await page.locator('#product').evaluate((section) =>
      section.querySelector<HTMLElement>('[aria-hidden="true"]')?.style.backgroundImage.includes('landing-himalaya.webp') ?? false,
    ),
  );
  check(
    'full-resolution correlation banner appears above the agencies heading',
    await page.locator('#for-agencies').evaluate((section) => {
      const image = section.querySelector<HTMLImageElement>('img');
      const heading = section.querySelector('#agencies-heading');
      return Boolean(
        image &&
          heading &&
          image.naturalWidth === 1068 &&
          image.naturalHeight === 156 &&
          (image.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING),
      );
    }),
  );
  check('every image has alt text', images.every((image) => (image.alt ?? '').length > 15));

  // Keyboard: the skip link is the first stop.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.keyboard.press('Tab');
  const firstStop = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
  check('skip link is the first keyboard stop', firstStop === 'Skip to content', firstStop);
  const focusVisible = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element) return false;
    const style = getComputedStyle(element);
    return style.outlineStyle !== 'none' || style.boxShadow !== 'none';
  });
  check('focused element shows a visible ring', focusVisible);

  check('no console errors on the home page', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  /* ------------------------- responsive widths ------------------------- */
  for (const width of [1280, 834, 390, 320]) {
    const viewport = await browser.newPage({ viewport: { width, height: 900 } });
    await viewport.goto(WEB, { waitUntil: 'networkidle' });
    const overflow = await pageOverflow(viewport);
    check(`no horizontal overflow at ${width}px`, overflow === 0, `overflow ${overflow}px`);
    const clipped = await viewport.evaluate(() =>
      Array.from(document.querySelectorAll('main section')).some((section) => section.scrollWidth > section.clientWidth + 1),
    );
    check(`no clipped sections at ${width}px`, !clipped);
    await viewport.close();
  }

  /* --------------------------- mobile menu --------------------------- */
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(WEB, { waitUntil: 'networkidle' });
  const menuButton = mobilePage.getByRole('button', { name: 'Open menu' });
  check('mobile menu button is exposed', (await menuButton.count()) === 1);
  await menuButton.click();
  await mobilePage.waitForTimeout(250);
  check('menu opens', (await mobilePage.getByRole('button', { name: 'Close menu' }).getAttribute('aria-expanded')) === 'true');
  check('menu panel is visible', await mobilePage.locator('#mobile-nav').isVisible());
  await mobilePage.keyboard.press('Escape');
  await mobilePage.waitForTimeout(250);
  check('menu closes with Escape', (await mobilePage.locator('#mobile-nav').isVisible()) === false);
  await menuButton.click();
  await mobilePage.locator('#mobile-nav').getByRole('link', { name: 'How it works', exact: true }).click();
  await mobilePage.waitForTimeout(900);
  check('menu closes after navigation', (await mobilePage.locator('#mobile-nav').isVisible()) === false);
  check(
    'menu link scrolls to its section',
    await mobilePage.evaluate(() => {
      const target = document.querySelector('#how-it-works');
      if (!target) return false;
      const rect = target.getBoundingClientRect();
      return rect.top > -80 && rect.top < 200;
    }),
  );
  await mobile.close();

  /* ------------------------- reduced motion ------------------------- */
  const reduced = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(WEB, { waitUntil: 'networkidle' });
  await reducedPage.waitForTimeout(600);
  const visibleUnderReducedMotion = await reducedPage.evaluate(() => {
    const hero = document.querySelector('h1');
    if (!hero) return false;
    return Number(getComputedStyle(hero).opacity) > 0.9;
  });
  check('hero is visible with reduced motion', visibleUnderReducedMotion);
  const animated = await reducedPage.evaluate(
    () => getComputedStyle(document.querySelector('.animate-fade-up')!).animationDuration,
  );
  check(
    'animations are neutralised with reduced motion',
    Number.parseFloat(animated) <= 0.001,
    animated,
  );
  await reduced.close();

  /* ---------------------------- auth routes ---------------------------- */
  console.log('\nRoutes');
  const auth = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  for (const [route, expect] of [
    ['/signup', /Create your|Start monitoring|Create account/i],
    ['/login', /sign in/i],
    ['/forgot-password', /reset/i],
    ['/privacy', /privacy/i],
    ['/terms', /terms/i],
  ] as const) {
    const result = await auth.goto(`${WEB}${route}`, { waitUntil: 'networkidle' });
    const text = await auth.locator('body').innerText();
    check(`${route} renders with real content`, result?.status() === 200 && expect.test(text));
  }
  const notFound = await auth.goto(`${WEB}/definitely-not-a-page`, { waitUntil: 'networkidle' });
  check('unknown route renders the 404 page', notFound?.status() === 200 && /does not exist/i.test(await auth.locator('body').innerText()));

  // Protected routes must send anonymous visitors to the login screen.
  await auth.goto(`${WEB}/app`, { waitUntil: 'networkidle' });
  await auth.waitForTimeout(500);
  check('anonymous /app redirects to login', auth.url().includes('/login'), auth.url());
  await auth.close();

  await browser.close();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const failure of failures) console.log(` - ${failure}`);
    process.exit(1);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
