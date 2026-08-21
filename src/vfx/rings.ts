import * as THREE from 'three';
import { ParticlePool } from './ParticlePool';
import { quadGeometry } from './geometry';
import { RING_FRAG, RING_VERT } from './shaders';
import { RENDER_ORDER } from './pools';

/**
 * Expanding shockwave rings.
 *
 * These ride the same instanced pool as the particles — a screen-facing quad
 * with a gaussian radial band evaluated in the fragment shader, so the rim is
 * soft at every radius and never aliases. One draw call for every ring alive.
 *
 * Attribute reinterpretation for this class:
 *   aVel    = (radiusStart, radiusEnd, thickness)
 *   aParams = (birth, life, intensity, seed)
 *   aDyn.x  = orientation, 0 = flat on XZ, 1 = billboard
 */
export function createRingPool(scene: THREE.Scene, capacity: number): ParticlePool {
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const pool = new ParticlePool({
    name: 'vfx.rings',
    capacity,
    base: quadGeometry(),
    material,
    renderOrder: RENDER_ORDER.ring,
  });
  scene.add(pool.mesh);
  return pool;
}

export function emitRing(
  pool: ParticlePool,
  birth: number,
  life: number,
  x: number,
  y: number,
  z: number,
  r: number,
  g: number,
  b: number,
  radiusStart: number,
  radiusEnd: number,
  thickness: number,
  intensity: number,
  seed: number,
  flat: boolean,
): void {
  pool.push(
    birth,
    life,
    x,
    y,
    z,
    radiusStart,
    radiusEnd,
    thickness,
    r,
    g,
    b,
    intensity,
    seed,
    flat ? 0 : 1,
    0,
    0,
    0,
  );
}
