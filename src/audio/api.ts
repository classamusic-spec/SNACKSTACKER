import type { ThemeDef } from '../content/api';

export type SfxId =
  | 'drop'
  | 'perfect'
  | 'combo'
  | 'slice'
  | 'fall'
  | 'fail'
  | 'collapse'
  | 'ui_tap'
  | 'ui_back'
  | 'ui_toggle'
  | 'coin'
  | 'unlock'
  | 'purchase'
  | 'milestone'
  | 'newbest'
  | 'whoosh'
  | 'countdown';

export interface SfxOpts {
  /** Semitone offset. */
  pitch?: number;
  /** Linear gain multiplier, default 1. */
  gain?: number;
  /** 0 = centre, -1 = left, 1 = right. */
  pan?: number;
  /** Seconds to delay playback. */
  delay?: number;
}

export interface AudioEngine {
  readonly ready: boolean;
  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): Promise<void>;
  play(id: SfxId, opts?: SfxOpts): void;
  /** Melodic combo ladder — pass the current combo count. */
  playComboNote(combo: number): void;
  setTheme(theme: ThemeDef): void;
  startMusic(): void;
  stopMusic(fadeSeconds?: number): void;
  /** 0..1 — drives layer count and filter cutoff of the adaptive score. */
  setIntensity(v: number): void;
  setSfxEnabled(v: boolean): void;
  setMusicEnabled(v: boolean): void;
  /** Duck music briefly, e.g. under a game-over sting. */
  duck(seconds?: number): void;
  suspend(): void;
  resume(): void;
  dispose(): void;
}
