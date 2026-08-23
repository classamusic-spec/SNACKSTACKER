/**
 * CONVEYOR — authoritative tuning.
 *
 * Geometry is expressed in the belt's own local frame: +Z runs TOWARD the
 * camera, +X is screen-right, y = 0 is the table top. The root group is turned
 * to the rig's play yaw, so local +Z projects straight down the portrait
 * screen — the only axis a 393px-wide frame has any room on.
 */

/** Table top plane. Matches the depth the stacker's plates sit at. */
export const TABLE_Y = -0.35;
/** Height of the belt's carrying surface above the table. */
export const DECK_H = 0.22;
/** Belt band half-width. Items are ~80% of this. */
export const BELT_HALF_W = 0.66;

/** Local Z of the entry hatch (far, top of frame). */
export const Z_HATCH = -4.25;
/** Items scale up out of the hatch mouth here. */
export const Z_SPAWN = -4.15;
/** Past this an ungrabbed item is gone. Sits ~12% up from the frame bottom. */
export const Z_PASS = 3.45;
/** Recycled here — the belt plane leaves the bottom of the frame at 4.44. */
export const Z_RETIRE = 4.5;
/** Near end of the physical belt: just past the bottom edge of the frame. */
export const Z_END = 4.75;

/**
 * The order board hangs over the entry hatch.
 *
 * The height is not free. On a 393x852 phone the host's score sits in roughly
 * the top 150px and the belt's far items appear at ~300px, so the docket has
 * one band of about 150px to live in. 3.6 x 1.575 world units at this distance
 * is 295 x 129 CSS px, which lands the board at y 168-297 — under the score,
 * over the hatch, and clear of both.
 */
export const TICKET_Z = -3.6;
export const TICKET_Y = 1.41;
export const TICKET_W = 3.6;
export const TICKET_H = 1.575;
export const TICKET_TILT = -0.36;
export const TICKET_TEX_W = 640;
export const TICKET_TEX_H = 280;
/** Uniform scale applied to a food authored at BASE_FOOTPRINT. */
export const ITEM_SCALE = 0.47;
/** Foods are authored thin so they stack; on a belt they want a little body. */
export const ITEM_Y_BOOST = 1.3;

/** Generous, uniform tap volume. Always clears 44px, never overlaps a neighbour. */
export const HIT_W = 1.02;
export const HIT_H = 0.95;
export const HIT_D = 0.9;

/** Slots in the pool: on-belt items plus the ones mid-flight to the ticket. */
export const POOL: Record<'low' | 'medium' | 'high', number> = {
  low: 6,
  medium: 7,
  high: 7,
};
/** How many items may ride the belt at once. Draw calls live here. */
export const MAX_ON_BELT: Record<'low' | 'medium' | 'high', number> = {
  low: 4,
  medium: 5,
  high: 5,
};

/** Belt speed, world units per second. */
export const SPEED_START = 1.95;
export const SPEED_MAX = 4.1;
/** Orders over which speed approaches SPEED_MAX. */
export const SPEED_RAMP = 9;

/** Gap between consecutive items, in world units along the belt. */
export const GAP_START = 1.95;
export const GAP_MIN = 1.2;
export const GAP_RAMP = 8;

/** Clock. */
export const TIME_START = 14;
export const TIME_CAP = 17;
export const TIME_BONUS_START = 8.5;
export const TIME_BONUS_MIN = 4.6;
export const TIME_PENALTY_WRONG = 1.2;
export const TIME_PENALTY_MISS = 1.0;
/** Below this the countdown ticks and the board goes red. */
export const TIME_PANIC = 5;

/** Scoring. */
export const PTS_GRAB = 12;
export const PTS_COMBO_STEP = 5;
export const PTS_COMBO_CAP = 15;
export const PTS_WRONG = -15;
export const PTS_ORDER = 50;
export const PTS_ORDER_LEVEL = 12;
export const PTS_ORDER_TIME = 8;

/** Items shrink into the machine over the last stretch rather than popping. */
export const Z_SINK = 3.95;

/** Animation. */
export const FLY_TIME = 0.42;
export const REJECT_TIME = 0.55;
export const OVER_DELAY = 1.1;
