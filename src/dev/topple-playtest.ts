/**
 * TEMPORARY DEV FILE (safe to delete with the rest of the topple-* harness).
 *
 * Headless playtest: runs the real Topple rules and the real solver against a
 * simulated player whose only flaw is release-timing jitter, and reports how
 * long runs last. This is how the 30-90 second target and the difficulty curve
 * were tuned — not by playing it at 3fps under swiftshader.
 *
 *   npx tsx src/dev/topple-playtest.ts
 */
import { Body, BODY_DYNAMIC, BODY_STATIC, PhysicsWorld } from '../modes/topple/physics';
import { TOPPLE, footprintFor, swingAmplitude, swingPeriod } from '../modes/topple/tuning';

const TAU = Math.PI * 2;
const CM = 9;

interface RunStats {
  items: number;
  cm: number;
  seconds: number;
  reason: string;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller, so timing error is Gaussian rather than boxy. */
function gauss(r: () => number): number {
  const u = Math.max(r(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * r());
}

function simulate(seed: number, sigma: number, thicknesses: number[]): RunStats {
  const h = TOPPLE.STEP;
  const world = new PhysicsWorld({
    gravity: TOPPLE.GRAVITY,
    velocityIterations: TOPPLE.VEL_ITERS,
    positionIterations: TOPPLE.POS_ITERS,
  });
  const r = rng(seed);
  const plateRadius = TOPPLE.BASE * TOPPLE.PLATE_SCALE * 0.5;

  const plate = new Body();
  plate.kind = BODY_STATIC;
  plate.setBox((plateRadius / Math.SQRT2) * 1.1, 0.25, (plateRadius / Math.SQRT2) * 1.1, 0);
  plate.friction = TOPPLE.PLATE_FRICTION;
  plate.setPose(0, -0.25, 0);
  world.add(plate);
  const table = new Body();
  table.kind = BODY_STATIC;
  table.setBox(26, 0.5, 26, 0);
  table.friction = 0.85;
  table.setPose(0, -0.85, 0);
  world.add(table);

  const items: Body[] = [];
  const addItem = (
    index: number,
    x: number,
    cy: number,
    z: number,
    vx: number,
    vz: number,
    yaw: number,
    bank: number,
    axis: 0 | 1,
    thick: number,
  ): Body => {
    const w = footprintFor(index);
    const d = w * TOPPLE.DEPTH_RATIO;
    const b = new Body();
    b.kind = BODY_DYNAMIC;
    b.setBox((w * TOPPLE.HULL_INSET) / 2, thick / 2, (d * TOPPLE.HULL_INSET) / 2, TOPPLE.DENSITY);
    b.friction = TOPPLE.FRICTION;
    // yaw about Y then bank about the swing-perpendicular axis, as the game does.
    const sy = Math.sin(yaw / 2);
    const cyw = Math.cos(yaw / 2);
    const sb = Math.sin(bank / 2);
    const cb = Math.cos(bank / 2);
    let qx: number;
    let qy: number;
    let qz: number;
    let qw: number;
    if (axis === 0) {
      qx = sb * sy;
      qy = cb * sy;
      qz = sb * cyw;
      qw = cb * cyw;
    } else {
      qx = -sb * cyw;
      qy = cb * sy;
      qz = sb * sy;
      qw = cb * cyw;
    }
    b.setPose(x, cy, z, qx, qy, qz, qw);
    b.vx = vx;
    b.vz = vz;
    b.vy = -0.3;
    items.push(world.add(b));
    return b;
  };

  const peak = (): number => {
    let p = 0;
    for (const b of items) if (b.topY > p) p = b.topY;
    return p;
  };

  let seconds = 0;
  addItem(0, 0, thicknesses[0] / 2, 0, 0, 0, 0, 0, 0, thicknesses[0]);
  for (let i = 0; i < Math.round(0.4 / h); i++) world.step(h);
  let bestPeak = peak();

  const fall = Math.sqrt((2 * TOPPLE.DROP_GAP) / -TOPPLE.GRAVITY);

  for (let index = 1; index < 90; index++) {
    const amp = swingAmplitude(index);
    const omega = TAU / swingPeriod(index);
    const axis: 0 | 1 = index % 2 === 0 ? 0 : 1;
    const yaw = (index % 2) * Math.PI * 0.5;
    const top = items[items.length - 1];
    const limit = plateRadius * 0.55;
    const anchorX = Math.max(-limit, Math.min(limit, top.px));
    const anchorZ = Math.max(-limit, Math.min(limit, top.pz));
    const target = axis === 0 ? top.px : top.pz;
    const anchor = axis === 0 ? anchorX : anchorZ;

    // Where must the food be released so that (position + drift) lands on the
    // food below? sin(p) + k*cos(p) = e, with k = omega*CARRY*fall.
    const k = omega * TOPPLE.VEL_CARRY * fall;
    const e = (target - anchor) / amp;
    const rAmp = Math.hypot(1, k);
    const phi = Math.atan2(k, 1);
    const inner = Math.max(-1, Math.min(1, e / rAmp));
    const start = r() < 0.5 ? Math.PI * 0.5 : Math.PI * 1.5;
    const solA = Math.asin(inner) - phi;
    const solB = Math.PI - Math.asin(inner) - phi;
    const wrap = (p: number): number => {
      let q = p - start;
      while (q < 0) q += TAU;
      while (q >= TAU) q -= TAU;
      return q;
    };
    const wait = Math.min(wrap(solA), wrap(solB));
    const idealPhase = start + wait;

    // The player's only error is when they let go.
    const phase = idealPhase + omega * gauss(r) * sigma;
    seconds += TOPPLE.SPAWN_DELAY + wait / omega;

    const swing = amp * Math.sin(phase);
    const swingVel = amp * omega * Math.cos(phase);
    const bank = -Math.max(-1, Math.min(1, swingVel / (amp * omega))) * TOPPLE.BANK_MAX;
    const carried = swingVel * TOPPLE.VEL_CARRY;
    const topY = peak();
    const thick = thicknesses[index % thicknesses.length];
    addItem(
      index,
      axis === 0 ? anchorX + swing : anchorX,
      topY + TOPPLE.DROP_GAP + thick / 2,
      axis === 1 ? anchorZ + swing : anchorZ,
      axis === 0 ? carried : 0,
      axis === 1 ? carried : 0,
      yaw,
      bank,
      axis,
      thick,
    );

    // settle
    let t = 0;
    let fellReason = '';
    while (t < TOPPLE.SETTLE_MAX) {
      world.step(h);
      t += h;
      if (t >= TOPPLE.GRACE) {
        const p = peak();
        if (bestPeak - p > TOPPLE.COLLAPSE_DROP) fellReason = 'peak drop';
        for (let bi = 0; bi < items.length; bi++) {
          if (items[bi].py < TOPPLE.OFF_PLATE_Y) {
            fellReason = `hit the table (drop ${(bestPeak - p).toFixed(2)}, lean ${Math.hypot(items[items.length - 1].px, items[items.length - 1].pz).toFixed(2)})`;
          }
        }
      }
      if (fellReason) break;
      if (t >= TOPPLE.SETTLE_MIN && world.settled) break;
    }
    seconds += t;
    if (fellReason) {
      return { items: index, cm: Math.round(bestPeak * CM), seconds, reason: fellReason };
    }
    bestPeak = peak();
  }
  return { items: 90, cm: Math.round(bestPeak * CM), seconds, reason: 'cap' };
}

const THICKS = [0.62, 0.52, 0.24, 0.3, 0.36, 0.26, 0.28, 0.44];
const pct = (a: number[], p: number): number => a[Math.min(a.length - 1, Math.floor(a.length * p))];

for (const [label, sigma] of [
  ['expert  σ=30ms', 0.03],
  ['good    σ=60ms', 0.06],
  ['average σ=95ms', 0.095],
  ['sloppy  σ=140ms', 0.14],
] as [string, number][]) {
  const runs: RunStats[] = [];
  for (let s = 1; s <= 40; s++) runs.push(simulate(s * 7919, sigma, THICKS));
  const secs = runs.map((x) => x.seconds).sort((a, b) => a - b);
  const its = runs.map((x) => x.items).sort((a, b) => a - b);
  const cms = runs.map((x) => x.cm).sort((a, b) => a - b);
  const reasons = new Map<string, number>();
  for (const x of runs) reasons.set(x.reason, (reasons.get(x.reason) ?? 0) + 1);
  console.log(
    `${label}  seconds p10/p50/p90 = ${pct(secs, 0.1).toFixed(0)}/${pct(secs, 0.5).toFixed(0)}/${pct(secs, 0.9).toFixed(0)}` +
      `   items p50=${pct(its, 0.5)}  cm p50=${pct(cms, 0.5)}  ` +
      [...reasons].map(([k, v]) => `${k.split(' (')[0]}:${v}`).join(' '),
  );
}
