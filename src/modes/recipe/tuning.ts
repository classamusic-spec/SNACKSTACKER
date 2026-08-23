/**
 * RECIPE RUSH — authoritative tuning.
 *
 * Everything that decides how the mode *feels* lives here so it can be read in
 * one screen. Layout numbers are authored in SCREEN space (fractions of the
 * viewport) and unprojected onto the pass at runtime, because portrait gives
 * only ~22 degrees of horizontal field and a hard-coded world layout that fits
 * a 19.5:9 phone falls apart on anything else.
 */

export const RR = {
  // ---------------------------------------------------------------- framing
  /**
   * Camera look target, held CONSTANT for the whole run. The pass is a fixed
   * world object; if the rig tracked the dish the way the stacker tracks its
   * tower, every ingredient placed would slide the tray down the screen and
   * the player's thumb would lose its aim mid-recipe.
   */
  TOP_Y: 1.35,
  /** Travel we ask the rig for. Matches the stacker so the world frames identically. */
  TRAVEL: 1.7,

  // ------------------------------------------------------------------- dish
  /** Footprint of a plated ingredient. Narrower than a stacker layer: this is a dish. */
  DISH_FOOTPRINT: 1.62,
  /** Plate footprint. A plated dish, not the stacker's full-size deck. */
  PLATE_FOOTPRINT: 2.4,
  /** Plated food is thinner than a stacker layer, so nine of them still frame. */
  DISH_THICK_SCALE: 0.8,
  DISH_MIN_THICK: 0.15,

  // ----------------------------------------------------------------- tokens
  /** Footprint tokens are BUILT at; the holder is then scaled to the cell. */
  TOKEN_BUILD_SIZE: 0.72,
  TOKEN_THICK_SCALE: 0.46,
  TOKEN_MIN_THICK: 0.1,
  TOKEN_MAX_THICK: 0.34,
  /** Fraction of a cell a token fills. The rest is the gap that separates them. */
  TOKEN_CELL_FILL: 0.74,
  /** Resting hover of a token above the pass surface. */
  TOKEN_LIFT: 0.02,

  // ------------------------------------------------------------------- pass
  /**
   * How far the pass surface stands above the theme's table top.
   *
   * A full unit, because the six themes put their own clutter exactly where
   * the pass needs to be — candy's jars, taco's salsa bowl and limes — and at
   * table height those props intersected the pick targets. Raising the pass
   * into the foreground puts it in front of all of them. It costs nothing in
   * composition: the back edge is screen-anchored (see ROW_BACK), so the frame
   * is identical whatever the lip is; only the depth order changes.
   */
  BOARD_LIP: 1.45,
  /** Slab thickness. The near, far and side faces are all outside the frame. */
  BOARD_SINK: 0.55,
  /**
   * Back edge of the pass, as a fraction of viewport height. Clamped at layout
   * time to stay below the plate's near rim, so the pass never crops the dish.
   */
  ROW_BACK: 0.728,
  /** Slot rows, as a fraction of viewport height from the top. */
  ROW_FAR: 0.782,
  ROW_NEAR: 0.884,
  /** Usable half-width, as |NDC x|. 0.97 leaves a hair of margin at the edges. */
  EDGE_X: 0.97,
  /**
   * Lives and step pips live in the empty band BETWEEN the two token rows —
   * the one place on the pass that is always clear, always central and always
   * on screen.
   */
  PIP_BAND: 0.5,
  PIP_RADIUS: 0.105,
  PIP_PITCH: 0.26,
  LIFE_RADIUS: 0.15,
  LIFE_PITCH: 0.38,

  // ------------------------------------------------------------------ rules
  LIVES: 3,
  /** Recipes cap here; nine from an eight-strong alphabet already forces repeats. */
  MAX_LEN: 9,
  MAX_SLOTS: 8,
  /** Wrong picks on one step before the correct slot is nudged. */
  NUDGE_AFTER: 2,

  // ----------------------------------------------------------------- timing
  /** Beat before the first ingredient of a demo flies. */
  INTRO: 0.42,
  /** Auto-advance dwell per demo item; a tap beats it every time. */
  DEMO_DWELL_MAX: 0.44,
  DEMO_DWELL_MIN: 0.26,
  DEMO_DWELL_FALLOFF: 0.019,
  /** Floor between two tap-advances, so a fumbled double tap cannot skip one. */
  DEMO_TAP_GATE: 0.11,
  /** Ingredient flight from a slot to the top of the dish. */
  FLIGHT: 0.17,
  DEMO_FLIGHT: 0.15,
  /** Beat after the last demo item lands, before the cloche falls. */
  DEMO_TAIL: 0.16,
  CLOCHE_FALL: 0.24,
  CLOCHE_HOLD: 0.07,
  CLOCHE_RISE: 0.26,
  /** Input is dead for this long after the reveal, so the last demo tap cannot mis-pick. */
  GO_LOCKOUT: 0.16,
  COMPLETE_HOLD: 0.46,
  OVER_HOLD: 1.05,

  /** Landing squash, matching the stacker's motion language. */
  SQUASH: 0.17,
  SQUASH_FREQ: 15,
  SQUASH_DECAY: 9,

  // ---------------------------------------------------------------- scoring
  PICK_BASE: 10,
  PICK_STEP: 3,
  COMBO_RATE: 0.06,
  COMBO_CAP: 20,
  RECIPE_BONUS: 30,
  FLAWLESS_MULT: 2,
  /** Seconds of slack per ingredient before the speed bonus runs out. */
  PAR_PER_ITEM: 0.75,
  PAR_BASE: 0.6,
  SPEED_RATE: 18,
} as const;

/**
 * Semitone offsets for slot 0..7 — a two-octave major pentatonic. Each slot
 * owns a pitch, so a recipe is heard as a melody whose contour maps onto the
 * pass. It is the third independent channel the answer arrives on (shape,
 * position, pitch) and the reason this mode is playable without relying on
 * colour, which several foods in a theme share.
 */
export const SLOT_SEMITONES: readonly number[] = [0, 2, 4, 7, 9, 12, 14, 16];
