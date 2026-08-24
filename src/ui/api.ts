import type { ThemeDef } from '../content/api';
import type { ModeId } from '../modes/api';
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

/** A recall countdown for the HUD; `null` hides it. Mirrors the mode `clock` event. */
export type ClockView = { remaining01: number; seconds: number; urgent: boolean } | null;

export interface StoreItemView {
  sku: SkuId;
  themeId: ThemeId | null;
  name: string;
  tagline: string;
  glyph: string;
  priceLabel: string;
  /** Secondary line under the action, e.g. progress toward the coin price. */
  subLabel?: string;
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

/** One game mode as the home-screen picker shows it. */
export interface ModeCardView {
  id: ModeId;
  name: string;
  tagline: string;
  /** One line of rules, shown on the focused card only. */
  how: string;
  glyph: string;
  /** Personal best in this mode; 0 means never played. */
  best: number;
  /** Unit for the headline count, e.g. "Layers", "Orders", "cm". */
  countLabel: string;
  /** Best count achieved, paired with countLabel. */
  bestCount: number;
  /** Per-mode accent, so each card has its own identity inside the theme. */
  accent: number;
  /** Reserved: a mode the player has not unlocked yet. */
  locked: boolean;
}

export interface UiHooks {
  /** The player focused/chose a different mode in the picker. */
  onSelectMode(id: ModeId): void;
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
  /** Recall countdown for modes that run one; `null` hides it. */
  setClock(view: ClockView): void;
  /** "PERFECT" / "FLAWLESS" banner; tier 0..3 scales the treatment. */
  showPerfect(label: string, tier: number): void;
  showMilestone(text: string, sub?: string): void;
  setCoins(coins: number, opts?: { animate?: boolean }): void;

  applyTheme(theme: ThemeDef): void;
  /** Populate the home-screen mode picker. Call before goHome(). */
  setModes(cards: ModeCardView[], selectedId: ModeId): void;
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
