import type { UiCtx } from '../ctx';
import { h } from '../dom';

export interface SwitchOpts {
  label: string;
  hint?: string;
  value: boolean;
  onChange(value: boolean): void;
}

export interface SwitchHandle {
  readonly el: HTMLElement;
  set(value: boolean): void;
}

/**
 * iOS-style switch built on a real `<button role="switch">` so it is keyboard
 * operable and announced correctly. The knob animates on `transform` only.
 */
export function createSwitch(ctx: UiCtx, opts: SwitchOpts): SwitchHandle {
  let value = opts.value;

  const knob = h('span', { class: 'sn-switch__knob' });
  const track = h('span', { class: 'sn-switch__track' }, knob);

  const btn = h('button', {
    class: 'sn-switch',
    type: 'button',
    role: 'switch',
    aria: { checked: value ? 'true' : 'false', label: opts.label },
  });
  btn.appendChild(track);

  const paint = (): void => {
    btn.classList.toggle('is-on', value);
    btn.setAttribute('aria-checked', value ? 'true' : 'false');
  };
  paint();

  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    value = !value;
    paint();
    ctx.press('toggle');
    opts.onChange(value);
  });
  btn.addEventListener('pointerdown', (ev) => ev.stopPropagation());

  const row = h(
    'div',
    { class: 'sn-row' },
    h(
      'span',
      { class: 'sn-row__text' },
      h('span', { class: 'sn-row__label', text: opts.label }),
      opts.hint ? h('span', { class: 'sn-row__hint', text: opts.hint }) : null,
    ),
    btn,
  );

  return {
    el: row,
    set(next: boolean): void {
      if (next === value) return;
      value = next;
      paint();
    },
  };
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedOpts<T extends string> {
  label: string;
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange(value: T): void;
}

export interface SegmentedHandle<T extends string> {
  readonly el: HTMLElement;
  set(value: T): void;
}

/** Segmented control with a sliding selection pill (transform-driven). */
export function createSegmented<T extends string>(
  ctx: UiCtx,
  opts: SegmentedOpts<T>,
): SegmentedHandle<T> {
  let value = opts.value;
  const count = opts.options.length;
  const indicator = h('span', { class: 'sn-seg__pill', aria: { hidden: 'true' } });
  const group = h('div', {
    class: 'sn-seg',
    role: 'radiogroup',
    aria: { label: opts.label },
    style: { '--seg-count': String(count) },
  });
  group.appendChild(indicator);

  const buttons: HTMLButtonElement[] = [];
  opts.options.forEach((opt) => {
    const b = h('button', {
      class: 'sn-seg__item',
      type: 'button',
      role: 'radio',
      text: opt.label,
      aria: { checked: 'false' },
    });
    b.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (value === opt.value) return;
      value = opt.value;
      paint();
      ctx.press('toggle');
      opts.onChange(opt.value);
    });
    buttons.push(b);
    group.appendChild(b);
  });

  const paint = (): void => {
    const index = Math.max(0, opts.options.findIndex((o) => o.value === value));
    indicator.style.setProperty('--seg-index', String(index));
    buttons.forEach((b, i) => {
      b.classList.toggle('is-on', i === index);
      b.setAttribute('aria-checked', i === index ? 'true' : 'false');
    });
  };
  paint();

  const row = h(
    'div',
    { class: 'sn-row sn-row--stack' },
    h('span', { class: 'sn-row__label', text: opts.label }),
    group,
  );

  return {
    el: row,
    set(next: T): void {
      if (next === value) return;
      value = next;
      paint();
    },
  };
}
