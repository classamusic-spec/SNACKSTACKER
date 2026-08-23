/** TEMPORARY — Recipe Rush per-theme / per-viewport frames. Delete with the recipe-* dev files. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('.recipe-shots', { recursive: true });
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const JOBS = (process.env.JOBS ?? 'diner:high:393:852').split(',');
for (const j of JOBS) {
  const [th, tier, w, h] = j.split(':');
  const p = await b.newPage({ viewport:{width:+w,height:+h}, deviceScaleFactor:1 });
  const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  await p.goto(`http://localhost:4175/recipe-dev.html?theme=${th}&tier=${tier}`, {waitUntil:'load'});
  await p.waitForFunction(()=>window.__recipe && window.__recipe.stats.drawCalls>0, null, {timeout:180000});
  const info = await p.evaluate(()=>{ const r=window.__recipe; r.start(); r.autoplay(4);
    const pk=r.peek(); for(let i=0;i<Math.min(3,pk.len-1);i++){ r.tapSlot(r.answer()); r.step(16); } r.step(240);
    const s=[]; for(let i=0;i<8;i++) s.push(r.slotScreen(i));
    return { peek:r.peek(), slots:s }; });
  await p.waitForTimeout(Number(process.env.SETTLE ?? 8000));
  await p.screenshot({path:`.recipe-shots/frame-${th}-${tier}-${w}x${h}.png`, timeout:240000});
  const cells = info.slots.filter(Boolean);
  const dx = cells.length>4 ? Math.abs(cells[1].x-cells[0].x) : 0;
  const dy = cells.length>4 ? Math.abs(cells[4].y-cells[0].y) : 0;
  console.log(`${j.padEnd(24)} r${info.peek.recipeNo} len${info.peek.len} step${info.peek.pickIndex}  cell ${dx.toFixed(0)}x${dy.toFixed(0)}px  ` +
    JSON.stringify(await p.evaluate(()=>window.__recipe.stats)) + (errs.length?'  ERR '+errs[0]:''));
  await p.close();
}
await b.close();
