/**
 * Recipe Rush escalation curve.
 *
 * The recall countdown is the whole point of the mode's difficulty ramp, so the
 * shape of the curve is asserted here rather than felt: it must get harder, it
 * must never hand a recipe an impossible or absurd budget, and the pace the
 * player has to keep must actually rise as the run deepens — which is the thing
 * "start slow, then speed up" literally means.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { recipeLength, recipeTimeLimit } = await import('../.test-build/recipe-rules.mjs');

test('every recipe gets a positive, sane time budget', () => {
  for (let n = 1; n <= 40; n += 1) {
    const limit = recipeTimeLimit(n, recipeLength(n));
    assert.ok(limit > 0, `recipe ${n} got ${limit}s`);
    assert.ok(limit < 20, `recipe ${n} budget ${limit}s is absurd`);
  }
});

test('the per-item budget only tightens, never loosens', () => {
  let prev = Infinity;
  for (let n = 1; n <= 20; n += 1) {
    // Hold length fixed so this measures the clock curve alone, not the length ramp.
    const perItem = recipeTimeLimit(n, 5) / 5;
    assert.ok(perItem <= prev + 1e-9, `per-item rose at recipe ${n}: ${perItem} > ${prev}`);
    prev = perItem;
  }
});

test('the required pace rises across the real run (more items, less time each)', () => {
  // Pace = ingredients per second the player must sustain to survive the budget.
  const paceAt = (n) => recipeLength(n) / recipeTimeLimit(n, recipeLength(n));
  assert.ok(
    paceAt(8) > paceAt(1) * 1.5,
    `late pace ${paceAt(8).toFixed(3)} should clearly exceed early ${paceAt(1).toFixed(3)}`,
  );
});

test('the curve plateaus once fully ramped rather than shrinking to zero', () => {
  const a = recipeTimeLimit(8, 5);
  const b = recipeTimeLimit(30, 5);
  assert.equal(a, b, 'past the ramp the per-item budget should hold, not keep falling');
});
