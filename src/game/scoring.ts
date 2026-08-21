import { TUNING } from './constants';

export interface ScoreState {
  score: number;
  combo: number;
  bestCombo: number;
  perfects: number;
  layers: number;
}

export function createScoreState(): ScoreState {
  return { score: 0, combo: 0, bestCombo: 0, perfects: 0, layers: 0 };
}

/** Points awarded for a normal (sliced) drop. */
export function normalPoints(layerIndex: number): number {
  return TUNING.SCORE_BASE + Math.floor(layerIndex / 10) * 2;
}

/** Points for a perfect drop at the given combo (combo is 1-based). */
export function perfectPoints(combo: number): number {
  const steps = Math.min(combo - 1, TUNING.SCORE_COMBO_CAP);
  return TUNING.SCORE_PERFECT + steps * TUNING.SCORE_PERFECT_STEP;
}

/** 0..3+, drives how loud the perfect celebration gets. */
export function perfectTier(combo: number): number {
  if (combo >= 12) return 3;
  if (combo >= 7) return 2;
  if (combo >= 3) return 1;
  return 0;
}

const PERFECT_LABELS = ['PERFECT', 'SWEET!', 'DELICIOUS', 'FLAWLESS', 'UNREAL'];

export function perfectLabel(combo: number): string {
  if (combo >= 16) return 'UNREAL';
  if (combo >= 12) return 'FLAWLESS';
  if (combo >= 7) return 'DELICIOUS';
  if (combo >= 3) return 'SWEET!';
  return PERFECT_LABELS[0];
}

const MILESTONES: Array<[number, string, string]> = [
  [8, 'Double Decker', 'Course two is served'],
  [16, 'Triple Stack', 'The kitchen is watching'],
  [24, 'Tower Service', 'Hands steady'],
  [32, 'Head Chef', 'This is getting silly'],
  [40, 'Michelin Height', 'Do not look down'],
  [56, 'Sky Kitchen', 'Weather at the top'],
  [72, 'Orbit Snack', 'Genuinely absurd'],
];

export function milestoneFor(layers: number): { title: string; sub: string } | null {
  for (const [at, title, sub] of MILESTONES) {
    if (layers === at) return { title, sub };
  }
  // Beyond the authored list, celebrate every 24 layers.
  if (layers > 72 && layers % 24 === 0) {
    return { title: `${layers} Layers`, sub: 'Still going' };
  }
  return null;
}
