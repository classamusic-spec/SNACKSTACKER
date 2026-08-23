/**
 * META / PROGRESSION / STORE.
 *
 * Pure logic: no Three.js, no DOM beyond two lifecycle listeners for flushing
 * the save. Everything the rest of the game knows about coins, entitlements,
 * settings and records comes through the `Meta` object created here.
 *
 * Integration:
 *   const meta = createMeta();          // once, at boot
 *   meta.onChange(renderStoreAndHud);   // returns an unsubscribe
 *   meta.save();                        // before anything destructive
 *
 * Writes are debounced ~250ms and flushed automatically on `visibilitychange`
 * (hidden) and `pagehide`, so a long run does not touch storage 60 times.
 */
import type { ModeId } from '../modes/api';
import type { Settings, SkuId, ThemeId } from '../core/types';
import type { Meta, PurchaseOutcome, SaveData, Sku, ModeRecord } from './api';
import { SKUS, THEME_IDS, isThemeId, skuFor } from './catalog';
import { applyRun } from './progression';
import type { RunInput } from './progression';
import { createPurchaseFlow, defaultBilling } from './purchase';
import type { BillingAdapter } from './purchase';
import { LIMITS, SaveStore, validateSettings } from './save';
import type { RunResult } from '../core/types';

export interface MetaOptions {
  /**
   * Billing implementation. Defaults to the clearly-labelled simulated one;
   * pass a StoreKit / Play Billing adapter from a native wrapper instead.
   */
  billing?: BillingAdapter;
  /** Clock injection — used by tests to walk across day boundaries. */
  now?: () => number;
}

export function createMeta(options: MetaOptions = {}): Meta {
  const clock = options.now ?? (() => Date.now());
  const store = new SaveStore({ now: clock });
  const flow = createPurchaseFlow({ store, billing: options.billing ?? defaultBilling() });

  function ownsTheme(id: ThemeId): boolean {
    return store.data.owned.includes(id);
  }

  const meta: Meta = {
    get data(): Readonly<SaveData> {
      return store.snapshot();
    },

    get skus(): readonly Sku[] {
      return SKUS;
    },

    skuFor(id: SkuId): Sku | undefined {
      return skuFor(id);
    },

    isOwned(sku: SkuId): boolean {
      return store.data.owned.includes(sku);
    },

    ownedThemes(): ThemeId[] {
      return THEME_IDS.filter(ownsTheme);
    },

    purchase(sku: SkuId, method: 'money' | 'coins' = 'money'): Promise<PurchaseOutcome> {
      return flow.purchase(sku, method);
    },

    restorePurchases(): Promise<SkuId[]> {
      return flow.restore();
    },

    selectTheme(id: ThemeId): boolean {
      if (!isThemeId(id) || !ownsTheme(id)) return false;
      if (store.data.selectedTheme === id) return true;
      store.data.selectedTheme = id;
      store.commit();
      return true;
    },

    setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
      const current = store.data.settings;
      // `current` is the fallback base: an invalid value is ignored, not reset.
      const merged = validateSettings({ ...current, [key]: value }, current);
      if (merged[key] === current[key]) return;
      store.data.settings = merged;
      store.commit();
    },

    addCoins(n: number): number {
      const delta = Number.isFinite(n) ? Math.round(n) : 0;
      if (delta === 0) return store.data.coins;
      const next = Math.min(LIMITS.coins, Math.max(0, store.data.coins + delta));
      if (next === store.data.coins) return next;
      store.data.coins = next;
      store.commit();
      return next;
    },

    spendCoins(n: number): boolean {
      const cost = Number.isFinite(n) ? Math.round(n) : 0;
      if (cost <= 0) return true;
      if (store.data.coins < cost) return false;
      store.data.coins = Math.max(0, store.data.coins - cost);
      store.commit();
      return true;
    },

    recordRun(result: RunInput): RunResult {
      const completed = applyRun(store.data, result, clock());
      store.commit();
      return completed;
    },

    markTutorialSeen(): void {
      if (store.data.seenTutorial) return;
      store.data.seenTutorial = true;
      store.commit();
    },

    /**
     * Each mode scores on its own scale — layers, orders served, centimetres —
     * so a single "best" would be meaningless across them and they each keep
     * their own record.
     */
    recordModeRun(mode: ModeId, score: number, count: number): ModeRecord {
      const prev = store.data.byMode[mode];
      const next: ModeRecord = {
        best: Math.max(prev?.best ?? 0, Math.max(0, Math.round(score))),
        bestCount: Math.max(prev?.bestCount ?? 0, Math.max(0, Math.round(count))),
        runs: (prev?.runs ?? 0) + 1,
        lastPlayedAt: Date.now(),
      };
      store.data.byMode[mode] = next;
      store.commit();
      return next;
    },

    modeRecord(mode: ModeId): ModeRecord {
      return store.data.byMode[mode] ?? { best: 0, bestCount: 0, runs: 0, lastPlayedAt: 0 };
    },

    selectMode(mode: ModeId): void {
      if (store.data.selectedMode === mode) return;
      store.data.selectedMode = mode;
      store.commit();
    },

    onChange(fn: (data: Readonly<SaveData>) => void): () => void {
      return store.onChange(fn);
    },

    save(): void {
      store.flush();
    },

    reset(): void {
      store.reset();
    },
  };

  return meta;
}

/* ------------------------------------------------------------- re-exports */

export { coinsForRun } from './api';
export type { Meta, PurchaseOutcome, SaveData, Sku } from './api';
export {
  FREE_THEME,
  PAID_THEME_SKUS,
  SKUS,
  SKU_COPY,
  THEME_IDS,
  formatCoins,
  formatUsd,
  grantsOf,
  priceLabel,
  skuFor,
} from './catalog';
export type { SkuCopy } from './catalog';
export { HEIGHT_TITLES, heightTitle, isSameLocalDay, localDayIndex, nextStreak } from './progression';
export type { RunInput } from './progression';
export { SimulatedBilling, defaultBilling } from './purchase';
export type { BillingAdapter, PurchaseFlow, SimulatedBillingOptions } from './purchase';
export { SAVE_KEY, SAVE_VERSION, defaultSave, loadSave, validateSave } from './save';
