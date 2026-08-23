import type { Settings } from '../../core/types';
import { createButton } from '../components/button';
import { tearLine } from '../components/material';
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

/**
 * Bottom sheet: Resume / Restart / Home plus the three audio-ish toggles.
 *
 * Deliberately the plainest screen in the app. The sheet component already owns
 * the material here — greaseproof on a tray — so pause adds no paper of its
 * own; a pad on a sheet on a tray is the jumble sale §8 warns about. All it
 * contributes is the composition: the three actions, a perforation, the
 * switches laid straight onto the greaseproof rather than into a glass box.
 */
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

  // A plain block, so the rows stack flush and `.sn-row + .sn-row` gives the
  // ruled line. The old `.sn-group` drew a rounded translucent card, which is
  // exactly the generic glass this pass is retiring.
  const rows = h('div', { class: 'sn-pause__rows' }, sfx.el, music.el, haptics.el);
  const divider = tearLine('pause:toggles', 'sn-pause__tear');

  sheet.body.appendChild(
    h(
      'div',
      { class: 'sn-stack' },
      resume,
      h('div', { class: 'sn-duo' }, restart, home),
      divider,
      rows,
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
