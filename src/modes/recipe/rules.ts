/**
 * RECIPE RUSH — the rules, as pure functions.
 *
 * Kept free of THREE and of the mode object so the escalation curve can be
 * read, argued about and unit-checked without booting a renderer.
 */
import { clamp } from '../../core/math';
import type { Rng } from '../../core/rng';
import { RR } from './tuning';

/**
 * How many ingredients recipe `n` (1-based) asks for.
 *
 *   1..7 -> 3,4,5,6,7,8,9   then held at 9.
 *
 * Nine is the cap on purpose. Human span for unrelated items is about seven;
 * the melody and the fixed slot positions buy a couple more, and past that the
 * run stops being a memory test and becomes a lottery. Length is not the only
 * thing escalating — the pass keeps filling with decoys underneath it.
 */
export function recipeLength(n: number): number {
  return Math.min(2 + n, RR.MAX_LEN);
}

/**
 * How many ingredients are laid out on the pass for recipe `n`.
 *
 * The board FILLS UP as the run goes on: four ingredients on the first recipe,
 * all eight by the fifth. That is the difficulty ramp the player can actually
 * see, and it keeps the early recipes cheap to draw. Positions are canonical —
 * a food always occupies the slot of its index in the theme's authored run —
 * so an ingredient that is already out never moves.
 */
export function paletteSize(n: number, foods: number): number {
  return Math.min(3 + n, Math.min(RR.MAX_SLOTS, foods));
}

/** Auto-advance dwell for one demo ingredient. Longer recipes tick faster. */
export function demoDwell(len: number): number {
  return clamp(
    RR.DEMO_DWELL_MAX - RR.DEMO_DWELL_FALLOFF * len,
    RR.DEMO_DWELL_MIN,
    RR.DEMO_DWELL_MAX,
  );
}

/**
 * Fill `out` with `len` slot indices drawn from `palette`.
 *
 * - never the same ingredient twice in a row (that is a rhythm puzzle, not a
 *   memory one, and it reads as a bug when two identical items stack);
 * - at most two uses of any ingredient;
 * - from six ingredients up, at least one ingredient IS repeated, so a player
 *   cannot clear a long recipe by elimination alone.
 */
export function makeRecipe(
  out: number[],
  counts: Uint8Array,
  len: number,
  palette: number,
  rng: Rng,
): void {
  out.length = len;
  counts.fill(0, 0, palette);
  const maxUse = len <= 4 ? 1 : 2;

  for (let i = 0; i < len; i++) {
    let pick = -1;
    // Two passes: the first respects the no-adjacent-repeat rule, the second
    // drops it rather than ever failing to produce a recipe.
    for (let pass = 0; pass < 2 && pick < 0; pass++) {
      let eligible = 0;
      for (let c = 0; c < palette; c++) {
        if (counts[c] >= maxUse) continue;
        if (pass === 0 && i > 0 && c === out[i - 1]) continue;
        eligible++;
      }
      if (eligible === 0) continue;
      let want = rng.int(0, eligible);
      for (let c = 0; c < palette; c++) {
        if (counts[c] >= maxUse) continue;
        if (pass === 0 && i > 0 && c === out[i - 1]) continue;
        if (want-- === 0) {
          pick = c;
          break;
        }
      }
    }
    if (pick < 0) pick = i > 0 ? (out[i - 1] + 1) % palette : 0;
    out[i] = pick;
    counts[pick]++;
  }

  if (len >= 6 && maxUse > 1) {
    let repeated = false;
    for (let c = 0; c < palette && !repeated; c++) repeated = counts[c] > 1;
    if (!repeated) {
      // Overwrite one interior slot with a neighbour-safe duplicate.
      for (let tries = 0; tries < 12; tries++) {
        const at = rng.int(1, len - 1);
        const from = out[rng.int(0, len)];
        if (from === out[at - 1] || from === out[at + 1] || from === out[at]) continue;
        counts[out[at]]--;
        out[at] = from;
        counts[from]++;
        break;
      }
    }
  }
}

/** Points for the `step`-th (0-based) correct pick at the given combo (>= 1). */
export function pickPoints(step: number, combo: number): number {
  const base = RR.PICK_BASE + RR.PICK_STEP * step;
  const mult = 1 + Math.min(combo - 1, RR.COMBO_CAP) * RR.COMBO_RATE;
  return Math.round(base * mult);
}

/** Bonus for serving a recipe. Flawless doubles it — that is the whole prize. */
export function recipeBonus(len: number, flawless: boolean): number {
  return len * RR.RECIPE_BONUS * (flawless ? RR.FLAWLESS_MULT : 1);
}

/** Extra for beating par. Rewards fast recall on top of surviving the clock. */
export function speedBonus(len: number, seconds: number): number {
  const par = RR.PAR_BASE + RR.PAR_PER_ITEM * len;
  return Math.max(0, Math.round((par - seconds) * RR.SPEED_RATE));
}

/**
 * Total seconds allowed to recall recipe `n` (1-based), `len` ingredients long.
 *
 * The per-item budget tightens from `CLOCK_PER_ITEM_START` to
 * `CLOCK_PER_ITEM_END` across the first `CLOCK_RAMP` recipes; because `len` is
 * itself climbing, the pace the player must keep rises faster than the budget
 * falls. A flat `CLOCK_BASE` grace keeps the very short early recipes from
 * being unwinnably tight. Pure so the curve can be asserted without a renderer.
 */
export function recipeTimeLimit(n: number, len: number): number {
  const ramp = clamp((n - 1) / RR.CLOCK_RAMP, 0, 1);
  const perItem = RR.CLOCK_PER_ITEM_START + (RR.CLOCK_PER_ITEM_END - RR.CLOCK_PER_ITEM_START) * ramp;
  return RR.CLOCK_BASE + perItem * len;
}

/** Praise tier for a served recipe, 0..3. */
export function serveTier(len: number, flawless: boolean): number {
  if (!flawless) return 0;
  return Math.min(3, 1 + Math.floor((len - 3) / 3));
}
