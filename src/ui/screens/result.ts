import type { RunResult } from '../../core/types';
import { createButton } from '../components/button';
import { createCounter } from '../components/counter';
import { applyPaper, tearLine } from '../components/material';
import { createSheet } from '../components/sheet';
import type { UiCtx } from '../ctx';
import { Bag, formatInt, h } from '../dom';
import { iconHome, iconShare } from '../icons';
import { EASE_IOS, EASE_OUT, animate } from '../motion';
import { INK, PAPER } from '../snack/classes';

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

/**
 * The check number. Derived from the run, never random: the same run always
 * prints the same bill, and two runs in a row never print the same number.
 */
function checkNumber(result: RunResult): string {
  const n = (result.score * 31 + result.layers * 7 + result.perfects * 3) % 9000;
  return `No. ${1000 + n}`;
}

/** One itemised line: what it was on the left, what it came to on the right. */
function billLine(label: string, value: string): HTMLElement {
  return h(
    'div',
    { class: 'sn-bill__line sn-row' },
    h('span', { class: 'sn-bill__k sn-row__label', text: label }),
    h('span', { class: 'sn-bill__v sn-stat__v', text: value }),
  );
}

/**
 * The retention screen, and the one place in the app where the material and the
 * content are the same thing: a run's result genuinely *is* a bill. The score is
 * itemised like a check — layers, perfects, best combo, height — ruled off, and
 * totalled. A personal record is not a ribbon, it is the thing the kitchen
 * stamps on your check on the way out.
 *
 * The paper is ticket stock and carries no `sn-e-*` silhouette. That was
 * originally because an edge was a `clip-path` that bit straight through the
 * right-hand column — "No. 1951" lost its 1. It is now a mask on the stock's
 * own paper layer, so content is safe, but the reason still holds in a second
 * form: the silhouettes are authored against a card's proportions, and a bill
 * runs some five hundred pixels tall, so a tear scaled to it would take a bite
 * out of the sheet rather than an edge off it. The perforations this screen
 * wants are the three drawn rules down its length, which is what a check has.
 */
export function createResultScreen(
  ctx: UiCtx,
  result: RunResult,
  opts: { onDismiss(): void },
): ResultScreen {
  const bag = new Bag();
  const seed = `bill:${result.themeId}`;

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

  const coins = createCounter({ value: 0, format: (v) => `+${formatInt(v)}` });

  // The stamp carries its own rotation from `sn-i-stamp`, so the landing
  // animation drives a wrapper. Animating the stamp itself would have to end on
  // a transform that guessed the ink class's angle, and snap when it let go.
  const stamp = result.isNewBest
    ? h('span', { class: `sn-bill__stamp ${INK.stamp}`, text: 'NEW BEST' })
    : null;
  const stampSlot = stamp
    ? h('div', { class: 'sn-bill__stampslot sn-row' }, stamp)
    : null;

  const bill = h('div', { class: `sn-bill ${PAPER.ticket} ${INK.print}` });
  applyPaper(bill, { kind: 'ticket', seed, edge: 'clean', wear: 0.22 });

  const head = h(
    'div',
    { class: 'sn-bill__head sn-row' },
    h('span', { class: 'sn-bill__brand sn-card__name', text: 'SNACKERY' }),
    h('span', { class: `sn-bill__no ${INK.thermal}`, text: checkNumber(result) }),
  );

  const items = [
    billLine('Layers', formatInt(result.layers)),
    billLine('Perfects', formatInt(result.perfects)),
    billLine('Best combo', `×${formatInt(result.bestCombo)}`),
    billLine('Height', `${formatInt(result.heightCm)} cm`),
  ];

  const total = h(
    'div',
    { class: 'sn-bill__total sn-row' },
    h('span', { class: 'sn-bill__k sn-row__label', text: 'Total' }),
    score.el,
  );

  const coinLine = h(
    'div',
    {
      class: 'sn-bill__line sn-row',
      aria: { label: `${formatInt(result.coinsEarned)} coins earned` },
    },
    h('span', { class: 'sn-bill__k sn-row__label', text: 'Coins earned' }),
    h('span', { class: 'sn-bill__v sn-stat__v' }, coins.el),
  );

  // The closing block, under the last rule: the standing record when this run
  // did not beat it (when it did, the stamp has already said so), the flavour
  // line players screenshot, and the sign-off.
  const foot = h(
    'div',
    { class: 'sn-bill__foot sn-row sn-row--stack' },
    result.isNewBest
      ? null
      : h('p', { class: `sn-bill__note ${INK.thermal}`, text: `Best ${formatInt(result.best)}` }),
    h('p', {
      class: `sn-bill__flavour ${INK.thermal}`,
      text: result.isNewBest
        ? `${heightFlavour(result.heightCm)} — and a personal record`
        : heightFlavour(result.heightCm),
    }),
    h('p', { class: `sn-bill__thanks ${INK.thermal}`, text: 'Thank you — come hungry.' }),
  );

  const rule = (key: string): void => {
    const tear = tearLine(`${seed}:${key}`, 'sn-bill__tear');
    if (tear) bill.appendChild(tear);
  };

  bill.appendChild(head);
  rule('items');
  for (const item of items) bill.appendChild(item);
  rule('total');
  bill.appendChild(total);
  if (stampSlot) bill.appendChild(stampSlot);
  bill.appendChild(coinLine);
  rule('foot');
  bill.appendChild(foot);

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
      bill,
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

      // The bill is one piece of paper; it arrives as one piece of paper, then
      // the action under it. No tilt on it — the sheet body clips horizontally,
      // and a rotated full-width slip loses its corners.
      const rows: HTMLElement[] = [bill, again];
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

      if (stampSlot) {
        // A rubber stamp comes down big and stops dead. `fill: backwards` holds
        // it off the paper through the delay instead of showing it, then
        // stamping it; there is no overshoot because ink does not bounce.
        animate(
          stampSlot,
          [
            { transform: 'scale(1.45) rotate(-9deg)', opacity: 0, easing: EASE_OUT },
            { transform: 'scale(1) rotate(0deg)', opacity: 1 },
          ],
          { duration: 240, delay: 640, easing: EASE_OUT, fill: 'backwards' },
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
