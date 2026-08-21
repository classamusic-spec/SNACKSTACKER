import test from 'node:test';
import assert from 'node:assert/strict';
import {
  roundedBox,
  puck,
  ruffle,
  pour,
  pillow,
  squareness,
  superRadius,
} from '../.test-build/kit.mjs';

const failures = [];
const check = (name, cond, extra = '') => {
  if (!cond) failures.push(`${name} ${extra}`.trim());
};

/**
 * Food is rebuilt at its cut size, so every helper is called at extreme aspect
 * ratios — down to a 0.15-unit sliver. These are the invariants the game relies
 * on: fill the footprint, sit on y = 0, never emit NaN.
 */
test('kit geometry holds at every cut size', () => {
  const SIZES = [
    [2.4, 0.5, 2.4, 0.1],
    [0.15, 0.24, 2.4, 0.05],
    [2.4, 0.12, 0.3, 0.02],
    [0.15, 0.15, 0.15, 0.05],
    [0.04, 0.04, 0.04, 0.02],
    [1, 0.3, 1, 0.9],
  ];
  for (const [w, h, d, r] of SIZES) {
    const g = roundedBox(w, h, d, r, 3);
    g.computeBoundingBox();
    const b = g.boundingBox;
    const label = `roundedBox ${w}x${h}x${d}`;
    check(`${label} width`, Math.abs(b.max.x - b.min.x - w) < w * 0.01, `${b.max.x - b.min.x}`);
    check(`${label} height`, Math.abs(b.max.y - b.min.y - h) < h * 0.01, `${b.max.y - b.min.y}`);
    check(`${label} depth`, Math.abs(b.max.z - b.min.z - d) < d * 0.01, `${b.max.z - b.min.z}`);
    check(`${label} sits on y=0`, Math.abs(b.min.y) < 1e-6, `${b.min.y}`);
    check(
      `${label} centred on x/z`,
      Math.abs(b.max.x + b.min.x) < 1e-6 && Math.abs(b.max.z + b.min.z) < 1e-6,
    );
    check(`${label} finite`, g.attributes.position.array.every(Number.isFinite));
  }

  for (const fn of [puck, ruffle, pour, pillow]) {
    for (const [w, h, d] of [
      [2.4, 0.5, 2.4],
      [0.15, 0.3, 2.4],
      [2.4, 0.2, 0.12],
      [0.05, 0.05, 0.05],
    ]) {
      const g = fn(w, h, d, {});
      g.computeBoundingBox();
      const b = g.boundingBox;
      const label = `${fn.name} ${w}x${d}`;
      check(`${label} positions finite`, g.attributes.position.array.every(Number.isFinite));
      check(
        `${label} normals finite`,
        !g.attributes.normal || g.attributes.normal.array.every(Number.isFinite),
      );
      check(
        `${label} stays near its footprint`,
        b.max.x - b.min.x <= w * 1.6 && b.max.z - b.min.z <= d * 1.6,
        `${(b.max.x - b.min.x).toFixed(3)} x ${(b.max.z - b.min.z).toFixed(3)}`,
      );
    }
  }

  assert.deepEqual(failures, [], `${failures.length} kit assertion(s) failed`);
});

test('cut faces: squareness and the superellipse blend', () => {
  // An untouched layer is round; a cut one reads as a rounded rectangle.
  assert.equal(squareness(2.4, 2.4), 0);
  assert.ok(squareness(0.5, 2.4) > 0.8, 'a one-axis cut should be strongly square');
  assert.ok(squareness(1.0, 1.0) > 0.5, 'cut on both axes still reads as cut');
  assert.ok(Math.abs(superRadius(0.7, 0) - 1) < 1e-9, 'square=0 must leave a circle alone');
  assert.ok(superRadius(Math.PI / 4, 1) > 1.2, 'corners push outward');
  assert.ok(Math.abs(superRadius(0, 1) - 1) < 1e-6, 'axis points stay put');
});
