import * as THREE from 'three';
import type { MaterialLibrary } from '../render/api';
import { ParticlePool } from './ParticlePool';
import { quadGeometry, shardGeometry } from './geometry';
import {
  CONFETTI_FRAG,
  CONFETTI_VERT,
  CRUMB_FRAG,
  CRUMB_VERT,
  DROP_FRAG,
  DROP_VERT,
  GLOW_FRAG,
  GLOW_VERT,
} from './shaders';

/**
 * Render order. Solid-ish particle classes first, additive light on top,
 * text last. Every mesh sits at the origin with an identity matrix, so
 * three's distance sort would give them all the same key — renderOrder is
 * what actually makes the layering deterministic.
 */
export const RENDER_ORDER = {
  crumb: 8,
  drop: 9,
  confetti: 10,
  ring: 11,
  glow: 12,
  text: 14,
} as const;

/** three refreshes these every frame when `material.fog === true`. */
export function fogUniforms(): Record<string, THREE.IUniform> {
  return {
    fogColor: { value: new THREE.Color(0xffffff) },
    fogDensity: { value: 0.00025 },
    fogNear: { value: 1 },
    fogFar: { value: 2000 },
  };
}

/* ------------------------------------------------------------- painters */

/**
 * Soft round core with a faint four-point flare. One texture serves both the
 * sparkle glints and the big radial flash, which keeps the whole additive
 * layer in a single draw call.
 */
export function paintGlint(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);

  const core = ctx.createRadialGradient(c, c, 0, c, c, c);
  core.addColorStop(0.0, 'rgba(255,255,255,1)');
  core.addColorStop(0.11, 'rgba(255,255,255,0.88)');
  core.addColorStop(0.3, 'rgba(255,255,255,0.32)');
  core.addColorStop(0.62, 'rgba(255,255,255,0.07)');
  core.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);

  const flare = ctx.createRadialGradient(c, c, 0, c, c, c);
  flare.addColorStop(0.0, 'rgba(255,255,255,0.55)');
  flare.addColorStop(0.25, 'rgba(255,255,255,0.16)');
  flare.addColorStop(1.0, 'rgba(255,255,255,0)');

  ctx.globalCompositeOperation = 'lighter';
  const arms = [0, Math.PI * 0.5, Math.PI * 0.25, -Math.PI * 0.25];
  const squash = [0.075, 0.075, 0.04, 0.04];
  for (let i = 0; i < arms.length; i++) {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(arms[i]);
    ctx.scale(1, squash[i]);
    ctx.translate(-c, -c);
    ctx.fillStyle = flare;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * A wet droplet: alpha carries the silhouette, red carries the gloss so the
 * shader can put a white specular on top of any tint.
 */
export function paintDroplet(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);

  const body = ctx.createRadialGradient(c, c, 0, c, c, c * 0.96);
  body.addColorStop(0.0, 'rgba(46,46,46,1)');
  body.addColorStop(0.62, 'rgba(42,42,42,1)');
  body.addColorStop(0.86, 'rgba(38,38,38,0.88)');
  body.addColorStop(1.0, 'rgba(32,32,32,0)');
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, size, size);

  // source-atop keeps the silhouette alpha untouched while lighting the rgb.
  ctx.globalCompositeOperation = 'source-atop';

  const hotX = c * 0.72;
  const hotY = c * 0.62;
  const hot = ctx.createRadialGradient(hotX, hotY, 0, hotX, hotY, c * 0.34);
  hot.addColorStop(0.0, 'rgba(255,255,255,1)');
  hot.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  hot.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = hot;
  ctx.fillRect(0, 0, size, size);

  const rimX = c * 1.28;
  const rimY = c * 1.38;
  const rim = ctx.createRadialGradient(rimX, rimY, 0, rimX, rimY, c * 0.72);
  rim.addColorStop(0.0, 'rgba(255,255,255,0.42)');
  rim.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = 'source-over';
}

/* ---------------------------------------------------------------- pools */

export function createCrumbPool(scene: THREE.Scene, capacity: number): ParticlePool {
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, ...fogUniforms() },
    vertexShader: CRUMB_VERT,
    fragmentShader: CRUMB_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: true,
    side: THREE.DoubleSide,
  });
  const pool = new ParticlePool({
    name: 'vfx.crumbs',
    capacity,
    base: shardGeometry(),
    material,
    renderOrder: RENDER_ORDER.crumb,
  });
  scene.add(pool.mesh);
  return pool;
}

export function createGlowPool(
  scene: THREE.Scene,
  materials: MaterialLibrary,
  capacity: number,
  intensity: number,
): ParticlePool {
  const map = materials.texture('vfx.glint', paintGlint, { size: 128, srgb: false });
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMap: { value: map },
      uIntensity: { value: intensity },
    },
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const pool = new ParticlePool({
    name: 'vfx.glints',
    capacity,
    base: quadGeometry(),
    material,
    renderOrder: RENDER_ORDER.glow,
  });
  scene.add(pool.mesh);
  return pool;
}

export function createDropPool(
  scene: THREE.Scene,
  materials: MaterialLibrary,
  capacity: number,
): ParticlePool {
  const map = materials.texture('vfx.droplet', paintDroplet, { size: 128, srgb: false });
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: map }, ...fogUniforms() },
    vertexShader: DROP_VERT,
    fragmentShader: DROP_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: true,
  });
  const pool = new ParticlePool({
    name: 'vfx.droplets',
    capacity,
    base: quadGeometry(),
    material,
    renderOrder: RENDER_ORDER.drop,
  });
  scene.add(pool.mesh);
  return pool;
}

export function createConfettiPool(scene: THREE.Scene, capacity: number): ParticlePool {
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, ...fogUniforms() },
    vertexShader: CONFETTI_VERT,
    fragmentShader: CONFETTI_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: true,
    side: THREE.DoubleSide,
  });
  const pool = new ParticlePool({
    name: 'vfx.confetti',
    capacity,
    base: quadGeometry(),
    material,
    renderOrder: RENDER_ORDER.confetti,
  });
  scene.add(pool.mesh);
  return pool;
}
