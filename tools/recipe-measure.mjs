/** TEMPORARY — Recipe Rush cost measurement. Delete with the recipe-* dev files. */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const THEMES = (process.env.THEMES ?? 'diner,sushi,candy,taco,breakfast,pizza').split(',');
const TIERS = (process.env.TIERS ?? 'high,low').split(',');
console.log('theme      tier   themeOnly(calls/tris)   modeFull(calls/tris)    DELTA(calls/tris)');
for (const tier of TIERS) for (const th of THEMES) {
  const p = await b.newPage({ viewport:{width:393,height:852}, deviceScaleFactor:1 });
  const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  await p.goto(`http://localhost:4175/recipe-dev.html?theme=${th}&tier=${tier}`, {waitUntil:'load'});
  await p.waitForFunction(()=>window.__recipe && window.__recipe.stats.drawCalls>0, null, {timeout:180000});
  await p.evaluate(()=>{ const r=window.__recipe; r.start(); r.autoplay(6); });
  // Fill the dish to len-1 so the worst frame of the run is what gets measured,
  // then let every particle die so vfx is not counted twice.
  await p.evaluate(()=>{ const r=window.__recipe; const pk=r.peek();
    for(let i=0;i<pk.len-1;i++){ r.tapSlot(r.answer()); r.step(16); } r.step(400); });
  await p.waitForTimeout(6000);
  const full = await p.evaluate(()=>({...window.__recipe.stats}));
  const peek = await p.evaluate(()=>window.__recipe.peek());
  await p.evaluate(()=>window.__recipe.hideMode(true));
  await p.waitForTimeout(6000);
  const base = await p.evaluate(()=>({...window.__recipe.stats}));
  console.log(
    `${th.padEnd(10)} ${tier.padEnd(6)} ${String(base.drawCalls).padStart(4)} / ${String(base.triangles).padStart(6)}` +
    `        ${String(full.drawCalls).padStart(4)} / ${String(full.triangles).padStart(6)}` +
    `        ${String(full.drawCalls-base.drawCalls).padStart(4)} / ${String(full.triangles-base.triangles).padStart(6)}` +
    `   [r${peek.recipeNo} len${peek.len} step${peek.pickIndex} pal${peek.palette}]` + (errs.length?'  ERR '+errs[0]:''));
  await p.close();
}
await b.close();
