import type { Settings } from '../../core/types';
import { createButton } from '../components/button';
import { createSheet } from '../components/sheet';
import { createSwitch } from '../components/toggle';
import type { UiCtx } from '../ctx';
import { h } from '../dom';
import { iconHome, iconRestart } from '../icons';

export interface PauseScreen {
  readonly el: HTMLElement;
  open(): void;
  close(done?: () => void): void;
  syncSettings(settings: Settings): void;
  destroy(): void;
}

/** Bottom sheet: Resume / Restart / Home plus the three audio-ish toggles. */
export function createPauseScreen(
  ctx: UiCtx,
  opts: { onDismiss(): void },
): PauseScreen {
  const sheet = createSheet(ctx, {
    name: 'pause',
    title: 'Paused',
    ariaLabel: 'Game paused',
    dismissible: true,
    onDismiss: opts.onDismiss,
  });

  const resume = createButton(ctx, {
    label: 'Resume',
    kind: 'primary',
    wide: true,
    onPress: () => opts.onDismiss(),
  });

  const restart = createButton(ctx, {
    label: 'Restart',
    kind: 'secondary',
    icon: iconRestart(),
    onPress: () => ctx.hooks.onRestart(),
  });

  const home = createButton(ctx, {
    label: 'Home',
    kind: 'secondary',
    icon: iconHome(),
    onPress: () => ctx.hooks.onHome(),
  });

  const s = ctx.getSettings();
  const sfx = createSwitch(ctx, {
    label: 'Sound',
    value: s.sfx,
    onChange: (v) => ctx.hooks.onSettingChange('sfx', v),
  });
  const music = createSwitch(ctx, {
    label: 'Music',
    value: s.music,
    onChange: (v) => ctx.hooks.onSettingChange('music', v),
  });
  const haptics = createSwitch(ctx, {
    label: 'Haptics',
    value: s.haptics,
    onChange: (v) => ctx.hooks.onSettingChange('haptics', v),
  });

  sheet.body.appendChild(
    h(
      'div',
      { class: 'sn-stack' },
      resume,
      h('div', { class: 'sn-duo' }, restart, home),
      h('div', { class: 'sn-group' }, sfx.el, music.el, haptics.el),
    ),
  );

  return {
    el: sheet.el,
    open: () => sheet.open(),
    close: (done) => sheet.close(done),
    syncSettings(next: Settings): void {
      sfx.set(next.sfx);
      music.set(next.music);
      haptics.set(next.haptics);
    },
    destroy: () => sheet.destroy(),
  };
}
