/**
 * Screenshot harness: boots the built game in headless Chromium, plays it
 * properly (timing drops off the live offset the game exposes rather than
 * tapping blind), and writes PNGs for visual review.
 *
 *   node tools/shoot.mjs [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? 'shots');
const URL = process.env.SNACKERY_URL ?? 'http://localhost:4173/';
const PHONE = { width: 393, height: 852 }; // iPhone 15 Pro logical size
mkdirSync(OUT, { recursive: true });

/**
 * The container ships a pinned Chromium that may not match this Playwright
 * build's expected revision, so point at it explicitly rather than downloading.
 */
const CHROME_CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
];
const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));

const errors = [];
const shot = async (page, name) => {
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
  console.log(`  shot ${name}`);
};
const stats = (page) => page.evaluate(() => window.__snackeryStats ?? null);
const tap = (page, y = 0.55) => page.mouse.click(PHONE.width / 2, PHONE.height * y);

/** Tap when the sliding layer is close to aligned — i.e. actually play well. */
async function playWell(page, { drops, tolerance = 0.07, budgetMs = 20000 }) {
  const deadline = Date.now() + budgetMs;
  let made = 0;
  while (made < drops && Date.now() < deadline) {
    const s = await stats(page);
    if (!s || s.state !== 'playing') break;
    if (s.offset !== null && Math.abs(s.offset) <= tolerance) {
      await tap(page);
      made++;
      await page.waitForTimeout(90);
    } else {
      await page.waitForTimeout(16);
    }
  }
  return made;
}

const openAndShoot = async (page, name, label) => {
  const btn = page
    .locator(`button[aria-label="${label}" i], button:has-text("${label}")`)
    .first();
  if (!(await btn.count())) {
    console.log(`  (no control "${label}")`);
    return false;
  }
  await btn.click();
  await page.waitForTimeout(1000);
  await shot(page, name);
  return true;
};

const run = async () => {
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
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
  await shot(page, '01-home');

  await openAndShoot(page, '02-store', 'Shop');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await openAndShoot(page, '03-settings', 'Settings');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  const play = page.locator('button', { hasText: /^play$/i }).first();
  if (await play.count()) await play.click();
  else await page.keyboard.press('Space');
  await page.waitForTimeout(1300);
  await shot(page, '04-game-start');

  const made = await playWell(page, { drops: 5 });
  console.log(`  clean drops: ${made}`);
  await page.waitForTimeout(400);
  await shot(page, '05-game-early');
  console.log('  stats', JSON.stringify(await stats(page)));

  const more = await playWell(page, { drops: 16, budgetMs: 30000 });
  console.log(`  clean drops (total): ${made + more}`);
  await page.waitForTimeout(400);
  await shot(page, '06-game-tall');
  console.log('  stats', JSON.stringify(await stats(page)));

  // Now miss on purpose to reach the result screen.
  for (let i = 0; i < 25; i++) {
    const s = await stats(page);
    if (!s || s.state !== 'playing') break;
    await tap(page);
    await page.waitForTimeout(160);
  }
  await page.waitForTimeout(3000);
  await shot(page, '07-result');
  console.log('  stats', JSON.stringify(await stats(page)));

  await browser.close();
  if (errors.length) {
    console.error(`\n${errors.length} runtime error(s):`);
    for (const e of errors.slice(0, 25)) console.error('  ' + e);
    process.exitCode = 1;
  } else {
    console.log('\nno runtime errors');
  }
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
