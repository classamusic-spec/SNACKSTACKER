/**
 * Oriented-box collision: 15-axis SAT, reference-face clipping, persistent
 * manifolds.
 *
 * Stable stacking lives or dies here, not in the solver. Three things matter:
 *
 *  1. **Face contacts must win over edge contacts.** A box resting flat on
 *     another box has nine edge-cross axes whose separation is numerically
 *     within a rounding error of the true face axis. Picking one of those
 *     produces a single wobbling contact point instead of four corners, and the
 *     stack shivers. Edge axes therefore have to beat the best face axis by a
 *     real margin before they are used.
 *  2. **The manifold must persist.** Contact points are matched to the previous
 *     step's points by their position in body A's local frame, so accumulated
 *     normal and friction impulses survive. Warm starting is what lets ten
 *     iterations hold a twenty-box tower that a hundred cold iterations cannot.
 *  3. **Four spread points, not eight deep ones.** Clipping a quad against a
 *     quad yields up to eight points; keeping the four that span the largest
 *     area keeps the contact patch honest, which is what stops a resting box
 *     from slowly rocking.
 */
import { Body } from './body';

/** Points closer than this (in A's local frame) are the same feature. */
const MATCH_RADIUS_SQ = 0.06 * 0.06;
/** Keep slightly-separated points as speculative contacts; they never pull. */
const KEEP_DEPTH = -0.02;

export class ContactPoint {
  /** World contact position, midway between the two surfaces. */
  cx = 0;
  cy = 0;
  cz = 0;
  /** Offset from each body's centre of mass, world space. */
  rax = 0;
  ray = 0;
  raz = 0;
  rbx = 0;
  rby = 0;
  rbz = 0;
  /** Contact position in A's local frame — the warm-start identity. */
  lax = 0;
  lay = 0;
  laz = 0;
  depth = 0;
  nMass = 0;
  t1Mass = 0;
  t2Mass = 0;
  /** Accumulated impulses, carried across steps. */
  nImp = 0;
  t1Imp = 0;
  t2Imp = 0;
  /** Accumulated pseudo-impulse for the split-impulse position pass. */
  pnImp = 0;
  /** Restitution target velocity. */
  bias = 0;
}

export class Manifold {
  a: Body | null = null;
  b: Body | null = null;
  key = 0;
  stamp = -1;
  /** Unit normal, pointing from A towards B. */
  nx = 0;
  ny = 1;
  nz = 0;
  t1x = 1;
  t1y = 0;
  t1z = 0;
  t2x = 0;
  t2y = 0;
  t2z = 1;
  count = 0;
  friction = 0.6;
  restitution = 0;
  /** Sum of normal impulse applied last step — drives impact SFX and dust. */
  impulse = 0;
  readonly points: ContactPoint[] = [
    new ContactPoint(),
    new ContactPoint(),
    new ContactPoint(),
    new ContactPoint(),
  ];
}

// --- scratch -----------------------------------------------------------------
// Module-level so a step allocates nothing. Single-threaded by construction.

const CLIP_A = new Float64Array(30);
const CLIP_B = new Float64Array(30);
const OUT_P = new Float64Array(24);
const OUT_D = new Float64Array(8);
const OUT_U = new Float64Array(8);
const OUT_V = new Float64Array(8);
const PICK = new Int32Array(4);
const OLD = new Float64Array(4 * 6);
const AH = new Float64Array(3);
const BH = new Float64Array(3);

/** Column `i` of a rotation matrix — body axis `i` in world space. */
const ax = (b: Body, i: number): number => b.rot[i];
const ay = (b: Body, i: number): number => b.rot[3 + i];
const az = (b: Body, i: number): number => b.rot[6 + i];

/**
 * Projection radius of a box onto a world axis: how far the box extends either
 * side of its centre along that direction.
 */
function radius(b: Body, h: Float64Array, nx: number, ny: number, nz: number): number {
  let r = 0;
  for (let i = 0; i < 3; i++) {
    r += h[i] * Math.abs(nx * b.rot[i] + ny * b.rot[3 + i] + nz * b.rot[6 + i]);
  }
  return r;
}

/**
 * Sutherland–Hodgman clip of a 3D polygon against one half-space
 * `dot(p, n) <= off`. Returns the new vertex count.
 */
function clipPlane(
  src: Float64Array,
  count: number,
  dst: Float64Array,
  nx: number,
  ny: number,
  nz: number,
  off: number,
): number {
  let out = 0;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const ix = src[i * 3];
    const iy = src[i * 3 + 1];
    const iz = src[i * 3 + 2];
    const jx = src[j * 3];
    const jy = src[j * 3 + 1];
    const jz = src[j * 3 + 2];
    const di = ix * nx + iy * ny + iz * nz - off;
    const dj = jx * nx + jy * ny + jz * nz - off;
    if (di <= 0) {
      if (out < 10) {
        dst[out * 3] = ix;
        dst[out * 3 + 1] = iy;
        dst[out * 3 + 2] = iz;
        out++;
      }
    }
    if (di * dj < 0) {
      const t = di / (di - dj);
      if (out < 10) {
        dst[out * 3] = ix + (jx - ix) * t;
        dst[out * 3 + 1] = iy + (jy - iy) * t;
        dst[out * 3 + 2] = iz + (jz - iz) * t;
        out++;
      }
    }
  }
  return out;
}

/**
 * Choose up to four points spanning the largest area, working in the reference
 * face's 2D tangent coordinates. Deepest point first so the manifold always
 * contains the most urgent constraint.
 */
function reduceToFour(n: number): number {
  if (n <= 4) {
    for (let i = 0; i < n; i++) PICK[i] = i;
    return n;
  }
  let i0 = 0;
  for (let i = 1; i < n; i++) if (OUT_D[i] > OUT_D[i0]) i0 = i;
  let i1 = -1;
  let best = -1;
  for (let i = 0; i < n; i++) {
    if (i === i0) continue;
    const du = OUT_U[i] - OUT_U[i0];
    const dv = OUT_V[i] - OUT_V[i0];
    const d = du * du + dv * dv;
    if (d > best) {
      best = d;
      i1 = i;
    }
  }
  const bu = OUT_U[i1] - OUT_U[i0];
  const bv = OUT_V[i1] - OUT_V[i0];
  let i2 = -1;
  let i3 = -1;
  let bestPos = 1e-9;
  let bestNeg = -1e-9;
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1) continue;
    const cross = bu * (OUT_V[i] - OUT_V[i0]) - bv * (OUT_U[i] - OUT_U[i0]);
    if (cross > bestPos) {
      bestPos = cross;
      i2 = i;
    } else if (cross < bestNeg) {
      bestNeg = cross;
      i3 = i;
    }
  }
  let c = 0;
  PICK[c++] = i0;
  PICK[c++] = i1;
  if (i2 >= 0) PICK[c++] = i2;
  if (i3 >= 0 && c < 4) PICK[c++] = i3;
  if (c < 4) {
    for (let i = 0; i < n && c < 4; i++) {
      if (i !== i0 && i !== i1 && i !== i2 && i !== i3) PICK[c++] = i;
    }
  }
  return c;
}

/**
 * Narrowphase for two oriented boxes. Fills `out` and returns true on contact.
 * Accumulated impulses on matching points are preserved for warm starting.
 */
export function collideBoxes(a: Body, b: Body, out: Manifold): boolean {
  AH[0] = a.hx;
  AH[1] = a.hy;
  AH[2] = a.hz;
  BH[0] = b.hx;
  BH[1] = b.hy;
  BH[2] = b.hz;

  const tx = b.px - a.px;
  const ty = b.py - a.py;
  const tz = b.pz - a.pz;

  let faceSep = -Infinity;
  let faceAxis = -1;
  let faceOwnerB = false;

  for (let i = 0; i < 3; i++) {
    const nx = ax(a, i);
    const ny = ay(a, i);
    const nz = az(a, i);
    const s = Math.abs(tx * nx + ty * ny + tz * nz) - (AH[i] + radius(b, BH, nx, ny, nz));
    if (s > 0) return false;
    if (s > faceSep) {
      faceSep = s;
      faceAxis = i;
      faceOwnerB = false;
    }
  }
  for (let i = 0; i < 3; i++) {
    const nx = ax(b, i);
    const ny = ay(b, i);
    const nz = az(b, i);
    const s = Math.abs(tx * nx + ty * ny + tz * nz) - (radius(a, AH, nx, ny, nz) + BH[i]);
    if (s > 0) return false;
    if (s > faceSep) {
      faceSep = s;
      faceAxis = i;
      faceOwnerB = true;
    }
  }

  let edgeSep = -Infinity;
  let edgeI = -1;
  let edgeJ = -1;
  let enx = 0;
  let eny = 0;
  let enz = 0;
  for (let i = 0; i < 3; i++) {
    const aix = ax(a, i);
    const aiy = ay(a, i);
    const aiz = az(a, i);
    for (let j = 0; j < 3; j++) {
      const bjx = ax(b, j);
      const bjy = ay(b, j);
      const bjz = az(b, j);
      let nx = aiy * bjz - aiz * bjy;
      let ny = aiz * bjx - aix * bjz;
      let nz = aix * bjy - aiy * bjx;
      const l2 = nx * nx + ny * ny + nz * nz;
      // Near-parallel axes are already covered by the face tests, and their
      // normalised cross product is numerical noise.
      if (l2 < 1e-6) continue;
      const inv = 1 / Math.sqrt(l2);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const s =
        Math.abs(tx * nx + ty * ny + tz * nz) -
        (radius(a, AH, nx, ny, nz) + radius(b, BH, nx, ny, nz));
      if (s > 0) return false;
      if (s > edgeSep) {
        edgeSep = s;
        edgeI = i;
        edgeJ = j;
        enx = nx;
        eny = ny;
        enz = nz;
      }
    }
  }

  // Face preference: an edge axis has to be meaningfully shallower to be used.
  const faceBias = 0.004 + 0.03 * Math.abs(faceSep);
  const useEdge = edgeI >= 0 && edgeSep > faceSep + faceBias;

  out.a = a;
  out.b = b;
  out.friction = Math.sqrt(a.friction * b.friction);
  out.restitution = a.restitution > b.restitution ? a.restitution : b.restitution;

  // Stash the previous step's contacts before they are overwritten.
  const oldCount = out.count;
  for (let i = 0; i < oldCount; i++) {
    const p = out.points[i];
    OLD[i * 6] = p.lax;
    OLD[i * 6 + 1] = p.lay;
    OLD[i * 6 + 2] = p.laz;
    OLD[i * 6 + 3] = p.nImp;
    OLD[i * 6 + 4] = p.t1Imp;
    OLD[i * 6 + 5] = p.t2Imp;
  }

  let newCount: number;
  if (useEdge) {
    newCount = buildEdgeContact(a, b, edgeI, edgeJ, enx, eny, enz, edgeSep, tx, ty, tz, out);
  } else {
    newCount = buildFaceContact(a, b, faceAxis, faceOwnerB, tx, ty, tz, out);
  }
  if (newCount === 0) return false;
  out.count = newCount;

  // Warm start: match by local position, otherwise start this point cold.
  for (let i = 0; i < newCount; i++) {
    const p = out.points[i];
    const dx = p.cx - a.px;
    const dy = p.cy - a.py;
    const dz = p.cz - a.pz;
    p.lax = dx * a.rot[0] + dy * a.rot[3] + dz * a.rot[6];
    p.lay = dx * a.rot[1] + dy * a.rot[4] + dz * a.rot[7];
    p.laz = dx * a.rot[2] + dy * a.rot[5] + dz * a.rot[8];
    let nImp = 0;
    let t1Imp = 0;
    let t2Imp = 0;
    let bestSq = MATCH_RADIUS_SQ;
    for (let k = 0; k < oldCount; k++) {
      const ex = OLD[k * 6] - p.lax;
      const ey = OLD[k * 6 + 1] - p.lay;
      const ez = OLD[k * 6 + 2] - p.laz;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 < bestSq) {
        bestSq = d2;
        nImp = OLD[k * 6 + 3];
        t1Imp = OLD[k * 6 + 4];
        t2Imp = OLD[k * 6 + 5];
      }
    }
    p.nImp = nImp;
    p.t1Imp = t1Imp;
    p.t2Imp = t2Imp;
    p.pnImp = 0;
  }
  return true;
}

function buildFaceContact(
  a: Body,
  b: Body,
  fi: number,
  ownerB: boolean,
  tx: number,
  ty: number,
  tz: number,
  out: Manifold,
): number {
  const ref = ownerB ? b : a;
  const inc = ownerB ? a : b;
  const refH = ownerB ? BH : AH;
  const incH = ownerB ? AH : BH;
  // Vector from the reference body to the incident body.
  const rtx = ownerB ? -tx : tx;
  const rty = ownerB ? -ty : ty;
  const rtz = ownerB ? -tz : tz;

  let nx = ax(ref, fi);
  let ny = ay(ref, fi);
  let nz = az(ref, fi);
  if (nx * rtx + ny * rty + nz * rtz < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }

  const fcx = ref.px + nx * refH[fi];
  const fcy = ref.py + ny * refH[fi];
  const fcz = ref.pz + nz * refH[fi];

  const tu = (fi + 1) % 3;
  const tv = (fi + 2) % 3;
  const ux = ax(ref, tu);
  const uy = ay(ref, tu);
  const uz = az(ref, tu);
  const vx = ax(ref, tv);
  const vy = ay(ref, tv);
  const vz = az(ref, tv);
  const hu = refH[tu];
  const hv = refH[tv];

  // Incident face: the face of `inc` whose outward normal opposes n most.
  let ik = 0;
  let isign = 1;
  let bestDot = Infinity;
  for (let k = 0; k < 3; k++) {
    const d = nx * ax(inc, k) + ny * ay(inc, k) + nz * az(inc, k);
    if (d < bestDot) {
      bestDot = d;
      ik = k;
      isign = 1;
    }
    if (-d < bestDot) {
      bestDot = -d;
      ik = k;
      isign = -1;
    }
  }
  const icx = inc.px + ax(inc, ik) * isign * incH[ik];
  const icy = inc.py + ay(inc, ik) * isign * incH[ik];
  const icz = inc.pz + az(inc, ik) * isign * incH[ik];
  const ku = (ik + 1) % 3;
  const kv = (ik + 2) % 3;
  const iux = ax(inc, ku) * incH[ku];
  const iuy = ay(inc, ku) * incH[ku];
  const iuz = az(inc, ku) * incH[ku];
  const ivx = ax(inc, kv) * incH[kv];
  const ivy = ay(inc, kv) * incH[kv];
  const ivz = az(inc, kv) * incH[kv];

  CLIP_A[0] = icx + iux + ivx;
  CLIP_A[1] = icy + iuy + ivy;
  CLIP_A[2] = icz + iuz + ivz;
  CLIP_A[3] = icx + iux - ivx;
  CLIP_A[4] = icy + iuy - ivy;
  CLIP_A[5] = icz + iuz - ivz;
  CLIP_A[6] = icx - iux - ivx;
  CLIP_A[7] = icy - iuy - ivy;
  CLIP_A[8] = icz - iuz - ivz;
  CLIP_A[9] = icx - iux + ivx;
  CLIP_A[10] = icy - iuy + ivy;
  CLIP_A[11] = icz - iuz + ivz;

  const cu = fcx * ux + fcy * uy + fcz * uz;
  const cv = fcx * vx + fcy * vy + fcz * vz;

  // Widen the clip window by a hair. Two identically sized slabs stacked dead
  // square — the single most common configuration in this game — put the
  // incident corners exactly ON the clip planes, where a rounding error of
  // 1e-16 silently deletes a corner and turns a four-point manifold into a
  // three-point one that rocks.
  const eps = 1e-7 * (1 + Math.abs(cu) + Math.abs(cv));
  let n1 = clipPlane(CLIP_A, 4, CLIP_B, ux, uy, uz, cu + hu + eps);
  if (n1 === 0) return 0;
  let n2 = clipPlane(CLIP_B, n1, CLIP_A, -ux, -uy, -uz, -(cu - hu) + eps);
  if (n2 === 0) return 0;
  n1 = clipPlane(CLIP_A, n2, CLIP_B, vx, vy, vz, cv + hv + eps);
  if (n1 === 0) return 0;
  n2 = clipPlane(CLIP_B, n1, CLIP_A, -vx, -vy, -vz, -(cv - hv) + eps);
  if (n2 === 0) return 0;

  let kept = 0;
  for (let i = 0; i < n2 && kept < 8; i++) {
    const px = CLIP_A[i * 3];
    const py = CLIP_A[i * 3 + 1];
    const pz = CLIP_A[i * 3 + 2];
    const sep = (px - fcx) * nx + (py - fcy) * ny + (pz - fcz) * nz;
    const depth = -sep;
    if (depth < KEEP_DEPTH) continue;
    OUT_P[kept * 3] = px + nx * depth * 0.5;
    OUT_P[kept * 3 + 1] = py + ny * depth * 0.5;
    OUT_P[kept * 3 + 2] = pz + nz * depth * 0.5;
    OUT_D[kept] = depth;
    OUT_U[kept] = px * ux + py * uy + pz * uz;
    OUT_V[kept] = px * vx + py * vy + pz * vz;
    kept++;
  }
  if (kept === 0) return 0;
  const take = reduceToFour(kept);

  // The manifold normal is defined A -> B, so flip when B was the reference.
  const mnx = ownerB ? -nx : nx;
  const mny = ownerB ? -ny : ny;
  const mnz = ownerB ? -nz : nz;
  out.nx = mnx;
  out.ny = mny;
  out.nz = mnz;

  for (let i = 0; i < take; i++) {
    const src = PICK[i];
    const p = out.points[i];
    p.cx = OUT_P[src * 3];
    p.cy = OUT_P[src * 3 + 1];
    p.cz = OUT_P[src * 3 + 2];
    p.depth = OUT_D[src];
  }
  return take;
}

function buildEdgeContact(
  a: Body,
  b: Body,
  ei: number,
  ej: number,
  nx: number,
  ny: number,
  nz: number,
  sep: number,
  tx: number,
  ty: number,
  tz: number,
  out: Manifold,
): number {
  // Orient the axis from A towards B.
  let sx = nx;
  let sy = ny;
  let sz = nz;
  if (sx * tx + sy * ty + sz * tz < 0) {
    sx = -sx;
    sy = -sy;
    sz = -sz;
  }

  // Support edge on A along +normal, leaving the edge's own axis free.
  let pax = a.px;
  let pay = a.py;
  let paz = a.pz;
  for (let k = 0; k < 3; k++) {
    if (k === ei) continue;
    const kx = ax(a, k);
    const ky = ay(a, k);
    const kz = az(a, k);
    const s = kx * sx + ky * sy + kz * sz >= 0 ? AH[k] : -AH[k];
    pax += kx * s;
    pay += ky * s;
    paz += kz * s;
  }
  let pbx = b.px;
  let pby = b.py;
  let pbz = b.pz;
  for (let k = 0; k < 3; k++) {
    if (k === ej) continue;
    const kx = ax(b, k);
    const ky = ay(b, k);
    const kz = az(b, k);
    const s = kx * sx + ky * sy + kz * sz >= 0 ? -BH[k] : BH[k];
    pbx += kx * s;
    pby += ky * s;
    pbz += kz * s;
  }

  const dax = ax(a, ei);
  const day = ay(a, ei);
  const daz = az(a, ei);
  const dbx = ax(b, ej);
  const dby = ay(b, ej);
  const dbz = az(b, ej);

  const rx = pax - pbx;
  const ry = pay - pby;
  const rz = paz - pbz;
  const aa = 1;
  const bb = dax * dbx + day * dby + daz * dbz;
  const cc = 1;
  const d = dax * rx + day * ry + daz * rz;
  const e = dbx * rx + dby * ry + dbz * rz;
  const den = aa * cc - bb * bb;
  let s = 0;
  let t = 0;
  if (Math.abs(den) > 1e-8) {
    s = (bb * e - cc * d) / den;
    t = (aa * e - bb * d) / den;
  }
  s = s < -AH[ei] ? -AH[ei] : s > AH[ei] ? AH[ei] : s;
  t = t < -BH[ej] ? -BH[ej] : t > BH[ej] ? BH[ej] : t;

  const cax = pax + dax * s;
  const cay = pay + day * s;
  const caz = paz + daz * s;
  const cbx = pbx + dbx * t;
  const cby = pby + dby * t;
  const cbz = pbz + dbz * t;

  out.nx = sx;
  out.ny = sy;
  out.nz = sz;
  const p = out.points[0];
  p.cx = (cax + cbx) * 0.5;
  p.cy = (cay + cby) * 0.5;
  p.cz = (caz + cbz) * 0.5;
  p.depth = -sep;
  return 1;
}
