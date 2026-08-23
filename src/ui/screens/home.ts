import type { ModeId } from '../../modes/api';
import type { ModeCardView } from '../api';
import { createButton, createIconButton } from '../components/button';
import { createCounter } from '../components/counter';
import { createModeDeck } from '../components/modeDeck';
import { createWordmark } from '../components/wordmark';
import type { UiCtx } from '../ctx';
import { h } from '../dom';
import { iconBag, iconCoin, iconGear } from '../icons';
import { defaultModeCards } from '../modeCards';
import { EASE_IOS, animate, resetAnimations, runExit } from '../motion';
import { hexFromInt, inkFor, rgbTriplet } from '../theme';

export interface HomeScreen {
  readonly el: HTMLElement;
  enter(instant: boolean): void;
  /** Re-show an already-mounted home without replaying its entrance. */
  wake(): void;
  exit(done?: () => void): void;
  setModes(cards: readonly ModeCardView[], selectedId: ModeId): void;
  setBest(best: number): void;
  setCoins(coins: number, animate?: boolean): void;
  setThemeName(name: string): void;
  destroy(): void;
}

/**
 * Home is a mode picker floating over a live 3D hero scene, so it is built as
 * three thin bands with the world showing between them: a utility bar at the
 * top, the wordmark under it, and a command deck at the bottom — swipeable
 * mode cards, the focused mode's rules and record, then PLAY.
 *
 * The whole screen adopts the focused mode's accent (`--accent` is overridden
 * on this element, not on the root), so there is still exactly one accent
 * colour on screen and it belongs to the thing PLAY is about to start.
 */
export function createHomeScreen(ctx: UiCtx): HomeScreen {
  const wordmark = createWordmark({ size: 'hero' });

  // ------------------------------------------------------------- top bar
  const coins = createCounter({ value: 0, className: 'sn-chip__v' });
  const coinChip = h(
    'div',
    { class: 'sn-chip sn-chip--coins', aria: { label: 'Coins' } },
    h('span', { class: 'sn-chip__icon' }, iconCoin()),
    coins.el,
  );

  const settingsBtn = createIconButton(ctx, {
    icon: iconGear(),
    ariaLabel: 'Settings',
    className: 'sn-btn--icon-sm',
    onPress: () => ctx.hooks.onOpenSettings(),
  });

  const shopBtn = createIconButton(ctx, {
    icon: iconBag(),
    ariaLabel: 'Shop',
    className: 'sn-btn--icon-sm',
    onPress: () => ctx.hooks.onOpenStore(),
  });

  const bar = h(
    'div',
    { class: 'sn-home__bar' },
    settingsBtn,
    h('div', { class: 'sn-home__bar-right' }, coinChip, shopBtn),
  );

  // ---------------------------------------------------------------- picker
  const deck = createModeDeck(ctx, {
    onFocus: (card) => applyModeAccent(card),
    onCommit: (id) => {
      selectedId = id;
      ctx.hooks.onSelectMode(id);
    },
    onActivate: () => ctx.hooks.onPlay(),
  });

  // ----------------------------------------------------------------- play
  const playBtn = createButton(ctx, {
    label: 'PLAY',
    kind: 'primary',
    className: 'sn-btn--play',
    ariaLabel: 'Play',
    onPress: () => ctx.hooks.onPlay(),
  });

  const themeName = h('span', { class: 'sn-chip__v', text: '—' });
  const themeChip = h('button', {
    class: 'sn-chip sn-chip--theme',
    type: 'button',
    aria: { label: 'Change theme' },
  });
  themeChip.appendChild(h('span', { class: 'sn-chip__dot', aria: { hidden: 'true' } }));
  themeChip.appendChild(themeName);
  themeChip.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  themeChip.addEventListener('click', (ev) => {
    ev.stopPropagation();
    ctx.press('tap');
    ctx.hooks.onOpenStore();
  });

  const cluster = h('div', { class: 'sn-home__cluster' }, deck.el, playBtn, themeChip);

  const lockup = h('div', { class: 'sn-home__lockup' }, wordmark.el);
  const el = h('div', { class: 'sn-screen sn-home' }, bar, lockup, cluster);

  let selectedId: ModeId = 'stack';

  /**
   * Retint the screen to the focused mode. Custom properties do not animate,
   * but every consumer already transitions `background-color` / `border-color`
   * / `box-shadow` on `--dur-tint`, so the swap sweeps rather than snaps.
   */
  function applyModeAccent(card: ModeCardView): void {
    selectedId = card.id;
    el.style.setProperty('--accent', hexFromInt(card.accent));
    el.style.setProperty('--accent-rgb', rgbTriplet(card.accent));
    el.style.setProperty('--accent-ink', inkFor(card.accent));
    // A reserved mode must not be startable, or PLAY would lie.
    playBtn.disabled = card.locked;
    playBtn.setAttribute(
      'aria-label',
      card.locked ? `${card.name} is not unlocked yet` : `Play ${card.name}`,
    );
  }

  deck.setCards(defaultModeCards(), selectedId);

  const staggered: HTMLElement[] = [playBtn, themeChip];

  return {
    el,
    enter(instant: boolean): void {
      resetAnimations(el);
      el.classList.remove('is-leaving');
      el.style.opacity = '';
      if (instant) return;
      wordmark.play();
      deck.play();
      animate(bar, [{ opacity: 0 }, { opacity: 1 }], {
        duration: 380,
        delay: 120,
        easing: EASE_IOS,
      });
      staggered.forEach((node, i) => {
        animate(
          node,
          [
            { transform: 'translate3d(0, 22px, 0)', opacity: 0 },
            { transform: 'translate3d(0, 0, 0)', opacity: 1 },
          ],
          { duration: 480, delay: 440 + i * 70, easing: EASE_IOS },
        );
      });
    },

    /**
     * Closing a sheet used to re-run `enter()`, which replayed the wordmark
     * landing and the whole deck stagger every single time — the most
     * irritating thing on the screen. Home is already on screen at that point,
     * so all it needs is to drop any leftover exit state.
     */
    wake(): void {
      el.classList.remove('is-leaving');
      el.style.opacity = '';
      el.style.transform = '';
    },

    exit(done?: () => void): void {
      el.classList.add('is-leaving');
      runExit(
        el,
        [
          { transform: 'translate3d(0,0,0) scale(1)', opacity: 1 },
          { transform: 'translate3d(0, 10px, 0) scale(0.985)', opacity: 0 },
        ],
        { duration: 260, easing: EASE_IOS },
        () => {
          el.remove();
          done?.();
        },
      );
    },

    setModes(cards: readonly ModeCardView[], id: ModeId): void {
      if (cards.length === 0) return;
      selectedId = cards.some((c) => c.id === id) ? id : cards[0].id;
      deck.setCards(cards, selectedId);
    },

    /**
     * The shell's single "best" is the best for the mode the player is looking
     * at — per-mode records otherwise arrive through `setModes`.
     */
    setBest(value: number): void {
      deck.setBest(selectedId, value);
    },

    setCoins(value: number, doAnimate = false): void {
      coins.set(Math.max(0, Math.round(value)), { animate: doAnimate, duration: 520 });
    },

    setThemeName(name: string): void {
      themeName.textContent = name;
      themeChip.setAttribute('aria-label', `Theme: ${name}. Change theme.`);
    },

    destroy(): void {
      deck.destroy();
      el.remove();
    },
  };
}
