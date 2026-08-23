/**
 * BELT ITEM POOL
 * ==============
 *
 * Three rules drive the shape of this file.
 *
 * 1. Nothing is built or thrown away while the belt is running. Each of the
 *    theme's eight foods is built ONCE at the authored 2.4 footprint (building
 *    small would make `squareness()` think the food had been sliced, and a
 *    tomato would come out as a rounded square), then scaled down by a group.
 *    Every pool slot gets a `clone()` of each template — clones share geometry
 *    and materials, so this costs Object3D bookkeeping and no GPU memory — and
 *    a spawn is one `visible = true`. update() never allocates.
 *
 * 2. Five items on screen at once means every food detail is a cost paid five
 *    times, so a belt item is not the same object the tower gets: it is built
 *    one content tier down and flattened to at most three materials. Measured
 *    on all six themes, that is the difference between 24-29 draws and 14, and
 *    between 35k triangles and 20k, for a food drawn at 80-165 CSS px.
 *
 * 3. The tap volume is not the food. Ruffles, gaps and 3mm-thick discs are
 *    hostile raycast targets, so every slot carries an invisible 1.02 x 0.95 x
 *    0.9 box. At the belt's far end 44 CSS px is 0.61 world units and at the
 *    near end 0.22, so one constant box clears the touch-target floor
 *    everywhere on the belt while staying inside the item spacing, which the
 *    spawner never lets fall below 1.18.
 */
import * as THREE from 'three';
import type { FoodDef } from '../../content/api';
import { BASE_FOOTPRINT } from '../../core/world';
import { Rng } from '../../core/rng';
import type { QualityTier } from '../../core/types';
import type { MaterialLibrary } from '../../render/api';
import { disposeGeometries, flattenByMaterial } from './parts';
import { DECK_H, HIT_D, HIT_H, HIT_W, ITEM_SCALE, ITEM_Y_BOOST } from './tuning';

export type SlotState = 'idle' | 'ride' | 'fly' | 'reject';

export interface Slot {
  readonly index: number;
  readonly group: THREE.Group;
  readonly proxy: THREE.Mesh;
  /** One dressing per food in the theme; only one is ever visible. */
  readonly dressings: THREE.Object3D[];
  state: SlotState;
  food: FoodDef | null;
  foodIndex: number;
  /** Position along the belt, local +Z toward the camera. */
  z: number;
  /** Lateral offset, so a run of items does not read as a ruler. */
  lateral: number;
  /** Seconds in the current state. */
  t: number;
  /** Per-slot phase so the idle bob is not synchronised. */
  phase: number;
  /** Grab animation: where the item left the belt, and where it is going. */
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  spin: number;
  /** True once the fly animation has delivered its payload. */
  delivered: boolean;
  /** Whether the dressed food is currently a shadow caster. */
  casting: boolean;
}

export class ItemPool {
  readonly root = new THREE.Group();
  readonly slots: Slot[] = [];

  private templates: THREE.Object3D[] = [];
  private hitGeo: THREE.BoxGeometry;
  private hitMat: THREE.Material;
  private foods: FoodDef[] = [];

  constructor(size: number) {
    this.hitGeo = new THREE.BoxGeometry(HIT_W, HIT_H, HIT_D);
    // Never rendered — `visible` is false — but a material keeps three happy
    // if anything ever traverses it.
    this.hitMat = new THREE.MeshBasicMaterial({ visible: false });

    for (let i = 0; i < size; i++) {
      const group = new THREE.Group();
      group.visible = false;
      const proxy = new THREE.Mesh(this.hitGeo, this.hitMat);
      proxy.visible = false;
      proxy.position.y = HIT_H * 0.42;
      group.add(proxy);
      this.root.add(group);
      this.slots.push({
        index: i,
        group,
        proxy,
        dressings: [],
        state: 'idle',
        food: null,
        foodIndex: -1,
        z: 0,
        lateral: 0,
        t: 0,
        phase: (i * 1.618) % 1,
        fromX: 0,
        fromY: 0,
        fromZ: 0,
        toX: 0,
        toY: 0,
        toZ: 0,
        spin: 0,
        delivered: true,
        casting: true,
      });
    }
  }

  get foodCount(): number {
    return this.foods.length;
  }

  foodAt(i: number): FoodDef {
    return this.foods[i];
  }

  /**
   * Belt items are drawn at 80-165 CSS px, less than half the size the stacker
   * shows the same food at, and there are five of them instead of one. So they
   * are built one content tier down: `pickQ` thins the radial and ring counts
   * and the scatters, which is where nearly all of a food's triangles are, and
   * at this size on this screen there is nothing to see.
   */
  private static itemQuality(q: QualityTier): QualityTier {
    return q === 'high' ? 'medium' : 'low';
  }

  /**
   * Draw calls per belt item. Five on screen makes this the whole budget: two
   * materials each plus the four the machine costs is exactly the 14-draw
   * line, on every theme, in the worst case rather than on average.
   */
  private static maxMaterials(_q: QualityTier): number {
    return 2;
  }

  /** Build (or rebuild, on a theme change) every food template and dressing. */
  setFoods(
    foods: FoodDef[],
    materials: MaterialLibrary,
    quality: QualityTier,
    seed: number,
  ): void {
    this.clearFoods();
    this.foods = foods.slice();
    const lod = ItemPool.itemQuality(quality);
    const maxMat = ItemPool.maxMaterials(quality);

    for (let i = 0; i < foods.length; i++) {
      const food = foods[i];
      const holder = new THREE.Group();
      let built: THREE.Object3D | null = null;
      try {
        built = food.build({
          width: BASE_FOOTPRINT,
          depth: BASE_FOOTPRINT,
          height: Math.max(food.thickness, 0.08),
          index: i,
          rng: new Rng((seed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0),
          quality: lod,
          materials,
          offcut: false,
        });
      } catch (err) {
        console.error(`[conveyor] food "${food.id}" failed to build`, err);
      }
      if (!built) {
        built = new THREE.Mesh(
          new THREE.CylinderGeometry(BASE_FOOTPRINT / 2, BASE_FOOTPRINT / 2, food.thickness, 20),
          materials.standard(`conveyor.fallback.${food.tint.toString(16)}`, {
            color: food.tint,
            roughness: 0.7,
          }),
        );
        built.position.y = food.thickness / 2;
      }
      holder.add(flattenByMaterial(built, maxMat));
      holder.scale.set(ITEM_SCALE, ITEM_SCALE * ITEM_Y_BOOST, ITEM_SCALE);
      this.templates.push(holder);
    }

    for (const slot of this.slots) {
      for (let i = 0; i < this.templates.length; i++) {
        const dressing = this.templates[i].clone(true);
        dressing.visible = false;
        slot.group.add(dressing);
        slot.dressings.push(dressing);
      }
    }
  }

  /** Take a free slot and dress it as `foodIndex`. */
  acquire(foodIndex: number): Slot | null {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.state !== 'idle') continue;
      this.dress(s, foodIndex);
      return s;
    }
    return null;
  }

  private dress(slot: Slot, foodIndex: number): void {
    if (slot.foodIndex >= 0 && slot.dressings[slot.foodIndex]) {
      slot.dressings[slot.foodIndex].visible = false;
    }
    slot.foodIndex = foodIndex;
    slot.food = this.foods[foodIndex];
    const d = slot.dressings[foodIndex];
    if (d) d.visible = true;
    slot.group.visible = true;
    slot.group.scale.setScalar(1);
    slot.group.rotation.set(0, 0, 0);
    slot.group.position.y = DECK_H;
    slot.t = 0;
    slot.spin = 0;
    slot.delivered = false;
    slot.casting = true;
    this.setCasting(slot, false);
  }

  /**
   * Shadow-cast only where the shadow can be seen.
   *
   * The shadow map is a small box the host pins near the play focus, so an
   * item at the far end of a nine-unit belt renders into the depth pass and
   * lands nowhere. Gating on distance drops those passes; the contact shadow
   * under the items you are actually about to tap is kept.
   */
  setCasting(slot: Slot, on: boolean): void {
    if (slot.casting === on) return;
    slot.casting = on;
    const d = slot.foodIndex >= 0 ? slot.dressings[slot.foodIndex] : null;
    if (!d) return;
    d.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = on;
    });
  }

  release(slot: Slot): void {
    slot.state = 'idle';
    slot.group.visible = false;
    if (slot.foodIndex >= 0 && slot.dressings[slot.foodIndex]) {
      slot.dressings[slot.foodIndex].visible = false;
    }
    slot.food = null;
    slot.foodIndex = -1;
  }

  releaseAll(): void {
    for (const s of this.slots) this.release(s);
  }

  /** Live items, for the spawner's density rule. */
  countActive(): number {
    let n = 0;
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i].state !== 'idle') n++;
    return n;
  }

  /** Drop every template and dressing; the slots themselves survive. */
  clearFoods(): void {
    for (const slot of this.slots) {
      for (const d of slot.dressings) slot.group.remove(d);
      slot.dressings.length = 0;
      slot.foodIndex = -1;
      slot.food = null;
      slot.state = 'idle';
      slot.group.visible = false;
    }
    for (const t of this.templates) disposeGeometries(t);
    this.templates.length = 0;
    this.foods.length = 0;
  }

  dispose(): void {
    this.clearFoods();
    this.hitGeo.dispose();
    this.hitMat.dispose();
    this.root.clear();
    this.slots.length = 0;
  }
}
