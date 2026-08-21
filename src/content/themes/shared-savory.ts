/**
 * Shared procedural helpers for the three savory themes:
 * **Classic Diner**, **Breakfast Rush** and **Pizza Piazza**.
 *
 * Only `diner.ts`, `breakfast.ts` and `pizza.ts` import this file.
 *
 * Everything here is parametric in width/depth because a mis-dropped layer is
 * never boolean-sliced — it is rebuilt at the new size. A food may therefore be
 * asked for at 2.4 x 2.4 or at 0.15 x 2.4, so every helper guarantees:
 *
 *   - no radius may exceed half of the smallest dimension it lives in,
 *   - no denominator can be zero (every divisor is floored),
 *   - prop counts collapse to 1 (or 0) instead of going negative,
 *   - prop *size* shrinks with `min(width, depth)` so decoration can never
 *     escape the footprint of a sliver.
 */
import * as THREE from 'three';
import type { FoodBuildCtx } from '../api';
import type { CanvasPainter, MaterialLibrary as MaterialLibraryRef } from '../../render/api';
import { Rng } from '../../core/rng';
import { TAU, clamp, clamp01, lerp } from '../../core/math';
import { fbm2, fitHeight, mergeAll, roughen, roundedBox, squareness, superRadius } from '../kit';

// ===========================================================================
// quality tiers
// ===========================================================================

export type Tier = 'low' | 'medium' | 'high';

/** Offcuts tumble off-screen in under a second — always one tier cheaper. */
export function tierOf(ctx: FoodBuildCtx): Tier {
  if (!ctx.offcut) return ctx.quality;
  return ctx.quality === 'high' ? 'medium' : 'low';
}

/** Pick a per-tier value (segment counts, prop budgets, ...). */
export function pickQ<T>(ctx: FoodBuildCtx, low: T, med: T, high: T): T {
  const t = tierOf(ctx);
  return t === 'low' ? low : t === 'medium' ? med : high;
}

/** True when fine decoration (seeds, char flecks, blisters) is worth paying for. */
export function fineDetail(ctx: FoodBuildCtx): boolean {
  return !ctx.offcut && ctx.quality !== 'low';
}

// ===========================================================================
// safe numbers & counts
// ===========================================================================

const BASE_AREA = 2.4 * 2.4;

export const safe = (v: number, min = 1e-4): number =>
  Number.isFinite(v) && v > min ? v : min;

/** Shortest footprint axis — the one that limits every prop radius. */
export const minDim = (ctx: FoodBuildCtx): number =>
  Math.max(Math.min(safe(ctx.width), safe(ctx.depth)), 1e-3);

/**
 * Decoration that sits *on* a base (sesame seeds, char blisters, flour):
 * scales linearly with footprint area so a sliver never gets a crowd.
 */
export function areaCount(ctx: FoodBuildCtx, base: number, min = 0): number {
  const a = safe(ctx.width) * safe(ctx.depth);
  const n = Math.round(base * (a / BASE_AREA));
  return Math.max(min, Number.isFinite(n) ? n : 0);
}

/**
 * Props that *are* the layer (pickle chips, pepperoni, olives, blueberries):
 * keep a constant fraction of the footprint covered. Because the prop size
 * already shrinks with `minDim`, a 0.15 x 2.4 sliver still reads as "a layer of
 * pickles" instead of one lonely chip — while staying inside the footprint.
 */
export function coverCount(
  width: number,
  depth: number,
  propSize: number,
  coverage: number,
  max: number,
): number {
  const p = safe(propSize, 1e-3);
  const n = Math.round((coverage * safe(width) * safe(depth)) / (p * p));
  return clamp(Number.isFinite(n) ? n : 1, 1, Math.max(1, max));
}

/**
 * How rectangular this layer's cut is, 0..1 — hand it to every kit shape that
 * accepts `square` (and to `ringTorus`). Computed from the TRUE footprint, so a
 * shape built at 0.9x its layer still reads as the same cross-section, and a
 * prop that just happens to be small is never mistaken for a heavy cut.
 */
export const cutSquare = (ctx: FoodBuildCtx): number =>
  squareness(safe(ctx.width), safe(ctx.depth));

/** superRadius re-exported so themes can place decoration on a cut surface. */
export const cutRadius = (angle: number, square: number): number =>
  superRadius(angle, square);

/** Prop diameter: a fraction of the short axis, hard-capped for big footprints. */
export function propSize(ctx: FoodBuildCtx, frac: number, cap: number): number {
  return Math.max(0.012, Math.min(minDim(ctx) * frac, cap));
}

// ===========================================================================
// geometry helpers
// ===========================================================================

function bounds(geo: THREE.BufferGeometry): THREE.Box3 {
  geo.computeBoundingBox();
  return geo.boundingBox ?? new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
}

export function geoHeight(geo: THREE.BufferGeometry): number {
  const bb = bounds(geo);
  return bb.max.y - bb.min.y;
}

/** Translate so the lowest vertex sits at `at` (default y = 0). */
export function groundGeo(geo: THREE.BufferGeometry, at = 0): THREE.BufferGeometry {
  geo.translate(0, at - bounds(geo).min.y, 0);
  return geo;
}

/** Translate so the highest vertex sits at `at` (default y = 0). */
export function ceilGeo(geo: THREE.BufferGeometry, at = 0): THREE.BufferGeometry {
  geo.translate(0, at - bounds(geo).max.y, 0);
  return geo;
}

/** Centre on X/Z without touching Y — used after an off-centre extrusion. */
export function centerXZ(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const bb = bounds(geo);
  geo.translate(-(bb.max.x + bb.min.x) / 2, 0, -(bb.max.z + bb.min.z) / 2);
  return geo;
}

/** Ground the geometry and scale Y so it occupies exactly [0, height]. */
export function fitGeoY(geo: THREE.BufferGeometry, height: number): THREE.BufferGeometry {
  const bb = bounds(geo);
  const h = bb.max.y - bb.min.y;
  geo.translate(0, -bb.min.y, 0);
  if (h > 1e-5) geo.scale(1, safe(height) / h, 1);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Final contract enforcement for every food: centred on X/Z (by construction)
 * and occupying exactly y in [0, ctx.height].
 */
export function finishLayer(ctx: FoodBuildCtx, obj: THREE.Object3D): THREE.Object3D {
  fitHeight(obj, safe(ctx.height, 1e-3));
  return obj;
}

/** Merge a mixed bag safely: three refuses to merge indexed with non-indexed. */
export function mergeSafe(
  parts: (THREE.BufferGeometry | null)[],
): THREE.BufferGeometry | null {
  const list = parts.filter((p): p is THREE.BufferGeometry => !!p);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  const mixed = list.some((g) => g.index === null) && list.some((g) => g.index !== null);
  if (!mixed) return mergeAll(list);
  const flat = list.map((g) => {
    if (!g.index) return g;
    const n = g.toNonIndexed();
    g.dispose();
    return n;
  });
  return mergeAll(flat);
}

/**
 * `roundedBox` from the kit is an ExtrudeGeometry bevel, and three's bevel
 * grows the profile OUTWARD by `bevelSize` — a 0.15-wide box comes back 0.192
 * wide. Height is unaffected. That 28% overshoot is invisible at 2.4 and
 * catastrophic on a sliver, so this wrapper measures the result and rescales
 * X/Z to land exactly on the requested footprint.
 */
export function boxAt(
  width: number,
  height: number,
  depth: number,
  radius: number,
  segments = 3,
): THREE.BufferGeometry {
  const w = safe(width);
  const h = safe(height);
  const d = safe(depth);
  const geo = roundedBox(w, h, d, Math.min(radius, Math.min(w, h, d) * 0.24), segments);
  const bb = bounds(geo);
  const ex = bb.max.x - bb.min.x;
  const ez = bb.max.z - bb.min.z;
  if (ex > 1e-6 && ez > 1e-6) geo.scale(w / ex, 1, d / ez);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A roughen amplitude that is safe at any aspect ratio. Char and crumb are an
 * ABSOLUTE displacement along the normal, so an amount tied only to the layer
 * height would shove a 0.44-thick hash brown a third of the way past a 0.15
 * cut. Clamped against the short footprint axis as well.
 */
export function roughAmt(ctx: FoodBuildCtx, frac: number): number {
  return Math.min(safe(ctx.height) * frac, minDim(ctx) * 0.04);
}

/**
 * An elliptical ring hugging the footprint edge — plate rims, pizza cornicione,
 * olive slices. `tubeFrac` is the tube radius as a fraction of the footprint
 * radius, so the outer edge always lands exactly on width/2 and depth/2 and the
 * ring can never self-intersect (tubeFrac < 0.25 keeps the hole open).
 * Vertical extent is +/- `tubeHeight`, independent of the plan-view thickness,
 * which is what keeps it sane on a 0.15-wide sliver.
 */
export function ringTorus(
  width: number,
  depth: number,
  tubeFrac: number,
  tubeHeight: number,
  radialSeg = 8,
  tubularSeg = 40,
  square = 0,
): THREE.BufferGeometry {
  const tf = clamp(tubeFrac, 0.02, 0.24);
  const th = safe(tubeHeight);
  const geo = new THREE.TorusGeometry(
    0.5 - tf,
    tf,
    Math.max(4, Math.round(radialSeg)),
    Math.max(8, Math.round(tubularSeg)),
  );
  geo.rotateX(-Math.PI / 2);
  // A cut layer's body becomes a rounded rectangle (kit `squareness`), so a rim
  // that stayed elliptical would sink into the corners. Morph the ring the same
  // way and a cut crust still hugs the cut edge.
  if (square > 1e-4) {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const r = Math.hypot(v.x, v.z);
      if (r > 1e-5) {
        const sr = superRadius(Math.atan2(v.z, v.x), square);
        v.x *= sr;
        v.z *= sr;
      }
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  geo.scale(safe(width), th / tf, safe(depth));
  geo.computeVertexNormals();
  return geo;
}

/** A flat disc with radial 0..1 UVs — plate faces, floor discs, flour dust. */
export function discFace(width: number, depth: number, segments = 48): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(0.5, Math.max(8, Math.round(segments)));
  geo.rotateX(-Math.PI / 2);
  geo.scale(safe(width), 1, safe(depth));
  return geo;
}

/**
 * A cupped disc — the pepperoni signature. The middle dishes down and the rim
 * curls up, so at 120px the silhouette is a little bowl, never a flat coin.
 */
export function cuppedDisc(
  diameter: number,
  height: number,
  opts: { cup?: number; rimLift?: number; radial?: number; seed?: number } = {},
): THREE.BufferGeometry {
  const { cup = 0.5, rimLift = 0.24, radial = 20, seed = 1 } = opts;
  const geo = new THREE.CylinderGeometry(0.5, 0.42, 1, Math.max(8, Math.round(radial)), 2, false);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const yN = clamp01(v.y + 0.5);
    const r = clamp01(Math.hypot(v.x, v.z) / 0.5);
    const ang = Math.atan2(v.z, v.x);
    if (yN > 0.5) {
      const t = (yN - 0.5) * 2;
      v.y -= cup * (1 - r * r) * t;
      v.y += rimLift * Math.pow(r, 3) * t;
    }
    const wob =
      1 + fbm2(Math.cos(ang) * 2.2 + seed * 3.3, Math.sin(ang) * 2.2 - seed * 1.7, 2) * 0.055;
    v.x *= wob;
    v.z *= wob;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.scale(safe(diameter), safe(height), safe(diameter));
  geo.computeVertexNormals();
  return groundGeo(geo);
}

/** A closed-enough dome — egg yolk, blueberry cap, dough bubble. */
export function domeGeo(
  diameter: number,
  height: number,
  segsW = 16,
  segsH = 9,
  thetaFrac = 0.56,
): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(
    0.5,
    Math.max(6, Math.round(segsW)),
    Math.max(3, Math.round(segsH)),
    0,
    TAU,
    0,
    Math.PI * clamp(thetaFrac, 0.2, 0.95),
  );
  geo.scale(safe(diameter), 1, safe(diameter));
  return fitGeoY(geo, height);
}

/** A squashed ellipsoid grounded at y = 0 — blueberries, olives, seeds. */
export function blobGeo(
  diameter: number,
  height: number,
  segs = 12,
): THREE.BufferGeometry {
  const s = Math.max(6, Math.round(segs));
  const geo = new THREE.SphereGeometry(0.5, s, Math.max(4, s >> 1));
  geo.scale(safe(diameter), safe(height), safe(diameter));
  return groundGeo(geo);
}

/**
 * A single leaf sheet: pointed, folded along the midrib, ruffled at the margin.
 * Rendered DoubleSide — basil and lettuce are thin enough that a solid slab
 * would read as plastic.
 */
export function leafGeo(
  length: number,
  width: number,
  opts: {
    fold?: number;
    arch?: number;
    ruffle?: number;
    segU?: number;
    segV?: number;
    seed?: number;
  } = {},
): THREE.BufferGeometry {
  const { fold = 0.3, arch = 0.22, ruffle = 0.1, segU = 9, segV = 4, seed = 2 } = opts;
  const L = safe(length);
  const W = safe(width);
  const geo = new THREE.PlaneGeometry(1, 1, Math.max(4, segU), Math.max(2, segV));
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const u = clamp01(v.x + 0.5); // 0 = stem, 1 = tip
    const s = v.y; // -0.5 .. 0.5 across the blade
    const hw = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.78)), 0.68);
    const x = (u - 0.5) * L;
    const z = s * 2 * hw * (W * 0.5);
    let y = fold * W * (1 - Math.abs(s * 2)) * 0.5;
    y += arch * L * 0.35 * u * u;
    y += ruffle * W * Math.sin(u * 8.5 + seed * 2.1) * Math.abs(s * 2) * 0.5;
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return groundGeo(geo);
}

/**
 * A curved solid strip — bell pepper, onion sliver. Built from an annular
 * sector so the curve is real geometry, then centred on X/Z.
 */
export function arcStrip(
  outerR: number,
  bandFrac: number,
  thickness: number,
  arc: number,
  segs = 8,
): THREE.BufferGeometry {
  const ro = safe(outerR, 5e-3);
  const ri = Math.max(ro * clamp(1 - bandFrac, 0.15, 0.9), ro * 0.15);
  const a = clamp(arc, 0.3, Math.PI * 1.6);
  const shape = new THREE.Shape();
  shape.absarc(0, 0, ro, -a / 2, a / 2, false);
  shape.absarc(0, 0, ri, a / 2, -a / 2, true);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: safe(thickness, 2e-3),
    bevelEnabled: false,
    curveSegments: Math.max(3, Math.round(segs)),
  });
  geo.rotateX(-Math.PI / 2); // extrusion becomes +Y, shape lies in XZ
  centerXZ(geo);
  groundGeo(geo);
  geo.computeVertexNormals();
  return geo;
}

/**
 * One bacon rasher: a wavy, curled ribbon running along +X. The sine displaces
 * along the long axis and a matching roll about that axis gives the curl — the
 * two together are what stop bacon reading as a painted plank.
 */
export function rasherGeo(
  length: number,
  width: number,
  thickness: number,
  opts: { wave?: number; curl?: number; seed?: number; segments?: number } = {},
): THREE.BufferGeometry {
  const { wave = 0.35, curl = 0.55, seed = 1, segments = 16 } = opts;
  const L = safe(length);
  const W = safe(width);
  const T = safe(thickness, 5e-4);
  const geo = new THREE.BoxGeometry(L, T, W, Math.max(4, Math.round(segments)), 1, 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const phase = seed * 1.9;
  const amp = wave * T * 2.6;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = clamp01(v.x / L + 0.5);
    // taper both ends so a rasher is not a rectangle
    v.z *= 1 - 0.28 * Math.pow(Math.abs(2 * t - 1), 3);
    // roll about the long axis: the curl
    const roll = Math.sin(t * TAU * 0.85 + phase) * curl;
    const cz = v.z;
    const cy = v.y;
    v.z = cz * Math.cos(roll) - cy * Math.sin(roll);
    v.y = cz * Math.sin(roll) + cy * Math.cos(roll);
    // ripple along the length
    v.y += Math.sin(t * TAU * 1.6 + phase) * amp + Math.sin(t * TAU * 3.1 + phase * 2) * amp * 0.4;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  roughen(geo, T * 0.28, 8, seed * 3.1);
  return geo;
}

/**
 * A run of rashers laid across the short axis and pointing along the long one,
 * so a 0.15 x 2.4 sliver still gets one full-length rasher rather than a grid
 * of confetti.
 */
export function rasherRun(
  width: number,
  depth: number,
  thickness: number,
  opts: { maxStrips?: number; minPitch?: number; wave?: number; curl?: number; seed?: number; segments?: number } = {},
): THREE.BufferGeometry | null {
  const { maxStrips = 4, minPitch = 0.16, wave = 0.35, curl = 0.55, seed = 1, segments = 16 } = opts;
  const W = safe(width);
  const D = safe(depth);
  const alongX = W >= D;
  const len = Math.max(W, D) * 0.97;
  const cross = Math.min(W, D);
  const n = clamp(Math.floor(cross / Math.max(minPitch, 1e-3)), 1, Math.max(1, maxStrips));
  const pitch = cross / n;
  const strip = pitch * 0.84;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const g = rasherGeo(len * (0.9 + ((i * 37) % 7) / 70), strip, thickness, {
      wave,
      curl,
      seed: seed + i * 2.7,
      segments,
    });
    g.translate(0, 0, -cross / 2 + pitch * (i + 0.5));
    parts.push(g);
  }
  const merged = mergeSafe(parts);
  if (merged && !alongX) merged.rotateY(Math.PI / 2);
  return merged;
}

// ===========================================================================
// canvas painters
// ===========================================================================

export const cssHex = (hex: number): string =>
  `#${(hex & 0xffffff).toString(16).padStart(6, '0')}`;

export const cssRgba = (hex: number, alpha: number): string =>
  `rgba(${(hex >> 16) & 0xff},${(hex >> 8) & 0xff},${hex & 0xff},${alpha})`;

/** Seamless fbm: blends the four wrapped corners so tiled maps have no seam. */
export function tileNoise(
  x: number,
  y: number,
  size: number,
  freq: number,
  octaves = 3,
): number {
  const s = freq / Math.max(size, 1);
  const fx = x / Math.max(size, 1);
  const fy = y / Math.max(size, 1);
  const a = fbm2(x * s, y * s, octaves);
  const b = fbm2((x - size) * s, y * s, octaves);
  const c = fbm2(x * s, (y - size) * s, octaves);
  const d = fbm2((x - size) * s, (y - size) * s, octaves);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

/** Draw a filled circle, repeated across the tile seams so maps stay seamless. */
export function wrapArc(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  size: number,
): void {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const px = x + dx * size;
      const py = y + dy * size;
      if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue;
      g.beginPath();
      g.arc(px, py, r, 0, TAU);
      g.fill();
    }
  }
}

/** Tileable mottled fill — the base coat under almost every painted map. */
export function mottleFill(
  g: CanvasRenderingContext2D,
  size: number,
  base: number,
  opts: { amp?: number; freq?: number; amp2?: number; freq2?: number; warm?: number; octaves?: number } = {},
): void {
  const { amp = 22, freq = 5, amp2 = 12, freq2 = 19, warm = 0, octaves = 2 } = opts;
  const br = (base >> 16) & 0xff;
  const bg = (base >> 8) & 0xff;
  const bb = base & 0xff;
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n =
        tileNoise(x, y, size, freq, octaves) * amp + tileNoise(x, y, size, freq2, 1) * amp2;
      const i = (y * size + x) * 4;
      d[i] = br + n + warm;
      d[i + 1] = bg + n;
      d[i + 2] = bb + n - warm;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

/** Speckle layer spec: sizes are fractions of the texture edge. */
export interface SpeckLayer {
  color: number;
  count: number;
  min: number;
  max: number;
  alpha?: number;
}

/** Generic speckled albedo — potato crisp, parmesan dust, pickle skin, sauce pulp. */
export function specklePainter(
  base: number,
  layers: SpeckLayer[],
  opts: { seed?: number; mottle?: number } = {},
): CanvasPainter {
  const { seed = 9, mottle = 16 } = opts;
  return (g, size) => {
    mottleFill(g, size, base, { amp: mottle, amp2: mottle * 0.5 });
    const rng = new Rng(seed * 7717 + 11);
    for (const layer of layers) {
      g.globalAlpha = layer.alpha ?? 1;
      g.fillStyle = cssHex(layer.color);
      for (let i = 0; i < layer.count; i++) {
        wrapArc(
          g,
          rng.range(0, size),
          rng.range(0, size),
          rng.range(layer.min, layer.max) * size,
          size,
        );
      }
    }
    g.globalAlpha = 1;
  };
}

/** Near-white base plus dark char blobs: multiplies onto a meat/crust colour. */
export function charPainter(
  base: number,
  fleck: number,
  count: number,
  seed = 5,
): CanvasPainter {
  return (g, size) => {
    mottleFill(g, size, base, { amp: 12, amp2: 8 });
    const rng = new Rng(seed * 3301 + 7);
    for (let i = 0; i < count; i++) {
      g.globalAlpha = rng.range(0.18, 0.72);
      g.fillStyle = cssHex(fleck);
      const r = rng.range(0.004, 0.026) * size;
      wrapArc(g, rng.range(0, size), rng.range(0, size), r, size);
    }
    // a handful of deep, almost-black grill scorches
    for (let i = 0; i < Math.max(2, count >> 3); i++) {
      g.globalAlpha = rng.range(0.35, 0.8);
      g.fillStyle = cssHex(0x2a1a10);
      wrapArc(g, rng.range(0, size), rng.range(0, size), rng.range(0.006, 0.018) * size, size);
    }
    g.globalAlpha = 1;
  };
}

/** Speckled crumb bump for bread and dough (grayscale, linear space). */
export const paintCrumbBump: CanvasPainter = (g, size) => {
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = clamp01(
        0.5 + tileNoise(x, y, size, 9, 3) * 0.3 + tileNoise(x, y, size, 34, 2) * 0.2,
      );
      const c = v * 255;
      const i = (y * size + x) * 4;
      d[i] = c;
      d[i + 1] = c;
      d[i + 2] = c;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const rng = new Rng(4242);
  for (let i = 0; i < 260; i++) {
    const light = rng.bool(0.55);
    g.globalAlpha = rng.range(0.08, 0.3);
    g.fillStyle = light ? '#ffffff' : '#1c1c1c';
    wrapArc(g, rng.range(0, size), rng.range(0, size), rng.range(0.004, 0.017) * size, size);
  }
  g.globalAlpha = 1;
};

/** Leaf veins as a bump map — a midrib plus herringbone laterals. */
export const paintLeafVeins: CanvasPainter = (g, size) => {
  g.fillStyle = '#7d7d7d';
  g.fillRect(0, 0, size, size);
  g.strokeStyle = '#dcdcdc';
  g.lineCap = 'round';
  g.lineWidth = Math.max(1, size * 0.014);
  g.beginPath();
  g.moveTo(0, size * 0.5);
  g.lineTo(size, size * 0.5);
  g.stroke();
  g.lineWidth = Math.max(1, size * 0.007);
  for (let i = 1; i < 12; i++) {
    const x = (i / 12) * size;
    const spread = size * 0.34 * Math.sin((i / 12) * Math.PI);
    for (const dir of [-1, 1]) {
      g.beginPath();
      g.moveTo(x, size * 0.5);
      g.quadraticCurveTo(x + size * 0.06, size * 0.5 + dir * spread * 0.6, x + size * 0.1, size * 0.5 + dir * spread);
      g.stroke();
    }
  }
};

/** Bacon: fat/meat stripes running the length of the rasher. */
export function baconPainter(crisp: boolean, seed = 3): CanvasPainter {
  const meat = crisp ? 0x8c2c1a : 0xa63a23;
  const fat = crisp ? 0xe7cba4 : 0xf2dcc0;
  const char = crisp ? 0x40170d : 0x5e2113;
  return (g, size) => {
    mottleFill(g, size, meat, { amp: 20, amp2: 12, warm: 6 });
    const bands = 3;
    for (let b = 0; b < bands; b++) {
      const base = size * (0.17 + b * 0.29);
      const amp = size * (crisp ? 0.042 : 0.055);
      const thick = size * (crisp ? 0.05 : 0.072) * (0.75 + ((b * 17) % 5) / 8);
      const yy = (x: number): number => {
        const t = x / size;
        return (
          base +
          Math.sin(t * TAU + b * 1.7 + seed) * amp +
          Math.sin(t * TAU * 2 + b * 3.1) * amp * 0.42
        );
      };
      g.beginPath();
      for (let x = 0; x <= size; x += 4) {
        const y = yy(x) - thick / 2;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      for (let x = size; x >= 0; x -= 4) g.lineTo(x, yy(x) + thick / 2);
      g.closePath();
      g.fillStyle = cssHex(fat);
      g.globalAlpha = 0.94;
      g.fill();
      g.globalAlpha = 1;
    }
    // crisped edges along the top and bottom margin of the strip
    const edge = g.createLinearGradient(0, 0, 0, size);
    edge.addColorStop(0, cssRgba(char, crisp ? 0.72 : 0.45));
    edge.addColorStop(0.18, cssRgba(char, 0));
    edge.addColorStop(0.82, cssRgba(char, 0));
    edge.addColorStop(1, cssRgba(char, crisp ? 0.72 : 0.45));
    g.fillStyle = edge;
    g.fillRect(0, 0, size, size);
    const rng = new Rng(seed * 991 + 3);
    for (let i = 0; i < (crisp ? 90 : 50); i++) {
      g.globalAlpha = rng.range(0.1, 0.5);
      g.fillStyle = cssHex(char);
      wrapArc(g, rng.range(0, size), rng.range(0, size), rng.range(0.003, 0.012) * size, size);
    }
    g.globalAlpha = 1;
  };
}

/**
 * Radial browning — pancakes, waffles, dough. Light at the centre, maillard at
 * the rim, with mottled hot-spots. Lands perfectly on a cylinder's top cap,
 * whose UVs are already a 0..1 disc.
 */
export function toastPainter(
  centre: number,
  mid: number,
  rim: number,
  spot: number,
  spots: number,
  seed = 4,
): CanvasPainter {
  return (g, size) => {
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.52);
    grd.addColorStop(0, cssHex(centre));
    grd.addColorStop(0.46, cssHex(mid));
    grd.addColorStop(0.86, cssHex(rim));
    grd.addColorStop(1, cssHex(rim));
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    const rng = new Rng(seed * 6151 + 19);
    for (let i = 0; i < spots; i++) {
      const a = rng.range(0, TAU);
      const r = Math.sqrt(rng.next()) * size * 0.47;
      const x = size / 2 + Math.cos(a) * r;
      const y = size / 2 + Math.sin(a) * r;
      g.globalAlpha = rng.range(0.06, 0.3);
      g.fillStyle = cssHex(spot);
      g.beginPath();
      g.ellipse(x, y, rng.range(0.012, 0.06) * size, rng.range(0.012, 0.05) * size, rng.range(0, TAU), 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  };
}

/** Cut-tomato flesh: pale core, radial locules, seeds in jelly. */
export const paintTomatoFlesh: CanvasPainter = (g, size) => {
  const c = size / 2;
  const grd = g.createRadialGradient(c, c, 0, c, c, size * 0.5);
  grd.addColorStop(0, '#e9836f');
  grd.addColorStop(0.34, '#e0604b');
  grd.addColorStop(0.78, '#d8412f');
  grd.addColorStop(1, '#b62f22');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);

  // radial fibres out of the core
  g.strokeStyle = 'rgba(245,170,150,0.5)';
  g.lineWidth = Math.max(1, size * 0.006);
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * TAU;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * size * 0.07, c + Math.sin(a) * size * 0.07);
    g.lineTo(c + Math.cos(a) * size * 0.46, c + Math.sin(a) * size * 0.46);
    g.stroke();
  }

  // five locules of jelly + seeds
  const rng = new Rng(9001);
  const lobes = 5;
  for (let l = 0; l < lobes; l++) {
    const a = (l / lobes) * TAU + 0.4;
    const lx = c + Math.cos(a) * size * 0.26;
    const ly = c + Math.sin(a) * size * 0.26;
    g.fillStyle = 'rgba(226,120,92,0.75)';
    g.beginPath();
    g.ellipse(lx, ly, size * 0.13, size * 0.09, a, 0, TAU);
    g.fill();
    for (let s = 0; s < 5; s++) {
      const sa = rng.range(0, TAU);
      const sr = Math.sqrt(rng.next()) * size * 0.085;
      g.fillStyle = 'rgba(247,229,163,0.95)';
      g.beginPath();
      g.ellipse(
        lx + Math.cos(sa) * sr,
        ly + Math.sin(sa) * sr,
        size * 0.017,
        size * 0.012,
        sa,
        0,
        TAU,
      );
      g.fill();
    }
  }
  // pale core star
  g.fillStyle = 'rgba(250,205,180,0.85)';
  g.beginPath();
  g.arc(c, c, size * 0.075, 0, TAU);
  g.fill();
};

/** Rustic board: ~44 wavering grain lines, seamless top-to-bottom. */
export const paintWoodGrain: CanvasPainter = (g, size) => {
  mottleFill(g, size, 0xc08b4e, { amp: 14, amp2: 8, warm: 8 });
  const rng = new Rng(20707);
  const lines = 44;
  for (let i = 0; i < lines; i++) {
    const x0 = ((i + rng.range(-0.35, 0.35)) / lines) * size;
    const k = rng.int(1, 4); // integer periods keep the tile seamless in v
    const amp = rng.range(0.004, 0.022) * size;
    const phase = rng.range(0, TAU);
    const dark = rng.bool(0.68);
    g.strokeStyle = dark
      ? cssRgba(0x7d4f26, rng.range(0.12, 0.42))
      : cssRgba(0xe0b478, rng.range(0.1, 0.3));
    g.lineWidth = rng.range(0.0016, 0.0075) * size;
    g.beginPath();
    for (let y = 0; y <= size; y += 4) {
      const v = y / size;
      const x = x0 + Math.sin(v * TAU * k + phase) * amp + Math.sin(v * TAU * (k + 2) + phase * 1.7) * amp * 0.35;
      if (y === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  // a couple of knots
  for (let i = 0; i < 2; i++) {
    const kx = rng.range(0.15, 0.85) * size;
    const ky = rng.range(0.15, 0.85) * size;
    for (let r = 1; r <= 5; r++) {
      g.strokeStyle = cssRgba(0x6d431f, 0.3 - r * 0.04);
      g.lineWidth = size * 0.004;
      g.beginPath();
      g.ellipse(kx, ky, r * size * 0.012, r * size * 0.019, rng.range(0, TAU), 0, TAU);
      g.stroke();
    }
  }
};

/** Checkerboard — diner floor, picnic cloth. */
export function checkerPainter(a: number, b: number, cells = 8): CanvasPainter {
  return (g, size) => {
    const n = Math.max(2, Math.round(cells));
    const c = size / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        g.fillStyle = (x + y) % 2 === 0 ? cssHex(a) : cssHex(b);
        g.fillRect(Math.floor(x * c), Math.floor(y * c), Math.ceil(c), Math.ceil(c));
      }
    }
    // weave it a little so it is cloth/lino, not a UI swatch
    const rng = new Rng(515);
    g.globalAlpha = 0.06;
    for (let i = 0; i < 260; i++) {
      g.fillStyle = rng.bool() ? '#ffffff' : '#000000';
      wrapArc(g, rng.range(0, size), rng.range(0, size), rng.range(0.003, 0.014) * size, size);
    }
    g.globalAlpha = 1;
  };
}

/** Ceramic glaze with a rim stripe, painted rather than modelled. */
export function glazePainter(
  body: number,
  ring: number,
  r0 = 0.4,
  r1 = 0.455,
): CanvasPainter {
  return (g, size) => {
    mottleFill(g, size, body, { amp: 5, amp2: 3 });
    const c = size / 2;
    g.strokeStyle = cssHex(ring);
    g.lineWidth = Math.max(1, (r1 - r0) * size);
    g.beginPath();
    g.arc(c, c, ((r0 + r1) / 2) * size, 0, TAU);
    g.stroke();
    g.strokeStyle = cssRgba(ring, 0.32);
    g.lineWidth = Math.max(1, size * 0.006);
    g.beginPath();
    g.arc(c, c, (r0 - 0.035) * size, 0, TAU);
    g.stroke();
    // faint glaze sheen sweeping across the face
    const sheen = g.createLinearGradient(0, 0, size, size);
    sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.06)');
    g.fillStyle = sheen;
    g.fillRect(0, 0, size, size);
  };
}

/** Semi-transparent flour dust for a board or a floor. */
export const paintFlourDust: CanvasPainter = (g, size) => {
  g.clearRect(0, 0, size, size);
  const rng = new Rng(3777);
  for (let i = 0; i < 520; i++) {
    const a = rng.range(0, TAU);
    const r = Math.pow(rng.next(), 0.65) * size * 0.5;
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r;
    g.globalAlpha = rng.range(0.06, 0.5) * (1 - r / (size * 0.55));
    g.fillStyle = '#fdf6e8';
    g.beginPath();
    g.arc(x, y, rng.range(0.002, 0.016) * size, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
};


// ===========================================================================
// shared texture accessors (stable keys — one bake for all three themes)
// ===========================================================================

/** Crumb bump shared by every bread and dough material. */
export function crumbBumpTex(m: MaterialLibraryRef): THREE.Texture {
  return m.dataTexture('savory.crumbBump', paintCrumbBump, { size: 128 });
}

/** Vein bump shared by lettuce and basil. */
export function leafVeinTex(m: MaterialLibraryRef): THREE.Texture {
  return m.dataTexture('savory.leafVeins', paintLeafVeins, { size: 128 });
}
