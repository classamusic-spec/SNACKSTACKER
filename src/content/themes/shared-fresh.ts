/**
 * Shared helpers for the "fresh" content set — Sushi Tower, Candy Stack and
 * Taco Night.
 *
 * Nothing outside those three theme files imports this module. Everything here
 * exists for one reason: `FoodDef.build()` is called with wildly varying
 * footprints (2.4 x 2.4 down to a 0.15-wide sliver, and non-square shapes like
 * 2.4 x 0.12) because a mis-drop rebuilds the layer at its cut size rather than
 * boolean-slicing it. So every count, every prop radius and every segment count
 * has to be a function of the footprint, not a constant.
 */
import * as THREE from 'three';
import type { FoodBuildCtx } from '../api';
import { Rng } from '../../core/rng';
import { TAU, clamp, clamp01 } from '../../core/math';
import { fbm2, mergeAll } from '../kit';

// ---------------------------------------------------------------------------
// footprint maths
// ---------------------------------------------------------------------------

/** The full plate footprint a theme is authored against (DESIGN.md §2). */
export const BASE_FOOTPRINT = 2.4;

/** A dimension below this makes degenerate triangles and NaN normals. */
export const MIN_DIM = 0.05;

export const safeW = (ctx: FoodBuildCtx): number => Math.max(ctx.width, MIN_DIM);
export const safeD = (ctx: FoodBuildCtx): number => Math.max(ctx.depth, MIN_DIM);
export const safeH = (ctx: FoodBuildCtx): number => Math.max(ctx.height, MIN_DIM);

/** Footprint area as a fraction of the full plate, 0..1. */
export function areaRatio(ctx: FoodBuildCtx): number {
  return clamp01((safeW(ctx) * safeD(ctx)) / (BASE_FOOTPRINT * BASE_FOOTPRINT));
}

/** Quality + offcut multiplier applied to every decoration budget. */
export function detailBudget(ctx: FoodBuildCtx): number {
  const q = ctx.quality === 'high' ? 1 : ctx.quality === 'medium' ? 0.68 : 0.4;
  return ctx.offcut ? q * 0.42 : q;
}

/**
 * How many props (grains, tobiko beads, sprinkles, jalapeno rings) to place.
 * Scales with area so a sliver gets a sprinkle or two, never a confetti bomb.
 */
export function propCount(ctx: FoodBuildCtx, base: number, min = 0): number {
  const a = areaRatio(ctx);
  const n = Math.max(0, Math.round(base * a * detailBudget(ctx)));
  if (a < 0.02) return Math.min(n, 1);
  return Math.max(n, min);
}

/**
 * Shrink factor for individual prop SIZE. On a 0.15-wide cut a full-size
 * sesame seed would hang half its body outside the footprint, so props shrink
 * with the narrow axis (never below 30%, or they stop reading as food).
 */
export function propScale(ctx: FoodBuildCtx): number {
  return clamp(Math.min(safeW(ctx), safeD(ctx)) / 0.9, 0.3, 1);
}

/** Segment count per quality tier; offcuts get 60%. */
export function seg(ctx: FoodBuildCtx, high: number, medium: number, low: number): number {
  const base = ctx.quality === 'high' ? high : ctx.quality === 'medium' ? medium : low;
  return Math.max(3, Math.round(ctx.offcut ? base * 0.6 : base));
}

/** 'x' when the cut is wider than it is deep. Fans/rings orient along it. */
export function longAxis(ctx: FoodBuildCtx): 'x' | 'z' {
  return safeW(ctx) >= safeD(ctx) ? 'x' : 'z';
}

/** A radius that can never exceed half of the smallest dimension it rounds. */
export function safeRadius(r: number, ...dims: number[]): number {
  let m = Infinity;
  for (const d of dims) m = Math.min(m, Math.abs(d));
  return clamp(r, 0.0008, Math.max(m / 2 - 0.001, 0.001));
}

// ---------------------------------------------------------------------------
// the contract enforcer
// ---------------------------------------------------------------------------

/**
 * Force an object to satisfy the FoodDef contract: centred on X/Z, occupying
 * exactly y in [0, ctx.height]. Call this as the last line of every `build()`.
 *
 * Foods are authored to land close to `height` naturally so this only ever
 * applies a small correction — a big correction would visibly squash the food.
 */
export function finalize(obj: THREE.Object3D, ctx: FoodBuildCtx): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty() || !Number.isFinite(box.min.y) || !Number.isFinite(box.max.y)) return obj;

  const cx = (box.min.x + box.max.x) * 0.5;
  const cz = (box.min.z + box.max.z) * 0.5;
  if (Number.isFinite(cx)) obj.position.x -= cx;
  if (Number.isFinite(cz)) obj.position.z -= cz;

  const h = box.max.y - box.min.y;
  const target = Math.max(ctx.height, 1e-4);
  const k = h > 1e-5 ? clamp(target / h, 0.02, 40) : 1;
  const p0 = obj.position.y;
  obj.scale.y *= k;
  obj.position.y = -k * (box.min.y - p0);
  return obj;
}

// ---------------------------------------------------------------------------
// surface sampling — props that actually sit ON the food
// ---------------------------------------------------------------------------

/**
 * Build a cheap max-height field over a geometry so scattered props follow its
 * dome instead of floating in a flat plane above it. One pass over the position
 * attribute (a few hundred verts), so it costs nothing per layer.
 */
export function topSampler(geo: THREE.BufferGeometry, cells = 10): (x: number, z: number) => number {
  const n = Math.max(1, Math.round(cells));
  const pos = geo.attributes.position as THREE.BufferAttribute;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb) return () => 0;

  const minX = bb.min.x;
  const minZ = bb.min.z;
  const spanX = Math.max(bb.max.x - minX, 1e-5);
  const spanZ = Math.max(bb.max.z - minZ, 1e-5);
  const grid = new Float32Array(n * n).fill(bb.min.y);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const gx = clamp(Math.floor(((x - minX) / spanX) * n), 0, n - 1);
    const gz = clamp(Math.floor(((z - minZ) / spanZ) * n), 0, n - 1);
    const idx = gz * n + gx;
    if (y > grid[idx]) grid[idx] = y;
  }

  return (x: number, z: number): number => {
    const gx = clamp(Math.floor(((x - minX) / spanX) * n), 0, n - 1);
    const gz = clamp(Math.floor(((z - minZ) / spanZ) * n), 0, n - 1);
    const v = grid[gz * n + gx];
    return Number.isFinite(v) ? v : 0;
  };
}

export interface SurfaceScatterOpts {
  seed?: number;
  /** Keeps props inside the footprint; pass prop radius + a hair. */
  margin?: number;
  /** Minimum separation as a fraction of the smaller footprint axis. */
  spacing?: number;
  randomYaw?: boolean;
  randomTilt?: number;
  /** Push props down into the surface so they read as embedded, not stuck on. */
  sink?: number;
}

/**
 * Like kit's `scatter`, but each prop is lifted onto a surface function and the
 * maker sees its own (x, z) so it can vary or veto by position. Everything is
 * merged into one geometry — a 200-bead tobiko layer is a single draw call.
 */
export function scatterOnSurface(
  count: number,
  width: number,
  depth: number,
  surface: (x: number, z: number) => number,
  make: (i: number, rng: Rng, x: number, z: number) => THREE.BufferGeometry | null,
  opts: SurfaceScatterOpts = {},
): THREE.BufferGeometry | null {
  const {
    seed = 3,
    margin = 0.06,
    spacing = 0,
    randomYaw = true,
    randomTilt = 0,
    sink = 0,
  } = opts;
  if (count <= 0) return null;

  const rng = new Rng((Math.abs(Math.round(seed)) * 7919 + 17) >>> 0);
  const halfW = Math.max(width / 2 - margin, 0.006);
  const halfD = Math.max(depth / 2 - margin, 0.006);
  const minDist = spacing * Math.min(width, depth);
  const placed: Array<[number, number]> = [];
  const parts: THREE.BufferGeometry[] = [];

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
      attempts < 10 &&
      placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < minDist)
    );
    placed.push([x, z]);

    const g = make(i, rng, x, z);
    if (!g) continue;
    if (randomYaw) g.rotateY(rng.range(0, TAU));
    if (randomTilt > 0) {
      g.rotateX(rng.signed() * randomTilt);
      g.rotateZ(rng.signed() * randomTilt);
    }
    const y = surface(x, z) - sink;
    if (!Number.isFinite(y)) {
      g.dispose();
      continue;
    }
    g.translate(x, y, z);
    parts.push(g);
  }
  return mergeAll(parts);
}

// ---------------------------------------------------------------------------
// extra shapes the kit does not cover
// ---------------------------------------------------------------------------

export interface SheetOpts {
  /** Lifts the centre of the sheet — nori draped over a mound. */
  arch?: number;
  /** fbm amplitude, the "this is not a plane" wobble. */
  wave?: number;
  waveFreq?: number;
  /** Lifts the rim — a curling edge. */
  curlEdges?: number;
  /** Sinusoidal rake grooves along X (grated wasabi, combed crema). */
  rake?: number;
  rakeFreq?: number;
  seed?: number;
  segments?: number;
}

/**
 * A thin sheet of constant thickness whose surface can arch, wave, curl at the
 * rim and carry rake grooves. Nori, cucumber beds, crema bases, wafer leaves.
 * Occupies y in [0, extent] with X/Z centred.
 */
export function sheet(
  width: number,
  thickness: number,
  depth: number,
  opts: SheetOpts = {},
): THREE.BufferGeometry {
  const {
    arch = 0,
    wave = 0,
    waveFreq = 2.6,
    curlEdges = 0,
    rake = 0,
    rakeFreq = 9,
    seed = 1,
    segments = 14,
  } = opts;

  const s = Math.max(2, Math.round(segments));
  const w = Math.max(width, MIN_DIM);
  const d = Math.max(depth, MIN_DIM);
  const t = Math.max(thickness, 0.004);
  const geo = new THREE.BoxGeometry(w, t, d, s, 1, s);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const hw = w / 2;
  const hd = d / 2;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const nx = v.x / hw;
    const nz = v.z / hd;
    const r = clamp01(Math.hypot(nx, nz));
    let dy = arch * (1 - r * r);
    if (wave !== 0) dy += wave * fbm2(nx * waveFreq + seed, nz * waveFreq - seed, 2);
    if (curlEdges !== 0) dy += curlEdges * r * r * r;
    if (rake !== 0) dy += rake * Math.sin(nx * rakeFreq + seed) * (1 - r * r * 0.5);
    v.y += dy;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (bb) geo.translate(0, -bb.min.y, 0);
  return geo;
}

/**
 * A swept tube along a polyline — icing zigzags, crema drizzle, chopsticks.
 * Returns null rather than throwing on a degenerate path.
 */
export function ribbon(
  points: THREE.Vector3[],
  radius: number,
  opts: { tubular?: number; radial?: number; closed?: boolean } = {},
): THREE.BufferGeometry | null {
  if (points.length < 2 || radius <= 1e-5) return null;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return null;
  }
  const closed = opts.closed ?? false;
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.5);
  return new THREE.TubeGeometry(
    curve,
    Math.max(4, Math.round(opts.tubular ?? 28)),
    radius,
    Math.max(3, Math.round(opts.radial ?? 6)),
    closed,
  );
}

/**
 * A flat elliptical disc lying in the XZ plane, UV-mapped 0..1 across its
 * bounding square so a painted texture (a lollipop swirl) lands square on it.
 */
export function discXZ(width: number, depth: number, segments = 32): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(0.5, Math.max(6, Math.round(segments)));
  geo.rotateX(-Math.PI / 2);
  geo.scale(Math.max(width, MIN_DIM), 1, Math.max(depth, MIN_DIM));
  return geo;
}

// ---------------------------------------------------------------------------
// canvas painting helpers (albedo + bump textures)
// ---------------------------------------------------------------------------

export function hexCss(color: number): string {
  return `#${(color >>> 0).toString(16).padStart(6, '0')}`;
}

export function fillFlat(c: CanvasRenderingContext2D, size: number, color: string): void {
  c.fillStyle = color;
  c.fillRect(0, 0, size, size);
}

export function fillGradient(
  c: CanvasRenderingContext2D,
  size: number,
  stops: Array<[number, string]>,
  diagonal = true,
): void {
  const g = diagonal
    ? c.createLinearGradient(0, 0, size, size)
    : c.createLinearGradient(0, 0, 0, size);
  for (const [at, col] of stops) g.addColorStop(clamp01(at), col);
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
}

/**
 * A soft-edged stroke built from stacked translucent passes — a poor man's
 * gaussian that needs no `ctx.filter` support. This is what turns the salmon's
 * fat lines from painted stripes into marbling.
 */
export function softStroke(
  c: CanvasRenderingContext2D,
  pts: Array<[number, number]>,
  width: number,
  color: string,
  alpha = 1,
  layers = 7,
): void {
  if (pts.length < 2) return;
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = color;
  for (let j = layers; j >= 1; j--) {
    c.globalAlpha = clamp01(alpha * 0.2);
    c.lineWidth = Math.max(0.5, width * (0.28 + (j / layers) * 1.9));
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.stroke();
  }
  c.restore();
}

/** Random dots — sesame, powder sugar, cocoa flecks, nori grain. */
export function speckle(
  c: CanvasRenderingContext2D,
  size: number,
  count: number,
  colors: string[],
  rMin: number,
  rMax: number,
  seed: number,
  alpha = 1,
): void {
  if (!colors.length || count <= 0) return;
  const rng = new Rng((Math.abs(Math.round(seed)) * 2654435761 + 11) >>> 0);
  c.save();
  for (let i = 0; i < count; i++) {
    c.globalAlpha = clamp01(alpha * rng.range(0.35, 1));
    c.fillStyle = colors[rng.int(0, colors.length)];
    const r = Math.max(0.4, rng.range(rMin, rMax) * size);
    c.beginPath();
    c.arc(rng.next() * size, rng.next() * size, r, 0, TAU);
    c.fill();
  }
  c.restore();
}

/** Low-frequency mottling so a flat fill never reads as plastic. */
export function noiseWash(
  c: CanvasRenderingContext2D,
  size: number,
  cellPx: number,
  amount: number,
  seed: number,
  darkColor = '#000000',
  lightColor = '#ffffff',
): void {
  const n = clamp(Math.round(size / Math.max(2, cellPx)), 4, 96);
  const s = size / n;
  c.save();
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = fbm2(x * 0.34 + seed, y * 0.34 - seed, 3);
      const a = clamp01(Math.abs(v) * amount);
      if (a < 0.005) continue;
      c.globalAlpha = a;
      c.fillStyle = v > 0 ? lightColor : darkColor;
      c.fillRect(x * s, y * s, s + 1, s + 1);
    }
  }
  c.restore();
}

/** Straight parallel stripes — serape cloth, wafer cream, tatami weave. */
export function stripes(
  c: CanvasRenderingContext2D,
  size: number,
  bands: Array<{ span: number; color: string }>,
  vertical = false,
): void {
  const total = bands.reduce((a, b) => a + Math.max(b.span, 0.0001), 0) || 1;
  let at = 0;
  c.save();
  for (const b of bands) {
    const len = (Math.max(b.span, 0.0001) / total) * size;
    c.fillStyle = b.color;
    if (vertical) c.fillRect(at, 0, len + 1, size);
    else c.fillRect(0, at, size, len + 1);
    at += len;
  }
  c.restore();
}

/** Over/under basket weave — tatami mats and the taco basket tray. */
export function weave(
  c: CanvasRenderingContext2D,
  size: number,
  cells: number,
  light: string,
  dark: string,
  gap: string,
): void {
  const n = Math.max(2, Math.round(cells));
  const s = size / n;
  fillFlat(c, size, gap);
  c.save();
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const horizontal = (x + y) % 2 === 0;
      c.fillStyle = horizontal ? light : dark;
      const pad = s * 0.08;
      if (horizontal) c.fillRect(x * s, y * s + pad, s, s - pad * 2);
      else c.fillRect(x * s + pad, y * s, s - pad * 2, s);
      // fibre lines along the strand
      c.globalAlpha = 0.18;
      c.strokeStyle = '#000000';
      c.lineWidth = Math.max(0.5, s * 0.05);
      c.beginPath();
      if (horizontal) {
        c.moveTo(x * s, y * s + s * 0.5);
        c.lineTo(x * s + s, y * s + s * 0.5);
      } else {
        c.moveTo(x * s + s * 0.5, y * s);
        c.lineTo(x * s + s * 0.5, y * s + s);
      }
      c.stroke();
      c.globalAlpha = 1;
    }
  }
  c.restore();
}

export { THREE };
