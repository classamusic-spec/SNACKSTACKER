/** TEMPORARY — Recipe Rush dev shots. Delete with the recipe-* dev files. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = '.recipe-shots';
mkdirSync(OUT, { recursive: true });
const THEME = process.env.TH ?? 'diner';
const TIER = process.env.T ?? 'high';
const W = Number(process.env.W ?? 393), H = Number(process.env.H ?? 852);
const SETTLE = Number(process.env.SETTLE ?? 7000);
const URL = `http://localhost:4175/recipe-dev.html?theme=${THEME}&tier=${TIER}`;

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage({ viewport:{width:W,height:H}, deviceScaleFactor:1 });
const errs = [];
p.on('pageerror', e=>errs.push('PAGEERR '+e.message));
p.on('console', m=>{ if(m.type()==='error' && !m.text().includes('404')) errs.push('CONSOLE '+m.text()); });
await p.goto(URL, {waitUntil:'load'});
await p.waitForFunction(()=>window.__recipe && window.__recipe.stats.drawCalls>0, null, {timeout:180000});
await p.waitForTimeout(SETTLE);
const tag = `${THEME}-${TIER}-${W}x${H}`;
const shot = (n) => p.screenshot({path:`${OUT}/${tag}-${n}.png`, timeout:240000});
const stats = async (n) => console.log(n.padEnd(14), JSON.stringify(await p.evaluate(()=>window.__recipe.stats)));
const ev = (fn, ...a) => p.evaluate(fn, ...a);

await shot('1-attract'); await stats('attract');

await ev(()=>window.__recipe.start());
await ev(()=>window.__recipe.step(40));         // into the demo
await p.waitForTimeout(SETTLE);
await shot('2-demo'); await stats('demo');

// Deep state: play five recipes perfectly, land in the pick phase of #6.
console.log('autoplay5', await ev(()=>window.__recipe.autoplay(5)));
await ev(()=>window.__recipe.step(30));
await p.waitForTimeout(SETTLE);
await shot('3-pick-deep'); await stats('pick-deep');
console.log('peek', JSON.stringify(await ev(()=>window.__recipe.peek())));
console.log('slots', JSON.stringify(await ev(()=>{
  const o=[]; for(let i=0;i<8;i++) o.push(window.__recipe.slotScreen(i)); return o; })));

// Half-built dish plus a wrong pick and its nudge.
await ev(()=>{ const r=window.__recipe; const pk=r.peek();
  for(let i=0;i<Math.floor(pk.len/2);i++){ r.tapSlot(r.answer()); r.step(14); } });
await ev(()=>window.__recipe.missTimes(2));
await ev(()=>window.__recipe.step(20));
await p.waitForTimeout(SETTLE);
await shot('4-midpick-nudge'); await stats('midpick');
console.log('peek', JSON.stringify(await ev(()=>window.__recipe.peek())));

// Mode-only cost: hide everything the mode adds and read the theme baseline.
await ev(()=>window.__recipe.hideMode(true));
await p.waitForTimeout(SETTLE);
await stats('THEME-ONLY');
await shot('5-theme-only');
await ev(()=>window.__recipe.hideMode(false));
await p.waitForTimeout(SETTLE);
await stats('MODE-ON');

await b.close();
if (errs.length) { console.error('\nERRORS:'); errs.slice(0,12).forEach(e=>console.error('  '+e)); process.exitCode=1; }
else console.log('\nno runtime errors');
