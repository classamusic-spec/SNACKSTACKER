import * as THREE from 'three';
import { clamp, lerp, TAU } from '../core/math';
import { Rng } from '../core/rng';
import type { QualityTier } from '../core/types';
import type { MaterialLibrary } from '../render/api';
import type { BurstOpts, RingOpts, VfxSystem } from './api';
import { ParticlePool } from './ParticlePool';
import {
  createConfettiPool,
  createCrumbPool,
  createDropPool,
  createGlowPool,
} from './pools';
import { PopTextPool } from './popText';
import { createRingPool, emitRing } from './rings';

/**
 * SNACKERY VFX
 * ============
 *
 * GPU PATH. Every particle class is one `InstancedBufferGeometry` + one
 * `ShaderMaterial` = ONE draw call. The CPU writes 17 floats per particle at
 * emission and then never touches it again: the vertex shader advances
 * `p = p0 + v0*t + 0.5*g*t^2` (with an exact closed form for linear drag)
 * from a single `uTime` uniform. Per-frame CPU cost is one uniform write and
 * a short linear scan of death times per class — no matrices, no Vector3s,
 * no allocation, no garbage.
 *
 * Because birth times are absolute, a particle can be emitted with a birth in
 * the FUTURE and it simply switches itself on later. All the staggered timing
 * in `perfect()` and `confetti()` uses that instead of a CPU scheduler.
 *
 * Draw calls added: 5 constant (crumbs, droplets, confetti, rings, glints)
 * plus one per visible pop-text sprite (<= tier text capacity). Meshes hide
 * themselves the moment their pool is empty, so an idle frame adds 0.
 */

/* --------------------------------------------------------- module scratch */

const _dir = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _out = new THREE.Vector3();
const _colA = new THREE.Color();
const _colB = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _sideRef = new THREE.Vector3(1, 0, 0);

function orthoBasis(dir: THREE.Vector3, t1: THREE.Vector3, t2: THREE.Vector3): void {
  const ref = Math.abs(dir.y) > 0.94 ? _sideRef : _up;
  t1.crossVectors(dir, ref);
  if (t1.lengthSq() < 1e-8) t1.set(1, 0, 0);
  t1.normalize();
  t2.crossVectors(dir, t1).normalize();
}

/** Uniform-ish sample inside a cone around `dir`; spread 1 = full hemisphere. */
function coneSample(
  dir: THREE.Vector3,
  t1: THREE.Vector3,
  t2: THREE.Vector3,
  spread: number,
  rng: Rng,
  out: THREE.Vector3,
): void {
  const cosMax = Math.cos(clamp(spread, 0, 1.6) * Math.PI * 0.5);
  const c = lerp(1, cosMax, rng.next());
  const s = Math.sqrt(Math.max(0, 1 - c * c));
  const phi = rng.next() * TAU;
  out.copy(dir).multiplyScalar(c);
  out.addScaledVector(t1, s * Math.cos(phi));
  out.addScaledVector(t2, s * Math.sin(phi));
}

/* ---------------------------------------------------------- quality tiers */

interface TierCfg {
  crumbs: number;
  glints: number;
  drops: number;
  confetti: number;
  rings: number;
  texts: number;
  /** Emission-count multiplier. */
  countScale: number;
  /** Additive intensity of the glint layer. */
  glow: number;
  /** Whether the extra additive layers (halo, shimmer tail) run at all. */
  layers: boolean;
}

const TIERS: Record<QualityTier, TierCfg> = {
  high: {
    crumbs: 512,
    glints: 640,
    drops: 256,
    confetti: 256,
    rings: 24,
    texts: 12,
    countScale: 1,
    glow: 1.15,
    layers: true,
  },
  medium: {
    crumbs: 256,
    glints: 320,
    drops: 160,
    confetti: 160,
    rings: 16,
    texts: 10,
    countScale: 0.62,
    glow: 1.05,
    layers: true,
  },
  low: {
    crumbs: 128,
    glints: 160,
    drops: 96,
    confetti: 96,
    rings: 12,
    texts: 8,
    countScale: 0.4,
    glow: 0.95,
    layers: false,
  },
};

const MAX_DT = 0.05;

/* ------------------------------------------------------------- the system */

class Vfx implements VfxSystem {
  private readonly cfg: TierCfg;
  private readonly rng = new Rng(0x53ac1a11);
  private readonly crumbs: ParticlePool;
  private readonly glints: ParticlePool;
  private readonly drops: ParticlePool;
  private readonly confettiPool: ParticlePool;
  private readonly ringPool: ParticlePool;
  private readonly pools: ParticlePool[];
  private readonly text: PopTextPool;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  /** Own clock, advanced by clamped dt so a tab-switch cannot warp effects. */
  private time = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    materials: MaterialLibrary,
    quality: QualityTier,
  ) {
    const cfg = TIERS[quality] ?? TIERS.medium;
    this.cfg = cfg;
    this.scene = scene;
    this.camera = camera;

    this.crumbs = createCrumbPool(scene, cfg.crumbs);
    this.glints = createGlowPool(scene, materials, cfg.glints, cfg.glow);
    this.drops = createDropPool(scene, materials, cfg.drops);
    this.confettiPool = createConfettiPool(scene, cfg.confetti);
    this.ringPool = createRingPool(scene, cfg.rings);
    this.pools = [this.crumbs, this.drops, this.confettiPool, this.ringPool, this.glints];
    this.text = new PopTextPool(scene, cfg.texts);
  }

  private count(base: number, min: number): number {
    return Math.max(min, Math.round(base * this.cfg.countScale));
  }

  /* ------------------------------------------------------------- effects */

  /** Crumbs and chunks with real gravity. Fires on every drop, so keep it cheap. */
  burst(opts: BurstOpts): void {
    const rng = this.rng;
    const n = this.count(opts.count ?? 16, 5);
    const power = opts.power ?? 1;
    const spread = opts.spread ?? 0.8;
    const scale = opts.scale ?? 1;
    const gravity = opts.gravity ?? 14;
    const life = opts.life ?? 0.78;
    const p = opts.position;

    // The game passes the slice direction; crumbs spray that way, plus up.
    if (opts.direction !== undefined && opts.direction.lengthSq() > 1e-8) {
      _dir.copy(opts.direction).normalize().multiplyScalar(0.82);
      _dir.addScaledVector(_up, 0.6).normalize();
    } else {
      _dir.set(0, 1, 0);
    }
    orthoBasis(_dir, _t1, _t2);

    _colA.setHex(opts.color);
    _colB.setHex(opts.colorAlt ?? opts.color);
    const t = this.time;

    for (let i = 0; i < n; i++) {
      coneSample(_dir, _t1, _t2, spread, rng, _out);
      const speed = power * rng.range(2.1, 5.2);
      const m = rng.next();
      this.crumbs.push(
        t + rng.range(0, 0.02),
        life * rng.range(0.72, 1.28),
        p.x + _out.x * 0.06,
        p.y + _out.y * 0.06,
        p.z + _out.z * 0.06,
        _out.x * speed,
        _out.y * speed + rng.range(0.3, 1.9),
        _out.z * speed,
        lerp(_colA.r, _colB.r, m),
        lerp(_colA.g, _colB.g, m),
        lerp(_colA.b, _colB.b, m),
        scale * rng.range(0.042, 0.115),
        rng.next(),
        gravity,
        0.55,
        rng.range(-17, 17),
        0,
      );
    }
  }

  /** Weightless glints that rise, twinkle and fade. Reads as magic, not smoke. */
  sparkle(opts: BurstOpts): void {
    const rng = this.rng;
    const n = this.count(opts.count ?? 12, 4);
    const power = opts.power ?? 1;
    const spread = opts.spread ?? 1;
    const scale = opts.scale ?? 1;
    // Negative gravity = buoyancy. Glints drift upward.
    const gravity = opts.gravity ?? -1.15;
    const life = opts.life ?? 0.95;
    const p = opts.position;

    if (opts.direction !== undefined && opts.direction.lengthSq() > 1e-8) {
      _dir.copy(opts.direction).normalize().multiplyScalar(0.5);
      _dir.addScaledVector(_up, 0.9).normalize();
    } else {
      _dir.set(0, 1, 0);
    }
    orthoBasis(_dir, _t1, _t2);

    _colA.setHex(opts.color);
    _colB.setHex(opts.colorAlt ?? opts.color);
    const t = this.time;

    for (let i = 0; i < n; i++) {
      coneSample(_dir, _t1, _t2, spread, rng, _out);
      const speed = power * rng.range(0.55, 2.15);
      const m = rng.next();
      this.glints.push(
        t + rng.range(0, 0.09),
        life * rng.range(0.7, 1.35),
        p.x + _out.x * 0.1,
        p.y + _out.y * 0.1,
        p.z + _out.z * 0.1,
        _out.x * speed,
        _out.y * speed + rng.range(0.25, 1.1),
        _out.z * speed,
        lerp(_colA.r, _colB.r, m),
        lerp(_colA.g, _colB.g, m),
        lerp(_colA.b, _colB.b, m),
        scale * rng.range(0.075, 0.2),
        rng.next(),
        gravity,
        1.05,
        rng.range(9, 21),
        rng.range(-2.4, 2.4),
      );
    }
  }

  /** Liquid droplets: heavier, stretched along velocity, glossy. */
  splash(opts: BurstOpts): void {
    const rng = this.rng;
    const n = this.count(opts.count ?? 18, 5);
    const power = opts.power ?? 1;
    const spread = opts.spread ?? 0.85;
    const scale = opts.scale ?? 1;
    const gravity = opts.gravity ?? 22;
    const life = opts.life ?? 0.85;
    const p = opts.position;

    if (opts.direction !== undefined && opts.direction.lengthSq() > 1e-8) {
      _dir.copy(opts.direction).normalize().multiplyScalar(0.55);
      _dir.addScaledVector(_up, 0.85).normalize();
    } else {
      _dir.set(0, 1, 0);
    }
    orthoBasis(_dir, _t1, _t2);

    _colA.setHex(opts.color);
    _colB.setHex(opts.colorAlt ?? opts.color);
    const t = this.time;

    for (let i = 0; i < n; i++) {
      coneSample(_dir, _t1, _t2, spread, rng, _out);
      // A few fat blobs among many fine specks.
      const fat = rng.bool(0.22);
      const speed = power * (fat ? rng.range(1.4, 3.1) : rng.range(2.4, 5.6));
      const size = scale * (fat ? rng.range(0.11, 0.19) : rng.range(0.035, 0.08));
      const m = rng.next();
      this.drops.push(
        t + rng.range(0, 0.03),
        life * rng.range(0.7, 1.3),
        p.x + _out.x * 0.05,
        p.y + _out.y * 0.05,
        p.z + _out.z * 0.05,
        _out.x * speed,
        _out.y * speed + rng.range(0.6, 2.4),
        _out.z * speed,
        lerp(_colA.r, _colB.r, m),
        lerp(_colA.g, _colB.g, m),
        lerp(_colA.b, _colB.b, m),
        size,
        rng.next(),
        gravity,
        0.32,
        fat ? 0.03 : 0.06,
        0,
      );
    }
  }

  /** Expanding shockwave. */
  ring(opts: RingOpts): void {
    const radius = opts.radius ?? 1.1;
    const thickness = opts.thickness ?? 0.16;
    const life = opts.life ?? 0.45;
    const flat = (opts.orientation ?? 'flat') === 'flat';
    const p = opts.position;
    _colA.setHex(opts.color);
    emitRing(
      this.ringPool,
      this.time,
      life,
      p.x,
      flat ? p.y + 0.015 : p.y,
      p.z,
      _colA.r,
      _colA.g,
      _colA.b,
      radius * 0.22,
      radius,
      thickness,
      1,
      this.rng.next(),
      flat,
    );
  }

  /**
   * The reward moment. Everything below is emitted in ONE call — the later
   * beats simply carry a future birth time.
   */
  perfect(position: THREE.Vector3, color: number, tier: number): void {
    const t = Math.max(0, Math.floor(tier));
    const rng = this.rng;
    const now = this.time;
    const cfg = this.cfg;
    const x = position.x;
    const y = position.y;
    const z = position.z;

    _colA.setHex(color);
    const br = _colA.r;
    const bg = _colA.g;
    const bb = _colA.b;
    // Escalating shift toward white-hot.
    const w = Math.min(0.62, 0.17 * t);
    const hr = lerp(br, 1, w);
    const hg = lerp(bg, 1, w);
    const hb = lerp(bb, 1, w);

    // --- tier 0+: the impact ring on the landing ---------------------------
    emitRing(
      this.ringPool,
      now,
      0.42 + 0.05 * t,
      x,
      y + 0.015,
      z,
      hr,
      hg,
      hb,
      0.2,
      1.05 + 0.22 * t,
      0.15 + 0.03 * t,
      0.85 + 0.35 * t,
      rng.next(),
      true,
    );

    // --- tier 0+: a handful of glints kicking outward ----------------------
    const n = this.count(7 + t * 7, 5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng.range(-0.3, 0.3);
      const out = rng.range(1.2, 2.6 + 0.3 * t);
      this.glints.push(
        now + rng.range(0, 0.06),
        rng.range(0.55, 0.95) + 0.06 * t,
        x + Math.cos(a) * 0.14,
        y + 0.05,
        z + Math.sin(a) * 0.14,
        Math.cos(a) * out,
        rng.range(1.1, 2.6) + 0.25 * t,
        Math.sin(a) * out,
        hr,
        hg,
        hb,
        rng.range(0.1, 0.2) + 0.02 * t,
        rng.next(),
        -1.4,
        1.2,
        rng.range(10, 22),
        rng.range(-2.5, 2.5),
      );
    }

    // --- tier 1+: a soft radial flash --------------------------------------
    if (t >= 1) {
      this.flash(now, x, y + 0.06, z, hr, hg, hb, 1.5 + 0.5 * t, 0.2 + 0.03 * t);
      if (cfg.layers) {
        this.flash(now + 0.02, x, y + 0.06, z, hr, hg, hb, 2.6 + 0.9 * t, 0.34);
      }
    }

    // --- tier 2+: delayed second ring + a rising column of glints ----------
    if (t >= 2) {
      emitRing(
        this.ringPool,
        now + 0.13,
        0.5,
        x,
        y + 0.02,
        z,
        hr,
        hg,
        hb,
        0.3,
        1.7 + 0.3 * t,
        0.1,
        0.7,
        rng.next(),
        true,
      );
      const m = this.count(7 + 4 * (t - 2), 4);
      for (let i = 0; i < m; i++) {
        const a = rng.next() * TAU;
        const r = rng.range(0, 0.3);
        this.glints.push(
          now + (i / m) * 0.34 + rng.range(0, 0.05),
          rng.range(0.8, 1.3),
          x + Math.cos(a) * r,
          y + rng.range(0, 0.2),
          z + Math.sin(a) * r,
          rng.range(-0.35, 0.35),
          rng.range(2.6, 4.4),
          rng.range(-0.35, 0.35),
          lerp(hr, 1, 0.35),
          lerp(hg, 1, 0.35),
          lerp(hb, 1, 0.35),
          rng.range(0.09, 0.17),
          rng.next(),
          -0.6,
          0.9,
          rng.range(12, 24),
          rng.range(-3, 3),
        );
      }
    }

    // --- tier 3+: shards, a vertical shock, a lingering shimmer ------------
    if (t >= 3) {
      emitRing(
        this.ringPool,
        now + 0.05,
        0.36,
        x,
        y + 0.35,
        z,
        hr,
        hg,
        hb,
        0.1,
        0.95,
        0.09,
        0.8,
        rng.next(),
        false,
      );
      const k = this.count(12 + 4 * (t - 3), 6);
      for (let i = 0; i < k; i++) {
        const a = rng.next() * TAU;
        const out = rng.range(1.6, 3.6);
        this.crumbs.push(
          now + rng.range(0, 0.04),
          rng.range(0.9, 1.5),
          x + Math.cos(a) * 0.1,
          y + 0.1,
          z + Math.sin(a) * 0.1,
          Math.cos(a) * out,
          rng.range(3.2, 5.6),
          Math.sin(a) * out,
          lerp(br, 1, rng.range(0.1, 0.6)),
          lerp(bg, 1, rng.range(0.1, 0.6)),
          lerp(bb, 1, rng.range(0.1, 0.6)),
          rng.range(0.05, 0.11),
          rng.next(),
          9.5,
          0.5,
          rng.range(-20, 20),
          0,
        );
      }
      if (cfg.layers) {
        const q = this.count(10, 4);
        for (let i = 0; i < q; i++) {
          const a = rng.next() * TAU;
          const r = rng.range(0.2, 0.95);
          this.glints.push(
            now + 0.12 + rng.range(0, 0.85),
            rng.range(0.55, 0.9),
            x + Math.cos(a) * r,
            y + rng.range(0.05, 0.9),
            z + Math.sin(a) * r,
            rng.range(-0.2, 0.2),
            rng.range(0.15, 0.7),
            rng.range(-0.2, 0.2),
            1,
            lerp(hg, 1, 0.5),
            lerp(hb, 1, 0.5),
            rng.range(0.05, 0.11),
            rng.next(),
            -0.35,
            1.4,
            rng.range(14, 26),
            rng.range(-1.5, 1.5),
          );
        }
      }
    }
  }

  /** Celebratory paper raining from above the frustum, fluttering on air drag. */
  confetti(position: THREE.Vector3, colors: number[]): void {
    const rng = this.rng;
    const n = this.count(96, 20);
    const now = this.time;
    const palette = colors.length > 0 ? colors : null;
    // Start above whatever the camera can currently see.
    const top = Math.max(position.y + 7.5, this.camera.position.y + 5.5);

    for (let i = 0; i < n; i++) {
      if (palette !== null) _colA.setHex(palette[i % palette.length]);
      else _colA.setRGB(1, 1, 1);
      const a = rng.next() * TAU;
      const r = Math.sqrt(rng.next()) * 3.4;
      this.confettiPool.push(
        now + (i / n) * 1.05 + rng.range(0, 0.12),
        rng.range(2.2, 3.4),
        position.x + Math.cos(a) * r,
        top + rng.range(0, 2.2),
        position.z + Math.sin(a) * r,
        rng.range(-0.5, 0.5),
        rng.range(-1.6, -0.3),
        rng.range(-0.5, 0.5),
        _colA.r,
        _colA.g,
        _colA.b,
        rng.range(0.1, 0.2),
        rng.next(),
        3.4,
        1.5,
        rng.range(0.16, 0.62),
        rng.range(2.5, 8),
      );
    }
  }

  /** Floating world text, e.g. "+120" or "PERFECT". */
  popText(position: THREE.Vector3, text: string, color: number): void {
    this.text.spawn(this.time, position, text, color);
  }

  /* ------------------------------------------------------------ lifecycle */

  update(dt: number, elapsed: number): void {
    if (this.disposed) return;
    // Clamp the tab-switch spike; the system runs on its own clock.
    const step = dt > MAX_DT ? MAX_DT : dt > 0 ? dt : 0;
    this.time += step;
    const now = this.time;
    for (let i = 0; i < this.pools.length; i++) {
      const pool = this.pools[i];
      pool.commit();
      pool.sweep(now);
      pool.setTime(now);
    }
    this.text.update(now);
  }

  clear(): void {
    for (let i = 0; i < this.pools.length; i++) this.pools[i].clear();
    this.text.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = 0; i < this.pools.length; i++) this.pools[i].dispose();
    this.text.dispose();
    // Sprite textures come from the MaterialLibrary cache, which owns them.
  }

  /* -------------------------------------------------------------- helpers */

  private flash(
    birth: number,
    x: number,
    y: number,
    z: number,
    r: number,
    g: number,
    b: number,
    size: number,
    life: number,
  ): void {
    this.glints.push(
      birth,
      life,
      x,
      y,
      z,
      0,
      0.35,
      0,
      r,
      g,
      b,
      size,
      this.rng.next(),
      0,
      0,
      0,
      0.5,
    );
  }
}

export function createVfx(
  scene: THREE.Scene,
  camera: THREE.Camera,
  materials: MaterialLibrary,
  quality: QualityTier,
): VfxSystem {
  return new Vfx(scene, camera, materials, quality);
}
