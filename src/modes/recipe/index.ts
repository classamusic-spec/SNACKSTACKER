/**
 * RECIPE RUSH
 * ===========
 *
 * Memorise a recipe, then stack it back in order.
 *
 * THE RULES, AND WHY
 * ------------------
 * **The chef shows you.** The recipe is not a ticket or a list — it is BUILT,
 * in 3D, on the same plate you are about to build it on, one ingredient at a
 * time, each one flying out of its slot on the pass. What you watch is
 * pixel-for-pixel what you are asked to reproduce, which removes the whole
 * class of "I remembered the picture, not the dish" failures.
 *
 * **The memorise phase is played, not waited through.** A tap advances the
 * chef. The auto-dwell (0.26-0.44s) is only a safety net: a confident player
 * drums the recipe out in under a second and gets straight to the speed bonus,
 * and a slower player simply does not tap. The memorise phase has NO clock —
 * you study for as long as you like — because a clock on watching is pressure
 * you cannot influence, the single biggest risk in a memory game.
 *
 * **The recall phase does have a clock, and it speeds up.** The moment the
 * cloche lifts and it is your turn, a countdown runs (see `enterPick` and the
 * CLOCK_* tuning). This is the opposite kind of timer: one you beat by playing
 * well. Recipe one is almost languid; the per-item budget tightens every
 * recipe while the recipe itself gets longer, so by recipe eight the pace
 * roughly doubles — "start slow, then rush." A correct pick banks a little
 * time, so a confident player pulls ahead and only a hesitant one is caught.
 * Running out costs a life, not the run (below), so it never kills you from a
 * state you could not see coming.
 *
 * **Three channels carry every ingredient.** Its shape (real theme food, whose
 * silhouettes are authored to be distinct at 120px), its slot (canonical and
 * fixed — bacon is always in the same place), and its pitch (each slot owns a
 * rung of a two-octave pentatonic, so a recipe is heard as a melody). Colour
 * is never the only signal, which matters because several foods in a theme
 * share a hue.
 *
 * **The board fills up.** Recipe 1 lays out four ingredients and asks for
 * three; by recipe 5 all eight are out. Length and decoy count escalate
 * separately, and both are visible on the table — the ramp is something the
 * player can see rather than something they infer from failing.
 *
 * **A wrong pick — or a timeout — costs a life, not the run.** Three lives.
 * The wrong token is rejected and shaken off; the step stays open and you try
 * again. Two wrong picks on one step and the correct slot starts nudging — you
 * cannot get stuck, and you cannot farm the hint either, because it costs two
 * of your three lives to reach it. A timeout spends a life through the same
 * economy, nudges the step you blanked on, and refills the clock a little
 * tighter, so the countdown escalates the pressure without ever being an
 * instant loss.
 *
 * **Partial credit is real.** Every correct pick banks points immediately, so
 * seven of nine on the recipe that ends the run still paid. Serving a recipe
 * pays a length bonus, doubled when it was flawless, plus a speed bonus
 * against par — so recall speed is rewarded twice over: once for surviving the
 * clock, and again for beating par with time to spare.
 *
 * Length runs 3,4,5,6,7,8,9 and then holds; a good run reaches recipe six or
 * seven, which lands between 30 and 60 seconds. Restart is one `start()`: the
 * world, the pass and every ingredient mesh are pooled and survive.
 */
import * as THREE from 'three';
import type { AudioEngine } from '../../audio/api';
import type { EnvBuildCtx, FoodBuildCtx, FoodDef, ThemeDef } from '../../content/api';
import { Emitter } from '../../core/events';
import { bounceEnvelope, clamp, clamp01, easeOutCubic } from '../../core/math';
import { Rng } from '../../core/rng';
import { TUNING } from '../../game/constants';
import type { GameMode, ModeCtx, ModeEvents } from '../api';
import { Cloche, Pass } from './pass';
import { FoodPool } from './pool';
import {
  demoDwell,
  makeRecipe,
  paletteSize,
  pickPoints,
  recipeBonus,
  recipeLength,
  recipeTimeLimit,
  serveTier,
  speedBonus,
} from './rules';
import { RR, SLOT_SEMITONES } from './tuning';

type Phase = 'idle' | 'attract' | 'intro' | 'demo' | 'cover' | 'pick' | 'complete' | 'over';
type CoverPurpose = 'hide' | 'serve';

interface DishItem {
  food: FoodDef;
  obj: THREE.Object3D;
  /** Final base Y on the plate. */
  y: number;
  height: number;
  /** Flight progress in seconds; >= flightDur means landed. */
  ft: number;
  flightDur: number;
  fx: number;
  fy: number;
  fz: number;
  tilt: number;
  squash: number;
  squashing: boolean;
  flying: boolean;
}

/* --------------------------------------------------------- module scratch */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _box = new THREE.Box3();

class RecipeMode implements GameMode {
  readonly id = 'recipe' as const;
  readonly events = new Emitter<ModeEvents>();

  private root = new THREE.Group();
  private dishRoot = new THREE.Group();
  private parked = new THREE.Group();

  private theme: ThemeDef;
  private audio: AudioEngine;
  private pool: FoodPool;
  private pass: Pass;
  private cloche: Cloche;

  private plate: THREE.Object3D | null = null;
  private scenery: THREE.Object3D | null = null;
  private worldBuilt = false;
  private tableTopY = -0.35;

  private phase: Phase = 'idle';
  private t = 0;
  private lock = 0;

  private rng: Rng;
  private recipe: number[] = [];
  private counts = new Uint8Array(RR.MAX_SLOTS);
  private recipeNo = 0;
  private len = 0;
  private palette = 0;

  private demoIndex = 0;
  private demoGate = 0;
  private pickIndex = 0;
  private wrongOnStep = 0;
  private recipeMistakes = 0;
  private pickStart = 0;
  private elapsed = 0;

  /** Recall countdown. `clockLimit` is this recipe's budget; `clockLeft` ticks. */
  private clockLimit = 0;
  private clockLeft = 0;
  private clockUrgent = false;

  private score = 0;
  private combo = 0;
  private bestCombo = 0;
  private perfects = 0;
  private served = 0;
  private lives = RR.LIVES;
  private acted = false;

  private items: DishItem[] = [];
  private topY = 0;
  private coverPurpose: CoverPurpose = 'hide';
  private coverClinked = false;
  private dishScale = 1;

  constructor(private ctx: ModeCtx) {
    this.theme = ctx.theme;
    this.audio = ctx.audio;
    this.rng = ctx.rng.fork(0x2ec19e);
    this.root.name = 'recipe.root';
    this.dishRoot.name = 'recipe.dish';
    this.parked.name = 'recipe.pool';
    this.parked.visible = false;
    this.root.add(this.dishRoot);
    this.root.add(this.parked);
    ctx.scene.add(this.root);

    this.pool = new FoodPool({ materials: ctx.materials, quality: ctx.quality });
    this.pass = new Pass(
      { materials: ctx.materials, camera: ctx.camera },
      this.theme.palette,
      this.theme.id,
    );
    this.root.add(this.pass.root);
    this.cloche = new Cloche(ctx.materials, this.theme.palette, this.theme.id, ctx.quality);
    this.root.add(this.cloche.root);
  }

  // ---------------------------------------------------------------- lifecycle

  attract(): void {
    this.resetRun();
    this.buildWorld();
    this.phase = 'attract';
    this.pass.root.visible = false;

    const foods = this.theme.foods;
    const order = this.theme.hero?.length
      ? this.theme.hero
      : [0, 1, 2, 3, 4, 5].filter((i) => i < foods.length);
    const show = Math.min(6, order.length);
    for (let i = 0; i < show; i++) {
      const food = foods[order[i] % foods.length];
      if (!food) continue;
      this.placeItem(food, order[i] % foods.length, null, 0);
    }
    for (const it of this.items) {
      it.flying = false;
      it.ft = it.flightDur;
      it.obj.position.set(0, it.y, 0);
      it.obj.scale.set(1, 1, 1);
      it.obj.rotation.set(0, 0, 0);
    }

    // No cloche on the home screen. It is the mode's signature, but the dome
    // is plate-sized (it only ever has to cover a dish that has already
    // squashed flat) and a six-high hero tower simply pokes out of it.
    this.cloche.hide();
    this.t = 0;

    this.ctx.rig.requestTravel(RR.TRAVEL);
    this.ctx.rig.setLift(0);
    this.ctx.rig.setOrbit(0.18);
    this.ctx.rig.setTop(this.topY * 0.5, true);
    this.ctx.rig.snap();
  }

  start(): void {
    this.resetRun();
    this.buildWorld();

    this.phase = 'idle';
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.perfects = 0;
    this.served = 0;
    this.lives = RR.LIVES;
    this.acted = false;
    this.recipeNo = 0;
    this.elapsed = 0;

    this.pass.root.visible = true;
    this.pass.setActive(0);
    this.pass.setLives(this.lives);
    this.pass.setSteps(0, 0);

    this.ctx.rig.setOrbit(0);
    this.ctx.rig.snapOrbit();
    this.ctx.rig.setLift(0);
    this.ctx.rig.requestTravel(RR.TRAVEL);
    this.ctx.rig.setTop(RR.TOP_Y, true);
    this.ctx.rig.snap();
    this.pass.layout(true);
    this.mountTokens();

    this.events.emit('score', { score: 0, delta: 0, pop: false });
    this.events.emit('combo', 0);
    this.events.emit('intensity', 0);
    this.beginRecipe();
  }

  stop(): void {
    this.phase = 'idle';
    this.resetRun();
  }

  setTheme(theme: ThemeDef): void {
    if (theme === this.theme) return;
    this.resetRun();
    this.teardownWorld();
    this.pool.dispose();
    this.pass.dispose();
    this.cloche.dispose();

    this.theme = theme;
    this.pool = new FoodPool({ materials: this.ctx.materials, quality: this.ctx.quality });
    this.pass = new Pass(
      { materials: this.ctx.materials, camera: this.ctx.camera },
      theme.palette,
      theme.id,
    );
    this.root.add(this.pass.root);
    this.cloche = new Cloche(
      this.ctx.materials,
      theme.palette,
      theme.id,
      this.ctx.quality,
    );
    this.root.add(this.cloche.root);
    this.phase = 'idle';
  }

  dispose(): void {
    this.resetRun();
    this.teardownWorld();
    this.pool.dispose();
    this.pass.dispose();
    this.cloche.dispose();
    this.root.removeFromParent();
    this.events.clear();
  }

  // -------------------------------------------------------------------- input

  tap(x: number, y: number): boolean {
    switch (this.phase) {
      case 'demo':
        if (this.demoGate > 0) return false;
        this.firstAction();
        if (this.demoIndex >= this.len) this.enterCover('hide');
        else this.demoStep();
        return true;

      case 'intro':
        // Impatient players can start the show early.
        this.firstAction();
        this.t = 0;
        return true;

      case 'pick': {
        if (this.lock > 0) return false;
        const vp = this.ctx.viewport();
        const slot = this.pass.hitSlot(x, y, vp.width, vp.height);
        if (slot < 0) return false;
        this.firstAction();
        if (slot === this.recipe[this.pickIndex]) this.onCorrect(slot);
        else this.onWrong(slot);
        return true;
      }

      default:
        return false;
    }
  }

  private firstAction(): void {
    if (this.acted) return;
    this.acted = true;
    this.events.emit('firstAction', undefined);
  }

  // -------------------------------------------------------------------- frame

  update(dt: number, elapsed: number): void {
    this.elapsed = elapsed;
    if (this.phase !== 'idle' && this.phase !== 'attract' && this.phase !== 'over') {
      this.pass.layout();
    }
    this.pass.update(dt);
    this.updateItems(dt);
    if (this.lock > 0) this.lock -= dt;

    switch (this.phase) {
      case 'attract':
        this.t += dt;
        break;

      case 'intro':
        this.t -= dt;
        if (this.t <= 0) {
          this.phase = 'demo';
          this.t = 0;
          this.demoIndex = 0;
          this.demoGate = 0;
        }
        break;

      case 'demo':
        this.t -= dt;
        this.demoGate -= dt;
        if (this.t <= 0) {
          if (this.demoIndex >= this.len) this.enterCover('hide');
          else this.demoStep();
        }
        break;

      case 'pick':
        // The clock does not start until the reveal lock-out has cleared, so a
        // slow first frame after the cloche lifts never steals recall time.
        if (this.lock <= 0) {
          this.clockLeft -= dt;
          if (this.clockLeft <= 0) {
            this.clockLeft = 0;
            this.emitClock();
            this.onTimeout();
          } else {
            this.emitClock();
          }
        }
        break;

      case 'cover':
        this.t += dt;
        this.updateCover();
        break;

      case 'complete':
        this.t += dt;
        if (this.t >= RR.COMPLETE_HOLD) this.enterCover('serve');
        break;

      case 'over':
        this.t += dt;
        this.updateCover();
        if (this.t >= RR.OVER_HOLD) {
          this.phase = 'idle';
          this.events.emit('over', {
            score: this.score,
            count: this.served,
            countLabel: 'Recipes',
            perfects: this.perfects,
            bestCombo: this.bestCombo,
          });
        }
        break;

      default:
        break;
    }
  }

  // ------------------------------------------------------------------ recipes

  private beginRecipe(): void {
    this.recipeNo++;
    this.len = recipeLength(this.recipeNo);
    const want = paletteSize(this.recipeNo, this.theme.foods.length);

    let added = -1;
    for (let i = this.palette; i < want; i++) {
      this.pass.activate(i);
      added = i;
    }
    this.palette = want;

    makeRecipe(this.recipe, this.counts, this.len, this.palette, this.rng);

    this.clearDish();
    this.pickIndex = 0;
    this.wrongOnStep = 0;
    this.recipeMistakes = 0;
    this.demoIndex = 0;
    this.pass.setSteps(this.len, 0);
    this.pass.clearNudges();

    this.phase = 'intro';
    this.t = RR.INTRO;

    if (added >= 0 && this.recipeNo > 1) {
      const food = this.theme.foods[added];
      this.events.emit('milestone', { title: 'NEW INGREDIENT', sub: food ? food.name : undefined });
      this.audio.play('unlock', { gain: 0.65 });
    } else if (this.recipeNo === 1 || this.recipeNo % 3 === 0) {
      this.events.emit('milestone', {
        title: `RECIPE ${this.recipeNo}`,
        sub: `${this.len} ingredients`,
      });
    }
    this.events.emit('progress', { primary: 0, label: `of ${this.len}` });
    this.events.emit(
      'intensity',
      clamp01(this.recipeNo / 8) * 0.7 + clamp01(this.combo / 16) * 0.3,
    );
    this.audio.play('whoosh', { gain: 0.2 });

    if (this.recipeNo === 1) {
      _v1.set(0, 1.95, 0);
      this.ctx.vfx.popText(_v1, 'WATCH', this.theme.palette.accent);
    }
  }

  /** Place the next demo ingredient: identical motion to a correct pick. */
  private demoStep(): void {
    const slot = this.recipe[this.demoIndex];
    const food = this.theme.foods[slot];
    if (!food) {
      this.demoIndex++;
      return;
    }
    this.placeItem(food, slot, this.pass.slots[slot]?.world ?? null, RR.DEMO_FLIGHT);
    this.pass.flashSlot(slot);
    this.noteFor(slot, 0.85);
    this.sparkleSlot(slot);
    this.demoIndex++;
    this.pass.setSteps(this.len, this.demoIndex);
    this.demoGate = RR.DEMO_TAP_GATE;
    this.t = this.demoIndex >= this.len ? RR.DEMO_TAIL : demoDwell(this.len);

    if (this.recipeNo === 1 && this.demoIndex === 1) {
      _v1.copy(this.pass.slots[slot]?.world ?? _v1).setY(this.tableTopY + 0.62);
      this.ctx.vfx.popText(_v1, 'TAP = NEXT', this.theme.palette.accentSoft);
    }
  }

  private enterCover(purpose: CoverPurpose): void {
    this.phase = 'cover';
    this.coverPurpose = purpose;
    this.coverClinked = false;
    this.t = 0;
    this.dishScale = 1;
    this.cloche.show(this.topY + 2.6);
  }

  /**
   * The cloche falls, the dish compresses into the plate under it, it clinks,
   * and it lifts away empty. Squash-and-stretch does the hiding, so the dome
   * only has to be plate-sized instead of tall enough to swallow nine layers.
   */
  private updateCover(): void {
    const fall = RR.CLOCHE_FALL;
    const hold = fall + RR.CLOCHE_HOLD;
    const rise = hold + RR.CLOCHE_RISE;
    const t = this.t;

    if (t < fall) {
      const e = easeOutCubic(clamp01(t / fall));
      this.cloche.show((1 - e) * (this.topY + 2.6));
      this.dishScale = Math.max(0.02, 1 - e);
      this.applyDishScale();
      return;
    }

    if (!this.coverClinked) {
      this.coverClinked = true;
      this.cloche.show(0);
      this.dishScale = 0.02;
      this.applyDishScale();
      this.clearDish();
      if (this.phase === 'over') this.revealAnswer();
      this.audio.play('drop', { pitch: -4, gain: 0.9 });
      this.audio.play('ui_toggle', { pitch: 7, gain: 0.5 });
      _v1.set(0, 0.06, 0);
      this.ctx.vfx.ring({
        position: _v1,
        color: this.theme.palette.rim,
        radius: 1.6,
        life: 0.45,
        orientation: 'flat',
      });
      this.ctx.shake(0.05, 0.2);
    }

    if (t < hold) return;

    if (t < rise) {
      const e = easeOutCubic(clamp01((t - hold) / RR.CLOCHE_RISE));
      this.cloche.show(e * (this.topY + 4.2));
      return;
    }

    this.cloche.hide();
    this.dishScale = 1;
    if (this.phase === 'over') return;
    if (this.coverPurpose === 'hide') this.enterPick();
    else this.beginRecipe();
  }

  /**
   * The last beat of a run: the cloche lifts on the recipe the player was
   * trying to build. Closure, and the only moment the answer is ever shown —
   * a memory game that never tells you what it wanted is just a shrug.
   */
  private revealAnswer(): void {
    for (let i = 0; i < this.len; i++) {
      const food = this.theme.foods[this.recipe[i]];
      if (food) this.placeItem(food, this.recipe[i], null, 0);
    }
    for (const it of this.items) {
      it.flying = false;
      it.squashing = false;
      it.obj.position.set(0, it.y, 0);
      it.obj.scale.set(1, 1, 1);
      it.obj.rotation.set(0, 0, 0);
    }
    this.pass.setSteps(this.len, this.len);
    _v1.set(0, this.topY + 0.4, 0);
    this.ctx.vfx.ring({
      position: _v1,
      color: this.theme.palette.accentSoft,
      radius: 1.1,
      life: 0.6,
      orientation: 'billboard',
    });
  }

  private enterPick(): void {
    this.phase = 'pick';
    this.t = 0;
    this.lock = RR.GO_LOCKOUT;
    this.pickStart = this.elapsed;
    this.clockLimit = recipeTimeLimit(this.recipeNo, this.len);
    this.clockLeft = this.clockLimit;
    this.clockUrgent = false;
    this.emitClock();
    this.pass.setSteps(this.len, 0);
    this.events.emit('progress', { primary: 0, label: `of ${this.len}` });
    _v1.set(0, 1.5, 0);
    this.ctx.vfx.ring({
      position: _v1,
      color: this.theme.palette.accent,
      radius: 0.7,
      life: 0.4,
      orientation: 'billboard',
    });
    this.audio.play('countdown', { gain: 0.4, pitch: 5 });
    if (this.recipeNo === 1) {
      _v1.set(0, 1.95, 0);
      this.ctx.vfx.popText(_v1, 'YOUR TURN', this.theme.palette.accent);
    }
  }

  // -------------------------------------------------------------------- picks

  private onCorrect(slot: number): void {
    const food = this.theme.foods[slot];
    if (!food) return;

    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const points = pickPoints(this.pickIndex, this.combo);
    this.score += points;

    this.pass.pressSlot(slot);
    this.pass.flashSlot(slot, 0.85);
    this.pass.clearNudges();
    this.placeItem(food, slot, this.pass.slots[slot]?.world ?? null, RR.FLIGHT);

    this.pickIndex++;
    this.wrongOnStep = 0;
    this.pass.setSteps(this.len, this.pickIndex);

    // Bank a little time for a right answer, so a confident player pulls ahead
    // of the clock and only a hesitant one is caught by it.
    this.clockLeft = Math.min(this.clockLimit, this.clockLeft + RR.CLOCK_PICK_BONUS);
    this.emitClock();

    this.noteFor(slot, 0.7);
    this.audio.playComboNote(this.combo);
    this.sparkleSlot(slot);

    this.events.emit('score', { score: this.score, delta: points, pop: this.combo > 1 });
    this.events.emit('combo', this.combo);
    this.events.emit('progress', { primary: this.pickIndex, label: `of ${this.len}` });
    // The music rides the streak as well as the recipe number — a long clean
    // run should audibly lift, which is most of why the ladder works.
    this.events.emit(
      'intensity',
      clamp01(this.recipeNo / 8) * 0.7 + clamp01(this.combo / 16) * 0.3,
    );
    this.ctx.flash(0.1 + clamp01(this.combo / 20) * 0.12);

    if (this.pickIndex >= this.len) this.onServed();
  }

  private onWrong(slot: number): void {
    this.combo = 0;
    this.lives--;
    this.wrongOnStep++;
    this.recipeMistakes++;

    this.pass.rejectSlot(slot);
    this.pass.setLives(this.lives);

    const food = this.theme.foods[slot];
    const world = this.pass.slots[slot]?.world;
    if (world) {
      _v1.copy(world).setY(world.y + 0.2);
      _v2.set(0, 1, 0);
      this.ctx.vfx.burst({
        position: _v1,
        color: food ? food.tint : this.theme.palette.accent,
        colorAlt: food?.tintAlt,
        direction: _v2,
        count: 12,
        power: 1.1,
        scale: 0.7,
      });
    }

    this.audio.play('slice', { gain: 0.6, pitch: -5 });
    this.audio.play('fail', { gain: 0.75 });
    this.ctx.shake(0.09, 0.3);
    this.events.emit('combo', 0);
    this.events.emit('intensity', clamp01(this.recipeNo / 8) * 0.7);

    if (this.lives <= 0) {
      this.enterOver();
      return;
    }

    if (this.wrongOnStep >= RR.NUDGE_AFTER) {
      // Mercy: nobody should be stuck staring at a board they have forgotten.
      // It costs two of three lives to get here, so it cannot be farmed.
      this.pass.nudgeSlot(this.recipe[this.pickIndex]);
    }
  }

  /** Push the current countdown to the HUD, and heat the music as it runs low. */
  private emitClock(): void {
    const remaining01 = this.clockLimit > 0 ? clamp01(this.clockLeft / this.clockLimit) : 0;
    const urgent = this.clockLeft <= RR.CLOCK_URGENT;
    if (urgent && !this.clockUrgent) {
      this.clockUrgent = true;
      this.audio.play('countdown', { gain: 0.3, pitch: 9 });
      this.events.emit('intensity', clamp01(this.recipeNo / 8) * 0.6 + 0.4);
    }
    this.events.emit('clock', { remaining01, seconds: this.clockLeft, urgent });
  }

  /**
   * The clock ran out. Same currency as a wrong pick — a life, not the run —
   * so the countdown escalates the pressure without turning into an instant
   * loss the player cannot see coming. Correct picks so far are kept; the
   * forgotten step is nudged, and the refill comes back a little tighter.
   */
  private onTimeout(): void {
    this.combo = 0;
    this.lives--;
    this.pass.setLives(this.lives);

    this.audio.play('fail', { gain: 0.8 });
    this.audio.play('slice', { gain: 0.5, pitch: -7 });
    this.ctx.shake(0.11, 0.34);
    this.ctx.flash(0.18);
    this.events.emit('combo', 0);
    _v1.set(0, this.topY + 0.92, 0);
    this.ctx.vfx.popText(_v1, "TIME'S UP", this.theme.palette.accent);

    if (this.lives <= 0) {
      this.events.emit('clock', null);
      this.enterOver();
      return;
    }

    this.pass.nudgeSlot(this.recipe[this.pickIndex]);
    this.clockLeft = this.clockLimit * RR.CLOCK_TIMEOUT_REFILL;
    this.clockUrgent = false;
    this.emitClock();
    this.events.emit('intensity', clamp01(this.recipeNo / 8) * 0.7);
  }

  private onServed(): void {
    this.events.emit('clock', null);
    const flawless = this.recipeMistakes === 0;
    const taken = Math.max(0, this.elapsed - this.pickStart);
    const bonus = recipeBonus(this.len, flawless);
    const speed = speedBonus(this.len, taken);
    this.score += bonus + speed;
    this.served++;
    if (flawless) this.perfects++;

    const tier = serveTier(this.len, flawless);
    this.events.emit('score', { score: this.score, delta: bonus + speed, pop: true });
    this.events.emit('praise', { label: flawless ? 'FLAWLESS' : 'SERVED', tier });
    this.events.emit('progress', { primary: this.served, label: this.served === 1 ? 'recipe' : 'recipes' });
    this.events.emit(
      'intensity',
      clamp01(this.recipeNo / 8) * 0.7 + clamp01(this.combo / 16) * 0.3,
    );

    _v1.set(0, this.topY + 0.35, 0);
    if (flawless) {
      this.ctx.vfx.perfect(_v1, this.theme.palette.accent, tier);
      this.audio.play('perfect', { gain: 0.95 });
    } else {
      this.ctx.vfx.ring({
        position: _v1,
        color: this.theme.palette.accentSoft,
        radius: 1.2,
        life: 0.5,
        orientation: 'billboard',
      });
    }
    _v2.set(0, this.topY + 0.95, 0);
    this.ctx.vfx.popText(_v2, `+${bonus + speed}`, this.theme.palette.accent);
    this.audio.play('milestone', { gain: 0.8 });
    this.ctx.vfx.confetti(_v1, [
      this.theme.palette.accent,
      this.theme.palette.accentSoft,
      this.theme.palette.rim,
    ]);
    this.ctx.shake(0.05 + tier * 0.02, 0.24);
    this.ctx.flash(0.3 + tier * 0.1);

    this.phase = 'complete';
    this.t = 0;
  }

  private enterOver(): void {
    this.phase = 'over';
    this.coverPurpose = 'serve';
    this.coverClinked = false;
    this.t = 0;
    this.events.emit('clock', null);
    this.cloche.show(this.topY + 2.6);
    this.audio.play('fall', { gain: 0.9 });
    this.audio.play('collapse', { delay: 0.16 });
    this.audio.duck(1.2);
    this.ctx.shake(0.14, 0.5);
    this.events.emit('intensity', 0);
    // No orbit here. The stacker turns the camera to show off the tower; this
    // mode's subject is the pass, which is laid out against a fixed bearing —
    // turning it would shear the board across the last frame of the run.
    this.ctx.rig.setLift(0.85);
  }

  // --------------------------------------------------------------- dish items

  private placeItem(
    food: FoodDef,
    index: number,
    from: THREE.Vector3 | null,
    flightDur: number,
  ): void {
    const obj = this.pool.acquire(food, index);
    const height = FoodPool.dishHeight(food);
    obj.visible = true;
    // Only the bottom of the dish casts. Everything above it drops its shadow
    // into the stack's own, so paying for it in the shadow pass buys nothing.
    FoodPool.setCast(obj, this.items.length < 3);
    this.dishRoot.add(obj);

    const item: DishItem = {
      food,
      obj,
      y: this.topY,
      height,
      ft: flightDur > 0 ? 0 : flightDur,
      flightDur,
      fx: from ? from.x : 0,
      fy: from ? from.y : this.topY + 2.2,
      fz: from ? from.z : 0,
      tilt: (this.rng.next() - 0.5) * 0.7,
      squash: 0,
      squashing: flightDur <= 0,
      flying: flightDur > 0,
    };
    this.items.push(item);
    this.topY += height;

    if (flightDur > 0) {
      obj.position.set(item.fx, item.fy, item.fz);
      obj.scale.setScalar(0.42);
    } else {
      obj.position.set(0, item.y, 0);
      obj.scale.set(1, 1, 1);
    }
  }

  private updateItems(dt: number): void {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];

      if (it.flying) {
        it.ft += dt;
        const raw = clamp01(it.ft / it.flightDur);
        const e = easeOutCubic(raw);
        const x = it.fx + (0 - it.fx) * e;
        const z = it.fz + (0 - it.fz) * e;
        const arc = Math.sin(Math.PI * raw) * 0.85;
        const y = it.fy + (it.y - it.fy) * e + arc;
        it.obj.position.set(x, y, z);
        const s = 0.42 + 0.58 * e;
        it.obj.scale.set(s, s, s);
        it.obj.rotation.z = (1 - e) * it.tilt;
        it.obj.rotation.y = (1 - e) * it.tilt * 1.6;
        if (raw >= 1) {
          it.flying = false;
          it.squashing = true;
          it.squash = 0;
          it.obj.position.set(0, it.y, 0);
          it.obj.rotation.set(0, 0, 0);
          it.obj.scale.set(1, 1, 1);
          this.onLanded(it);
        }
        continue;
      }

      if (it.squashing) {
        it.squash += dt;
        const env = bounceEnvelope(it.squash, RR.SQUASH_FREQ, RR.SQUASH_DECAY);
        const sy = (1 - env * RR.SQUASH) * this.dishScale;
        const sxz = (1 + env * RR.SQUASH * 0.55) * this.dishScale;
        it.obj.scale.set(sxz, sy, sxz);
        if (it.squash > 0.9) {
          it.obj.scale.setScalar(this.dishScale);
          it.squashing = false;
        }
      }
    }
  }

  private onLanded(it: DishItem): void {
    this.audio.play('drop', { gain: 0.55, pitch: -2 });
    _v1.set(0, it.y + it.height * 0.5, 0);
    _v2.set(0, 1, 0);
    this.ctx.vfx.burst({
      position: _v1,
      color: it.food.tint,
      colorAlt: it.food.tintAlt,
      direction: _v2,
      count: 8,
      power: 0.75,
      scale: 0.7,
      spread: 1,
    });
  }

  private applyDishScale(): void {
    const s = this.dishScale;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      it.obj.scale.set(s, s, s);
      it.obj.position.set(0, it.y * s, 0);
    }
  }

  private clearDish(): void {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      this.parked.add(it.obj);
      this.pool.release(it.food, it.obj);
    }
    this.items.length = 0;
    this.topY = 0;
    this.dishScale = 1;
  }

  // ------------------------------------------------------------------- audio

  /** Each slot owns a rung of the pentatonic; the recipe becomes a melody. */
  private noteFor(slot: number, gain: number): void {
    const semis = SLOT_SEMITONES[slot % SLOT_SEMITONES.length];
    const world = this.pass.slots[slot]?.world;
    const pan = world ? clamp(world.x * 0.16, -0.7, 0.7) : 0;
    this.audio.play('drop', { pitch: semis, gain, pan });
  }

  private sparkleSlot(slot: number): void {
    const world = this.pass.slots[slot]?.world;
    if (!world) return;
    _v1.copy(world).setY(world.y + 0.22);
    _v2.set(0, 1, 0);
    this.ctx.vfx.sparkle({
      position: _v1,
      color: this.theme.palette.accentSoft,
      direction: _v2,
      count: 7,
      power: 0.8,
      scale: 0.6,
      life: 0.5,
    });
  }

  // ------------------------------------------------------------------- world

  private mountTokens(): void {
    const foods = this.theme.foods;
    const n = Math.min(RR.MAX_SLOTS, foods.length);
    for (let i = 0; i < n; i++) {
      const slot = this.pass.slots[i];
      if (!slot || slot.holder.children.length) continue;
      slot.holder.add(this.pool.token(foods[i], i));
    }
  }

  private buildWorld(): void {
    if (this.worldBuilt) return;
    this.worldBuilt = true;

    const width = RR.PLATE_FOOTPRINT;
    const ctx = this.foodCtx(width, width, 0.35, -1);
    try {
      this.plate = this.theme.plate(ctx);
      this.root.add(this.plate);
    } catch (err) {
      console.error('[snackery] recipe: plate failed to build', err);
      this.plate = null;
    }

    this.tableTopY = -0.35;
    if (this.plate) {
      _box.setFromObject(this.plate);
      if (Number.isFinite(_box.min.y)) this.tableTopY = _box.min.y;
    }

    if (this.theme.environment) {
      const envCtx: EnvBuildCtx = {
        tableTopY: this.tableTopY,
        // The environment sizes the table from the stacker's plate, so hand it
        // the stacker's number: the world must be the same place in both modes.
        plateWidth: TUNING.BASE_FOOTPRINT * 1.35,
        baseFootprint: TUNING.BASE_FOOTPRINT,
        rng: this.rng.fork(9871),
        quality: this.ctx.quality,
        materials: this.ctx.materials,
      };
      try {
        this.scenery = this.theme.environment(envCtx);
        this.root.add(this.scenery);
      } catch (err) {
        console.error('[snackery] recipe: environment failed to build', err);
        this.scenery = null;
      }
    }

    this.pass.build(
      Math.min(RR.MAX_SLOTS, this.theme.foods.length),
      this.tableTopY,
      RR.PLATE_FOOTPRINT * 0.5,
    );
    this.mountTokens();
  }

  private foodCtx(width: number, depth: number, height: number, index: number): FoodBuildCtx {
    return {
      width,
      depth,
      height,
      index,
      rng: this.rng.fork(index + 3),
      quality: this.ctx.quality,
      materials: this.ctx.materials,
      offcut: false,
    };
  }

  private resetRun(): void {
    this.clearDish();
    this.pass.setActive(0);
    this.pass.setSteps(0, 0);
    this.pass.clearNudges();
    this.palette = 0;
    this.recipeNo = 0;
    this.len = 0;
    this.pickIndex = 0;
    this.demoIndex = 0;
    this.lock = 0;
    this.t = 0;
    this.clockLimit = 0;
    this.clockLeft = 0;
    this.clockUrgent = false;
    // Drop the HUD clock, in case the run was abandoned mid-recall.
    this.events.emit('clock', null);
    this.cloche.hide();
    this.ctx.vfx.clear();
  }

  private teardownWorld(): void {
    if (this.plate) {
      this.plate.removeFromParent();
      disposeTree(this.plate);
      this.plate = null;
    }
    if (this.scenery) {
      this.scenery.removeFromParent();
      disposeTree(this.scenery);
      this.scenery = null;
    }
    this.worldBuilt = false;
  }
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.isMesh && m.geometry) m.geometry.dispose();
  });
}

/** The host's only entry point. */
export function createRecipeMode(ctx: ModeCtx): GameMode {
  return new RecipeMode(ctx);
}
