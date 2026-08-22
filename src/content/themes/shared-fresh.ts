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
import type { QualityTier } from '../../core/types';
import { TAU, clamp, clamp01, lerp } from '../../core/math';
import { fbm2, mergeAll, roundedBox, squareness, superRadius, tintGeometry } from '../kit';
import { BASE_FOOTPRINT as FULL } from '../../core/world';

// ---------------------------------------------------------------------------
// footprint maths
// ---------------------------------------------------------------------------

/** The full plate footprint a theme is authored against (DESIGN.md §2). */
export { BASE_FOOTPRINT } from '../../core/world';

/** A dimension below this makes degenerate triangles and NaN normals. */
export const MIN_DIM = 0.05;

export const safeW = (ctx: FoodBuildCtx): number => Math.max(ctx.width, MIN_DIM);
export const safeD = (ctx: FoodBuildCtx): number => Math.max(ctx.depth, MIN_DIM);
export const safeH = (ctx: FoodBuildCtx): number => Math.max(ctx.height, MIN_DIM);

/** Footprint area as a fraction of the full plate, 0..1. */
export function areaRatio(ctx: FoodBuildCtx): number {
  return clamp01((safeW(ctx) * safeD(ctx)) / (FULL * FULL));
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

/**
 * Pre-compensate a `pillow` round factor.
 *
 * kit's `pillow` squares off shapes automatically as their footprint shrinks,
 * which is right for a whole layer that got cut but wrong for a sub-part that
 * is small BY DESIGN — an avocado shard or a jelly log is a soft lens at every
 * layer size. This inverts that reduction so the intended roundness survives.
 */
export function softRound(want: number, width: number, depth: number): number {
  const k = Math.max(1 - squareness(width, depth) * 0.8, 0.2);
  return clamp(want / k, 0, 1);
}

/**
 * Morph a rectangular footprint onto the same superellipse kit's `puck` and
 * `pour` use, so a bed built from a box lines up with the round layers above
 * and below it instead of poking its corners out.
 */
function squareFactor(nx: number, nz: number, square: number): number {
  const rr = Math.hypot(nx, nz);
  if (rr < 1e-6) return 1;
  const angle = Math.atan2(nz, nx);
  return superRadius(angle, square) * (Math.max(Math.abs(nx), Math.abs(nz)) / rr);
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
  /** 0 = ellipse, 1 = rounded rectangle. Defaults to kit's cut detection. */
  square?: number;
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
  const square = clamp01(opts.square ?? squareness(w, d));
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
    const f = squareFactor(nx, nz, square);
    pos.setXYZ(i, v.x * f, v.y, v.z * f);
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
export function discXZ(
  width: number,
  depth: number,
  segments = 32,
  square?: number,
): THREE.BufferGeometry {
  const w = Math.max(width, MIN_DIM);
  const d = Math.max(depth, MIN_DIM);
  const sq = clamp01(square ?? squareness(w, d));
  const geo = new THREE.CircleGeometry(0.5, Math.max(6, Math.round(segments)));
  geo.rotateX(-Math.PI / 2);
  if (sq > 1e-3) {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const rr = Math.hypot(x, z);
      if (rr < 1e-6) continue;
      const f = superRadius(Math.atan2(z, x), sq);
      pos.setXYZ(i, x * f, pos.getY(i), z * f);
    }
    pos.needsUpdate = true;
  }
  geo.scale(w, 1, d);
  return geo;
}

// ---------------------------------------------------------------------------
// canvas painting helpers (albedo + bump textures)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// environments — the place a theme happens in
// ---------------------------------------------------------------------------
//
// `ThemeDef.environment` is built once per run rather than once per layer, so
// it can afford real geometry — but only if it is merged hard. Everything here
// returns raw BufferGeometry so a whole class of props (every terracotta pot,
// every glass jar) collapses into a single draw call through `mergeAll`.
//
// The camera is the reason for most of the numbers a caller will pass in. It
// sits ~10 units out from the tower axis at a fixed 0.5 rad pitch, so the
// horizon is always just off the top of the frame: everything on screen is
// below eye level, distant things ride HIGH in the frame, and a prop's base is
// hidden by the table whenever it stands further out and lower down than the
// table's far edge. That is what lets background scenery stand on a floor that
// is never drawn.

/** Prop-count multiplier per tier. Low keeps the hero props and drops the rest. */
export function envDetail(quality: QualityTier): number {
  return quality === 'high' ? 1 : quality === 'medium' ? 0.7 : 0.42;
}

/** Scale an environment prop count by tier, never below `min`. */
export function envCount(quality: QualityTier, base: number, min = 0): number {
  const n = Math.round(base * envDetail(quality));
  return Math.max(min, Math.max(0, n));
}

/** Segment count per tier for environment geometry. */
export function envSeg(quality: QualityTier, high: number, medium: number, low: number): number {
  const v = quality === 'high' ? high : quality === 'medium' ? medium : low;
  return Math.max(3, Math.round(v));
}

/**
 * A surface of revolution from a `[radius, y]` profile — jars, pots, bottles,
 * cake stands, spools. The single most useful shape in a kitchen environment,
 * and the kit has no equivalent because food is rarely turned on a lathe.
 *
 * Returns null rather than throwing on a degenerate profile.
 */
export function lathe(
  profile: ReadonlyArray<readonly [number, number]>,
  segments = 16,
  opts: { phiStart?: number; phiLength?: number } = {},
): THREE.BufferGeometry | null {
  const pts: THREE.Vector2[] = [];
  for (const [r, y] of profile) {
    if (!Number.isFinite(r) || !Number.isFinite(y)) return null;
    pts.push(new THREE.Vector2(Math.max(r, 0), y));
  }
  if (pts.length < 2) return null;
  const geo = new THREE.LatheGeometry(
    pts,
    Math.max(3, Math.round(segments)),
    opts.phiStart ?? 0,
    opts.phiLength ?? TAU,
  );
  geo.computeVertexNormals();
  return geo;
}

/**
 * Points along a cord hanging between two anchors. A straight line between two
 * poles reads as fake instantly; this is the curve a real string takes.
 */
export function catenary(
  a: THREE.Vector3,
  b: THREE.Vector3,
  sag: number,
  steps = 16,
): THREE.Vector3[] {
  const n = Math.max(2, Math.round(steps));
  const out: THREE.Vector3[] = [];
  const k = 1.6;
  const coshK = Math.cosh(k);
  const denom = coshK - 1 || 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const droop = (coshK - Math.cosh(k * (t * 2 - 1))) / denom;
    out.push(
      new THREE.Vector3(
        lerp(a.x, b.x, t),
        lerp(a.y, b.y, t) - sag * droop,
        lerp(a.z, b.z, t),
      ),
    );
  }
  return out;
}

export interface FlagLineOpts {
  /** Colours cycled through the flags; each is baked into vertex colours. */
  colors: readonly number[];
  cordColor?: number;
  sag?: number;
  cordRadius?: number;
  flags?: number;
  flagWidth?: number;
  flagDrop?: number;
  /** 'pennant' is a triangle (bunting); 'papel' is a notched rectangle. */
  shape?: 'pennant' | 'papel';
  /** Random yaw either side of square-on, in radians, so flags catch the light. */
  twist?: number;
  segments?: number;
}

/**
 * A cord strung between two anchors with flags hanging off it — bunting over a
 * patisserie counter, papel picado over a patio. Everything is baked into one
 * geometry with vertex colours, so a whole party's worth of flags is one draw.
 *
 * The flags face outward from the cord, which is what makes them read from any
 * camera angle: a line strung tangentially around the scene always presents
 * its flags broadside to a camera orbiting the middle.
 */
export function flagLine(
  a: THREE.Vector3,
  b: THREE.Vector3,
  rng: Rng,
  opts: FlagLineOpts,
): THREE.BufferGeometry | null {
  const {
    colors,
    cordColor = 0x6b5a72,
    sag = 0.5,
    cordRadius = 0.012,
    flags = 9,
    flagWidth = 0.24,
    flagDrop = 0.3,
    shape = 'pennant',
    twist = 0.5,
    segments = 18,
  } = opts;
  if (!colors.length) return null;
  if (!Number.isFinite(a.x + a.y + a.z + b.x + b.y + b.z)) return null;

  const path = catenary(a, b, sag, segments);
  const parts: THREE.BufferGeometry[] = [];
  const cord = ribbon(path, cordRadius, { tubular: segments, radial: 3 });
  if (cord) parts.push(tintGeometry(cord, cordColor));

  const n = Math.max(0, Math.round(flags));
  const tangent = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const idx = clamp(Math.round(t * (path.length - 1)), 1, path.length - 1);
    const p = path[idx];
    tangent.copy(path[idx]).sub(path[idx - 1]);
    if (tangent.lengthSq() < 1e-10) continue;

    const w = flagWidth * rng.range(0.88, 1.12);
    const h = flagDrop * rng.range(0.85, 1.15);
    const s = new THREE.Shape();
    if (shape === 'papel') {
      s.moveTo(-w / 2, 0);
      s.lineTo(w / 2, 0);
      s.lineTo(w / 2, -h * 0.72);
      s.lineTo(0, -h);
      s.lineTo(-w / 2, -h * 0.72);
    } else {
      s.moveTo(-w / 2, 0);
      s.lineTo(w / 2, 0);
      s.lineTo(0, -h);
    }
    const flag = new THREE.ShapeGeometry(s);
    const yaw = Math.atan2(-tangent.z, tangent.x) + rng.signed() * twist;
    flag.rotateY(yaw);
    flag.translate(p.x, p.y - cordRadius * 0.5, p.z);
    parts.push(tintGeometry(flag, colors[i % colors.length]));
  }
  return mergeAll(parts);
}

/**
 * Merge a bucket of environment geometry into one draw call.
 *
 * `mergeAll` is strict in the way three's merger is strict: every input must
 * agree on indexing and on which attributes exist. That is fine for food,
 * where a layer is built from one family of shapes, but an environment mixes
 * extruded slabs (non-indexed, no colour) with lathes, spheres and shape
 * geometry (indexed, tinted). This levels them first — everything is
 * flattened to non-indexed and given whatever attribute the others carry — so
 * a whole material's worth of props really does collapse to a single mesh.
 */
export function mergeEnv(
  parts: Array<THREE.BufferGeometry | null | undefined>,
): THREE.BufferGeometry | null {
  const list = parts.filter(
    (p): p is THREE.BufferGeometry => !!p && !!p.attributes.position && p.attributes.position.count > 0,
  );
  if (!list.length) return null;

  const flat: THREE.BufferGeometry[] = [];
  for (const g of list) {
    if (g.index) {
      flat.push(g.toNonIndexed());
      g.dispose();
    } else {
      flat.push(g);
    }
  }

  const wantUv = flat.some((g) => !!g.attributes.uv);
  const wantColor = flat.some((g) => !!g.attributes.color);
  for (const g of flat) {
    const count = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (wantUv && !g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    if (wantColor && !g.attributes.color) {
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
    }
    for (const name of Object.keys(g.attributes)) {
      if (name === 'position' || name === 'normal') continue;
      if (name === 'uv' && wantUv) continue;
      if (name === 'color' && wantColor) continue;
      g.deleteAttribute(name);
    }
    g.morphAttributes = {};
  }
  return mergeAll(flat);
}

/**
 * Bake a vertical colour ramp into vertex colours. A distant wall painted one
 * flat colour reads as a cardboard cut-out; a wall that darkens toward the
 * floor reads as a room. Costs nothing at draw time and lets a whole
 * background share one vertex-coloured material.
 */
export function tintGradientY(
  geo: THREE.BufferGeometry,
  low: number,
  high: number,
  y0: number,
  y1: number,
): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const a = new THREE.Color(low).convertSRGBToLinear();
  const b = new THREE.Color(high).convertSRGBToLinear();
  const arr = new Float32Array(pos.count * 3);
  const span = Math.abs(y1 - y0) > 1e-6 ? y1 - y0 : 1;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = Number.isFinite(y) ? clamp01((y - y0) / span) : 0;
    arr[i * 3] = lerp(a.r, b.r, t);
    arr[i * 3 + 1] = lerp(a.g, b.g, t);
    arr[i * 3 + 2] = lerp(a.b, b.b, t);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export interface RingSlot {
  x: number;
  z: number;
  radius: number;
  /** Yaw that turns an object's +Z away from the middle. */
  yaw: number;
}

/**
 * Placements around the tower, one per angular sector with jitter inside it.
 * Sectors (rather than free random angles) are what stop three jars clumping
 * on one side and leaving the camera's far arc empty on the other — and the
 * home screen turns all the way around, so every arc gets its turn on screen.
 */
export function ringSlots(
  rng: Rng,
  count: number,
  rMin: number,
  rMax: number,
  opts: { jitter?: number; startAngle?: number } = {},
): RingSlot[] {
  const n = Math.max(0, Math.round(count));
  const out: RingSlot[] = [];
  if (n === 0) return out;
  const jitter = clamp01(opts.jitter ?? 0.62);
  const start = opts.startAngle ?? 0;
  const step = TAU / n;
  const lo = Math.max(0.01, Math.min(rMin, rMax));
  const hi = Math.max(lo + 1e-4, Math.max(rMin, rMax));
  for (let i = 0; i < n; i++) {
    const yaw = start + step * (i + 0.5 + rng.signed() * jitter * 0.5);
    const radius = rng.range(lo, hi);
    out.push({ x: Math.sin(yaw) * radius, z: Math.cos(yaw) * radius, radius, yaw });
  }
  return out;
}

/**
 * The table itself: a rounded slab whose TOP FACE lands exactly on `top`, with
 * the whole body hanging below it. Exactness matters — the plate is already
 * sitting on that plane, so a slab a hair too high punches through it.
 */
export function tableSlab(
  width: number,
  depth: number,
  thickness: number,
  opts: { radius?: number; segments?: number; top?: number } = {},
): THREE.BufferGeometry {
  const w = Math.max(width, MIN_DIM);
  const d = Math.max(depth, MIN_DIM);
  const t = Math.max(thickness, 0.02);
  const r = safeRadius(opts.radius ?? Math.min(w, d) * 0.12, w, d, t);
  const geo = roundedBox(w, t, d, r, Math.max(1, Math.round(opts.segments ?? 3)));
  geo.translate(0, (opts.top ?? 0) - t, 0);
  return geo;
}

/**
 * A point on the boundary of a rounded rectangle, parameterised by angle.
 * Used to walk a table's perimeter — scalloped valances, edge trim, the line
 * of pots along a wall — without re-deriving the corner arcs every time.
 */
export function rectPerimeter(halfW: number, halfD: number, angle: number, round = 0.55): THREE.Vector2 {
  const a = Math.max(halfW, 1e-4);
  const b = Math.max(halfD, 1e-4);
  const n = 2 + (1 - clamp01(round)) * 8;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = Math.pow(Math.pow(Math.abs(c), n) + Math.pow(Math.abs(s), n), -1 / n);
  return new THREE.Vector2(a * c * k, b * s * k);
}

/**
 * Bake aerial perspective into vertex colours by distance from the tower axis.
 *
 * `FogExp2` at the densities the palettes authorise does almost nothing at the
 * distances an environment actually occupies: the wall a theme stands in front
 * of is ~23 units from the camera and comes back around 11% fogged, which is
 * invisible. So a background layer that is supposed to *recede* has to be
 * painted receding, and painting it by hand per prop is how a scene ends up
 * with a distant ridge that is darker than the roofs in front of it.
 *
 * This does it by measurement instead. Radius from the tower axis is the right
 * distance to use rather than range from the camera, because the home screen
 * orbits a full turn: a ridge that greys out correctly at one yaw has to grey
 * out identically at every other one, and radius is yaw-independent by
 * construction.
 *
 * Multiplies into whatever colour the geometry already carries, so it composes
 * after `tintGeometry` / `tintGradientY` rather than replacing them.
 */
export function hazeByRadius(
  geo: THREE.BufferGeometry,
  haze: number,
  near: number,
  far: number,
  maxMix = 0.8,
  lift = 1,
): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return geo;
  const prev = geo.attributes.color as THREE.BufferAttribute | undefined;
  const h = new THREE.Color(haze).convertSRGBToLinear();
  // In-scattered light ADDS, it does not tint: a ridge ten units further back
  // is not just closer to the sky's hue, it is closer to the sky's brightness,
  // and the sky is written straight to the framebuffer while the ridge has to
  // survive a key light and a tone curve first. `lift` is the licence to push
  // the target past 1.0 in linear space so the far layers actually arrive
  // where the sky is instead of stopping at a dark version of its colour.
  const l = Math.max(lift, 0);
  h.multiplyScalar(l);
  const span = Math.abs(far - near) > 1e-6 ? far - near : 1;
  const cap = clamp01(maxMix);
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const t = (Number.isFinite(r) ? clamp01((r - near) / span) : 0) * cap;
    const cr = prev ? prev.getX(i) : 1;
    const cg = prev ? prev.getY(i) : 1;
    const cb = prev ? prev.getZ(i) : 1;
    arr[i * 3] = lerp(cr, h.r, t);
    arr[i * 3 + 1] = lerp(cg, h.g, t);
    arr[i * 3 + 2] = lerp(cb, h.b, t);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * A soft radial falloff painted with real alpha, for use as the `map` of a
 * transparent emissive material.
 *
 * This is how a light source gets to look like one without costing a light: a
 * quad wearing this texture, hung tangentially on the same ring as the bulb it
 * belongs to, stays broadside to a camera that only ever orbits horizontally.
 * The same texture lying flat on a table is the pool the lamp throws.
 */
export function radialGlow(
  c: CanvasRenderingContext2D,
  size: number,
  color = '#ffffff',
  core = 0.14,
  gamma = 2.2,
): void {
  c.clearRect(0, 0, size, size);
  const half = size / 2;
  const g = c.createRadialGradient(half, half, 0, half, half, half);
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const inner = clamp01((t - core) / Math.max(1 - core, 1e-3));
    const a = Math.pow(1 - inner, gamma);
    g.addColorStop(t, `rgba(255,255,255,${a.toFixed(4)})`);
  }
  c.save();
  c.fillStyle = color;
  c.fillRect(0, 0, size, size);
  c.globalCompositeOperation = 'destination-in';
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  c.restore();
}

/**
 * A quad standing on a ring, facing the tower axis — the billboard a merged,
 * static environment is allowed to have. Because the camera only ever orbits
 * horizontally, a quad whose normal points at the axis is within a few degrees
 * of broadside at every yaw, which is the same reason the flag lines read from
 * anywhere.
 */
export function facingQuad(
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(Math.max(width, 1e-3), Math.max(height, 1e-3));
  geo.rotateY(Math.atan2(x, z) + Math.PI);
  geo.translate(x, y, z);
  return geo;
}

export { THREE };
