import { formatInt, h, setText } from '../dom';
import { countTo, pop } from '../motion';

export interface CounterOpts {
  value?: number;
  className?: string;
  format?(value: number): string;
  /** Wrapping element tag; defaults to a span. */
  tag?: 'span' | 'div';
}

export interface Counter {
  readonly el: HTMLElement;
  /** Set immediately, or tick up over `duration` ms. */
  set(value: number, opts?: { animate?: boolean; duration?: number; pop?: boolean }): void;
  readonly value: number;
}

/** A tabular-numerals number that can count up on a rAF ease-out. */
export function createCounter(opts: CounterOpts = {}): Counter {
  const format = opts.format ?? formatInt;
  let value = opts.value ?? 0;
  let cancel: (() => void) | null = null;

  const el = h(opts.tag ?? 'span', {
    class: `sn-num${opts.className ? ` ${opts.className}` : ''}`,
    text: format(value),
  });

  return {
    el,
    get value(): number {
      return value;
    },
    set(next: number, o): void {
      cancel?.();
      cancel = null;
      const from = value;
      value = next;
      if (!o?.animate || from === next) {
        setText(el, format(next));
        if (o?.pop) pop(el);
        return;
      }
      cancel = countTo({
        from,
        to: next,
        duration: o.duration ?? 700,
        onUpdate: (v) => setText(el, format(v)),
        onDone: () => {
          setText(el, format(next));
          if (o.pop) pop(el);
        },
      });
    },
  };
}
