/**
 * Dev sandbox: boots render + vfx + audio + ui + game against a stub theme so
 * those subsystems can be exercised without depending on authored content.
 * Not part of the shipped bundle — served from sandbox.html.
 */
import { createAudioEngine } from '../audio';
import { device } from '../core/device';
import { Ticker } from '../core/ticker';
import { CameraRig } from '../game/CameraRig';
import { TUNING } from '../game/constants';
import { StackGame } from '../game/StackGame';
import { createSceneKit } from '../render';
import { createUi } from '../ui';
import { createVfx } from '../vfx';
import { stubTheme } from './stubTheme';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const appRoot = document.getElementById('app') as HTMLElement;

const kit = createSceneKit({
  canvas,
  quality: device.suggestedQuality,
  pixelRatio: Math.min(window.devicePixelRatio || 1, device.maxPixelRatio),
});
const rig = new CameraRig(kit.camera);
const vfx = createVfx(kit.scene, kit.camera, kit.materials, kit.quality.tier);
const audio = createAudioEngine();

let playing = false;

const noop = () => undefined;
const ui = createUi(appRoot, {
  onUiPress: () => void audio.unlock(),
  onPlay: () => {
    playing = true;
    game.start();
    ui.goGame();
    audio.startMusic();
  },
  onRestart: () => {
    playing = true;
    game.start();
    ui.goGame();
  },
  onHome: () => {
    playing = false;
    game.attract();
    ui.goHome();
  },
  onPause: () => ui.goPause(),
  onResume: () => ui.goGame(),
  onOpenStore: () => ui.goStore(),
  onCloseStore: () => (playing ? ui.goGame() : ui.goHome()),
  onOpenSettings: () => ui.goSettings(),
  onCloseSettings: () => (playing ? ui.goGame() : ui.goHome()),
  onSelectTheme: noop,
  onBuy: noop,
  onRestorePurchases: noop,
  onSettingChange: noop,
  onShare: noop,
});

const game = new StackGame({
  scene: kit.scene,
  rig,
  materials: kit.materials,
  vfx,
  audio,
  quality: kit.quality.tier,
  shake: (m, d) => kit.shake(m, d),
  flash: (a) => kit.flash(a),
});

game.setTheme(stubTheme);
audio.setTheme(stubTheme);
kit.applyPalette(stubTheme.palette);
ui.applyTheme(stubTheme);
kit.setGround(0, TUNING.BASE_FOOTPRINT * 0.78, 0.42);

game.events.on('score', ({ score, pop, delta }) => ui.setScore(score, { pop, delta }));
game.events.on('combo', (c) => ui.setCombo(c));
game.events.on('perfect', ({ label, tier }) => ui.showPerfect(label, tier));
game.events.on('milestone', ({ title, sub }) => ui.showMilestone(title, sub));
game.events.on('intensity', (v) => audio.setIntensity(v));
game.events.on('gameover', (s) => {
  playing = false;
  ui.goResult({
    score: s.score,
    layers: s.layers,
    best: Math.max(s.score, 120),
    isNewBest: s.score > 120,
    perfects: s.perfects,
    bestCombo: s.bestCombo,
    coinsEarned: 42,
    themeId: 'diner',
    heightCm: s.heightCm,
  });
});

canvas.addEventListener('pointerdown', () => {
  void audio.unlock();
  if (playing) game.drop();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && playing) game.drop();
});

const resize = () => {
  rig.setAspect(window.innerWidth / Math.max(window.innerHeight, 1));
  kit.resize(window.innerWidth, window.innerHeight);
};
window.addEventListener('resize', resize);
resize();

const stats = { fps: 0, drawCalls: 0, triangles: 0, programs: 0 };
(window as unknown as { __snackeryStats?: typeof stats }).__snackeryStats = stats;
kit.renderer.info.autoReset = false;

ui.dismissBoot();
game.attract();
ui.goHome();

new Ticker().start(({ dt, elapsed, fps }) => {
  game.update(dt, elapsed);
  rig.update(dt, playing ? TUNING.CAM_FOLLOW_LAMBDA : 2.2);
  vfx.update(dt, elapsed);
  kit.update(dt, elapsed);
  kit.render();
  stats.fps = Math.round(fps);
  stats.drawCalls = kit.renderer.info.render.calls;
  stats.triangles = kit.renderer.info.render.triangles;
  stats.programs = kit.renderer.info.programs?.length ?? 0;
  kit.renderer.info.reset();
});
