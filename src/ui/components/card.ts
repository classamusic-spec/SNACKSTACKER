import type { StoreItemView } from '../api';
import type { UiCtx } from '../ctx';
import { h } from '../dom';
import { iconCheck } from '../icons';
import { hexFromInt } from '../theme';

export interface StoreCardOpts {
  item: StoreItemView;
  /** Bundle treatment: full-bleed accent artwork, larger type. */
  hero?: boolean;
  pending?: boolean;
  /** Another purchase is in flight — everything is inert. */
  locked?: boolean;
  onAction(item: StoreItemView): void;
}

const MAX_INGREDIENTS = 5;

function swatchStrip(swatches: readonly number[]): HTMLElement {
  const strip = h('span', { class: 'sn-card__strip', aria: { hidden: 'true' } });
  const list = swatches.length > 0 ? swatches.slice(0, 8) : [0x8a8a8a];
  for (const c of list) {
    strip.appendChild(
      h('span', { class: 'sn-card__chipc', style: { '--c': hexFromInt(c) } }),
    );
  }
  return strip;
}

function thumb(item: StoreItemView, hero: boolean): HTMLElement {
  const sw = item.swatches.length > 0 ? item.swatches : [0x8a8a8a, 0x5a5a5a, 0x3a3a3a];
  const a = hexFromInt(sw[0] ?? 0x8a8a8a);
  const b = hexFromInt(sw[Math.min(1, sw.length - 1)] ?? a);
  const c = hexFromInt(sw[Math.min(2, sw.length - 1)] ?? b);
  return h(
    'span',
    {
      class: `sn-card__thumb${hero ? ' sn-card__thumb--hero' : ''}`,
      style: { '--a': a, '--b': b, '--c': c },
      aria: { hidden: 'true' },
    },
    h('span', { class: 'sn-card__glyph', text: item.glyph }),
  );
}

/**
 * A store card. Rendered as a single `<button>` containing only phrasing
 * content, so the entire card is one large, valid, accessible hit target.
 */
export function createStoreCard(ctx: UiCtx, opts: StoreCardOpts): HTMLButtonElement {
  const { item } = opts;
  const hero = opts.hero === true;
  const pending = opts.pending === true;
  const selected = item.owned && item.selected;
  const usable = item.owned && !item.selected;

  const classes = ['sn-card'];
  if (hero) classes.push('sn-card--hero');
  if (selected) classes.push('is-selected');
  if (pending) classes.push('is-pending');
  if (!item.owned) classes.push('is-locked');
  if (item.badge) classes.push('has-badge');

  const card = h('button', {
    class: classes.join(' '),
    type: 'button',
    data: { sku: item.sku },
  });

  let ariaLabel = `${item.name}. ${item.tagline}`;
  if (selected) ariaLabel += ' Currently selected.';
  else if (usable) ariaLabel += ' Owned. Activate to use.';
  else ariaLabel += ` Price ${item.priceLabel}.`;
  card.setAttribute('aria-label', ariaLabel);

  if (selected || pending || opts.locked) card.disabled = true;

  // --- header row --------------------------------------------------------
  const meta = h(
    'span',
    { class: 'sn-card__meta' },
    h('span', { class: 'sn-card__name', text: item.name }),
    h('span', { class: 'sn-card__tag', text: item.tagline }),
  );
  // The badge is an in-flow eyebrow rather than a corner overlay: at 320px a
  // "Best value" ribbon would otherwise crush the name into three lines.
  if (item.badge) {
    card.appendChild(h('span', { class: 'sn-card__badge', text: item.badge }));
  }
  card.appendChild(h('span', { class: 'sn-card__top' }, thumb(item, hero), meta));

  // --- palette preview ---------------------------------------------------
  card.appendChild(swatchStrip(item.swatches));

  // --- ingredients -------------------------------------------------------
  if (item.ingredients.length > 0) {
    const pills = h('span', { class: 'sn-card__ings' });
    const shown = item.ingredients.slice(0, MAX_INGREDIENTS);
    for (const ing of shown) {
      pills.appendChild(h('span', { class: 'sn-pill', text: ing }));
    }
    const extra = item.ingredients.length - shown.length;
    if (extra > 0) {
      pills.appendChild(h('span', { class: 'sn-pill sn-pill--more', text: `+${extra}` }));
    }
    card.appendChild(pills);
  }

  // --- call to action ----------------------------------------------------
  const cta = h('span', { class: 'sn-card__cta' });
  if (pending) {
    cta.classList.add('sn-card__cta--pending');
    cta.appendChild(h('span', { class: 'sn-spinner', aria: { hidden: 'true' } }));
    cta.appendChild(h('span', { class: 'sn-card__cta-text', text: 'Working…' }));
  } else if (selected) {
    cta.classList.add('sn-card__cta--selected');
    cta.appendChild(h('span', { class: 'sn-card__cta-icon' }, iconCheck()));
    cta.appendChild(h('span', { class: 'sn-card__cta-text', text: 'SELECTED' }));
  } else if (usable) {
    cta.classList.add('sn-card__cta--use');
    cta.appendChild(h('span', { class: 'sn-card__cta-text', text: 'USE' }));
  } else {
    cta.classList.add('sn-card__cta--buy');
    cta.appendChild(h('span', { class: 'sn-card__cta-text', text: item.priceLabel }));
  }
  card.appendChild(cta);
  card.appendChild(h('span', { class: 'sn-btn__dim', aria: { hidden: 'true' } }));

  // --- press feedback ----------------------------------------------------
  const up = (): void => card.classList.remove('is-pressed');
  card.addEventListener('pointerdown', (ev) => {
    ev.stopPropagation();
    if (!card.disabled) card.classList.add('is-pressed');
  });
  card.addEventListener('pointerup', up);
  card.addEventListener('pointercancel', up);
  card.addEventListener('pointerleave', up);
  card.addEventListener('blur', up);
  card.addEventListener('click', (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    if (card.disabled) return;
    ctx.press('tap');
    opts.onAction(item);
  });

  return card;
}
