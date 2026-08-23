/**
 * Does every mode actually PLAY?
 *
 * Boot the real host, then for each mode: select it on the deck, start a run,
 * drive taps at the play area, and assert the score moved. Typechecking and a
 * clean boot prove nothing about whether input reaches a mode.
 *
 * Two things this harness learned the hard way, both worth keeping:
 *
 * SwiftShader runs this project at 1-5 fps, and the ticker clamps dt. Game
 * time therefore advances far slower than wall time, so any mode with an
 * input cooldown measured in game seconds will swallow taps paced by
 * setTimeout. Hence the small viewport (fewer pixels, more frames) and the
 * unhurried gap between taps. Recipe Rush looked completely broken until
 * both were fixed; it was fine.
 *
 * Blind taps at one screen position also prove nothing when a mode's targets
 * are 3D objects projected somewhere else. The taps sweep a band instead.
 *
 * And "the score went up" is the wrong assertion for every mode. A random
 * tapper legitimately scores zero in Recipe Rush, because it is a memory game
 * that only pays for correct picks in the correct order. What a random tapper
 * CAN prove is that input reaches the mode at all, so the bar is: the score
 * moved, OR the run ended. Recipe has no timer, so it can only reach the
 * result screen by losing lives to wrong picks — which means taps landed.
 *
 *   node tools/playtest.mjs                  # against a running dev server
 *   URL=http://localhost:4173/ node tools/playtest.mjs
 */
import { chromium } from 'playwright';

const EXE = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const URL = process.env.URL ?? 'http://127.0.0.1:5173/';
const SHOTS = process.env.SHOTS ?? null;
const MODES = ['stack', 'conveyor', 'recipe', 'topple'];

// Small enough that software rendering keeps up, still a plausible phone.
const W = 300;
const H = 620;
const TAP_GAP = 700;
const MAX_TAPS = 34;

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: W, height: H },
  hasTouch: true,
  isMobile: true,
});

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

const stats = () => page.evaluate(() => window.__snackeryStats ?? null);
const score = () =>
  page.evaluate(() => {
    const el = document.querySelector('.sn-score');
    return el ? el.textContent.replace(/[^0-9]/g, '') : '';
  });
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => window.__snackeryStats && window.__snackeryStats.state !== 'boot',
  null,
  { timeout: 180_000 },
);
const boot = await stats();
console.log(`booted  tier=${boot.tier}  fps=${boot.fps}  draws=${boot.drawCalls}`);

const results = [];

for (const mode of MODES) {
  const before = errors.length;
  const row = { mode, started: false, taps: 0, from: '', to: '', end: '', note: '' };

  if ((await stats()).state !== 'home') {
    row.note = `not at home (${(await stats()).state})`;
    results.push(row);
    continue;
  }

  // The deck is a horizontal snap rail, so most cards sit outside the
  // viewport — dispatch on the element, not at coordinates. Clicking an
  // already-selected card activates it, so only press PLAY if still at home.
  const pick = await page.evaluate((id) => {
    const el = document.querySelector(`[data-mode="${id}"]`);
    if (!el) return 'missing';
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return 'locked';
    el.click();
    return 'ok';
  }, mode);
  if (pick !== 'ok') {
    row.note = `card ${pick}`;
    results.push(row);
    continue;
  }
  await wait(1200);

  if ((await stats()).state === 'home') {
    const ok = await page.evaluate(() => {
      const el = document.querySelector('.sn-btn--play');
      if (!el) return false;
      el.click();
      return true;
    });
    if (!ok) {
      row.note = 'no play button';
      results.push(row);
      continue;
    }
  }

  try {
    await page.waitForFunction(() => window.__snackeryStats.state === 'playing', null, {
      timeout: 60_000,
    });
    row.started = true;
  } catch {
    row.note = `never reached playing (${(await stats()).state})`;
    results.push(row);
    continue;
  }

  row.from = await score();

  // Sweep a band rather than hammering one point: each mode puts its targets
  // somewhere different, and several are 3D objects projected to screen.
  for (let i = 0; i < MAX_TAPS; i += 1) {
    if ((await stats()).state !== 'playing') break;
    const gx = 0.14 + ((i * 0.17) % 0.72);
    const gy = 0.36 + ((i * 0.13) % 0.5);
    await page.mouse.click(Math.round(W * gx), Math.round(H * gy));
    row.taps += 1;
    await wait(TAP_GAP);
  }

  const end = await stats();
  row.to = await score();
  row.end = end.state;
  row.fps = end.fps;
  row.scored = row.to !== row.from && row.to !== '';
  // A run that ended did so through gameplay; no mode ends on a timer.
  row.ended = end.state === 'result' || end.state === 'over';
  row.responded = row.scored || row.ended;
  row.errs = errors.length - before;

  if (SHOTS) await page.screenshot({ path: `${SHOTS}/play-${mode}.png` });

  // Back to home, whichever screen we landed on.
  await page.evaluate(() => {
    const hit = (re) => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        re.test(`${x.textContent ?? ''} ${x.getAttribute('aria-label') ?? ''}`),
      );
      if (b) b.click();
      return Boolean(b);
    };
    if (window.__snackeryStats.state === 'playing') hit(/pause/i);
    hit(/^\s*home\s*$|quit|main menu/i);
  });
  await wait(1400);
  await page
    .waitForFunction(() => window.__snackeryStats.state === 'home', null, { timeout: 40_000 })
    .catch(() => {
      row.note += ' | did not return home';
    });

  results.push(row);
}

let failed = 0;
console.log('\n===== PLAYTEST =====');
for (const r of results) {
  const ok = r.started && r.responded && !r.note;
  if (!ok) failed += 1;
  const how = r.scored ? 'scored' : r.ended ? 'ran to end' : 'no response';
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${r.mode.padEnd(9)} started=${r.started} taps=${String(r.taps).padStart(2)} ` +
      `score=${r.from || '-'}->${r.to || '-'} end=${r.end || '-'} fps=${r.fps ?? '-'} ` +
      `errs=${r.errs ?? 0} ${how.padEnd(11)} ${r.note}`,
  );
}
console.log(`\npage errors: ${errors.length}`);
for (const e of errors.slice(0, 12)) console.log('  ', e);

await browser.close();
if (failed > 0 || errors.length > 0) {
  globalThis.process.exitCode = 1;
}
