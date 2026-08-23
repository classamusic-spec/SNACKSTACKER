/** TEMPORARY — Recipe Rush key-moment frames. Delete with the recipe-* dev files. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('.recipe-shots', { recursive: true });
const TH = process.env.TH ?? 'diner', TIER = process.env.T ?? 'high';
const SETTLE = Number(process.env.SETTLE ?? 5000);
const WANT = (process.env.M ?? 'a,b,c,d,e').split(',');
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage({ viewport:{width:393,height:852}, deviceScaleFactor:1 });
const errs=[]; p.on('pageerror', e=>errs.push(e.message));
p.on('console', m=>{ if(m.type()==='error' && !m.text().includes('404')) errs.push(m.text()); });
await p.goto(`http://localhost:4175/recipe-dev.html?theme=${TH}&tier=${TIER}`, {waitUntil:'load'});
await p.waitForFunction(()=>window.__recipe && window.__recipe.stats.drawCalls>0, null, {timeout:180000});
await p.evaluate(()=>{ const r=window.__recipe;
  window.__go = (phase, max) => { for (let g=0; g<(max??3000); g++) { if (r.peek().phase===phase) return true; r.step(1); } return false; };
  // The pick phase opens with a short input lockout, so a tap can legitimately
  // be refused; retry until it lands rather than silently dropping a pick.
  window.__pick = (n) => { for (let i=0;i<n;i++){ let g=0; while(!r.tapSlot(r.answer()) && g++<40) r.step(1); r.step(13); } };
});
const shot = async (n) => { await p.waitForTimeout(SETTLE); await p.screenshot({path:`.recipe-shots/moment-${TH}-${n}.png`, timeout:200000});
  console.log(n.padEnd(16), JSON.stringify(await p.evaluate(()=>window.__recipe.peek())), JSON.stringify(await p.evaluate(()=>window.__recipe.stats))); };

await p.evaluate(()=>{ const r=window.__recipe; r.start(); r.autoplay(3); });

if (WANT.includes('a')) { // demo, ingredient mid-flight
  await p.evaluate(()=>{ const r=window.__recipe; const pk=r.peek();
    window.__pick(pk.len);
    window.__go('demo', 600); r.step(5); });
  await shot('a-demo-flight');
}
if (WANT.includes('b')) { // cloche mid-fall — frozen, or the settle wait runs past it
  await p.evaluate(()=>{ const r=window.__recipe;
    window.__go('pick', 1200);
    window.__pick(r.peek().len);
    for (let g=0; g<900 && r.peek().phase!=='cover'; g++) r.step(1);
    r.step(7); r.freeze(true); });
  await shot('b-cloche-fall');
}
if (WANT.includes('c')) {
  await p.evaluate(()=>{ window.__recipe.step(12); });
  await shot('c-cloche-lift');
  await p.evaluate(()=>window.__recipe.freeze(false));
}
if (WANT.includes('d')) { // served celebration
  await p.evaluate(()=>{ const r=window.__recipe; window.__go('pick', 900);
    const pk=r.peek(); window.__pick(pk.len); r.step(5); });
  await shot('d-served');
}
if (WANT.includes('e')) { // game over
  await p.evaluate(()=>{ const r=window.__recipe; window.__go('pick', 900); r.missTimes(3); r.step(24); });
  await shot('e-over');
  console.log('over event:', JSON.stringify(await p.evaluate(()=>window.__recipe.state.over)));
}
await b.close();
if (errs.length) { console.error('ERRORS:'); errs.slice(0,8).forEach(e=>console.error('  '+e)); process.exitCode=1; }
else console.log('no runtime errors');
