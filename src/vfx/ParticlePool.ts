import * as THREE from 'three';

/**
 * One GPU-instanced particle class = one draw call.
 *
 * Storage is a struct-of-arrays of `Float32Array`s that back
 * `InstancedBufferAttribute`s. Emission is a bump allocator over a ring
 * buffer: `push()` writes 17 floats into the next slot and marks a dirty
 * range. When the ring wraps it overwrites the OLDEST slot, which is the
 * cheapest possible "pool full" policy and never allocates or grows.
 *
 * Nothing about a live particle is touched again on the CPU — the vertex
 * shader advances it from `uTime`. The only per-frame CPU work is `sweep()`,
 * a linear scan of death times (a few hundred float compares) that keeps
 * `geometry.instanceCount` tight and hides the mesh entirely when idle.
 */

const STRIDES = [3, 3, 3, 4, 4] as const;
const ATTR_NAMES = ['aStart', 'aVel', 'aColor', 'aParams', 'aDyn'] as const;

interface AttrSlot {
  attr: THREE.InstancedBufferAttribute;
  stride: number;
  range: { start: number; count: number };
}

function noopRaycast(): void {
  /* particles are never picked; skip the bounding-sphere path entirely */
}

export interface ParticlePoolOpts {
  name: string;
  capacity: number;
  /** Base (non-instanced) geometry; its attributes are adopted, not copied. */
  base: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  renderOrder: number;
}

export class ParticlePool {
  readonly capacity: number;
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly slots: AttrSlot[] = [];

  private readonly start: Float32Array;
  private readonly vel: Float32Array;
  private readonly color: Float32Array;
  private readonly params: Float32Array;
  private readonly dyn: Float32Array;
  /** Absolute time at which each slot dies; -1 = never used. */
  private readonly death: Float32Array;

  private head = 0;
  /** High-water mark: slots [0, used) have ever been written. */
  private used = 0;
  private liveCount = 0;
  private dirty = false;
  private dirtyLo = 0;
  private dirtyHi = 0;

  constructor(opts: ParticlePoolOpts) {
    const n = Math.max(8, opts.capacity | 0);
    this.capacity = n;
    this.material = opts.material;

    this.start = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.color = new Float32Array(n * 3);
    this.params = new Float32Array(n * 4);
    this.dyn = new Float32Array(n * 4);
    this.death = new Float32Array(n).fill(-1);

    const geo = new THREE.InstancedBufferGeometry();
    const base = opts.base;
    for (const name of Object.keys(base.attributes)) {
      geo.setAttribute(name, base.attributes[name]);
    }
    if (base.index !== null) geo.setIndex(base.index);

    const arrays = [this.start, this.vel, this.color, this.params, this.dyn];
    for (let i = 0; i < arrays.length; i++) {
      const attr = new THREE.InstancedBufferAttribute(arrays[i], STRIDES[i]);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(ATTR_NAMES[i], attr);
      this.slots.push({ attr, stride: STRIDES[i], range: { start: 0, count: 0 } });
    }
    geo.instanceCount = 0;
    // Positions live in the shader, so a bounding volume is meaningless.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.geometry = geo;
    this.mesh = new THREE.Mesh(geo, opts.material);
    this.mesh.name = opts.name;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = opts.renderOrder;
    this.mesh.visible = false;
    this.mesh.raycast = noopRaycast;
    // Explicit: the shader owns vertex placement, so a depth-material shadow
    // pass would draw this pool as a blob at the origin. Never shadow-cast.
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  get live(): number {
    return this.liveCount;
  }

  /**
   * Emit one particle. `birth` may be in the future for free scheduling.
   * All 17 floats are written here and never again.
   */
  push(
    birth: number,
    life: number,
    px: number,
    py: number,
    pz: number,
    vx: number,
    vy: number,
    vz: number,
    r: number,
    g: number,
    b: number,
    size: number,
    seed: number,
    gravity: number,
    drag: number,
    dynZ: number,
    dynW: number,
  ): void {
    const i = this.head;
    this.head = i + 1 >= this.capacity ? 0 : i + 1;
    if (this.head === 0) {
      // Wrapped: the dirty range now spans the whole buffer.
      this.dirtyLo = 0;
      this.dirtyHi = this.capacity - 1;
      this.used = this.capacity;
    } else {
      if (this.head > this.used) this.used = this.head;
      if (!this.dirty) {
        this.dirtyLo = i;
        this.dirtyHi = i;
      } else {
        if (i < this.dirtyLo) this.dirtyLo = i;
        if (i > this.dirtyHi) this.dirtyHi = i;
      }
    }
    this.dirty = true;

    const i3 = i * 3;
    const i4 = i * 4;
    const s = this.start;
    s[i3] = px;
    s[i3 + 1] = py;
    s[i3 + 2] = pz;
    const v = this.vel;
    v[i3] = vx;
    v[i3 + 1] = vy;
    v[i3 + 2] = vz;
    const c = this.color;
    c[i3] = r;
    c[i3 + 1] = g;
    c[i3 + 2] = b;
    const p = this.params;
    p[i4] = birth;
    p[i4 + 1] = life;
    p[i4 + 2] = size;
    p[i4 + 3] = seed;
    const d = this.dyn;
    d[i4] = gravity;
    d[i4 + 1] = drag;
    d[i4 + 2] = dynZ;
    d[i4 + 3] = dynW;

    this.death[i] = birth + life;
  }

  /** Upload the slots written since the last frame. Zero allocation. */
  commit(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const lo = this.dirtyLo;
    const count = this.dirtyHi - lo + 1;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      slot.range.start = lo * slot.stride;
      slot.range.count = count * slot.stride;
      // Reuse one persistent range object instead of addUpdateRange()'s literal.
      slot.attr.updateRanges.length = 0;
      slot.attr.updateRanges.push(slot.range);
      slot.attr.needsUpdate = true;
    }
  }

  /** Retire expired slots and tighten the instance count. */
  sweep(now: number): void {
    const death = this.death;
    const used = this.used;
    let live = 0;
    let top = -1;
    for (let i = 0; i < used; i++) {
      if (death[i] > now) {
        live++;
        top = i;
      }
    }
    this.liveCount = live;
    if (live === 0) {
      this.used = 0;
      this.head = 0;
      this.geometry.instanceCount = 0;
      this.mesh.visible = false;
    } else {
      this.geometry.instanceCount = top + 1;
      this.mesh.visible = true;
    }
  }

  setTime(t: number): void {
    this.material.uniforms.uTime.value = t;
  }

  /** Retire every live particle immediately. */
  clear(): void {
    this.death.fill(-1);
    this.params.fill(0);
    this.head = 0;
    this.used = 0;
    this.liveCount = 0;
    this.dirty = false;
    this.geometry.instanceCount = 0;
    this.mesh.visible = false;
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i].attr.updateRanges.length = 0;
      this.slots[i].attr.needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
