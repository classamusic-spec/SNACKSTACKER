/**
 * TEMPORARY — Recipe Rush development harness.
 *
 * Mounts `createRecipeMode` against a real SceneKit / CameraRig / vfx / audio,
 * with no host, no UI and no save file. It exists only so the mode can be
 * looked at and driven from Playwright while the real mode picker is being
 * built elsewhere. Delete this file, `recipe-probe.ts` and `recipe-dev.html`
 * once the host exists.
 *
 *   /recipe-dev.html?theme=sushi&tier=high&start=1
 *
 * Exposes `window.__recipe` for automation:
 *   stats            live renderer counters
 *   start() stop()   run control
 *   tapSlot(i)       tap the centre of slot i (screen space, via the real tap path)
 *   tapCentre()      tap the middle of the screen (advances the demo)
 *   answer()         the slot index the mode is currently waiting for
 *   state            phase / recipe / step / lives / score
 *   slotScreen(i)    CSS pixel centre of slot i, for hit-target measurement
 */
import * as THREE from 'three';
import { createAudioEngine } from '../audio';
import { themes } from '../content';
import { device } from '../core/device';
import { Rng } from '../core/rng';
import { Ticker } from '../core/ticker';
import type { QualityTier, ThemeId } from '../core/types';
import { CameraRig } from '../game/CameraRig';
import { TUNING } from '../game/constants';
import { createRecipeMode } from '../modes/recipe';
import type { ModeCtx } from '../modes/api';
import { createSceneKit } from '../render';
import { createVfx } from '../vfx';

const params = new URLSearchParams(location.search);
const themeId = (params.get('theme') ?? 'diner') as ThemeId;
const tier = (params.get('tier') ?? device.suggestedQuality) as QualityTier;
const theme = themes.byId(themeId);

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const kit = createSceneKit({
  canvas,
  quality: tier,
  pixelRatio: Math.min(window.devicePixelRatio || 1, device.maxPixelRatio),
  palette: theme.palette,
});
const rig = new CameraRig(kit.camera);
const vfx = createVfx(kit.scene, kit.camera, kit.materials, kit.quality.tier);
const audio = createAudioEngine();
audio.setTheme(theme);
kit.applyPalette(theme.palette);
kit.setGround(0, TUNING.BASE_FOOTPRINT * 0.78, 0.42);

const hud = document.getElementById('hud') as HTMLElement;

const ctx: ModeCtx = {
  scene: kit.scene,
  camera: kit.camera,
  rig,
  materials: kit.materials,
  vfx,
  audio,
  quality: kit.quality.tier,
  theme,
  rng: new Rng(0xc0ffee),
  shake: (m, d) => kit.shake(m, d),
  flash: (a) => kit.flash(a),
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
};

const mode = createRecipeMode(ctx);

const state = {
  phase: 'attract',
  score: 0,
  combo: 0,
  progress: '',
  praise: '',
  milestone: '',
  over: null as unknown,
};

mode.events.on('score', (s) => {
  state.score = s.score;
  paint();
});
mode.events.on('combo', (c) => {
  state.combo = c;
  paint();
});
mode.events.on('progress', (p) => {
  state.progress = `${p.primary} ${p.label}`;
  paint();
});
mode.events.on('praise', (p) => {
  state.praise = `${p.label}(${p.tier})`;
  paint();
});
mode.events.on('milestone', (m) => {
  state.milestone = `${m.title}${m.sub ? ' — ' + m.sub : ''}`;
  paint();
});
mode.events.on('intensity', (v) => audio.setIntensity(v));
mode.events.on('over', (r) => {
  state.over = r;
  state.phase = 'over';
  playing = false;
  paint();
});

function paint(): void {
  hud.textContent =
    `${theme.name} / ${kit.quality.tier}  ·  score ${state.score}  combo ${state.combo}  ` +
    `${state.progress}  ${state.praise}  ${state.milestone}` +
    (state.over ? `  OVER ${JSON.stringify(state.over)}` : '');
}

let playing = false;

function begin(): void {
  void audio.unlock();
  state.over = null;
  state.praise = '';
  state.milestone = '';
  playing = true;
  mode.start();
  paint();
}

canvas.addEventListener('pointerdown', (e) => {
  void audio.unlock();
  if (!playing) {
    begin();
    return;
  }
  mode.tap(e.clientX, e.clientY);
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') begin();
});

const resize = (): void => {
  rig.setAspect(window.innerWidth / Math.max(window.innerHeight, 1));
  kit.resize(window.innerWidth, window.innerHeight);
};
window.addEventListener('resize', resize);
resize();

mode.attract();

const stats = { fps: 0, drawCalls: 0, triangles: 0, programs: 0, geometries: 0 };
kit.renderer.info.autoReset = false;

/** Simulation clock. `step()` advances it too, so headless fast-forward works. */
let simT = 0;

/** Freeze the simulation but keep rendering, so a transient frame can be shot. */
let frozen = false;

new Ticker().start(({ dt, fps }) => {
  const d = frozen ? 0 : dt;
  simT += d;
  mode.update(d, simT);
  rig.update(d, playing ? TUNING.CAM_FOLLOW_LAMBDA : 2.2);
  vfx.update(d, simT);
  kit.update(d, simT);
  kit.render();
  stats.fps = Math.round(fps);
  stats.drawCalls = kit.renderer.info.render.calls;
  stats.triangles = kit.renderer.info.render.triangles;
  stats.programs = kit.renderer.info.programs?.length ?? 0;
  stats.geometries = kit.renderer.info.memory.geometries;
  kit.renderer.info.reset();
});

/* ---------------------------------------------------------------- automation */

// The harness reaches into the mode's privates on purpose: this is a test rig,
// not shipped code, and it is the only way to drive a memory game from a script
// without also implementing a solver.
interface Peek {
  phase: string;
  recipe: number[];
  pickIndex: number;
  demoIndex: number;
  len: number;
  recipeNo: number;
  lives: number;
  palette: number;
  pass: { slots: { world: THREE.Vector3; active: boolean }[] };
}
const peek = mode as unknown as Peek;
const _p = new THREE.Vector3();

function slotScreen(i: number): { x: number; y: number } | null {
  const slot = peek.pass.slots[i];
  if (!slot) return null;
  _p.copy(slot.world);
  _p.y += 0.16;
  _p.project(kit.camera);
  return {
    x: ((_p.x + 1) / 2) * window.innerWidth,
    y: ((1 - _p.y) / 2) * window.innerHeight,
  };
}

(window as unknown as { __recipe: unknown }).__recipe = {
  stats,
  state,
  start: begin,
  stop: () => {
    playing = false;
    mode.stop();
  },
  attract: () => {
    playing = false;
    mode.attract();
  },
  peek: () => ({
    phase: peek.phase,
    recipe: peek.recipe.slice(),
    pickIndex: peek.pickIndex,
    demoIndex: peek.demoIndex,
    len: peek.len,
    recipeNo: peek.recipeNo,
    lives: peek.lives,
    palette: peek.palette,
    activeSlots: peek.pass.slots.map((s) => s.active),
  }),
  answer: () => peek.recipe[peek.pickIndex] ?? -1,
  slotScreen,
  tapSlot: (i: number) => {
    const p = slotScreen(i);
    if (!p) return false;
    return mode.tap(p.x, p.y);
  },
  tapAt: (x: number, y: number) => mode.tap(x, y),
  tapCentre: () => mode.tap(window.innerWidth / 2, window.innerHeight * 0.35),
  /**
   * Advance the simulation without rendering. Software rendering runs at 1-3
   * fps with a clamped dt, so a phase that takes 0.5s of game time would take
   * half a minute of wall clock to reach otherwise.
   */
  freeze: (v: boolean) => {
    frozen = v;
  },
  step: (frames: number) => {
    for (let i = 0; i < frames; i++) {
      simT += 1 / 60;
      mode.update(1 / 60, simT);
      rig.update(1 / 60, TUNING.CAM_FOLLOW_LAMBDA);
      vfx.update(1 / 60, simT);
    }
  },
  /** Play perfectly through `recipes` recipes, then stop on the next pick phase. */
  autoplay: (recipes: number) => {
    const target = peek.recipeNo + recipes;
    for (let guard = 0; guard < 20000; guard++) {
      const ph = peek.phase;
      if (peek.recipeNo >= target && ph === 'pick') return true;
      if (ph === 'over' || ph === 'idle') return false;
      if (ph === 'intro' || ph === 'demo') mode.tap(window.innerWidth / 2, window.innerHeight * 0.3);
      else if (ph === 'pick') {
        const a = peek.recipe[peek.pickIndex];
        const p = slotScreen(a);
        if (p) mode.tap(p.x, p.y);
      }
      simT += 1 / 60;
      mode.update(1 / 60, simT);
      rig.update(1 / 60, TUNING.CAM_FOLLOW_LAMBDA);
      vfx.update(1 / 60, simT);
    }
    return false;
  },
  /** Deliberately pick wrong `n` times, to see the reject + nudge states. */
  missTimes: (n: number) => {
    for (let k = 0; k < n; k++) {
      if (peek.phase !== 'pick') break;
      const right = peek.recipe[peek.pickIndex];
      let wrong = -1;
      for (let i = 0; i < peek.pass.slots.length; i++) {
        if (peek.pass.slots[i].active && i !== right) { wrong = i; break; }
      }
      if (wrong < 0) break;
      const p = slotScreen(wrong);
      if (p) mode.tap(p.x, p.y);
      for (let f = 0; f < 6; f++) { simT += 1/60; mode.update(1/60, simT); vfx.update(1/60, simT); }
    }
  },
  setActiveAll: () => {
    // Force every slot out, for a worst-case draw-call reading.
    for (let i = 0; i < peek.pass.slots.length; i++) {
      (peek.pass as unknown as { activate(i: number): void }).activate(i);
    }
  },
  /** Walk the mode's scene graph and total the visible meshes it owns. */
  census: () => {
    const root = (mode as unknown as { root: THREE.Object3D }).root;
    const groups: Record<string, { meshes: number; tris: number; cast: number }> = {};
    const walk = (o: THREE.Object3D, label: string, vis: boolean) => {
      const v = vis && o.visible;
      const l = o.name && o.name.startsWith('recipe.') ? o.name.split('.').slice(0, 2).join('.') : label;
      const m = o as THREE.Mesh;
      if (m.isMesh && v) {
        const g = (groups[l] ??= { meshes: 0, tris: 0, cast: 0 });
        const im = o as THREE.InstancedMesh;
        const n = im.isInstancedMesh ? im.count : 1;
        const idx = m.geometry.getIndex();
        const t = (idx ? idx.count : m.geometry.getAttribute('position')?.count ?? 0) / 3;
        g.meshes += 1;
        g.tris += Math.round(t * n);
        if (o.castShadow) g.cast += 1;
      }
      for (const c of o.children) walk(c, l, v);
    };
    walk(root, 'other', true);
    let meshes = 0, tris = 0, cast = 0;
    for (const k of Object.keys(groups)) { meshes += groups[k].meshes; tris += groups[k].tris; cast += groups[k].cast; }
    return { groups, meshes, tris, cast };
  },
  /** Hide everything the MODE adds, leaving the theme's plate + environment. */
  hideMode: (hide: boolean) => {
    const root = (mode as unknown as { root: THREE.Object3D }).root;
    for (const c of root.children) {
      if (c.name === 'recipe.pass' || c.name === 'recipe.cloche' || c.name === 'recipe.dish') {
        c.visible = !hide;
      }
    }
  },
};
