/** TEMPORARY — Recipe Rush scene-graph census. Delete with the recipe-* dev files. */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
for (const th of (process.env.THEMES ?? 'diner,sushi,candy,taco,breakfast,pizza').split(',')) {
  for (const tier of (process.env.TIERS ?? 'high').split(',')) {
    const p = await b.newPage({ viewport:{width:393,height:852}, deviceScaleFactor:1 });
    const errs=[]; p.on('pageerror', e=>errs.push(e.message));
    await p.goto(`http://localhost:4175/recipe-dev.html?theme=${th}&tier=${tier}`, {waitUntil:'load'});
    await p.waitForFunction(()=>window.__recipe && window.__recipe.stats.drawCalls>0, null, {timeout:180000});
    const r = await p.evaluate(()=>{ const r=window.__recipe; r.start(); r.autoplay(6);
      const pk=r.peek(); for(let i=0;i<pk.len-1;i++){ r.tapSlot(r.answer()); r.step(16); } r.step(300);
      return { census:r.census(), peek:r.peek() }; });
    const g = r.census.groups;
    console.log(`${th.padEnd(10)} ${tier.padEnd(6)} total ${String(r.census.meshes).padStart(3)} meshes ${String(r.census.tris).padStart(6)} tris, ${r.census.cast} casters  ` +
      Object.entries(g).map(([k,v])=>`${k.replace('recipe.','')}:${v.meshes}/${v.tris}`).join(' ') + (errs.length?'  ERR '+errs[0]:''));
    await p.close();
  }
}
await b.close();
