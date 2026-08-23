import { formatInt, h, setText } from '../dom';
import { countTo, pop } from '../motion';
import { INK } from '../snack/classes';

export interface CounterOpts {
  value?: number;
  className?: string;
  format?(value: number): string;
  /** Wrapping element tag; defaults to a span. */
  tag?: 'span' | 'div';
  /**
   * Ink for the numerals. `print` is the order-pad default; `thermal` is the
   * faded receipt print, for a figure that is metadata rather than the point.
   */
  ink?: 'print' | 'thermal';
}

export interface Counter {
  readonly el: HTMLElement;
  /** Set immediately, or tick up over `duration` ms. */
  set(value: number, opts?: { animate?: boolean; duration?: number; pop?: boolean }): void;
  readonly value: number;
}

/**
 * A tabular-numerals number that can count up on a rAF ease-out.
 *
 * Set in order-pad ink: a printed figure, not a distressed one. The count-up
 * writes text only — no material work happens while the number is running.
 */
export function createCounter(opts: CounterOpts = {}): Counter {
  const format = opts.format ?? formatInt;
  let value = opts.value ?? 0;
  let cancel: (() => void) | null = null;

  const ink = opts.ink === 'thermal' ? INK.thermal : INK.print;
  const el = h(opts.tag ?? 'span', {
    class: `sn-num ${ink}${opts.className ? ` ${opts.className}` : ''}`,
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
