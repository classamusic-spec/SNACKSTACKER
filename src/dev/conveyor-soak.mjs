/** TEMPORARY: start/stop + theme-swap leak soak. Delete with src/dev/conveyor-*. */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));
const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
const lines = [];
page.on('console', (m) => { const t = m.text(); if (t.startsWith('[soak]')) lines.push(t); });
page.on('pageerror', (e) => lines.push('ERR ' + e.message));
page.on('framenavigated', (f) => { if (!f.parentFrame()) lines.push('NAVIGATED'); });
await page.goto('http://localhost:4174/src/dev/conveyor-harness.html?theme=diner&tier=high&speed=6&auto=1&soak=1', { waitUntil: 'networkidle' });
await page.waitForTimeout(Number(process.env.CV_SOAK ?? 110000));
for (const l of lines) console.log(l);
await browser.close();
