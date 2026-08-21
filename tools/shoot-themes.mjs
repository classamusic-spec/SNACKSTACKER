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

/**
 * Software rasterisation (SwiftShader) renders this scene at roughly 1fps at
 * retina density, which is far too slow to play. Drop to 1x and force the low
 * quality tier so the harness gets a playable frame rate. Merges into any
 * existing save rather than replacing it, so purchases survive a reload.
 */
const SEED_SAVE = () => {
  const KEY = 'snackery.save.v1';
  try {
    const raw = window.localStorage.getItem(KEY);
    const save = raw ? JSON.parse(raw) : { version: 1 };
    save.settings = { ...(save.settings ?? {}), quality: 'low' };
    window.localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* private mode or a corrupt blob — the game falls back to defaults */
  }
};

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
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  await page.addInitScript(SEED_SAVE);
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
    // A reload is far more reliable than hunting for a Home button that may be
    // below the fold on the result sheet. Purchases persist in the save.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    await page.locator('button[aria-label="Shop" i]').first().click();
    await page.waitForTimeout(900);
    const card = page.locator('button.sn-card', { hasText: name }).first();
    if (!(await card.count())) {
      console.log(`  !! no card for ${name}`);
      continue;
    }
    await card.scrollIntoViewIfNeeded().catch(() => undefined);
    if (!(await card.isDisabled())) {
      await card.click();
      await page.waitForTimeout(900);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);

    const play = page.locator('button', { hasText: /^play$/i }).first();
    if (await play.count()) await play.click();
    else await page.keyboard.press('Space');
    await page.waitForTimeout(1400);

    const made = await playWell(page, 6);
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(OUT, `${slug}.png`) });
    const st = await page.evaluate(() => window.__snackeryStats ?? null);
    console.log(`  ${name}: ${made} clean drops`, JSON.stringify(st));
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
