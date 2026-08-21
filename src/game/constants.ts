/**
 * Authoritative tuning. Mirrors docs/DESIGN.md §2 — change values here, then
 * update the doc, never the other way round.
 */
import { BASE_FOOTPRINT } from '../core/world';

export const TUNING = {
  /** Footprint of the plate and the first layer, in world units. */
  BASE_FOOTPRINT,
  /** Below this the tower is too thin to stand on — run ends. */
  MIN_FOOTPRINT: 0.16,

  /** Misalignment (world units) still counted as a perfect drop. */
  PERFECT_TOLERANCE: 0.1,
  /** Footprint handed back for each perfect, capped at BASE_FOOTPRINT. */
  PERFECT_REGROW: 0.06,

  /** Slide speed ramp. */
  START_SPEED: 1.55,
  MAX_SPEED: 4.6,
  /** Layers over which speed approaches MAX (exponential ease). */
  SPEED_RAMP: 22,

  /** How far the moving layer travels either side of centre. */
  TRAVEL: 1.7,
  /** Extra travel added as the run gets long. */
  TRAVEL_GROWTH: 0.3,
  TRAVEL_RAMP: 34,

  /** Layers per course; drives ingredient cycling and milestone banners. */
  COURSE_LENGTH: 8,

  /** Falling offcut physics. */
  GRAVITY: 24,
  OFFCUT_SPIN: 7,
  OFFCUT_KICK: 1.5,
  /** Offcuts are culled this far below the camera. */
  CULL_BELOW: 26,

  /** Landing squash. */
  SQUASH: 0.16,
  SQUASH_FREQ: 15,
  SQUASH_DECAY: 9,

  /** Camera. */
  CAM_FOV: 46,
  CAM_YAW: Math.PI / 4,
  CAM_PITCH: 0.5,
  /** World width that must always be visible; drives the auto-fit distance. */
  CAM_FIT_MARGIN: 0.28,
  /** How far above the tower top the camera aims. */
  CAM_LOOK_LIFT: 0.25,
  /** Vertical framing: fraction of the view the tower top sits at. */
  CAM_FOLLOW_LAMBDA: 5.5,
  CAM_INTRO_LAMBDA: 2.2,

  /** Scoring. */
  SCORE_BASE: 10,
  SCORE_PERFECT: 20,
  SCORE_PERFECT_STEP: 10,
  SCORE_COMBO_CAP: 15,

  /** Seconds the tower spends toppling before the result screen. */
  GAMEOVER_DELAY: 1.15,
  /** Seconds a dropped layer takes to settle before the next spawns. */
  SPAWN_DELAY: 0.06,

  /** One world unit in centimetres, for results-screen flavour copy. */
  CM_PER_UNIT: 9,
};

export type Axis = 'x' | 'z';

export const otherAxis = (a: Axis): Axis => (a === 'x' ? 'z' : 'x');
