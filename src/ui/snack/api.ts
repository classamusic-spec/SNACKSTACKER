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
  throw new Error('snack kit not implemented');
}

/**
 * An SVG path `d` for a shape's outline, in a 0..100 x 0..100 viewBox so the
 * caller can scale it with `preserveAspectRatio="none"` or use it in a
 * `clip-path`.
 */
export function edgePath(_edge: EdgeKind, _seed: string): string {
  throw new Error('snack kit not implemented');
}

export interface SplatOpts {
  seed: string;
  /** Satellite droplets flung from the main mass. 0 disables. */
  droplets?: number;
  /** 0..1 — how much the rim wobbles. A smooth blob is clipart. */
  irregularity?: number;
  /** Drips running down from the lower edge. */
  drips?: number;
}

/**
 * The ketchup splat, as an SVG path in a 0..100 x 0..100 viewBox. Must be
 * asymmetric with an uneven rim; a smooth ellipse is not a splat.
 */
export function splatPath(_opts: SplatOpts): string {
  throw new Error('snack kit not implemented');
}

/** A dotted tear-line, as an SVG path across a 0..100 width. */
export function tearLinePath(_seed: string): string {
  throw new Error('snack kit not implemented');
}

/** Hand-drawn ink underline for focus/selection, as an SVG path. */
export function inkUnderlinePath(_seed: string, _width: number): string {
  throw new Error('snack kit not implemented');
}

/** Release every cached texture. */
export function disposeSnackKit(): void {
  throw new Error('snack kit not implemented');
}
