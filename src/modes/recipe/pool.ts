/**
 * RECIPE RUSH — the ingredient pool.
 *
 * Every ingredient the mode shows is real 3D food from the theme, built by the
 * theme's own `FoodDef.build`. That is expensive to build and cheap to keep,
 * so nothing is ever built twice: tokens are built once per food per theme and
 * live for the whole session, and plated copies come off a per-food free list.
 * A run therefore allocates GPU memory exactly once, on the first recipe that
 * needs a given ingredient, and never hitches again.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FoodBuildCtx, FoodDef } from '../../content/api';
import { roundedBox } from '../../content/kit';
import { Rng } from '../../core/rng';
import type { QualityTier } from '../../core/types';
import type { MaterialLibrary } from '../../render/api';
import { RR } from './tuning';

function disposeTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.isMesh && m.geometry) m.geometry.dispose();
  });
}

/**
 * Collapse a built food to one mesh per material.
 *
 * Themes build a food as a little scene graph — a bun plus its sesame, a patty
 * plus its seared rim, a macaron's shell/foot/filling — and several of those
 * parts routinely share a material. That is free in the stacker, which shows
 * one moving layer at a time, but Recipe Rush has eight tokens and up to nine
 * plated items on screen at once, so every avoidable sub-mesh is a draw call
 * paid sixteen times over. Buckets of one are left completely alone; anything
 * that cannot be merged (mismatched attributes) falls back to the original.
 */
function compactByMaterial(root: THREE.Object3D): THREE.Object3D {
  const meshes: THREE.Mesh[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !Array.isArray(m.material)) meshes.push(m);
  });
  if (meshes.length < 2) return root;

  const buckets = new Map<THREE.Material, THREE.Mesh[]>();
  for (const m of meshes) {
    const key = m.material as THREE.Material;
    const list = buckets.get(key);
    if (list) list.push(m);
    else buckets.set(key, [m]);
  }
  let merged = false;
  for (const list of buckets.values()) if (list.length > 1) merged = true;
  if (!merged) return root;

  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const out = new THREE.Group();
  out.name = root.name;
  for (const [material, list] of buckets) {
    if (list.length === 1) {
      const m = list[0];
      const geo = m.geometry;
      const local = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      geo.applyMatrix4(local);
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = m.castShadow;
      mesh.receiveShadow = m.receiveShadow;
      out.add(mesh);
      continue;
    }
    const parts: THREE.BufferGeometry[] = [];
    for (const m of list) {
      const g = m.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      parts.push(g);
    }
    let geo: THREE.BufferGeometry | null = null;
    try {
      geo = mergeGeometries(parts, false);
    } catch {
      geo = null;
    }
    if (geo) {
      for (const g of parts) g.dispose();
      for (const m of list) m.geometry.dispose();
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = list[0].castShadow;
      mesh.receiveShadow = list[0].receiveShadow;
      out.add(mesh);
    } else {
      for (let i = 0; i < list.length; i++) {
        const mesh = new THREE.Mesh(parts[i], material);
        mesh.castShadow = list[i].castShadow;
        mesh.receiveShadow = list[i].receiveShadow;
        out.add(mesh);
        list[i].geometry.dispose();
      }
    }
  }
  return out;
}

export interface PoolDeps {
  materials: MaterialLibrary;
  quality: QualityTier;
}

const DOWN: Record<QualityTier, QualityTier> = { high: 'medium', medium: 'low', low: 'low' };

export class FoodPool {
  /** One token per food id, kept for the lifetime of the theme. */
  private tokens = new Map<string, THREE.Object3D>();
  /** Idle plated copies, keyed by food id. */
  private free = new Map<string, THREE.Object3D[]>();
  /** Everything ever built, so dispose() can be exhaustive. */
  private built: THREE.Object3D[] = [];
  private seed = 0x5eed1;

  constructor(private deps: PoolDeps) {}

  /** Plated height for a food — thinner than a stacker layer. */
  static dishHeight(food: FoodDef): number {
    return Math.max(food.thickness * RR.DISH_THICK_SCALE, RR.DISH_MIN_THICK);
  }

  /**
   * The token that sits in a pass slot. Built at a fixed size and scaled by
   * its holder, so a resize never rebuilds geometry.
   */
  token(food: FoodDef, index: number): THREE.Object3D {
    const hit = this.tokens.get(food.id);
    if (hit) return hit;
    const h = THREE.MathUtils.clamp(
      food.thickness * RR.TOKEN_THICK_SCALE,
      RR.TOKEN_MIN_THICK,
      RR.TOKEN_MAX_THICK,
    );
    // A token is 60-70 px across. It is built two tiers down and on the offcut
    // path — the same silhouette for a quarter of the triangles and a couple of
    // fewer sub-meshes, none of which is resolvable at that size.
    const obj = this.build(
      food,
      RR.TOKEN_BUILD_SIZE,
      h,
      index,
      true,
      DOWN[DOWN[this.deps.quality]],
    );
    obj.name = `recipe.token.${food.id}`;
    // Tokens do not cast. Eight of them would double their cost in the shadow
    // pass for a 60px shadow that the disc under each one already reads as.
    obj.traverse((o) => {
      o.castShadow = false;
    });
    this.tokens.set(food.id, obj);
    return obj;
  }

  /** A plated copy for the dish. Comes off the free list when one is idle. */
  acquire(food: FoodDef, index: number): THREE.Object3D {
    const list = this.free.get(food.id);
    const reused = list?.pop();
    if (reused) {
      reused.visible = true;
      reused.scale.set(1, 1, 1);
      reused.rotation.set(0, 0, 0);
      return reused;
    }
    // A plated item is 30% narrower than a stacker layer and there can be nine
    // of them, so it is built one tier down. At 150 px the difference is in the
    // triangle count, not the frame.
    const obj = this.build(
      food,
      RR.DISH_FOOTPRINT,
      FoodPool.dishHeight(food),
      index,
      false,
      DOWN[this.deps.quality],
    );
    obj.name = `recipe.dish.${food.id}`;
    return obj;
  }

  release(food: FoodDef, obj: THREE.Object3D): void {
    obj.visible = false;
    obj.scale.set(1, 1, 1);
    obj.rotation.set(0, 0, 0);
    let list = this.free.get(food.id);
    if (!list) {
      list = [];
      this.free.set(food.id, list);
    }
    // A recipe never needs more than MAX_LEN of one ingredient on the plate.
    if (list.length < RR.MAX_LEN) list.push(obj);
    else {
      disposeTree(obj);
      const at = this.built.indexOf(obj);
      if (at >= 0) this.built.splice(at, 1);
    }
  }

  /** Turn shadow casting on or off for a whole built food. */
  static setCast(obj: THREE.Object3D, on: boolean): void {
    obj.traverse((o) => {
      o.castShadow = on;
    });
  }

  private build(
    food: FoodDef,
    size: number,
    height: number,
    index: number,
    offcut: boolean,
    quality: QualityTier,
  ): THREE.Object3D {
    const ctx: FoodBuildCtx = {
      width: size,
      depth: size,
      height: Math.max(height, 0.04),
      index,
      // Stable per (food, index) so a token and its plated twin are cut from
      // the same cloth every time the mode is rebuilt.
      rng: new Rng((this.seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0),
      quality,
      materials: this.deps.materials,
      offcut,
    };
    let obj: THREE.Object3D | null = null;
    try {
      obj = food.build(ctx);
    } catch (err) {
      console.error(`[snackery] recipe: food "${food.id}" failed to build`, err);
    }
    if (!obj) obj = this.fallback(ctx, food);
    obj = compactByMaterial(obj);
    obj.castShadow = true;
    this.built.push(obj);
    return obj;
  }

  /** Authored content gets called at sizes it never saw; never kill the run. */
  private fallback(ctx: FoodBuildCtx, food: FoodDef): THREE.Object3D {
    const geo = roundedBox(
      ctx.width,
      ctx.height,
      ctx.depth,
      Math.min(ctx.width, ctx.depth, ctx.height) * 0.18,
      2,
    );
    const mat = this.deps.materials.standard(`recipe.fallback.${food.tint.toString(16)}`, {
      color: food.tint,
      roughness: 0.68,
      metalness: 0,
    });
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  dispose(): void {
    for (const obj of this.built) {
      obj.removeFromParent();
      disposeTree(obj);
    }
    this.built.length = 0;
    this.tokens.clear();
    this.free.clear();
  }
}
