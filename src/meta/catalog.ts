/**
 * The Snackery store catalogue.
 *
 * Prices are lifted verbatim from DESIGN.md §3 — do not improvise them here.
 *
 * Dual currency is deliberate: every theme carries BOTH a real-money price and
 * a coin price, so a player who never spends a cent can still earn their way
 * into the whole menu. Coins are the generous path, not a teaser. Only the
 * bundle and the ad removal are money-only (a bundle you could grind would just
 * be a worse version of buying the themes one at a time).
 */
import type { SkuId, ThemeId } from '../core/types';
import type { Sku } from './api';

/** Every theme id, in shop order. Diner is the free default and comes first. */
export const THEME_IDS: readonly ThemeId[] = Object.freeze([
  'diner',
  'sushi',
  'candy',
  'taco',
  'breakfast',
  'pizza',
]);

/** The theme every player owns from first launch. */
export const FREE_THEME: ThemeId = 'diner';

/** Paid themes, i.e. everything the Full Menu bundle grants. */
export const PAID_THEME_SKUS: readonly SkuId[] = Object.freeze([
  'sushi',
  'candy',
  'taco',
  'breakfast',
  'pizza',
]);

const TABLE: Sku[] = [
  { id: 'diner', themeId: 'diner', priceUsd: 0, coinPrice: null },
  { id: 'sushi', themeId: 'sushi', priceUsd: 1.99, coinPrice: 2500 },
  { id: 'candy', themeId: 'candy', priceUsd: 1.99, coinPrice: 2500 },
  { id: 'taco', themeId: 'taco', priceUsd: 1.99, coinPrice: 2500 },
  { id: 'breakfast', themeId: 'breakfast', priceUsd: 1.99, coinPrice: 3000 },
  { id: 'pizza', themeId: 'pizza', priceUsd: 1.99, coinPrice: 3000 },
  {
    id: 'bundle_all',
    themeId: null,
    priceUsd: 4.99,
    coinPrice: null,
    badge: 'Best value',
    grants: [...PAID_THEME_SKUS],
  },
];

function freezeSku(sku: Sku): Sku {
  if (sku.grants) Object.freeze(sku.grants);
  return Object.freeze(sku);
}

/** The authoritative SKU table. Frozen — the store never mutates its own prices. */
export const SKUS: readonly Sku[] = Object.freeze(TABLE.map(freezeSku));

const BY_ID = new Map<string, Sku>(SKUS.map((s) => [s.id, s]));

/** Accepts any string so save validation can use it as an existence check. */
export function skuFor(id: string): Sku | undefined {
  return BY_ID.get(id);
}

export function isSkuId(value: unknown): value is SkuId {
  return typeof value === 'string' && BY_ID.has(value);
}

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_IDS.includes(value as ThemeId);
}

/** Catalogue position, used to keep `owned` lists in a stable, human order. */
export function skuOrder(id: SkuId): number {
  const i = SKUS.findIndex((s) => s.id === id);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

export function sortSkus(ids: Iterable<SkuId>): SkuId[] {
  return [...ids].sort((a, b) => skuOrder(a) - skuOrder(b));
}

/**
 * Everything a purchase of `sku` entitles you to: the SKU itself plus anything
 * it grants (the bundle grants the five paid themes AND stays owned in its own
 * right, so the store can show it as purchased).
 */
export function grantsOf(sku: Sku): SkuId[] {
  const out = new Set<SkuId>([sku.id]);
  for (const g of sku.grants ?? []) if (isSkuId(g)) out.add(g);
  return sortSkus(out);
}

/* ------------------------------------------------------------------ labels */

/** 2500 -> "2,500". Deliberately locale-free so prices never wobble. */
export function formatCoins(n: number): string {
  const v = Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatUsd(n: number): string {
  return `$${Math.max(0, n).toFixed(2)}`;
}

/**
 * Shop-card price string.
 *
 * `priceLabel('sushi')`           -> "$1.99"
 * `priceLabel('diner')`           -> "Free"
 * `priceLabel('sushi', 'coins')`  -> "2,500 coins"
 *
 * Returns an em dash for anything unpriceable in the requested currency, so a
 * card never renders "undefined".
 */
export function priceLabel(sku: Sku | SkuId, currency: 'money' | 'coins' = 'money'): string {
  const def = typeof sku === 'string' ? skuFor(sku) : sku;
  if (!def) return '—';
  if (currency === 'coins') {
    return def.coinPrice === null ? '—' : `${formatCoins(def.coinPrice)} coins`;
  }
  return def.priceUsd <= 0 ? 'Free' : formatUsd(def.priceUsd);
}

/* -------------------------------------------------------------- shop copy */

export interface SkuCopy {
  name: string;
  tagline: string;
  glyph: string;
}

/**
 * Copy for the SKUs that have no theme behind them. Theme names/taglines live
 * with the content agent (`ThemeDef.name` / `.tagline`) — the store should read
 * them from there so there is exactly one source of truth per theme.
 */
export const SKU_COPY: Readonly<Partial<Record<SkuId, SkuCopy>>> = Object.freeze({
  bundle_all: Object.freeze({
    name: 'Full Menu',
    tagline: 'Every theme, forever. One tap, done.',
    glyph: '🍱',
  }),
});
