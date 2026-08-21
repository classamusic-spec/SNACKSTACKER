import * as THREE from 'three';
import { Rng } from '../core/rng';
import { TUNING } from './constants';

interface Debris {
  object: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  fade: number;
}

/**
 * Ballistic debris: the sliced-off scrap of every imperfect drop, plus the
 * tower itself when it topples. Geometry here is unique per piece (it was cut
 * to size) so it must be disposed on cull — materials are shared and owned by
 * the MaterialLibrary, so they are deliberately left alone.
 */
export class Offcuts {
  private live: Debris[] = [];
  private rng = new Rng(0x5eed);

  constructor(private scene: THREE.Scene) {}

  spawn(
    object: THREE.Object3D,
    opts: {
      position: THREE.Vector3;
      velocity: THREE.Vector3;
      spin?: THREE.Vector3;
      fade?: number;
    },
  ): void {
    object.position.copy(opts.position);
    this.scene.add(object);
    this.live.push({
      object,
      vel: opts.velocity.clone(),
      spin:
        opts.spin?.clone() ??
        new THREE.Vector3(
          this.rng.signed() * TUNING.OFFCUT_SPIN,
          this.rng.signed() * TUNING.OFFCUT_SPIN * 0.4,
          this.rng.signed() * TUNING.OFFCUT_SPIN,
        ),
      age: 0,
      fade: opts.fade ?? 0,
    });
  }

  /** Sideways kick appropriate for a slice on the given axis. */
  kickFor(axis: 'x' | 'z', sign: number, strength = 1): THREE.Vector3 {
    const lateral = TUNING.OFFCUT_KICK * strength * sign;
    const v = new THREE.Vector3(0, 1.1 * strength, 0);
    if (axis === 'x') v.x = lateral;
    else v.z = lateral;
    v.x += this.rng.signed() * 0.25;
    v.z += this.rng.signed() * 0.25;
    return v;
  }

  update(dt: number, cameraY: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const d = this.live[i];
      d.age += dt;
      d.vel.y -= TUNING.GRAVITY * dt;
      d.object.position.addScaledVector(d.vel, dt);
      d.object.rotation.x += d.spin.x * dt;
      d.object.rotation.y += d.spin.y * dt;
      d.object.rotation.z += d.spin.z * dt;

      if (d.fade > 0 && d.age > d.fade) {
        const t = Math.max(0, 1 - (d.age - d.fade) / 0.4);
        d.object.scale.setScalar(t);
        if (t <= 0.01) {
          this.retire(i);
          continue;
        }
      }

      if (d.object.position.y < cameraY - TUNING.CULL_BELOW) this.retire(i);
    }
  }

  private retire(index: number): void {
    const d = this.live[index];
    this.live.splice(index, 1);
    this.scene.remove(d.object);
    disposeTree(d.object);
  }

  get count(): number {
    return this.live.length;
  }

  clear(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.retire(i);
  }

  dispose(): void {
    this.clear();
  }
}

/** Dispose geometry (not materials — those are cached and shared). */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.isMesh && m.geometry) m.geometry.dispose();
  });
}
