import type { ThemeDef } from '../content/api';
import { createConveyorMode } from './conveyor';
import { createStackMode } from './stack';
import { createRecipeMode } from './recipe';
import { createToppleMode } from './topple';
import { MODE_INFO, type GameMode, type ModeCtx, type ModeId } from './api';

/**
 * Per-mode accent, so each card in the picker has its own identity while the
 * theme still owns the palette around it.
 */
export const MODE_ACCENT: Record<ModeId, number> = {
  stack: 0xe23e57,
  conveyor: 0x2f9e8f,
  recipe: 0xc07ad6,
  topple: 0xe8892b,
};

export type ModeFactory = (ctx: ModeCtx) => GameMode;

const FACTORIES: Record<ModeId, ModeFactory> = {
  stack: createStackMode,
  conveyor: createConveyorMode,
  recipe: createRecipeMode,
  topple: createToppleMode,
};

export function modeFactory(id: ModeId): ModeFactory {
  return FACTORIES[id];
}

export const ALL_MODES: ModeId[] = ['stack', 'conveyor', 'recipe', 'topple'];

export function modeInfo(id: ModeId) {
  return MODE_INFO[id];
}

/** Themes are shared across every mode; this exists so the host reads clearly. */
export function themeFor(theme: ThemeDef): ThemeDef {
  return theme;
}
