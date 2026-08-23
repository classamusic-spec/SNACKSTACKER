/**
 * Wiring. The classes in `classes.ts` paint the material; these helpers hand
 * the CSS the few generated values it cannot compute for itself — the fibre
 * tile, the silhouette, the shadow that silhouette casts.
 *
 * Nothing here is required: every class in `snack.css` looks right with no
 * JavaScript at all. These just upgrade a surface from "good CSS paper" to
 * "seeded, per-theme, per-card paper".
 */

import type { ThemeId } from '../../core/types';
import type { EdgeKind, PaperOpts, SplatOpts } from './api';
import { edgeMask, inkUnderlinePath, paperTexture, splatShape, tearLinePath } from './api';
import { EDGE, PAPER } from './classes';
import { css, hex } from './colour';
import { svg } from './svg';
import { NEUTRAL_INK, THEME_PAPER } from './stocks';

/** Every custom property this kit writes, so it can take them all back off. */
const VARS = [
  '--sn-paper',
  '--sn-edge',
  '--sn-splat',
  '--sn-underline',
  '--sn-tear',
  '--sn-ink',
] as const;

/**
 * Paint an element as a sheet of paper: texture, silhouette, contact shadow,
 * ink colour and the classes that use them.
 */
export function applyPaper(el: HTMLElement, opts: PaperOpts): void {
  const edge: EdgeKind = opts.edge ?? 'clean';
  el.classList.add(PAPER[opts.kind], EDGE[edge]);
  el.style.setProperty('--sn-paper', paperTexture(opts));
  if (edge !== 'clean') el.style.setProperty('--sn-edge', edgeMask(edge, opts.seed));
  if (opts.theme) {
    el.dataset.theme = opts.theme;
    el.style.setProperty('--sn-ink', hex(THEME_PAPER[opts.theme].ink));
  } else {
    el.style.setProperty('--sn-ink', hex(NEUTRAL_INK));
  }
  if (opts.tilt !== undefined && opts.tilt !== 0) el.style.rotate = `${opts.tilt}deg`;
}

/** Paint an element as the ketchup splat behind a rectangular hit area. */
export function applySplat(el: HTMLElement, opts: SplatOpts): void {
  const shape = splatShape(opts);
  el.style.setProperty(
    '--sn-splat',
    svg(`<path d='${shape.d}' fill='#000'/>`, { viewBox: '0 0 100 100' }),
  );
}

/** Paint a hand-drawn ink underline under a focused or selected thing. */
export function applyUnderline(el: HTMLElement, seed: string, width = 120): void {
  const d = inkUnderlinePath(seed, width);
  const split = d.indexOf('M', 1);
  const main = split > 0 ? d.slice(0, split) : d;
  const ghost = split > 0 ? d.slice(split) : '';
  el.style.setProperty(
    '--sn-underline',
    svg(
      `<g fill='none' stroke='#000' stroke-linecap='round'>
         <path d='${main}' stroke-width='1.9'/>
         ${ghost ? `<path d='${ghost}' stroke-width='1.1' opacity='0.42'/>` : ''}
       </g>`,
      { viewBox: `0 0 ${Math.max(8, Math.round(width))} 8` },
    ),
  );
}

/** Paint a perforated tear-line divider. */
export function applyTear(el: HTMLElement, seed: string): void {
  el.style.setProperty(
    '--sn-tear',
    svg(`<path d='${tearLinePath(seed)}' fill='#000'/>`, {
      viewBox: '0 0 100 8',
      width: 100,
      height: 8,
      stretch: false,
    }),
  );
}

/** Take every generated value back off an element, e.g. before recycling it. */
export function clearSnackVars(el: HTMLElement): void {
  for (const name of VARS) el.style.removeProperty(name);
  el.style.removeProperty('rotate');
}

/** The warm-dark ink a given theme prints in. Never pure black. */
export function inkColour(theme?: ThemeId): string {
  return hex(theme ? THEME_PAPER[theme].ink : NEUTRAL_INK);
}

/** The same ink at a given alpha, for secondary type on paper. */
export function inkColourAlpha(theme: ThemeId | undefined, alpha: number): string {
  return css(theme ? THEME_PAPER[theme].ink : NEUTRAL_INK, alpha);
}
