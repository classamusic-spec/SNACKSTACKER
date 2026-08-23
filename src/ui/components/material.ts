/**
 * The one place a component talks to the snack kit's *generators*.
 *
 * `src/ui/snack/classes.ts` is a pure constant table, so components import the
 * class vocabulary straight from it. `src/ui/snack/api.ts` is different: it
 * paints textures and draws paths, and while it is being built every one of
 * those functions throws. A screen must still mount.
 *
 * So every generator call in the whole component layer funnels through `kit()`
 * below — one guarded call, made once per element at construction time, never
 * in a loop and never on scroll. A component that asks for a shape it cannot
 * get simply does not build that layer, and keeps the chrome it already had.
 * When the kit lands, the same construction path lights up with no other
 * change. Nothing here runs per frame.
 *
 * Two conventions the stylesheet needs to know about:
 *
 * - `--sn-paper` carries the paper's fibre/weave/stain layer as a
 *   `background-image` value. It is set as a custom property rather than
 *   written straight to `background-image` so `snack.css` can compose it with
 *   the themed print the material class owns:
 *   `background-image: var(--sn-paper, none), <themed print>`.
 * - Generated silhouettes arrive as real inline SVG inside a component-owned
 *   layer element (`.sn-sheet__tear`, `.sn-mode__underline`) rather than as a
 *   data URL, because a data URL cannot inherit `currentColor`.
 */

import { paperTexture, tearLinePath, inkUnderlinePath } from '../snack/api';
import type { PaperOpts } from '../snack/api';
import { h, s } from '../dom';
import { INK, PART } from '../snack/classes';

let warned = false;

/**
 * Run one kit generator. Returns `null` — and warns exactly once per session —
 * if the kit is not there yet.
 */
function kit<T>(what: string, fn: () => T): T | null {
  try {
    return fn();
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn(`[snackery] snack kit unavailable (${what}) — UI falls back to plain chrome`, err);
    }
    return null;
  }
}

/**
 * Hang a paper's surface on an element as `--sn-paper`. Call once, at
 * construction, with a seed that is stable for the life of the thing being
 * built — a mode id, a sku, a sheet name. Never an array index.
 */
export function applyPaper(el: HTMLElement, opts: PaperOpts): void {
  const tex = kit('paperTexture', () => paperTexture(opts));
  if (tex) el.style.setProperty('--sn-paper', tex);
}

/**
 * A perforated tear-line divider. Sized in absolute units so it is harmless in
 * any container even before `snack.css` styles it.
 */
export function tearLine(seed: string, className: string): HTMLElement | null {
  const d = kit('tearLinePath', () => tearLinePath(seed));
  if (!d) return null;
  const svg = s(
    'svg',
    {
      viewBox: '0 0 100 6',
      preserveAspectRatio: 'none',
      width: '100%',
      height: '6',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    s('path', { d, fill: 'none', stroke: 'currentColor' }),
  );
  return h(
    'div',
    { class: `${className} ${PART.tear}`, aria: { hidden: 'true' } },
    svg,
  );
}

/** Hand-drawn ink underline, for the selected/focused mark. */
export function inkUnderline(seed: string, className: string): HTMLElement | null {
  const d = kit('inkUnderlinePath', () => inkUnderlinePath(seed, 100));
  if (!d) return null;
  const svg = s(
    'svg',
    {
      viewBox: '0 0 100 8',
      preserveAspectRatio: 'none',
      width: '100%',
      height: '8',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    s('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6' }),
  );
  return h(
    'span',
    { class: `${className} ${INK.underline}`, aria: { hidden: 'true' } },
    svg,
  );
}

/** A decorative grease spot. Purely visual, never announced. */
export function stain(className: string): HTMLElement {
  return h('span', { class: `${className} ${PART.stain}`, aria: { hidden: 'true' } });
}
