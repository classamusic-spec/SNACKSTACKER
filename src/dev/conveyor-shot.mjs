/** TEMPORARY: screenshots of the conveyor harness. Delete with src/dev/conveyor-*. */
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';

const OUT = 'shots/conveyor';
mkdirSync(OUT, { recursive: true });
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));
const WAIT = Number(process.env.CV_WAIT ?? 14000);
const TIER = process.env.CV_TIER ?? 'high';
const THEMES = (process.argv[2] ?? 'diner').split(',');
const EXTRA = process.env.CV_EXTRA ?? '';
const TAG = process.env.CV_TAG ?? '';

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const errors = [];
for (const id of THEMES) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`${id}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${id}: ${m.text()}`); });
  const url = `http://localhost:4174/src/dev/conveyor-harness.html?theme=${id}&tier=${TIER}${EXTRA}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(WAIT);
  await page.screenshot({ path: `${OUT}/${id}-${TIER}${TAG}.png`, timeout: 180000 });
  await page.evaluate(() => window.__conveyorSplit?.());
  await page.waitForTimeout(6000);
  const s = await page.evaluate(() => window.__conveyor?.stats ?? null);
  console.log(`${id.padEnd(10)} ${JSON.stringify(s)}`);
  await page.close();
}
await browser.close();
if (errors.length) {
  console.error(`\n${errors.length} runtime error(s):`);
  for (const e of errors.slice(0, 15)) console.error('  ' + e);
  process.exitCode = 1;
} else console.log('\nno runtime errors');
