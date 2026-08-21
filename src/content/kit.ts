/**
 * Procedural geometry toolkit for building food.
 *
 * Every helper returns geometry whose footprint is centred on X/Z and whose
 * vertical extent starts at y = 0, matching the FoodDef contract. Foods are
 * rebuilt at their exact cut size rather than boolean-sliced, so everything
 * here must be parametric in width/depth.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import { TAU, clamp, clamp01, lerp } from '../core/math';
import { BASE_FOOTPRINT } from '../core/world';

// ---------------------------------------------------------------------------
// noise
// ---------------------------------------------------------------------------

const PERM = new Uint8Array(512);
{
  const rng = new Rng(1337);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = rng.int(0, i + 1);
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const grad2 = (h: number, x: number, y: number) => {
  const u = (h & 1) === 0 ? x : -x;
  const v = (h & 2) === 0 ? y : -y;
  return u + v;
};

/** 2D value/perlin-ish noise in [-1, 1]. Deterministic. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);
  const aa = PERM[PERM[xi] + yi];
  const ab = PERM[PERM[xi] + yi + 1];
  const ba = PERM[PERM[xi + 1] + yi];
  const bb = PERM[PERM[xi + 1] + yi + 1];
  const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
  const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
  return clamp(lerp(x1, x2, v), -1, 1);
}

/** Fractal noise, 3 octaves. */
export function fbm2(x: number, y: number, octaves = 3): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// cut faces
// ---------------------------------------------------------------------------

/**
 * How rectangular a footprint should read, 0 (untouched) to 1 (heavily cut).
 *
 * A whole pancake is a disc. A pancake the player sliced is a disc with a flat
 * chord where the knife went — and after a few slices, a rectangle. Since the
 * tower tracks an axis-aligned width x depth, the honest silhouette for a cut
 * layer is a rounded rectangle, and stretching the original ellipse instead is
 * what makes a cut layer read as a squashed blob rather than a cross-section.
 */
export function squareness(width: number, depth: number): number {
  const smaller = Math.min(width, depth);
  const larger = Math.max(width, depth);
  // Cut away from the base footprint at all -> some flat faces.
  const shrunk = clamp01(1 - smaller / BASE_FOOTPRINT);
  // Non-square -> definitely cut on one axis.
  const stretched = larger > 1e-5 ? clamp01(1 - smaller / larger) : 0;
  return clamp01(Math.max(shrunk, stretched) * 1.25);
}

/**
 * Radius multiplier that morphs a unit circle into a superellipse.
 * `square` 0 leaves a circle untouched; 1 gives an almost-square with softly
 * rounded corners.
 */
export function superRadius(angle: number, square: number): number {
  if (square <= 1e-4) return 1;
  const n = 2 + clamp01(square) * 6;
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const sum = Math.pow(c, n) + Math.pow(s, n);
  return sum > 1e-9 ? Math.pow(sum, -1 / n) : 1;
}

// ---------------------------------------------------------------------------
// core shapes
// ---------------------------------------------------------------------------

/**
 * Rounded box — the workhorse. `radius` is clamped so it can never exceed half
 * the smallest dimension, which matters because layers get cut very thin.
 */
export function roundedBox(
  width: number,
  height: number,
  depth: number,
  radius: number,
  segments = 3,
): THREE.BufferGeometry {
  const r = clamp(radius, 0.0001, Math.min(width, height, depth) / 2 - 0.0005);
  const geo = new THREE.BoxGeometry(width, height, depth, 1, 1, 1);
  // Three has no rounded box primitive; build one from an extruded rounded
  // rectangle plus a bevel, which gives clean quads and correct normals.
  geo.dispose();

  const w = width / 2 - r;
  const d = depth / 2 - r;
  const shape = new THREE.Shape();
  shape.moveTo(-w, -depth / 2);
  shape.lineTo(w, -depth / 2);
  shape.quadraticCurveTo(width / 2, -depth / 2, width / 2, -d);
  shape.lineTo(width / 2, d);
  shape.quadraticCurveTo(width / 2, depth / 2, w, depth / 2);
  shape.lineTo(-w, depth / 2);
  shape.quadraticCurveTo(-width / 2, depth / 2, -width / 2, d);
  shape.lineTo(-width / 2, -d);
  shape.quadraticCurveTo(-width / 2, -depth / 2, -w, -depth / 2);

  const bevel = Math.min(r, height / 2.2);
  const out = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(height - bevel * 2, 0.001),
    bevelEnabled: bevel > 0.002,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: Math.max(1, segments),
    curveSegments: Math.max(2, segments + 1),
  });
  out.rotateX(-Math.PI / 2);
  out.translate(0, bevel, 0);
  out.computeVertexNormals();
  return out;
}

/**
 * An organic disc/puck: pancake, patty, macaron shell. `wobble` perturbs the
 * rim so it never reads as a CAD cylinder. Fills the width/depth footprint as
 * an ellipse.
 */
export function puck(
  width: number,
  height: number,
  depth: number,
  opts: {
    wobble?: number;
    domed?: number;
    radial?: number;
    rings?: number;
    seed?: number;
    /** Pinch the top face inwards, e.g. a bun crown. */
    taper?: number;
    /** Override the auto-detected cut squareness, 0 (round) to 1 (rectangle). */
    square?: number;
  } = {},
): THREE.BufferGeometry {
  const {
    wobble = 0.05,
    domed = 0.25,
    radial = 40,
    rings = 6,
    seed = 1,
    taper = 0,
  } = opts;

  const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, radial, rings, false);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  // A cut puck must show flat faces, not stretch into an ellipse.
  const square = opts.square ?? squareness(width, depth);

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const yNorm = clamp01(v.y + 0.5); // 0 bottom, 1 top
    const angle = Math.atan2(v.z, v.x);
    const radius = Math.hypot(v.x, v.z);

    if (radius > 1e-4) {
      const n = fbm2(
        Math.cos(angle) * 2.4 + seed * 7.7,
        Math.sin(angle) * 2.4 + seed * 3.1,
        2,
      );
      let scale = (1 + n * wobble * (1 - square * 0.7)) * superRadius(angle, square);
      // taper the top so the silhouette reads as baked, not machined
      scale *= 1 - taper * yNorm * yNorm;
      // soften the bottom edge slightly — food sits, it doesn't clip
      scale *= 1 - 0.06 * Math.pow(1 - yNorm, 6);
      v.x *= scale;
      v.z *= scale;
    }

    // dome the top face
    if (domed > 0 && yNorm > 0.5) {
      const t = (yNorm - 0.5) * 2;
      const rr = clamp01(radius / 0.5);
      v.y += domed * t * (1 - rr * rr) * 0.5;
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  geo.scale(width, height, depth);
  geo.translate(0, height / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A thin slab whose edges droop — melted cheese, a folded slice of ham. The
 * droop is what sells "soft" at a glance.
 */
export function droopSlab(
  width: number,
  height: number,
  depth: number,
  opts: { droop?: number; segments?: number; seed?: number; ripple?: number } = {},
): THREE.BufferGeometry {
  const { droop = 0.35, segments = 14, seed = 3, ripple = 0.25 } = opts;
  const geo = new THREE.BoxGeometry(width, height, depth, segments, 2, segments);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const hw = width / 2;
  const hd = depth / 2;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ex = Math.abs(v.x) / hw;
    const ez = Math.abs(v.z) / hd;
    const edge = Math.max(ex, ez);
    const fall = Math.pow(clamp01((edge - 0.62) / 0.38), 2);
    v.y -= fall * droop * height * 3.2;
    const n = fbm2(v.x * 3.1 + seed, v.z * 3.1 - seed, 2);
    v.y += n * ripple * height * 0.5;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.translate(0, height / 2 + droop * height * 1.4, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A ruffled leaf band — lettuce, basil, seaweed salad. Sits as a ring around
 * the footprint edge so the layer below still reads.
 */
export function ruffle(
  width: number,
  height: number,
  depth: number,
  opts: {
    folds?: number;
    amplitude?: number;
    seed?: number;
    segments?: number;
    square?: number;
  } = {},
): THREE.BufferGeometry {
  const { folds = 9, amplitude = 0.45, seed = 5, segments = 96 } = opts;
  const square = opts.square ?? squareness(width, depth);
  const geo = new THREE.CylinderGeometry(0.5, 0.52, 1, segments, 4, true);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const yNorm = clamp01(v.y + 0.5);
    const angle = Math.atan2(v.z, v.x);
    const wave =
      Math.sin(angle * folds + seed) * 0.5 +
      Math.sin(angle * (folds * 2.3) + seed * 2) * 0.24 +
      fbm2(Math.cos(angle) * 3 + seed, Math.sin(angle) * 3, 2) * 0.3;
    const scale =
      (1 + wave * amplitude * (0.35 + yNorm * 0.9)) * superRadius(angle, square);
    v.x *= scale;
    v.z *= scale;
    v.y += wave * 0.16;
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  geo.scale(width, height, depth);
  geo.translate(0, height / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A viscous pour — syrup, queso, sauce — that pools on top and drips over the
 * rim in a few places.
 */
export function pour(
  width: number,
  height: number,
  depth: number,
  opts: {
    drips?: number;
    dripLength?: number;
    seed?: number;
    radial?: number;
    square?: number;
  } = {},
): THREE.BufferGeometry {
  const { drips = 5, dripLength = 2.6, seed = 11, radial = 56 } = opts;
  const square = opts.square ?? squareness(width, depth);
  const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, radial, 10, false);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const rng = new Rng(seed * 977);
  const dripAngles: number[] = [];
  const dripWidth: number[] = [];
  for (let i = 0; i < drips; i++) {
    dripAngles.push(rng.range(0, TAU));
    dripWidth.push(rng.range(0.16, 0.4));
  }

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const yNorm = clamp01(v.y + 0.5);
    const angle = Math.atan2(v.z, v.x);
    const radius = Math.hypot(v.x, v.z);

    // pooled, slightly convex top
    if (yNorm > 0.85) {
      const rr = clamp01(radius / 0.5);
      v.y += (1 - rr * rr) * 0.16;
    }

    // drips hanging off the rim
    if (yNorm < 0.55 && radius > 0.3) {
      let drop = 0;
      for (let d = 0; d < dripAngles.length; d++) {
        let delta = Math.abs(((angle - dripAngles[d] + Math.PI * 3) % TAU) - Math.PI);
        const w = dripWidth[d];
        if (delta < w) {
          const t = 1 - delta / w;
          drop = Math.max(drop, Math.pow(t, 1.7));
        }
      }
      v.y -= drop * dripLength * (1 - yNorm);
      const bulge = 1 + drop * 0.06;
      v.x *= bulge;
      v.z *= bulge;
    }
    if (radius > 1e-4) {
      const sr = superRadius(angle, square);
      v.x *= sr;
      v.z *= sr;
    }
    const n = fbm2(v.x * 4 + seed, v.z * 4, 2);
    v.y += n * 0.02;
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  geo.scale(width, height, depth);
  geo.translate(0, height / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

/** Half-pipe / folded shell (taco, wrap, folded omelette). */
export function foldedShell(
  width: number,
  height: number,
  depth: number,
  opts: { openness?: number; segments?: number; thickness?: number } = {},
): THREE.BufferGeometry {
  const { openness = 0.55, segments = 28, thickness = 0.09 } = opts;
  const pts: THREE.Vector2[] = [];
  const arc = Math.PI * (0.55 + openness * 0.45);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = Math.PI / 2 + (t - 0.5) * arc;
    pts.push(new THREE.Vector2(Math.cos(a) * 0.5, Math.sin(a) * 0.5));
  }
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x, pts[0].y);
  for (const p of pts) shape.lineTo(p.x, p.y);
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    const len = Math.hypot(p.x, p.y) || 1;
    shape.lineTo(p.x * (1 - thickness / len), p.y * (1 - thickness / len));
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
    curveSegments: 3,
  });
  geo.rotateY(Math.PI / 2);
  geo.center();
  geo.scale(width, height * 2, depth);
  const box = new THREE.Box3().setFromBufferAttribute(
    geo.attributes.position as THREE.BufferAttribute,
  );
  geo.translate(0, -box.min.y, 0);
  geo.computeVertexNormals();
  return geo;
}

/** A tapered wedge — cheese wedge, cake slice, nigiri rice bed. */
export function pillow(
  width: number,
  height: number,
  depth: number,
  opts: { round?: number; segments?: number; squash?: number } = {},
): THREE.BufferGeometry {
  const { segments = 18, squash = 0.35 } = opts;
  // A cut pillow reads as a block with soft corners, not a stretched egg.
  const round = (opts.round ?? 0.55) * (1 - squareness(width, depth) * 0.8);
  const geo = new THREE.SphereGeometry(0.5, segments, Math.max(6, segments >> 1));
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // push toward a box: superellipse blend
    const k = 1 - round;
    const ax = Math.sign(v.x) * Math.pow(Math.abs(v.x * 2), 1 - k * 0.75) * 0.5;
    const az = Math.sign(v.z) * Math.pow(Math.abs(v.z * 2), 1 - k * 0.75) * 0.5;
    v.x = lerp(v.x, ax, 0.85);
    v.z = lerp(v.z, az, 0.85);
    v.y *= 1 - squash * 0.5;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.scale(width / (bb.max.x - bb.min.x), 1, depth / (bb.max.z - bb.min.z));
  geo.computeBoundingBox();
  const bb2 = geo.boundingBox!;
  geo.scale(1, height / (bb2.max.y - bb2.min.y), 1);
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox!.min.y, 0);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// modifiers & composition
// ---------------------------------------------------------------------------

/** Perturb every vertex along its normal — crumb, char, crust. */
export function roughen(
  geo: THREE.BufferGeometry,
  amount: number,
  frequency = 6,
  seed = 0,
): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nrm, i);
    const d =
      fbm2(v.x * frequency + seed, v.z * frequency - seed, 3) * 0.6 +
      fbm2(v.y * frequency * 1.7 + seed * 2, v.x * frequency, 2) * 0.4;
    v.addScaledVector(n, d * amount);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Bake a solid colour into vertex colours so meshes can share one material. */
export function tintGeometry(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color).convertSRGBToLinear();
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * Scatter small props across a footprint — sesame seeds, sprinkles, blueberries,
 * pepperoni. Merged into one geometry so the whole scatter is a single draw.
 */
export function scatter(
  count: number,
  width: number,
  depth: number,
  make: (i: number, rng: Rng) => THREE.BufferGeometry | null,
  opts: {
    seed?: number;
    y?: number;
    margin?: number;
    /** Minimum separation as a fraction of the footprint; 0 disables. */
    spacing?: number;
    randomYaw?: boolean;
    randomTilt?: number;
  } = {},
): THREE.BufferGeometry | null {
  const {
    seed = 7,
    y = 0,
    margin = 0.12,
    spacing = 0,
    randomYaw = true,
    randomTilt = 0,
  } = opts;
  const rng = new Rng(seed * 7919 + 13);
  const parts: THREE.BufferGeometry[] = [];
  const placed: Array<[number, number]> = [];
  const halfW = Math.max(width / 2 - margin, 0.02);
  const halfD = Math.max(depth / 2 - margin, 0.02);
  const minDist = spacing * Math.min(width, depth);

  for (let i = 0; i < count; i++) {
    let x = 0;
    let z = 0;
    let attempts = 0;
    do {
      x = rng.range(-halfW, halfW);
      z = rng.range(-halfD, halfD);
      attempts++;
    } while (
      minDist > 0 &&
      attempts < 12 &&
      placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < minDist)
    );
    placed.push([x, z]);

    const g = make(i, rng);
    if (!g) continue;
    if (randomYaw) g.rotateY(rng.range(0, TAU));
    if (randomTilt > 0) {
      g.rotateX(rng.signed() * randomTilt);
      g.rotateZ(rng.signed() * randomTilt);
    }
    g.translate(x, y, z);
    parts.push(g);
  }
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

/** Merge a list of geometries, disposing the inputs. Returns null if empty. */
export function mergeAll(parts: (THREE.BufferGeometry | null)[]): THREE.BufferGeometry | null {
  const list = parts.filter((p): p is THREE.BufferGeometry => !!p);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const merged = mergeGeometries(list, false);
  for (const p of list) p.dispose();
  return merged ?? list[0];
}

/** Convenience: mesh with shadows configured the way every food layer wants. */
export function mesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  opts: { cast?: boolean; receive?: boolean } = {},
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = opts.cast ?? true;
  m.receiveShadow = opts.receive ?? true;
  return m;
}

/** Vertical extent of an object, used to verify a food fills its slot. */
export function heightOf(obj: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(obj);
  return box.max.y - box.min.y;
}

/** Force an object to occupy exactly y in [0, height] without distorting X/Z. */
export function fitHeight(obj: THREE.Object3D, height: number): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(obj);
  const h = box.max.y - box.min.y;
  if (h > 1e-5) {
    const s = height / h;
    obj.scale.y *= s;
    obj.position.y -= box.min.y * s;
  }
  return obj;
}

export { THREE };
