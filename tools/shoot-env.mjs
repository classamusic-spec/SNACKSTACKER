/**
 * Per-theme environment shots. Loads the home screen in a given theme and
 * tier, captures it, and reports the live renderer stats.
 *
 *   node tools/shoot-env.mjs diner,sushi           # low tier (default)
 *   SN_TIER=high SN_WAIT=15000 node tools/shoot-env.mjs candy
 *
 * High tier under SwiftShader renders at a couple of frames per second, so it
 * needs the longer SN_WAIT and the generous screenshot timeout below.
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';

const OUT = 'shots/env';
const TIER = process.env.SN_TIER ?? 'low';
// Software rendering spends 3-5s compiling shaders on the first frame, so the
// boot veil is still dissolving at 3s. Real hardware does this in a fraction
// of the time; see the boot marks in __snackeryStats for the split.
const WAIT = Number(process.env.SN_WAIT ?? 6500);
const THEMES = (process.argv[2] ?? 'diner,sushi,candy,taco,breakfast,pizza').split(',');
const CHROME = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
].find((p) => existsSync(p));

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
});

const errors = [];
for (const id of THEMES) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`${id}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${id}: ${m.text()}`);
  });
  await page.addInitScript(
    ({ id, tier }) => {
      try {
        localStorage.setItem(
          'snackery.save.v1',
          JSON.stringify({
            version: 1,
            settings: { quality: tier },
            owned: ['diner', 'sushi', 'candy', 'taco', 'breakfast', 'pizza', 'bundle_all'],
            selectedTheme: id,
          }),
        );
      } catch {
        /* private mode — the game falls back to defaults */
      }
    },
    { id, tier: TIER },
  );
  await page.goto(process.env.SNACKERY_URL ?? 'http://localhost:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(WAIT);
  await page.screenshot({ path: `${OUT}/${id}-home-${TIER}.png`, timeout: 180000 });
  console.log(`${id.padEnd(10)} ${JSON.stringify(await page.evaluate(() => window.__snackeryStats ?? null))}`);
  await page.close();
}
await browser.close();

if (errors.length) {
  console.error(`\n${errors.length} runtime error(s):`);
  for (const e of errors.slice(0, 15)) console.error('  ' + e);
  process.exitCode = 1;
} else {
  console.log('\nno runtime errors');
}
