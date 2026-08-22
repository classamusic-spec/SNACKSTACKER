import * as THREE from 'three';
import { createAudioEngine } from './audio';
import { themes } from './content';
import type { ThemeDef } from './content/api';
import { device } from './core/device';
import { haptic, initHaptics, setHapticsEnabled } from './core/haptics';
import { clamp01 } from './core/math';
import { Ticker } from './core/ticker';
import type { QualityTier, RunResult, Settings, SkuId, ThemeId } from './core/types';
import { CameraRig } from './game/CameraRig';
import { TUNING } from './game/constants';
import { StackGame } from './game/StackGame';
import { createMeta } from './meta';
import { createSceneKit } from './render';
import type { SceneKit } from './render/api';
import { createUi } from './ui';
import type { StoreItemView } from './ui/api';
import { createVfx } from './vfx';
import type { VfxSystem } from './vfx/api';

type AppState = 'boot' | 'home' | 'playing' | 'paused' | 'result';

/**
 * The card is a single button, so its label must name the action that tap will
 * take. Coins have no other sink, so whenever the player can afford a theme
 * with coins that is strictly the better deal and the tap takes it — the label
 * says so rather than showing a money price we are not going to charge.
 */
function actionLabel(
  priceUsd: number,
  coinPrice: number | null,
  coins: number,
  owned: boolean,
): { priceLabel: string; subLabel?: string } {
  if (owned) return { priceLabel: 'Owned' };
  if (priceUsd <= 0) return { priceLabel: 'Free' };
  if (coinPrice !== null && coins >= coinPrice) {
    return { priceLabel: `Unlock · ${coinPrice.toLocaleString()} coins` };
  }
  const money = `$${priceUsd.toFixed(2)}`;
  if (coinPrice === null) return { priceLabel: money };
  return {
    priceLabel: money,
    subLabel: `or ${coins.toLocaleString()} / ${coinPrice.toLocaleString()} coins earned`,
  };
}

/**
 * Boot phase timings. A stacker has to open instantly, so it is worth knowing
 * which phase costs what rather than guessing — especially the split between
 * CPU work (procedural geometry and canvas textures, which a faster GPU will
 * not help) and shader compilation.
 */
const bootMarks: Array<[string, number]> = [];
let lastMark = 0;
function mark(name: string): void {
  const now = performance.now();
  bootMarks.push([name, Math.round(now - lastMark)]);
  lastMark = now;
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

async function boot(): Promise<void> {
  lastMark = performance.now();
  const canvas = document.getElementById('gl') as HTMLCanvasElement | null;
  const appRoot = document.getElementById('app');
  if (!canvas || !appRoot) throw new Error('Snackery: missing #gl or #app');

  initHaptics();

  const meta = createMeta();
  const settings = () => meta.data.settings;

  const resolveQuality = (): QualityTier => {
    const chosen = settings().quality;
    return chosen === 'auto' ? device.suggestedQuality : chosen;
  };

  // Resolve the saved theme before the renderer exists, so the very first
  // frame is already in the player's palette rather than flashing the default.
  let theme: ThemeDef = themes.byId(meta.data.selectedTheme);

  /**
   * Built after the UI, so the splash is on screen and animating before the
   * expensive work starts. Everything that closes over these is a user-gesture
   * handler, which cannot fire until long after they are assigned.
   */
  let kit!: SceneKit;
  let rig!: CameraRig;
  let vfx!: VfxSystem;
  let game!: StackGame;
  const audio = createAudioEngine();

  let state: AppState = 'boot';
  let lastResult: RunResult | null = null;
  /** Mirrors the run's live HUD numbers so a partial refresh never blanks them. */
  const hud = { score: 0, layers: 0, combo: 0 };

  const makeGame = (): StackGame =>
    new StackGame({
      scene: kit.scene,
      rig,
      materials: kit.materials,
      vfx,
      audio,
      quality: kit.quality.tier,
      shake: (m, d) => kit.shake(m, d),
      flash: (a) => kit.flash(a),
    });

  // ---------------------------------------------------------------------------
  // UI wiring
  // ---------------------------------------------------------------------------

  const buildStoreView = () => {
    const items: StoreItemView[] = meta.skus.map((sku) => {
      const themeDef = sku.themeId ? themes.byId(sku.themeId) : null;
      const owned = meta.isOwned(sku.id);
      const action = actionLabel(sku.priceUsd, sku.coinPrice, meta.data.coins, owned);
      return {
        sku: sku.id,
        themeId: sku.themeId,
        name: themeDef?.name ?? 'Full Menu',
        tagline: themeDef?.tagline ?? 'Every theme, forever. One tap, done.',
        glyph: themeDef?.glyph ?? '🍱',
        priceLabel: action.priceLabel,
        subLabel: action.subLabel,
        owned,
        selected: themeDef ? meta.data.selectedTheme === themeDef.id : false,
        badge: sku.badge,
        swatches: themeDef
          ? [
              themeDef.palette.accent,
              themeDef.palette.accentSoft,
              themeDef.palette.bgTop,
              themeDef.palette.bgBottom,
            ]
          : [0xffc46b, 0xff5fa2, 0x7fd1c1, 0xffffff],
        ingredients: themeDef ? themeDef.foods.slice(0, 4).map((f) => f.name) : [],
      };
    });
    return { items, coins: meta.data.coins };
  };

  const applyTheme = (next: ThemeDef, rebuild: boolean): void => {
    theme = next;
    // Reachable from the store before the renderer exists; the palette is
    // handed to createSceneKit at construction anyway, so skipping is safe.
    if (!kit || !game) return;
    kit.applyPalette(next.palette);
    ui.applyTheme(next);
    audio.setTheme(next);
    game.setTheme(next);
    if (rebuild && (state === 'home' || state === 'boot')) game.attract();
  };

  const ui = createUi(appRoot, {
    onUiPress: (kind) => {
      void audio.unlock();
      audio.play(kind === 'back' ? 'ui_back' : kind === 'toggle' ? 'ui_toggle' : 'ui_tap');
      haptic('selection');
    },
    onPlay: () => startRun(),
    onRestart: () => startRun(),
    onHome: () => goHome(),
    onPause: () => pause(),
    onResume: () => resume(),
    onOpenStore: () => {
      ui.setStoreView(buildStoreView());
      ui.goStore();
    },
    onCloseStore: () => {
      if (state === 'playing' || state === 'paused') ui.goGame();
      // The result screen is still mounted underneath the store sheet, so
      // re-opening it would tear it down and rebuild it: the score replays its
      // count-up and the HUD fades back in behind the card. Closing the sheet
      // is enough.
      else if (state === 'result') return;
      else ui.goHome();
    },
    onOpenSettings: () => {
      ui.setSettings(settings());
      ui.goSettings();
    },
    onCloseSettings: () => {
      if (state === 'playing' || state === 'paused') ui.goGame();
      else ui.goHome();
    },
    onSelectTheme: (id: ThemeId) => {
      if (!meta.selectTheme(id)) {
        ui.toast('Unlock this theme first', 'error');
        return;
      }
      applyTheme(themes.byId(id), true);
      ui.setStoreView(buildStoreView());
      ui.toast(`${themes.byId(id).name} selected`, 'success');
    },
    onBuy: (sku: SkuId) => {
      void (async () => {
        ui.setSkuPending(sku);
        const entry = meta.skuFor(sku);
        const affordableWithCoins =
          !!entry?.coinPrice && meta.data.coins >= entry.coinPrice;
        const outcome = await meta.purchase(sku, affordableWithCoins ? 'coins' : 'money');
        ui.setSkuPending(null);
        if (outcome.ok) {
          audio.play('purchase');
          haptic('success');
          ui.setStoreView(buildStoreView());
          ui.setCoins(meta.data.coins, { animate: true });
          const label = affordableWithCoins ? 'Unlocked with coins' : 'Unlocked';
          ui.toast(label, 'success');
          const first = outcome.granted.find((g) => meta.skuFor(g)?.themeId);
          const themeId = first ? meta.skuFor(first)?.themeId : entry?.themeId;
          if (themeId && meta.selectTheme(themeId)) {
            applyTheme(themes.byId(themeId), true);
            ui.setStoreView(buildStoreView());
          }
        } else if (outcome.reason === 'insufficient_coins') {
          ui.toast('Not enough coins yet', 'error');
        } else if (outcome.reason !== 'cancelled') {
          ui.toast('Purchase failed', 'error');
        }
      })();
    },
    onRestorePurchases: () => {
      void (async () => {
        const restored = await meta.restorePurchases();
        ui.setStoreView(buildStoreView());
        ui.toast(
          restored.length ? `Restored ${restored.length} item(s)` : 'Nothing to restore',
          restored.length ? 'success' : 'info',
        );
      })();
    },
    onSettingChange: <K extends keyof Settings>(key: K, value: Settings[K]) => {
      meta.setSetting(key, value);
      const s = settings();
      if (kit) kit.setShakeScale(s.reducedMotion ? 0 : 1);
      audio.setSfxEnabled(s.sfx);
      audio.setMusicEnabled(s.music);
      setHapticsEnabled(s.haptics);
      if (key === 'quality') applyQuality();
      ui.setSettings(s);
    },
    onShare: (result: RunResult) => {
      const text = `I stacked ${result.layers} layers (${result.score} pts) in Snackery. Beat that.`;
      const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
      if (nav.share) {
        nav.share({ title: 'Snackery', text, url: location.href }).catch(() => undefined);
      } else if (navigator.clipboard) {
        navigator.clipboard
          .writeText(`${text} ${location.href}`)
          .then(() => ui.toast('Copied to clipboard', 'success'))
          .catch(() => ui.toast('Could not share', 'error'));
      } else {
        ui.toast('Sharing is not available here', 'error');
      }
    },
  });

  const TIER_RANK: Record<QualityTier, number> = { low: 0, medium: 1, high: 2 };

  function applyQuality(): void {
    const want = resolveQuality();
    let guard = 4;
    while (TIER_RANK[want] < TIER_RANK[kit.quality.tier] && guard-- > 0) {
      kit.degrade();
    }
    // The render pipeline can shed work live but cannot rebuild shadow maps and
    // the post chain upward, so raising the tier needs a fresh launch.
    if (TIER_RANK[want] > TIER_RANK[kit.quality.tier]) {
      ui.toast('Higher quality applies next launch', 'info');
    }
  }

  // ---------------------------------------------------------------------------
  // state transitions
  // ---------------------------------------------------------------------------

  function goHome(): void {
    state = 'home';
    game.attract();
    audio.setIntensity(0.15);
    ui.setBest(meta.data.best);
    ui.setCoins(meta.data.coins);
    ui.goHome();
  }

  function startRun(): void {
    // The splash blocks pointer input but not the tab order, so this can be
    // reached by keyboard or assistive tech before the game is constructed.
    // Bail before touching `state`, or the app strands in 'playing' with no
    // game and every subsequent Space throws.
    if (!game) return;
    void audio.unlock();
    state = 'playing';
    lastResult = null;
    hud.score = 0;
    hud.layers = 0;
    hud.combo = 0;
    game.start();
    ui.goGame();
    ui.setHud({
      score: 0,
      layers: 0,
      combo: 0,
      best: meta.data.best,
      coins: meta.data.coins,
    });
    ui.setCoach(!meta.data.seenTutorial);
    if (settings().music) audio.startMusic();
  }

  function pause(): void {
    if (state !== 'playing' || !game) return;
    // The death animation runs while state is still 'playing'. Pausing there
    // would freeze game.update() before the gameover event fires, and a Home
    // from that frozen state discarded the whole run. Let the topple finish.
    if (game.phase === 'toppling' || game.phase === 'over') return;
    state = 'paused';
    ui.goPause();
  }

  function resume(): void {
    if (state !== 'paused') return;
    state = 'playing';
    ui.goGame();
    ticker.resync();
  }

  // ---------------------------------------------------------------------------
  // game events
  // ---------------------------------------------------------------------------

  /** Attached once the game exists; the splash is already on screen by then. */
  function wireGameEvents(): void {
      game.events.on('score', ({ score, pop, delta }) => {
        hud.score = score;
        ui.setScore(score, { pop, delta });
      });
      game.events.on('combo', (combo) => {
        hud.combo = combo;
        ui.setCombo(combo);
      });
      game.events.on('perfect', ({ label, tier }) => {
        ui.showPerfect(label, tier);
        haptic(tier >= 2 ? 'heavy' : 'medium');
      });
      game.events.on('milestone', ({ title, sub }) => {
        ui.showMilestone(title, sub);
        haptic('success');
      });
      game.events.on('layer', ({ layers }) => {
        hud.layers = layers;
        ui.setHud({
          score: hud.score,
          layers,
          combo: hud.combo,
          best: meta.data.best,
          coins: meta.data.coins,
        });
      });
      game.events.on('intensity', (v) => audio.setIntensity(clamp01(v)));
      game.events.on('firstDrop', () => {
        meta.markTutorialSeen();
        ui.setCoach(false);
      });
      game.events.on('gameover', (summary) => {
        state = 'result';
        haptic('error');
        const result = meta.recordRun({
          score: summary.score,
          layers: summary.layers,
          perfects: summary.perfects,
          bestCombo: summary.bestCombo,
          heightCm: summary.heightCm,
          themeId: theme.id,
        });
        lastResult = result;
        if (result.isNewBest && result.score > 0) {
          audio.play('newbest', { delay: 0.25 });
          vfx.confetti(new THREE.Vector3(0, rig.topY + 5, 0), [
            theme.palette.accent,
            theme.palette.accentSoft,
            0xffffff,
          ]);
        }
        audio.setIntensity(0.1);
        ui.setBest(result.best);
        ui.setCoins(meta.data.coins, { animate: true });
        ui.goResult(result);
      });
  }

  // ---------------------------------------------------------------------------
  // input
  // ---------------------------------------------------------------------------

  const tryDrop = (): void => {
    if (state !== 'playing' || !game) return;
    void audio.unlock();
    // Only buzz if the drop was actually taken; during the spawn cooldown and
    // the topple `drop()` no-ops, and buzzing there feels like a lost input.
    if (game.drop()) haptic('light');
  };

  // The UI overlay is pointer-events:none except for its controls, so a tap on
  // empty screen lands here — the whole screen is the drop button.
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      e.preventDefault();
      tryDrop();
    },
    { passive: false },
  );

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      const active = document.activeElement;
      if (active instanceof HTMLButtonElement) return;
      e.preventDefault();
      if (state === 'playing') tryDrop();
      else if (state === 'home') startRun();
      else if (state === 'result') startRun();
    } else if (e.code === 'Escape') {
      if (ui.back()) return;
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
    }
  });

  window.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------------

  const onResize = (): void => {
    // Registered before the renderer exists: the mobile URL bar collapsing
    // during load fires visualViewport resize, and rotating while loading
    // fires orientationchange. Both used to throw on the unassigned bindings.
    if (!kit || !rig) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    rig.setAspect(w / Math.max(h, 1));
    kit.resize(w, h);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 120));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onResize);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      audio.suspend();
      if (state === 'playing') pause();
    } else {
      audio.resume();
      ticker.resync();
    }
  });

  const ticker = new Ticker({
    slowThreshold: 46,
    slowSeconds: 3,
    onSlow: (fps) => {
      console.info(`[snackery] ${fps.toFixed(0)}fps — dropping quality tier`);
      kit.degrade();
      ticker.armGovernor();
    },
  });

  // ---------------------------------------------------------------------------
  // start
  // ---------------------------------------------------------------------------

  mark('ui');
  ui.setLoadProgress(0.12);

  // Yield twice so the browser lays out and paints the splash before the
  // renderer's long synchronous build begins. Without this the logo appears
  // only after the work it is meant to cover has already finished.
  await nextFrame();
  await nextFrame();

  kit = createSceneKit({
    canvas,
    quality: resolveQuality(),
    pixelRatio: Math.min(window.devicePixelRatio || 1, device.maxPixelRatio),
    palette: theme.palette,
    reducedMotion: settings().reducedMotion,
  });
  mark('renderer');
  ui.setLoadProgress(0.45);
  await nextFrame();

  rig = new CameraRig(kit.camera);
  vfx = createVfx(kit.scene, kit.camera, kit.materials, kit.quality.tier);
  game = makeGame();
  wireGameEvents();
  mark('systems');

  ui.setLoadProgress(0.7);
  applyTheme(theme, false);
  mark('theme');
  onResize();
  ui.setSettings(settings());
  kit.setShakeScale(settings().reducedMotion ? 0 : 1);
  // The plate's top surface is the world's y = 0; the contact shadow sits there.
  kit.setGround(0, TUNING.BASE_FOOTPRINT * 0.78, 0.42);
  setHapticsEnabled(settings().haptics);
  audio.setSfxEnabled(settings().sfx);
  audio.setMusicEnabled(settings().music);
  ui.setStoreView(buildStoreView());
  ui.setLoadProgress(0.75);

  // Build the home state and render one frame before dismissing the boot veil,
  // so the first thing the player sees is the tower, not an empty canvas.
  goHome();
  mark('scene');
  rig.update(1 / 60, 1e6);
  kit.update(1 / 60, 0);
  kit.render();
  mark('first-render');
  ui.setLoadProgress(1);

  // A small, always-on probe. The QA harness reads it; it costs one object
  // write per frame and makes "is it actually 60fps?" answerable.
  const stats = {
    fps: 0,
    drawCalls: 0,
    triangles: 0,
    programs: 0,
    layers: 0,
    tier: kit.quality.tier as string,
    state: state as string,
    offset: null as number | null,
    boot: bootMarks as ReadonlyArray<readonly [string, number]>,
    // Leak detection: these must return to a steady state across runs.
    geometries: 0,
    textures: 0,
    programs2: 0,
    offcuts: 0,
    heapMb: 0,
  };
  (window as unknown as { __snackeryStats?: typeof stats }).__snackeryStats = stats;
  // The post chain renders several passes per frame and each one resets
  // renderer.info, so accumulate manually and reset once at the frame end.
  kit.renderer.info.autoReset = false;

  ticker.start(({ dt, elapsed, fps }) => {
    if (state !== 'paused') game.update(dt, elapsed);

    if (state === 'home' || state === 'boot') rig.update(dt, 2.2);
    else if (game.phase === 'toppling' || game.phase === 'over') rig.update(dt, 1.8);
    else rig.update(dt);

    vfx.update(dt, elapsed);
    kit.update(dt, elapsed);
    kit.render();

    stats.fps = Math.round(fps);
    stats.drawCalls = kit.renderer.info.render.calls;
    stats.triangles = kit.renderer.info.render.triangles;
    stats.programs = kit.renderer.info.programs?.length ?? 0;
    stats.layers = game.layerCount;
    stats.tier = kit.quality.tier;
    stats.state = state;
    stats.offcuts = game.debrisCount;
    stats.geometries = kit.renderer.info.memory.geometries;
    stats.textures = kit.renderer.info.memory.textures;
    stats.programs2 = kit.renderer.info.programs?.length ?? 0;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    stats.heapMb = mem ? Math.round(mem.usedJSHeapSize / 1048576) : 0;
    stats.offset = game.dropOffset;
    kit.renderer.info.reset();
  });

  requestAnimationFrame(() => ui.dismissBoot());
}

boot().catch((err) => {
  console.error('[snackery] boot failed', err);
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML =
      '<div style="position:fixed;inset:0;display:grid;place-items:center;color:#fff;' +
      'font:500 17px/1.5 -apple-system,system-ui,sans-serif;text-align:center;padding:24px">' +
      'Snackery could not start on this device.</div>';
  }
});
