import type { Settings } from '../core/types';
import type { UiHooks } from './api';

export type ToastKind = 'info' | 'success' | 'error';
export type PressKind = 'tap' | 'back' | 'toggle';

/** Everything a screen or component needs from the shell. */
export interface UiCtx {
  readonly hooks: UiHooks;
  /** Fires `hooks.onUiPress` — called by every control before its own hook. */
  press(kind: PressKind): void;
  getSettings(): Settings;
  reduced(): boolean;
  toast(message: string, kind?: ToastKind): void;
}
