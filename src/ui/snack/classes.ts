/**
 * The class vocabulary for the snack-material layer.
 *
 * `src/styles/snack.css` DEFINES these. Screens and components APPLY them and
 * never write their own material CSS — that is what keeps one ketchup red and
 * one paper fibre across the whole app rather than six near-misses.
 *
 * A material class only ever paints a surface: background, edge, shadow, ink
 * colour. Layout, size and spacing stay with the component that owns them.
 */

/** Paper stocks. Pair with a `data-theme` on an ancestor for the themed print. */
export const PAPER = {
  napkin: 'sn-m-napkin',
  greaseproof: 'sn-m-greaseproof',
  ticket: 'sn-m-ticket',
  menucard: 'sn-m-menucard',
  board: 'sn-m-board',
} as const;

/** Silhouettes. Applied alongside a paper class; drives clip-path + shadow. */
export const EDGE = {
  deckle: 'sn-e-deckle',
  scallop: 'sn-e-scallop',
  torn: 'sn-e-torn',
  perforated: 'sn-e-perforated',
  clean: 'sn-e-clean',
} as const;

/** Condiment surfaces for controls. */
export const CONDIMENT = {
  /** Primary action. The splat is a background layer behind a rect hit area. */
  splat: 'sn-m-splat',
  /** Secondary action: a mustard/sauce sachet. */
  sachet: 'sn-m-sachet',
  /** Small status chip: an enamel bottle cap. */
  cap: 'sn-m-cap',
  /** Peel-off vinyl sticker, for badges and prices. */
  sticker: 'sn-m-sticker',
} as const;

/** Ink treatments for type sitting on paper. */
export const INK = {
  /** Dark stamp ink with slight bleed. Default for type on any paper. */
  print: 'sn-i-print',
  /** Rubber-stamped, rotated, partially inked. For PAID / BEST / NEW. */
  stamp: 'sn-i-stamp',
  /** Hand-drawn underline used for focus and selection. */
  underline: 'sn-i-underline',
  /** Faded receipt thermal print, for secondary metadata. */
  thermal: 'sn-i-thermal',
} as const;

/** Structural pieces. */
export const PART = {
  /** The brushed metal tray a sheet of greaseproof sits on. */
  tray: 'sn-m-tray',
  /** A perforated tear-line divider. */
  tear: 'sn-m-tear',
  /** Grease translucency spot; purely decorative, aria-hidden. */
  stain: 'sn-m-stain',
  /** The tape or clip holding a piece of paper down. */
  tape: 'sn-m-tape',
} as const;

/**
 * Casual rotation. Buckets rather than free degrees, so the whole interface
 * shares one rhythm of tilt instead of drifting.
 */
export const TILT = {
  none: '',
  l1: 'sn-tilt-l1',
  l2: 'sn-tilt-l2',
  r1: 'sn-tilt-r1',
  r2: 'sn-tilt-r2',
} as const;

export type PaperClass = (typeof PAPER)[keyof typeof PAPER];
export type EdgeClass = (typeof EDGE)[keyof typeof EDGE];
export type CondimentClass = (typeof CONDIMENT)[keyof typeof CONDIMENT];
export type InkClass = (typeof INK)[keyof typeof INK];
export type PartClass = (typeof PART)[keyof typeof PART];
export type TiltClass = (typeof TILT)[keyof typeof TILT];

/**
 * Deterministic tilt from a stable key, so a card leans the same way on every
 * mount. Keyed on the card's id, never on its index.
 */
export function tiltFor(key: string): TiltClass {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const buckets: TiltClass[] = [TILT.l1, TILT.r1, TILT.l2, TILT.r2];
  return buckets[(hash >>> 0) % buckets.length];
}
