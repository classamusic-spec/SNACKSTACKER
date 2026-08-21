import type { ThemeDef } from '../content/api';
import type { RunResult, Settings, SkuId, ThemeId } from '../core/types';

export type ScreenId =
  | 'boot'
  | 'home'
  | 'game'
  | 'pause'
  | 'result'
  | 'store'
  | 'settings';

export interface HudState {
  score: number;
  layers: number;
  combo: number;
  best: number;
  coins: number;
}

export interface StoreItemView {
  sku: SkuId;
  themeId: ThemeId | null;
  name: string;
  tagline: string;
  glyph: string;
  priceLabel: string;
  owned: boolean;
  selected: boolean;
  /** e.g. "Best value" / "New" */
  badge?: string;
  /** Swatch colours for the card artwork. */
  swatches: number[];
  /** Ingredient names shown on the card. */
  ingredients: string[];
}

export interface StoreView {
  items: StoreItemView[];
  coins: number;
}

export interface UiHooks {
  onPlay(): void;
  onRestart(): void;
  onHome(): void;
  onPause(): void;
  onResume(): void;
  onOpenStore(): void;
  onCloseStore(): void;
  onOpenSettings(): void;
  onCloseSettings(): void;
  onSelectTheme(id: ThemeId): void;
  onBuy(sku: SkuId): void;
  onRestorePurchases(): void;
  onSettingChange<K extends keyof Settings>(key: K, value: Settings[K]): void;
  onShare(result: RunResult): void;
  /** Fired on any UI press so audio can be unlocked / clicked. */
  onUiPress(kind: 'tap' | 'back' | 'toggle'): void;
}

export interface Ui {
  readonly root: HTMLElement;
  readonly screen: ScreenId;
  /** 0..1 while booting. */
  setLoadProgress(p: number): void;
  dismissBoot(): void;

  goHome(opts?: { instant?: boolean }): void;
  goGame(): void;
  goPause(): void;
  goResult(result: RunResult): void;
  goStore(): void;
  goSettings(): void;
  /** Close whatever modal is on top; returns true if something closed. */
  back(): boolean;

  setHud(state: HudState): void;
  setScore(score: number, opts?: { pop?: boolean; delta?: number }): void;
  setCombo(combo: number): void;
  /** "PERFECT" / "FLAWLESS" banner; tier 0..3 scales the treatment. */
  showPerfect(label: string, tier: number): void;
  showMilestone(text: string, sub?: string): void;
  setCoins(coins: number, opts?: { animate?: boolean }): void;

  applyTheme(theme: ThemeDef): void;
  setStoreView(view: StoreView): void;
  setSettings(settings: Settings): void;
  setBest(best: number): void;
  /** Show/hide the first-run "tap to drop" coach. */
  setCoach(visible: boolean): void;
  toast(message: string, kind?: 'info' | 'success' | 'error'): void;
  /** Purchase in-flight spinner on a card. */
  setSkuPending(sku: SkuId | null): void;
  dispose(): void;
}
