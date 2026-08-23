/** Points, praise and the escalation curves. Pure functions, easy to tune. */
import { clamp, lerp } from '../../core/math';
import {
  GAP_MIN,
  GAP_RAMP,
  GAP_START,
  PTS_COMBO_CAP,
  PTS_COMBO_STEP,
  PTS_GRAB,
  PTS_ORDER,
  PTS_ORDER_LEVEL,
  PTS_ORDER_TIME,
  SPEED_MAX,
  SPEED_RAMP,
  SPEED_START,
  TIME_BONUS_MIN,
  TIME_BONUS_START,
} from './tuning';

/** Belt speed for a given number of completed orders. */
export function speedFor(level: number): number {
  const t = 1 - Math.exp(-level / SPEED_RAMP);
  return lerp(SPEED_START, SPEED_MAX, t);
}

/** Distance between consecutive items. Shrinks as the belt speeds up. */
export function gapFor(level: number): number {
  const t = 1 - Math.exp(-level / GAP_RAMP);
  return lerp(GAP_START, GAP_MIN, t);
}

/**
 * Odds the next item is one the ticket still wants.
 *
 * The first order is mostly signal so the rule teaches itself, and it settles
 * a little under half, which is where letting an item go becomes a real
 * decision rather than a formality. The spawner also caps how many wanted
 * items may be in flight at once, so this number sets the texture of the belt
 * rather than the raw supply.
 */
export function needShareFor(level: number): number {
  return clamp(0.76 - level * 0.05, 0.42, 0.76);
}

/** Seconds the clock is topped up by on a completed order. */
export function timeBonusFor(level: number): number {
  const t = 1 - Math.exp(-level / 7);
  return lerp(TIME_BONUS_START, TIME_BONUS_MIN, t);
}

export function grabPoints(combo: number): number {
  return PTS_GRAB + Math.min(combo, PTS_COMBO_CAP) * PTS_COMBO_STEP;
}

export function orderPoints(level: number, timeLeft: number): number {
  return Math.round(PTS_ORDER + level * PTS_ORDER_LEVEL + Math.max(timeLeft, 0) * PTS_ORDER_TIME);
}

export interface Praise {
  label: string;
  tier: number;
}

/** Combo milestones. Returns null on the counts that are not worth a banner. */
export function praiseFor(combo: number): Praise | null {
  if (combo === 3) return { label: 'GOOD EYE', tier: 1 };
  if (combo === 6) return { label: 'SHARP', tier: 2 };
  if (combo === 10) return { label: 'ON A ROLL', tier: 3 };
  if (combo === 15) return { label: 'FLAWLESS', tier: 4 };
  if (combo >= 20 && combo % 5 === 0) return { label: "CHEF'S KISS", tier: 4 };
  return null;
}

/** How loud the celebration for a finished order should be, 1..4. */
export function orderTier(level: number, clean: boolean): number {
  return clamp(1 + Math.floor(level / 4) + (clean ? 1 : 0), 1, 4);
}
