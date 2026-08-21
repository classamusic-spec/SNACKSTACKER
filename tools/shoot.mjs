/**
 * Screenshot harness: boots the built game in headless Chromium, drives it
 * through real taps, and writes PNGs for visual review.
 *
 *   node tools/shoot.mjs [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The container ships a pinned Chromium that may not match this Playwright
 * build's expected revision, so point at it explicitly rather than downloading.
 */
const CHROME_CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
];
const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));

const OUT = resolve(process.argv[2] ?? 'shots');
const URL = process.env.SNACKERY_URL ?? 'http://localhost:4173/';
const PHONE = { width: 393, height: 852 }; // iPhone 15 Pro logical size
mkdirSync(OUT, { recursive: true });

const errors = [];

const shot = async (page, name) => {
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
  console.log(`  shot ${name}`);
};

const tapCentre = async (page) => {
  await page.mouse.click(PHONE.width / 2, PHONE.height * 0.62);
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

  // Start a run via the play button if present, else keyboard.
  const play = page.locator('button', { hasText: /play/i }).first();
  if (await play.count()) await play.click();
  else await page.keyboard.press('Space');
  await page.waitForTimeout(1400);
  await shot(page, '02-game-start');

  // Play a handful of layers with real taps.
  for (let i = 0; i < 6; i++) {
    await tapCentre(page);
    await page.waitForTimeout(700);
  }
  await shot(page, '03-game-stacked');

  // Drop repeatedly until the run ends.
  for (let i = 0; i < 40; i++) {
    await tapCentre(page);
    await page.waitForTimeout(240);
  }
  await page.waitForTimeout(2600);
  await shot(page, '04-result');

  const perf = await page.evaluate(() => {
    const w = window;
    return w.__snackeryStats ?? null;
  });
  if (perf) console.log('  stats', JSON.stringify(perf));

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
