/**
 * Purchase flow + billing seam.
 *
 * There is no real billing SDK in a web build, so `SimulatedBilling` stands in.
 * It is named "simulated" everywhere on purpose: it never contacts a store, no
 * money moves, and it must never be dressed up as a real payment sheet in the
 * UI. It exists so the pending spinner, the grant path and the persistence path
 * are all exercised for real.
 *
 * SHIPPING FOR REAL: implement `BillingAdapter` over StoreKit 2 / Play Billing
 * in the native wrapper, then change the one line in `defaultBilling()` below
 * (or pass `createMeta({ billing })`). Nothing else in the app needs to know —
 * the flow, the grants and the save all sit on this side of the seam.
 */
import type { SkuId } from '../core/types';
import type { PurchaseOutcome, Sku } from './api';
import { grantsOf, skuFor, sortSkus } from './catalog';
import type { SaveStore } from './save';

export interface BillingAdapter {
  readonly kind: 'simulated' | 'native';
  purchase(sku: Sku): Promise<{ ok: boolean; cancelled?: boolean }>;
  restore(): Promise<SkuId[]>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SimulatedBillingOptions {
  /** Round-trip latency, so the UI's pending state is a real state. */
  latencyMs?: number;
  /** Entitlements a `restore()` should report. Empty by default: a browser
   *  build has no receipts to restore. */
  entitlements?: SkuId[];
}

/**
 * Development / web-build billing. Always succeeds after a realistic delay.
 * NOT a payment processor. NOT a mock of one — it charges nobody.
 */
export class SimulatedBilling implements BillingAdapter {
  readonly kind = 'simulated';

  private readonly latencyMs: number;
  private readonly entitlements: SkuId[];

  constructor(options: SimulatedBillingOptions = {}) {
    this.latencyMs = options.latencyMs ?? 700;
    this.entitlements = [...(options.entitlements ?? [])];
  }

  async purchase(_sku: Sku): Promise<{ ok: boolean; cancelled?: boolean }> {
    await delay(this.latencyMs);
    return { ok: true };
  }

  async restore(): Promise<SkuId[]> {
    await delay(Math.round(this.latencyMs * 0.6));
    return [...this.entitlements];
  }
}

/** The single swap point. Replace with the native bridge when one exists. */
export function defaultBilling(): BillingAdapter {
  return new SimulatedBilling();
}

export interface PurchaseFlow {
  purchase(id: SkuId, method?: 'money' | 'coins'): Promise<PurchaseOutcome>;
  restore(): Promise<SkuId[]>;
}

/**
 * Write the entitlements into the save. Returns the ids that were actually new,
 * in catalogue order.
 */
function grant(store: SaveStore, sku: Sku): SkuId[] {
  const owned = new Set<SkuId>(store.data.owned);
  const added: SkuId[] = [];
  for (const id of grantsOf(sku)) {
    if (!owned.has(id)) {
      owned.add(id);
      added.push(id);
    }
  }
  store.data.owned = sortSkus(owned);
  return sortSkus(added);
}

export function createPurchaseFlow(deps: { store: SaveStore; billing: BillingAdapter }): PurchaseFlow {
  const { store, billing } = deps;
  /** Guards against a double-tapped buy button charging twice. */
  const inFlight = new Map<SkuId, Promise<PurchaseOutcome>>();

  function buyWithCoins(sku: Sku): PurchaseOutcome {
    const price = sku.coinPrice;
    // Not a coin SKU (bundle / ad removal). A UI that offers this is wrong, so
    // fail rather than quietly charging money instead.
    if (price === null) return { ok: false, reason: 'failed' };
    if (store.data.coins < price) return { ok: false, reason: 'insufficient_coins' };
    store.data.coins = Math.max(0, store.data.coins - price);
    const granted = grant(store, sku);
    store.commit({ immediate: true });
    return { ok: true, sku: sku.id, granted, method: 'coins' };
  }

  async function buyWithMoney(sku: Sku): Promise<PurchaseOutcome> {
    let result: { ok: boolean; cancelled?: boolean };
    try {
      result = await billing.purchase(sku);
    } catch {
      return { ok: false, reason: 'failed' };
    }
    if (!result.ok) return { ok: false, reason: result.cancelled ? 'cancelled' : 'failed' };
    // Ownership can have changed while the sheet was up (restore, bundle).
    if (store.data.owned.includes(sku.id)) {
      return { ok: true, sku: sku.id, granted: [], method: 'already' };
    }
    const granted = grant(store, sku);
    store.commit({ immediate: true });
    return { ok: true, sku: sku.id, granted, method: 'money' };
  }

  return {
    purchase(id: SkuId, method: 'money' | 'coins' = 'money'): Promise<PurchaseOutcome> {
      const sku = skuFor(id);
      if (!sku) return Promise.resolve({ ok: false, reason: 'unknown_sku' });
      // Already yours: succeed, grant nothing, charge nothing.
      if (store.data.owned.includes(id)) {
        return Promise.resolve({ ok: true, sku: id, granted: [], method: 'already' });
      }
      const pending = inFlight.get(id);
      if (pending) return pending;

      const run = method === 'coins' ? Promise.resolve(buyWithCoins(sku)) : buyWithMoney(sku);
      const tracked = run.finally(() => {
        inFlight.delete(id);
      });
      inFlight.set(id, tracked);
      return tracked;
    },

    /**
     * Ask the billing layer what this account owns and fold it in.
     * Returns every restored entitlement (bundle contents expanded), whether or
     * not it was already owned locally — that is what "Restore purchases" means
     * to a player, and an empty array is the honest "nothing to restore".
     */
    async restore(): Promise<SkuId[]> {
      let reported: SkuId[];
      try {
        reported = await billing.restore();
      } catch {
        return [];
      }
      const restored = new Set<SkuId>();
      for (const id of reported) {
        const sku = skuFor(id);
        if (!sku) continue;
        for (const g of grantsOf(sku)) restored.add(g);
      }
      if (restored.size === 0) return [];

      const owned = new Set<SkuId>(store.data.owned);
      let changed = false;
      for (const id of restored) {
        if (!owned.has(id)) {
          owned.add(id);
          changed = true;
        }
      }
      if (changed) {
        store.data.owned = sortSkus(owned);
        store.commit({ immediate: true });
      }
      return sortSkus(restored);
    },
  };
}
