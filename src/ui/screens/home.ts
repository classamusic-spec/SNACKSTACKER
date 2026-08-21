import { createButton, createChip, createIconButton } from '../components/button';
import { createCounter } from '../components/counter';
import { createWordmark } from '../components/wordmark';
import type { UiCtx } from '../ctx';
import { Bag, formatInt, h, setText, toggleClass } from '../dom';
import { iconBag, iconCoin, iconGear } from '../icons';
import { EASE_IOS, animate, resetAnimations, runExit } from '../motion';

export interface HomeScreen {
  readonly el: HTMLElement;
  enter(instant: boolean): void;
  exit(done?: () => void): void;
  setBest(best: number): void;
  setCoins(coins: number, animate?: boolean): void;
  setThemeName(name: string): void;
  destroy(): void;
}

/**
 * Home is deliberately sparse: the live hero tower renders behind it, so the
 * chrome is a floating lockup at the top and one command cluster at the bottom.
 */
export function createHomeScreen(ctx: UiCtx): HomeScreen {
  const bag = new Bag();
  const wordmark = createWordmark({ size: 'hero', tagline: true });

  const coins = createCounter({ value: 0, className: 'sn-chip__v' });
  const coinChip = h(
    'div',
    { class: 'sn-chip sn-chip--coins', aria: { label: 'Coins' } },
    h('span', { class: 'sn-chip__icon' }, iconCoin()),
    coins.el,
  );

  const best = createChip({ key: 'BEST', value: '0', className: 'sn-chip--best' });

  const playBtn = createButton(ctx, {
    label: 'PLAY',
    kind: 'primary',
    className: 'sn-btn--play',
    onPress: () => ctx.hooks.onPlay(),
  });

  const shopBtn = createIconButton(ctx, {
    icon: iconBag(),
    ariaLabel: 'Shop',
    onPress: () => ctx.hooks.onOpenStore(),
  });

  const settingsBtn = createIconButton(ctx, {
    icon: iconGear(),
    ariaLabel: 'Settings',
    onPress: () => ctx.hooks.onOpenSettings(),
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

  const top = h('div', { class: 'sn-home__top' }, coinChip);
  const lockup = h('div', { class: 'sn-home__lockup' }, wordmark.el);
  const cluster = h(
    'div',
    { class: 'sn-home__cluster' },
    best.el,
    playBtn,
    h('div', { class: 'sn-home__row' }, shopBtn, settingsBtn),
    themeChip,
  );

  const el = h('div', { class: 'sn-screen sn-home' }, top, lockup, cluster);

  const staggered: HTMLElement[] = [best.el, playBtn, cluster.children[2] as HTMLElement, themeChip];

  let bestValue = 0;

  return {
    el,
    enter(instant: boolean): void {
      resetAnimations(el);
      el.classList.remove('is-leaving');
      el.style.opacity = '';
      if (instant) return;
      wordmark.play();
      animate(coinChip, [{ opacity: 0 }, { opacity: 1 }], { duration: 380, delay: 120, easing: EASE_IOS });
      staggered.forEach((node, i) => {
        animate(
          node,
          [
            { transform: 'translate3d(0, 22px, 0)', opacity: 0 },
            { transform: 'translate3d(0, 0, 0)', opacity: 1 },
          ],
          { duration: 480, delay: 140 + i * 60, easing: EASE_IOS },
        );
      });
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
    setBest(value: number): void {
      bestValue = Math.max(0, Math.round(value));
      setText(best.value, formatInt(bestValue));
      toggleClass(best.el, 'is-hidden', bestValue <= 0);
      best.el.setAttribute('aria-label', `Best score ${formatInt(bestValue)}`);
    },
    setCoins(value: number, doAnimate = false): void {
      coins.set(Math.max(0, Math.round(value)), { animate: doAnimate, duration: 520 });
    },
    setThemeName(name: string): void {
      setText(themeName, name);
      themeChip.setAttribute('aria-label', `Theme: ${name}. Change theme.`);
    },
    destroy(): void {
      bag.disposeAll();
      el.remove();
    },
  };
}
