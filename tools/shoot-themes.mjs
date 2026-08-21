/**
 * Theme sweep: buys the bundle through the real store flow, then plays a few
 * clean drops in every theme and screenshots each one. Doubles as an
 * end-to-end test of purchase -> grant -> select -> palette swap.
 *
 *   node tools/shoot-themes.mjs [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? 'shots/themes');
const URL = process.env.SNACKERY_URL ?? 'http://localhost:4173/';
const PHONE = { width: 393, height: 852 };
mkdirSync(OUT, { recursive: true });

const CHROME = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
].find((p) => existsSync(p));

const THEMES = [
  'Classic Diner',
  'Sushi Tower',
  'Candy Stack',
  'Taco Night',
  'Breakfast Rush',
  'Pizza Piazza',
];

const errors = [];

/** Decide inside the page at frame rate; CDP polling misses the window. */
const playWell = (page, drops, budgetMs = 26000) =>
  page.evaluate(
    ({ drops, budgetMs }) =>
      new Promise((done) => {
        const canvas = document.getElementById('gl');
        const deadline = performance.now() + budgetMs;
        let made = 0;
        let cooldown = 0;
        const step = () => {
          const s = window.__snackeryStats;
          if (!s || s.state !== 'playing' || performance.now() > deadline) return done(made);
          if (cooldown > 0) cooldown--;
          else if (s.offset !== null && Math.abs(s.offset) <= 0.16) {
            canvas.dispatchEvent(
              new PointerEvent('pointerdown', { bubbles: true, cancelable: true }),
            );
            if (++made >= drops) return done(made);
            cooldown = 5;
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    { drops, budgetMs },
  );

const run = async () => {
  const browser = await chromium.launch({
    ...(CHROME ? { executablePath: CHROME } : {}),
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
    ],
  });
  const page = await browser.newPage({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // Buy the bundle through the real store, so every theme is selectable.
  await page.locator('button[aria-label="Shop" i]').first().click();
  await page.waitForTimeout(900);
  const bundle = page.locator('button.sn-card', { hasText: /full menu/i }).first();
  if (await bundle.count()) {
    await bundle.click();
    await page.waitForTimeout(2200);
    console.log('  bought the bundle');
  } else {
    console.log('  !! no bundle card found');
  }

  for (const name of THEMES) {
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    // Reopen the shop if a purchase auto-selected a theme and closed it.
    if (!(await page.locator('.sn-sheet', { hasText: 'Shop' }).count())) {
      await page.locator('button[aria-label="Shop" i]').first().click();
      await page.waitForTimeout(800);
    }
    const card = page.locator('button.sn-card', { hasText: name }).first();
    if (await card.count()) {
      await card.scrollIntoViewIfNeeded().catch(() => undefined);
      if (!(await card.isDisabled())) {
        await card.click();
        await page.waitForTimeout(900);
      }
    } else {
      console.log(`  !! no card for ${name}`);
      continue;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);

    const play = page.locator('button', { hasText: /^play$/i }).first();
    if (await play.count()) await play.click();
    else await page.keyboard.press('Space');
    await page.waitForTimeout(1200);

    const made = await playWell(page, 6);
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(OUT, `${slug}.png`) });
    console.log(`  ${name}: ${made} clean drops`);

    // Back to home for the next theme.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const home = page.locator('button', { hasText: /^home$/i }).first();
    if (await home.count()) await home.click();
    await page.waitForTimeout(1400);
  }

  await browser.close();
  if (errors.length) {
    console.error(`\n${errors.length} runtime error(s):`);
    for (const e of errors.slice(0, 20)) console.error('  ' + e);
    process.exitCode = 1;
  } else {
    console.log('\nno runtime errors');
  }
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
