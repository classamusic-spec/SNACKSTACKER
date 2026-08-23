import type { ThemeId } from '../../core/types';

/**
 * Snack-material UI kit.
 *
 * Every surface in the interface is made of something a snack arrives on. This
 * is the shared vocabulary so three screens do not invent three different
 * papers. See docs/DESIGN.md §8.
 */

export type PaperKind =
  | 'napkin'
  | 'greaseproof'
  | 'ticket'
  | 'menucard'
  | 'board';

/** Edge treatments. A shape's silhouette is most of its identity. */
export type EdgeKind =
  | 'deckle'
  | 'scallop'
  | 'torn'
  | 'perforated'
  | 'clean';

export interface PaperOpts {
  kind: PaperKind;
  /**
   * Stable seed. The SAME key must always produce the SAME irregularity — a
   * card that reshuffles its deckle on every mount is nauseating.
   */
  seed: string;
  edge?: EdgeKind;
  /** Theme, so Diner gets gingham and Sushi gets washi. */
  theme?: ThemeId;
  /** Base tint; defaults to the paper's natural colour. */
  tint?: number;
  /** 0..1 — how worn. Stains, creases, softened corners. */
  wear?: number;
  /** Degrees of casual rotation. Small: 1–3 reads as placed, 8 reads as sloppy. */
  tilt?: number;
}

/**
 * A CSS `background-image` value (a data: URL) for the paper's surface —
 * fibre, weave and stains — painted once and cached by every option that
 * affects it. Callers set it on an element; the kit never owns layout.
 */
export function paperTexture(_opts: PaperOpts): string {
  return memo(paperCache, paperKey(_opts), () => paintPaper(_opts));
}

/**
 * An SVG path `d` for a shape's outline, in a 0..100 x 0..100 viewBox so the
 * caller can scale it with `preserveAspectRatio="none"` or use it in a
 * `clip-path`.
 */
export function edgePath(_edge: EdgeKind, _seed: string): string {
  return edgeShape(_edge, _seed).d;
}

export interface SplatOpts {
  seed: string;
  /** Satellite droplets flung from the main mass. 0 disables. */
  droplets?: number;
  /** 0..1 — how much the rim wobbles. A smooth blob is clipart. */
  irregularity?: number;
  /** Drips running down from the lower edge. */
  drips?: number;
  /**
   * How wide the 0..100 box will be stretched when it is drawn — a primary
   * button is roughly 5:1, and a square splat stretched 5:1 is exactly the
   * smeared clipart DESIGN §8 warns about. Droplet shapes, drip widths and rim
   * lobes are pre-compensated by this so they come out round on screen.
   * Defaults to a primary button's proportions; pass 1 for a square render.
   */
  aspect?: number;
}

/**
 * The ketchup splat, as an SVG path in a 0..100 x 0..100 viewBox. Must be
 * asymmetric with an uneven rim; a smooth ellipse is not a splat.
 */
export function splatPath(_opts: SplatOpts): string {
  return splatShape(_opts).d;
}

/** A dotted tear-line, as an SVG path across a 0..100 width. */
export function tearLinePath(_seed: string): string {
  return memo(tearCache, _seed, () => buildTearLine(_seed));
}

/** Hand-drawn ink underline for focus/selection, as an SVG path. */
export function inkUnderlinePath(_seed: string, _width: number): string {
  const w = Math.max(8, Math.round(_width));
  return memo(underlineCache, `${_seed}|${w}`, () => buildUnderline(_seed, w));
}

/** Release every cached texture. */
export function disposeSnackKit(): void {
  paperCache.clear();
  edgeCache.clear();
  edgeMaskCache.clear();
  edgeClipCache.clear();
  splatCache.clear();
  tearCache.clear();
  underlineCache.clear();
}

/* ========================================================================== *
 * Implementation. The signatures above are the frozen contract; everything
 * below is private plumbing plus the caches that make the contract's "painted
 * once" promise true.
 * ========================================================================== */

import { paintPaper } from './paper';
import type { EdgeShape, SplatShape } from './shapes';
import {
  buildEdge,
  buildSplat,
  buildTearLine,
  buildUnderline,
  DEFAULT_SPLAT_ASPECT,
  toPolygon,
} from './shapes';
import { svg } from './svg';

const paperCache = new Map<string, string>();
const edgeCache = new Map<string, EdgeShape>();
const edgeMaskCache = new Map<string, string>();
const edgeClipCache = new Map<string, string>();
const splatCache = new Map<string, SplatShape>();
const tearCache = new Map<string, string>();
const underlineCache = new Map<string, string>();

function memo<T>(cache: Map<string, T>, key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const made = make();
  cache.set(key, made);
  return made;
}

/** Keyed on the full option set — two cards may legitimately differ by one. */
function paperKey(opts: PaperOpts): string {
  return [
    opts.kind,
    opts.seed,
    opts.edge ?? '-',
    opts.theme ?? '-',
    opts.tint ?? '-',
    opts.wear ?? 0,
    opts.tilt ?? 0,
  ].join('|');
}

/** Internal: the outline *and* its percentage `clip-path`, from one build. */
export function edgeShape(edge: EdgeKind, seed: string): EdgeShape {
  return memo(edgeCache, `${edge}|${seed}`, () => buildEdge(edge, seed));
}

/** Internal: the splat outline plus its core, from one build. */
export function splatShape(opts: SplatOpts): SplatShape {
  const key = [
    opts.seed,
    opts.droplets ?? 5,
    opts.irregularity ?? 0.6,
    opts.drips ?? 2,
    opts.aspect ?? DEFAULT_SPLAT_ASPECT,
  ].join('|');
  return memo(splatCache, key, () => buildSplat(opts));
}

/**
 * An edge as a CSS `mask-image` value — the form the stylesheet actually
 * consumes. A mask rather than a `clip-path` on purpose: a clip would also cut
 * away the element's contact shadow, its focus ring and its children, and the
 * kit is not allowed to own any of those.
 */
export function edgeMask(edge: EdgeKind, seed: string): string {
  return memo(edgeMaskCache, `${edge}|${seed}`, () =>
    svg(`<path d='${edgeShape(edge, seed).d}' fill='#000'/>`, { viewBox: '0 0 100 100' }),
  );
}

/** The same edge as a percentage `clip-path`, for a caller that wants one. */
export function edgeClip(edge: EdgeKind, seed: string): string {
  return memo(edgeClipCache, `${edge}|${seed}`, () => toPolygon(edgeShape(edge, seed).points));
}

/** How many textures and shapes the kit is currently holding. For dev tools. */
export function snackKitStats(): { textures: number; shapes: number; bytes: number } {
  let bytes = 0;
  for (const value of paperCache.values()) bytes += value.length;
  return {
    textures: paperCache.size,
    shapes:
      edgeCache.size + splatCache.size + tearCache.size + underlineCache.size,
    bytes,
  };
}
