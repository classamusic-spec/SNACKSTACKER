import type { PressKind, UiCtx } from '../ctx';
import { h } from '../dom';
import { CONDIMENT, INK } from '../snack/classes';

export type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'text' | 'icon';

/**
 * One condiment per role, and only one — a screen that is splat *and* sachet
 * *and* cap on the same tier of control is a jumble sale.
 *
 * - `primary`   a plain filled pill in the theme's accent. Deliberately NOT a
 *               condiment: a splat here read as blood rather than sauce, and a
 *               primary action is the one control that can never be ambiguous.
 *               The kit still draws splats (see `snack/apply.ts`); nothing on a
 *               button asks for one.
 * - `secondary` a condiment sachet.
 * - `icon`      an enamel bottle cap; round controls are already cap-shaped.
 * - `text`      no material at all, just ink on whatever paper it sits on.
 * - `ghost`     unchanged: an outline, deliberately material-free.
 */
const MATERIAL: Partial<Record<ButtonKind, string>> = {
  secondary: CONDIMENT.sachet,
  icon: CONDIMENT.cap,
  text: INK.print,
};

export interface ButtonOpts {
  label?: string;
  kind?: ButtonKind;
  /** Inline SVG placed before the label (or alone, for icon buttons). */
  icon?: SVGElement;
  /** Required for icon-only buttons. */
  ariaLabel?: string;
  className?: string;
  /** Which press sound the audio engine should make. */
  press?: PressKind;
  /** Stretch to the container width. */
  wide?: boolean;
  onPress(): void;
}

/**
 * Every button in the app funnels through here, which guarantees
 * `hooks.onUiPress(kind)` fires before the specific hook, that hit targets stay
 * >= 44px, and that press feedback (scale 0.96 + dim overlay in 90ms) is
 * identical everywhere.
 */
export function createButton(ctx: UiCtx, opts: ButtonOpts): HTMLButtonElement {
  const kind = opts.kind ?? 'secondary';
  const classes = ['sn-btn', `sn-btn--${kind}`];
  if (opts.wide) classes.push('sn-btn--wide');
  if (opts.className) classes.push(opts.className);

  const material = MATERIAL[kind];
  if (material) classes.push(material);

  const btn = h('button', {
    class: classes.join(' '),
    type: 'button',
    aria: { label: opts.ariaLabel },
  });

  if (opts.icon) {
    btn.appendChild(h('span', { class: 'sn-btn__icon' }, opts.icon));
  }
  if (opts.label) {
    btn.appendChild(h('span', { class: 'sn-btn__label', text: opts.label }));
  }
  btn.appendChild(h('span', { class: 'sn-btn__dim', aria: { hidden: 'true' } }));

  const down = (ev: PointerEvent): void => {
    // Stop the tap from also reaching the game canvas (the whole screen is the
    // drop button during play).
    ev.stopPropagation();
    if (btn.disabled) return;
    btn.classList.add('is-pressed');
  };
  const up = (): void => btn.classList.remove('is-pressed');

  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('pointerleave', up);
  btn.addEventListener('blur', up);
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    if (btn.disabled) return;
    ctx.press(opts.press ?? 'tap');
    opts.onPress();
  });

  return btn;
}

/** A circular glass icon button (pause, close, shop, settings). */
export function createIconButton(
  ctx: UiCtx,
  opts: { icon: SVGElement; ariaLabel: string; className?: string; press?: PressKind; onPress(): void },
): HTMLButtonElement {
  return createButton(ctx, {
    kind: 'icon',
    icon: opts.icon,
    ariaLabel: opts.ariaLabel,
    className: opts.className,
    press: opts.press,
    onPress: opts.onPress,
  });
}

/**
 * Small label chip: `BEST 1,240`. A peel-off vinyl sticker — the bottle cap is
 * spoken for by the round icon buttons, and a screen does not need both.
 */
export function createChip(opts: {
  key?: string;
  value?: string;
  className?: string;
  icon?: SVGElement;
}): { el: HTMLElement; value: HTMLElement } {
  const value = h('span', { class: 'sn-chip__v', text: opts.value ?? '' });
  const el = h(
    'div',
    {
      class: `sn-chip ${CONDIMENT.sticker} ${INK.print}${
        opts.className ? ` ${opts.className}` : ''
      }`,
    },
    opts.icon ? h('span', { class: 'sn-chip__icon' }, opts.icon) : null,
    opts.key ? h('span', { class: 'sn-chip__k', text: opts.key }) : null,
    value,
  );
  return { el, value };
}
