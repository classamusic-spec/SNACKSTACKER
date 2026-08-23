/**
 * CONVEYOR — tap the ingredients the ticket asks for.
 * ===================================================
 *
 * THE RULES, AND WHY
 *
 * A docket over the belt names one to five items. Ingredients ride toward the
 * camera; tapping one that the docket still wants serves it, tapping anything
 * else is a wrong grab, and letting a wanted one reach the front of the belt is
 * a miss. Both mistakes cost time, not the run — a reaction game whose punish
 * is instant death teaches nothing, and a reaction game whose punish is a
 * shrug teaches nothing either. The clock is the pressure and the pressure is
 * continuous: it starts at 14 seconds and every completed order feeds it,
 * which is what turns "I nearly had another order" into "one more go".
 *
 * There is ONE belt and orders never overlap, and both are the same piece of
 * arithmetic. Portrait gives ~22 degrees of horizontal field: at the belt's far
 * end the frame is 5.2 world units wide, so a second belt would put every item
 * under the 44px touch floor, and a second docket would halve a board that is
 * already only 295 CSS px wide. The screen's long axis is vertical, so the belt
 * uses it — items travel up-screen to down-screen, growing as they come, which
 * also means the newest item is the smallest and the one you must decide about
 * is the biggest. Difficulty escalates on the axes the frame can actually
 * afford: speed (1.95 -> 4.1 u/s), density (1.95 -> 1.2 units apart), order
 * length (1 -> 5 items over three rows) and decoy share (18% -> 58%).
 *
 * LAYOUT. Everything is authored in the belt's local frame, +Z toward the
 * camera, and the root is turned to the rig's play yaw so +Z projects straight
 * down the portrait screen. See tuning.ts for the framing arithmetic.
 */
import * as THREE from 'three';
import type { EnvBuildCtx, ThemeDef } from '../../content/api';
import { BASE_FOOTPRINT } from '../../core/world';
import { Emitter } from '../../core/events';
import { clamp, clamp01, damp, easeOutCubic, smoothstep } from '../../core/math';
import { device } from '../../core/device';
import { Rng } from '../../core/rng';
import { TUNING } from '../../game/constants';
import type { GameMode, ModeCtx, ModeEvents } from '../api';
import { buildBelt, TREAD_REPEATS, type BeltRig } from './belt';
import { ItemPool, type Slot } from './items';
import {
  isComplete,
  makeOrder,
  rowFor,
  type Order,
  type OrderRow,
} from './orders';
import { carveCorridor, disposeGeometries } from './parts';
import {
  gapFor,
  grabPoints,
  needShareFor,
  orderPoints,
  orderTier,
  praiseFor,
  speedFor,
  timeBonusFor,
} from './scoring';
import { chipLocal, Ticket } from './ticket';
import {
  DECK_H,
  FLY_TIME,
  MAX_ON_BELT,
  OVER_DELAY,
  POOL,
  PTS_WRONG,
  REJECT_TIME,
  TABLE_Y,
  TICKET_H,
  TICKET_TILT,
  TICKET_Y,
  TICKET_Z,
  TIME_CAP,
  TIME_PANIC,
  TIME_PENALTY_MISS,
  TIME_PENALTY_WRONG,
  TIME_START,
  Z_END,
  Z_HATCH,
  Z_PASS,
  Z_RETIRE,
  Z_SINK,
  Z_SPAWN,
} from './tuning';

type Phase = 'idle' | 'attract' | 'playing' | 'ending' | 'over';

/**
 * `requestTravel` is the only distance control the rig exposes. 1.15 pins the
 * fit at its 9.5-unit floor on a phone, which is the closest, most intimate
 * framing the rig will give — every number in tuning.ts is derived from it.
 */
const CAM_TRAVEL = 1.15;
const CAM_TOP = 0;
/** Items nearer than this cast a shadow; beyond it the shadow map cannot see. */
const SHADOW_FROM_Z = 0.4;

/* ------------------------------------------------------------ scratch state
 * Hoisted so update() and tap() never allocate. */
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();
const _hits: THREE.Intersection[] = [];
const _confetti: number[] = [0, 0, 0];
const _toLocal = new THREE.Matrix4();
const _chip = { x: 0, y: 0 };

export function createConveyorMode(ctx: ModeCtx): GameMode {
  return new ConveyorMode(ctx);
}

class ConveyorMode implements GameMode {
  readonly id = 'conveyor' as const;
  readonly events = new Emitter<ModeEvents>();

  private ctx: ModeCtx;
  private theme: ThemeDef;

  private root = new THREE.Group();
  private belt: BeltRig | null = null;
  private ticket: Ticket | null = null;
  private scenery: THREE.Object3D | null = null;
  private pool: ItemPool;
  private built = false;

  private phase: Phase = 'idle';
  private runRng = new Rng(1);
  private runIndex = 0;

  // run state
  private order: Order | null = null;
  private level = 0;
  private ordersServed = 0;
  private cleanOrders = 0;
  private combo = 0;
  private bestCombo = 0;
  private score = 0;
  private time = TIME_START;
  private sinceSpawn = 0;
  private nextGap = 2;
  private handover = 0;
  private endTimer = 0;
  private hasActed = false;
  private lastIntensity = -1;
  private lastTick = -1;
  private speedScale = 1;

  constructor(ctx: ModeCtx) {
    this.ctx = ctx;
    this.theme = ctx.theme;
    this.pool = new ItemPool(POOL[ctx.quality] ?? 7);

    this.root.name = 'conveyor.root';
    this.root.rotation.y = TUNING.CAM_YAW;
    this.root.position.y = TABLE_Y;
    this.root.add(this.pool.root);
    ctx.scene.add(this.root);
  }

  // ---------------------------------------------------------------- lifecycle

  private ensureBuilt(): void {
    if (this.built) return;
    this.built = true;
    const { materials, quality } = this.ctx;
    // this.theme, not ctx.theme: setTheme() can land before the first build.
    const theme = this.theme;

    this.belt = buildBelt(materials, theme.palette, quality);
    this.root.add(this.belt.root);

    this.ticket = new Ticket(materials, theme.palette, device.prefersReducedMotion);
    this.belt.root.add(this.ticket.group);

    this.pool.setFoods(theme.foods, materials, quality, 0x5a1c3f);

    this.buildScenery();
  }

  /**
   * The theme's own world, unchanged. The belt is a piece of equipment stood on
   * the table the stacker already plays on, which is the whole point: this is
   * the same backyard, the same sushi counter, the same piazza.
   */
  private buildScenery(): void {
    if (!this.theme.environment || this.scenery) return;
    const envCtx: EnvBuildCtx = {
      tableTopY: TABLE_Y,
      plateWidth: BASE_FOOTPRINT * 1.35,
      baseFootprint: BASE_FOOTPRINT,
      rng: new Rng(0x9871),
      quality: this.ctx.quality,
      materials: this.ctx.materials,
    };
    try {
      this.scenery = this.theme.environment(envCtx);
      this.scenery.name = 'conveyor.stage';
      this.ctx.scene.add(this.scenery);
      this.scenery.updateMatrixWorld(true);
      this.root.updateMatrixWorld(true);
      _toLocal.copy(this.root.matrixWorld).invert();
      carveCorridor(this.scenery, _toLocal, {
        halfW: 1.45,
        zMin: Z_HATCH - 0.6,
        zMax: Z_END + 1.2,
        yMin: 0.05,
        yMax: 2.6,
        maxProp: 3.4,
      });
    } catch (err) {
      console.error('[conveyor] environment failed to build', err);
      this.scenery = null;
    }
  }

  private frameCamera(): void {
    const rig = this.ctx.rig;
    rig.requestTravel(CAM_TRAVEL);
    rig.setOrbit(0);
    rig.snapOrbit();
    rig.setLift(0);
    rig.setTop(CAM_TOP, true);
    rig.snap();
  }

  attract(): void {
    this.ensureBuilt();
    this.clearRun();
    this.phase = 'attract';
    this.level = 0;
    this.order = null;
    this.speedScale = 1;
    this.nextGap = 2.1;
    this.sinceSpawn = 99;
    this.ticket?.paint(null, null);
    this.ticket?.setTime(1);
    this.frameCamera();
  }

  start(): void {
    this.ensureBuilt();
    this.clearRun();
    this.phase = 'playing';

    this.runIndex++;
    this.runRng = new Rng((this.ctx.rng.int(0, 0x7fffffff) ^ Math.imul(this.runIndex, 0x2545f491)) >>> 0);

    this.level = 0;
    this.ordersServed = 0;
    this.cleanOrders = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.score = 0;
    this.time = TIME_START;
    this.sinceSpawn = 99;
    this.nextGap = 1.4;
    this.handover = 0;
    this.endTimer = 0;
    this.hasActed = false;
    this.lastIntensity = -1;
    this.lastTick = -1;
    this.speedScale = 1;

    this.frameCamera();
    this.newOrder();

    this.events.emit('score', { score: 0, delta: 0, pop: false });
    this.events.emit('combo', 0);
    this.events.emit('progress', { primary: 0, label: 'Orders' });
    this.events.emit('intensity', 0.2);
  }

  stop(): void {
    this.phase = 'idle';
    this.clearRun();
  }

  private clearRun(): void {
    this.pool.releaseAll();
    this.order = null;
    this.ctx.vfx.clear();
  }

  setTheme(theme: ThemeDef): void {
    if (theme === this.theme) return;
    this.theme = theme;
    if (!this.built) return;
    // The machine's colours are baked into its vertex buffer and the docket's
    // paper into a canvas, so a palette change is a rebuild, not a re-tint.
    this.teardown();
    this.ensureBuilt();
    this.ticket?.paint(this.order, null);
  }

  /** Drop everything built for a theme, keeping the pool object itself. */
  private teardown(): void {
    this.pool.releaseAll();
    if (this.ticket) {
      this.ticket.dispose();
      this.ticket = null;
    }
    if (this.belt) {
      this.root.remove(this.belt.root);
      disposeGeometries(this.belt.root);
      this.belt = null;
    }
    if (this.scenery) {
      this.ctx.scene.remove(this.scenery);
      disposeGeometries(this.scenery);
      this.scenery = null;
    }
    this.pool.clearFoods();
    this.built = false;
  }

  // -------------------------------------------------------------------- input

  tap(x: number, y: number): boolean {
    if (this.phase !== 'playing' || this.handover > 0 || !this.order) return false;

    const view = this.ctx.viewport();
    if (view.width <= 0 || view.height <= 0) return false;
    _ndc.set((x / view.width) * 2 - 1, -(y / view.height) * 2 + 1);
    if (!Number.isFinite(_ndc.x) || !Number.isFinite(_ndc.y)) return false;

    // Matrices are current from the last render, but a tap can land between
    // frames and a stale matrix would raycast against last frame's belt.
    this.root.updateMatrixWorld(true);
    _ray.setFromCamera(_ndc, this.ctx.camera);

    let best: Slot | null = null;
    let bestDist = Infinity;
    const slots = this.pool.slots;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.state !== 'ride' || s.delivered) continue;
      _hits.length = 0;
      _ray.intersectObject(s.proxy, false, _hits);
      for (let h = 0; h < _hits.length; h++) {
        if (_hits[h].distance < bestDist) {
          bestDist = _hits[h].distance;
          best = s;
        }
      }
    }
    _hits.length = 0;
    if (!best) return false;

    if (!this.hasActed) {
      this.hasActed = true;
      this.events.emit('firstAction', undefined);
    }

    const row = best.food ? rowFor(this.order, best.food) : null;
    if (row) this.grab(best, row);
    else this.reject(best);
    return true;
  }

  // ------------------------------------------------------------------ outcomes

  private grab(slot: Slot, row: OrderRow): void {
    const order = this.order!;
    const food = slot.food!;
    row.got++;
    order.served++;

    this.combo++;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    const points = grabPoints(this.combo);
    this.score += points;
    this.events.emit('score', { score: this.score, delta: points, pop: true });
    this.events.emit('combo', this.combo);

    const praise = praiseFor(this.combo);
    if (praise) this.events.emit('praise', praise);

    this.ctx.audio.play('drop', { pitch: 5, gain: 0.55 });
    this.ctx.audio.playComboNote(this.combo);

    this.localToWorld(slot.group.position.x, slot.group.position.y + 0.16, slot.z, _v);
    this.ctx.vfx.sparkle({
      position: _v,
      color: food.tint,
      colorAlt: food.tintAlt ?? this.theme.palette.accent,
      count: 10,
      power: 0.85,
      scale: 0.8,
    });
    this.ctx.vfx.ring({
      position: _v,
      color: this.theme.palette.accent,
      radius: 0.45,
      thickness: 0.09,
      life: 0.38,
      orientation: 'flat',
    });
    this.popAt(slot, `+${points}`, this.theme.palette.accent);
    this.ctx.shake(0.02, 0.12);

    // Fly to this row's own colour chip, so the eye is dragged to the place the
    // information it needs next lives.
    this.startFlight(slot, order.rows.indexOf(row), order.rows.length);

    // One repaint per tap: completeOrder() paints the stamped version, so the
    // intermediate one would only be a wasted 640x280 upload in the same frame.
    if (isComplete(order)) this.completeOrder();
    else this.ticket?.paint(order, null);
  }

  private reject(slot: Slot): void {
    const food = slot.food!;
    if (this.order) this.order.clean = false;
    this.combo = 0;
    this.events.emit('combo', 0);
    const before = this.score;
    this.score = Math.max(0, this.score + PTS_WRONG);
    this.events.emit('score', { score: this.score, delta: this.score - before, pop: false });

    this.time = Math.max(0, this.time - TIME_PENALTY_WRONG);

    this.ctx.audio.play('slice', { gain: 0.55 });
    this.ctx.audio.play('fail', { gain: 0.7, delay: 0.04 });

    this.localToWorld(slot.group.position.x, slot.group.position.y + 0.12, slot.z, _v);
    _dir.set(slot.group.position.x < 0 ? -1 : 1, 0.6, 0).normalize();
    this.ctx.vfx.burst({
      position: _v,
      color: food.tint,
      colorAlt: food.tintAlt,
      direction: _dir,
      count: 18,
      power: 1.15,
    });
    this.popAt(slot, `-${TIME_PENALTY_WRONG.toFixed(1)}s`, 0xff4436);
    this.ctx.shake(0.09, 0.3);
    this.ticket?.knock(1);

    slot.state = 'reject';
    slot.t = 0;
    slot.delivered = true;
    slot.spin = slot.group.position.x < 0 ? -9 : 9;
    slot.fromX = slot.group.position.x;
  }

  private missed(slot: Slot): void {
    const food = slot.food!;
    if (this.order) this.order.clean = false;
    this.combo = 0;
    this.events.emit('combo', 0);
    this.time = Math.max(0, this.time - TIME_PENALTY_MISS);

    this.ctx.audio.play('fall', { gain: 0.6 });
    this.localToWorld(slot.group.position.x, DECK_H + 0.05, Z_PASS, _v);
    this.ctx.vfx.splash({
      position: _v,
      color: food.tint,
      colorAlt: food.tintAlt,
      count: 14,
      power: 0.9,
    });
    this.localToWorld(slot.group.position.x, DECK_H + 0.62, Math.min(Z_PASS, 2.6), _v2);
    this.ctx.vfx.popText(_v2, 'MISSED', 0xff6a4a);
    this.ctx.shake(0.05, 0.22);
    this.ticket?.knock(0.6);
    slot.delivered = true;
  }

  private completeOrder(): void {
    const order = this.order!;
    const bonus = orderPoints(this.level, this.time);
    this.score += bonus;
    this.ordersServed++;
    if (order.clean) this.cleanOrders++;
    this.level++;

    this.events.emit('score', { score: this.score, delta: bonus, pop: true });
    this.events.emit('progress', { primary: this.ordersServed, label: 'Orders' });
    this.events.emit('milestone', {
      title: 'ORDER UP',
      sub: order.clean ? `CLEAN  +${bonus}` : `+${bonus}`,
    });

    this.time = Math.min(TIME_CAP, this.time + timeBonusFor(this.level));

    const tier = orderTier(this.level, order.clean);
    this.ctx.audio.play('milestone');
    this.ctx.audio.play('perfect', { gain: 0.85 });
    this.ctx.flash(0.22 + tier * 0.06);
    this.ctx.shake(0.045, 0.24);

    this.ticketWorld(_v);
    this.ctx.vfx.perfect(_v, this.theme.palette.accent, tier);
    if (this.ordersServed % 3 === 0) {
      _confetti[0] = this.theme.palette.accent;
      _confetti[1] = this.theme.palette.accentSoft;
      _confetti[2] = order.rows[0].food.tint;
      this.ctx.vfx.confetti(_v, _confetti);
    }

    this.ticket?.paint(order, 'ORDER UP');
    this.ticket?.celebrate();
    this.handover = 0.5;
  }

  private newOrder(): void {
    this.order = makeOrder(this.ordersServed + 1, this.level, this.theme.foods, this.runRng);
    this.ticket?.paint(this.order, null);
    this.ticket?.celebrate();
  }

  private endRun(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'ending';
    this.endTimer = 0;
    this.combo = 0;
    this.events.emit('combo', 0);
    this.ctx.audio.play('fail');
    this.ctx.audio.play('collapse', { delay: 0.16, gain: 0.8 });
    this.ctx.audio.duck(1.2);
    this.ctx.shake(0.1, 0.5);
    this.ctx.rig.setLift(1.7);
    this.ctx.rig.setTop(0.45);
    this.ticket?.knock(1.2);
  }

  // -------------------------------------------------------------------- frame

  update(dt: number, elapsed: number): void {
    if (!this.built) return;
    const playing = this.phase === 'playing';

    if (playing) {
      if (this.handover > 0) {
        this.handover -= dt;
        if (this.handover <= 0) this.newOrder();
      }
      this.time -= dt;
      this.tickCountdown();
      if (this.time <= 0) {
        this.time = 0;
        this.endRun();
      }
    } else if (this.phase === 'ending') {
      this.speedScale = damp(this.speedScale, 0, 3.2, dt);
      this.endTimer += dt;
      if (this.endTimer >= OVER_DELAY) {
        this.phase = 'over';
        this.events.emit('over', {
          score: Math.round(this.score),
          count: this.ordersServed,
          countLabel: 'Orders',
          perfects: this.cleanOrders,
          bestCombo: this.bestCombo,
        });
      }
    }

    const running = playing || this.phase === 'attract' || this.phase === 'ending';
    const speed = (this.phase === 'attract' ? 1.5 : speedFor(this.level)) * this.speedScale;

    if (running) {
      this.advanceBand(speed, dt);
      this.spawnStep(speed, dt);
    }
    this.stepSlots(dt, elapsed, running ? speed : 0);

    // Absolute against the cap, never against a moving maximum: a bar that
    // rescales itself teaches the player nothing about how much time a top-up
    // is actually worth.
    const frac = this.time / TIME_CAP;
    this.ticket?.setTime(this.phase === 'attract' ? 1 : frac);
    this.ticket?.update(dt, elapsed);

    if (playing) this.pushIntensity();
  }

  /** Once-per-second tick under the panic threshold. */
  private tickCountdown(): void {
    const whole = Math.ceil(this.time);
    if (this.time <= TIME_PANIC && whole !== this.lastTick && whole > 0) {
      this.lastTick = whole;
      this.ctx.audio.play('countdown', { gain: 0.5, pitch: (TIME_PANIC - whole) * 1.5 });
    } else if (this.time > TIME_PANIC) {
      this.lastTick = -1;
    }
  }

  private advanceBand(speed: number, dt: number): void {
    const belt = this.belt;
    if (!belt) return;
    const perUnit = TREAD_REPEATS / (Z_END - Z_HATCH);
    let o = belt.bandTex.offset.y + speed * dt * perUnit;
    if (o > 1) o -= Math.floor(o);
    belt.bandTex.offset.y = o;
  }

  private spawnStep(speed: number, dt: number): void {
    if (this.phase === 'ending') return;
    const cap = MAX_ON_BELT[this.ctx.quality] ?? 5;
    this.sinceSpawn += speed * dt;
    if (this.sinceSpawn < this.nextGap) return;
    if (this.onBelt() >= cap) return;

    const foodIndex = this.pickFood();
    if (foodIndex < 0) return;
    const slot = this.pool.acquire(foodIndex);
    if (!slot) return;

    slot.state = 'ride';
    slot.z = Z_SPAWN;
    slot.lateral = this.runRng.range(-0.13, 0.13);
    slot.group.position.set(slot.lateral, DECK_H, Z_SPAWN);
    slot.group.rotation.set(0, this.runRng.range(-0.35, 0.35), 0);
    slot.group.scale.setScalar(0.02);
    slot.t = 0;

    this.sinceSpawn = 0;
    const base = gapFor(this.level);
    // A little rhythm: mostly the nominal gap, sometimes a pair arriving almost
    // together. Never below the tap-proxy width, so two targets never merge.
    const burst = this.runRng.bool(0.2);
    this.nextGap = clamp(base * (burst ? 0.68 : this.runRng.range(0.88, 1.3)), 1.18, 3.4);
  }

  /** Items between the hatch and the retire line. */
  private onBelt(): number {
    let n = 0;
    const slots = this.pool.slots;
    for (let i = 0; i < slots.length; i++) if (slots[i].state === 'ride') n++;
    return n;
  }

  /**
   * Pick what comes out of the hatch next.
   *
   * The share of wanted items falls from 82% to 42% as the run goes on, which
   * is the difficulty curve that matters most — restraint is the skill this
   * mode is about. The guard at the top is the fairness rule: if nothing the
   * docket wants is anywhere on the belt, the next item is one it wants, so an
   * order can never be starved out by the dice.
   */
  private pickFood(): number {
    const order = this.order;
    const foods = this.theme.foods;
    if (!order) return this.runRng.int(0, foods.length);

    let outstanding = 0;
    for (let i = 0; i < order.rows.length; i++) {
      outstanding += Math.max(0, order.rows[i].want - order.rows[i].got);
    }

    let wantedOnBelt = 0;
    const slots = this.pool.slots;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.state === 'ride' && !s.delivered && s.food && rowFor(order, s.food)) wantedOnBelt++;
    }

    // Fairness at the bottom, variety at the top. If nothing the docket wants
    // is on the belt at all, the next item is one it wants — an order can never
    // be starved out by the dice. And never more than three wanted items in
    // flight at once: without that cap a one-item order filled the whole belt
    // with four copies of the same lettuce, which is neither a decision nor a
    // photograph anyone would want.
    const cap = Math.min(Math.max(outstanding, 1), 3);
    const forced = wantedOnBelt === 0 && outstanding > 0;
    const saturated = wantedOnBelt >= cap;
    const wantNeeded =
      forced || (!saturated && outstanding > 0 && this.runRng.next() < needShareFor(this.level));

    if (wantNeeded && outstanding > 0) {
      // Weight by how many of that row are still outstanding.
      let pick = this.runRng.next() * outstanding;
      for (let i = 0; i < order.rows.length; i++) {
        pick -= Math.max(0, order.rows[i].want - order.rows[i].got);
        if (pick <= 0) {
          const idx = foods.indexOf(order.rows[i].food);
          if (idx >= 0) return idx;
        }
      }
    }

    // A decoy is any food the docket does not currently want.
    let tries = 0;
    while (tries < 12) {
      const idx = this.runRng.int(0, foods.length);
      if (!rowFor(order, foods[idx])) return idx;
      tries++;
    }
    return this.runRng.int(0, foods.length);
  }

  private stepSlots(dt: number, elapsed: number, speed: number): void {
    const slots = this.pool.slots;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.state === 'idle') continue;
      s.t += dt;

      if (s.state === 'ride') {
        s.z += speed * dt;
        s.group.position.z = s.z;
        // Emerging from the hatch: scale up over the first third of a unit.
        const grow = clamp01((s.z - Z_SPAWN) / 0.55);
        const pop = grow < 1 ? 0.15 + 0.85 * smoothstep(grow) : 1;
        // ...and shrink back into the machine at the far end, rather than
        // blinking out 20px above the bottom of the frame.
        const sink = clamp01((s.z - Z_SINK) / (Z_RETIRE - Z_SINK));
        s.group.scale.setScalar(pop * (1 - sink * 0.92));
        s.group.position.y =
          DECK_H + Math.sin(elapsed * 3.1 + s.phase * 6.28) * 0.008 - sink * 0.22;
        // Only the near half of the belt is inside the host's shadow box.
        this.pool.setCasting(s, s.z > SHADOW_FROM_Z);

        if (!s.delivered && s.z >= Z_PASS && this.phase === 'playing' && this.order) {
          if (s.food && rowFor(this.order, s.food)) this.missed(s);
          else s.delivered = true;
        }
        if (s.z >= Z_RETIRE) this.pool.release(s);
        continue;
      }

      if (s.state === 'fly') {
        const k = clamp01(s.t / FLY_TIME);
        const e = easeOutCubic(k);
        const lift = Math.sin(k * Math.PI) * 0.9;
        s.group.position.x = s.fromX + (s.toX - s.fromX) * e;
        s.group.position.z = s.fromZ + (s.toZ - s.fromZ) * e;
        s.group.position.y = s.fromY + (s.toY - s.fromY) * e + lift;
        s.group.rotation.y += dt * 6;
        s.group.scale.setScalar(1 - 0.72 * e);
        if (k >= 1) {
          this.landOnTicket(s);
          this.pool.release(s);
        }
        continue;
      }

      // reject
      const k = clamp01(s.t / REJECT_TIME);
      s.group.position.x = s.fromX + Math.sign(s.spin) * 2.4 * easeOutCubic(k);
      s.group.position.y = DECK_H + 1.5 * k - 3.4 * k * k;
      s.group.position.z = s.z + speed * dt * 0.4;
      s.group.rotation.z += s.spin * dt;
      s.group.rotation.x += s.spin * 0.6 * dt;
      s.group.scale.setScalar(Math.max(0.02, 1 - k * 0.85));
      if (k >= 1) this.pool.release(s);
    }
  }

  private startFlight(slot: Slot, rowIndex: number, rowCount: number): void {
    slot.state = 'fly';
    slot.t = 0;
    slot.delivered = true;
    slot.fromX = slot.group.position.x;
    slot.fromY = slot.group.position.y;
    slot.fromZ = slot.group.position.z;

    // The chip's centre on the painted board, rotated by the docket's lean and
    // lifted into the belt frame. Painted layout and flight target share one
    // piece of arithmetic, so they cannot drift apart.
    chipLocal(rowIndex, rowCount, _chip);
    slot.toX = _chip.x;
    slot.toY = TICKET_Y + _chip.y * Math.cos(TICKET_TILT) + 0.06;
    slot.toZ = TICKET_Z + _chip.y * Math.sin(TICKET_TILT) + 0.14;
  }

  private landOnTicket(slot: Slot): void {
    this.localToWorld(slot.toX, slot.toY, slot.toZ, _v);
    this.ctx.vfx.sparkle({
      position: _v,
      color: slot.food?.tint ?? this.theme.palette.accent,
      count: 9,
      power: 0.6,
      scale: 0.6,
    });
    this.ticket?.celebrate();
  }

  private pushIntensity(): void {
    const urgency = 1 - clamp01(this.time / TIME_CAP);
    const v = clamp01(
      0.2 + clamp01(this.level / 9) * 0.45 + urgency * 0.2 + clamp01(this.combo / 12) * 0.15,
    );
    if (Math.abs(v - this.lastIntensity) > 0.03) {
      this.lastIntensity = v;
      this.events.emit('intensity', v);
    }
  }

  // ------------------------------------------------------------------ helpers

  /**
   * World text for a grab, kept off the docket.
   *
   * The first build put "+62" at the item, and a grab at the far end printed it
   * straight across the order rows — the one thing on screen that must stay
   * readable. The text is pushed a unit toward the camera and clamped to the
   * middle of the belt, so it always lands on the band, never on the paper.
   */
  private popAt(slot: Slot, text: string, color: number): void {
    const z = clamp(slot.z + 0.9, -2.6, 2.8);
    this.localToWorld(slot.group.position.x, DECK_H + 0.55, z, _v2);
    this.ctx.vfx.popText(_v2, text, color);
  }

  /** Belt-local -> world. The root is a yaw plus a table-height offset. */
  private localToWorld(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(TUNING.CAM_YAW);
    const s = Math.sin(TUNING.CAM_YAW);
    out.set(c * x + s * z, y + TABLE_Y, -s * x + c * z);
    return out;
  }

  private ticketWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.localToWorld(0, TICKET_Y + TICKET_H * 0.1, TICKET_Z + 0.3, out);
  }

  // ------------------------------------------------------------------ disposal

  dispose(): void {
    this.teardown();
    this.pool.dispose();
    this.ctx.scene.remove(this.root);
    this.root.clear();
    this.events.clear();
  }
}
