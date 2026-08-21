import { h } from '../dom';
import { EASE_IOS, animate } from '../motion';

export interface WordmarkOpts {
  /** 'hero' for home, 'boot' for the loading screen. */
  size?: 'hero' | 'boot';
  /** Show the "Stack the snack." lockup line. */
  tagline?: boolean;
}

export interface Wordmark {
  readonly el: HTMLElement;
  /** Stagger each letter down onto the baseline, like layers landing. */
  play(): void;
}

const WORD = 'Snackery';

/**
 * The Snackery wordmark, set in type: tight tracking, large optical size, and a
 * hairline baseline rule that the letters visibly *sit on* — the mark reads as
 * a stack of layers resting on a plate.
 */
export function createWordmark(opts: WordmarkOpts = {}): Wordmark {
  const size = opts.size ?? 'hero';
  const word = h('span', { class: 'sn-wm__word', aria: { hidden: 'true' } });
  const letters: HTMLElement[] = [];

  for (let i = 0; i < WORD.length; i += 1) {
    const letter = h('span', {
      class: 'sn-wm__l',
      text: WORD[i],
      style: { '--i': String(i) },
    });
    letters.push(letter);
    word.appendChild(letter);
  }

  const rule = h('span', { class: 'sn-wm__rule', aria: { hidden: 'true' } });

  const el = h(
    'div',
    { class: `sn-wm sn-wm--${size}`, role: 'img', aria: { label: 'Snackery' } },
    h('span', { class: 'sn-wm__lockup' }, word, rule),
    opts.tagline
      ? h('span', { class: 'sn-wm__tagline', text: 'Stack the snack.', aria: { hidden: 'true' } })
      : null,
  );

  return {
    el,
    play(): void {
      letters.forEach((letter, i) => {
        animate(
          letter,
          [
            { transform: 'translate3d(0, -18px, 0) scale(1.04)', opacity: 0 },
            { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1 },
          ],
          { duration: 460, delay: i * 34, easing: EASE_IOS },
        );
      });
      animate(
        rule,
        [
          { transform: 'scaleX(0)', opacity: 0 },
          { transform: 'scaleX(1)', opacity: 1 },
        ],
        { duration: 520, delay: WORD.length * 34, easing: EASE_IOS },
      );
    },
  };
}
