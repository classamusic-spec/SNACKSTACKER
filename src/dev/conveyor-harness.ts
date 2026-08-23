/**
 * TEMPORARY dev harness for the Conveyor mode — delete with
 * `src/dev/conveyor-harness.html` once the real mode picker lands.
 *
 * Mounts a real SceneKit + CameraRig + Vfx + Audio and drives the mode through
 * the frozen GameMode contract, printing what the host would show. Query
 * params: ?theme=diner|sushi|candy|taco|breakfast|pizza &tier=low|medium|high
 * &auto=1 (bot plays itself) &phase=attract|play.
 */
import { createAudioEngine } from '../audio';
import { themes } from '../content';
import { Ticker } from '../core/ticker';
import type { QualityTier, ThemeId } from '../core/types';
import { Rng } from '../core/rng';
import { CameraRig } from '../game/CameraRig';
import { TUNING } from '../game/constants';
import { createConveyorMode } from '../modes/conveyor';
import type { ModeResult } from '../modes/api';
import * as THREE from 'three';
import { createSceneKit } from '../render';
import { createVfx } from '../vfx';

const qs = new URLSearchParams(location.search);
const themeId = (qs.get('theme') ?? 'diner') as ThemeId;
const tier = (qs.get('tier') ?? 'high') as QualityTier;
const theme = themes.byId(themeId);

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;

const kit = createSceneKit({ canvas, quality: tier, pixelRatio: 1, palette: theme.palette });
const rig = new CameraRig(kit.camera);
const vfx = createVfx(kit.scene, kit.camera, kit.materials, kit.quality.tier);
const audio = createAudioEngine();
audio.setTheme(theme);
kit.applyPalette(theme.palette);
kit.setGround(-0.13, 1.9, 0.3);

/** Renderer stats with the mode's own scene content isolated. */
const stats = {
  fps: 0,
  calls: 0,
  tris: 0,
  programs: 0,
  modeCalls: 0,
  modeTris: 0,
  envCalls: 0,
  envTris: 0,
  /** Main-pass draws the mode adds (visible meshes), and the run's peak. */
  meshes: 0,
  meshTris: 0,
  peakMeshes: 0,
  peakTris: 0,
  onBelt: 0,
  peakOnBelt: 0,
};
(window as unknown as { __conveyor?: unknown }).__conveyor = {
  stats,
  tap: (x: number, y: number) => mode.tap(x, y),
  state: () => hudState,
};

const mode = createConveyorMode({
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
});

const hudState = {
  score: 0,
  combo: 0,
  progress: '0 Orders',
  praise: '',
  milestone: '',
  intensity: 0,
  over: null as ModeResult | null,
};

mode.events.on('score', (s) => (hudState.score = s.score));
mode.events.on('combo', (c) => (hudState.combo = c));
mode.events.on('progress', (p) => (hudState.progress = `${p.primary} ${p.label}`));
mode.events.on('praise', (p) => {
  hudState.praise = `${p.label} (${p.tier})`;
  window.setTimeout(() => (hudState.praise = ''), 900);
});
mode.events.on('milestone', (m) => {
  hudState.milestone = `${m.title} ${m.sub ?? ''}`;
  window.setTimeout(() => (hudState.milestone = ''), 1100);
});
mode.events.on('intensity', (v) => {
  hudState.intensity = v;
  audio.setIntensity(v);
});
mode.events.on('firstAction', () => console.log('[harness] firstAction'));
mode.events.on('over', (r) => {
  hudState.over = r;
  console.log('[harness] over', r);
  window.setTimeout(() => {
    hudState.over = null;
    mode.start();
  }, 1600);
});

const resize = (): void => {
  rig.setAspect(window.innerWidth / Math.max(window.innerHeight, 1));
  kit.resize(window.innerWidth, window.innerHeight);
};
window.addEventListener('resize', resize);
resize();

/**
 * Leak soak: cycles start/stop and theme swaps, so renderer.info.memory can be
 * watched for geometries or textures that never come back.
 */
if (qs.get('soak') === '1') {
  let i = 0;
  const ids: ThemeId[] = ['diner', 'sushi', 'candy', 'taco', 'breakfast', 'pizza'];
  window.setInterval(() => {
    i++;
    if (i % 3 === 0) {
      const t = themes.byId(ids[(i / 3) % ids.length]);
      mode.setTheme(t);
      kit.applyPalette(t.palette);
      audio.setTheme(t);
    }
    mode.stop();
    mode.start();
    console.log('[soak]', i, JSON.stringify({
      geo: kit.renderer.info.memory.geometries,
      tex: kit.renderer.info.memory.textures,
      prog: kit.renderer.info.programs?.length ?? 0,
    }));
  }, 4000);
}

const startPhase = qs.get('phase') ?? 'play';
if (startPhase === 'attract') mode.attract();
else mode.start();

canvas.addEventListener('pointerdown', (e) => {
  void audio.unlock();
  const r = canvas.getBoundingClientRect();
  mode.tap(e.clientX - r.left, e.clientY - r.top);
});

/**
 * Main-pass draw count for the mode: every VISIBLE mesh under its two roots.
 * renderer.info.render.calls also counts the shadow pass, which doubles every
 * caster and is not what the 14-call budget is about.
 */
const _stack: THREE.Object3D[] = [];
function countMeshes(root: THREE.Object3D | null): [number, number] {
  if (!root || !root.visible) return [0, 0];
  let n = 0;
  let tris = 0;
  _stack.length = 0;
  _stack.push(root);
  while (_stack.length) {
    const o = _stack.pop()!;
    if (!o.visible) continue;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      n++;
      const g = m.geometry;
      const idx = g.index;
      const pos = g.attributes.position;
      tris += Math.floor((idx ? idx.count : pos ? pos.count : 0) / 3);
    }
    for (let i = 0; i < o.children.length; i++) _stack.push(o.children[i]);
  }
  return [n, tris];
}
function countModeMeshes(): void {
  const find = (n: string) => kit.scene.children.find((c) => c.name === n) ?? null;
  const [n, t] = countMeshes(find('conveyor.root'));
  stats.meshes = n;
  stats.meshTris = t;
  if (n > stats.peakMeshes) stats.peakMeshes = n;
  if (t > stats.peakTris) stats.peakTris = t;
}

/**
 * Draw-call split. Renders the same frame three times with subtrees hidden so
 * the mode's own cost can be told apart from the theme's environment.
 * Screenshot-time only; never on a real frame budget.
 */
let splitPending = false;
function measureSplit(): void {
  if (!splitPending) return;
  splitPending = false;
  const find = (n: string) => kit.scene.children.find((c) => c.name === n) ?? null;
  const modeRoot = find('conveyor.root');
  const stage = find('conveyor.stage');
  const sample = () => {
    kit.renderer.info.reset();
    kit.render();
    return { calls: kit.renderer.info.render.calls, tris: kit.renderer.info.render.triangles };
  };
  const all = sample();
  if (modeRoot) modeRoot.visible = false;
  const noMode = sample();
  if (stage) stage.visible = false;
  const bare = sample();
  if (modeRoot) modeRoot.visible = true;
  if (stage) stage.visible = true;
  sample();
  stats.modeCalls = all.calls - noMode.calls;
  stats.modeTris = all.tris - noMode.tris;
  stats.envCalls = noMode.calls - bare.calls;
  stats.envTris = noMode.tris - bare.tris;
}
(window as unknown as { __conveyorSplit?: () => void }).__conveyorSplit = () => {
  splitPending = true;
};

/**
 * Per-food cost. Each pool slot carries one dressing per theme food; counting
 * one slot's dressings gives the draw calls and triangles a single belt item
 * adds, which is what the 14-draw / 28k-triangle budget is spent on.
 */
(window as unknown as { __conveyorFoods?: () => unknown }).__conveyorFoods = () => {
  const root = kit.scene.children.find((c) => c.name === 'conveyor.root');
  if (!root) return null;
  // pool root is the first child added; its first child is slot 0.
  const pool = root.children[0];
  const slot0 = pool?.children?.[0];
  if (!slot0) return null;
  const per: Array<{ meshes: number; tris: number }> = [];
  for (const child of slot0.children) {
    const m = child as THREE.Mesh;
    if (m.isMesh && (m.geometry as THREE.BufferGeometry)?.attributes?.position?.count === 8 * 3) {
      continue; // the hit proxy box
    }
    let meshes = 0;
    let tris = 0;
    child.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (!mm.isMesh || !mm.geometry) return;
      meshes++;
      const g = mm.geometry;
      tris += Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
    });
    if (meshes) per.push({ meshes, tris });
  }
  // Structural: everything under the belt root that is not the pool.
  const belt = root.children[1];
  let sMesh = 0;
  let sTris = 0;
  belt?.traverse((o) => {
    const mm = o as THREE.Mesh;
    if (!mm.isMesh || !mm.geometry) return;
    sMesh++;
    const g = mm.geometry;
    sTris += Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
  });
  const maxItem = per.reduce((a, b) => (b.meshes > a.meshes ? b : a), per[0] ?? { meshes: 0, tris: 0 });
  const maxTri = per.reduce((a, b) => (b.tris > a.tris ? b : a), per[0] ?? { meshes: 0, tris: 0 });
  return { structural: { meshes: sMesh, tris: sTris }, per, maxItem, maxTri };
};

/** Renderer resource counts — a leak shows up here before it shows up as a crash. */
(window as unknown as { __conveyorMem?: () => unknown }).__conveyorMem = () => ({
  geometries: kit.renderer.info.memory.geometries,
  textures: kit.renderer.info.memory.textures,
  programs: kit.renderer.info.programs?.length ?? 0,
});

/** How many triangles of each theme mesh fall inside the belt corridor. */
(window as unknown as { __conveyorTris?: (hw: number) => unknown }).__conveyorTris = (hw = 1.6) => {
  const root = kit.scene.children.find((c) => c.name === 'conveyor.root');
  const stage = kit.scene.children.find((c) => c.name === 'conveyor.stage');
  if (!root || !stage) return null;
  stage.updateMatrixWorld(true);
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const a = new THREE.Vector3();
  const bb = new THREE.Vector3();
  const cc = new THREE.Vector3();
  const out: Array<Record<string, number | string>> = [];
  stage.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    let hit = 0;
    let xmin = 99;
    let xmax = -99;
    for (let i = 0; i + 2 < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i;
      const i1 = idx ? idx.getX(i + 1) : i + 1;
      const i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(m);
      bb.fromBufferAttribute(pos, i1).applyMatrix4(m);
      cc.fromBufferAttribute(pos, i2).applyMatrix4(m);
      const cx = (a.x + bb.x + cc.x) / 3;
      const cy = (a.y + bb.y + cc.y) / 3;
      const cz = (a.z + bb.z + cc.z) / 3;
      if (cy < 0.06 || cy > 2.4) continue;
      if (cz < -4.9 || cz > 5.5) continue;
      if (Math.abs(cx) > hw) continue;
      hit++;
      if (cx < xmin) xmin = cx;
      if (cx > xmax) xmax = cx;
    }
    if (hit) out.push({ name: o.name || '?', hit, total: Math.floor(n / 3), xmin: +xmin.toFixed(2), xmax: +xmax.toFixed(2) });
  });
  return out;
};

/** Which theme props stand in or near the belt corridor, in belt-local space. */
(window as unknown as { __conveyorProbe?: () => unknown }).__conveyorProbe = () => {
  const root = kit.scene.children.find((c) => c.name === 'conveyor.root');
  const stage = kit.scene.children.find((c) => c.name === 'conveyor.stage');
  if (!root || !stage) return null;
  stage.updateMatrixWorld(true);
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const out: Array<Record<string, number | string | boolean>> = [];
  const b = new THREE.Box3();
  const min = new THREE.Vector3();
  const max = new THREE.Vector3();
  const c = new THREE.Vector3();
  stage.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    b.setFromObject(o);
    if (!Number.isFinite(b.min.x)) return;
    min.set(Infinity, Infinity, Infinity);
    max.set(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < 8; i++) {
      c.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
      c.applyMatrix4(inv);
      min.min(c);
      max.max(c);
    }
    if (min.x > 3 || max.x < -3 || min.z > 7 || max.z < -7 || max.y < 0.05) return;
    out.push({
      name: o.name || (m.material as THREE.Material)?.name || '?',
      vis: o.visible,
      x0: +min.x.toFixed(2), x1: +max.x.toFixed(2),
      z0: +min.z.toFixed(2), z1: +max.z.toFixed(2),
      y1: +max.y.toFixed(2),
      sx: +(b.max.x - b.min.x).toFixed(2), sz: +(b.max.z - b.min.z).toFixed(2),
    });
  });
  return out;
};

// --- a very dumb bot, for soak/screenshot runs -----------------------------
const auto = qs.get('auto') === '1';
/** Software rendering runs at ~1fps, so wall time buys almost no game time. */
const dtScale = Number(qs.get('speed') ?? 1);
let autoTimer = 0;

kit.renderer.info.autoReset = false;
let gameTime = 0;
new Ticker().start(({ dt, elapsed, fps }) => {
  const step = dt * dtScale;
  gameTime += step;
  mode.update(step, gameTime);
  rig.update(dt, TUNING.CAM_FOLLOW_LAMBDA);
  vfx.update(dt, elapsed);
  kit.update(dt, elapsed);
  kit.render();

  if (auto) {
    autoTimer -= step;
    if (autoTimer <= 0) {
      autoTimer = 0.22;
      // A human waits for the item to come to them, which is also what keeps
      // the belt populated; sweeping from the far end empties it instantly.
      for (let i = 0; i < 6; i++) {
        const y = window.innerHeight * (0.86 - i * 0.05);
        if (mode.tap(window.innerWidth * 0.5, y)) break;
      }
    }
  }

  stats.fps = Math.round(fps);
  stats.calls = kit.renderer.info.render.calls;
  stats.tris = kit.renderer.info.render.triangles;
  stats.programs = kit.renderer.info.programs?.length ?? 0;
  kit.renderer.info.reset();
  countModeMeshes();
  measureSplit();

  hud.textContent =
    `${themeId}/${tier}  mode ${stats.meshes}/${stats.peakMeshes} draws  ${stats.meshTris} tris (peak ${stats.peakTris})\n` +
    `scene ${stats.calls} calls  ${stats.tris} tris  ${stats.fps}fps\n` +
    `score ${hudState.score}  combo ${hudState.combo}  ${hudState.progress}  int ${hudState.intensity.toFixed(2)}\n` +
    `${hudState.praise} ${hudState.milestone}  t${gameTime.toFixed(1)}`;
});
