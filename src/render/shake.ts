import * as THREE from 'three';
import { clamp01 } from '../core/math';

/**
 * Trauma-based screen shake (Squirrel Eiserloh's model).
 *
 * Impacts add *trauma*, which decays linearly. The offset applied is
 * `trauma^2`, so a light landing barely registers while a slam at the top of a
 * 50-layer tower really hits — and the tail always fades out smoothly instead
 * of stopping dead.
 *
 * Offsets are driven by smooth value noise on three independent channels, not
 * by `Math.random()` per frame: random per frame is a vibration, noise is a
 * camera being knocked. Nothing here allocates.
 */

/** Deterministic 1D value noise, smoothstep-interpolated. Cheap and stable. */
function hash1(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453123;
  return s - Math.floor(s);
}

function noise1(channel: number, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = hash1(i + channel * 71.7);
  const b = hash1(i + 1 + channel * 71.7);
  return (a + (b - a) * u) * 2 - 1;
}

export interface ShakeOpts {
  /** World units of positional offset at full trauma. */
  maxOffset?: number;
  /** Radians of rotational offset at full trauma. */
  maxTilt?: number;
  /** Oscillations per second. */
  frequency?: number;
}

export class CameraShake {
  /** Global multiplier — 0 disables shake entirely (reduced motion). */
  scale = 1;

  private trauma = 0;
  private decay = 3;
  private time = 0;
  private readonly maxOffset: number;
  private readonly maxTilt: number;
  private readonly frequency: number;

  // hoisted per-frame temporaries
  private readonly offset = new THREE.Vector3();
  private readonly tilt = new THREE.Euler();
  private readonly tiltQuat = new THREE.Quaternion();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly savedPos = new THREE.Vector3();
  private readonly savedQuat = new THREE.Quaternion();
  private applied = false;

  constructor(opts: ShakeOpts = {}) {
    this.maxOffset = opts.maxOffset ?? 0.34;
    this.maxTilt = opts.maxTilt ?? 0.035;
    this.frequency = opts.frequency ?? 22;
  }

  get active(): boolean {
    return this.trauma > 0.0001 && this.scale > 0.0001;
  }

  /** @param magnitude 0..1-ish; stacks, clamped. @param duration seconds to zero. */
  add(magnitude: number, duration = 0.36): void {
    if (magnitude <= 0) return;
    this.trauma = clamp01(this.trauma + magnitude);
    this.decay = 1 / Math.max(0.05, duration);
  }

  reset(): void {
    this.trauma = 0;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.trauma > 0) this.trauma = Math.max(0, this.trauma - this.decay * dt);
  }

  /**
   * Applied as a temporary offset in `render()` and undone immediately after.
   *
   * The game owns the camera's base transform — it positions and aims the
   * camera every frame — so the shake must never be baked into
   * `camera.position`. Parenting to a rig group was the alternative, but a rig
   * rotates the camera about the rig's origin rather than about the lens,
   * which swings the frame instead of jolting it. Save / offset / render /
   * restore keeps the lens as the pivot and leaves the game's values untouched
   * for the next frame's read.
   */
  apply(camera: THREE.Camera): void {
    if (this.applied || !this.active) return;

    const amount = this.trauma * this.trauma * this.scale;
    const t = this.time * this.frequency;

    this.savedPos.copy(camera.position);
    this.savedQuat.copy(camera.quaternion);

    // Offset along the camera's own right/up so the jolt always reads as
    // camera movement, whatever angle the game has chosen.
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    const ox = noise1(0, t) * this.maxOffset * amount;
    const oy = noise1(1, t) * this.maxOffset * amount;

    this.offset.copy(this.right).multiplyScalar(ox).addScaledVector(this.up, oy);
    camera.position.add(this.offset);

    this.tilt.set(
      noise1(2, t) * this.maxTilt * amount * 0.6,
      noise1(3, t) * this.maxTilt * amount * 0.6,
      noise1(4, t) * this.maxTilt * amount,
    );
    this.tiltQuat.setFromEuler(this.tilt);
    camera.quaternion.multiply(this.tiltQuat);
    camera.updateMatrixWorld(true);

    this.applied = true;
  }

  /** Undo apply(). Safe to call when nothing was applied. */
  restore(camera: THREE.Camera): void {
    if (!this.applied) return;
    camera.position.copy(this.savedPos);
    camera.quaternion.copy(this.savedQuat);
    camera.updateMatrixWorld(true);
    this.applied = false;
  }
}
