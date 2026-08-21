import type * as THREE from 'three';

export interface BurstOpts {
  position: THREE.Vector3;
  color: number;
  colorAlt?: number;
  count?: number;
  /** Initial speed multiplier. */
  power?: number;
  /** Spread of the emission cone; 1 = hemisphere. */
  spread?: number;
  /** Bias emission along an axis, e.g. the slice direction. */
  direction?: THREE.Vector3;
  scale?: number;
  gravity?: number;
  life?: number;
}

export interface RingOpts {
  position: THREE.Vector3;
  color: number;
  radius?: number;
  thickness?: number;
  life?: number;
  /** 'flat' lies on XZ, 'billboard' faces the camera. */
  orientation?: 'flat' | 'billboard';
}

export interface VfxSystem {
  /** Crumbs / chunks with gravity. */
  burst(opts: BurstOpts): void;
  /** Weightless glints that rise and fade. */
  sparkle(opts: BurstOpts): void;
  /** Liquid droplets (syrup, salsa, soy). */
  splash(opts: BurstOpts): void;
  /** Expanding shockwave ring. */
  ring(opts: RingOpts): void;
  /** The full perfect-drop package; tier scales with combo. */
  perfect(position: THREE.Vector3, color: number, tier: number): void;
  /** Milestone / new-best celebration. */
  confetti(position: THREE.Vector3, colors: number[]): void;
  /** Floating "+120" style world text. */
  popText(position: THREE.Vector3, text: string, color: number): void;
  update(dt: number, elapsed: number): void;
  clear(): void;
  dispose(): void;
}
