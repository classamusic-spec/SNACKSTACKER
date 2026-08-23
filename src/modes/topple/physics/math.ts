/**
 * Allocation-free 3D maths for the Topple solver.
 *
 * Everything here operates on primitives or on pre-allocated `Float64Array`s.
 * Nothing in this file — or anything it is called from — may allocate during a
 * physics step: a stacking solver runs 120 times a second and the GC pauses it
 * would otherwise cause are exactly what makes a tall stack visibly hitch.
 *
 * Matrices are 9-element row-major `Float64Array`s. Column `j` of a rotation
 * matrix is the body's local axis `j` expressed in world space, i.e.
 * `axis_j = (m[j], m[3 + j], m[6 + j])`.
 */

/** A 3x3 matrix, row-major. */
export type Mat3 = Float64Array;

export const mat3 = (): Mat3 => {
  const m = new Float64Array(9);
  m[0] = 1;
  m[4] = 1;
  m[8] = 1;
  return m;
};

/** Write the rotation matrix of a unit quaternion into `out`. */
export function quatToMat3(x: number, y: number, z: number, w: number, out: Mat3): void {
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  out[0] = 1 - 2 * (yy + zz);
  out[1] = 2 * (xy - wz);
  out[2] = 2 * (xz + wy);
  out[3] = 2 * (xy + wz);
  out[4] = 1 - 2 * (xx + zz);
  out[5] = 2 * (yz - wx);
  out[6] = 2 * (xz - wy);
  out[7] = 2 * (yz + wx);
  out[8] = 1 - 2 * (xx + yy);
}

/**
 * World-space inverse inertia of a body whose body-space inverse inertia is the
 * diagonal `(ix, iy, iz)`: `Iinv = R * diag * Rᵀ`. Symmetric, so only six of the
 * nine entries are actually computed.
 */
export function inertiaWorld(r: Mat3, ix: number, iy: number, iz: number, out: Mat3): void {
  const a0 = r[0];
  const a1 = r[1];
  const a2 = r[2];
  const b0 = r[3];
  const b1 = r[4];
  const b2 = r[5];
  const c0 = r[6];
  const c1 = r[7];
  const c2 = r[8];
  const m00 = a0 * a0 * ix + a1 * a1 * iy + a2 * a2 * iz;
  const m01 = a0 * b0 * ix + a1 * b1 * iy + a2 * b2 * iz;
  const m02 = a0 * c0 * ix + a1 * c1 * iy + a2 * c2 * iz;
  const m11 = b0 * b0 * ix + b1 * b1 * iy + b2 * b2 * iz;
  const m12 = b0 * c0 * ix + b1 * c1 * iy + b2 * c2 * iz;
  const m22 = c0 * c0 * ix + c1 * c1 * iy + c2 * c2 * iz;
  out[0] = m00;
  out[1] = m01;
  out[2] = m02;
  out[3] = m01;
  out[4] = m11;
  out[5] = m12;
  out[6] = m02;
  out[7] = m12;
  out[8] = m22;
}

/** Quadratic form `vᵀ M v` for a symmetric matrix — the angular part of an effective mass. */
export function quadForm(m: Mat3, x: number, y: number, z: number): number {
  const px = m[0] * x + m[1] * y + m[2] * z;
  const py = m[3] * x + m[4] * y + m[5] * z;
  const pz = m[6] * x + m[7] * y + m[8] * z;
  return px * x + py * y + pz * z;
}

/**
 * Deterministic perpendicular basis for a unit normal. Continuity matters:
 * friction impulses are warm-started across steps, so the tangent frame of a
 * resting contact must not flip about from one step to the next.
 */
export function tangentBasis(nx: number, ny: number, nz: number, out: Float64Array): void {
  let t1x: number;
  let t1y: number;
  let t1z: number;
  if (nx > 0.57735 || nx < -0.57735) {
    const inv = 1 / Math.sqrt(nx * nx + ny * ny);
    t1x = ny * inv;
    t1y = -nx * inv;
    t1z = 0;
  } else {
    const inv = 1 / Math.sqrt(ny * ny + nz * nz);
    t1x = 0;
    t1y = nz * inv;
    t1z = -ny * inv;
  }
  out[0] = t1x;
  out[1] = t1y;
  out[2] = t1z;
  out[3] = ny * t1z - nz * t1y;
  out[4] = nz * t1x - nx * t1z;
  out[5] = nx * t1y - ny * t1x;
}

/** Normalise a quaternion in place inside a 4-element scratch array. */
export function normalizeQuat(q: Float64Array): void {
  const d = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  if (d > 1e-9) {
    const inv = 1 / d;
    q[0] *= inv;
    q[1] *= inv;
    q[2] *= inv;
    q[3] *= inv;
  } else {
    q[0] = 0;
    q[1] = 0;
    q[2] = 0;
    q[3] = 1;
  }
}

export const clampNum = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;
