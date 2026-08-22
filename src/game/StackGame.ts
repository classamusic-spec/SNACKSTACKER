import * as THREE from 'three';
import type { EnvBuildCtx, FoodBuildCtx, FoodDef, ThemeDef } from '../content/api';
import { roundedBox } from '../content/kit';
import { Emitter } from '../core/events';
import { bounceEnvelope, clamp, clamp01, lerp } from '../core/math';
import { Rng } from '../core/rng';
import type { QualityTier } from '../core/types';
import type { MaterialLibrary } from '../render/api';
import type { VfxSystem } from '../vfx/api';
import type { AudioEngine } from '../audio/api';
import { CameraRig } from './CameraRig';
import { TUNING, type Axis, otherAxis } from './constants';
import { Offcuts, disposeTree } from './Offcuts';
import { sliceLayer, slidePosition } from './slice';
import {
  createScoreState,
  milestoneFor,
  normalPoints,
  perfectLabel,
  perfectPoints,
  perfectTier,
  type ScoreState,
} from './scoring';

export type GameState = 'idle' | 'attract' | 'ready' | 'playing' | 'toppling' | 'over';

export interface RunSummary {
  score: number;
  layers: number;
  perfects: number;
  bestCombo: number;
  heightCm: number;
}

export type GameEvents = {
  started: void;
  score: { score: number; delta: number; pop: boolean };
  combo: number;
  perfect: { label: string; tier: number; combo: number };
  milestone: { title: string; sub: string };
  layer: { layers: number; height: number };
  intensity: number;
  gameover: RunSummary;
  firstDrop: void;
};

interface TowerLayer {
  index: number;
  food: FoodDef;
  object: THREE.Object3D;
  width: number;
  depth: number;
  height: number;
  x: number;
  z: number;
  /** World y of the layer's underside. */
  y: number;
  squash: number;
  squashing: boolean;
}

interface MovingLayer {
  index: number;
  food: FoodDef;
  object: THREE.Object3D;
  width: number;
  depth: number;
  height: number;
  axis: Axis;
  x: number;
  z: number;
  y: number;
  phase: number;
}

export interface StackGameDeps {
  scene: THREE.Scene;
  rig: CameraRig;
  materials: MaterialLibrary;
  vfx: VfxSystem;
  audio: AudioEngine;
  quality: QualityTier;
  shake(magnitude: number, duration?: number): void;
  flash(amount: number): void;
}

const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();

export class StackGame {
  readonly events = new Emitter<GameEvents>();

  private root = new THREE.Group();
  private layers: TowerLayer[] = [];
  private moving: MovingLayer | null = null;
  private plate: THREE.Object3D | null = null;
  private scenery: THREE.Object3D | null = null;

  private theme: ThemeDef | null = null;
  private state: GameState = 'idle';
  private score: ScoreState = createScoreState();
  private runRng = new Rng(1);
  /** Stable per-run seed for layer geometry, independent of draw order. */
  private runSeed = 1;

  private footprintX = TUNING.BASE_FOOTPRINT;
  private footprintZ = TUNING.BASE_FOOTPRINT;
  private topY = 0;
  private nextAxis: Axis = 'x';
  private spawnCooldown = 0;
  private overTimer = 0;
  private hasDropped = false;
  private offcuts: Offcuts;

  constructor(private deps: StackGameDeps) {
    this.offcuts = new Offcuts(deps.scene);
    deps.scene.add(this.root);
  }

  get phase(): GameState {
    return this.state;
  }

  get layerCount(): number {
    return this.layers.length;
  }

  /** Live ballistic debris, for the leak harness. */
  get debrisCount(): number {
    return this.offcuts.count;
  }

  get currentTheme(): ThemeDef | null {
    return this.theme;
  }

  /**
   * Signed misalignment of the sliding layer against the tower top, on the
   * active axis; null when nothing is sliding. Exposed so automated play (the
   * screenshot harness) can time a drop instead of tapping blind.
   */
  get dropOffset(): number | null {
    if (this.state !== 'playing' || !this.moving) return null;
    const top = this.layers[this.layers.length - 1];
    if (!top) return null;
    return this.moving.axis === 'x' ? this.moving.x - top.x : this.moving.z - top.z;
  }

  // -------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------

  setTheme(theme: ThemeDef): void {
    this.theme = theme;
  }

  /** Build the plate + a short pre-stacked tower and orbit it. */
  attract(): void {
    this.teardownTower();
    this.state = 'attract';
    if (!this.theme) return;
    this.buildPlate();

    const showcase = Math.min(6, this.theme.foods.length);
    const order = this.heroOrder(showcase);
    for (let i = 0; i < showcase; i++) {
      const food = order[i];
      const height = food.thickness;
      const object = this.buildFood(food, TUNING.BASE_FOOTPRINT, TUNING.BASE_FOOTPRINT, height, i, false);
      object.position.set(0, this.topY, 0);
      this.root.add(object);
      this.layers.push({
        index: i,
        food,
        object,
        width: TUNING.BASE_FOOTPRINT,
        depth: TUNING.BASE_FOOTPRINT,
        height,
        x: 0,
        z: 0,
        y: this.topY,
        squash: 0,
        squashing: false,
      });
      this.topY += height;
    }
    this.deps.rig.setTop(this.topY * 0.5, true);
    this.deps.rig.setOrbit(0.22);
    // miss() pushes the camera back to show the finished tower; without this
    // the home screen inherits that lift for the rest of the session.
    this.deps.rig.setLift(0);
    this.deps.rig.snap();
  }

  /** Reset to a fresh run and spawn the first sliding layer. */
  start(): void {
    this.teardownTower();
    if (!this.theme) throw new Error('StackGame.start() before setTheme()');

    this.state = 'ready';
    this.score = createScoreState();
    this.runSeed = (Date.now() ^ 0x9e3779b9) >>> 0;
    this.runRng = new Rng(this.runSeed);
    this.footprintX = TUNING.BASE_FOOTPRINT;
    this.footprintZ = TUNING.BASE_FOOTPRINT;
    this.topY = 0;
    this.nextAxis = 'x';
    this.hasDropped = false;
    this.overTimer = 0;

    this.buildPlate();

    // The base layer is placed for free so the player always has something to
    // aim at — a stacker that starts on an empty plate feels unfair.
    const food = this.foodFor(0);
    const height = food.thickness;
    const object = this.buildFood(food, this.footprintX, this.footprintZ, height, 0, false);
    object.position.set(0, 0, 0);
    this.root.add(object);
    this.layers.push({
      index: 0,
      food,
      object,
      width: this.footprintX,
      depth: this.footprintZ,
      height,
      x: 0,
      z: 0,
      y: 0,
      squash: 0,
      squashing: false,
    });
    this.topY = height;

    this.deps.rig.setOrbit(0);
    this.deps.rig.snapOrbit();
    this.deps.rig.setLift(0);
    this.deps.rig.setTop(this.topY, true);
    this.deps.rig.snap();

    this.spawnMoving();
    this.state = 'playing';
    this.events.emit('started', undefined);
    this.events.emit('score', { score: 0, delta: 0, pop: false });
    this.events.emit('combo', 0);
    this.events.emit('intensity', 0);
  }

  stop(): void {
    this.state = 'idle';
    this.teardownTower();
  }

  // -------------------------------------------------------------------------
  // input
  // -------------------------------------------------------------------------

  /** @returns true when the input was taken; false when it was ignored. */
  drop(): boolean {
    if (this.state !== 'playing' || !this.moving || this.spawnCooldown > 0) return false;
    const moving = this.moving;
    const top = this.layers[this.layers.length - 1];
    const axis = moving.axis;

    const prevCenter = axis === 'x' ? top.x : top.z;
    const prevSize = axis === 'x' ? top.width : top.depth;
    const curCenter = axis === 'x' ? moving.x : moving.z;

    if (!this.hasDropped) {
      this.hasDropped = true;
      this.events.emit('firstDrop', undefined);
    }

    const cut = sliceLayer(prevCenter, prevSize, curCenter, {
      tolerance: TUNING.PERFECT_TOLERANCE,
      regrow: TUNING.PERFECT_REGROW,
      maxSize: TUNING.BASE_FOOTPRINT,
      minSize: TUNING.MIN_FOOTPRINT,
    });

    if (cut.kind === 'miss') {
      this.miss(moving);
      return true;
    }

    // Rebuild the kept portion at its cut size. We never boolean-slice — the
    // food is regenerated, so a narrow cut reads as a genuine cross-section.
    const keptWidth = axis === 'x' ? cut.keptSize : moving.width;
    const keptDepth = axis === 'z' ? cut.keptSize : moving.depth;
    this.root.remove(moving.object);
    disposeTree(moving.object);

    const kept = this.buildFood(
      moving.food,
      keptWidth,
      keptDepth,
      moving.height,
      moving.index,
      false,
    );
    const keptX = axis === 'x' ? cut.keptCenter : moving.x;
    const keptZ = axis === 'z' ? cut.keptCenter : moving.z;
    kept.position.set(keptX, moving.y, keptZ);
    this.root.add(kept);

    const layer: TowerLayer = {
      index: moving.index,
      food: moving.food,
      object: kept,
      width: keptWidth,
      depth: keptDepth,
      height: moving.height,
      x: keptX,
      z: keptZ,
      y: moving.y,
      squash: 0,
      squashing: true,
    };
    this.layers.push(layer);
    this.footprintX = keptWidth;
    this.footprintZ = keptDepth;
    this.topY = moving.y + moving.height;
    this.moving = null;

    if (cut.kind === 'perfect') this.onPerfect(layer);
    else this.onSliced(layer, moving, axis, cut.cutSize, cut.cutCenter, cut.cutSign);

    this.score.layers = this.layers.length - 1;
    this.events.emit('layer', { layers: this.score.layers, height: this.topY });
    this.events.emit(
      'intensity',
      clamp01(this.score.layers / 45) * 0.85 + clamp01(this.score.combo / 12) * 0.15,
    );

    const milestone = milestoneFor(this.score.layers);
    if (milestone) {
      this.events.emit('milestone', milestone);
      this.deps.audio.play('milestone');
      this.deps.vfx.confetti(
        tmpVec.set(0, this.topY + 2.5, 0),
        [moving.food.tint, this.theme?.palette.accent ?? 0xffffff, moving.food.tintAlt ?? 0xffffff],
      );
    }

    this.spawnCooldown = TUNING.SPAWN_DELAY;
    this.deps.rig.setTop(this.topY);
    return true;
  }

  private onPerfect(layer: TowerLayer): void {
    this.score.combo++;
    this.score.perfects++;
    this.score.bestCombo = Math.max(this.score.bestCombo, this.score.combo);
    const points = perfectPoints(this.score.combo);
    this.score.score += points;
    const tier = perfectTier(this.score.combo);

    this.events.emit('score', { score: this.score.score, delta: points, pop: true });
    this.events.emit('combo', this.score.combo);
    this.events.emit('perfect', {
      label: perfectLabel(this.score.combo),
      tier,
      combo: this.score.combo,
    });

    this.deps.audio.play('drop', { pitch: 2, gain: 0.8 });
    this.deps.audio.play('perfect', { gain: 0.9 });
    this.deps.audio.playComboNote(this.score.combo);

    tmpVec.set(layer.x, layer.y + layer.height * 0.5, layer.z);
    this.deps.vfx.perfect(tmpVec, layer.food.tint, tier);
    tmpVec2.set(layer.x, layer.y + layer.height + 0.45, layer.z);
    this.deps.vfx.popText(tmpVec2, `+${points}`, this.theme?.palette.accent ?? 0xffffff);
    this.deps.shake(0.05 + tier * 0.025, 0.22);
    this.deps.flash(0.25 + tier * 0.12);
  }

  private onSliced(
    layer: TowerLayer,
    moving: MovingLayer,
    axis: Axis,
    cutSize: number,
    cutCenter: number,
    sign: 1 | -1,
  ): void {
    this.score.combo = 0;
    const points = normalPoints(this.score.layers);
    this.score.score += points;
    this.events.emit('score', { score: this.score.score, delta: points, pop: false });
    this.events.emit('combo', 0);

    const offWidth = axis === 'x' ? cutSize : moving.width;
    const offDepth = axis === 'z' ? cutSize : moving.depth;

    if (cutSize > 0.02) {
      const scrap = this.buildFood(
        moving.food,
        offWidth,
        offDepth,
        moving.height,
        moving.index,
        true,
      );
      tmpVec.set(
        axis === 'x' ? cutCenter : moving.x,
        moving.y,
        axis === 'z' ? cutCenter : moving.z,
      );
      this.offcuts.spawn(scrap, {
        position: tmpVec,
        velocity: this.offcuts.kickFor(axis, sign, clamp(cutSize / 0.8, 0.4, 1.4)),
      });
    }

    this.deps.audio.play('drop', { gain: 0.9 });
    if (cutSize > 0.06) this.deps.audio.play('slice', { gain: clamp(cutSize, 0.25, 1) });

    // Crumbs spray from the cut face, not from the centre of the layer.
    const edge = (axis === 'x' ? layer.x : layer.z) + (sign * (axis === 'x' ? layer.width : layer.depth)) / 2;
    tmpVec.set(
      axis === 'x' ? edge : layer.x,
      layer.y + layer.height * 0.4,
      axis === 'z' ? edge : layer.z,
    );
    tmpVec2.set(axis === 'x' ? sign : 0, 0.35, axis === 'z' ? sign : 0);
    this.deps.vfx.burst({
      position: tmpVec,
      color: layer.food.tint,
      colorAlt: layer.food.tintAlt,
      direction: tmpVec2,
      count: Math.round(clamp(cutSize * 22, 6, 26)),
      power: 1 + cutSize * 0.6,
    });
    this.deps.shake(0.02 + Math.min(cutSize, 0.6) * 0.04, 0.16);
  }

  private miss(moving: MovingLayer): void {
    this.root.remove(moving.object);
    tmpVec.set(moving.x, moving.y, moving.z);
    const dir = moving.axis === 'x' ? Math.sign(moving.x) || 1 : Math.sign(moving.z) || 1;
    this.offcuts.spawn(moving.object, {
      position: tmpVec,
      velocity: this.offcuts.kickFor(moving.axis, dir, 1.1),
    });
    this.moving = null;
    this.score.combo = 0;
    this.events.emit('combo', 0);

    this.deps.audio.play('fall');
    this.deps.audio.play('fail', { delay: 0.18 });
    this.deps.audio.duck(1.2);
    this.deps.shake(0.12, 0.5);

    this.state = 'toppling';
    this.overTimer = 0;
    // Pull back and turn so the player sees the tower they actually built.
    this.deps.rig.setOrbit(0.35);
    this.deps.rig.setLift(Math.min(this.topY * 0.35, 9));
    this.deps.rig.setTop(this.topY * 0.55);
  }

  // -------------------------------------------------------------------------
  // frame
  // -------------------------------------------------------------------------

  update(dt: number, elapsed: number): void {
    if (this.spawnCooldown > 0) {
      this.spawnCooldown -= dt;
      if (this.spawnCooldown <= 0 && this.state === 'playing' && !this.moving) {
        this.spawnMoving();
      }
    }

    if (this.state === 'playing' && this.moving) {
      const m = this.moving;
      const travel = this.deps.rig.travel;
      const speed = this.speedFor(this.score.layers);
      m.phase += (speed / (2 * travel)) * dt;
      const pos = slidePosition(m.phase, travel);
      if (m.axis === 'x') {
        m.x = pos;
        m.object.position.x = pos;
      } else {
        m.z = pos;
        m.object.position.z = pos;
      }
      // A gentle bob makes the layer feel like it is floating, not sliding on
      // an invisible rail.
      m.object.position.y = m.y + Math.sin(elapsed * 2.4) * 0.035;
    }

    // Landing squash on the most recent layers.
    for (let i = this.layers.length - 1; i >= 0 && i >= this.layers.length - 4; i--) {
      const l = this.layers[i];
      if (!l.squashing) continue;
      l.squash += dt;
      const env = bounceEnvelope(l.squash, TUNING.SQUASH_FREQ, TUNING.SQUASH_DECAY);
      const sy = 1 - env * TUNING.SQUASH;
      const sxz = 1 + env * TUNING.SQUASH * 0.55;
      l.object.scale.set(sxz, sy, sxz);
      if (l.squash > 0.9) {
        l.object.scale.set(1, 1, 1);
        l.squashing = false;
      }
    }

    this.offcuts.update(dt, this.deps.rig.topY);

    if (this.state === 'toppling') {
      this.overTimer += dt;
      if (this.overTimer >= TUNING.GAMEOVER_DELAY) {
        this.state = 'over';
        this.events.emit('gameover', {
          score: this.score.score,
          layers: this.score.layers,
          perfects: this.score.perfects,
          bestCombo: this.score.bestCombo,
          heightCm: Math.round(this.topY * TUNING.CM_PER_UNIT),
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  private speedFor(layers: number): number {
    const t = 1 - Math.exp(-layers / TUNING.SPEED_RAMP);
    return lerp(TUNING.START_SPEED, TUNING.MAX_SPEED, t);
  }

  private spawnMoving(): void {
    if (!this.theme) return;
    const index = this.layers.length;
    const food = this.foodFor(index);
    const height = food.thickness;
    const axis = this.nextAxis;
    this.nextAxis = otherAxis(axis);

    const travelWanted =
      TUNING.TRAVEL +
      TUNING.TRAVEL_GROWTH * (1 - Math.exp(-this.score.layers / TUNING.TRAVEL_RAMP));
    this.deps.rig.requestTravel(travelWanted);
    const travel = this.deps.rig.travel;

    const object = this.buildFood(food, this.footprintX, this.footprintZ, height, index, false);
    const top = this.layers[this.layers.length - 1];
    const startSide = this.runRng.bool() ? 0 : 1;
    const x = axis === 'x' ? (startSide ? travel : -travel) : top.x;
    const z = axis === 'z' ? (startSide ? travel : -travel) : top.z;
    const y = this.topY;
    object.position.set(x, y, z);
    this.root.add(object);

    this.moving = {
      index,
      food,
      object,
      width: this.footprintX,
      depth: this.footprintZ,
      height,
      axis,
      x,
      z,
      y,
      phase: startSide ? 1 : 0,
    };
    this.deps.audio.play('whoosh', { gain: 0.22 });
  }

  /** The bottom-to-top run used for the attract tower. */
  private heroOrder(count: number): FoodDef[] {
    const foods = this.theme!.foods;
    const declared = this.theme!.hero;
    if (declared?.length) {
      const picked = declared
        .map((i) => foods[i])
        .filter((f): f is FoodDef => !!f)
        .slice(0, count);
      if (picked.length) return picked;
    }
    return foods.slice(0, count);
  }

  private foodFor(index: number): FoodDef {
    const foods = this.theme!.foods;
    return foods[index % foods.length];
  }

  private buildCtx(
    width: number,
    depth: number,
    height: number,
    index: number,
    offcut: boolean,
  ): FoodBuildCtx {
    return {
      width: Math.max(width, 0.04),
      depth: Math.max(depth, 0.04),
      height: Math.max(height, 0.04),
      index,
      // Forked from a fixed run seed rather than the live generator: spawning
      // advances runRng, so rebuilding the kept piece on drop used to draw a
      // different stream and visibly re-scattered seeds, flecks and sprinkles
      // in the landing frame.
      rng: new Rng((this.runSeed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0),
      quality: this.deps.quality,
      materials: this.deps.materials,
      offcut,
    };
  }

  /**
   * Content is authored by hand and gets called at extreme aspect ratios, so a
   * throwing or empty build must never kill the run — fall back to a tinted
   * rounded slab that still reads as a layer.
   */
  private buildFood(
    food: FoodDef,
    width: number,
    depth: number,
    height: number,
    index: number,
    offcut: boolean,
  ): THREE.Object3D {
    const ctx = this.buildCtx(width, depth, height, index, offcut);
    try {
      const obj = food.build(ctx);
      if (obj) return obj;
    } catch (err) {
      console.error(`[snackery] food "${food.id}" failed to build`, err);
    }
    return this.fallbackSlab(ctx, food);
  }

  private fallbackSlab(ctx: FoodBuildCtx, food: FoodDef): THREE.Object3D {
    const geo = roundedBox(
      ctx.width,
      ctx.height,
      ctx.depth,
      Math.min(ctx.width, ctx.depth, ctx.height) * 0.18,
      2,
    );
    const mat = this.deps.materials.standard(`fallback.${food.tint.toString(16)}`, {
      color: food.tint,
      roughness: 0.7,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildPlate(): void {
    if (!this.theme) return;
    const width = TUNING.BASE_FOOTPRINT * 1.35;
    const ctx = this.buildCtx(width, width, 0.35, -1, false);
    try {
      this.plate = this.theme.plate(ctx);
      this.root.add(this.plate);
    } catch (err) {
      console.error('[snackery] plate failed to build', err);
      this.plate = null;
    }

    // The table has to meet the underside of whatever plate the theme built —
    // a geta board, a cake stand and an enamel tray are all different depths —
    // so measure it rather than assuming a thickness.
    let tableTopY = -0.35;
    if (this.plate) {
      const box = new THREE.Box3().setFromObject(this.plate);
      if (Number.isFinite(box.min.y)) tableTopY = box.min.y;
    }

    if (this.theme.environment) {
      const envCtx: EnvBuildCtx = {
        tableTopY,
        plateWidth: width,
        baseFootprint: TUNING.BASE_FOOTPRINT,
        rng: this.runRng.fork(9871),
        quality: this.deps.quality,
        materials: this.deps.materials,
      };
      try {
        this.scenery = this.theme.environment(envCtx);
        this.root.add(this.scenery);
      } catch (err) {
        console.error('[snackery] environment failed to build', err);
        this.scenery = null;
      }
    }
  }

  private teardownTower(): void {
    for (const l of this.layers) {
      this.root.remove(l.object);
      disposeTree(l.object);
    }
    this.layers.length = 0;
    if (this.moving) {
      this.root.remove(this.moving.object);
      disposeTree(this.moving.object);
      this.moving = null;
    }
    if (this.plate) {
      this.root.remove(this.plate);
      disposeTree(this.plate);
      this.plate = null;
    }
    if (this.scenery) {
      this.root.remove(this.scenery);
      disposeTree(this.scenery);
      this.scenery = null;
    }
    this.offcuts.clear();
    this.deps.vfx.clear();
    this.topY = 0;
    this.spawnCooldown = 0;
  }

  dispose(): void {
    this.teardownTower();
    this.offcuts.dispose();
    this.deps.scene.remove(this.root);
    this.events.clear();
  }
}
