import type { QualityTier, Settings } from '../../core/types';
import { applyPaper, tearLine } from '../components/material';
import { createSheet } from '../components/sheet';
import { createSegmented, createSwitch } from '../components/toggle';
import type { UiCtx } from '../ctx';
import { h } from '../dom';
import { INK, PAPER } from '../snack/classes';

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

const PAD_SEED = 'settings:pad';

/**
 * Settings is the order pad: one sheet of ticket paper on the tray, the
 * preferences written down its length, and a perforated tear-line where one
 * group of orders ends and the next begins.
 *
 * The rows are the toggle component's own — a switch is a condiment sachet and
 * a segmented control is the other half of that same role. They sit *on* the
 * pad rather than inside a rounded glass box, which is the one piece of the old
 * Apple chrome this screen was still carrying.
 */
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

  /**
   * A block of the pad. Plain `<section>`s, so the rows stack flush and the
   * `.sn-row + .sn-row` hairline reads as a ruled line rather than a gap.
   */
  const block = (key: string, title: string, rows: readonly HTMLElement[]): HTMLElement =>
    h(
      'section',
      { class: 'sn-settings__sect', data: { group: key } },
      h('h3', { class: `sn-settings__head sn-section__title ${INK.thermal}`, text: title }),
      ...rows,
    );

  const GROUPS: ReadonlyArray<{ key: string; title: string; rows: HTMLElement[] }> = [
    { key: 'audio', title: 'Audio', rows: [sfx.el, music.el, haptics.el] },
    { key: 'display', title: 'Display', rows: [reduced.el, quality.el] },
    { key: 'controls', title: 'Controls', rows: [leftHanded.el] },
  ];

  // No `sn-e-*` silhouette on the pad. Not for the reason it used to be — an
  // edge is a mask on the paper layer now, so it would not touch a focus ring
  // — but because every edge in shapes.ts is authored against a card's
  // proportions, and this pad is nearly 500px tall: a perforation whose bite
  // is 3.9 units deep would chew 20px out of a sheet this size. The
  // perforation it does want is a real tear-line across the top instead.
  const pad = h('div', { class: `sn-settings__pad ${PAPER.ticket} ${INK.print}` });
  applyPaper(pad, { kind: 'ticket', seed: PAD_SEED, edge: 'perforated', wear: 0.16 });

  // Torn off the top of the pad, which is what makes it a pad rather than a
  // slab. Seeded off the pad, so it is the same perforation on every mount.
  const topTear = tearLine(`${PAD_SEED}:top`, 'sn-settings__tear sn-settings__tear--top');
  if (topTear) pad.appendChild(topTear);

  GROUPS.forEach((group, index) => {
    if (index > 0) {
      // Seeded off the group it precedes, never off the loop counter, so
      // re-ordering the pad never reshuffles a perforation.
      const tear = tearLine(`${PAD_SEED}:${group.key}`, 'sn-settings__tear');
      if (tear) pad.appendChild(tear);
    }
    pad.appendChild(block(group.key, group.title, group.rows));
  });

  sheet.body.appendChild(
    h(
      'div',
      { class: 'sn-stack' },
      pad,
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
