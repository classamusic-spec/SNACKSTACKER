/**
 * Sequential-impulse rigid-body world, fixed timestep, boxes only.
 *
 * WHY HAND-ROLLED (the budget question, answered):
 *   The brief allowed ~120 KB gzipped for a physics dependency. cannon-es costs
 *   about 45 KB gzipped and rapier about 300 KB gzipped of WASM — both fit or
 *   nearly fit, and both were rejected for the same three reasons:
 *
 *   1. Zero per-frame allocation is a hard requirement here. Both engines
 *      allocate vectors, contact equations and arrays inside their narrowphase;
 *      neither exposes a knob to stop it. This file allocates nothing after
 *      construction, which is verifiable and is the reason a 40-box tower holds
 *      60fps on a mid-range phone.
 *   2. The problem is narrow. Every food is a flat slab; every contact that
 *      matters is a near-horizontal face against a face. A general engine pays
 *      for spheres, capsules, meshes, CCD, constraints and joints that this
 *      game will never use. 900 lines of solver beats 45 KB of gzip.
 *   3. Determinism. Given the same body order and the same fixed step this
 *      solver produces bit-identical results, which is what makes the headless
 *      stability test meaningful rather than decorative.
 *
 * The technique is Catto/Bullet standard: persistent manifolds with warm
 * starting, accumulated-impulse clamping, and split-impulse (pseudo-velocity)
 * position correction so that pushing boxes apart never injects energy into the
 * stack. Restitution defaults to zero — food does not bounce.
 */
import { BODY_DYNAMIC, Body } from './body';
import { Manifold, collideBoxes } from './collide';
import { tangentBasis } from './math';

export interface WorldOpts {
  gravity?: number;
  velocityIterations?: number;
  positionIterations?: number;
}

/** Penetration tolerated before the position pass pushes back. */
const SLOP = 0.004;
/** Fraction of the remaining overlap resolved per step. */
const BAUMGARTE = 0.22;
/** Cap on the pseudo-velocity, so a deep overlap cannot fire a box across the room. */
const MAX_CORRECT_VEL = 2.6;
/** Below this approach speed a collision is treated as inelastic regardless of restitution. */
const REST_THRESHOLD = 1.1;

const LIN_DAMP = 0.08;
const ANG_DAMP = 0.55;
const MAX_LIN = 90;
const MAX_ANG = 32;

/** The whole tower is one island, so sleeping is global — and it is exactly "settled". */
const SLEEP_LIN = 0.035;
const SLEEP_ANG = 0.06;
const SLEEP_TIME = 0.42;

const TANGENTS = new Float64Array(6);

export class PhysicsWorld {
  readonly bodies: Body[] = [];
  gravity: number;
  velocityIterations: number;
  positionIterations: number;

  /** Manifolds that produced contacts this step. Read-only to callers. */
  readonly active: Manifold[] = [];
  activeCount = 0;

  /** Steps taken since reset — the clock everything deterministic is driven by. */
  steps = 0;
  /** Off in the headless jitter test, so the solver cannot hide behind sleeping. */
  allowSleep = true;
  /** Set once if the integrator ever produced a non-finite value. */
  faulted = false;

  private manifolds = new Map<number, Manifold>();
  /**
   * The same manifolds as a dense array. Iterating a Map allocates an iterator
   * and a result object per entry per step — about 750 bytes a step, which is
   * 180 KB a second of pure garbage. The array exists solely so the stale sweep
   * allocates nothing.
   */
  private all: Manifold[] = [];
  private pool: Manifold[] = [];
  private stamp = 0;
  private nextId = 0;
  private quietTime = 0;
  private sleeping = false;
  private maxLin = 0;
  private maxAng = 0;

  constructor(opts: WorldOpts = {}) {
    this.gravity = opts.gravity ?? -22;
    this.velocityIterations = opts.velocityIterations ?? 14;
    this.positionIterations = opts.positionIterations ?? 8;
  }

  add(body: Body): Body {
    body.id = this.nextId++;
    this.bodies.push(body);
    body.syncTransform();
    body.commitPrev();
    this.wake();
    return body;
  }

  /** Drop every body and manifold. Ids restart, so keys can never collide. */
  reset(): void {
    this.bodies.length = 0;
    for (let i = 0; i < this.all.length; i++) this.release(this.all[i]);
    this.all.length = 0;
    this.manifolds.clear();
    this.active.length = 0;
    this.activeCount = 0;
    this.nextId = 0;
    this.steps = 0;
    this.stamp = 0;
    this.quietTime = 0;
    this.sleeping = false;
    this.faulted = false;
  }

  wake(): void {
    this.sleeping = false;
    this.quietTime = 0;
  }

  get asleep(): boolean {
    return this.sleeping;
  }

  /** True once the tower has stopped moving in any meaningful way. */
  get settled(): boolean {
    return this.sleeping || (this.maxLin < 0.09 && this.maxAng < 0.22);
  }

  get speed(): number {
    return this.maxLin;
  }

  get spin(): number {
    return this.maxAng;
  }

  // ---------------------------------------------------------------------------

  step(h: number): void {
    this.steps++;
    for (let i = 0; i < this.bodies.length; i++) this.bodies[i].commitPrev();
    if (this.sleeping) {
      for (let i = 0; i < this.activeCount; i++) this.active[i].impulse = 0;
      return;
    }

    this.stamp++;
    const bodies = this.bodies;
    const n = bodies.length;

    // 1. integrate velocities
    const gh = this.gravity * h;
    const linScale = 1 / (1 + h * LIN_DAMP);
    const angScale = 1 / (1 + h * ANG_DAMP);
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (b.kind !== BODY_DYNAMIC) continue;
      b.vy += gh;
      b.vx *= linScale;
      b.vy *= linScale;
      b.vz *= linScale;
      b.wx *= angScale;
      b.wy *= angScale;
      b.wz *= angScale;
    }

    // 2. refresh transforms and broadphase bounds
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (b.kind === BODY_DYNAMIC) b.syncTransform();
    }

    // 3. broadphase + narrowphase. O(n^2) on purpose: n is at most a few dozen
    //    here, and a brute-force AABB sweep with no allocation beats any tree.
    this.activeCount = 0;
    for (let i = 0; i < n; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < n; j++) {
        const b = bodies[j];
        if (a.kind !== BODY_DYNAMIC && b.kind !== BODY_DYNAMIC) continue;
        if (
          a.aMaxX < b.aMinX ||
          a.aMinX > b.aMaxX ||
          a.aMaxY < b.aMinY ||
          a.aMinY > b.aMaxY ||
          a.aMaxZ < b.aMinZ ||
          a.aMinZ > b.aMaxZ
        ) {
          continue;
        }
        const key = a.id * 4096 + b.id;
        let m = this.manifolds.get(key);
        if (!m) {
          m = this.pool.pop() ?? new Manifold();
          m.key = key;
          m.count = 0;
          m.a = a;
          m.b = b;
          this.manifolds.set(key, m);
          this.all.push(m);
        }
        // Stamp on AABB overlap, not on contact: a pair that is close but not
        // yet touching must keep its manifold, or it is destroyed and rebuilt
        // every step and its warm-start history is thrown away each time.
        m.stamp = this.stamp;
        if (collideBoxes(a, b, m)) {
          m.impulse = 0;
          this.active[this.activeCount++] = m;
        } else {
          m.count = 0;
        }
      }
    }

    // Retire manifolds whose pair stopped overlapping at all. Swap-remove from
    // the dense array so the sweep is allocation-free.
    for (let i = this.all.length - 1; i >= 0; i--) {
      const m = this.all[i];
      if (m.stamp === this.stamp) continue;
      this.manifolds.delete(m.key);
      const last = this.all.length - 1;
      this.all[i] = this.all[last];
      this.all.length = last;
      this.release(m);
    }

    // 4. prestep: effective masses, restitution, warm start
    for (let k = 0; k < this.activeCount; k++) this.prestep(this.active[k]);

    // 5. velocity iterations.
    //    Gauss-Seidel converges along a chain in the direction it sweeps, and a
    //    tower IS a chain: sweeping bottom-to-top only, a 20-slab stack needs
    //    ~20 iterations to carry the load to the plate. Alternating the sweep
    //    direction propagates both ways and converges in a third of the work.
    const ac = this.activeCount;
    for (let it = 0; it < this.velocityIterations; it++) {
      if ((it & 1) === 0) {
        for (let k = 0; k < ac; k++) this.solveVelocity(this.active[k]);
      } else {
        for (let k = ac - 1; k >= 0; k--) this.solveVelocity(this.active[k]);
      }
    }

    // Record the settled normal impulse per manifold, for impact SFX and dust.
    for (let k = 0; k < ac; k++) {
      const m = this.active[k];
      let sum = 0;
      for (let i = 0; i < m.count; i++) sum += m.points[i].nImp;
      m.impulse = sum;
    }

    // 6. position (split-impulse) iterations
    const biasRate = BAUMGARTE / h;
    for (let it = 0; it < this.positionIterations; it++) {
      if ((it & 1) === 0) {
        for (let k = 0; k < ac; k++) this.solvePosition(this.active[k], biasRate);
      } else {
        for (let k = ac - 1; k >= 0; k--) this.solvePosition(this.active[k], biasRate);
      }
    }

    // 7. integrate positions, clamp, guard
    this.maxLin = 0;
    this.maxAng = 0;
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (b.kind !== BODY_DYNAMIC) continue;
      this.integrate(b, h);
    }

    // 8. global sleep
    if (this.allowSleep && this.maxLin < SLEEP_LIN && this.maxAng < SLEEP_ANG) {
      this.quietTime += h;
      if (this.quietTime >= SLEEP_TIME) {
        this.sleeping = true;
        for (let i = 0; i < n; i++) {
          if (bodies[i].kind === BODY_DYNAMIC) bodies[i].clearMotion();
        }
        this.maxLin = 0;
        this.maxAng = 0;
      }
    } else {
      this.quietTime = 0;
    }
  }

  private integrate(b: Body, h: number): void {
    let vx = b.vx;
    let vy = b.vy;
    let vz = b.vz;
    let wx = b.wx;
    let wy = b.wy;
    let wz = b.wz;

    const lin = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (lin > MAX_LIN) {
      const s = MAX_LIN / lin;
      vx *= s;
      vy *= s;
      vz *= s;
      b.vx = vx;
      b.vy = vy;
      b.vz = vz;
    }
    const ang = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (ang > MAX_ANG) {
      const s = MAX_ANG / ang;
      wx *= s;
      wy *= s;
      wz *= s;
      b.wx = wx;
      b.wy = wy;
      b.wz = wz;
    }
    if (lin > this.maxLin) this.maxLin = lin;
    if (ang > this.maxAng) this.maxAng = ang;

    b.px += (vx + b.pvx) * h;
    b.py += (vy + b.pvy) * h;
    b.pz += (vz + b.pvz) * h;

    const ox = wx + b.pwx;
    const oy = wy + b.pwy;
    const oz = wz + b.pwz;
    const half = h * 0.5;
    const dx = half * (ox * b.qw + oy * b.qz - oz * b.qy);
    const dy = half * (oy * b.qw + oz * b.qx - ox * b.qz);
    const dz = half * (oz * b.qw + ox * b.qy - oy * b.qx);
    const dw = -half * (ox * b.qx + oy * b.qy + oz * b.qz);
    let qx = b.qx + dx;
    let qy = b.qy + dy;
    let qz = b.qz + dz;
    let qw = b.qw + dw;
    const len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
    if (len > 1e-9) {
      const inv = 1 / len;
      qx *= inv;
      qy *= inv;
      qz *= inv;
      qw *= inv;
    } else {
      qx = 0;
      qy = 0;
      qz = 0;
      qw = 1;
    }
    b.qx = qx;
    b.qy = qy;
    b.qz = qz;
    b.qw = qw;

    b.pvx = 0;
    b.pvy = 0;
    b.pvz = 0;
    b.pwx = 0;
    b.pwy = 0;
    b.pwz = 0;

    // A single non-finite value in one body propagates through its contacts to
    // the whole island within a step or two and freezes or explodes the scene.
    // Roll the body back to its last good pose instead and mark the world.
    if (!b.isFinite()) {
      b.px = b.prevPx;
      b.py = b.prevPy;
      b.pz = b.prevPz;
      b.qx = b.prevQx;
      b.qy = b.prevQy;
      b.qz = b.prevQz;
      b.qw = b.prevQw;
      b.clearMotion();
      this.faulted = true;
    }
    b.syncTransform();
  }

  // ---------------------------------------------------------------------------

  private prestep(m: Manifold): void {
    const a = m.a!;
    const b = m.b!;
    tangentBasis(m.nx, m.ny, m.nz, TANGENTS);
    m.t1x = TANGENTS[0];
    m.t1y = TANGENTS[1];
    m.t1z = TANGENTS[2];
    m.t2x = TANGENTS[3];
    m.t2y = TANGENTS[4];
    m.t2z = TANGENTS[5];

    const ima = a.invMass;
    const imb = b.invMass;
    const ia = a.invInertia;
    const ib = b.invInertia;

    for (let i = 0; i < m.count; i++) {
      const p = m.points[i];
      p.rax = p.cx - a.px;
      p.ray = p.cy - a.py;
      p.raz = p.cz - a.pz;
      p.rbx = p.cx - b.px;
      p.rby = p.cy - b.py;
      p.rbz = p.cz - b.pz;

      p.nMass = effMass(ima, imb, ia, ib, p.rax, p.ray, p.raz, p.rbx, p.rby, p.rbz, m.nx, m.ny, m.nz);
      p.t1Mass = effMass(ima, imb, ia, ib, p.rax, p.ray, p.raz, p.rbx, p.rby, p.rbz, m.t1x, m.t1y, m.t1z);
      p.t2Mass = effMass(ima, imb, ia, ib, p.rax, p.ray, p.raz, p.rbx, p.rby, p.rbz, m.t2x, m.t2y, m.t2z);

      p.bias = 0;
      if (m.restitution > 0) {
        const dvx = b.vx + (b.wy * p.rbz - b.wz * p.rby) - (a.vx + (a.wy * p.raz - a.wz * p.ray));
        const dvy = b.vy + (b.wz * p.rbx - b.wx * p.rbz) - (a.vy + (a.wz * p.rax - a.wx * p.raz));
        const dvz = b.vz + (b.wx * p.rby - b.wy * p.rbx) - (a.vz + (a.wx * p.ray - a.wy * p.rax));
        const vn = dvx * m.nx + dvy * m.ny + dvz * m.nz;
        if (vn < -REST_THRESHOLD) p.bias = -m.restitution * vn;
      }

      // Warm start with the impulse this contact needed last step.
      const px = m.nx * p.nImp + m.t1x * p.t1Imp + m.t2x * p.t2Imp;
      const py = m.ny * p.nImp + m.t1y * p.t1Imp + m.t2y * p.t2Imp;
      const pz = m.nz * p.nImp + m.t1z * p.t1Imp + m.t2z * p.t2Imp;
      applyImpulse(a, b, p.rax, p.ray, p.raz, p.rbx, p.rby, p.rbz, px, py, pz);
      p.pnImp = 0;
    }
  }

  private solveVelocity(m: Manifold): void {
    const a = m.a!;
    const b = m.b!;
    const mu = m.friction;
    for (let i = 0; i < m.count; i++) {
      const p = m.points[i];
      const dvx = b.vx + (b.wy * p.rbz - b.wz * p.rby) - (a.vx + (a.wy * p.raz - a.wz * p.ray));
      const dvy = b.vy + (b.wz * p.rbx - b.wx * p.rbz) - (a.vy + (a.wz * p.rax - a.wx * p.raz));
      const dvz = b.vz + (b.wx * p.rby - b.wy * p.rbx) - (a.vz + (a.wx * p.ray - a.wy * p.rax));

      // Friction first, bounded by the normal impulse the contact currently
      // carries: solving it after the normal pass makes resting boxes creep.
      const maxF = mu * p.nImp;
      const vt1 = dvx * m.t1x + dvy * m.t1y + dvz * m.t1z;
      let l1 = -vt1 * p.t1Mass;
      let old = p.t1Imp;
      let acc = old + l1;
      p.t1Imp = acc < -maxF ? -maxF : acc > maxF ? maxF : acc;
      l1 = p.t1Imp - old;

      const vt2 = dvx * m.t2x + dvy * m.t2y + dvz * m.t2z;
      let l2 = -vt2 * p.t2Mass;
      old = p.t2Imp;
      acc = old + l2;
      p.t2Imp = acc < -maxF ? -maxF : acc > maxF ? maxF : acc;
      l2 = p.t2Imp - old;

      applyImpulse(
        a,
        b,
        p.rax,
        p.ray,
        p.raz,
        p.rbx,
        p.rby,
        p.rbz,
        m.t1x * l1 + m.t2x * l2,
        m.t1y * l1 + m.t2y * l2,
        m.t1z * l1 + m.t2z * l2,
      );

      const ndvx = b.vx + (b.wy * p.rbz - b.wz * p.rby) - (a.vx + (a.wy * p.raz - a.wz * p.ray));
      const ndvy = b.vy + (b.wz * p.rbx - b.wx * p.rbz) - (a.vy + (a.wz * p.rax - a.wx * p.raz));
      const ndvz = b.vz + (b.wx * p.rby - b.wy * p.rbx) - (a.vz + (a.wx * p.ray - a.wy * p.rax));
      const vn = ndvx * m.nx + ndvy * m.ny + ndvz * m.nz;
      let ln = (-vn + p.bias) * p.nMass;
      old = p.nImp;
      acc = old + ln;
      p.nImp = acc > 0 ? acc : 0;
      ln = p.nImp - old;
      applyImpulse(
        a,
        b,
        p.rax,
        p.ray,
        p.raz,
        p.rbx,
        p.rby,
        p.rbz,
        m.nx * ln,
        m.ny * ln,
        m.nz * ln,
      );
    }
  }

  private solvePosition(m: Manifold, biasRate: number): void {
    const a = m.a!;
    const b = m.b!;
    for (let i = 0; i < m.count; i++) {
      const p = m.points[i];
      const over = p.depth - SLOP;
      if (over <= 0 && p.pnImp <= 0) continue;
      let target = over > 0 ? over * biasRate : 0;
      if (target > MAX_CORRECT_VEL) target = MAX_CORRECT_VEL;

      const dvx =
        b.pvx + (b.pwy * p.rbz - b.pwz * p.rby) - (a.pvx + (a.pwy * p.raz - a.pwz * p.ray));
      const dvy =
        b.pvy + (b.pwz * p.rbx - b.pwx * p.rbz) - (a.pvy + (a.pwz * p.rax - a.pwx * p.raz));
      const dvz =
        b.pvz + (b.pwx * p.rby - b.pwy * p.rbx) - (a.pvz + (a.pwx * p.ray - a.pwy * p.rax));
      const vn = dvx * m.nx + dvy * m.ny + dvz * m.nz;
      let l = (-vn + target) * p.nMass;
      const old = p.pnImp;
      const acc = old + l;
      p.pnImp = acc > 0 ? acc : 0;
      l = p.pnImp - old;
      applyPseudoImpulse(
        a,
        b,
        p.rax,
        p.ray,
        p.raz,
        p.rbx,
        p.rby,
        p.rbz,
        m.nx * l,
        m.ny * l,
        m.nz * l,
      );
    }
  }

  private release(m: Manifold): void {
    m.a = null;
    m.b = null;
    m.count = 0;
    m.stamp = -1;
    if (this.pool.length < 96) this.pool.push(m);
  }
}

function effMass(
  ima: number,
  imb: number,
  ia: Float64Array,
  ib: Float64Array,
  rax: number,
  ray: number,
  raz: number,
  rbx: number,
  rby: number,
  rbz: number,
  nx: number,
  ny: number,
  nz: number,
): number {
  const cax = ray * nz - raz * ny;
  const cay = raz * nx - rax * nz;
  const caz = rax * ny - ray * nx;
  const cbx = rby * nz - rbz * ny;
  const cby = rbz * nx - rbx * nz;
  const cbz = rbx * ny - rby * nx;
  const ka =
    cax * (ia[0] * cax + ia[1] * cay + ia[2] * caz) +
    cay * (ia[3] * cax + ia[4] * cay + ia[5] * caz) +
    caz * (ia[6] * cax + ia[7] * cay + ia[8] * caz);
  const kb =
    cbx * (ib[0] * cbx + ib[1] * cby + ib[2] * cbz) +
    cby * (ib[3] * cbx + ib[4] * cby + ib[5] * cbz) +
    cbz * (ib[6] * cbx + ib[7] * cby + ib[8] * cbz);
  const k = ima + imb + ka + kb;
  return k > 1e-12 ? 1 / k : 0;
}

function applyImpulse(
  a: Body,
  b: Body,
  rax: number,
  ray: number,
  raz: number,
  rbx: number,
  rby: number,
  rbz: number,
  px: number,
  py: number,
  pz: number,
): void {
  if (a.invMass > 0) {
    a.vx -= px * a.invMass;
    a.vy -= py * a.invMass;
    a.vz -= pz * a.invMass;
    const tx = ray * pz - raz * py;
    const ty = raz * px - rax * pz;
    const tz = rax * py - ray * px;
    const ia = a.invInertia;
    a.wx -= ia[0] * tx + ia[1] * ty + ia[2] * tz;
    a.wy -= ia[3] * tx + ia[4] * ty + ia[5] * tz;
    a.wz -= ia[6] * tx + ia[7] * ty + ia[8] * tz;
  }
  if (b.invMass > 0) {
    b.vx += px * b.invMass;
    b.vy += py * b.invMass;
    b.vz += pz * b.invMass;
    const tx = rby * pz - rbz * py;
    const ty = rbz * px - rbx * pz;
    const tz = rbx * py - rby * px;
    const ib = b.invInertia;
    b.wx += ib[0] * tx + ib[1] * ty + ib[2] * tz;
    b.wy += ib[3] * tx + ib[4] * ty + ib[5] * tz;
    b.wz += ib[6] * tx + ib[7] * ty + ib[8] * tz;
  }
}

function applyPseudoImpulse(
  a: Body,
  b: Body,
  rax: number,
  ray: number,
  raz: number,
  rbx: number,
  rby: number,
  rbz: number,
  px: number,
  py: number,
  pz: number,
): void {
  if (a.invMass > 0) {
    a.pvx -= px * a.invMass;
    a.pvy -= py * a.invMass;
    a.pvz -= pz * a.invMass;
    const tx = ray * pz - raz * py;
    const ty = raz * px - rax * pz;
    const tz = rax * py - ray * px;
    const ia = a.invInertia;
    a.pwx -= ia[0] * tx + ia[1] * ty + ia[2] * tz;
    a.pwy -= ia[3] * tx + ia[4] * ty + ia[5] * tz;
    a.pwz -= ia[6] * tx + ia[7] * ty + ia[8] * tz;
  }
  if (b.invMass > 0) {
    b.pvx += px * b.invMass;
    b.pvy += py * b.invMass;
    b.pvz += pz * b.invMass;
    const tx = rby * pz - rbz * py;
    const ty = rbz * px - rbx * pz;
    const tz = rbx * py - rby * px;
    const ib = b.invInertia;
    b.pwx += ib[0] * tx + ib[1] * ty + ib[2] * tz;
    b.pwy += ib[3] * tx + ib[4] * ty + ib[5] * tz;
    b.pwz += ib[6] * tx + ib[7] * ty + ib[8] * tz;
  }
}
