/**
 * RECIPE RUSH — the pass.
 *
 * The prep board the ingredients are laid out on, the slots the player taps,
 * and the two pip strips that report the recipe length and the lives left.
 *
 * WHY IT IS AUTHORED IN SCREEN SPACE
 * Portrait leaves about 22 degrees of horizontal field, and the six themes do
 * not agree on how big their table is — the diner's picnic table runs out well
 * before the bottom of the frame, the sushi counter and the piazza table run
 * past it. A hand-placed world-space tray therefore either hangs off the
 * diner's table or shrinks to nothing on the counters. So the four slot
 * columns and two rows are authored as fractions of the viewport and
 * unprojected onto the board plane at layout time: the cells are the same size
 * on every device, always inside the frame, and always at least 44 px.
 *
 * The slab itself is buried 0.75 units into the table and reaches past every
 * screen edge, so no viewer ever sees an edge that is not resting on
 * something.
 *
 * COST: four draw calls — slab, slot discs, step pips, life pips. The discs
 * and pips are instanced so an individual one can flash, pop or dim without
 * costing a second batch.
 */
import * as THREE from 'three';
import { fbm2, mergeAll, roundedBox } from '../../content/kit';
import { clamp, clamp01 } from '../../core/math';
import { Rng } from '../../core/rng';
import type { MaterialLibrary, ThemePaletteLike } from '../../render/api';
import { RR } from './tuning';

const UP = new THREE.Vector3(0, 1, 0);
const _ndc = new THREE.Vector2();
const _hit = new THREE.Vector3();
const _pFar = new THREE.Vector3();
const _pNear = new THREE.Vector3();
const _pEdgeFar = new THREE.Vector3();
const _pEdgeNear = new THREE.Vector3();
const _pFoot = new THREE.Vector3();
const _pFootL = new THREE.Vector3();
const _pBack = new THREE.Vector3();
const _rim = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _mat = new THREE.Matrix4();
const _col = new THREE.Color();
const _colB = new THREE.Color();
const _ray = new THREE.Raycaster();

/**
 * The pass is furniture, not food. DESIGN.md's rule is that the world is
 * desaturated and cool while the food is saturated and warm, so the board is
 * the theme's ground colour pulled most of the way to its own luminance and
 * then lifted a little toward the sky — a warm taupe under the diner, black
 * lacquer under sushi, muted lavender under candy, and never a slab that
 * competes with an ingredient.
 */
function luma(hex: number): number {
  return 0.2126 * ((hex >> 16) & 255) + 0.7152 * ((hex >> 8) & 255) + 0.0722 * (hex & 255);
}

function boardTone(ground: number, sky: number): number {
  const lum = Math.round(luma(ground));
  const grey = (lum << 16) | (lum << 8) | lum;
  const tone = mixHex(mixHex(ground, grey, 0.5), sky, 0.1);
  // The pale ceramic dishes have to read against the board in every theme, so
  // the tone is held inside a luminance band. Sushi keeps its black lacquer;
  // the two high-key palettes (Candy, Breakfast) would otherwise wash the
  // pass, the dishes and the food into one pastel field.
  const l = luma(tone);
  if (l < 1) return tone;
  const target = clamp(l, 26, 92);
  const k = target / l;
  const r = Math.round(clamp(((tone >> 16) & 255) * k, 0, 255));
  const g = Math.round(clamp(((tone >> 8) & 255) * k, 0, 255));
  const b = Math.round(clamp((tone & 255) * k, 0, 255));
  return (r << 16) | (g << 8) | b;
}

/**
 * Tiling grain for the pass. A four-unit slab of one flat colour reads as a
 * hole in the frame however well it is toned, and a bump map is the cheapest
 * way to give it a surface — no extra draw call, no extra vertex, and it
 * catches the key light along the board instead of sitting dead.
 *
 * `roundedBox` extrudes in the shape plane, so the top face's UVs are already
 * in world units; the streaks are drawn wrapped in both axes so the tile is
 * seamless at any repeat.
 */
function grainTexture(materials: MaterialLibrary): THREE.Texture {
  return materials.dataTexture(
    'recipe.board.grain',
    (c, size) => {
      c.fillStyle = '#808080';
      c.fillRect(0, 0, size, size);
      const rng = new Rng(0x9a17);
      c.lineCap = 'round';
      for (let i = 0; i < 90; i++) {
        const y0 = rng.next() * size;
        const amp = size * (0.008 + rng.next() * 0.03);
        const k = 1 + Math.floor(rng.next() * 3);
        const phase = rng.next() * Math.PI * 2;
        const v = Math.round(128 + (rng.next() * 2 - 1) * 46);
        c.strokeStyle = `rgba(${v},${v},${v},0.55)`;
        c.lineWidth = 0.7 + rng.next() * 2.4;
        for (const off of [-size, 0, size]) {
          c.beginPath();
          for (let x = 0; x <= size; x += 4) {
            const y = y0 + off + Math.sin((x / size) * Math.PI * 2 * k + phase) * amp;
            if (x === 0) c.moveTo(x, y);
            else c.lineTo(x, y);
          }
          c.stroke();
        }
      }
      // A little tooth so the grain is not only stripes.
      const img = c.getImageData(0, 0, size, size);
      const d = img.data;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const n = fbm2((x / size) * 7, (y / size) * 7, 2) * 12;
          const i = (y * size + x) * 4;
          const v = clamp(d[i] + n, 0, 255);
          d[i] = v;
          d[i + 1] = v;
          d[i + 2] = v;
        }
      }
      c.putImageData(img, 0, 0);
    },
    { size: 256, repeat: [0.34, 0.34] },
  );
}

function mixHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export interface Slot {
  /** Canonical index: the food's position in the theme's authored run. */
  index: number;
  /** Board-local position of the token's footprint. */
  x: number;
  z: number;
  /** World position of the token's base — hoisted, never reallocated. */
  world: THREE.Vector3;
  /** Parent for the token; scaled so the food fills its cell on any screen. */
  holder: THREE.Group;
  /** Live only when this ingredient is part of the current palette. */
  active: boolean;
  /** 0..1 highlight envelope, driven by the demo and by correct picks. */
  flash: number;
  /** 0..1 press envelope. */
  press: number;
  /** 0..1 "chef's nudge" — the mercy hint after two wrong picks on a step. */
  nudge: number;
  /** 0..1 rejection shake. */
  reject: number;
  /** Seconds since the slot popped in, for the stagger on a new ingredient. */
  arrive: number;
}

export interface PassDeps {
  materials: MaterialLibrary;
  camera: THREE.PerspectiveCamera;
}

export class Pass {
  readonly root = new THREE.Group();
  readonly slots: Slot[] = [];

  private board: THREE.Mesh | null = null;
  private discs: THREE.InstancedMesh | null = null;
  private steps: THREE.InstancedMesh | null = null;
  private lives: THREE.InstancedMesh | null = null;

  private palette: ThemePaletteLike;
  private themeId = '';
  private slotCount = 0;
  private cols = 1;
  private rows = 1;
  private pitch = 0.8;
  private rowPitch = 1;
  private zFar = 2;
  private zNear = 3;
  private halfX = 1.6;
  private footZ = 4.4;
  private footX = 2.2;
  private boardTopY = -0.25;
  private tableTopY = -0.35;
  private plateRadius = 1.2;
  private zBack = 1.2;
  /** Height the tap ray is tested against: the tokens' visual centre. */
  private hitY = -0.12;

  private plane = new THREE.Plane(UP, 0);
  private lastAspect = -1;
  private lastCamX = NaN;
  private lastCamY = NaN;
  private lastCamZ = NaN;

  private stepCount = 0;
  private stepDone = 0;
  private stepPulse = 0;
  private livesLeft: number = RR.LIVES;

  private discIdle = 0xffffff;
  private discHot = 0xffffff;
  private pipOn = 0xffffff;
  private pipOff = 0x222222;

  constructor(private deps: PassDeps, palette: ThemePaletteLike, themeId: string) {
    this.palette = palette;
    this.themeId = themeId;
    this.root.name = 'recipe.pass';
    this.root.rotation.y = Math.PI / 4;
    this.applyPalette(palette, themeId);
  }

  /** Board-plane Y, so the caller can sit the tokens on it. */
  get surfaceY(): number {
    return this.boardTopY;
  }

  applyPalette(palette: ThemePaletteLike, themeId: string): void {
    this.palette = palette;
    this.themeId = themeId;
    const board = boardTone(palette.ground, palette.bgTop);
    this.discIdle = mixHex(palette.accentSoft, 0xffffff, 0.62);
    this.discHot = 0xffffff;
    this.pipOn = mixHex(palette.accent, 0xffffff, 0.25);
    // Spent pips have to be legible against the board they sit on, not against
    // a colour the board may not be anywhere near.
    this.pipOff = mixHex(board, luma(board) > 90 ? 0x120e14 : 0xffffff, 0.42);
  }

  /**
   * Build the slab, the discs and the pips. `count` slots are created; the
   * caller decides which are active.
   */
  build(count: number, tableTopY: number, plateRadius: number): void {
    this.teardown();
    this.slotCount = Math.min(count, RR.MAX_SLOTS);
    this.tableTopY = tableTopY;
    this.plateRadius = plateRadius;
    this.boardTopY = tableTopY + RR.BOARD_LIP;
    this.root.position.set(0, this.boardTopY, 0);

    for (let i = 0; i < this.slotCount; i++) {
      const holder = new THREE.Group();
      holder.name = `recipe.slot.${i}`;
      this.root.add(holder);
      this.slots.push({
        index: i,
        x: 0,
        z: 0,
        world: new THREE.Vector3(),
        holder,
        active: false,
        flash: 0,
        press: 0,
        nudge: 0,
        reject: 0,
        arrive: 1,
      });
    }

    const m = this.deps.materials;
    const discGeo = new THREE.CylinderGeometry(1, 0.94, 0.055, 18, 1, false);
    discGeo.translate(0, 0.0275, 0);
    const discMat = m.standard(`recipe.disc.${this.themeId}`, {
      color: 0xffffff,
      roughness: 0.55,
      metalness: 0.02,
    });
    this.discs = new THREE.InstancedMesh(discGeo, discMat, this.slotCount);
    this.discs.name = 'recipe.discs';
    this.discs.castShadow = false;
    this.discs.receiveShadow = true;
    this.discs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.discs.frustumCulled = false;
    this.root.add(this.discs);

    const pipGeo = new THREE.SphereGeometry(1, 10, 5);
    pipGeo.scale(1, 0.5, 1);
    const pipMat = m.standard(`recipe.pip.${this.themeId}`, {
      color: 0xffffff,
      roughness: 0.34,
      metalness: 0.05,
    });
    this.steps = new THREE.InstancedMesh(pipGeo, pipMat, RR.MAX_LEN);
    this.steps.name = 'recipe.steps';
    this.steps.castShadow = false;
    this.steps.receiveShadow = false;
    this.steps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.steps.frustumCulled = false;
    this.steps.count = 0;
    this.root.add(this.steps);

    const lifeGeo = new THREE.SphereGeometry(1, 12, 6);
    lifeGeo.scale(1, 0.62, 1);
    this.lives = new THREE.InstancedMesh(lifeGeo, pipMat, RR.LIVES);
    this.lives.name = 'recipe.lives';
    this.lives.castShadow = false;
    this.lives.receiveShadow = false;
    this.lives.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lives.frustumCulled = false;
    this.root.add(this.lives);

    this.lastAspect = -1;
    this.layout(true);
  }

  /**
   * Recompute the slot grid from the live camera. Cheap enough to call every
   * frame, but it only does work when the framing actually moved.
   */
  layout(force = false): boolean {
    const cam = this.deps.camera;
    if (
      !force &&
      cam.aspect === this.lastAspect &&
      cam.position.x === this.lastCamX &&
      cam.position.y === this.lastCamY &&
      cam.position.z === this.lastCamZ
    ) {
      return false;
    }
    // Portrait stacks the slots 4x2. Landscape has width to spare and almost
    // no height, and a two-row grid there drops the cells under the 44px
    // floor, so the whole alphabet goes in one row.
    this.cols = cam.aspect > 1.15 ? this.slotCount : Math.ceil(this.slotCount / 2);
    this.rows = this.slotCount > this.cols ? 2 : 1;

    this.lastAspect = cam.aspect;
    this.lastCamX = cam.position.x;
    this.lastCamY = cam.position.y;
    this.lastCamZ = cam.position.z;
    // The rig sets position and quaternion but the renderer is what normally
    // folds them into matrixWorld, so on the frame a run starts the camera
    // matrix is still the attract pose. Unprojecting against that silently
    // halved the grid.
    cam.updateMatrixWorld();

    // Probe the board plane at the token's visual centre height, so what the
    // screen fractions describe is where the food actually appears.
    const tokenCentre = RR.TOKEN_MAX_THICK * 0.5 + RR.TOKEN_LIFT;
    this.hitY = this.boardTopY + tokenCentre;
    this.plane.set(UP, -this.hitY);

    const ndcFar = 1 - 2 * RR.ROW_FAR;
    const ndcNear = 1 - 2 * RR.ROW_NEAR;
    // Each probe returns the same scratch vector, so copy before the next one.
    if (!this.probe(0, ndcFar, _pFar)) return false;
    if (!this.probe(0, ndcNear, _pNear)) return false;
    if (!this.probe(RR.EDGE_X, ndcFar, _pEdgeFar)) return false;
    if (!this.probe(RR.EDGE_X, ndcNear, _pEdgeNear)) return false;

    this.zFar = _pFar.z;
    this.zNear = Math.max(_pNear.z, _pFar.z + 0.35);
    this.rowPitch = this.zNear - this.zFar;
    // The near row is closer to the camera, so the same NDC covers less world
    // there; take the tighter of the two so the grid stays a true rectangle.
    this.halfX = Math.max(Math.min(Math.abs(_pEdgeFar.x), Math.abs(_pEdgeNear.x)), 0.6);
    this.pitch = (2 * this.halfX) / this.cols;

    // Back edge: the authored screen fraction, pushed down if the plate's near
    // rim would otherwise be clipped by it. The pass sits a unit in front of
    // the table, so an edge that overlapped the plate on screen would slice it.
    _rim.set(
      Math.sin(this.root.rotation.y) * this.plateRadius,
      this.tableTopY + 0.12,
      Math.cos(this.root.rotation.y) * this.plateRadius,
    );
    _rim.project(cam);
    const ndcBack = Math.min(1 - 2 * RR.ROW_BACK, _rim.y - 0.022);
    this.zBack = this.probe(0, ndcBack, _pBack) ? _pBack.z : this.zFar - this.pitch * 0.8;

    // The slab has to reach past the bottom corners of the frame, whatever the
    // aspect: probe them rather than guessing a depth that happens to work on
    // one phone.
    if (this.probe(0, -1, _pFoot) && this.probe(-1, -1, _pFootL)) {
      this.footZ = _pFoot.z + 0.6;
      this.footX = Math.max(Math.abs(_pFootL.x) * 1.12, this.halfX * 1.15);
    } else {
      this.footZ = this.zNear + this.pitch * 2.2;
      this.footX = this.halfX * 1.4;
    }

    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const col = i % this.cols;
      const row = Math.floor(i / this.cols);
      s.x = (col - (this.cols - 1) / 2) * this.pitch;
      s.z = this.rows === 1 ? (this.zFar + this.zNear) * 0.5 : row === 0 ? this.zFar : this.zNear;
      s.holder.position.set(s.x, 0, s.z);
      s.holder.scale.setScalar((this.pitch * RR.TOKEN_CELL_FILL) / RR.TOKEN_BUILD_SIZE);
      s.world.set(s.x, 0, s.z);
      this.root.localToWorld(s.world);
    }

    this.rebuildBoard();
    this.root.updateMatrixWorld(true);
    return true;
  }

  /**
   * Where the pip strips live. Portrait has an empty band between the two
   * token rows, which is the best spot on the board. Landscape has one row and
   * no such band, so they go just inside the back edge.
   */
  private pipZ(): number {
    return this.rows === 1
      ? this.zBack + 0.22
      : this.zFar + this.rowPitch * RR.PIP_BAND;
  }

  private probe(nx: number, ny: number, out: THREE.Vector3): boolean {
    _ndc.set(nx, ny);
    _ray.setFromCamera(_ndc, this.deps.camera);
    if (!_ray.ray.intersectPlane(this.plane, _hit)) return false;
    this.root.updateMatrixWorld(true);
    this.root.worldToLocal(_hit);
    out.copy(_hit);
    return true;
  }

  private rebuildBoard(): void {
    if (this.board) {
      this.root.remove(this.board);
      this.board.geometry.dispose();
      this.board = null;
    }
    const w = this.footX * 2;
    const zBack = Math.min(this.zBack, this.zFar - this.pitch * 0.52);
    const zFront = Math.max(this.footZ, this.zNear + this.pitch * 1.2);
    const d = zFront - zBack;
    const h = RR.BOARD_SINK;
    const geo = roundedBox(w, h, d, 0.06, 1);
    // roundedBox spans y in [0, h] centred on X/Z; drop it so the top is y = 0.
    geo.translate(0, -h, (zBack + zFront) * 0.5);
    const mat = this.deps.materials.standard(`recipe.board.${this.themeId}`, {
      color: boardTone(this.palette.ground, this.palette.bgTop),
      roughness: 0.78,
      metalness: 0.02,
      bumpMap: grainTexture(this.deps.materials),
      bumpScale: 0.014,
    });
    this.board = new THREE.Mesh(geo, mat);
    this.board.name = 'recipe.board';
    this.board.castShadow = false;
    this.board.receiveShadow = true;
    this.root.add(this.board);
  }

  // --------------------------------------------------------------- run state

  setActive(count: number): void {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const want = i < count;
      if (want && !s.active) s.arrive = 0;
      s.active = want;
      s.holder.visible = want;
    }
  }

  /** Reveal one more ingredient with a pop, for the palette ramp. */
  activate(index: number): void {
    const s = this.slots[index];
    if (!s || s.active) return;
    s.active = true;
    s.arrive = 0;
    s.holder.visible = true;
  }

  setSteps(total: number, done: number): void {
    this.stepCount = clamp(total, 0, RR.MAX_LEN);
    this.stepDone = clamp(done, 0, this.stepCount);
  }

  setLives(n: number): void {
    this.livesLeft = clamp(n, 0, RR.LIVES);
  }

  flashSlot(index: number, amount = 1): void {
    const s = this.slots[index];
    if (s) s.flash = Math.max(s.flash, amount);
  }

  pressSlot(index: number): void {
    const s = this.slots[index];
    if (s) s.press = 1;
  }

  rejectSlot(index: number): void {
    const s = this.slots[index];
    if (s) s.reject = 1;
  }

  nudgeSlot(index: number): void {
    const s = this.slots[index];
    if (s) s.nudge = 1;
  }

  clearNudges(): void {
    for (const s of this.slots) s.nudge = 0;
  }

  // ------------------------------------------------------------------- input

  /**
   * Which slot a tap landed on, or -1. Raycasts the tap through the camera
   * onto the board plane and reads off the cell, so the whole board is a
   * valid picking surface — there are no dead gaps between the tokens.
   */
  hitSlot(cssX: number, cssY: number, width: number, height: number): number {
    if (width <= 0 || height <= 0) return -1;
    this.deps.camera.updateMatrixWorld();
    this.root.updateMatrixWorld(true);
    _ndc.set((cssX / width) * 2 - 1, -((cssY / height) * 2 - 1));
    _ray.setFromCamera(_ndc, this.deps.camera);
    if (!_ray.ray.intersectPlane(this.plane, _hit)) return -1;
    this.root.worldToLocal(_hit);

    const col = Math.round(_hit.x / this.pitch + (this.cols - 1) / 2);
    if (col < 0 || col >= this.cols) return -1;
    if (Math.abs(_hit.x - (col - (this.cols - 1) / 2) * this.pitch) > this.pitch * 0.5) return -1;

    let row = 0;
    if (this.rows > 1) {
      const mid = (this.zFar + this.zNear) * 0.5;
      row = _hit.z >= mid ? 1 : 0;
    }
    // Generous vertically: everything from the back edge of the board to the
    // bottom of the screen belongs to the nearest row.
    const rowZ = this.rows === 1 ? (this.zFar + this.zNear) * 0.5 : row === 0 ? this.zFar : this.zNear;
    const band = this.rows === 1 ? this.rowPitch * 1.4 : this.rowPitch * 0.85;
    if (_hit.z < rowZ - band || _hit.z > rowZ + band) return -1;

    const index = row * this.cols + col;
    if (index < 0 || index >= this.slotCount) return -1;
    return this.slots[index].active ? index : -1;
  }

  // ------------------------------------------------------------------- frame

  update(dt: number): void {
    this.stepPulse += dt;

    const discs = this.discs;
    if (discs) {
      for (let i = 0; i < this.slots.length; i++) {
        const s = this.slots[i];
        s.flash = Math.max(0, s.flash - dt * 3.4);
        s.press = Math.max(0, s.press - dt * 5.2);
        s.reject = Math.max(0, s.reject - dt * 3.6);
        if (s.arrive < 1) s.arrive = Math.min(1, s.arrive + dt * 3.6);

        const arrive = s.arrive * s.arrive * (3 - 2 * s.arrive);
        const nudge = s.nudge > 0 ? (Math.sin(this.stepPulse * 7.5) * 0.5 + 0.5) * 0.22 : 0;
        const grow = 1 + s.flash * 0.16 + nudge - s.press * 0.1;
        const radius = this.pitch * 0.44 * (s.active ? arrive : 0.001) * grow;
        const shake = s.reject > 0 ? Math.sin(this.stepPulse * 46) * 0.045 * s.reject : 0;

        _pos.set(s.x + shake, 0, s.z);
        _scl.set(radius, 1 + s.flash * 0.5, radius);
        _mat.compose(_pos, _quat, _scl);
        discs.setMatrixAt(i, _mat);

        _col.setHex(this.discIdle, THREE.SRGBColorSpace);
        if (s.flash > 0 || nudge > 0) {
          _colB.setHex(this.discHot, THREE.SRGBColorSpace);
          _col.lerp(_colB, clamp01(Math.max(s.flash, nudge * 3)));
        }
        if (s.reject > 0) {
          _colB.setHex(this.palette.accent, THREE.SRGBColorSpace);
          _col.lerp(_colB, s.reject);
        }
        discs.setColorAt(i, _col);

        // The token rides its disc: lift, press and nudge in sympathy.
        s.holder.position.y = RR.TOKEN_LIFT + s.flash * 0.11 + nudge * 0.4 - s.press * 0.05;
        s.holder.position.x = s.x + shake;
        s.holder.rotation.y = s.reject * Math.sin(this.stepPulse * 40) * 0.25;
        const pop = 1 + s.flash * 0.1 - s.press * 0.08;
        s.holder.scale.setScalar(
          ((this.pitch * RR.TOKEN_CELL_FILL) / RR.TOKEN_BUILD_SIZE) * arrive * pop,
        );
      }
      discs.instanceMatrix.needsUpdate = true;
      if (discs.instanceColor) discs.instanceColor.needsUpdate = true;
    }

    const steps = this.steps;
    if (steps) {
      steps.count = this.stepCount;
      steps.visible = this.stepCount > 0;
      const z = this.pipZ();
      const pitch = Math.min(RR.PIP_PITCH, (this.halfX * 1.05) / RR.MAX_LEN);
      const span = (this.stepCount - 1) * pitch;
      for (let i = 0; i < this.stepCount; i++) {
        const done = i < this.stepDone;
        const current = i === this.stepDone;
        const beat = current ? 1 + Math.sin(this.stepPulse * 6.4) * 0.22 : 1;
        const r = RR.PIP_RADIUS * (done ? 1.12 : 0.86) * beat;
        _pos.set(-span * 0.5 + i * pitch, 0.035, z);
        _scl.set(r, r, r);
        _mat.compose(_pos, _quat, _scl);
        steps.setMatrixAt(i, _mat);
        _col.setHex(done ? this.pipOn : this.pipOff, THREE.SRGBColorSpace);
        if (current) {
          _colB.setHex(0xffffff, THREE.SRGBColorSpace);
          _col.lerp(_colB, 0.35);
        }
        steps.setColorAt(i, _col);
      }
      steps.instanceMatrix.needsUpdate = true;
      if (steps.instanceColor) steps.instanceColor.needsUpdate = true;
    }

    const lives = this.lives;
    if (lives) {
      const z = this.pipZ();
      const x0 = -this.halfX + RR.LIFE_RADIUS * 1.5;
      for (let i = 0; i < RR.LIVES; i++) {
        const alive = i < this.livesLeft;
        const r = RR.LIFE_RADIUS * (alive ? 1 : 0.46);
        _pos.set(x0 + i * RR.LIFE_PITCH, alive ? 0.04 : 0.015, z);
        _scl.set(r, r, r);
        _mat.compose(_pos, _quat, _scl);
        lives.setMatrixAt(i, _mat);
        _col.setHex(alive ? this.pipOn : this.pipOff, THREE.SRGBColorSpace);
        lives.setColorAt(i, _col);
      }
      lives.instanceMatrix.needsUpdate = true;
      if (lives.instanceColor) lives.instanceColor.needsUpdate = true;
    }
  }

  // ----------------------------------------------------------------- teardown

  private teardown(): void {
    for (const s of this.slots) {
      s.holder.removeFromParent();
    }
    this.slots.length = 0;
    if (this.board) {
      this.board.removeFromParent();
      this.board.geometry.dispose();
      this.board = null;
    }
    for (const im of [this.discs, this.steps, this.lives]) {
      if (!im) continue;
      im.removeFromParent();
      im.geometry.dispose();
      im.dispose();
    }
    this.discs = null;
    this.steps = null;
    this.lives = null;
  }

  dispose(): void {
    this.teardown();
    this.root.removeFromParent();
  }
}

/** The cloche: the mode's one piece of stagecraft, and one draw call. */
export class Cloche {
  readonly root = new THREE.Group();
  private mesh: THREE.Mesh | null = null;

  constructor(
    private materials: MaterialLibrary,
    palette: ThemePaletteLike,
    themeId: string,
    quality: 'low' | 'medium' | 'high',
  ) {
    this.root.name = 'recipe.cloche';
    this.root.visible = false;
    const seg = quality === 'low' ? 18 : quality === 'medium' ? 22 : 28;
    // A true hemisphere: anything shallower leaves a gap between the rim and
    // the plate that reads as a floating bowl.
    const dome = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.4), 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1.52, 1.18, 1.52);
    const knob = new THREE.SphereGeometry(0.15, 10, 7);
    knob.scale(1, 0.85, 1);
    knob.translate(0, 1.2, 0);
    const stem = new THREE.CylinderGeometry(0.055, 0.075, 0.14, 8);
    stem.translate(0, 1.12, 0);
    const rim = new THREE.CylinderGeometry(1.54, 1.58, 0.075, seg, 1, false);
    rim.translate(0, 0.0375, 0);
    const geo = mergeAll([dome, knob, stem, rim]);
    if (!geo) return;
    const mat = materials.physical(`recipe.cloche.${themeId}`, {
      // Brushed, not mirrored: a chrome dome under a bright sky blows out to a
      // white blob and loses its silhouette entirely.
      color: mixHex(0xc6c9d0, palette.rim, 0.22),
      roughness: 0.3,
      metalness: 0.5,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.root.add(this.mesh);
  }

  show(y: number): void {
    this.root.visible = true;
    this.root.position.y = y;
  }

  hide(): void {
    this.root.visible = false;
  }

  dispose(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.removeFromParent();
      this.mesh = null;
    }
    this.root.removeFromParent();
  }
}
