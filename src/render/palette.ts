import type { ThemePaletteLike } from './api';

/**
 * Classic Diner — the free default from the design bible. The kit boots with
 * this so a frame is never rendered un-tinted, even before content/ loads.
 */
export const DEFAULT_PALETTE: ThemePaletteLike = {
  bgTop: 0xffe7c4,
  bgBottom: 0xe07a5f,
  fog: 0xf2b48c,
  fogDensity: 0.021,
  key: 0xfff1dc,
  keyIntensity: 2.6,
  fill: 0x8fb8de,
  fillIntensity: 0.6,
  rim: 0xffd9a0,
  rimIntensity: 1.4,
  ground: 0xb4523c,
  accent: 0xe23e57,
  accentSoft: 0xffb4a2,
  bloomStrength: 0.46,
  exposure: 1.05,
  vignette: 0.36,
};

export function copyPalette(
  src: ThemePaletteLike,
  dst: ThemePaletteLike,
): ThemePaletteLike {
  dst.bgTop = src.bgTop;
  dst.bgBottom = src.bgBottom;
  dst.fog = src.fog;
  dst.fogDensity = src.fogDensity;
  dst.key = src.key;
  dst.keyIntensity = src.keyIntensity;
  dst.fill = src.fill;
  dst.fillIntensity = src.fillIntensity;
  dst.rim = src.rim;
  dst.rimIntensity = src.rimIntensity;
  dst.ground = src.ground;
  dst.accent = src.accent;
  dst.accentSoft = src.accentSoft;
  dst.bloomStrength = src.bloomStrength;
  dst.exposure = src.exposure;
  dst.vignette = src.vignette;
  return dst;
}

export function clonePalette(src: ThemePaletteLike): ThemePaletteLike {
  return copyPalette(src, { ...DEFAULT_PALETTE });
}

/** Seconds a palette crossfade takes. Snapping a theme change looks broken. */
export const PALETTE_FADE = 0.6;
