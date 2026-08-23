/**
 * TEMPORARY — Recipe Rush development driver. Delete together with
 * `src/dev/recipe-harness.ts` and `recipe-dev.html` once the mode picker
 * exists; nothing in `src/modes/recipe/` depends on it.
 *
 *   npx vite --port 4175 --strictPort          # serve first
 *   node tools/recipe-dev.mjs frames  diner:high:393:852,sushi:high:393:852
 *   node tools/recipe-dev.mjs census  diner,sushi,candy,taco,breakfast,pizza  high,low
 *   node tools/recipe-dev.mjs moments diner high a,b,c,d,e
 *
 * frames  — one deep in-play frame per theme/tier/viewport, plus the measured
 *           pick-cell size in CSS pixels.
 * census  — walks the mode's own scene graph and totals visible meshes,
 *           triangles and shadow casters, split by part. This is the honest
 *           cost number: renderer.info also counts the shadow pass.
 * moments — the transient beats (demo flight, cloche down, cloche lifting,
 *           served, game over). Freezes the simulation before each capture,
 *           because software rendering takes seconds per frame and the beat
 *           would otherwise be over before the shutter opens.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = '.recipe-shots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.RECIPE_URL ?? 'http://localhost:4175/recipe-dev.html';
const SETTLE = Number(process.env.SETTLE ?? 5000);
const [, , cmd = 'frames', a1, a2, a3] = process.argv;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const errors = [];

async function open(theme, tier, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`${theme}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(`${theme}: ${m.text()}`);
  });
  await page.goto(`${BASE}?theme=${theme}&tier=${tier}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__recipe && window.__recipe.stats.drawCalls > 0, null, { timeout: 180000 });
  await page.evaluate(() => {
    const r = window.__recipe;
    window.__go = (phase, max) => {
      for (let g = 0; g < (max ?? 3000); g++) { if (r.peek().phase === phase) return true; r.step(1); }
      return false;
    };
    // The pick phase opens with an input lockout, so a tap can be legitimately
    // refused; retry until it lands rather than silently dropping a pick.
    window.__pick = (n) => {
      for (let i = 0; i < n; i++) { let g = 0; while (!r.tapSlot(r.answer()) && g++ < 40) r.step(1); r.step(13); }
    };
  });
  return page;
}

if (cmd === 'frames') {
  for (const job of (a1 ?? 'diner:high:393:852').split(',')) {
    const [th, tier, w, h] = job.split(':');
    const page = await open(th, tier, +w, +h);
    const info = await page.evaluate(() => {
      const r = window.__recipe;
      r.start(); r.autoplay(4);
      window.__pick(Math.min(3, r.peek().len - 1));
      r.step(240);
      const s = []; for (let i = 0; i < 8; i++) s.push(r.slotScreen(i));
      return { peek: r.peek(), slots: s };
    });
    await page.waitForTimeout(SETTLE);
    await page.screenshot({ path: `${OUT}/frame-${th}-${tier}-${w}x${h}.png`, timeout: 240000 });
    const c = info.slots.filter(Boolean);
    const dx = c.length > 4 ? Math.abs(c[1].x - c[0].x) : 0;
    const dy = c.length > 4 ? Math.abs(c[4].y - c[0].y) : 0;
    console.log(`${job.padEnd(24)} r${info.peek.recipeNo} len${info.peek.len} step${info.peek.pickIndex}  cell ${dx.toFixed(0)}x${dy.toFixed(0)}px  ` +
      JSON.stringify(await page.evaluate(() => window.__recipe.stats)));
    await page.close();
  }
} else if (cmd === 'census') {
  for (const th of (a1 ?? 'diner,sushi,candy,taco,breakfast,pizza').split(',')) {
    for (const tier of (a2 ?? 'high,low').split(',')) {
      const page = await open(th, tier, 393, 852);
      const r = await page.evaluate(() => {
        const r = window.__recipe;
        r.start(); r.autoplay(6);
        window.__pick(r.peek().len - 1);
        r.step(300);
        return { census: r.census(), peek: r.peek() };
      });
      const g = r.census.groups;
      const own = Object.entries(g).filter(([k]) => k !== 'recipe.root');
      const meshes = own.reduce((s, [, v]) => s + v.meshes, 0);
      const tris = own.reduce((s, [, v]) => s + v.tris, 0);
      const cast = own.reduce((s, [, v]) => s + v.cast, 0);
      console.log(`${th.padEnd(10)} ${tier.padEnd(5)} MODE ${String(meshes).padStart(3)} meshes ${String(tris).padStart(6)} tris ${String(cast).padStart(3)} casters ` +
        `(draws ${meshes + (tier === 'low' ? 0 : cast)})  [r${r.peek.recipeNo} len${r.peek.len} step${r.peek.pickIndex}]  ` +
        own.map(([k, v]) => `${k.replace('recipe.', '')}:${v.meshes}/${v.tris}`).join(' '));
      await page.close();
    }
  }
} else if (cmd === 'moments') {
  const th = a1 ?? 'diner', tier = a2 ?? 'high';
  const want = (a3 ?? 'a,b,c,d,e').split(',');
  const page = await open(th, tier, 393, 852);
  const shot = async (n) => {
    await page.waitForTimeout(SETTLE);
    await page.screenshot({ path: `${OUT}/moment-${th}-${n}.png`, timeout: 200000 });
    console.log(n.padEnd(16), JSON.stringify(await page.evaluate(() => window.__recipe.peek())));
  };
  await page.evaluate(() => { const r = window.__recipe; r.start(); r.autoplay(3); });
  if (want.includes('a')) {
    await page.evaluate(() => { const r = window.__recipe; window.__pick(r.peek().len); window.__go('demo', 600); r.step(5); r.freeze(true); });
    await shot('a-demo-flight');
    await page.evaluate(() => window.__recipe.freeze(false));
  }
  if (want.includes('b')) {
    await page.evaluate(() => { const r = window.__recipe; window.__go('pick', 1200); window.__pick(r.peek().len);
      for (let g = 0; g < 900 && r.peek().phase !== 'cover'; g++) r.step(1); r.step(7); r.freeze(true); });
    await shot('b-cloche-fall');
  }
  if (want.includes('c')) { await page.evaluate(() => window.__recipe.step(12)); await shot('c-cloche-lift'); await page.evaluate(() => window.__recipe.freeze(false)); }
  if (want.includes('d')) {
    await page.evaluate(() => { const r = window.__recipe; window.__go('pick', 900); window.__pick(r.peek().len); r.step(5); r.freeze(true); });
    await shot('d-served');
    await page.evaluate(() => window.__recipe.freeze(false));
  }
  if (want.includes('e')) {
    await page.evaluate(() => { const r = window.__recipe; window.__go('pick', 900); r.missTimes(3); r.step(90); });
    await shot('e-over');
    console.log('over event:', JSON.stringify(await page.evaluate(() => window.__recipe.state.over)));
  }
  await page.close();
} else {
  console.error(`unknown command "${cmd}" — use frames | census | moments`);
  process.exitCode = 2;
}

await browser.close();
if (errors.length) {
  console.error(`\n${errors.length} runtime error(s):`);
  for (const e of errors.slice(0, 12)) console.error('  ' + e);
  process.exitCode = 1;
} else console.log('\nno runtime errors');
