import type { ModeId } from '../../modes/api';
import type { ModeCardView } from '../api';
import type { UiCtx } from '../ctx';
import { Bag, clear, formatInt, h, setText, toggleClass } from '../dom';
import { EASE_IOS, animate, easeIos, isReduced } from '../motion';
import { EDGE, INK, PAPER, TILT, tiltFor } from '../snack/classes';
import type { TiltClass } from '../snack/classes';
import { hexFromInt, inkFor, rgbTriplet } from '../theme';
import { applyPaper, inkUnderline } from './material';

export interface ModeDeckOpts {
  /** Focus moved. Fires live while a fling is still settling. */
  onFocus(card: ModeCardView): void;
  /** Focus settled. This is the one the host is told about. */
  onCommit(id: ModeId): void;
  /** The player asked to play the focused mode from inside the deck. */
  onActivate(id: ModeId): void;
}

export interface ModeDeck {
  readonly el: HTMLElement;
  readonly focused: ModeCardView | null;
  setCards(cards: readonly ModeCardView[], selectedId: ModeId): void;
  /** Update just the personal best of one mode. */
  setBest(id: ModeId, best: number, bestCount?: number): void;
  /** Entrance: cards arrive from the focus outwards. */
  play(): void;
  destroy(): void;
}

interface Slot {
  view: ModeCardView;
  el: HTMLButtonElement;
  glyph: HTMLElement;
  name: HTMLElement;
  tag: HTMLElement;
  lock: HTMLElement;
  /** Seeded from the mode id, so a napkin leans the same way on every mount. */
  tilt: TiltClass;
}

/** How long the rail has to be still before we call the host. */
const SETTLE_MS = 130;
/**
 * How much a card fades per stride away from the focus. Must stay in step with
 * `opacity: calc(1 - 0.46 * var(--d))` in ui.css — the entrance animation has
 * to land on the card's *resting* opacity or every neighbour pops on the last
 * frame as the animation releases back to CSS.
 */
const DEPTH_FADE = 0.46;
/** Matching clamp on --d. */
const DEPTH_MAX = 1.6;
/** A drag longer than this is a swipe, not a tap. */
const TAP_SLOP = 9;
/** How long a programmatic move across the deck takes. */
const GLIDE_MS = 380;

/**
 * The mode picker: a horizontally snapped deck of cards with one scaled,
 * accent-tinted focus card in the middle and its neighbours peeking in at 84%.
 *
 * Native CSS scroll snapping carries the touch gesture, because platform fling
 * physics cannot be faked; programmatic moves (a tap on a neighbour, an arrow
 * key) are glided by hand on the app's own easing curve. Either way a
 * rAF-throttled read of `scrollLeft` drives the scale/opacity falloff. Cards
 * are measured with `offsetLeft`, never `getBoundingClientRect()`, because the
 * falloff itself applies a transform and a rect-based measure would feed back
 * into itself.
 *
 * Semantics are a radiogroup of real buttons: arrows move focus *and*
 * selection, Home/End jump to the ends, and activating the already-selected
 * card starts the run (its accessible name says so).
 */
export function createModeDeck(ctx: UiCtx, opts: ModeDeckOpts): ModeDeck {
  const bag = new Bag();

  const rail = h('div', {
    class: 'sn-deck__rail',
    role: 'radiogroup',
    aria: { label: 'Game mode' },
  });

  const dots = h('div', { class: 'sn-deck__dots', aria: { hidden: 'true' } });

  const how = h('p', { class: 'sn-deck__how' });
  const best = h('p', { class: 'sn-deck__best' });
  // The rules and the record live outside the radiogroup, so a screen reader
  // would otherwise never hear them change as the player arrows across.
  const detail = h(
    'div',
    { class: 'sn-deck__detail', aria: { live: 'polite', atomic: 'true' } },
    how,
    best,
  );

  const el = h('div', { class: 'sn-deck' }, rail, dots, detail);

  let slots: Slot[] = [];
  let index = 0;
  let committed = -1;
  let raf = 0;
  let settle = 0;
  let glide = 0;

  // ------------------------------------------------------------------ paint

  function stride(): number {
    if (slots.length < 2) return Math.max(1, slots[0]?.el.offsetWidth ?? 1);
    return Math.max(1, slots[1].el.offsetLeft - slots[0].el.offsetLeft);
  }

  /** Map every card's distance from the viewport centre onto --d (0..1.6). */
  function paint(): void {
    raf = 0;
    if (slots.length === 0) return;
    const centre = rail.scrollLeft + rail.clientWidth / 2;
    const step = stride();
    let nearest = 0;
    let nearestD = Infinity;
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      const mid = slot.el.offsetLeft + slot.el.offsetWidth / 2;
      const d = (mid - centre) / step;
      const ad = Math.abs(d);
      if (ad < nearestD) {
        nearestD = ad;
        nearest = i;
      }
      slot.el.style.setProperty('--d', Math.min(DEPTH_MAX, ad).toFixed(3));
    }
    // While a programmatic glide is in flight the destination is already known,
    // so only a real user scroll gets to move the focus. Otherwise an End-key
    // jump would flick the caption and the accent through every mode it passes.
    if (nearest !== index && !glide) setIndex(nearest);
  }

  function schedulePaint(): void {
    if (raf) return;
    raf = bag.frame(() => paint());
  }

  function renderDetail(view: ModeCardView): void {
    setText(how, view.how);
    clear(best);
    if (view.best > 0) {
      best.classList.remove('is-empty');
      best.appendChild(h('span', { class: 'sn-deck__k', text: 'Best' }));
      best.appendChild(h('span', { class: 'sn-deck__v', text: formatInt(view.best) }));
      if (view.bestCount > 0 && view.countLabel) {
        best.appendChild(h('span', { class: 'sn-deck__sep', text: '·', aria: { hidden: 'true' } }));
        best.appendChild(
          h('span', {
            class: 'sn-deck__c',
            text: `${formatInt(view.bestCount)} ${view.countLabel}`,
          }),
        );
      }
      best.setAttribute(
        'aria-label',
        view.bestCount > 0 && view.countLabel
          ? `Best ${formatInt(view.best)}, ${formatInt(view.bestCount)} ${view.countLabel}`
          : `Best ${formatInt(view.best)}`,
      );
    } else {
      // `best: 0` means never played. Say something inviting, and never "0".
      best.classList.add('is-empty');
      best.appendChild(h('span', { text: 'Set the first record.' }));
      best.setAttribute('aria-label', 'No record yet. Set the first record.');
    }

    // "Arrive", never fade in from nothing.
    animate(
      detail,
      [
        { transform: 'translate3d(0, 7px, 0)', opacity: 0 },
        { transform: 'translate3d(0, 0, 0)', opacity: 1 },
      ],
      { duration: 320, easing: EASE_IOS },
    );
  }

  function renderDots(): void {
    clear(dots);
    for (let i = 0; i < slots.length; i += 1) {
      dots.appendChild(h('span', { class: `sn-deck__dot${i === index ? ' is-on' : ''}` }));
    }
  }

  function syncAria(): void {
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      const on = i === index;
      slot.el.setAttribute('aria-checked', on ? 'true' : 'false');
      slot.el.tabIndex = on ? 0 : -1;
      toggleClass(slot.el, 'is-focused', on);
      // The chosen napkin has been picked up: it straightens as it lifts, and
      // `is-focused` carries the rest of the treatment. Focus changes only —
      // never on scroll, never per frame.
      if (slot.tilt !== TILT.none) toggleClass(slot.el, slot.tilt, !on);
      const locked = slot.view.locked ? ' Not unlocked yet.' : '';
      slot.el.setAttribute(
        'aria-label',
        on && !slot.view.locked
          ? `${slot.view.name}. ${slot.view.tagline} Selected. Activate to play.`
          : `${slot.view.name}. ${slot.view.tagline}${locked}`,
      );
    }
  }

  function setIndex(next: number): void {
    if (next < 0 || next >= slots.length) return;
    index = next;
    const view = slots[index].view;
    syncAria();
    for (let i = 0; i < dots.children.length; i += 1) {
      dots.children[i].classList.toggle('is-on', i === index);
    }
    renderDetail(view);
    opts.onFocus(view);
  }

  /** Tell the host — only once the rail has actually stopped. */
  function commit(): void {
    if (slots.length === 0) return;
    if (index === committed) return;
    committed = index;
    opts.onCommit(slots[index].view.id);
  }

  /**
   * Glide the rail by hand rather than with `scrollTo({behavior:'smooth'})`.
   *
   * Two reasons. The platform's smooth scroll runs on its own timing, not the
   * app's iOS curve; and it is a compositor animation, which is inert in some
   * environments (it silently does nothing in headless Chromium, which is how
   * this was caught). Driving `scrollLeft` on rAF is deterministic everywhere.
   *
   * Mandatory snapping fights an animated scroll offset, so it is switched off
   * for the duration and restored once the exact snap position is reached.
   */
  function endGlide(): void {
    if (glide) bag.cancelFrame(glide);
    glide = 0;
    rail.style.scrollSnapType = '';
  }

  function scrollToIndex(i: number, smooth: boolean): void {
    const slot = slots[i];
    if (!slot) return;
    const max = Math.max(0, rail.scrollWidth - rail.clientWidth);
    const target = Math.max(
      0,
      Math.min(max, slot.el.offsetLeft + slot.el.offsetWidth / 2 - rail.clientWidth / 2),
    );
    endGlide();
    const from = rail.scrollLeft;
    const dist = target - from;
    if (!smooth || isReduced() || Math.abs(dist) < 0.5) {
      rail.scrollLeft = target;
      return;
    }
    rail.style.scrollSnapType = 'none';
    const started = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - started) / GLIDE_MS);
      rail.scrollLeft = from + dist * easeIos(t);
      if (t < 1) {
        glide = bag.frame(step);
        return;
      }
      rail.scrollLeft = target;
      endGlide();
    };
    glide = bag.frame(step);
  }

  function move(to: number, fromKeyboard: boolean): void {
    const clamped = Math.max(0, Math.min(slots.length - 1, to));
    if (clamped === index && !fromKeyboard) return;
    setIndex(clamped);
    scrollToIndex(clamped, true);
    if (fromKeyboard) {
      commit();
      try {
        slots[clamped].el.focus({ preventScroll: true });
      } catch {
        /* focus is best-effort */
      }
    }
  }

  // ------------------------------------------------------------- rail input

  const onScroll = (): void => {
    schedulePaint();
    bag.cancel(settle);
    settle = bag.after(() => commit(), SETTLE_MS);
  };
  rail.addEventListener('scroll', onScroll, { passive: true });
  bag.own(() => rail.removeEventListener('scroll', onScroll));

  // A swipe must never also register as a tap on the card it started over, and
  // must never reach the canvas underneath (the whole screen is the drop
  // button during play, and the host may be listening in attract too).
  let downX = 0;
  let downY = 0;
  let dragged = false;
  const onDown = (ev: PointerEvent): void => {
    ev.stopPropagation();
    endGlide();
    downX = ev.clientX;
    downY = ev.clientY;
    dragged = false;
  };
  const onMove = (ev: PointerEvent): void => {
    if (ev.buttons === 0 && ev.pointerType === 'mouse') return;
    if (Math.abs(ev.clientX - downX) > TAP_SLOP || Math.abs(ev.clientY - downY) > TAP_SLOP) {
      dragged = true;
    }
  };
  // The browser fires pointercancel the moment it takes the gesture over for a
  // fling, and stops sending moves — so treat that as "this was a swipe" too.
  const onCancel = (): void => {
    dragged = true;
  };
  rail.addEventListener('pointerdown', onDown);
  rail.addEventListener('pointermove', onMove);
  rail.addEventListener('pointercancel', onCancel);
  bag.own(() => rail.removeEventListener('pointerdown', onDown));
  bag.own(() => rail.removeEventListener('pointermove', onMove));
  bag.own(() => rail.removeEventListener('pointercancel', onCancel));

  const onKey = (ev: KeyboardEvent): void => {
    let to = index;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') to = index + 1;
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') to = index - 1;
    else if (ev.key === 'Home') to = 0;
    else if (ev.key === 'End') to = slots.length - 1;
    else return;
    ev.preventDefault();
    ev.stopPropagation();
    if (to === index) return;
    ctx.press('tap');
    move(to, true);
  };
  rail.addEventListener('keydown', onKey);
  bag.own(() => rail.removeEventListener('keydown', onKey));

  // Re-centre after a rotation / resize, otherwise the snap point drifts.
  bag.listen(window, 'resize', () => {
    if (slots.length === 0) return;
    scrollToIndex(index, false);
    schedulePaint();
  });

  // ------------------------------------------------------------------ cards

  /**
   * A mode card is a themed paper napkin: scalloped edge, clean print for the
   * name, and a small stable lean. The lean, the fibre and the deckle are all
   * seeded from the mode id — never from the card's position in the rail, so
   * re-ordering or re-rendering the deck never reshuffles the paper.
   */
  function buildCard(view: ModeCardView): Slot {
    const seed = `mode:${view.id}`;
    const tilt = tiltFor(seed);

    const glyph = h('span', { class: 'sn-mode__glyph', text: view.glyph, aria: { hidden: 'true' } });
    const tile = h('span', { class: 'sn-mode__tile', aria: { hidden: 'true' } }, glyph);
    const name = h('span', { class: `sn-mode__name ${INK.print}`, text: view.name });
    const tag = h('span', { class: 'sn-mode__tag', text: view.tagline });
    const lock = h('span', { class: 'sn-mode__lock', text: 'Soon', aria: { hidden: 'true' } });

    const card = h('button', {
      class: `sn-mode ${PAPER.napkin} ${EDGE.scallop} ${tilt}`.trim(),
      type: 'button',
      role: 'radio',
      tabIndex: -1,
      aria: { checked: 'false' },
      data: { mode: view.id },
    });
    applyPaper(card, { kind: 'napkin', seed, edge: 'scallop', wear: 0.22 });

    const meta = h('span', { class: 'sn-mode__meta' }, name, tag);
    // The selection mark is drawn ink, not a geometric ring; CSS reveals it on
    // the focused card. Absent until the kit can draw it.
    const underline = inkUnderline(seed, 'sn-mode__underline');
    if (underline) meta.appendChild(underline);

    card.appendChild(tile);
    card.appendChild(meta);
    card.appendChild(lock);
    card.appendChild(h('span', { class: 'sn-btn__dim', aria: { hidden: 'true' } }));

    card.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      if (dragged) return;
      const at = slots.findIndex((s) => s.el === card);
      if (at < 0 || slots[at].view.locked) return;
      ctx.press('tap');
      if (at === index) {
        // The focused card is the play surface too — its label says so.
        commit();
        opts.onActivate(slots[at].view.id);
        return;
      }
      setIndex(at);
      scrollToIndex(at, true);
      commit();
    });

    const press =
      (on: boolean) =>
      (): void => {
        card.classList.toggle('is-pressed', on);
      };
    card.addEventListener('pointerdown', press(true));
    card.addEventListener('pointerup', press(false));
    card.addEventListener('pointercancel', press(false));
    card.addEventListener('pointerleave', press(false));
    card.addEventListener('blur', press(false));

    const slot: Slot = { view, el: card, glyph, name, tag, lock, tilt };
    paintCard(slot, view);
    return slot;
  }

  function paintCard(slot: Slot, view: ModeCardView): void {
    slot.view = view;
    setText(slot.name, view.name);
    setText(slot.tag, view.tagline);
    setText(slot.glyph, view.glyph);
    slot.el.style.setProperty('--m', hexFromInt(view.accent));
    slot.el.style.setProperty('--m-rgb', rgbTriplet(view.accent));
    slot.el.style.setProperty('--m-ink', inkFor(view.accent));
    toggleClass(slot.el, 'is-locked', view.locked);
    toggleClass(slot.lock, 'is-hidden', !view.locked);
    // `aria-disabled`, never the `disabled` attribute: a disabled button drops
    // out of the tab order and would strand the roving tabindex on it.
    slot.el.setAttribute('aria-disabled', view.locked ? 'true' : 'false');
  }

  return {
    el,
    get focused(): ModeCardView | null {
      return slots[index]?.view ?? null;
    },

    setCards(cards: readonly ModeCardView[], selectedId: ModeId): void {
      const sameShape =
        slots.length === cards.length && slots.every((s, i) => s.view.id === cards[i].id);

      if (sameShape) {
        cards.forEach((view, i) => paintCard(slots[i], view));
      } else {
        clear(rail);
        slots = cards.map((view) => buildCard(view));
        for (const slot of slots) rail.appendChild(slot.el);
        committed = -1;
      }

      const want = Math.max(
        0,
        cards.findIndex((c) => c.id === selectedId),
      );
      index = Math.min(want, slots.length - 1);
      committed = index;
      renderDots();
      syncAria();
      if (slots.length > 0) {
        renderDetail(slots[index].view);
        opts.onFocus(slots[index].view);
      }
      // Layout has to exist before the snap offset can be measured.
      bag.frame(() => {
        scrollToIndex(index, false);
        paint();
      });
    },

    setBest(id: ModeId, value: number, bestCount?: number): void {
      const slot = slots.find((s) => s.view.id === id);
      if (!slot) return;
      const next = Math.max(0, Math.round(value));
      if (slot.view.best === next && bestCount === undefined) return;
      slot.view = {
        ...slot.view,
        best: next,
        bestCount: bestCount ?? slot.view.bestCount,
      };
      if (slots[index] === slot) renderDetail(slot.view);
    },

    play(): void {
      if (slots.length === 0) return;
      slots.forEach((slot, i) => {
        const rank = Math.abs(i - index);
        const rest = 1 - DEPTH_FADE * Math.min(DEPTH_MAX, rank);
        animate(
          slot.el,
          [
            { transform: 'translate3d(0, 26px, 0)', opacity: 0 },
            { transform: 'translate3d(0, 0, 0)', opacity: rest },
          ],
          { duration: 520, delay: 200 + rank * 70, easing: EASE_IOS },
        );
      });
      animate(
        dots,
        [
          { transform: 'translate3d(0, 8px, 0)', opacity: 0 },
          { transform: 'translate3d(0, 0, 0)', opacity: 1 },
        ],
        { duration: 400, delay: 340, easing: EASE_IOS },
      );
      animate(
        detail,
        [
          { transform: 'translate3d(0, 12px, 0)', opacity: 0 },
          { transform: 'translate3d(0, 0, 0)', opacity: 1 },
        ],
        { duration: 460, delay: 380, easing: EASE_IOS },
      );
    },

    destroy(): void {
      bag.disposeAll();
      el.remove();
    },
  };
}
