/**
 * Progression: a finished run folded into lifetime stats, plus the flavour copy
 * the results screen leans on.
 */
import type { RunResult, ThemeId } from '../core/types';
import { coinsForRun } from './api';
import type { SaveData } from './api';
import { isThemeId } from './catalog';
import { LIMITS } from './save';

const DAY_MS = 86_400_000;

/** The run payload the game hands us: everything except what we compute. */
export type RunInput = Omit<RunResult, 'coinsEarned' | 'best' | 'isNewBest'>;

/* ------------------------------------------------------------------ streaks */

/**
 * Days since the epoch **in local time**.
 *
 * The classic streak bug is `(now - last) < 86400000`: play at 11pm then again
 * at 8am and a raw delta says "same day" when the calendar says otherwise (and
 * vice versa across a 25-hour DST day). Normalising to the local Y/M/D first
 * and only then measuring makes the comparison mean what players mean.
 */
export function localDayIndex(ts: number): number {
  const d = new Date(ts);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** True when both timestamps land on the same local calendar day. */
export function isSameLocalDay(a: number, b: number): boolean {
  return localDayIndex(a) === localDayIndex(b);
}

/**
 * The daily streak after a play at `now`.
 * - never played before -> 1
 * - same calendar day    -> unchanged (a second run today is not a second day)
 * - the next calendar day-> +1
 * - a gap of 2+ days     -> back to 1
 * - a clock that jumped backwards -> unchanged; a wrong device clock should not
 *   cost a player a streak they earned.
 */
export function nextStreak(streak: number, lastPlayedAt: number, now: number): number {
  const current = Math.max(0, Math.floor(streak));
  if (!Number.isFinite(lastPlayedAt) || lastPlayedAt <= 0) return 1;
  const delta = localDayIndex(now) - localDayIndex(lastPlayedAt);
  if (delta === 0) return Math.max(1, current);
  if (delta === 1) return Math.min(LIMITS.streak, Math.max(1, current) + 1);
  if (delta < 0) return Math.max(1, current);
  return 1;
}

/* ------------------------------------------------------------- height copy */

interface HeightTier {
  /** Applies below this height in centimetres. */
  max: number;
  title: string;
}

/**
 * Results-screen flavour. Ten rungs, written to sound like the kitchen is
 * watching you and mildly impressed.
 */
export const HEIGHT_TITLES: readonly HeightTier[] = Object.freeze([
  { max: 15, title: 'Barely a bite' },
  { max: 30, title: 'Snack-sized' },
  { max: 45, title: 'Going back for seconds' },
  { max: 70, title: 'An appetite appears' },
  { max: 100, title: 'The kitchen looks up' },
  { max: 150, title: 'Structurally delicious' },
  { max: 220, title: 'Skyline of snacks' },
  { max: 320, title: 'Monument to hunger' },
  { max: 500, title: 'Ludicrously edible' },
  { max: Number.POSITIVE_INFINITY, title: 'Legend of the lunch counter' },
]);

export function heightTitle(cm: number): string {
  const h = Number.isFinite(cm) ? Math.max(0, cm) : 0;
  for (const tier of HEIGHT_TITLES) if (h < tier.max) return tier.title;
  return HEIGHT_TITLES[HEIGHT_TITLES.length - 1].title;
}

/* ---------------------------------------------------------------- recording */

function clampInt(v: number, max: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(max, Math.max(0, Math.round(v)));
}

/**
 * Fold a finished run into `data` (mutating it) and return the completed
 * `RunResult`. Persistence and change notification are the caller's job — see
 * `createMeta`.
 */
export function applyRun(data: SaveData, input: RunInput, now: number): RunResult {
  const score = clampInt(input.score, LIMITS.score);
  const layers = clampInt(input.layers, LIMITS.layers);
  const perfects = clampInt(input.perfects, LIMITS.layers);
  const bestCombo = clampInt(input.bestCombo, LIMITS.combo);
  const heightCm = Number.isFinite(input.heightCm)
    ? Math.min(LIMITS.heightCm, Math.max(0, input.heightCm))
    : 0;
  const themeId: ThemeId = isThemeId(input.themeId) ? input.themeId : data.selectedTheme;

  const coinsEarned = Math.max(0, Math.round(coinsForRun(score, perfects, layers)));

  // Read the record BEFORE we overwrite it, or every run is a new best.
  const isNewBest = score > data.best;

  data.best = Math.max(data.best, score);
  data.bestLayers = Math.max(data.bestLayers, layers);
  data.bestByTheme[themeId] = Math.max(data.bestByTheme[themeId] ?? 0, score);
  data.longestCombo = Math.max(data.longestCombo, bestCombo);

  data.runs = clampInt(data.runs + 1, LIMITS.runs);
  data.totalLayers = clampInt(data.totalLayers + layers, LIMITS.layers * 1000);
  data.totalPerfects = clampInt(data.totalPerfects + perfects, LIMITS.layers * 1000);

  data.streak = nextStreak(data.streak, data.lastPlayedAt, now);
  data.lastPlayedAt = now;
  if (data.firstSeenAt <= 0) data.firstSeenAt = now;

  data.coins = clampInt(data.coins + coinsEarned, LIMITS.coins);

  return {
    score,
    layers,
    best: data.best,
    isNewBest,
    perfects,
    bestCombo,
    coinsEarned,
    themeId,
    heightCm,
  };
}
