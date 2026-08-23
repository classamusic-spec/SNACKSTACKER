/** TEMPORARY — Recipe Rush key-moment frames. Delete with the recipe-* dev files. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('.recipe-shots', { recursive: true });
const TH = process.env.TH ?? 'diner', TIER = process.env.T ?? 'high';
const SETTLE = Number(process.env.SETTLE ?? 8000);
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage({ viewport:{width:393,height:852}, deviceScaleFactor:1 });
const errs=[]; p.on('pageerror', e=>errs.push(e.message));
p.on('console', m=>{ if(m.type()==='error' && !m.text().includes('404')) errs.push(m.text()); });
await p.goto(`http://localhost:4175/recipe-dev.html?theme=${TH}&tier=${TIER}`, {waitUntil:'load'});
await p.waitForFunction(()=>window.__recipe && window.__recipe.stats.drawCalls>0, null, {timeout:180000});
const shot = async (n) => { await p.waitForTimeout(SETTLE); await p.screenshot({path:`.recipe-shots/moment-${TH}-${n}.png`, timeout:240000});
  console.log(n.padEnd(18), JSON.stringify(await p.evaluate(()=>window.__recipe.peek())), JSON.stringify(await p.evaluate(()=>window.__recipe.stats))); };

// a. demo, with an ingredient mid-flight
await p.evaluate(()=>{ const r=window.__recipe; r.start(); r.autoplay(2); r.step(4);
  // sit at the start of the next demo and fire one item
  while (r.peek().phase !== 'demo') r.step(1);
  r.step(4); });
await shot('a-demo-flight');

// b. cloche mid-fall
await p.evaluate(()=>{ const r=window.__recipe; let g=0;
  while (r.peek().phase !== 'cover' && g++<4000) { if (r.peek().phase==='demo') r.tapCentre(); r.step(1); }
  r.step(7); });
await shot('b-cloche-fall');

// c. cloche landed / lifting
await p.evaluate(()=>window.__recipe.step(14));
await shot('c-cloche-lift');

// d. served celebration
await p.evaluate(()=>{ const r=window.__recipe; let g=0;
  while (r.peek().phase !== 'pick' && g++<4000) r.step(1);
  const pk=r.peek(); for(let i=0;i<pk.len;i++){ r.tapSlot(r.answer()); r.step(14); } r.step(6); });
await shot('d-served');

// e. game over
await p.evaluate(()=>{ const r=window.__recipe; let g=0;
  while (r.peek().phase !== 'pick' && g++<4000) r.step(1);
  r.missTimes(3); r.step(20); });
await shot('e-over');
console.log('over event:', JSON.stringify(await p.evaluate(()=>window.__recipe.state.over)));

await b.close();
if (errs.length) { console.error('ERRORS:'); errs.slice(0,8).forEach(e=>console.error('  '+e)); process.exitCode=1; }
else console.log('no runtime errors');
