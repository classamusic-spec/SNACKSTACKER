import test from 'node:test';
import assert from 'node:assert/strict';
import { sliceLayer, slidePosition } from '../.test-build/slice.js';

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const failures = [];
const t = (name, cond, extra = '') => {
  if (!cond) failures.push(`${name} ${extra}`.trim());
};

test('slice geometry, tolerances and slide motion', () => {
  const OPTS = { tolerance: 0.1, regrow: 0.06, maxSize: 2.4, minSize: 0.16 };

  // --- geometry identities -----------------------------------------------------
  // For any cut, kept + scrap must exactly reconstruct the sliding layer, and the
  // kept piece must lie exactly within the tower below it.
  for (const prevSize of [2.4, 1.7, 0.9, 0.4, 0.2]) {
    for (const prevCenter of [-0.8, 0, 0.55]) {
      for (let d = -prevSize * 1.2; d <= prevSize * 1.2; d += prevSize / 17) {
        const r = sliceLayer(prevCenter, prevSize, prevCenter + d, OPTS);
        if (r.kind === 'miss') {
          t('miss only when it should', Math.abs(d) >= prevSize - 1e-4 || prevSize - Math.abs(d) < OPTS.minSize,
            `d=${d.toFixed(3)} prevSize=${prevSize}`);
          continue;
        }
        if (r.kind === 'perfect') {
          t('perfect only inside tolerance', Math.abs(d) <= OPTS.tolerance, `d=${d}`);
          t('perfect is aligned', approx(r.keptCenter, prevCenter));
          t('perfect never exceeds max', r.keptSize <= OPTS.maxSize + 1e-9);
          t('perfect regrows', r.keptSize >= Math.min(prevSize, OPTS.maxSize) - 1e-9);
          continue;
        }
        // cut: kept must be the true intersection
        const movLo = prevCenter + d - prevSize / 2, movHi = prevCenter + d + prevSize / 2;
        const towLo = prevCenter - prevSize / 2, towHi = prevCenter + prevSize / 2;
        const isectLo = Math.max(movLo, towLo), isectHi = Math.min(movHi, towHi);
        t('kept size == intersection', approx(r.keptSize, isectHi - isectLo, 1e-9), `d=${d}`);
        t('kept centre == intersection centre', approx(r.keptCenter, (isectLo + isectHi) / 2, 1e-9), `d=${d}`);
        t('kept inside tower', r.keptCenter - r.keptSize / 2 >= towLo - 1e-9 && r.keptCenter + r.keptSize / 2 <= towHi + 1e-9);
        // scrap must be the remainder of the moving layer
        const scrapLo = r.cutCenter - r.cutSize / 2, scrapHi = r.cutCenter + r.cutSize / 2;
        t('kept+scrap reconstructs mover', approx(Math.min(isectLo, scrapLo), movLo, 1e-9) && approx(Math.max(isectHi, scrapHi), movHi, 1e-9), `d=${d}`);
        t('kept+scrap sizes sum', approx(r.keptSize + r.cutSize, prevSize, 1e-9), `d=${d}`);
        t('scrap does not overlap kept', scrapLo >= isectHi - 1e-9 || scrapHi <= isectLo + 1e-9, `d=${d}`);
        t('cutSign matches side', (d > 0 ? r.cutSign === 1 : r.cutSign === -1));
      }
    }
  }

  // --- specific cases ----------------------------------------------------------
  t('exact miss right', sliceLayer(0, 1, 1.0, OPTS).kind === 'miss');
  t('exact miss left', sliceLayer(0, 1, -1.0, OPTS).kind === 'miss');
  t('dead centre is perfect', sliceLayer(0, 1, 0, OPTS).kind === 'perfect');
  t('just inside tolerance is perfect', sliceLayer(0, 1, 0.0999, OPTS).kind === 'perfect');
  t('just outside tolerance is a cut', sliceLayer(0, 1, 0.1001, OPTS).kind === 'cut');
  {
    const r = sliceLayer(0, 2.4, 0.6, OPTS);
    t('classic cut kept size', r.kind === 'cut' && approx(r.keptSize, 1.8, 1e-9));
    t('classic cut kept centre', r.kind === 'cut' && approx(r.keptCenter, 0.3, 1e-9));
    t('classic cut scrap size', r.kind === 'cut' && approx(r.cutSize, 0.6, 1e-9));
    t('classic cut scrap centre', r.kind === 'cut' && approx(r.cutCenter, 1.5, 1e-9));
  }
  { // thin remainder ends the run rather than leaving an invisible sliver
    const r = sliceLayer(0, 1, 0.95, OPTS);
    t('too-thin remainder is a miss', r.kind === 'miss' && r.reason === 'too_thin');
  }
  { // regrow is capped at the base footprint
    const r = sliceLayer(0, 2.4, 0.01, OPTS);
    t('regrow capped at max', r.kind === 'perfect' && approx(r.keptSize, 2.4));
  }
  { // a run of perfects grows a narrow tower back toward full width
    let size = 0.5;
    for (let i = 0; i < 40; i++) {
      const r = sliceLayer(0, size, 0, OPTS);
      if (r.kind !== 'perfect') { t('perfect run stays perfect', false); break; }
      size = r.keptSize;
    }
    t('perfect run regrows toward max', size > 2.3 && size <= 2.4, `size=${size}`);
  }

  // --- slide motion ------------------------------------------------------------
  {
    t('phase 0 is left end', approx(slidePosition(0, 2), -2, 1e-9));
    t('phase 1 is right end', approx(slidePosition(1, 2), 2, 1e-9));
    t('phase 2 wraps to left', approx(slidePosition(2, 2), -2, 1e-9));
    t('negative phase wraps', approx(slidePosition(-1, 2), 2, 1e-9));
    let min = Infinity, max = -Infinity, prev = slidePosition(0, 2), reversals = 0;
    for (let p = 0; p <= 4; p += 0.001) {
      const v = slidePosition(p, 2);
      if (!Number.isFinite(v)) { t('slide is finite', false); break; }
      min = Math.min(min, v); max = Math.max(max, v);
      if (p > 0.002) {
        const dir = Math.sign(v - prev);
        if (dir !== 0 && dir !== Math.sign(prev - slidePosition(p - 0.002, 2))) reversals++;
      }
      prev = v;
    }
    t('slide stays in bounds', min >= -2.0000001 && max <= 2.0000001, `${min} ${max}`);
    t('slide reverses twice per two cycles', reversals >= 3 && reversals <= 5, `reversals=${reversals}`);
  }



  assert.deepEqual(failures, [], `${failures.length} slice assertion(s) failed`);
});
