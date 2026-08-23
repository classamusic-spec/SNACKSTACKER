/**
 * Topple's authoritative tuning. Everything the rules depend on lives here so
 * the game reads as rules rather than as magic numbers.
 *
 * THE RULES, in one place:
 *
 *  - Item 1 is placed free and centred. You never start on an empty plate.
 *  - Each subsequent food hangs above the tower and swings side to side,
 *    alternating between the X and Z axis so the tower cross-hatches like a
 *    Jenga stack. Tap anywhere to let go.
 *  - The food keeps a fraction of the swing's sideways speed when released, so
 *    a release at the middle of the swing drifts and a release at the ends does
 *    not. The landing marker shows the *predicted* landing spot including that
 *    drift, so leading the swing is skill, never a hidden tax.
 *  - The tower then does whatever real rigid-body physics says it does. The
 *    next food does not appear until the tower has gone quiet (or 1.4s has
 *    passed), so you are never asked to place into chaos.
 *  - You have TOPPLED when the tower's peak height drops more than
 *    COLLAPSE_DROP below its best, or when any food ends up on the table.
 *    Nothing ends the run early on a tilt threshold — a lean is allowed to
 *    become a fall, because the fall is the point. A food that slips off the
 *    tower but stays on the plate is a MISS, not a loss: no score, combo gone,
 *    and a tower that did not get any taller.
 *  - Escalation is entirely visible: the swing gets wider and faster, and the
 *    footprint tapers. No hidden randomness, no gusts of wind.
 */
import { BASE_FOOTPRINT } from '../../core/world';

export const TOPPLE = {
  // --- world -----------------------------------------------------------------
  /** Footprint of the widest food. Slimmer than the stacker's so a tall tower fits. */
  BASE: BASE_FOOTPRINT * 0.79,
  /** Depth as a fraction of width — the cross-hatch needs a non-square slab. */
  DEPTH_RATIO: 0.82,
  /** Footprint multiplier floor and how fast the tower tapers towards it. */
  TAPER_FLOOR: 0.66,
  TAPER_RAMP: 18,
  /** The plate is sized from the base footprint, as in the stacker. */
  PLATE_SCALE: 1.85,

  /**
   * Collision hulls are inset from the drawn footprint. Round food (a pancake,
   * a tomato) is an ellipse inside its width x depth box, so a hull at the full
   * footprint would let it rest on empty air at the corners; a hull at the
   * inscribed square (0.707) would make it float. 0.9 is the honest middle, and
   * the landing marker draws the *hull*, so what the player is shown is exactly
   * what the solver uses.
   */
  HULL_INSET: 0.9,
  DENSITY: 1.6,
  FRICTION: 0.68,
  PLATE_FRICTION: 0.9,
  GRAVITY: -22,

  // --- solver ------------------------------------------------------------------
  /**
   * 240Hz. Substepping beats iterating: at 240/8/4 a twenty-slab tower settles
   * to machine-zero velocity, where 120/14/8 still breathes. Iteration counts
   * are the same on every quality tier on purpose — fewer iterations would make
   * a tower behave differently on a cheaper phone, and that changes the game.
   */
  STEP: 1 / 240,
  /** 12 substeps == 0.05s == the Ticker's own dt clamp. Beyond that, slow down. */
  MAX_SUBSTEPS: 12,
  VEL_ITERS: 8,
  POS_ITERS: 4,

  // --- placement ---------------------------------------------------------------
  /** Gap between the hovering food's underside and the tower top. */
  DROP_GAP: 0.9,
  SWING_AMP_START: 0.55,
  SWING_AMP_END: 1.28,
  SWING_AMP_RAMP: 22,
  SWING_PERIOD_START: 3.1,
  SWING_PERIOD_END: 1.75,
  SWING_PERIOD_RAMP: 22,
  /** Fraction of the swing's lateral speed the food keeps when released. */
  VEL_CARRY: 0.18,
  /** How far the hanging food banks into the swing, radians. */
  BANK_MAX: 0.13,

  /**
   * Minimum and maximum wait after a release before the tower is judged settled.
   * The minimum is deliberately long: this pause, where you watch the tower
   * absorb the weight and see whether the lean got worse, IS the game.
   */
  SETTLE_MIN: 0.5,
  SETTLE_MAX: 1.6,
  /** A beat between the tower settling and the next food arriving. */
  SPAWN_DELAY: 0.32,
  /** No collapse can be declared within this long of a release. */
  GRACE: 0.3,

  // --- failure -------------------------------------------------------------------
  /** Peak height loss, in world units, that counts as toppled. */
  COLLAPSE_DROP: 0.55,
  /**
   * A food whose centre sinks below this has left the plate — the plate's top
   * face is y = 0, so anything under it is on the table. This is deliberately
   * the ONLY horizontal failure test: an earlier version also ended the run
   * when a food strayed past the plate's radius, which killed every run while
   * the tower was still standing. A stack whose layers each overhang slightly
   * is the leaning tower of Lire and it is genuinely stable a long way out —
   * letting it lean until it actually folds is the whole point of the mode.
   */
  OFF_PLATE_Y: -0.12,
  /**
   * A food that ends up more than this far below the tower's top has slipped
   * off rather than landed on it: no points, and the combo goes.
   */
  MISS_DEPTH: 0.55,

  // --- scoring ---------------------------------------------------------------------
  SCORE_BASE: 12,
  SCORE_PER_ITEM: 5,
  SCORE_PLUMB: 15,
  SCORE_COUNTERWEIGHT: 45,
  COMBO_CAP: 12,
  /** Centre-to-centre offset from the food below still counted as plumb. */
  PLUMB_TOL: 0.11,
  /** Lean fraction above which recovering the balance earns COUNTERWEIGHT. */
  LEAN_DANGER: 0.45,
  COURSE_LENGTH: 6,

  // --- presentation -------------------------------------------------------------------
  /** Seconds of collapse before the result screen. Longer than the stacker's: it earns it. */
  COLLAPSE_TO_RESULT: 1.95,
  /** Impacts stop making noise here, so the sting can breathe before the score. */
  COLLAPSE_SFX_UNTIL: 1.15,
  MAX_COLLAPSE_DUST: 14,
  /** Speed lost in one step that counts as an impact. */
  IMPACT_SPEED: 1.15,
  /** Items in the attract tower. */
  ATTRACT_ITEMS: 6,
  /**
   * How many world units below the tower's peak a food keeps casting shadows.
   * Deeper than this it is buried between two other layers and its shadow falls
   * entirely inside the tower — switching it off costs a shadow-map draw call
   * per layer and changes nothing you can see. This is the main thing quality
   * tiers scale; the solver itself is identical on every tier, because fewer
   * iterations would make a tower behave differently on a cheaper phone and
   * that is a different game, not a cheaper one.
   */
  SHADOW_DEPTH: { low: 1.1, medium: 2.0, high: 3.2 },
} as const;

/** Footprint width of item `i`; the tower tapers towards a spire. */
export function footprintFor(index: number): number {
  const t = TOPPLE.TAPER_FLOOR + (1 - TOPPLE.TAPER_FLOOR) * Math.exp(-index / TOPPLE.TAPER_RAMP);
  return TOPPLE.BASE * t;
}

/** Swing half-amplitude for item `i`. */
export function swingAmplitude(index: number): number {
  const t = 1 - Math.exp(-index / TOPPLE.SWING_AMP_RAMP);
  return TOPPLE.SWING_AMP_START + (TOPPLE.SWING_AMP_END - TOPPLE.SWING_AMP_START) * t;
}

/** Swing period in seconds for item `i`. */
export function swingPeriod(index: number): number {
  const t = 1 - Math.exp(-index / TOPPLE.SWING_PERIOD_RAMP);
  return TOPPLE.SWING_PERIOD_START + (TOPPLE.SWING_PERIOD_END - TOPPLE.SWING_PERIOD_START) * t;
}

const PLUMB_LABELS = ['PLUMB', 'SOLID', 'TRUE', 'MASON', 'ARCHITECT'] as const;

export function plumbLabel(combo: number): string {
  return PLUMB_LABELS[Math.min(combo - 1, PLUMB_LABELS.length - 1)] ?? PLUMB_LABELS[0];
}

export function plumbTier(combo: number): number {
  return combo >= 8 ? 4 : combo >= 5 ? 3 : combo >= 3 ? 2 : 1;
}
