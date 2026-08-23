import { MODE_INFO, type ModeId } from '../modes/api';
import type { ModeCardView } from './api';

/**
 * Fallback identity colours, one per mode.
 *
 * The host owns `ModeCardView.accent` and will overwrite these on the first
 * `setModes()`; they exist so the picker is never a dead end (and so the dev
 * sandbox, which has no mode host, still renders a real deck). They are picked
 * to stay distinct from one another and legible as a filled pill in both a
 * near-white patisserie and a night garden.
 */
const FALLBACK_ACCENT: Record<ModeId, number> = {
  stack: 0xf2622e,
  conveyor: 0x0e9488,
  recipe: 0x8a5cf6,
  topple: 0xe0407f,
};

/**
 * `MODE_INFO.countLabel` is written for the result screen ("Height"), but the
 * home card pairs the number with the unit — "142 cm", not "142 Height".
 */
const FALLBACK_COUNT_LABEL: Partial<Record<ModeId, string>> = {
  topple: 'cm',
};

export const MODE_ORDER: readonly ModeId[] = ['stack', 'conveyor', 'recipe', 'topple'];

/** Every mode, unplayed. Replaced wholesale by the host's `setModes()`. */
export function defaultModeCards(): ModeCardView[] {
  return MODE_ORDER.map((id) => {
    const info = MODE_INFO[id];
    return {
      id,
      name: info.name,
      tagline: info.tagline,
      how: info.how,
      glyph: info.glyph,
      best: 0,
      countLabel: FALLBACK_COUNT_LABEL[id] ?? info.countLabel,
      bestCount: 0,
      accent: FALLBACK_ACCENT[id],
      locked: false,
    };
  });
}
