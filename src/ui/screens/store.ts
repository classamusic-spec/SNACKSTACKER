import type { SkuId } from '../../core/types';
import type { StoreItemView, StoreView } from '../api';
import { createButton, createChip } from '../components/button';
import { createStoreCard } from '../components/card';
import { createCounter } from '../components/counter';
import { applyPaper } from '../components/material';
import { createSheet } from '../components/sheet';
import type { UiCtx } from '../ctx';
import { Bag, clear, h } from '../dom';
import { iconCoin } from '../icons';
import { EASE_IOS, animate } from '../motion';
import { INK, PAPER } from '../snack/classes';

export interface StoreScreen {
  readonly el: HTMLElement;
  open(): void;
  close(done?: () => void): void;
  setView(view: StoreView): void;
  setCoins(coins: number, animate?: boolean): void;
  setPending(sku: SkuId | null): void;
  destroy(): void;
}

const BUNDLE_SKU: SkuId = 'bundle_all';
const BOARD_SEED = 'store:board';

/**
 * Full-height sheet of theme cards, with the bundle promoted to a hero card.
 *
 * The shop is a menu: a board at the top naming what is being served and how it
 * is paid for, then the packs as its items. One material added here and only
 * one — the board — because the sheet under it is already greaseproof and the
 * cards on it are the card component's own stock. The price treatment lives on
 * the card, where the price is.
 */
export function createStoreScreen(
  ctx: UiCtx,
  opts: { onDismiss(): void },
): StoreScreen {
  const bag = new Bag();

  // Same chip as Home's, from the same factory, so the shop's balance and the
  // menu's balance are one sticker rather than two near-misses. The static
  // value span is swapped for a live counter; the material is the chip's own.
  const coinChip = createChip({ icon: iconCoin(), className: 'sn-chip--coins' });
  const coins = createCounter({ value: 0, className: 'sn-chip__v' });
  coinChip.value.replaceWith(coins.el);
  coinChip.el.setAttribute('aria-label', 'Coin balance');

  const sheet = createSheet(ctx, {
    name: 'store',
    title: 'Shop',
    ariaLabel: 'Shop',
    variant: 'tall',
    dismissible: true,
    headerExtras: [coinChip.el],
    onDismiss: opts.onDismiss,
  });

  // The board carries information, not decoration: coins are always the better
  // deal when you can afford one, and this is the only place that says so
  // before the player has scrolled to a card that offers it.
  const board = h(
    'div',
    { class: `sn-store__board ${PAPER.board} ${INK.print}` },
    h('h3', { class: 'sn-store__board-title sn-sheet__title', text: "Today's Menu" }),
    h('p', {
      class: `sn-store__board-sub ${INK.thermal}`,
      text: 'Six kitchens. Buy one outright, or unlock it with coins you earn.',
    }),
  );
  applyPaper(board, { kind: 'board', seed: BOARD_SEED, edge: 'clean', wear: 0.2 });

  const list = h('div', { class: 'sn-store__list' });

  const restore = createButton(ctx, {
    label: 'Restore Purchases',
    kind: 'text',
    onPress: () => ctx.hooks.onRestorePurchases(),
  });

  const footer = h(
    'div',
    { class: 'sn-store__footer' },
    restore,
    h('p', {
      class: 'sn-fineprint',
      text: 'Purchases are one-time and unlock forever on this account.',
    }),
  );

  sheet.body.appendChild(h('div', { class: 'sn-stack sn-store' }, board, list, footer));

  let view: StoreView = { items: [], coins: 0 };
  let pending: SkuId | null = null;
  let opened = false;

  const onAction = (item: StoreItemView): void => {
    if (!item.owned) {
      ctx.hooks.onBuy(item.sku);
      return;
    }
    if (item.themeId) ctx.hooks.onSelectTheme(item.themeId);
  };

  const render = (): void => {
    const scroll = sheet.body.scrollTop;
    clear(list);

    if (view.items.length === 0) {
      list.appendChild(
        h('p', { class: 'sn-store__empty', text: 'The kitchen is restocking. Check back shortly.' }),
      );
      return;
    }

    const bundle = view.items.find((i) => i.sku === BUNDLE_SKU);
    const rest = view.items.filter((i) => i.sku !== BUNDLE_SKU);
    const ordered = bundle ? [bundle, ...rest] : rest;

    ordered.forEach((item, index) => {
      const card = createStoreCard(ctx, {
        item,
        hero: item.sku === BUNDLE_SKU,
        pending: pending === item.sku,
        locked: pending !== null && pending !== item.sku,
        onAction,
      });
      list.appendChild(card);
      if (opened) return;
      animate(
        card,
        [
          { transform: 'translate3d(0, 20px, 0)', opacity: 0 },
          { transform: 'translate3d(0, 0, 0)', opacity: 1 },
        ],
        { duration: 420, delay: 90 + index * 55, easing: EASE_IOS },
      );
    });

    sheet.body.scrollTop = scroll;
  };

  return {
    el: sheet.el,
    open(): void {
      opened = false;
      render();
      sheet.open();
      bag.after(() => {
        opened = true;
      }, 700);
    },
    close(done?: () => void): void {
      opened = false;
      sheet.close(done);
    },
    setView(next: StoreView): void {
      view = next;
      coins.set(next.coins, { animate: false });
      render();
    },
    setCoins(value: number, doAnimate = false): void {
      view = { ...view, coins: value };
      coins.set(Math.max(0, Math.round(value)), { animate: doAnimate, duration: 520 });
    },
    setPending(sku: SkuId | null): void {
      pending = sku;
      render();
    },
    destroy(): void {
      bag.disposeAll();
      sheet.destroy();
    },
  };
}
