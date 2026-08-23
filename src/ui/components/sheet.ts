import type { UiCtx } from '../ctx';
import { Bag, h } from '../dom';
import { iconClose } from '../icons';
import { EASE_IOS, animate, isReduced, resetAnimations, runExit } from '../motion';
import { EDGE, INK, PAPER, PART } from '../snack/classes';
import { createButton } from './button';
import { applyPaper, stain, tearLine } from './material';

export interface SheetOpts {
  /** Used for `data-sheet` and styling hooks. */
  name: string;
  title?: string;
  ariaLabel: string;
  /** `tall` pins the sheet near the top of the screen and scrolls its body. */
  variant?: 'auto' | 'tall';
  /** Scrim tap / drag-down / close button dismisses. */
  dismissible?: boolean;
  showClose?: boolean;
  /** Extra nodes placed at the right of the header, before the close button. */
  headerExtras?: HTMLElement[];
  onDismiss(): void;
}

export interface Sheet {
  readonly el: HTMLElement;
  readonly panel: HTMLElement;
  readonly body: HTMLElement;
  open(): void;
  close(done?: () => void): void;
  destroy(): void;
}

const OPEN_MS = 400;
const CLOSE_MS = 300;

/**
 * A blurred-glass bottom sheet: dim scrim, iOS curve, rubber-band settle,
 * drag-down-to-dismiss from the grabber/header, and a Tab focus trap.
 */
export function createSheet(ctx: UiCtx, opts: SheetOpts): Sheet {
  const bag = new Bag();
  const dismissible = opts.dismissible !== false;

  const scrim = h('div', { class: 'sn-scrim', aria: { hidden: 'true' } });
  const grab = h('div', { class: 'sn-sheet__grab', aria: { hidden: 'true' } }, h('span'));
  const titleEl = opts.title
    ? h('h2', { class: `sn-sheet__title ${INK.print}`, text: opts.title })
    : null;

  /**
   * A sheet is greaseproof paper laid on a brushed metal tray: the panel is the
   * tray, and the paper is a decorative layer inside it, inset so the metal
   * shows as a rim. Keeping the paper out of the flow means the sheet's whole
   * flex column — grabber, header, scrolling body — is untouched, and the
   * torn edge clips the paper only, never the content or the tray's shadow.
   * Grease spots ride the paper so they clip with it.
   */
  const paper = h(
    'span',
    {
      class: `sn-sheet__paper ${PAPER.greaseproof} ${EDGE.torn}`,
      aria: { hidden: 'true' },
    },
    stain('sn-sheet__stain'),
    stain('sn-sheet__stain sn-sheet__stain--b'),
  );
  applyPaper(paper, { kind: 'greaseproof', seed: `sheet:${opts.name}`, edge: 'torn', wear: 0.3 });

  const headRight = h('div', { class: 'sn-sheet__head-right' });
  for (const extra of opts.headerExtras ?? []) headRight.appendChild(extra);
  if (opts.showClose !== false && dismissible) {
    headRight.appendChild(
      createButton(ctx, {
        kind: 'icon',
        className: 'sn-btn--icon-sm',
        icon: iconClose(),
        ariaLabel: 'Close',
        press: 'back',
        onPress: () => opts.onDismiss(),
      }),
    );
  }

  const head = h('div', { class: 'sn-sheet__head' }, titleEl, headRight);
  const body = h('div', { class: 'sn-sheet__body' });

  // The header/body divider is a perforated tear-line, not a hairline rule.
  // Only where there is a header to divide — the result sheet has none.
  const tear = opts.title ? tearLine(`sheet:${opts.name}`, 'sn-sheet__tear') : null;

  const panel = h(
    'div',
    {
      class: `sn-sheet sn-sheet--${opts.variant ?? 'auto'} ${PART.tray}`,
      role: 'dialog',
      tabIndex: -1,
      aria: { modal: 'true', label: opts.ariaLabel },
      data: { sheet: opts.name },
    },
    paper,
    grab,
    head,
    tear,
    body,
  );

  const el = h('div', { class: 'sn-modal', data: { sheet: opts.name } }, scrim, panel);

  if (dismissible) {
    scrim.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ctx.press('back');
      opts.onDismiss();
    });
  }
  // The scrim always swallows taps so they never reach the game canvas.
  scrim.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  panel.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  panel.addEventListener('click', (ev) => ev.stopPropagation());

  // ---- Focus trap ---------------------------------------------------------
  panel.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Tab') return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((n) => n.offsetParent !== null || n === document.activeElement);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  });

  // ---- Drag to dismiss ----------------------------------------------------
  let dragging = false;
  let pointerId = -1;
  let startY = 0;
  let startT = 0;
  let dy = 0;

  const onDown = (ev: PointerEvent): void => {
    if (!dismissible || isReduced()) return;
    if (ev.button !== undefined && ev.button !== 0) return;
    dragging = true;
    pointerId = ev.pointerId;
    startY = ev.clientY;
    startT = performance.now();
    dy = 0;
    panel.classList.add('is-dragging');
    try {
      grab.setPointerCapture(ev.pointerId);
    } catch {
      /* capture is a nicety, not a requirement */
    }
  };

  const onMove = (ev: PointerEvent): void => {
    if (!dragging || ev.pointerId !== pointerId) return;
    dy = Math.max(0, ev.clientY - startY);
    // Resist upward-ish drags with a soft rubber band.
    const eased = dy > 0 ? dy : dy * 0.2;
    panel.style.transform = `translate3d(0, ${eased.toFixed(1)}px, 0)`;
    const h0 = panel.offsetHeight || 1;
    scrim.style.opacity = String(Math.max(0.25, 1 - eased / (h0 * 1.4)));
  };

  const endDrag = (ev: PointerEvent): void => {
    if (!dragging || ev.pointerId !== pointerId) return;
    dragging = false;
    panel.classList.remove('is-dragging');
    const dt = Math.max(1, performance.now() - startT);
    const velocity = dy / dt;
    const shouldClose = dy > 96 || velocity > 0.65;
    scrim.style.opacity = '';
    if (shouldClose) {
      ctx.press('back');
      opts.onDismiss();
      return;
    }
    const from = `translate3d(0, ${dy.toFixed(1)}px, 0)`;
    panel.style.transform = '';
    animate(
      panel,
      [{ transform: from }, { transform: 'translate3d(0,0,0)' }],
      { duration: 340, easing: EASE_IOS },
    );
  };

  grab.addEventListener('pointerdown', onDown);
  head.addEventListener('pointerdown', (ev) => {
    if ((ev.target as HTMLElement).closest('button')) return;
    onDown(ev);
  });
  grab.addEventListener('pointermove', onMove);
  head.addEventListener('pointermove', onMove);
  grab.addEventListener('pointerup', endDrag);
  head.addEventListener('pointerup', endDrag);
  grab.addEventListener('pointercancel', endDrag);
  head.addEventListener('pointercancel', endDrag);

  let closing = false;

  return {
    el,
    panel,
    body,
    open(): void {
      closing = false;
      resetAnimations(panel);
      resetAnimations(scrim);
      scrim.style.opacity = '';
      panel.style.transform = '';
      el.classList.remove('is-closing');
      el.classList.add('is-open');
      animate(scrim, [{ opacity: 0 }, { opacity: 1 }], {
        duration: 260,
        easing: 'linear',
      });
      animate(
        panel,
        [
          { transform: 'translate3d(0, 100%, 0)', offset: 0 },
          { transform: 'translate3d(0, -0.7%, 0)', offset: 0.82 },
          { transform: 'translate3d(0, 0, 0)', offset: 1 },
        ],
        { duration: OPEN_MS, easing: EASE_IOS },
      );
      bag.after(() => {
        try {
          panel.focus({ preventScroll: true });
        } catch {
          /* focus is best-effort */
        }
      }, 40);
    },
    close(done?: () => void): void {
      if (closing) return;
      closing = true;
      el.classList.remove('is-open');
      el.classList.add('is-closing');
      animate(scrim, [{ opacity: 1 }, { opacity: 0 }], {
        duration: CLOSE_MS,
        easing: 'linear',
        fill: 'forwards',
      });
      runExit(
        panel,
        [
          { transform: 'translate3d(0,0,0)', opacity: 1 },
          { transform: 'translate3d(0, 100%, 0)', opacity: 1 },
        ],
        { duration: CLOSE_MS, easing: EASE_IOS },
        () => {
          el.remove();
          done?.();
        },
      );
    },
    destroy(): void {
      bag.disposeAll();
      el.remove();
    },
  };
}
