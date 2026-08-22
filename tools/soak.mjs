/**
 * Soak test: plays many full runs back to back, switches themes, pauses and
 * resumes, and watches for the things a stacker leaks — GPU geometries and
 * textures that never get disposed, shader programs that accumulate, debris
 * that is never culled, and JS heap that only grows.
 *
 *   node tools/soak.mjs [runs]
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const RUNS = Number(process.argv[2] ?? 6);
const URL = process.env.SNACKERY_URL ?? 'http://localhost:4199/';
const CHROME = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
].find((p) => existsSync(p));

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--js-flags=--expose-gc',
  ],
});
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

await page.addInitScript(() => {
  try {
    localStorage.setItem(
      'snackery.save.v1',
      JSON.stringify({
        version: 1,
        settings: { quality: 'low' },
        owned: ['diner', 'sushi', 'candy', 'taco', 'breakfast', 'pizza', 'bundle_all'],
        selectedTheme: 'diner',
      }),
    );
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__snackeryStats?.state === 'home', null, { timeout: 120000 });

const stats = () => page.evaluate(() => ({ ...window.__snackeryStats }));

/** Play until the run ends, tapping when aligned so towers get genuinely tall. */
const playRun = (maxMs = 45000) =>
  page.evaluate(
    (maxMs) =>
      new Promise((done) => {
        const c = document.getElementById('gl');
        const t0 = performance.now();
        let taps = 0;
        let cd = 0;
        let sloppy = 0;
        const step = () => {
          const s = window.__snackeryStats;
          if (!s) return done({ taps, reason: 'no-stats' });
          if (s.state === 'result') return done({ taps, reason: 'gameover', layers: s.layers });
          if (performance.now() - t0 > maxMs) return done({ taps, reason: 'timeout', layers: s.layers });
          if (s.state === 'playing') {
            if (cd > 0) cd--;
            else if (s.offset !== null) {
              // Mostly accurate, deliberately sloppy every 5th drop so the
              // tower narrows and runs actually end.
              const want = ++sloppy % 5 === 0 ? 0.75 : 0.14;
              if (Math.abs(s.offset) <= want) {
                c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
                taps++;
                cd = 4;
              }
            }
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    maxMs,
  );

const clickText = async (re) => {
  const b = page.locator('button', { hasText: re }).first();
  if (await b.count()) {
    await b.click();
    return true;
  }
  return false;
};

const THEMES = ['diner', 'sushi', 'candy', 'taco', 'breakfast', 'pizza'];
const samples = [];
console.log('run  theme      layers  taps  geo  tex  prog  offcuts  heapMB  draws');

for (let i = 0; i < RUNS; i++) {
  const theme = THEMES[i % THEMES.length];
  // Switch theme through the real store flow every run.
  await page.evaluate((t) => {
    const raw = localStorage.getItem('snackery.save.v1');
    const s = raw ? JSON.parse(raw) : {};
    s.selectedTheme = t;
    localStorage.setItem('snackery.save.v1', JSON.stringify(s));
  }, theme);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__snackeryStats?.state === 'home', null, { timeout: 120000 });

  if (!(await clickText(/^play$/i))) await page.keyboard.press('Space');
  await page.waitForTimeout(1200);

  // Exercise pause/resume mid-run.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const r = await playRun();
  await page.waitForTimeout(1500);
  const s = await stats();
  samples.push(s);
  console.log(
    `${String(i + 1).padStart(3)}  ${theme.padEnd(10)} ${String(r.layers ?? s.layers).padStart(6)} ` +
      `${String(r.taps).padStart(5)} ${String(s.geometries).padStart(4)} ${String(s.textures).padStart(4)} ` +
      `${String(s.programs2).padStart(5)} ${String(s.offcuts).padStart(8)} ${String(s.heapMb).padStart(7)} ` +
      `${String(s.drawCalls).padStart(6)}`,
  );

  // Back to home, then round again — this is the restart path players hammer.
  if (!(await clickText(/^home$/i))) await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
}

// Restart-in-place loop: the path that leaks if teardown is incomplete.
console.log('\nrestart-in-place x5 (same page, no reload):');
if (!(await clickText(/^play$/i))) await page.keyboard.press('Space');
await page.waitForTimeout(1000);
for (let i = 0; i < 5; i++) {
  await playRun(25000);
  await page.waitForTimeout(1200);
  if (!(await clickText(/play again/i))) await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  const s = await stats();
  console.log(
    `  ${i + 1}: geo ${s.geometries}  tex ${s.textures}  prog ${s.programs2}  offcuts ${s.offcuts}  heap ${s.heapMb}MB`,
  );
  samples.push(s);
}

await browser.close();

const first = samples[0];
const last = samples[samples.length - 1];
console.log('\n--- drift across the whole soak ---');
for (const k of ['geometries', 'textures', 'programs2', 'offcuts', 'heapMb']) {
  const d = last[k] - first[k];
  console.log(`  ${k.padEnd(12)} ${String(first[k]).padStart(6)} -> ${String(last[k]).padStart(6)}  (${d >= 0 ? '+' : ''}${d})`);
}
if (errors.length) {
  console.error(`\n${errors.length} runtime error(s):`);
  for (const e of [...new Set(errors)].slice(0, 20)) console.error('  ' + e);
  process.exitCode = 1;
} else {
  console.log('\nno runtime errors');
}
