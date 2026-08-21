/**
 * Theme -> CSS custom properties.
 *
 * `ThemeDef.palette` holds packed integers (0xE23E57). Every UI component reads
 * the variables written here, so a single `applyTheme()` re-tints the whole
 * interface; the CSS transitions on colour properties make the swap smooth.
 */

import type { ThemeDef } from '../content/api';

export function hexFromInt(value: number): string {
  const v = Math.max(0, Math.min(0xffffff, Math.round(value))) | 0;
  return `#${v.toString(16).padStart(6, '0')}`;
}

export function rgbTriplet(value: number): string {
  const v = Math.max(0, Math.min(0xffffff, Math.round(value))) | 0;
  return `${(v >> 16) & 0xff}, ${(v >> 8) & 0xff}, ${v & 0xff}`;
}

/** Perceptual-ish relative luminance, 0..1. */
export function luminance(value: number): number {
  const v = Math.max(0, Math.min(0xffffff, Math.round(value))) | 0;
  const chan = (c: number): number => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const r = chan((v >> 16) & 0xff);
  const g = chan((v >> 8) & 0xff);
  const b = chan(v & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ink that stays legible on top of a filled accent pill. */
export function inkFor(value: number): string {
  return luminance(value) > 0.56 ? '#1A1208' : '#FFFFFF';
}

export interface ThemeVars {
  readonly [key: string]: string;
}

export function themeVars(theme: ThemeDef): ThemeVars {
  const p = theme.palette;
  return {
    '--accent': hexFromInt(p.accent),
    '--accent-rgb': rgbTriplet(p.accent),
    '--accent-ink': inkFor(p.accent),
    '--accent-soft': hexFromInt(p.accentSoft),
    '--accent-soft-rgb': rgbTriplet(p.accentSoft),
    '--accent-soft-ink': inkFor(p.accentSoft),
    '--bg-top': hexFromInt(p.bgTop),
    '--bg-top-rgb': rgbTriplet(p.bgTop),
    '--bg-bottom': hexFromInt(p.bgBottom),
    '--bg-bottom-rgb': rgbTriplet(p.bgBottom),
    '--fog': hexFromInt(p.fog),
    '--fog-rgb': rgbTriplet(p.fog),
    '--ground': hexFromInt(p.ground),
    '--ground-rgb': rgbTriplet(p.ground),
    '--key': hexFromInt(p.key),
    '--fill': hexFromInt(p.fill),
    '--rim': hexFromInt(p.rim),
    '--rim-rgb': rgbTriplet(p.rim),
    /** Sheets sit over the darker end of the backdrop so glass reads as glass. */
    '--sheet-tint': `rgba(${rgbTriplet(p.bgBottom)}, 0.34)`,
    '--scrim-tint': `rgba(${rgbTriplet(p.ground)}, 0.46)`,
  };
}

export function applyThemeVars(root: HTMLElement, theme: ThemeDef): void {
  const vars = themeVars(theme);
  for (const key of Object.keys(vars)) root.style.setProperty(key, vars[key]);
}
