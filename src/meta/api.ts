import type { RunResult, Settings, SkuId, ThemeId } from '../core/types';

export interface SaveData {
  version: number;
  best: number;
  bestLayers: number;
  coins: number;
  runs: number;
  totalLayers: number;
  totalPerfects: number;
  longestCombo: number;
  owned: SkuId[];
  selectedTheme: ThemeId;
  bestByTheme: Partial<Record<ThemeId, number>>;
  settings: Settings;
  seenTutorial: boolean;
  firstSeenAt: number;
  lastPlayedAt: number;
  /** Consecutive calendar days played. */
  streak: number;
}

export interface Sku {
  id: SkuId;
  themeId: ThemeId | null;
  priceUsd: number;
  /** Alternative soft-currency price; null when not purchasable with coins. */
  coinPrice: number | null;
  badge?: string;
  /** SKUs this one grants (bundle). */
  grants?: SkuId[];
}

export type PurchaseOutcome =
  | { ok: true; sku: SkuId; granted: SkuId[]; method: 'money' | 'coins' | 'already' }
  | { ok: false; reason: 'insufficient_coins' | 'unknown_sku' | 'cancelled' | 'failed' };

export interface Meta {
  readonly data: Readonly<SaveData>;
  readonly skus: readonly Sku[];
  skuFor(id: SkuId): Sku | undefined;
  isOwned(sku: SkuId): boolean;
  /** Themes the player may select right now. */
  ownedThemes(): ThemeId[];
  purchase(sku: SkuId, method?: 'money' | 'coins'): Promise<PurchaseOutcome>;
  restorePurchases(): Promise<SkuId[]>;
  selectTheme(id: ThemeId): boolean;
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void;
  addCoins(n: number): number;
  spendCoins(n: number): boolean;
  /** Fold a finished run into lifetime stats. Returns coins earned. */
  recordRun(result: Omit<RunResult, 'coinsEarned' | 'best' | 'isNewBest'>): RunResult;
  markTutorialSeen(): void;
  onChange(fn: (data: Readonly<SaveData>) => void): () => void;
  save(): void;
  reset(): void;
}

export function coinsForRun(score: number, perfects: number, layers: number): number {
  return Math.max(1, Math.round(score / 40 + perfects * 2 + layers / 3));
}
