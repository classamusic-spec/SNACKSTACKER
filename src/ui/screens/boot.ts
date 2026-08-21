import { createWordmark } from '../components/wordmark';
import { Bag, h } from '../dom';
import { runExit } from '../motion';

export interface BootScreen {
  readonly el: HTMLElement;
  setProgress(p: number): void;
  dismiss(done: () => void): void;
  destroy(): void;
}

/**
 * Solid brand-neutral field, the wordmark, and one hairline progress rule that
 * fills with `transform: scaleX()`. Cross-dissolves away on `dismissBoot()`.
 */
export function createBootScreen(): BootScreen {
  const bag = new Bag();
  const wordmark = createWordmark({ size: 'boot', tagline: true });

  const fill = h('span', { class: 'sn-boot__fill' });
  const bar = h(
    'div',
    {
      class: 'sn-boot__bar',
      role: 'progressbar',
      aria: { label: 'Loading', valuemin: 0, valuemax: 100, valuenow: 0 },
    },
    fill,
  );

  const el = h(
    'div',
    { class: 'sn-screen sn-boot' },
    h('div', { class: 'sn-boot__inner' }, wordmark.el, bar),
  );

  // Boot never lets a tap slip through to a game that has not started.
  el.addEventListener('pointerdown', (ev) => ev.stopPropagation());

  bag.after(() => wordmark.play(), 60);

  let dismissed = false;

  return {
    el,
    setProgress(p: number): void {
      const v = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0));
      fill.style.setProperty('--p', v.toFixed(4));
      bar.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    },
    dismiss(done: () => void): void {
      if (dismissed) {
        done();
        return;
      }
      dismissed = true;
      el.style.pointerEvents = 'none';
      runExit(
        el,
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: 520, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
        () => {
          el.remove();
          done();
        },
      );
    },
    destroy(): void {
      bag.disposeAll();
      el.remove();
    },
  };
}
