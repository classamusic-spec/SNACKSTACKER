import type { ThemeId } from '../core/types';
import type { SkyConfig, ThemePaletteLike } from './api';
import { KEY_AZIMUTH } from './lighting';

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
  // Carried by reference: SkyConfig is authored data, never mutated in place.
  // Without this the kit's own copy of the palette loses its sky, and the
  // bloom threshold gets re-derived from a sky-less palette the next time the
  // frame governor drops a tier — which is exactly when the sun would stop
  // blooming for no visible reason.
  dst.sky = src.sky;
  return dst;
}

export function clonePalette(src: ThemePaletteLike): ThemePaletteLike {
  return copyPalette(src, { ...DEFAULT_PALETTE });
}

export { PALETTE_FADE } from './constants';

// ---------------------------------------------------------------------- sky

/**
 * Per-theme sky presets, tuned against each palette.
 *
 * Content owns `palette.sky`; these are the values to point it at. They are
 * here rather than in content/ because every one of them is a statement about
 * the render pipeline — the bearing has to match the light rig, the colours
 * have to sit under the bloom threshold `tonemap.ts` derives, and the cloud
 * cover has to survive the fill-rate budget.
 *
 * Two rules run through all of them.
 *
 * **Bearing, not altitude.** Every sun uses `KEY_AZIMUTH` verbatim, so the sky
 * agrees with the direction the shadows fall. Altitude is free and is what
 * actually sets the hour: 0.06 rad reads as dusk, 0.62 as mid-morning.
 *
 * **Grade against the key.** The bible's rule that exposure and bloom run
 * inversely to how bright a palette is applies to the sky too, and in the same
 * direction. The two high-key themes (Breakfast, and Candy which stays studio)
 * take the softest, widest, least contrasty skies — a hot disc over a cream
 * palette is the same mistake as too much exposure on one. The dark theme
 * (Sushi) takes the most: the tightest glow, the only stars, and the only
 * cloud deck whose shadow side is darker than the sky behind it.
 *
 * **No cloud is pure white, and that is a bloom constraint, not taste.** The
 * backdrop pre-divides by the inverse ACES curve, which runs away as a colour
 * approaches display white — so `backdropPeakLuma` climbs steeply and takes
 * the bloom threshold with it, and every real specular highlight in the frame
 * needs to clear that threshold to glow. Measured: Breakfast's first cloud
 * colour of #fffdf6 pushed its threshold from 3.09 to 6.91, i.e. more than
 * doubled what a syrup highlight had to beat. Backing off to #faf3e4 — six
 * steps, invisible against a cream sky — put it back to 3.07. If you retune a
 * `cloudColor`, `horizonColor` or `glowColor` upward, check what it did to
 * `bloomThresholdFor` before shipping it.
 */
export const SKY_PRESETS: Record<ThemeId, SkyConfig> = {
  /**
   * Golden-hour suburban afternoon over the fence line. Sun low and warm, a
   * wide honey glow, fair-weather cumulus with real shadow in them — this is
   * the theme with the most sky actually visible (roughly the top quarter of
   * the frame, above the pickets), so it carries the most weather.
   */
  diner: {
    kind: 'open',
    sunAzimuth: KEY_AZIMUTH,
    sunElevation: 0.3,
    sunColor: 0xffe9b8,
    sunIntensity: 1,
    glowColor: 0xffdca6,
    glowSpread: 0.95,
    cloudCover: 0.34,
    cloudColor: 0xfbf0dc,
    cloudShadow: 0.45,
    cloudDrift: 0.022,
    horizonColor: 0xffd5a8,
    horizonSoftness: 0.55,
    stars: 0,
  },

  /**
   * Early morning through the kitchen window. The environment is a room and
   * only a sliver of backdrop clears the wall, so everything is dialled down:
   * a high soft sun near the key's own altitude, a very broad glow, and thin
   * high cloud with almost no shadow in it. High-key palette, gentle sky.
   */
  breakfast: {
    kind: 'open',
    sunAzimuth: KEY_AZIMUTH,
    sunElevation: 0.62,
    sunColor: 0xfff6e2,
    sunIntensity: 0.55,
    glowColor: 0xfff3dc,
    glowSpread: 1.25,
    cloudCover: 0.3,
    cloudColor: 0xfaf3e4,
    cloudShadow: 0.2,
    cloudDrift: 0.014,
    horizonColor: 0xffe9c6,
    horizonSoftness: 0.7,
    stars: 0,
  },

  /**
   * Dusk. The sun is all but sitting on the horizon and burns hotter than any
   * other preset; the glow is deliberately the tightest of the daylight four
   * so the palette's own bgTop keeps the top of frame instead of the whole sky
   * going orange. Few clouds, and what there is takes a hard underside.
   */
  taco: {
    kind: 'open',
    sunAzimuth: KEY_AZIMUTH,
    sunElevation: 0.06,
    sunColor: 0xff9a3c,
    sunIntensity: 1.25,
    glowColor: 0xff8f42,
    glowSpread: 0.7,
    cloudCover: 0.22,
    cloudColor: 0xe89a72,
    cloudShadow: 0.55,
    cloudDrift: 0.016,
    horizonColor: 0xffae5a,
    horizonSoftness: 0.4,
    stars: 0,
  },

  /**
   * Late Mediterranean afternoon. The piazza's facades eat most of the frame,
   * so the sky's whole job is to give the roofline something to dissolve into
   * — hence the softest horizon of the set, and a mid-height sun with a broad
   * hazy glow rather than a hot low one.
   */
  pizza: {
    kind: 'open',
    sunAzimuth: KEY_AZIMUTH,
    sunElevation: 0.62,
    sunColor: 0xfff0ce,
    sunIntensity: 0.8,
    glowColor: 0xffe6be,
    glowSpread: 1.1,
    cloudCover: 0.35,
    cloudColor: 0xfaeeda,
    cloudShadow: 0.32,
    cloudDrift: 0.016,
    horizonColor: 0xf0cfa6,
    horizonSoftness: 0.85,
    stars: 0,
  },

  /**
   * Night over the counter. No disc — `sunIntensity: 0` keeps the glow and
   * drops the sun — so what reads is a cool moon halo high and off to the
   * left, sparse cloud dark enough to occlude stars as it drifts, and the only
   * star field in the game. The dark palette takes the most sky, per the
   * bible's grading rule.
   */
  sushi: {
    kind: 'open',
    sunAzimuth: KEY_AZIMUTH,
    sunElevation: 0.55,
    sunColor: 0xeaf4ff,
    sunIntensity: 0,
    glowColor: 0x8fb4d6,
    glowSpread: 0.5,
    cloudCover: 0.18,
    cloudColor: 0x5b7d95,
    cloudShadow: 0.5,
    cloudDrift: 0.010,
    horizonColor: 0x2b4256,
    horizonSoftness: 0.5,
    stars: 0.62,
  },

  /**
   * Candy Stack is a patisserie interior. There is no outside, so there is no
   * sky: `studio` keeps the plain two-stop sweep and the shader keeps its
   * original program. The remaining fields are ignored, and are filled in only
   * so the object is a complete SkyConfig.
   */
  candy: {
    kind: 'studio',
    sunAzimuth: KEY_AZIMUTH,
    sunElevation: 0.6,
    sunColor: 0xffffff,
    sunIntensity: 0,
    glowColor: 0xffffff,
    glowSpread: 1,
    cloudCover: 0,
    cloudColor: 0xffffff,
    cloudShadow: 0,
    cloudDrift: 0,
    horizonColor: 0xffffff,
    horizonSoftness: 0.5,
    stars: 0,
  },
};
