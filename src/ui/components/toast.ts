import type { ToastKind } from '../ctx';
import { Bag, h } from '../dom';
import { EASE_IOS, animate, runExit } from '../motion';

const MAX_VISIBLE = 3;
const LIFETIME = 2600;

export interface ToastHost {
  readonly el: HTMLElement;
  show(message: string, kind?: ToastKind): void;
  destroy(): void;
}

/** Bottom-anchored glass pills. Never blocks the game — pointer-events: none. */
export function createToastHost(): ToastHost {
  const bag = new Bag();
  const el = h('div', {
    class: 'sn-toasts',
    role: 'status',
    aria: { live: 'polite', atomic: 'false' },
  });

  const dismiss = (node: HTMLElement): void => {
    if (node.dataset['going'] === '1') return;
    node.dataset['going'] = '1';
    runExit(
      node,
      [
        { transform: 'translate3d(0,0,0)', opacity: 1 },
        { transform: 'translate3d(0, 14px, 0)', opacity: 0 },
      ],
      { duration: 220, easing: EASE_IOS },
      () => node.remove(),
    );
  };

  return {
    el,
    show(message: string, kind: ToastKind = 'info'): void {
      while (el.children.length >= MAX_VISIBLE) {
        const first = el.firstElementChild as HTMLElement | null;
        if (!first) break;
        first.remove();
      }
      const node = h('div', {
        class: `sn-toast sn-toast--${kind}`,
        text: message,
      });
      el.appendChild(node);
      animate(
        node,
        [
          { transform: 'translate3d(0, 18px, 0)', opacity: 0 },
          { transform: 'translate3d(0, 0, 0)', opacity: 1 },
        ],
        { duration: 320, easing: EASE_IOS },
      );
      bag.after(() => dismiss(node), LIFETIME);
    },
    destroy(): void {
      bag.disposeAll();
      el.remove();
    },
  };
}
