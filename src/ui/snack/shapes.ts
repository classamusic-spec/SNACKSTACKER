/**
 * Silhouettes. A shape's outline is most of its identity, so none of these are
 * primitives: every edge is a seeded walk, every side is different from its
 * opposite, and nothing is symmetric.
 *
 * All geometry lives in a 0..100 x 0..100 box and is meant to be stretched
 * (`preserveAspectRatio="none"`, or a percentage `clip-path`). Because the box
 * distorts, features that must read at a consistent size on a typical card are
 * authored against `CARD_ASPECT`: a horizontal edge gets ~2x the wavelength of
 * a vertical one so the scallops come out roughly round on a real card.
 */

import type { EdgeKind, SplatOpts } from './api';
import type { Rng } from './rng';
import { makeFbm1, makeRng } from './rng';

export type Point = readonly [number, number];

/** The shape of the thing these clip: a mode card, roughly 2:1. */
const CARD_ASPECT = 2.1;

/**
 * The shape of the thing a splat sits behind: a primary button, wide and low.
 * `SplatOpts.aspect` overrides it; this is what an unqualified `splatPath()`
 * assumes, because the primary button is the only place the splat is used.
 */
export const DEFAULT_SPLAT_ASPECT = 3.2;

/**
 * A whisker of inset so an outward deckle bulge has somewhere to go. The
 * contact shadow needs no room here: it is a `filter: drop-shadow()` on the
 * element, which paints outside the box for free.
 */
const MARGIN = { l: 0.8, r: 0.8, t: 0.8, b: 0.9 } as const;

/* ------------------------------------------------------------------- paths */

const n2 = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Closed outline through `pts`, smoothed by quadratics through the midpoints. */
export function smoothClosed(pts: readonly Point[]): string {
  if (pts.length < 3) return '';
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const first = mid(pts[pts.length - 1], pts[0]);
  let d = `M${n2(first[0])} ${n2(first[1])}`;
  for (let i = 0; i < pts.length; i += 1) {
    const cur = pts[i];
    const m = mid(cur, pts[(i + 1) % pts.length]);
    d += `Q${n2(cur[0])} ${n2(cur[1])} ${n2(m[0])} ${n2(m[1])}`;
  }
  return `${d}Z`;
}

/** Straight-sided closed outline — for rips, where every facet should be flat. */
export function polyClosed(pts: readonly Point[]): string {
  if (pts.length < 3) return '';
  let d = `M${n2(pts[0][0])} ${n2(pts[0][1])}`;
  for (let i = 1; i < pts.length; i += 1) d += `L${n2(pts[i][0])} ${n2(pts[i][1])}`;
  return `${d}Z`;
}

/**
 * Force a consistent winding. Subpaths of one filled shape must all wind the
 * same way or the non-zero fill rule punches the overlaps out — which is what
 * turned the splat's drips into holes.
 */
function orient(pts: readonly Point[], positive: boolean): Point[] {
  let twice = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    twice += a[0] * b[1] - b[0] * a[1];
  }
  const list = pts.slice();
  return twice > 0 === positive ? list : list.reverse();
}

/** Open smoothed stroke — underlines and drips. */
export function smoothOpen(pts: readonly Point[]): string {
  if (pts.length < 2) return '';
  let d = `M${n2(pts[0][0])} ${n2(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const cur = pts[i];
    const next = pts[i + 1];
    d += `Q${n2(cur[0])} ${n2(cur[1])} ${n2((cur[0] + next[0]) / 2)} ${n2((cur[1] + next[1]) / 2)}`;
  }
  const last = pts[pts.length - 1];
  return `${d}L${n2(last[0])} ${n2(last[1])}`;
}

/** `clip-path: polygon(...)` in percentages, so the shape scales with the box. */
export function toPolygon(pts: readonly Point[], max = 148): string {
  const step = Math.max(1, Math.ceil(pts.length / max));
  const parts: string[] = [];
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i];
    parts.push(`${(Math.round(p[0] * 10) / 10).toFixed(1)}% ${(Math.round(p[1] * 10) / 10).toFixed(1)}%`);
  }
  return `polygon(${parts.join(',')})`;
}

/* ------------------------------------------------------------------- edges */

type Side = 0 | 1 | 2 | 3; // top, right, bottom, left

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Outward normal for each side, in viewBox units. */
const NORMAL: Readonly<Record<Side, Point>> = {
  0: [0, -1],
  1: [1, 0],
  2: [0, 1],
  3: [-1, 0],
};

function sideEnds(box: Box, side: Side): [Point, Point] {
  switch (side) {
    case 0:
      return [[box.x0, box.y0], [box.x1, box.y0]];
    case 1:
      return [[box.x1, box.y0], [box.x1, box.y1]];
    case 2:
      return [[box.x1, box.y1], [box.x0, box.y1]];
    default:
      return [[box.x0, box.y1], [box.x0, box.y0]];
  }
}

/** Walk the four sides, displacing each sample along its outward normal. */
function walk(
  box: Box,
  samples: (side: Side) => number,
  offset: (side: Side, t: number, index: number) => number,
): Point[] {
  const pts: Point[] = [];
  for (let s = 0 as Side; s <= 3; s = (s + 1) as Side) {
    const [a, b] = sideEnds(box, s);
    const n = samples(s);
    const nx = NORMAL[s][0];
    const ny = NORMAL[s][1];
    for (let i = 0; i < n; i += 1) {
      const t = i / n;
      const o = offset(s, t, i);
      pts.push([a[0] + (b[0] - a[0]) * t + nx * o, a[1] + (b[1] - a[1]) * t + ny * o]);
    }
  }
  return pts;
}

export interface EdgeShape {
  /** SVG path `d` in the 0..100 viewBox. */
  d: string;
  /** The outline's samples, kept so a caller can ask for a `clip-path` too. */
  points: readonly Point[];
}

function deckle(rng: Rng, seed: string): EdgeShape {
  const amp: number[] = [];
  const freq: number[] = [];
  const phase: number[] = [];
  const wander: Array<(x: number) => number> = [];
  const grit: Array<(x: number) => number> = [];
  for (let s = 0; s <= 3; s += 1) {
    const vertical = s === 1 || s === 3;
    amp.push(rng.range(0.55, 1.15) * (vertical ? CARD_ASPECT * 0.62 : 1));
    freq.push(rng.range(3.2, 5.4));
    phase.push(rng.next() * 10);
    wander.push(makeFbm1(`${seed}:deckle:${s}`, 16));
    grit.push(makeFbm1(`${seed}:grit:${s}`, 40));
  }
  const inset = Math.max(...amp);
  const box: Box = {
    x0: MARGIN.l + inset,
    y0: MARGIN.t + inset * 0.6,
    x1: 100 - MARGIN.r - inset,
    y1: 100 - MARGIN.b - inset * 0.6,
  };
  const samples = (s: Side): number => (s === 1 || s === 3 ? 20 : 34);
  const pts = walk(box, samples, (s, t) => {
    const body = wander[s](t * freq[s] + phase[s]);
    const fine = grit[s](t * freq[s] * 6 + phase[s]) * 0.42;
    // The odd fibre standing proud of the edge is what sells "torn", not "cut".
    const spike = ((s * 7 + Math.round(t * 97)) % 13 === 0 ? 0.5 : 0) * (fine > 0 ? 1 : -1);
    return (body + fine + spike) * amp[s];
  });
  return { d: smoothClosed(pts), points: pts };
}

function scallop(rng: Rng, seed: string): EdgeShape {
  // Bumps in viewBox units are stretched by the element, so a horizontal edge
  // needs roughly CARD_ASPECT times the wavelength of a vertical one to end up
  // looking like the same bump.
  const bumpsH = rng.int(9, 11);
  const bumpsV = Math.max(3, Math.round(bumpsH / CARD_ASPECT));
  const ampH = rng.range(1.9, 2.3);
  const ampV = ampH * CARD_ASPECT * 0.82;
  const jitter = makeFbm1(`${seed}:scallop`, 12);
  const box: Box = {
    x0: MARGIN.l + ampV,
    y0: MARGIN.t + ampH,
    x1: 100 - MARGIN.r - ampV,
    y1: 100 - MARGIN.b - ampH,
  };
  const phase = [rng.next(), rng.next(), rng.next(), rng.next()];
  const samples = (s: Side): number => (s === 1 || s === 3 ? bumpsV * 7 : bumpsH * 7);
  const pts = walk(box, samples, (s, t) => {
    const vertical = s === 1 || s === 3;
    const bumps = vertical ? bumpsV : bumpsH;
    const amp = vertical ? ampV : ampH;
    const u = (t * bumps + phase[s]) % 1;
    // A half-disc profile: doily bumps, not a sine.
    const lobe = Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2));
    const vary = 1 + jitter(t * bumps * 1.7 + s * 3) * 0.16;
    return lobe * amp * vary;
  });
  return { d: smoothClosed(pts), points: pts };
}

function torn(rng: Rng, seed: string): EdgeShape {
  const ripSide = rng.pick<Side>([0, 1, 2, 3]);
  const vertical = ripSide === 1 || ripSide === 3;
  const amp = vertical ? rng.range(5.5, 8) * CARD_ASPECT * 0.55 : rng.range(4, 6.5);
  const body = makeFbm1(`${seed}:rip`, 11);
  const detail = makeFbm1(`${seed}:rip:fine`, 44);
  const box: Box = {
    x0: MARGIN.l + (ripSide === 3 ? amp : 0.4),
    y0: MARGIN.t + (ripSide === 0 ? amp : 0.4),
    x1: 100 - MARGIN.r - (ripSide === 1 ? amp : 0.4),
    y1: 100 - MARGIN.b - (ripSide === 2 ? amp : 0.4),
  };
  const samples = (s: Side): number => {
    if (s !== ripSide) return s === 1 || s === 3 ? 4 : 6;
    return vertical ? 30 : 46;
  };
  const pts = walk(box, samples, (s, t) => {
    if (s !== ripSide) return (body(t * 2 + s * 5) * 0.22) as number;
    // Taper the rip into the corners so the sheet still has corners.
    const taper = Math.min(1, Math.min(t, 1 - t) * 7);
    // Three scales: where the sheet gave way, how it wandered, and the fibre.
    const bay = body(t * 1.7) * 0.72;
    const coarse = detail(t * 5.3) * 0.4;
    const fine = detail(t * 23) * 0.16;
    const flat = Math.abs(body(t * 3.1)) < 0.12 ? -0.18 : 0;
    return (0.46 + bay + coarse + fine + flat) * amp * taper;
  });
  return { d: polyClosed(pts), points: pts };
}

function perforated(rng: Rng, seed: string): EdgeShape {
  const bites = rng.int(13, 17);
  const rx = 100 / bites / 2.6;
  const ry = rx * 1.5;
  const bothEnds = rng.chance(0.45);
  const shift = rng.range(0, 0.9);
  const box: Box = { x0: MARGIN.l, y0: MARGIN.t, x1: 100 - MARGIN.r, y1: 100 - MARGIN.b };
  const wobble = makeFbm1(`${seed}:perf`, 18);
  const samples = (s: Side): number => (s === 0 || (s === 2 && bothEnds) ? bites * 9 : 5);
  const pts = walk(box, samples, (s, t) => {
    if (s === 0 || (s === 2 && bothEnds)) {
      const u = (t * bites + (s === 2 ? shift + 0.5 : shift)) % 1;
      // Flat land, with a round bite punched into it. Land that bulges
      // *outward* between the holes reads as a scallop, not a perforation.
      const inBite = Math.abs(u - 0.5) < 0.4;
      const k = inBite ? Math.sqrt(Math.max(0, 1 - ((u - 0.5) / 0.4) ** 2)) : 0;
      return -ry * k + wobble(t * 26) * 0.12;
    }
    return wobble(t * 6 + s) * 0.16;
  });
  return { d: smoothClosed(pts), points: pts };
}

function clean(rng: Rng): EdgeShape {
  // A plain rect — but even a guillotined sheet is a fraction out of square,
  // and the seeded skew keeps `clean` honest with the rest of the kit.
  const j = (): number => rng.range(-0.22, 0.22);
  const pts: Point[] = [
    [MARGIN.l + j(), MARGIN.t + j()],
    [100 - MARGIN.r + j(), MARGIN.t + j()],
    [100 - MARGIN.r + j(), 100 - MARGIN.b + j()],
    [MARGIN.l + j(), 100 - MARGIN.b + j()],
  ];
  return { d: polyClosed(pts), points: pts };
}

export function buildEdge(edge: EdgeKind, seed: string): EdgeShape {
  const rng = makeRng(`snack-edge:${edge}:${seed}`);
  switch (edge) {
    case 'deckle':
      return deckle(rng, seed);
    case 'scallop':
      return scallop(rng, seed);
    case 'torn':
      return torn(rng, seed);
    case 'perforated':
      return perforated(rng, seed);
    default:
      return clean(rng);
  }
}

/* ------------------------------------------------------------------- splat */

export interface SplatShape {
  d: string;
  /** Just the main mass, for a shadow that does not shadow every droplet. */
  core: string;
}

export function buildSplat(opts: SplatOpts): SplatShape {
  const rng = makeRng(`snack-splat:${opts.seed}`);
  const irregularity = Math.max(0, Math.min(1, opts.irregularity ?? 0.6));
  const droplets = Math.max(0, Math.round(opts.droplets ?? 5));
  const drips = Math.max(0, Math.round(opts.drips ?? 2));
  // How wide the 0..100 box will be stretched. Everything that must stay
  // *round* on screen — a flung droplet, the width of a drip, the size of a
  // rim lobe — is authored in y-units and divided by this on the way out.
  // Without it a primary button smears the splat 5:1 into clipart.
  const aspect = Math.max(0.4, Math.min(9, opts.aspect ?? DEFAULT_SPLAT_ASPECT));

  // Off-centre on purpose. A splat centred in its box is a logo.
  const cx = 50 + rng.range(-2.5, 2.5);
  const cy = 45 + rng.range(-2.5, 2.5);
  const hx = 35;
  const hy = 27;

  // Screen-space semi-axes, so the rim can be walked at a constant physical
  // spacing instead of bunching up at the ends of the long axis.
  const A = hx * aspect;
  const B = hy;
  const steps = 512;
  const cum: number[] = [0];
  for (let i = 1; i <= steps; i += 1) {
    const t0 = ((i - 1) / steps) * Math.PI * 2;
    const t1 = (i / steps) * Math.PI * 2;
    cum.push(cum[i - 1] + Math.hypot(A * (Math.cos(t1) - Math.cos(t0)), B * (Math.sin(t1) - Math.sin(t0))));
  }
  const perimeter = cum[steps];
  const tAt = (frac: number): number => {
    const target = (frac - Math.floor(frac)) * perimeter;
    let lo = 0;
    let hi = steps;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return (lo / steps) * Math.PI * 2;
  };

  // Rim features, placed by fraction of the perimeter so they are the same
  // physical size wherever they land. Fingers are the arms of the impact;
  // bites are where the mass pulled back and left a concave scallop.
  interface Feature { at: number; width: number; amp: number }
  const features: Feature[] = [];
  const fingerCount = rng.int(3, 5);
  for (let i = 0; i < fingerCount; i += 1) {
    features.push({
      at: rng.next(),
      width: rng.range(0.014, 0.042),
      amp: hy * rng.range(0.22, 0.52),
    });
  }
  const biteCount = rng.int(2, 4);
  for (let i = 0; i < biteCount; i += 1) {
    features.push({
      at: rng.next(),
      width: rng.range(0.03, 0.075),
      amp: -hy * rng.range(0.1, 0.22),
    });
  }
  const wander = makeFbm1(`${opts.seed}:rim`, 13);

  const rimAt = (frac: number): Point => {
    const t = tAt(frac);
    let push = wander(frac * 13) * hy * 0.19;
    for (const f of features) {
      let dd = Math.abs(frac - f.at);
      if (dd > 0.5) dd = 1 - dd;
      push += f.amp * Math.exp(-((dd / f.width) ** 2));
    }
    push *= irregularity * 1.35 + 0.12;
    const nx = B * Math.cos(t);
    const ny = A * Math.sin(t);
    const nl = Math.hypot(nx, ny) || 1;
    return [
      cx + hx * Math.cos(t) + ((nx / nl) * push) / aspect,
      cy + hy * Math.sin(t) + (ny / nl) * push,
    ];
  };

  const rimSteps = Math.max(56, Math.min(120, Math.round(perimeter / (hy * 0.13))));
  const rim: Point[] = [];
  for (let i = 0; i < rimSteps; i += 1) rim.push(rimAt(i / rimSteps));
  const core = smoothClosed(orient(rim, true));
  let d = core;

  // Satellites. Flung along a dominant direction, and the further they land
  // the smaller they are — momentum spends itself on distance.
  if (droplets > 0) {
    const heading = rng.next() * Math.PI * 2;
    for (let i = 0; i < droplets; i += 1) {
      const t = heading + rng.range(-1.2, 1.2) + rng.gauss() * 0.6;
      const reach = rng.range(0.08, 1);
      const dist = 1.2 + reach * 0.6;
      const size = (1 - reach) ** 1.15 * 4.6 + 0.8;
      let px = cx + Math.cos(t) * hx * dist;
      let py = cy + Math.sin(t) * hy * dist;
      const padX = size / aspect + 0.8;
      const padY = size + 0.8;
      const over = Math.max(
        (padX - px) / Math.max(1e-3, cx - px + padX),
        (px - (100 - padX)) / Math.max(1e-3, px - cx + padX),
        (padY - py) / Math.max(1e-3, cy - py + padY),
        (py - (100 - padY)) / Math.max(1e-3, py - cy + padY),
        0,
      );
      if (over > 0) {
        const pull = Math.min(1, over);
        px += (cx - px) * pull;
        py += (cy - py) * pull;
      }
      // Elongate along the direction of travel, measured on screen.
      const sang = Math.atan2(Math.sin(t) * hy, Math.cos(t) * hx * aspect);
      const stretch = 1 + reach * 0.9;
      const pts: Point[] = [];
      const n = 9;
      for (let j = 0; j < n; j += 1) {
        const a = (j / n) * Math.PI * 2;
        const k = 1 + rng.gauss() * 0.34;
        const ex = Math.cos(a) * size * k * stretch;
        const ey = Math.sin(a) * size * k;
        const sx = ex * Math.cos(sang) - ey * Math.sin(sang);
        const sy = ex * Math.sin(sang) + ey * Math.cos(sang);
        pts.push([px + sx / aspect, py + sy]);
      }
      d += smoothClosed(orient(pts, true));
    }
  }

  // Drips. They leave the underside of the mass, narrow as they run, and end
  // in a heavy bead that has not fallen yet.
  for (let i = 0; i < drips; i += 1) {
    const frac = 0.25 - 0.5 * 0.5 + rng.range(0.06, 0.44); // lower half of the rim
    const from = rimAt(frac);
    const ox = from[0];
    const oy = from[1] - hy * 0.16;
    const len = rng.range(13, 26);
    const w0 = rng.range(3.4, 5) / aspect;
    const w1 = w0 * rng.range(0.42, 0.62);
    const lean = (rng.gauss() * 4) / aspect;
    const bead = w1 * rng.range(1.5, 2.1);
    const ty = Math.min(97 - bead, oy + len);
    const tx = ox + lean;
    const midY = oy + (ty - oy) * 0.55;
    const pts: Point[] = [
      [ox - w0, oy],
      [ox - w1 - Math.abs(lean) * 0.1 + lean * 0.45, midY],
      [tx - bead, ty - bead * 0.9],
      [tx - bead * 0.55, ty + bead * 0.55],
      [tx + bead * 0.55, ty + bead * 0.55],
      [tx + bead, ty - bead * 0.9],
      [ox + w1 + Math.abs(lean) * 0.1 + lean * 0.45, midY],
      [ox + w0, oy],
    ];
    d += smoothClosed(orient(pts, true));
  }

  return { d, core };
}

/**
 * Dotted tear-line across a 0..100 x 0..6 box.
 *
 * Authored as short dashes rather than dots so it survives being *stroked*
 * (`fill:none; stroke:currentColor`) as well as filled — components render it
 * inline so the perforation inherits the ink colour of whatever it divides.
 */
export function buildTearLine(seed: string): string {
  const rng = makeRng(`snack-tear:${seed}`);
  const count = rng.int(17, 21);
  const step = 100 / count;
  const drift = makeFbm1(`${seed}:tear`, 10);
  let d = '';
  for (let i = 0; i < count; i += 1) {
    const centre = step * (i + 0.5) + rng.gauss() * 0.55;
    const half = step * rng.range(0.2, 0.32);
    const y = 3 + drift(i * 0.8) * 0.45;
    const y2 = y + rng.gauss() * 0.22;
    d += `M${n2(centre - half)} ${n2(y)}L${n2(centre + half)} ${n2(y2)}`;
  }
  return d;
}

/* ----------------------------------------------------------- ink underline */

/**
 * A hand-drawn underline: one confident pass that overshoots at the start and
 * lifts at the end, plus a lighter second pass that does not quite track it.
 */
export function buildUnderline(seed: string, width: number): string {
  const rng = makeRng(`snack-underline:${seed}`);
  const w = Math.max(8, width);
  const wander = makeFbm1(`${seed}:ink`, 9);
  const steps = Math.max(10, Math.round(w / 4.5));
  const baseY = 4.1 + rng.range(-0.5, 0.5);
  const lift = rng.range(1.4, 2.8);
  // Nobody draws a level line freehand.
  const slope = rng.range(-1.3, 0.7);
  const main: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = -1.2 + t * (w + 2.2);
    const y = baseY + slope * t + wander(t * 5.2) * 2.2 + Math.sin(t * 9.1 + baseY) * 0.3 - t * t * lift;
    main.push([x, y]);
  }
  const second: Point[] = [];
  const from = rng.range(0.06, 0.2);
  const to = rng.range(0.72, 0.94);
  const s2 = Math.max(4, Math.round(steps * (to - from)));
  for (let i = 0; i <= s2; i += 1) {
    const t = from + (to - from) * (i / s2);
    const x = -1.2 + t * (w + 2.2);
    const y = baseY + 1.5 + slope * t * 0.8 + wander(t * 5.2 + 5) * 1.6 - t * t * lift * 0.6;
    second.push([x, y]);
  }
  return `${smoothOpen(main)}${smoothOpen(second)}`;
}
