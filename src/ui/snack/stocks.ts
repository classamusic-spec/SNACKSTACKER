/**
 * Paper stocks and per-theme prints.
 *
 * The hexes for the six worlds are the authoritative palette from DESIGN §3;
 * everything else here is the *paper's* own identity — the stock it is cut
 * from, and the print run onto it. Prints are deliberately weak: the type sits
 * on this, and legibility outranks the material.
 */

import type { ThemeId } from '../../core/types';
import type { Rgb } from './colour';
import { fromHex, mix } from './colour';
import type { PaperKind } from './api';

export interface StockDef {
  /** Natural colour of the stock before any theme tint or caller tint. */
  base: Rgb;
  /** Long fibre strands: count multiplier and length range in tile px. */
  fibre: number;
  fibreLen: readonly [number, number];
  fibreInk: number;
  /** Short flecks of pulp / bark. */
  fleck: number;
  fleckInk: number;
  /** Coarse stipple — the "tooth" of a heavier card. */
  tooth: number;
  /** Uneven pulp density blotching. */
  blotch: number;
  /** Broad waxy sheen, for greaseproof. */
  sheen: number;
  /** Baseline grease saturation before `wear` adds more. */
  grease: number;
  /** Machine direction: 0 = horizontal fibre, 1 = vertical. */
  grain: number;
  /** Per-pixel surface grain, overlaid last. Rough stock gets more. */
  grain2: number;
  /** How far the theme tint is allowed to pull the base colour. */
  themePull: number;
}

export const STOCKS: Readonly<Record<PaperKind, StockDef>> = {
  napkin: {
    base: fromHex(0xfaf6ee),
    fibre: 1,
    fibreLen: [26, 96],
    fibreInk: 0.085,
    fleck: 1,
    fleckInk: 0.1,
    tooth: 0.5,
    blotch: 1,
    sheen: 0,
    grease: 0,
    grain: 0.12,
    grain2: 0.11,
    themePull: 0.3,
  },
  greaseproof: {
    base: fromHex(0xf7edd9),
    fibre: 0.45,
    fibreLen: [40, 150],
    fibreInk: 0.046,
    fleck: 0.4,
    fleckInk: 0.062,
    tooth: 0.1,
    blotch: 1.35,
    sheen: 1,
    grease: 0.55,
    grain: 0.08,
    grain2: 0.07,
    themePull: 0.14,
  },
  ticket: {
    base: fromHex(0xf1f2ef),
    fibre: 0.2,
    fibreLen: [18, 54],
    fibreInk: 0.03,
    fleck: 0.35,
    fleckInk: 0.046,
    tooth: 0.06,
    blotch: 0.55,
    sheen: 0.25,
    grease: 0.08,
    grain: 0.9,
    grain2: 0.05,
    themePull: 0.06,
  },
  menucard: {
    base: fromHex(0xf0e6cf),
    fibre: 0.7,
    fibreLen: [14, 46],
    fibreInk: 0.07,
    fleck: 1.35,
    fleckInk: 0.105,
    tooth: 1.6,
    blotch: 0.8,
    sheen: 0,
    grease: 0,
    grain: 0.5,
    grain2: 0.15,
    themePull: 0.16,
  },
  board: {
    base: fromHex(0xc8a074),
    fibre: 1.3,
    fibreLen: [30, 120],
    fibreInk: 0.1,
    fleck: 1.7,
    fleckInk: 0.14,
    tooth: 0.8,
    blotch: 1.1,
    sheen: 0.15,
    grease: 0.12,
    grain: 0.05,
    grain2: 0.17,
    themePull: 0.1,
  },
};

export type PrintKind =
  | 'gingham'
  | 'washi'
  | 'scallop-stripe'
  | 'serape'
  | 'linen'
  | 'trattoria';

export interface ThemePaper {
  /** Where the stock's white is pulled — the paper's cast under this world. */
  tint: Rgb;
  /** How far to pull it, 0..1, on top of the stock's own `themePull`. */
  tintAmount: number;
  print: PrintKind;
  /** Print inks. Meaning depends on the print. */
  inks: readonly Rgb[];
  /** Global print strength. Tuned down until the type survives (WCAG AA). */
  strength: number;
  /** Warm-dark ink the type is printed in on this paper. */
  ink: Rgb;
  /** A hairline printed border, or null. Sushi washi has one; nothing else. */
  rule: Rgb | null;
}

export const THEME_PAPER: Readonly<Record<ThemeId, ThemePaper>> = {
  diner: {
    tint: fromHex(0xfff3e0),
    tintAmount: 0.85,
    print: 'gingham',
    inks: [fromHex(0xd93a4c)],
    strength: 0.9,
    ink: fromHex(0x33241a),
    rule: null,
  },
  sushi: {
    tint: fromHex(0xf3f4ef),
    tintAmount: 0.7,
    print: 'washi',
    inks: [fromHex(0xb6ab93), fromHex(0xc4a049)],
    strength: 1,
    ink: fromHex(0x23282e),
    rule: fromHex(0x33456b),
  },
  candy: {
    tint: fromHex(0xfff3f9),
    tintAmount: 0.9,
    print: 'scallop-stripe',
    inks: [fromHex(0xff8fc2), fromHex(0x8fdedd)],
    strength: 0.78,
    ink: fromHex(0x3a2434),
    rule: null,
  },
  taco: {
    tint: fromHex(0xfff1da),
    tintAmount: 0.85,
    print: 'serape',
    inks: [
      fromHex(0xd9542b),
      fromHex(0xe9a93a),
      fromHex(0x3e9c86),
      fromHex(0x7b4a8f),
      fromHex(0xf3e2c0),
    ],
    strength: 0.72,
    ink: fromHex(0x342014),
    rule: null,
  },
  breakfast: {
    tint: fromHex(0xfff9ec),
    tintAmount: 0.9,
    print: 'linen',
    inks: [fromHex(0xcbb79a), fromHex(0xe4d4b4)],
    strength: 1,
    ink: fromHex(0x35271a),
    rule: null,
  },
  pizza: {
    tint: fromHex(0xfff6e7),
    tintAmount: 0.85,
    print: 'trattoria',
    inks: [fromHex(0xc42b2f)],
    strength: 0.85,
    ink: fromHex(0x2f211a),
    rule: null,
  },
};

/** Warm-dark stamp ink for paper with no theme in play. Never pure black. */
export const NEUTRAL_INK: Rgb = fromHex(0x2c231b);

/** The stock's colour once the theme cast and any caller tint are applied. */
export function paperBase(
  kind: PaperKind,
  theme: ThemeId | undefined,
  tint: number | undefined,
): Rgb {
  const stock = STOCKS[kind];
  let base: Rgb = tint === undefined ? stock.base : fromHex(tint);
  if (theme) {
    const paper = THEME_PAPER[theme];
    base = mix(base, paper.tint, stock.themePull * paper.tintAmount);
  }
  return base;
}
