/**
 * The Topple solver's stability invariants.
 *
 * These began life as a dev CLI that nobody would have run twice. The checks
 * themselves are the ones that actually catch a bad stacking solver — sinking,
 * jitter, creep, explosion, non-determinism — so they belong in `npm test`
 * where they run on every change, not in a harness that rots.
 *
 * Sleeping is disabled for the jitter runs, so the solver cannot pass by
 * freezing rather than by settling.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { runStabilityChecks } = await import('../.test-build/topple-stability.mjs');

const results = runStabilityChecks();

test('the stability suite actually ran', () => {
  assert.ok(results.length > 0, 'no checks were produced');
});

for (const result of results) {
  test(`topple solver: ${result.name}`, () => {
    assert.ok(result.pass, result.detail);
  });
}
