/**
 * Snackery UI shell.
 *
 * A thin, confident layer of glass over the game. The root container is
 * `pointer-events: none` so every tap falls through to the canvas — only real
 * controls opt back in. Screens are plain DOM built by `h()`; there is no
 * framework and no runtime dependency.
 */

import '../styles/ui.css';

import type { ThemeDef } from '../content/api';
import type { RunResult, Settings, SkuId } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';
import type { HudState, ScreenId, StoreView, Ui, UiHooks } from './api';
import { createToastHost } from './components/toast';
import type { PressKind, ToastKind, UiCtx } from './ctx';
import { Bag, h } from './dom';
import { prefersReducedMotion, setReducedMotion } from './motion';
import { applyThemeVars } from './theme';
import { createBootScreen } from './screens/boot';
import { createGameScreen } from './screens/game';
import { createHomeScreen } from './screens/home';
import { createPauseScreen } from './screens/pause';
import { createResultScreen } from './screens/result';
import { createSettingsScreen } from './screens/settings';
import { createStoreScreen } from './screens/store';

type ModalId = 'pause' | 'result' | 'store' | 'settings';

interface ModalEntry {
  id: ModalId;
  el: HTMLElement;
  open(): void;
  close(done?: () => void): void;
  /** Back gesture / scrim tap / close button. */
  onBack(): void;
  /** Called when the entry leaves the stack for good. */
  teardown?(): void;
}

export function createUi(root: HTMLElement, hooks: UiHooks): Ui {
  const bag = new Bag();

  // The UI owns its own container so we never set `pointer-events: none` on an
  // element the integrator might also parent the canvas to.
  const rootEl = h('div', { class: 'sn-root', data: { reducedMotion: '0' } });
  const stage = h('div', { class: 'sn-stage' });
  rootEl.appendChild(stage);
  root.appendChild(rootEl);

  let settings: Settings = { ...DEFAULT_SETTINGS };
  let disposed = false;

  let base: 'home' | 'game' = 'home';
  let bootVisible = true;
  let pendingHomeEnter = true;
  const stack: ModalEntry[] = [];

  const toasts = createToastHost();
  rootEl.appendChild(toasts.el);

  const press = (kind: PressKind): void => {
    try {
      hooks.onUiPress(kind);
    } catch {
      /* audio unlock must never break navigation */
    }
  };

  /**
   * Opening a purely-visual surface is normally the integrator's job (it feeds
   * `setStoreView` first). If the host does not route the request within a
   * tick, we open it ourselves so the UI is never a dead end.
   */
  const ensureLater = (id: ModalId): void => {
    bag.after(() => {
      if (disposed) return;
      if (stack.some((m) => m.id === id)) return;
      if (id === 'store') openStore();
      else if (id === 'settings') openSettings();
      else if (id === 'pause') openPause();
    }, 0);
  };

  const wrappedHooks: UiHooks = {
    onPlay: () => hooks.onPlay(),
    onRestart: () => hooks.onRestart(),
    onHome: () => hooks.onHome(),
    onPause: () => {
      hooks.onPause();
      ensureLater('pause');
    },
    onResume: () => hooks.onResume(),
    onOpenStore: () => {
      hooks.onOpenStore();
      ensureLater('store');
    },
    onCloseStore: () => hooks.onCloseStore(),
    onOpenSettings: () => {
      hooks.onOpenSettings();
      ensureLater('settings');
    },
    onCloseSettings: () => hooks.onCloseSettings(),
    onSelectTheme: (id) => hooks.onSelectTheme(id),
    onBuy: (sku) => hooks.onBuy(sku),
    onRestorePurchases: () => hooks.onRestorePurchases(),
    onSettingChange: (key, value) => {
      // Optimistic local echo keeps switches instant even if the host is slow.
      settings = { ...settings, [key]: value };
      applyLocalSettings();
      hooks.onSettingChange(key, value);
    },
    onShare: (result) => hooks.onShare(result),
    onUiPress: (kind) => hooks.onUiPress(kind),
  };

  const ctx: UiCtx = {
    hooks: wrappedHooks,
    press,
    getSettings: () => settings,
    reduced: () => settings.reducedMotion || prefersReducedMotion(),
    toast: (message, kind) => toasts.show(message, kind),
  };

  const home = createHomeScreen(ctx);
  const game = createGameScreen(ctx);

  let pauseScreen: ReturnType<typeof createPauseScreen> | null = null;
  let settingsScreen: ReturnType<typeof createSettingsScreen> | null = null;
  let storeScreen: ReturnType<typeof createStoreScreen> | null = null;
  let lastStoreView: StoreView | null = null;
  let pendingSku: SkuId | null = null;

  // ---------------------------------------------------------------- settings
  function applyLocalSettings(): void {
    const reduced = settings.reducedMotion || prefersReducedMotion();
    setReducedMotion(reduced);
    rootEl.dataset['reducedMotion'] = reduced ? '1' : '0';
    game.setLeftHanded(settings.leftHanded);
    pauseScreen?.syncSettings(settings);
    settingsScreen?.syncSettings(settings);
  }

  // ------------------------------------------------------------------ stack
  function topModal(): ModalEntry | null {
    return stack.length > 0 ? stack[stack.length - 1] : null;
  }

  let focusBeforeModal: HTMLElement | null = null;

  function pushModal(entry: ModalEntry): void {
    if (stack.some((m) => m.id === entry.id)) return;
    if (stack.length === 0) {
      const active = document.activeElement;
      focusBeforeModal =
        active instanceof HTMLElement && stage.contains(active) ? active : null;
      focusBeforeModal?.blur();
      // Hide the screen behind the sheet from assistive tech.
      stage.setAttribute('aria-hidden', 'true');
    }
    stack.push(entry);
    rootEl.appendChild(entry.el);
    rootEl.dataset['modal'] = entry.id;
    entry.open();
  }

  function popModal(id: ModalId, instant = false): void {
    const index = stack.findIndex((m) => m.id === id);
    if (index < 0) return;
    const entry = stack[index];
    stack.splice(index, 1);
    const next = topModal();
    if (next) {
      rootEl.dataset['modal'] = next.id;
    } else {
      delete rootEl.dataset['modal'];
      stage.removeAttribute('aria-hidden');
      const restore = focusBeforeModal;
      focusBeforeModal = null;
      if (restore && restore.isConnected) {
        try {
          restore.focus({ preventScroll: true });
        } catch {
          /* focus restore is best-effort */
        }
      }
    }
    if (instant) {
      entry.el.remove();
      entry.teardown?.();
    } else {
      entry.close(() => entry.teardown?.());
    }
  }

  function closeAllModals(instant = false): void {
    for (const entry of stack.slice().reverse()) popModal(entry.id, instant);
  }

  // ------------------------------------------------------------------ modals
  function openPause(): void {
    if (!pauseScreen) {
      pauseScreen = createPauseScreen(ctx, { onDismiss: () => dismissPause() });
    }
    pauseScreen.syncSettings(settings);
    const screen = pauseScreen;
    pushModal({
      id: 'pause',
      el: screen.el,
      open: () => screen.open(),
      close: (done) => screen.close(done),
      onBack: () => dismissPause(),
    });
  }

  function dismissPause(): void {
    popModal('pause');
    wrappedHooks.onResume();
  }

  function openSettings(): void {
    if (!settingsScreen) {
      settingsScreen = createSettingsScreen(ctx, { onDismiss: () => dismissSettings() });
    }
    settingsScreen.syncSettings(settings);
    const screen = settingsScreen;
    pushModal({
      id: 'settings',
      el: screen.el,
      open: () => screen.open(),
      close: (done) => screen.close(done),
      onBack: () => dismissSettings(),
    });
  }

  function dismissSettings(): void {
    popModal('settings');
    wrappedHooks.onCloseSettings();
  }

  function getStore(): ReturnType<typeof createStoreScreen> {
    if (!storeScreen) {
      storeScreen = createStoreScreen(ctx, { onDismiss: () => dismissStore() });
      if (lastStoreView) storeScreen.setView(lastStoreView);
      storeScreen.setPending(pendingSku);
    }
    return storeScreen;
  }

  function openStore(): void {
    const screen = getStore();
    pushModal({
      id: 'store',
      el: screen.el,
      open: () => screen.open(),
      close: (done) => screen.close(done),
      onBack: () => dismissStore(),
    });
  }

  function dismissStore(): void {
    popModal('store');
    wrappedHooks.onCloseStore();
  }

  function openResult(result: RunResult): void {
    closeAllModals();
    game.setCoach(false);
    rootEl.classList.add('is-result');
    const screen = createResultScreen(ctx, result, { onDismiss: () => wrappedHooks.onHome() });
    pushModal({
      id: 'result',
      el: screen.el,
      open: () => screen.open(),
      close: (done) => screen.close(done),
      onBack: () => {
        // The result screen is terminal: Back means "go home", and the host
        // closes it by calling goHome()/goGame().
        wrappedHooks.onHome();
      },
      teardown: () => {
        rootEl.classList.remove('is-result');
        screen.destroy();
      },
    });
  }

  // ----------------------------------------------------------------- screens
  function mountBase(next: 'home' | 'game', instant: boolean): void {
    if (base === next && next === 'home' && home.el.isConnected) {
      if (!instant && !bootVisible) home.enter(false);
      return;
    }
    if (base === next && next === 'game' && game.el.isConnected) return;

    if (next === 'home') {
      if (game.el.isConnected) game.exit();
      game.setCoach(false);
      stage.appendChild(home.el);
      if (bootVisible) {
        pendingHomeEnter = !instant;
        home.enter(true);
      } else {
        home.enter(instant);
      }
    } else {
      if (home.el.isConnected) home.exit();
      stage.appendChild(game.el);
      game.setLeftHanded(settings.leftHanded);
      game.enter();
    }
    base = next;
  }

  // Home is mounted immediately so the boot overlay cross-dissolves onto it.
  stage.appendChild(home.el);
  home.enter(true);

  const boot = createBootScreen();
  rootEl.appendChild(boot.el);

  applyLocalSettings();

  // Keep JS motion in step with a mid-session OS accessibility change.
  if (typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => applyLocalSettings();
    mq.addEventListener('change', onChange);
    bag.own(() => mq.removeEventListener('change', onChange));
  }

  const ui: Ui = {
    get root(): HTMLElement {
      return rootEl;
    },
    get screen(): ScreenId {
      if (bootVisible) return 'boot';
      const top = topModal();
      if (top) return top.id;
      return base;
    },

    setLoadProgress(p: number): void {
      boot.setProgress(p);
    },

    dismissBoot(): void {
      if (!bootVisible) return;
      bootVisible = false;
      boot.dismiss(() => undefined);
      // The home lockup arrives *under* the cross-dissolve, so the wordmark is
      // already settling as the boot field clears.
      if (base === 'home' && pendingHomeEnter) {
        pendingHomeEnter = false;
        bag.after(() => {
          if (!disposed && base === 'home') home.enter(false);
        }, 140);
      }
    },

    goHome(opts?: { instant?: boolean }): void {
      const instant = opts?.instant === true;
      closeAllModals(instant);
      mountBase('home', instant);
    },

    goGame(): void {
      closeAllModals();
      mountBase('game', false);
    },

    goPause(): void {
      openPause();
    },

    goResult(result: RunResult): void {
      openResult(result);
    },

    goStore(): void {
      openStore();
    },

    goSettings(): void {
      openSettings();
    },

    back(): boolean {
      if (bootVisible) return false;
      const top = topModal();
      if (!top) return false;
      press('back');
      top.onBack();
      return true;
    },

    setHud(state: HudState): void {
      game.setHud(state);
      home.setBest(state.best);
      home.setCoins(state.coins);
      storeScreen?.setCoins(state.coins);
    },

    setScore(score: number, opts?: { pop?: boolean; delta?: number }): void {
      game.setScore(score, opts);
    },

    setCombo(combo: number): void {
      game.setCombo(combo);
    },

    showPerfect(label: string, tier: number): void {
      game.showPerfect(label, tier);
    },

    showMilestone(text: string, sub?: string): void {
      game.showMilestone(text, sub);
    },

    setCoins(coins: number, opts?: { animate?: boolean }): void {
      const animate = opts?.animate === true;
      home.setCoins(coins, animate);
      storeScreen?.setCoins(coins, animate);
    },

    applyTheme(next: ThemeDef): void {
      applyThemeVars(rootEl, next);
      home.setThemeName(next.name);
    },

    setStoreView(view: StoreView): void {
      lastStoreView = view;
      getStore().setView(view);
      home.setCoins(view.coins);
    },

    setSettings(next: Settings): void {
      settings = { ...next };
      applyLocalSettings();
    },

    setBest(best: number): void {
      home.setBest(best);
      game.setBest(best);
    },

    setCoach(visible: boolean): void {
      game.setCoach(visible);
    },

    toast(message: string, kind?: ToastKind): void {
      toasts.show(message, kind);
    },

    setSkuPending(sku: SkuId | null): void {
      pendingSku = sku;
      storeScreen?.setPending(sku);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      bag.disposeAll();
      for (const entry of stack.splice(0)) {
        entry.el.remove();
        entry.teardown?.();
      }
      pauseScreen?.destroy();
      settingsScreen?.destroy();
      storeScreen?.destroy();
      boot.destroy();
      toasts.destroy();
      home.destroy();
      game.destroy();
      rootEl.remove();
    },
  };

  return ui;
}
