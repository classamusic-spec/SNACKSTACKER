/** TEMPORARY: a strip of frames from one conveyor run. Delete with src/dev/conveyor-*. */
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
const OUT = 'shots/conveyor';
mkdirSync(OUT, { recursive: true });
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));
const id = process.argv[2] ?? 'diner';
const TIER = process.env.CV_TIER ?? 'high';
const SPEED = process.env.CV_SPEED ?? '8';
const N = Number(process.env.CV_N ?? 5);
const GAP = Number(process.env.CV_GAP ?? 9000);
const WARM = Number(process.env.CV_WARM ?? 16000);
const EXTRA = process.env.CV_EXTRA ?? '&auto=1';
const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('crash', () => errors.push('PAGE CRASH'));
page.on('framenavigated', (f) => { if (!f.parentFrame()) errors.push('NAVIGATED ' + f.url()); });
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
await page.goto(`http://localhost:4174/src/dev/conveyor-harness.html?theme=${id}&tier=${TIER}&speed=${SPEED}${EXTRA}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(WARM);
for (let i = 0; i < N; i++) {
  await page.screenshot({ path: `${OUT}/seq-${id}-${i}.png`, timeout: 180000 });
  console.log(i, JSON.stringify(await page.evaluate(() => ({
    s: window.__conveyor?.state?.() ?? null,
    heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1,
    geo: window.__conveyorMem?.() ?? null,
  }))));
  await page.waitForTimeout(GAP);
}
await page.evaluate(() => window.__conveyorSplit?.());
await page.waitForTimeout(7000);
console.log('stats', JSON.stringify(await page.evaluate(() => window.__conveyor?.stats ?? null)));
await browser.close();
if (errors.length) { console.error(errors.slice(0, 10).join('\n')); process.exitCode = 1; }
