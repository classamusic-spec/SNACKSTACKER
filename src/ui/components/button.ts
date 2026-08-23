import type { PressKind, UiCtx } from '../ctx';
import { h } from '../dom';
import { CONDIMENT, INK } from '../snack/classes';
import { splatLayer } from './material';

export type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'text' | 'icon';

/**
 * One condiment per role, and only one — a screen that is splat *and* sachet
 * *and* cap on the same tier of control is a jumble sale.
 *
 * - `primary`   the ketchup splat. Exactly one per screen.
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

  // The splat is drawn, not styled, so the material class and the shape go on
  // together: a `sn-m-splat` with no splat in it is a primary action with no
  // surface. Until the kit can draw one the button keeps its accent pill.
  // Seeded off the button's own name so PLAY and Resume are different splats
  // and each is the same splat on every mount.
  const splat =
    kind === 'primary'
      ? splatLayer({
          seed: `splat:${opts.ariaLabel ?? opts.label ?? opts.className ?? 'primary'}`,
          droplets: 3,
          irregularity: 0.68,
          drips: 2,
        })
      : null;
  if (splat) classes.push(CONDIMENT.splat);

  const btn = h('button', {
    class: classes.join(' '),
    type: 'button',
    aria: { label: opts.ariaLabel },
  });

  // First child, so it paints under the icon and label. It is `aria-hidden`
  // and the button itself stays the rectangular >= 44px hit target — the hit
  // region never follows the splat outline.
  if (splat) btn.appendChild(splat);

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
