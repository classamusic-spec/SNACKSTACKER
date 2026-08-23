/**
 * A rigid box.
 *
 * State lives in flat number fields rather than Vector3 objects. That is ugly
 * to read in places, but it is the difference between zero allocation and a few
 * hundred short-lived vectors per step, and it keeps every hot field in the
 * same hidden class.
 *
 * Only boxes exist. Every food in Snackery is a flat slab whose interesting
 * contact is always top-face against bottom-face; oriented boxes model that
 * exactly and are the one shape whose contact manifold can be made genuinely
 * stable. See `shapes.ts` for how a ruffled lettuce leaf becomes a box.
 */
import { type Mat3, inertiaWorld, mat3, quatToMat3 } from './math';

export const BODY_STATIC = 0;
export const BODY_DYNAMIC = 1;

export class Body {
  /** Dense index into `PhysicsWorld.bodies`; also the manifold hash key. */
  id = 0;
  /** Owner-defined handle. The game stores its item index here; -1 for scenery. */
  tag = -1;
  kind: 0 | 1 = BODY_DYNAMIC;

  /** Half extents in body space. */
  hx = 0.5;
  hy = 0.5;
  hz = 0.5;

  px = 0;
  py = 0;
  pz = 0;
  qx = 0;
  qy = 0;
  qz = 0;
  qw = 1;

  vx = 0;
  vy = 0;
  vz = 0;
  wx = 0;
  wy = 0;
  wz = 0;

  /** Split-impulse pseudo velocities; drained into the transform each step. */
  pvx = 0;
  pvy = 0;
  pvz = 0;
  pwx = 0;
  pwy = 0;
  pwz = 0;

  invMass = 1;
  /** Inverse body-space inertia, diagonal. */
  ibx = 1;
  iby = 1;
  ibz = 1;

  friction = 0.62;
  restitution = 0;

  readonly rot: Mat3 = mat3();
  readonly invInertia: Mat3 = mat3();

  /** World AABB, refreshed once per step for the broadphase. */
  aMinX = 0;
  aMinY = 0;
  aMinZ = 0;
  aMaxX = 0;
  aMaxY = 0;
  aMaxZ = 0;

  /** Transform at the end of the previous step, for render interpolation. */
  prevPx = 0;
  prevPy = 0;
  prevPz = 0;
  prevQx = 0;
  prevQy = 0;
  prevQz = 0;
  prevQw = 1;

  setBox(hx: number, hy: number, hz: number, density: number): void {
    this.hx = hx;
    this.hy = hy;
    this.hz = hz;
    if (this.kind === BODY_STATIC) {
      this.invMass = 0;
      this.ibx = 0;
      this.iby = 0;
      this.ibz = 0;
      return;
    }
    const mass = Math.max(density * 8 * hx * hy * hz, 1e-4);
    this.invMass = 1 / mass;
    const k = mass / 3; // (1/12) * m * (2h)^2 summed pairwise
    const ix = k * (hy * hy + hz * hz);
    const iy = k * (hx * hx + hz * hz);
    const iz = k * (hx * hx + hy * hy);
    this.ibx = ix > 1e-9 ? 1 / ix : 0;
    this.iby = iy > 1e-9 ? 1 / iy : 0;
    this.ibz = iz > 1e-9 ? 1 / iz : 0;
  }

  makeStatic(): void {
    this.kind = BODY_STATIC;
    this.invMass = 0;
    this.ibx = 0;
    this.iby = 0;
    this.ibz = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.wx = 0;
    this.wy = 0;
    this.wz = 0;
  }

  setPose(px: number, py: number, pz: number, qx = 0, qy = 0, qz = 0, qw = 1): void {
    this.px = px;
    this.py = py;
    this.pz = pz;
    this.qx = qx;
    this.qy = qy;
    this.qz = qz;
    this.qw = qw;
    this.syncTransform();
    this.commitPrev();
  }

  /** Refresh the rotation matrix, world inertia and AABB from the pose. */
  syncTransform(): void {
    quatToMat3(this.qx, this.qy, this.qz, this.qw, this.rot);
    inertiaWorld(this.rot, this.ibx, this.iby, this.ibz, this.invInertia);
    const r = this.rot;
    const ex = this.hx * Math.abs(r[0]) + this.hy * Math.abs(r[1]) + this.hz * Math.abs(r[2]);
    const ey = this.hx * Math.abs(r[3]) + this.hy * Math.abs(r[4]) + this.hz * Math.abs(r[5]);
    const ez = this.hx * Math.abs(r[6]) + this.hy * Math.abs(r[7]) + this.hz * Math.abs(r[8]);
    this.aMinX = this.px - ex;
    this.aMaxX = this.px + ex;
    this.aMinY = this.py - ey;
    this.aMaxY = this.py + ey;
    this.aMinZ = this.pz - ez;
    this.aMaxZ = this.pz + ez;
  }

  commitPrev(): void {
    this.prevPx = this.px;
    this.prevPy = this.py;
    this.prevPz = this.pz;
    this.prevQx = this.qx;
    this.prevQy = this.qy;
    this.prevQz = this.qz;
    this.prevQw = this.qw;
  }

  /** Highest point of the world AABB — what "tower height" is measured from. */
  get topY(): number {
    return this.aMaxY;
  }

  /** Tilt of the body's local +Y away from world up, in radians. */
  get tilt(): number {
    const c = this.rot[4];
    return Math.acos(c < -1 ? -1 : c > 1 ? 1 : c);
  }

  clearMotion(): void {
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.wx = 0;
    this.wy = 0;
    this.wz = 0;
    this.pvx = 0;
    this.pvy = 0;
    this.pvz = 0;
    this.pwx = 0;
    this.pwy = 0;
    this.pwz = 0;
  }

  /** True when every component of the pose and velocity is a real number. */
  isFinite(): boolean {
    return (
      Number.isFinite(this.px + this.py + this.pz) &&
      Number.isFinite(this.qx + this.qy + this.qz + this.qw) &&
      Number.isFinite(this.vx + this.vy + this.vz) &&
      Number.isFinite(this.wx + this.wy + this.wz)
    );
  }
}
