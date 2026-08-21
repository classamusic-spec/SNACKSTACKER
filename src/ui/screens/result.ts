import type { RunResult } from '../../core/types';
import { createButton } from '../components/button';
import { createCounter } from '../components/counter';
import { createSheet } from '../components/sheet';
import type { UiCtx } from '../ctx';
import { Bag, formatInt, h } from '../dom';
import { iconCoin, iconHome, iconShare, iconSpark } from '../icons';
import { EASE_IOS, EASE_SPRING, animate } from '../motion';

export interface ResultScreen {
  readonly el: HTMLElement;
  open(): void;
  close(done?: () => void): void;
  destroy(): void;
}

/** Flavour copy for the tower height — the line players screenshot. */
export function heightFlavour(cm: number): string {
  if (cm < 15) return 'barely a bite';
  if (cm < 30) return 'a light snack';
  if (cm < 60) return 'a proper stack';
  if (cm < 100) return 'a tall order';
  if (cm < 160) return 'a monument';
  return 'a legend of the buffet';
}

function statCell(label: string, value: string): HTMLElement {
  return h(
    'div',
    { class: 'sn-stat' },
    h('span', { class: 'sn-stat__v', text: value }),
    h('span', { class: 'sn-stat__k', text: label }),
  );
}

/**
 * The retention screen: count-up score, NEW BEST ribbon, the four stats worth
 * bragging about, coins ticking in, and one obvious way back into a run.
 */
export function createResultScreen(
  ctx: UiCtx,
  result: RunResult,
  opts: { onDismiss(): void },
): ResultScreen {
  const bag = new Bag();

  const sheet = createSheet(ctx, {
    name: 'result',
    ariaLabel: 'Run complete',
    dismissible: false,
    showClose: false,
    onDismiss: opts.onDismiss,
  });

  const score = createCounter({ value: 0, className: 'sn-result__score', tag: 'div' });
  if (result.isNewBest) score.el.classList.add('is-best');
  score.el.setAttribute('role', 'status');
  score.el.setAttribute('aria-live', 'polite');
  score.el.setAttribute('aria-label', `Final score ${formatInt(result.score)}`);

  const ribbon = result.isNewBest
    ? h(
        'div',
        { class: 'sn-ribbon' },
        h('span', { class: 'sn-ribbon__spark' }, iconSpark()),
        h('span', { class: 'sn-ribbon__text', text: 'NEW BEST' }),
      )
    : null;

  const header = h(
    'div',
    { class: 'sn-result__head' },
    ribbon,
    score.el,
    h('div', {
      class: 'sn-result__flavour',
      text: result.isNewBest
        ? `${heightFlavour(result.heightCm)} — and a personal record`
        : heightFlavour(result.heightCm),
    }),
    result.isNewBest
      ? null
      : h('div', { class: 'sn-result__best', text: `Best ${formatInt(result.best)}` }),
  );

  const stats = h(
    'div',
    { class: 'sn-stats' },
    statCell('Layers', formatInt(result.layers)),
    statCell('Perfects', formatInt(result.perfects)),
    statCell('Best combo', `×${formatInt(result.bestCombo)}`),
    statCell('Height', `${formatInt(result.heightCm)} cm`),
  );

  const coins = createCounter({ value: 0, format: (v) => `+${formatInt(v)}` });
  const coinRow = h(
    'div',
    { class: 'sn-coinrow', aria: { label: `${formatInt(result.coinsEarned)} coins earned` } },
    h('span', { class: 'sn-coinrow__icon' }, iconCoin()),
    coins.el,
    h('span', { class: 'sn-coinrow__label', text: 'coins earned' }),
  );

  const again = createButton(ctx, {
    label: 'Play Again',
    kind: 'primary',
    wide: true,
    onPress: () => ctx.hooks.onRestart(),
  });

  const home = createButton(ctx, {
    label: 'Home',
    kind: 'secondary',
    icon: iconHome(),
    onPress: () => ctx.hooks.onHome(),
  });

  const share = createButton(ctx, {
    label: 'Share',
    kind: 'secondary',
    icon: iconShare(),
    onPress: () => ctx.hooks.onShare(result),
  });

  const shopLink = createButton(ctx, {
    label: 'Visit the Shop',
    kind: 'text',
    onPress: () => ctx.hooks.onOpenStore(),
  });

  sheet.body.appendChild(
    h(
      'div',
      { class: 'sn-stack sn-result' },
      header,
      stats,
      coinRow,
      again,
      h('div', { class: 'sn-duo' }, home, share),
      shopLink,
    ),
  );

  return {
    el: sheet.el,
    open(): void {
      sheet.open();
      bag.after(() => {
        score.set(result.score, { animate: true, duration: 700 });
      }, 160);
      bag.after(() => {
        coins.set(result.coinsEarned, { animate: true, duration: 620, pop: true });
      }, 420);

      const rows: HTMLElement[] = [stats, coinRow, again];
      rows.forEach((node, i) => {
        animate(
          node,
          [
            { transform: 'translate3d(0, 16px, 0)', opacity: 0 },
            { transform: 'translate3d(0, 0, 0)', opacity: 1 },
          ],
          { duration: 420, delay: 220 + i * 70, easing: EASE_IOS },
        );
      });

      if (ribbon) {
        animate(
          ribbon,
          [
            { transform: 'translate3d(0, -14px, 0) scale(0.6) rotate(-6deg)', opacity: 0 },
            { transform: 'translate3d(0, 0, 0) scale(1) rotate(-2.5deg)', opacity: 1 },
          ],
          { duration: 620, delay: 300, easing: EASE_SPRING },
        );
      }
    },
    close: (done) => sheet.close(done),
    destroy(): void {
      bag.disposeAll();
      sheet.destroy();
    },
  };
}
