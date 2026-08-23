/**
 * Headless stability harness for the Topple solver.
 *
 * Software rendering runs this project at 1–5 fps, which makes any physics look
 * broken whether it is or not. Stability is therefore asserted here — stepping
 * the world in Node with no renderer at all — and never judged by eye.
 *
 * The checks are the ones that actually catch a bad stacking solver:
 * sinking (position drift down), jitter (residual velocity that never decays),
 * creep (horizontal drift under gravity), explosion (non-finite or unbounded
 * state) and non-determinism. Sleeping is disabled for the jitter runs so the
 * solver cannot pass by freezing.
 */
import { BODY_DYNAMIC, BODY_STATIC, Body } from './body';
import { PhysicsWorld } from './world';

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

export const FIXED_STEP = 1 / 240;

function ground(world: PhysicsWorld): Body {
  const g = new Body();
  g.kind = BODY_STATIC;
  g.setBox(20, 1, 20, 0);
  g.friction = 0.85;
  g.setPose(0, -1, 0);
  return world.add(g);
}

/** A tower of `count` slabs the size and weight of real Snackery food. */
function tower(
  world: PhysicsWorld,
  count: number,
  opts: { half?: number; thick?: number; offset?: number; gap?: number } = {},
): Body[] {
  const half = opts.half ?? 0.85;
  const thick = opts.thick ?? 0.18;
  const offset = opts.offset ?? 0;
  const gap = opts.gap ?? 0;
  const out: Body[] = [];
  for (let i = 0; i < count; i++) {
    const b = new Body();
    b.kind = BODY_DYNAMIC;
    b.setBox(half, thick, half, 1.6);
    b.friction = 0.7;
    b.restitution = 0;
    b.setPose(offset * i, thick + i * (thick * 2 + gap), 0);
    out.push(world.add(b));
  }
  return out;
}

function stepFor(world: PhysicsWorld, seconds: number): void {
  const n = Math.round(seconds / FIXED_STEP);
  for (let i = 0; i < n; i++) world.step(FIXED_STEP);
}

/** Worst overlap between vertically adjacent slabs. Negative means a gap. */
function worstPenetration(bodies: Body[]): number {
  let worst = -Infinity;
  for (let i = 1; i < bodies.length; i++) {
    const lower = bodies[i - 1];
    const upper = bodies[i];
    const pen = lower.aMaxY - upper.aMinY;
    if (pen > worst) worst = pen;
  }
  return worst;
}

function fmt(v: number): string {
  return Math.abs(v) < 1e-4 ? v.toExponential(2) : v.toFixed(5);
}

export function runStabilityChecks(): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (name: string, pass: boolean, detail: string): void => {
    out.push({ name, pass, detail });
  };

  // ---- 1. the headline test: ten boxes, ten seconds, still standing --------
  {
    const w = new PhysicsWorld();
    ground(w);
    const boxes = tower(w, 10);
    const startTop = boxes[9].py;
    stepFor(w, 10);
    let maxDrift = 0;
    let maxTilt = 0;
    for (const b of boxes) {
      maxDrift = Math.max(maxDrift, Math.hypot(b.px, b.pz));
      maxTilt = Math.max(maxTilt, b.tilt);
    }
    const sink = startTop - boxes[9].py;
    const pass =
      !w.faulted && maxDrift < 0.03 && maxTilt < 0.035 && sink < 0.03 && sink > -0.01;
    add(
      'stack of 10 stands for 10s',
      pass,
      `drift=${fmt(maxDrift)} tilt=${fmt(maxTilt)}rad sink=${fmt(sink)} settled=${w.settled}`,
    );
  }

  // ---- 2. no sinking, no jitter, with sleeping DISABLED --------------------
  {
    const w = new PhysicsWorld();
    w.allowSleep = false;
    ground(w);
    const boxes = tower(w, 10);
    stepFor(w, 10);
    const pen = worstPenetration(boxes);
    const speed = w.speed;
    const spin = w.spin;
    const pass = !w.faulted && pen < 0.012 && speed < 0.02 && spin < 0.05;
    add(
      'no sink / no jitter with sleep off',
      pass,
      `worstOverlap=${fmt(pen)} |v|=${fmt(speed)} |w|=${fmt(spin)}`,
    );
  }

  // ---- 3. a tall stack: 20 slabs -------------------------------------------
  {
    const w = new PhysicsWorld();
    ground(w);
    const boxes = tower(w, 20);
    const startTop = boxes[19].py;
    stepFor(w, 10);
    let maxDrift = 0;
    for (const b of boxes) maxDrift = Math.max(maxDrift, Math.hypot(b.px, b.pz));
    const sink = startTop - boxes[19].py;
    const pass = !w.faulted && maxDrift < 0.06 && sink < 0.06;
    add('stack of 20 stands for 10s', pass, `drift=${fmt(maxDrift)} sink=${fmt(sink)}`);
  }

  // ---- 4. tapered tower, the shape Topple actually builds -------------------
  {
    const w = new PhysicsWorld();
    ground(w);
    const boxes: Body[] = [];
    let y = 0;
    for (let i = 0; i < 16; i++) {
      const half = 0.95 * (0.62 + 0.38 * Math.exp(-i / 14));
      const thick = 0.11 + (i % 3) * 0.04;
      const b = new Body();
      b.kind = BODY_DYNAMIC;
      b.setBox(half, thick, half, 1.6);
      b.friction = 0.7;
      // Alternate the yaw 90 degrees, as the game does.
      const yaw = (i % 2) * Math.PI * 0.5;
      b.setPose(0, y + thick, 0, 0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
      y += thick * 2;
      boxes.push(w.add(b));
    }
    const startTop = boxes[15].py;
    stepFor(w, 10);
    let maxDrift = 0;
    for (const b of boxes) maxDrift = Math.max(maxDrift, Math.hypot(b.px, b.pz));
    const pass = !w.faulted && maxDrift < 0.05 && startTop - boxes[15].py < 0.05;
    add(
      'tapered 16-slab tower stands for 10s',
      pass,
      `drift=${fmt(maxDrift)} sink=${fmt(startTop - boxes[15].py)}`,
    );
  }

  // ---- 5. a dropped slab settles quickly ------------------------------------
  {
    const w = new PhysicsWorld();
    ground(w);
    const boxes = tower(w, 6);
    stepFor(w, 2);
    const drop = new Body();
    drop.kind = BODY_DYNAMIC;
    drop.setBox(0.85, 0.18, 0.85, 1.6);
    drop.friction = 0.7;
    drop.setPose(0.12, boxes[5].py + 0.18 + 0.9, 0);
    drop.vy = -1;
    w.add(drop);
    let settleTime = -1;
    for (let i = 0; i < 300; i++) {
      w.step(FIXED_STEP);
      if (w.settled) {
        settleTime = i * FIXED_STEP;
        break;
      }
    }
    const pass = settleTime >= 0 && settleTime < 1.6 && !w.faulted;
    add('dropped slab settles', pass, `settled after ${fmt(settleTime)}s`);
  }

  // ---- 6. an unbalanced tower genuinely topples -----------------------------
  {
    const w = new PhysicsWorld();
    ground(w);
    const boxes = tower(w, 9, { offset: 0.42 });
    const startTop = boxes[8].topY;
    stepFor(w, 4);
    const endTop = Math.max(...boxes.map((b) => b.topY));
    const fell = startTop - endTop > 0.55;
    add(
      'a leaning tower falls (the game can end)',
      fell && !w.faulted,
      `peak ${fmt(startTop)} -> ${fmt(endTop)}`,
    );
  }

  // ---- 7. nothing ever goes non-finite or unbounded --------------------------
  {
    const w = new PhysicsWorld();
    ground(w);
    const boxes: Body[] = [];
    for (let i = 0; i < 14; i++) {
      const b = new Body();
      b.kind = BODY_DYNAMIC;
      b.setBox(0.6, 0.12, 0.6, 1.6);
      b.friction = 0.7;
      // Deliberately abusive: heavy initial interpenetration and spin.
      b.setPose(0, 0.12 + i * 0.13, 0, 0.2, 0.1, 0.05, 0.97);
      b.vx = (i % 3) - 1;
      b.wz = 6 - i;
      boxes.push(w.add(b));
    }
    stepFor(w, 8);
    let ok = !w.faulted;
    for (const b of boxes) {
      if (!b.isFinite()) ok = false;
      if (Math.abs(b.px) > 60 || Math.abs(b.py) > 60 || Math.abs(b.pz) > 60) ok = false;
    }
    add('interpenetrating pile does not explode', ok, `faulted=${w.faulted}`);
  }

  // ---- 8. determinism --------------------------------------------------------
  {
    const sample = (): number[] => {
      const w = new PhysicsWorld();
      ground(w);
      const boxes = tower(w, 12, { offset: 0.05 });
      stepFor(w, 6);
      const v: number[] = [];
      for (const b of boxes) v.push(b.px, b.py, b.pz, b.qx, b.qy, b.qz, b.qw);
      return v;
    };
    const a = sample();
    const b = sample();
    let same = a.length === b.length;
    let worst = 0;
    for (let i = 0; same && i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (d > worst) worst = d;
      if (a[i] !== b[i]) same = false;
    }
    add('identical inputs give bit-identical output', same, `maxDelta=${worst}`);
  }

  // ---- 9. friction actually holds ---------------------------------------------
  {
    const w = new PhysicsWorld();
    ground(w);
    const boxes = tower(w, 4);
    // A shove into the top slab must not slide the whole tower off.
    boxes[3].vx = 1.4;
    stepFor(w, 6);
    const slide = Math.abs(boxes[3].px);
    const basePass = Math.abs(boxes[0].px) < 0.05;
    add(
      'friction holds a shoved tower together',
      slide < 0.45 && basePass && !w.faulted,
      `topSlide=${fmt(slide)} baseSlide=${fmt(Math.abs(boxes[0].px))}`,
    );
  }

  return out;
}

/** Human-readable report; used by the dev runner and by CI-style checks. */
export function formatStabilityReport(results: CheckResult[]): string {
  const lines = results.map(
    (r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(44)} ${r.detail}`,
  );
  const failed = results.filter((r) => !r.pass).length;
  lines.push('');
  lines.push(`${results.length - failed}/${results.length} checks passed`);
  return lines.join('\n');
}
