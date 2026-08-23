/** TEMPORARY: per-theme draw-call/triangle budget for the conveyor mode. */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));
const TIER = process.env.CV_TIER ?? 'high';
const CAP = TIER === 'low' ? 4 : 5;
const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
for (const id of (process.argv[2] ?? 'diner,sushi,candy,taco,breakfast,pizza').split(',')) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.goto(`http://localhost:4174/src/dev/conveyor-harness.html?theme=${id}&tier=${TIER}&phase=attract`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(11000);
  const r = await page.evaluate(() => window.__conveyorFoods?.() ?? null);
  if (!r) { console.log(id, 'no data'); await page.close(); continue; }
  const worstDraw = r.structural.meshes + CAP * r.maxItem.meshes;
  const worstTri = r.structural.tris + CAP * r.maxTri.tris;
  const avgMesh = r.per.reduce((a, b) => a + b.meshes, 0) / r.per.length;
  const avgTri = r.per.reduce((a, b) => a + b.tris, 0) / r.per.length;
  console.log(
    `${id.padEnd(10)} ${TIER.padEnd(6)} struct ${r.structural.meshes}d/${r.structural.tris}t  ` +
    `food avg ${avgMesh.toFixed(1)}d/${Math.round(avgTri)}t  max ${r.maxItem.meshes}d/${r.maxTri.tris}t  ` +
    `=> worst ${worstDraw} draws / ${worstTri} tris  (per-food ${r.per.map((p) => p.meshes + '/' + p.tris).join(' ')})`,
  );
  await page.close();
}
await browser.close();
