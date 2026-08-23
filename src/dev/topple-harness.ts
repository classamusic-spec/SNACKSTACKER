/**
 * TEMPORARY DEV FILE — delete with topple.html and the other topple-* files.
 *
 * Mounts the Topple mode against a real SceneKit, real VFX, real audio and the
 * real themes, because the host's mode picker does not exist yet. Served from
 * /topple.html.
 *
 *   space / click / tap   place
 *   r                     restart
 *   h                     back to attract
 *   1..6                  switch theme
 *   s                     toggle the stats overlay
 */
import { createAudioEngine } from '../audio';
import { themes } from '../content';
import { device } from '../core/device';
import { Rng } from '../core/rng';
import { Ticker } from '../core/ticker';
import type { ThemeId } from '../core/types';
import { CameraRig } from '../game/CameraRig';
import { ToppleGame } from '../modes/topple';
import type { GameMode, ModeCtx } from '../modes/api';
import { createSceneKit } from '../render';
import { createVfx } from '../vfx';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;

const forced = new URLSearchParams(location.search).get('q');
const kit = createSceneKit({
  canvas,
  quality:
    forced === 'low' || forced === 'medium' || forced === 'high'
      ? forced
      : device.suggestedQuality,
  pixelRatio: Math.min(window.devicePixelRatio || 1, device.maxPixelRatio),
});
const rig = new CameraRig(kit.camera);
const vfx = createVfx(kit.scene, kit.camera, kit.materials, kit.quality.tier);
const audio = createAudioEngine();

const params = new URLSearchParams(location.search);
let theme = themes.byId((params.get('theme') as ThemeId) ?? 'diner');

const ctx: ModeCtx = {
  scene: kit.scene,
  camera: kit.camera,
  rig,
  materials: kit.materials,
  vfx,
  audio,
  quality: kit.quality.tier,
  theme,
  rng: new Rng(0x5eed1234),
  shake: (m, d) => kit.shake(m, d),
  flash: (a) => kit.flash(a),
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
};
const toppleGame = new ToppleGame(ctx);
const mode: GameMode = {
  id: 'topple',
  events: toppleGame.events,
  attract: () => toppleGame.attract(),
  start: () => toppleGame.start(),
  stop: () => toppleGame.stop(),
  update: (dt, e) => toppleGame.update(dt, e),
  tap: () => toppleGame.tap(),
  setTheme: (t) => toppleGame.setTheme(t),
  dispose: () => toppleGame.dispose(),
};
let playing = false;

const state = {
  score: 0,
  combo: 0,
  height: 0,
  praise: '',
  praiseAt: -10,
  milestone: '',
  milestoneAt: -10,
  over: '',
};

mode.events.on('score', (s) => {
  state.score = s.score;
});
mode.events.on('combo', (c) => {
  state.combo = c;
});
mode.events.on('progress', (p) => {
  state.height = p.primary;
});
mode.events.on('praise', (p) => {
  state.praise = `${p.label} (${p.tier})`;
  state.praiseAt = performance.now() / 1000;
});
mode.events.on('milestone', (m) => {
  state.milestone = `${m.title} — ${m.sub ?? ''}`;
  state.milestoneAt = performance.now() / 1000;
});
mode.events.on('intensity', (v) => audio.setIntensity(v));
mode.events.on('firstAction', () => console.log('[topple] firstAction'));
mode.events.on('over', (r) => {
  playing = false;
  state.over = `${r.score} pts · ${r.count} ${r.countLabel} · ${r.perfects} plumb · x${r.bestCombo}`;
  console.log('[topple] over', r);
});

function applyTheme(next: typeof theme): void {
  theme = next;
  (ctx as { theme: typeof theme }).theme = next;
  kit.applyPalette(next.palette);
  audio.setTheme(next);
  mode.setTheme(next);
  kit.setGround(0, 1.6, 0.42);
}

function play(): void {
  void audio.unlock();
  state.over = '';
  playing = true;
  mode.start();
}

canvas.addEventListener('pointerdown', (e) => {
  void audio.unlock();
  if (!playing) play();
  else mode.tap(e.clientX, e.clientY);
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (!playing) play();
    else mode.tap(0, 0);
  } else if (e.key === 'r') play();
  else if (e.key === 'h') {
    playing = false;
    mode.attract();
  } else if (e.key === 's') hud.classList.toggle('off');
  else if (e.key >= '1' && e.key <= '6') {
    applyTheme(themes.all[Number(e.key) - 1]);
  }
});

const resize = (): void => {
  rig.setAspect(window.innerWidth / Math.max(window.innerHeight, 1));
  kit.resize(window.innerWidth, window.innerHeight);
};
window.addEventListener('resize', resize);
resize();

applyTheme(theme);
mode.attract();

kit.renderer.info.autoReset = false;

/** Draw calls and triangles, split into what the mode owns vs the theme's world. */
function measure(): Record<string, number> {
  const out = {
    calls: kit.renderer.info.render.calls,
    tris: kit.renderer.info.render.triangles,
    items: 0,
    itemMeshes: 0,
    itemTris: 0,
    furnitureMeshes: 0,
    furnitureTris: 0,
    stageMeshes: 0,
    stageTris: 0,
  };
  const root = kit.scene.getObjectByName('topple.root');
  if (!root) return out;
  for (const child of root.children) {
    let meshes = 0;
    let tris = 0;
    child.traverse((o) => {
      const m = o as import('three').Mesh;
      if (!m.isMesh || !m.geometry) return;
      meshes++;
      const g = m.geometry;
      const count = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
      tris += count / 3;
    });
    if (child.name === 'topple.item') {
      out.items++;
      out.itemMeshes += meshes;
      out.itemTris += tris;
    } else if (child.name === 'topple.marker') {
      out.furnitureMeshes += meshes;
      out.furnitureTris += tris;
    } else {
      out.stageMeshes += meshes;
      out.stageTris += tris;
    }
  }
  out.itemTris = Math.round(out.itemTris);
  out.furnitureTris = Math.round(out.furnitureTris);
  out.stageTris = Math.round(out.stageTris);
  return out;
}

/**
 * Software rendering runs this page at 1-5fps, and the mode caps how much
 * simulation one frame may consume, so wall-clock play is 20x slow motion.
 * `advance` drives mode.update directly at a fixed 60Hz with no rendering, so a
 * tall tower or a full collapse can be reached in a second and photographed.
 */
let simClock = 0;
function advance(seconds: number, tapEvery = 0): number {
  const dt = 1 / 60;
  const n = Math.round(seconds / dt);
  let taps = 0;
  let sinceTap = 0;
  for (let i = 0; i < n; i++) {
    simClock += dt;
    mode.update(dt, simClock);
    rig.update(dt, playing ? 5.5 : 2.2);
    vfx.update(dt, simClock);
    kit.update(dt, simClock);
    if (tapEvery > 0) {
      sinceTap += dt;
      if (sinceTap >= tapEvery && mode.tap(0, 0)) {
        taps++;
        sinceTap = 0;
      }
    }
  }
  return taps;
}

/**
 * A competent simulated player: it releases on the frame where the predicted
 * landing spot is closest to the food below, with an optional timing error in
 * seconds so the harness can photograph a sloppy run as well as a clean one.
 */
function autoPlay(seconds: number, sigma = 0.05, stopOnCollapse = false): void {
  const dt = 1 / 60;
  const n = Math.round(seconds / dt);
  let lastErr = Infinity;
  let jitter = 0;
  for (let i = 0; i < n; i++) {
    simClock += dt;
    mode.update(dt, simClock);
    rig.update(dt, playing ? 5.5 : 2.2);
    vfx.update(dt, simClock);
    kit.update(dt, simClock);
    const d = toppleGame.debug;
    if (stopOnCollapse && (d.phase === 'collapsing' || d.phase === 'over')) return;
    if (d.phase !== 'aiming') {
      lastErr = Infinity;
      jitter = (Math.random() * 2 - 1) * sigma;
      continue;
    }
    const err = Math.abs(d.predicted - d.target);
    // Release just after the predicted spot stops closing on the target.
    if (err > lastErr) {
      if (jitter > 0) {
        jitter -= dt;
      } else {
        mode.tap(0, 0);
        lastErr = Infinity;
        continue;
      }
    }
    lastErr = err;
  }
}

const dev = {
  mode,
  kit,
  measure,
  advance,
  autoPlay,
  get debug() {
    return toppleGame.debug;
  },
  play,
  attract: () => {
    playing = false;
    mode.attract();
  },
  tap: () => mode.tap(0, 0),
  setTheme: (id: ThemeId) => applyTheme(themes.byId(id)),
  get playing() {
    return playing;
  },
  get state() {
    return state;
  },
};
(window as unknown as { __topple: typeof dev }).__topple = dev;

let fps = 0;
new Ticker().start(({ dt, elapsed, fps: f }) => {
  fps = f;
  mode.update(dt, elapsed);
  rig.update(dt, playing ? 5.5 : 2.2);
  vfx.update(dt, elapsed);
  kit.update(dt, elapsed);
  kit.render();

  const now = elapsed;
  const m = measure();
  hud.innerHTML =
    `<b>${state.score}</b> pts &nbsp; ${state.height} cm &nbsp; combo ${state.combo}` +
    `<br>${Math.round(fps)} fps · ${m.calls} calls · ${(m.tris / 1000).toFixed(1)}k tris` +
    `<br>items ${m.items} (${m.itemMeshes} meshes, ${(m.itemTris / 1000).toFixed(1)}k tris)` +
    `<br>mode furniture ${m.furnitureMeshes} meshes, ${m.furnitureTris} tris` +
    `<br>plate+world ${m.stageMeshes} meshes, ${(m.stageTris / 1000).toFixed(1)}k tris` +
    (now - state.praiseAt < 1.4 ? `<br><i>${state.praise}</i>` : '') +
    (now - state.milestoneAt < 2.4 ? `<br><i>${state.milestone}</i>` : '') +
    (state.over ? `<br><b>OVER</b> ${state.over} — press r` : '') +
    (!playing && !state.over ? '<br>attract — tap to play' : '');
  kit.renderer.info.reset();
});
