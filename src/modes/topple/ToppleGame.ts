/**
 * TOPPLE — how high can you stack before it falls?
 *
 * The stacker's tower is kinematic: layers are cut and placed and nothing ever
 * moves again. This one is the opposite. Every food is a real rigid body on a
 * real plate, and the tower does exactly what weight and friction say it does:
 * it wobbles, it settles, it develops a lean, and eventually it goes over.
 *
 * The rules are written out in `tuning.ts`. The short version: a food swings
 * above the tower, you tap to drop it, the tower reacts, and the next food does
 * not arrive until the tower is quiet again. A marker on the tower's top face
 * shows exactly where the food will land — drift included — so the tension is
 * about balance and nerve, never about a hidden number.
 */
import * as THREE from 'three';
import type { EnvBuildCtx, FoodBuildCtx, FoodDef, ThemeDef } from '../../content/api';
import { roundedBox } from '../../content/kit';
import { Emitter } from '../../core/events';
import { TAU, clamp, clamp01 } from '../../core/math';
import { Rng } from '../../core/rng';
import { disposeTree } from '../../game/Offcuts';
import { TUNING } from '../../game/constants';
import type { ModeCtx, ModeEvents } from '../api';
import { bakeFood } from './bake';
import { LandingMarker } from './marker';
import { BODY_DYNAMIC, BODY_STATIC, Body, PhysicsWorld } from './physics';
import {
  TOPPLE,
  footprintFor,
  plumbLabel,
  plumbTier,
  swingAmplitude,
  swingPeriod,
} from './tuning';

type Phase = 'idle' | 'attract' | 'aiming' | 'settling' | 'gap' | 'collapsing' | 'over';

interface Item {
  index: number;
  /** Mirrors the meshes' castShadow flag so the LOD pass can skip untouched items. */
  casting: boolean;
  food: FoodDef;
  object: THREE.Object3D;
  body: Body;
  /** Half extents of the collision hull. */
  hw: number;
  hh: number;
  hd: number;
  yaw: number;
  placed: boolean;
  prevSpeed: number;
}

interface Hover {
  index: number;
  food: FoodDef;
  object: THREE.Object3D;
  width: number;
  depth: number;
  height: number;
  yaw: number;
  /** 0 swings along X, 1 swings along Z. */
  axis: 0 | 1;
  amp: number;
  omega: number;
  /** Centre of the swing, tracked to the top of the tower so a lean stays playable. */
  anchorX: number;
  anchorZ: number;
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

export class ToppleGame {
  readonly events = new Emitter<ModeEvents>();

  private readonly root = new THREE.Group();
  private readonly world: PhysicsWorld;
  private readonly marker: LandingMarker;
  private readonly items: Item[] = [];

  private theme: ThemeDef;
  private phase: Phase = 'idle';
  private hover: Hover | null = null;
  private plate: THREE.Object3D | null = null;
  private scenery: THREE.Object3D | null = null;

  private plateRadius = 1;
  private tableTopY = -0.35;

  // --- run state -------------------------------------------------------------
  private runSeed = 1;
  private runRng = new Rng(1);
  private score = 0;
  private combo = 0;
  private bestCombo = 0;
  private plumbs = 0;
  private bestPeak = 0;
  private leanAtRelease = 0;
  private hasActed = false;
  private course = 0;

  // --- clocks ----------------------------------------------------------------
  private accumulator = 0;
  private simTime = 0;
  private wallTime = 0;
  private settleTimer = 0;
  private collapseTimer = 0;
  private gapTimer = 0;
  private lastRelease = -10;
  private swingPhase = 0;
  private pendingRelease = false;
  private impactCooldown = 0;
  private creakCooldown = 0;
  private dustBudget = 0;
  private collapseAnnounced = false;
  private collapseFailPlayed = false;
  private loggedFault = false;

  constructor(private readonly ctx: ModeCtx) {
    this.theme = ctx.theme;
    this.world = new PhysicsWorld({
      gravity: TOPPLE.GRAVITY,
      velocityIterations: TOPPLE.VEL_ITERS,
      positionIterations: TOPPLE.POS_ITERS,
    });
    this.root.name = 'topple.root';
    this.marker = new LandingMarker(ctx.materials, ctx.theme.palette);
    this.marker.root.name = 'topple.marker';
    this.root.add(this.marker.root);
    ctx.scene.add(this.root);
  }

  // ===========================================================================
  // lifecycle
  // ===========================================================================

  setTheme(theme: ThemeDef): void {
    this.theme = theme;
    this.marker.setPalette(theme.palette);
    if (this.phase === 'attract') this.attract();
  }

  /** A short, believably settled tower for the home screen. */
  attract(): void {
    this.teardown();
    this.phase = 'attract';
    this.runSeed = 0x51ac1e;
    this.runRng = new Rng(this.runSeed);
    this.buildStage();

    const foods = this.heroOrder(TOPPLE.ATTRACT_ITEMS);
    let y = 0;
    for (let i = 0; i < foods.length; i++) {
      const width = footprintFor(i);
      const depth = width * TOPPLE.DEPTH_RATIO;
      const height = foods[i].thickness;
      const yaw = (i % 2) * Math.PI * 0.5;
      // A hair of scatter so the attract tower reads as stacked, not extruded.
      const jx = this.runRng.signed() * 0.05;
      const jz = this.runRng.signed() * 0.05;
      this.addItem(foods[i], i, width, depth, height, yaw, jx, y + height * 0.5 + 0.01, jz, 0, 0);
      y += height;
    }
    // Let it find its own pose rather than authoring one.
    for (let i = 0; i < Math.round(1.2 / TOPPLE.STEP); i++) this.world.step(TOPPLE.STEP);
    for (const it of this.items) {
      it.placed = true;
      this.syncItem(it, 1);
    }

    const peak = this.peakY();
    this.ctx.rig.setTop(peak * 0.5, true);
    this.ctx.rig.setOrbit(0.22);
    this.ctx.rig.setLift(0);
    this.ctx.rig.snap();
  }

  start(): void {
    this.teardown();
    // Seeded from the host's generator, so a host that wants a reproducible
    // run only has to hand this mode a reproducible Rng.
    this.runSeed = (this.ctx.rng.next() * 0xffffffff) >>> 0;
    this.runRng = new Rng(this.runSeed);
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.plumbs = 0;
    this.course = 0;
    this.hasActed = false;
    this.simTime = 0;
    this.accumulator = 0;
    this.lastRelease = -10;
    this.collapseAnnounced = false;
    this.collapseFailPlayed = false;

    this.buildStage();

    // The first food is placed free and centred: a physics stacker that starts
    // on bare porcelain is not a game, it is a coin toss.
    const food = this.foodFor(0);
    const width = footprintFor(0);
    const depth = width * TOPPLE.DEPTH_RATIO;
    const it = this.addItem(food, 0, width, depth, food.thickness, 0, 0, food.thickness * 0.5, 0, 0, 0);
    it.placed = true;
    this.syncItem(it, 1);
    this.bestPeak = this.peakY();

    this.ctx.rig.setOrbit(0);
    this.ctx.rig.snapOrbit();
    this.ctx.rig.setLift(0);
    this.ctx.rig.setTop(this.bestPeak, true);
    this.ctx.rig.snap();

    this.spawnHover();
    this.phase = 'aiming';

    this.events.emit('score', { score: 0, delta: 0, pop: false });
    this.events.emit('combo', 0);
    this.events.emit('intensity', 0);
    this.emitProgress();
  }

  stop(): void {
    this.phase = 'idle';
    this.teardown();
  }

  dispose(): void {
    this.teardown();
    this.marker.dispose();
    this.ctx.scene.remove(this.root);
    this.events.clear();
  }

  /**
   * A read-only window on the run, for tooling: the dev harness's auto-player
   * and the screenshot rig use it to release at a sensible moment instead of
   * tapping blind. Nothing in the game reads it.
   */
  get debug(): {
    phase: string;
    items: number;
    peak: number;
    lean: number;
    /** Predicted landing on the swing axis, drift included. */
    predicted: number;
    /** Where the food below sits on that axis. */
    target: number;
    axis: 0 | 1;
    settled: boolean;
  } {
    const hv = this.hover;
    const top = this.items[this.items.length - 1];
    let predicted = 0;
    let target = 0;
    if (hv) {
      const swing = hv.amp * Math.sin(this.swingPhase);
      const swingVel = hv.amp * hv.omega * Math.cos(this.swingPhase);
      const fall = Math.sqrt((2 * TOPPLE.DROP_GAP) / -TOPPLE.GRAVITY);
      const anchor = hv.axis === 0 ? hv.anchorX : hv.anchorZ;
      predicted = anchor + swing + swingVel * TOPPLE.VEL_CARRY * fall;
      target = top ? (hv.axis === 0 ? top.body.px : top.body.pz) : 0;
    }
    return {
      phase: this.phase,
      items: this.items.length,
      peak: this.peakY(),
      lean: this.lean(),
      predicted,
      target,
      axis: hv ? hv.axis : 0,
      settled: this.world.settled,
    };
  }

  // ===========================================================================
  // input
  // ===========================================================================

  tap(): boolean {
    if (this.phase !== 'aiming' || !this.hover || this.pendingRelease) return false;
    // Consumed on the next fixed step, so a release always lands on the same
    // simulation boundary regardless of frame rate.
    this.pendingRelease = true;
    return true;
  }

  // ===========================================================================
  // frame
  // ===========================================================================

  update(dt: number, elapsed: number): void {
    this.wallTime += dt;
    if (this.phase === 'idle') return;

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= TOPPLE.STEP && steps < TOPPLE.MAX_SUBSTEPS) {
      this.fixedStep();
      this.accumulator -= TOPPLE.STEP;
      steps++;
    }
    // Never let a backlog build: a stalled tab must resume in real time, not
    // fast-forward a second of physics into one frame.
    if (steps >= TOPPLE.MAX_SUBSTEPS) this.accumulator = 0;

    const alpha = clamp01(this.accumulator / TOPPLE.STEP);
    for (let i = 0; i < this.items.length; i++) this.syncItem(this.items[i], alpha);

    this.present(dt, elapsed);
  }

  private fixedStep(): void {
    const h = TOPPLE.STEP;
    this.simTime += h;
    if (this.impactCooldown > 0) this.impactCooldown -= h;
    if (this.creakCooldown > 0) this.creakCooldown -= h;

    if (this.pendingRelease && this.phase === 'aiming' && this.hover) {
      this.pendingRelease = false;
      this.release();
    }

    if (this.phase === 'aiming' && this.hover) {
      this.swingPhase += this.hover.omega * h;
      if (this.swingPhase > TAU) this.swingPhase -= TAU;
    }

    this.world.step(h);
    this.scanImpacts();

    if (this.world.faulted && !this.loggedFault) {
      // A non-finite body is already rolled back by the integrator; a run that
      // hit one is no longer trustworthy, so end it cleanly instead of playing on.
      this.loggedFault = true;
      console.error('[topple] physics fault — ending the run');
      if (this.phase === 'aiming' || this.phase === 'settling') this.collapse();
    }

    if (this.phase === 'aiming' || this.phase === 'settling' || this.phase === 'gap') {
      if (!this.checkFailure()) {
        if (this.phase === 'settling') {
          this.settleTimer += h;
          const quiet = this.world.settled;
          if (
            this.settleTimer >= TOPPLE.SETTLE_MIN &&
            (quiet || this.settleTimer >= TOPPLE.SETTLE_MAX)
          ) {
            this.acceptPlacement();
          }
        } else if (this.phase === 'gap') {
          this.gapTimer += h;
          if (this.gapTimer >= TOPPLE.SPAWN_DELAY) {
            this.spawnHover();
            this.phase = 'aiming';
          }
        }
      }
    } else if (this.phase === 'collapsing') {
      this.collapseTimer += h;
      this.collapseBeats();
    }
  }

  // ===========================================================================
  // placement
  // ===========================================================================

  private spawnHover(): void {
    const index = this.items.length;
    const food = this.foodFor(index);
    const width = footprintFor(index);
    const depth = width * TOPPLE.DEPTH_RATIO;
    const height = food.thickness;
    const yaw = (index % 2) * Math.PI * 0.5;
    const object = this.buildFood(food, width, depth, height, index);
    object.name = 'topple.item';
    this.root.add(object);

    const top = this.highestItem();
    const limit = this.plateRadius * 0.45;
    const anchorX = top ? clamp(top.body.px, -limit, limit) : 0;
    const anchorZ = top ? clamp(top.body.pz, -limit, limit) : 0;
    const amp = swingAmplitude(index);

    this.hover = {
      index,
      food,
      object,
      width,
      depth,
      height,
      yaw,
      axis: index % 2 === 0 ? 0 : 1,
      amp,
      omega: TAU / swingPeriod(index),
      anchorX,
      anchorZ,
    };
    // Always begin at an extreme of the swing: the food arrives calm, and the
    // first beat of every placement is readable.
    this.swingPhase = this.runRng.bool() ? Math.PI * 0.5 : Math.PI * 1.5;
    // The rig always looks down the world Y axis, so a tower that has walked
    // sideways needs the camera pulled back by that much again or the swing
    // leaves the frame. Ask for the travel the SHOT needs, not the swing's.
    const offAxis = Math.abs(index % 2 === 0 ? anchorX : anchorZ);
    this.ctx.rig.requestTravel(amp + width * 0.62 + offAxis);
    this.ctx.audio.play('whoosh', { gain: 0.16 });
  }

  private release(): void {
    const hv = this.hover;
    if (!hv) return;
    const topY = this.peakY();
    const swing = hv.amp * Math.sin(this.swingPhase);
    const swingVel = hv.amp * hv.omega * Math.cos(this.swingPhase);
    const carried = swingVel * TOPPLE.VEL_CARRY;
    const bank = -clamp(swingVel / (hv.amp * hv.omega), -1, 1) * TOPPLE.BANK_MAX;

    const x = hv.axis === 0 ? hv.anchorX + swing : hv.anchorX;
    const z = hv.axis === 1 ? hv.anchorZ + swing : hv.anchorZ;
    const cy = topY + TOPPLE.DROP_GAP + hv.height * 0.5;

    this.orientation(hv.yaw, hv.axis, bank, tmpQ);

    this.root.remove(hv.object);
    const it = this.addItem(
      hv.food,
      hv.index,
      hv.width,
      hv.depth,
      hv.height,
      hv.yaw,
      x,
      cy,
      z,
      hv.axis === 0 ? carried : 0,
      hv.axis === 1 ? carried : 0,
      hv.object,
      tmpQ,
    );
    it.body.vy = -0.3;

    this.hover = null;
    this.marker.hide();
    this.leanAtRelease = this.lean();
    this.phase = 'settling';
    this.settleTimer = 0;
    this.lastRelease = this.simTime;
    this.ctx.audio.play('whoosh', { gain: 0.2, pitch: 5 });

    if (!this.hasActed) {
      this.hasActed = true;
      this.events.emit('firstAction', undefined);
    }
  }

  private acceptPlacement(): void {
    const it = this.items[this.items.length - 1];
    if (!it) return;
    it.placed = true;
    const below = this.highestItem(it);
    const dx = it.body.px - (below ? below.body.px : 0);
    const dz = it.body.pz - (below ? below.body.pz : 0);
    const offset = Math.sqrt(dx * dx + dz * dz);

    // Did it actually land ON the tower? A food that slid down the side and
    // came to rest on the plate is a miss: it must not score, or dropping every
    // food on the floor would be a legitimate strategy.
    const onTower = it.body.py > this.bestPeak - TOPPLE.MISS_DEPTH;
    const plumb = onTower && offset <= TOPPLE.PLUMB_TOL;

    let points = onTower ? TOPPLE.SCORE_BASE + TOPPLE.SCORE_PER_ITEM * it.index : 0;
    if (plumb) {
      this.combo = Math.min(this.combo + 1, TOPPLE.COMBO_CAP);
      this.plumbs++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      points += TOPPLE.SCORE_PLUMB * this.combo;
    } else {
      this.combo = 0;
    }

    // The counterweight play: the tower was leaning, and this placement pulled
    // its centre of mass back towards the plate. It is the one move that lets a
    // bad run be rescued by skill, so it is worth celebrating loudly.
    const leanNow = this.lean();
    const rescued =
      onTower &&
      this.leanAtRelease > TOPPLE.LEAN_DANGER &&
      leanNow < this.leanAtRelease - 0.06;
    if (rescued) points += TOPPLE.SCORE_COUNTERWEIGHT;

    this.score += points;
    this.bestPeak = this.peakY();

    this.events.emit('score', { score: this.score, delta: points, pop: plumb || rescued });
    this.events.emit('combo', this.combo);
    this.emitProgress();
    this.events.emit(
      'intensity',
      clamp01(clamp01(it.index / 26) * 0.68 + leanNow * 0.32),
    );

    const accent = this.theme.palette.accent;
    tmpV.set(it.body.px, it.body.py + it.hh, it.body.pz);
    if (plumb) {
      const tier = plumbTier(this.combo);
      this.events.emit('praise', { label: plumbLabel(this.combo), tier });
      this.ctx.audio.play('perfect', { gain: 0.85 });
      this.ctx.audio.playComboNote(this.combo);
      this.ctx.vfx.perfect(tmpV, it.food.tint, tier);
      this.ctx.flash(0.2 + tier * 0.1);
      this.ctx.shake(0.035 + tier * 0.02, 0.2);
    } else if (rescued) {
      this.events.emit('praise', { label: 'COUNTERWEIGHT', tier: 2 });
      this.ctx.audio.play('combo', { gain: 0.8 });
      this.ctx.vfx.sparkle({ position: tmpV, color: accent, count: 18, power: 1.1 });
    } else if (!onTower) {
      // No praise for a miss — the silence and the flat score are the message.
      this.ctx.audio.play('fall', { gain: 0.7 });
      this.ctx.audio.play('slice', { gain: 0.3, pitch: -6 });
    }
    tmpV2.set(it.body.px, it.body.py + it.hh + 0.42, it.body.pz);
    if (points > 0 && (plumb || rescued)) {
      this.ctx.vfx.popText(tmpV2, `+${points}`, accent);
    }

    const placedCount = this.items.length - 1;
    if (onTower && placedCount > 0 && placedCount % TOPPLE.COURSE_LENGTH === 0) {
      this.course++;
      const cm = Math.round(this.bestPeak * TUNING.CM_PER_UNIT);
      this.events.emit('milestone', { title: `COURSE ${this.course + 1}`, sub: `${cm} cm and holding` });
      this.ctx.audio.play('milestone');
      tmpV.set(0, this.bestPeak + 1.6, 0);
      this.ctx.vfx.confetti(tmpV, [
        it.food.tint,
        accent,
        it.food.tintAlt ?? this.theme.palette.accentSoft,
      ]);
    }

    this.updateShadowLod(false);

    // A beat before the next food arrives: the camera catches up, the player
    // reads the new lean, and the run gets a rhythm instead of a treadmill.
    this.gapTimer = 0;
    this.phase = 'gap';
  }

  /**
   * Turn off shadow casting for layers buried inside the tower. Purely a draw
   * call saving — a layer with food above and below it casts nothing visible.
   * Everything switches back on for a collapse, where every piece is airborne.
   */
  private updateShadowLod(all: boolean): void {
    const depth = TOPPLE.SHADOW_DEPTH[this.ctx.quality];
    const cut = this.peakY() - depth;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const want = all || it.body.topY >= cut;
      if (want === it.casting) continue;
      it.casting = want;
      it.object.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = want;
      });
    }
  }

  // ===========================================================================
  // failure
  // ===========================================================================

  private checkFailure(): boolean {
    if (this.simTime - this.lastRelease < TOPPLE.GRACE) return false;
    const peak = this.peakY();
    if (this.bestPeak - peak > TOPPLE.COLLAPSE_DROP) {
      this.collapse();
      return true;
    }
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].body.py < TOPPLE.OFF_PLATE_Y) {
        this.collapse();
        return true;
      }
    }
    return false;
  }

  /**
   * The money moment. Detection, then: sting, shake, flash, a shockwave, the
   * camera falling back into a slow orbit — and then the physics simply keeps
   * running, because the best part is that the tower really does fall over.
   */
  private collapse(): void {
    if (this.phase === 'collapsing' || this.phase === 'over') return;
    this.phase = 'collapsing';
    this.collapseTimer = 0;
    this.dustBudget = this.ctx.quality === 'low' ? 6 : TOPPLE.MAX_COLLAPSE_DUST;
    this.combo = 0;
    this.world.wake();
    this.marker.hide();
    this.updateShadowLod(true);

    if (this.hover) {
      this.root.remove(this.hover.object);
      disposeTree(this.hover.object);
      this.hover = null;
    }

    const palette = this.theme.palette;
    this.ctx.audio.play('collapse');
    this.ctx.audio.duck(1.9);
    this.ctx.shake(0.34, 0.8);
    this.ctx.flash(0.55);
    tmpV.set(0, Math.max(this.bestPeak * 0.45, 0.4), 0);
    this.ctx.vfx.ring({
      position: tmpV,
      color: palette.accent,
      radius: 1.5,
      thickness: 0.14,
      life: 0.7,
      orientation: 'billboard',
    });

    this.events.emit('combo', 0);
    this.events.emit('intensity', 1);

    this.ctx.rig.setOrbit(0.3);
    this.ctx.rig.setLift(Math.min(this.bestPeak * 0.5, 9));
    this.ctx.rig.setTop(this.bestPeak * 0.45);
  }

  private collapseBeats(): void {
    const t = this.collapseTimer;
    if (!this.collapseAnnounced && t >= 0.3) {
      this.collapseAnnounced = true;
      const cm = Math.round(this.bestPeak * TUNING.CM_PER_UNIT);
      tmpV.set(0, this.bestPeak + 0.8, 0);
      this.ctx.vfx.popText(tmpV, `${cm} cm`, this.theme.palette.accent);
    }
    if (!this.collapseFailPlayed && t >= 0.9) {
      this.collapseFailPlayed = true;
      this.ctx.audio.play('fail', { gain: 0.75 });
    }
    if (t >= TOPPLE.COLLAPSE_TO_RESULT) {
      this.phase = 'over';
      this.events.emit('over', {
        score: this.score,
        count: Math.round(this.bestPeak * TUNING.CM_PER_UNIT),
        countLabel: 'Height',
        perfects: this.plumbs,
        bestCombo: this.bestCombo,
        heightCm: Math.round(this.bestPeak * TUNING.CM_PER_UNIT),
      });
    }
  }

  // ===========================================================================
  // impacts
  // ===========================================================================

  /**
   * Impacts are detected from the speed a body loses in one step rather than
   * from contact impulse: at rest the bottom of a twenty-slab tower carries an
   * enormous impulse every step just holding the tower up, so impulse alone
   * cannot tell "landed" from "load-bearing".
   */
  private scanImpacts(): void {
    const collapsing = this.phase === 'collapsing';
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const b = it.body;
      const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
      const lost = it.prevSpeed - sp;
      it.prevSpeed = sp;
      if (lost < TOPPLE.IMPACT_SPEED) continue;
      if (collapsing) this.collapseImpact(it, lost);
      else this.landingImpact(it, lost);
    }
  }

  private landingImpact(it: Item, strength: number): void {
    if (this.impactCooldown > 0) return;
    this.impactCooldown = 0.05;
    const s = clamp01(strength / 4.5);
    this.ctx.audio.play('drop', { gain: 0.45 + s * 0.5, pitch: clamp(4 - it.index * 0.12, -6, 4) });
    tmpV.set(it.body.px, it.body.py - it.hh, it.body.pz);
    this.ctx.vfx.burst({
      position: tmpV,
      color: it.food.tint,
      colorAlt: it.food.tintAlt,
      count: this.ctx.quality === 'low' ? 5 : Math.round(6 + s * 10),
      power: 0.6 + s * 0.7,
      spread: 1,
      scale: 0.8,
    });
    this.ctx.vfx.ring({
      position: tmpV,
      color: this.theme.palette.accentSoft,
      radius: it.hw * 1.6,
      thickness: 0.05,
      life: 0.36,
      orientation: 'flat',
    });
    this.ctx.shake(0.02 + s * 0.05, 0.18);
  }

  private collapseImpact(it: Item, strength: number): void {
    if (this.dustBudget <= 0) return;
    this.dustBudget--;
    const s = clamp01(strength / 6);
    tmpV.set(it.body.px, it.body.py - it.hh * 0.5, it.body.pz);
    this.ctx.vfx.burst({
      position: tmpV,
      color: it.food.tint,
      colorAlt: this.theme.palette.fog,
      count: this.ctx.quality === 'low' ? 6 : Math.round(10 + s * 14),
      power: 0.9 + s,
      spread: 1,
      gravity: 0.4,
      life: 0.9,
      scale: 1.15,
    });
    if (this.collapseTimer < TOPPLE.COLLAPSE_SFX_UNTIL && this.impactCooldown <= 0) {
      this.impactCooldown = 0.055;
      this.ctx.audio.play('drop', {
        gain: 0.3 + s * 0.4,
        pitch: -4 + this.runRng.signed() * 6,
        pan: clamp(it.body.px * 0.3, -0.7, 0.7),
      });
    }
  }

  // ===========================================================================
  // presentation
  // ===========================================================================

  private present(dt: number, elapsed: number): void {
    const rig = this.ctx.rig;
    if (this.phase === 'attract' || this.phase === 'idle') return;

    const peak = this.peakY();
    if (this.phase === 'aiming' || this.phase === 'settling' || this.phase === 'gap') {
      // Bias the framing down a little as the tower grows: in Topple the lean
      // matters as much as the top does, and a lean is only legible if you can
      // see some of the column it is leaning from.
      rig.setTop(peak + 0.2 - Math.min(peak * 0.2, 1.9));
      rig.setLift(Math.min(peak * 0.24, 4.6) + this.lean() * 1.2);
    }

    const hv = this.hover;
    if (hv && this.phase === 'aiming') {
      const swing = hv.amp * Math.sin(this.swingPhase);
      const swingVel = hv.amp * hv.omega * Math.cos(this.swingPhase);
      const bank = -clamp(swingVel / (hv.amp * hv.omega), -1, 1) * TOPPLE.BANK_MAX;
      const x = hv.axis === 0 ? hv.anchorX + swing : hv.anchorX;
      const z = hv.axis === 1 ? hv.anchorZ + swing : hv.anchorZ;
      const baseY = peak + TOPPLE.DROP_GAP;

      this.orientation(hv.yaw, hv.axis, bank, tmpQ);
      hv.object.quaternion.copy(tmpQ);
      // The mesh's origin is its underside; the bank tips it about its centre.
      tmpV.set(0, hv.height * 0.5, 0).applyQuaternion(tmpQ);
      hv.object.position.set(
        x - tmpV.x,
        baseY + hv.height * 0.5 - tmpV.y,
        z - tmpV.z,
      );

      // Predicted landing, drift included — the fairness contract.
      const fall = Math.sqrt((2 * TOPPLE.DROP_GAP) / -TOPPLE.GRAVITY);
      const drift = swingVel * TOPPLE.VEL_CARRY * fall;
      const px = hv.axis === 0 ? x + drift : x;
      const pz = hv.axis === 1 ? z + drift : z;
      const hullW = hv.width * TOPPLE.HULL_INSET;
      const hullD = hv.depth * TOPPLE.HULL_INSET;
      const lean = this.lean();
      this.marker.show(
        px,
        peak,
        pz,
        hullW,
        hullD,
        hv.yaw,
        this.supportFraction(px, pz, hullW, hullD, hv.yaw),
        lean,
        this.wallTime,
      );

      // A tower under strain talks. It is the only warning the player gets that
      // is not visual, and on a phone in a noisy room the visual has to carry
      // it anyway — so keep it quiet and let the marker do the shouting.
      if (lean > 0.5 && this.creakCooldown <= 0) {
        this.creakCooldown = 1.3 - lean * 0.5;
        this.ctx.audio.play('slice', { gain: 0.1 + lean * 0.1, pitch: -13 });
      }
    }
    void dt;
    void elapsed;
  }

  // ===========================================================================
  // world / items
  // ===========================================================================

  private buildStage(): void {
    const plateWidth = TOPPLE.BASE * TOPPLE.PLATE_SCALE;
    this.plateRadius = plateWidth * 0.5;

    const ctx = this.buildCtx(plateWidth, plateWidth, 0.35, -1);
    try {
      this.plate = this.theme.plate(ctx);
      this.plate.name = 'topple.plate';
      this.root.add(this.plate);
    } catch (err) {
      console.error('[topple] plate failed to build', err);
      this.plate = null;
    }

    this.tableTopY = -0.35;
    if (this.plate) {
      const box = new THREE.Box3().setFromObject(this.plate);
      if (Number.isFinite(box.min.y)) this.tableTopY = box.min.y;
    }

    if (this.theme.environment) {
      const envCtx: EnvBuildCtx = {
        tableTopY: this.tableTopY,
        plateWidth,
        baseFootprint: TOPPLE.BASE,
        rng: this.runRng.fork(4471),
        quality: this.ctx.quality,
        materials: this.ctx.materials,
      };
      try {
        this.scenery = this.theme.environment(envCtx);
        this.scenery.name = 'topple.scenery';
        this.root.add(this.scenery);
      } catch (err) {
        console.error('[topple] environment failed to build', err);
        this.scenery = null;
      }
    }

    // The plate's collision hull is the square inscribed in its disc, a touch
    // generous. Straying past it is what "off the plate" means.
    const plateHalf = (this.plateRadius / Math.SQRT2) * 1.1;
    const plateBody = new Body();
    plateBody.kind = BODY_STATIC;
    plateBody.tag = -1;
    plateBody.setBox(plateHalf, 0.25, plateHalf, 0);
    plateBody.friction = TOPPLE.PLATE_FRICTION;
    plateBody.setPose(0, -0.25, 0);
    this.world.add(plateBody);

    // A table, so wreckage lands on something instead of falling forever.
    const table = new Body();
    table.kind = BODY_STATIC;
    table.tag = -2;
    table.setBox(26, 0.5, 26, 0);
    table.friction = 0.85;
    table.setPose(0, this.tableTopY - 0.5, 0);
    this.world.add(table);
  }

  private addItem(
    food: FoodDef,
    index: number,
    width: number,
    depth: number,
    height: number,
    yaw: number,
    x: number,
    cy: number,
    z: number,
    vx: number,
    vz: number,
    existing?: THREE.Object3D,
    quat?: THREE.Quaternion,
  ): Item {
    const object = existing ?? this.buildFood(food, width, depth, height, index);
    object.name = 'topple.item';
    this.root.add(object);

    const hw = width * TOPPLE.HULL_INSET * 0.5;
    const hd = depth * TOPPLE.HULL_INSET * 0.5;
    const hh = Math.max(height, 0.03) * 0.5;

    const body = new Body();
    body.kind = BODY_DYNAMIC;
    body.tag = index;
    body.setBox(hw, hh, hd, TOPPLE.DENSITY);
    body.friction = TOPPLE.FRICTION;
    body.restitution = 0;
    if (quat) {
      body.setPose(x, cy, z, quat.x, quat.y, quat.z, quat.w);
    } else {
      const s = Math.sin(yaw * 0.5);
      body.setPose(x, cy, z, 0, s, 0, Math.cos(yaw * 0.5));
    }
    body.vx = vx;
    body.vz = vz;
    this.world.add(body);

    const item: Item = {
      index,
      food,
      object,
      body,
      hw,
      hh,
      hd,
      yaw,
      placed: false,
      casting: true,
      prevSpeed: 0,
    };
    this.items.push(item);
    return item;
  }

  /** World transform of a body's mesh, whose origin is the food's underside. */
  private syncItem(it: Item, alpha: number): void {
    const b = it.body;
    if (!b.isFinite()) return;
    let cx = b.qx;
    let cy = b.qy;
    let cz = b.qz;
    let cw = b.qw;
    if (b.prevQx * cx + b.prevQy * cy + b.prevQz * cz + b.prevQw * cw < 0) {
      cx = -cx;
      cy = -cy;
      cz = -cz;
      cw = -cw;
    }
    let qx = b.prevQx + (cx - b.prevQx) * alpha;
    let qy = b.prevQy + (cy - b.prevQy) * alpha;
    let qz = b.prevQz + (cz - b.prevQz) * alpha;
    let qw = b.prevQw + (cw - b.prevQw) * alpha;
    const len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
    if (len > 1e-6) {
      const inv = 1 / len;
      qx *= inv;
      qy *= inv;
      qz *= inv;
      qw *= inv;
    } else {
      qx = 0;
      qy = 0;
      qz = 0;
      qw = 1;
    }
    const px = b.prevPx + (b.px - b.prevPx) * alpha;
    const py = b.prevPy + (b.py - b.prevPy) * alpha;
    const pz = b.prevPz + (b.pz - b.prevPz) * alpha;

    // q * (0, hh, 0), expanded — no Vector3, no Quaternion, no allocation.
    const hh = it.hh;
    const ox = 2 * hh * (qx * qy - qw * qz);
    const oy = hh * (1 - 2 * (qx * qx + qz * qz));
    const oz = 2 * hh * (qw * qx + qy * qz);

    it.object.position.set(px - ox, py - oy, pz - oz);
    it.object.quaternion.set(qx, qy, qz, qw);
  }

  private orientation(yaw: number, axis: 0 | 1, bank: number, out: THREE.Quaternion): void {
    tmpQ2.setFromAxisAngle(AXIS_Y, yaw);
    out.setFromAxisAngle(axis === 0 ? AXIS_Z : AXIS_X, axis === 0 ? bank : -bank);
    out.multiply(tmpQ2);
  }

  // ===========================================================================
  // measurements
  // ===========================================================================

  /**
   * The food the next one will land on: the highest, not simply the last. If a
   * placement slid down the side and came to rest on the plate, the tower's top
   * is still an earlier layer, and that is what must be aimed at.
   */
  private highestItem(exclude?: Item): Item | null {
    let best: Item | null = null;
    let bestY = -Infinity;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it === exclude) continue;
      const t = it.body.topY;
      if (t > bestY) {
        bestY = t;
        best = it;
      }
    }
    return best;
  }

  private peakY(): number {
    let peak = 0;
    for (let i = 0; i < this.items.length; i++) {
      const t = this.items[i].body.topY;
      if (t > peak) peak = t;
    }
    return peak;
  }

  /** 0 = plumb over the plate centre, 1 = the tower's mass is over the rim. */
  private lean(): number {
    let mx = 0;
    let mz = 0;
    let m = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it.placed) continue;
      const w = it.body.invMass > 0 ? 1 / it.body.invMass : 0;
      mx += it.body.px * w;
      mz += it.body.pz * w;
      m += w;
    }
    if (m <= 1e-6) return 0;
    const d = Math.sqrt((mx / m) * (mx / m) + (mz / m) * (mz / m));
    return clamp01(d / (this.plateRadius * 0.55));
  }

  /** Fraction of the incoming footprint that will land on the tower's top face. */
  private supportFraction(x: number, z: number, w: number, d: number, yaw: number): number {
    const top = this.highestItem();
    if (!top) return 1;
    const swap = Math.abs(Math.sin(yaw)) > 0.5;
    const halfX = (swap ? d : w) * 0.5;
    const halfZ = (swap ? w : d) * 0.5;
    const b = top.body;
    const ox = Math.min(x + halfX, b.aMaxX) - Math.max(x - halfX, b.aMinX);
    const oz = Math.min(z + halfZ, b.aMaxZ) - Math.max(z - halfZ, b.aMinZ);
    if (ox <= 0 || oz <= 0) return 0;
    return clamp01((ox * oz) / (halfX * 2 * halfZ * 2));
  }

  private emitProgress(): void {
    this.events.emit('progress', {
      primary: Math.round(this.peakY() * TUNING.CM_PER_UNIT),
      label: 'cm',
    });
  }

  // ===========================================================================
  // content
  // ===========================================================================

  private foodFor(index: number): FoodDef {
    const foods = this.theme.foods;
    return foods[index % foods.length];
  }

  private heroOrder(count: number): FoodDef[] {
    const foods = this.theme.foods;
    const declared = this.theme.hero;
    if (declared?.length) {
      const picked = declared
        .map((i) => foods[i])
        .filter((f): f is FoodDef => !!f)
        .slice(0, count);
      if (picked.length) return picked;
    }
    return foods.slice(0, count);
  }

  private buildCtx(width: number, depth: number, height: number, index: number): FoodBuildCtx {
    return {
      width: Math.max(width, 0.04),
      depth: Math.max(depth, 0.04),
      height: Math.max(height, 0.04),
      index,
      rng: new Rng((this.runSeed ^ Math.imul(index + 2, 0x9e3779b9)) >>> 0),
      quality: this.ctx.quality,
      materials: this.ctx.materials,
      offcut: false,
    };
  }

  private buildFood(
    food: FoodDef,
    width: number,
    depth: number,
    height: number,
    index: number,
  ): THREE.Object3D {
    const ctx = this.buildCtx(width, depth, height, index);
    try {
      const obj = food.build(ctx);
      if (obj) return bakeFood(obj);
    } catch (err) {
      console.error(`[topple] food "${food.id}" failed to build`, err);
    }
    const geo = roundedBox(
      ctx.width,
      ctx.height,
      ctx.depth,
      Math.min(ctx.width, ctx.depth, ctx.height) * 0.18,
      2,
    );
    const mat = this.ctx.materials.standard(`topple.fallback.${food.tint.toString(16)}`, {
      color: food.tint,
      roughness: 0.7,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private teardown(): void {
    for (const it of this.items) {
      this.root.remove(it.object);
      disposeTree(it.object);
    }
    this.items.length = 0;
    if (this.hover) {
      this.root.remove(this.hover.object);
      disposeTree(this.hover.object);
      this.hover = null;
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
    this.world.reset();
    this.marker.hide();
    this.ctx.vfx.clear();
    this.accumulator = 0;
    this.simTime = 0;
    this.settleTimer = 0;
    this.collapseTimer = 0;
    this.gapTimer = 0;
    this.pendingRelease = false;
    this.bestPeak = 0;
  }
}
