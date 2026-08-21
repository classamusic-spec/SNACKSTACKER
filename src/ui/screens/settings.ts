import type { QualityTier, Settings } from '../../core/types';
import { createSheet } from '../components/sheet';
import { createSegmented, createSwitch } from '../components/toggle';
import type { UiCtx } from '../ctx';
import { h } from '../dom';

export interface SettingsScreen {
  readonly el: HTMLElement;
  open(): void;
  close(done?: () => void): void;
  syncSettings(settings: Settings): void;
  destroy(): void;
}

type QualityValue = QualityTier | 'auto';

const QUALITY_OPTIONS: ReadonlyArray<{ value: QualityValue; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

/** Grouped rows, iOS switches, and one segmented control for quality. */
export function createSettingsScreen(
  ctx: UiCtx,
  opts: { onDismiss(): void },
): SettingsScreen {
  const sheet = createSheet(ctx, {
    name: 'settings',
    title: 'Settings',
    ariaLabel: 'Settings',
    variant: 'tall',
    dismissible: true,
    onDismiss: opts.onDismiss,
  });

  const s = ctx.getSettings();

  const sfx = createSwitch(ctx, {
    label: 'Sound',
    hint: 'Drops, slices and perfect chimes.',
    value: s.sfx,
    onChange: (v) => ctx.hooks.onSettingChange('sfx', v),
  });
  const music = createSwitch(ctx, {
    label: 'Music',
    hint: 'Adaptive score that climbs with the tower.',
    value: s.music,
    onChange: (v) => ctx.hooks.onSettingChange('music', v),
  });
  const haptics = createSwitch(ctx, {
    label: 'Haptics',
    hint: 'A tap you can feel on every landing.',
    value: s.haptics,
    onChange: (v) => ctx.hooks.onSettingChange('haptics', v),
  });
  const reduced = createSwitch(ctx, {
    label: 'Reduced Motion',
    hint: 'Cuts shake, sparkle and parallax.',
    value: s.reducedMotion,
    onChange: (v) => ctx.hooks.onSettingChange('reducedMotion', v),
  });
  const quality = createSegmented<QualityValue>(ctx, {
    label: 'Quality',
    options: QUALITY_OPTIONS,
    value: s.quality,
    onChange: (v) => ctx.hooks.onSettingChange('quality', v),
  });
  const leftHanded = createSwitch(ctx, {
    label: 'Left-handed',
    hint: 'Moves the pause button to the other side.',
    value: s.leftHanded,
    onChange: (v) => ctx.hooks.onSettingChange('leftHanded', v),
  });

  const group = (title: string, ...rows: HTMLElement[]): HTMLElement =>
    h(
      'section',
      { class: 'sn-section' },
      h('h3', { class: 'sn-section__title', text: title }),
      h('div', { class: 'sn-group' }, ...rows),
    );

  sheet.body.appendChild(
    h(
      'div',
      { class: 'sn-stack' },
      group('Audio', sfx.el, music.el, haptics.el),
      group('Display', reduced.el, quality.el),
      group('Controls', leftHanded.el),
      h('p', {
        class: 'sn-fineprint',
        text: 'Snackery — Stack the snack.',
      }),
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
      reduced.set(next.reducedMotion);
      quality.set(next.quality);
      leftHanded.set(next.leftHanded);
    },
    destroy: () => sheet.destroy(),
  };
}
