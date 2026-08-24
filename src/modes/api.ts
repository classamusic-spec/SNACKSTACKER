import type * as THREE from 'three';
import type { AudioEngine } from '../audio/api';
import type { ThemeDef } from '../content/api';
import type { Emitter } from '../core/events';
import type { Rng } from '../core/rng';
import type { QualityTier } from '../core/types';
import type { CameraRig } from '../game/CameraRig';
import type { MaterialLibrary } from '../render/api';
import type { VfxSystem } from '../vfx/api';

/** Every playable mode in the app. `stack` is the original tower game. */
export type ModeId = 'stack' | 'conveyor' | 'recipe' | 'topple';

/**
 * What a mode reports back. The host turns these into HUD updates, audio,
 * haptics and a result screen, so a mode never touches the UI itself.
 */
export type ModeEvents = {
  /** Cumulative score changed. `pop` asks the HUD for a punch. */
  score: { score: number; delta: number; pop: boolean };
  /** Combo/streak count; 0 clears it. */
  combo: number;
  /** A celebratory banner: "PERFECT", "EXACT", "CLEAN CATCH". */
  praise: { label: string; tier: number };
  /** A wider banner for a course/round change. */
  milestone: { title: string; sub?: string };
  /** Mode-specific progress line for the HUD, e.g. "12 layers" or "Order 3/5". */
  progress: { primary: number; label: string };
  /** 0..1, drives adaptive music intensity. */
  intensity: number;

  /**
   * A recall countdown, for modes that run one (Recipe Rush). `remaining01`
   * falls 1 -> 0 across the current limit, `seconds` is what the player reads,
   * and `urgent` flags the last stretch so the HUD can heat up. `null` hides
   * the clock — modes without a countdown never emit this and it stays hidden.
   */
  clock: { remaining01: number; seconds: number; urgent: boolean } | null;
  /** Player took their first meaningful action; ends the coach hint. */
  firstAction: void;
  /** Run finished. The host records it and shows results. */
  over: ModeResult;
};

export interface ModeResult {
  score: number;
  /** The mode's headline count — layers, orders served, items caught. */
  count: number;
  /** Label for that count on the result screen, e.g. "Layers". */
  countLabel: string;
  perfects: number;
  bestCombo: number;
  /** Optional flavour figure, e.g. tower height in cm. */
  heightCm?: number;
}

/** Everything a mode is handed. It must not reach outside this. */
export interface ModeCtx {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rig: CameraRig;
  materials: MaterialLibrary;
  vfx: VfxSystem;
  audio: AudioEngine;
  quality: QualityTier;
  theme: ThemeDef;
  rng: Rng;
  /** Screen-space shake, in world units. */
  shake(magnitude: number, duration?: number): void;
  /** Momentary exposure/bloom punch, 0..1. */
  flash(amount: number): void;
  /** Current viewport, for modes that lay out in screen space. */
  viewport(): { width: number; height: number };
}

/**
 * A playable mode.
 *
 * The host owns the render loop, the camera rig, the result screen and the
 * save file; a mode owns its own scene content and rules. Modes are built
 * lazily on first play and disposed when the player leaves, so an unplayed
 * mode costs nothing.
 */
export interface GameMode {
  readonly id: ModeId;
  readonly events: Emitter<ModeEvents>;

  /** Build the attract/idle presentation shown behind the home screen. */
  attract(): void;
  /** Begin a run. Called after attract() or after a previous run ended. */
  start(): void;
  /** Tear down run state but keep cached resources. */
  stop(): void;

  update(dt: number, elapsed: number): void;

  /**
   * Primary input. `x`/`y` are CSS pixels from the top-left of the canvas, for
   * modes that need to know what was tapped; the stacker ignores them.
   * @returns true when the input was taken, so the host can decide on haptics.
   */
  tap(x: number, y: number): boolean;

  /** The theme changed while this mode was loaded. */
  setTheme(theme: ThemeDef): void;

  /** Release every GPU resource this mode created. */
  dispose(): void;

  /**
   * Optional automation hooks. The QA harnesses drive real runs by reading an
   * aiming hint each frame — without one, a headless player can only tap
   * blindly, which under software rendering exercises almost nothing. Modes
   * that have no meaningful "how close am I" signal simply omit it.
   *
   * @returns signed distance from the ideal input right now, or null when
   * there is nothing to aim at.
   */
  readonly aimHint?: number | null;
  /** Live count of transient objects, for leak detection. */
  readonly debrisCount?: number;
}

/** How a mode presents itself in the mode picker. */
export interface ModeInfo {
  id: ModeId;
  name: string;
  tagline: string;
  /** One-line rule explanation shown under the tagline. */
  how: string;
  glyph: string;
  /** Result-screen label for the headline count. */
  countLabel: string;
  /**
   * The two-or-three word prompt on the first-run coach ring. It sits over the
   * play area and has to say what THIS mode wants, which is not always "drop".
   */
  coach: string;
}

export const MODE_INFO: Record<ModeId, ModeInfo> = {
  stack: {
    id: 'stack',
    name: 'Stack',
    tagline: 'Build it taller.',
    how: 'Tap to drop each layer. Land it centred for a perfect.',
    glyph: '🍔',
    countLabel: 'Layers',
    coach: 'Tap to drop',
  },
  conveyor: {
    id: 'conveyor',
    name: 'Conveyor',
    tagline: 'Grab what the ticket asks for.',
    how: 'Tap the ingredients on the belt that match the order. Let the rest pass.',
    glyph: '🥢',
    countLabel: 'Orders',
    coach: 'Tap the match',
  },
  recipe: {
    id: 'recipe',
    name: 'Recipe Rush',
    tagline: 'Remember the order.',
    how: 'Watch the recipe, then build it back from memory.',
    glyph: '📋',
    countLabel: 'Recipes',
    coach: 'Watch, then repeat',
  },
  topple: {
    id: 'topple',
    name: 'Topple',
    tagline: 'How high before it falls?',
    how: 'Real weight, real balance. Place each item and hope.',
    glyph: '🗼',
    countLabel: 'Height',
    coach: 'Tap to place',
  },
};
