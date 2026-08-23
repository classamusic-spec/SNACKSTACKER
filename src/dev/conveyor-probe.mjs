/** TEMPORARY: dumps theme props near the belt corridor. Delete with src/dev/conveyor-*. */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));
const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
for (const id of (process.argv[2] ?? 'candy').split(',')) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.goto(`http://localhost:4174/src/dev/conveyor-harness.html?theme=${id}&tier=high&phase=attract`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(12000);
  const rows = await page.evaluate(() => window.__conveyorProbe?.() ?? null);
  console.log('===', id, (rows ?? []).length);
  for (const r of rows ?? []) console.log(JSON.stringify(r));
  await page.close();
}
await browser.close();
