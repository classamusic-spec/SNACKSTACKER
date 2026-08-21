/** Shared primitive types used across every subsystem. */

export type QualityTier = 'low' | 'medium' | 'high';

export type ThemeId =
  | 'diner'
  | 'sushi'
  | 'candy'
  | 'taco'
  | 'breakfast'
  | 'pizza';

/**
 * Every purchasable SKU in the shop. Snackery has no ads, so there is
 * deliberately no "remove ads" SKU — selling the removal of something the game
 * does not do would misrepresent the product.
 */
export type SkuId = ThemeId | 'bundle_all';

export type GamePhase =
  | 'boot'
  | 'home'
  | 'playing'
  | 'paused'
  | 'gameover'
  | 'store';

export interface RunResult {
  score: number;
  layers: number;
  best: number;
  isNewBest: boolean;
  perfects: number;
  bestCombo: number;
  coinsEarned: number;
  themeId: ThemeId;
  /** height of tower in centimetres, for flavour copy */
  heightCm: number;
}

export interface Settings {
  sfx: boolean;
  music: boolean;
  haptics: boolean;
  reducedMotion: boolean;
  quality: QualityTier | 'auto';
  leftHanded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sfx: true,
  music: true,
  haptics: true,
  reducedMotion: false,
  quality: 'auto',
  leftHanded: false,
};
