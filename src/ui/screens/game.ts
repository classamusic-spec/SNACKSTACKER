import type { ModeId } from '../../modes/api';
import { MODE_INFO } from '../../modes/api';
import type { HudState } from '../api';
import { createIconButton } from '../components/button';
import { applyPaper, tearLine } from '../components/material';
import type { UiCtx } from '../ctx';
import { Bag, formatInt, h, setText, toggleClass } from '../dom';
import { iconPause } from '../icons';
import { EASE_IOS, EASE_OUT, animate, isReduced, pop, resetAnimations, runExit } from '../motion';
import { INK, PAPER, tiltFor } from '../snack/classes';

export interface GameScreen {
  readonly el: HTMLElement;
  enter(): void;
  exit(done?: () => void): void;
  setHud(state: HudState): void;
  setScore(score: number, opts?: { pop?: boolean; delta?: number }): void;
  setCombo(combo: number): void;
  setBest(best: number): void;
  showPerfect(label: string, tier: number): void;
  showMilestone(text: string, sub?: string): void;
  setCoach(visible: boolean): void;
  /** Which mode is running, so the coach prompt says what THIS mode wants. */
  setMode(id: ModeId): void;
  setLeftHanded(left: boolean): void;
  destroy(): void;
}

/** Seeds the pad's fibre and its lean. One pad, one identity, every mount. */
const PAD_SEED = 'hud:pad';

const EXIT_MS = 220;

/**
 * The in-game HUD. Everything here is `pointer-events: none` except the pause
 * button — the entire screen has to stay tappable as the drop control.
 *
 * The score is printed on an order pad clipped to the top of the screen. That
 * is not only flavour: the pad is opaque, so the one surface the player reads
 * sixty times a run carries its own contrast and stops depending on the
 * backdrop behind it. Candy Stack is near-white and Sushi Tower is near-black;
 * white type with a halo had to survive both, and print on paper simply does.
 */
export function createGameScreen(ctx: UiCtx): GameScreen {
  const bag = new Bag();

  const pauseBtn = createIconButton(ctx, {
    icon: iconPause(),
    ariaLabel: 'Pause',
    className: 'sn-hud__pause',
    onPress: () => ctx.hooks.onPause(),
  });
  const corner = h('div', { class: 'sn-hud__corner' }, pauseBtn);

  // The QA harness reads this element's textContent to tell whether a run is
  // responding, so the digits stay plain text on `.sn-score` — never a canvas,
  // a background image, or per-digit spans.
  const scoreEl = h('div', {
    class: `sn-score ${INK.print}`,
    text: '0',
    role: 'status',
    aria: { live: 'polite', label: 'Score 0' },
  });
  // The combo pill lives in its own full-width slot directly under the score so
  // it stays centred and can never collide with the pause button.
  const comboPill = h('span', { class: 'sn-combo__pill', text: '×2' });
  const comboEl = h('div', { class: 'sn-combo', aria: { hidden: 'true' } }, comboPill);
  const deltaEl = h('div', { class: 'sn-delta', aria: { hidden: 'true' } });
  const scoreLine = h('div', { class: 'sn-hud__scoreline' }, scoreEl, deltaEl, comboEl);

  const layersEl = h('span', { class: 'sn-hud__layers', text: '0 layers' });
  const bestEl = h('span', { class: 'sn-hud__best', text: 'best 0' });
  const sub = h(
    'div',
    { class: `sn-hud__sub ${INK.thermal}`, aria: { hidden: 'true' } },
    layersEl,
    h('span', { class: 'sn-hud__dot' }),
    bestEl,
  );

  /**
   * The pad itself. No `sn-e-*` class: the silhouettes are authored against a
   * card's proportions, so one scaled to a pad this shape bites into it rather
   * than shaping its edge. The perforation is a real tear-line element across
   * the top instead, which is what §8 asks for anyway ("tear-line at the top
   * edge") — and it leaves `.sn-delta` free to fly out past the score's left
   * edge, which is where a `+120` belongs.
   *
   * Nothing here opts back into pointer events: the whole screen is the drop
   * control and the pad must never eat a tap.
   */
  const pad = h(
    'div',
    { class: `sn-hud__pad ${PAPER.ticket} ${INK.print} ${tiltFor(PAD_SEED)}`.trim() },
    scoreLine,
    sub,
  );
  applyPaper(pad, { kind: 'ticket', seed: PAD_SEED, edge: 'perforated', wear: 0.12 });
  const padTear = tearLine(PAD_SEED, 'sn-hud__tear');
  if (padTear) pad.insertBefore(padTear, pad.firstChild);

  const center = h('div', { class: 'sn-hud__center' }, pad);

  const perfectText = h('span', { class: 'sn-perfect__text', text: '' });
  const perfect = h('div', { class: 'sn-perfect', aria: { hidden: 'true' } }, perfectText);

  const msTitle = h('span', { class: 'sn-milestone__title', text: '' });
  const msSub = h('span', { class: 'sn-milestone__sub', text: '' });
  const milestone = h(
    'div',
    { class: 'sn-milestone', role: 'status', aria: { live: 'polite' } },
    msTitle,
    msSub,
  );

  // The coach says what THIS mode wants. Recipe Rush has nothing to drop, so a
  // hardcoded "Tap to drop" was a lie on three of the four modes.
  const coachLabel = h('span', { class: 'sn-coach__label', text: MODE_INFO.stack.coach });
  const coach = h(
    'div',
    { class: 'sn-coach', aria: { hidden: 'true' } },
    h('span', { class: 'sn-coach__ring' }),
    h('span', { class: 'sn-coach__dot' }),
    coachLabel,
  );

  const el = h('div', { class: 'sn-screen sn-hud' }, corner, center, perfect, milestone, coach);

  let score = 0;
  let combo = 0;
  let best = 0;
  let perfectTimer = 0;
  let milestoneTimer = 0;
  let perfectAnim: Animation | null = null;
  let milestoneAnim: Animation | null = null;
  /** Bumped by every exit and every enter, so a stale safety net stands down. */
  let exitSeq = 0;

  const paintScore = (value: number): void => {
    setText(scoreEl, formatInt(value));
    scoreEl.setAttribute('aria-label', `Score ${formatInt(value)}`);
  };

  const showDelta = (delta: number): void => {
    if (isReduced() || delta <= 0) return;
    setText(deltaEl, `+${formatInt(delta)}`);
    deltaEl.classList.add('is-on');
    animate(
      deltaEl,
      [
        { transform: 'translate3d(0, 6px, 0) scale(0.92)', opacity: 0, offset: 0, easing: EASE_OUT },
        { transform: 'translate3d(0, -6px, 0) scale(1)', opacity: 1, offset: 0.22, easing: EASE_IOS },
        { transform: 'translate3d(0, -30px, 0) scale(1)', opacity: 0, offset: 1 },
      ],
      { duration: 720, easing: 'linear' },
      'flourish',
    );
    bag.after(() => deltaEl.classList.remove('is-on'), 740);
  };

  const paintCombo = (next: number, previous: number): void => {
    const visible = next >= 2;
    const wasVisible = previous >= 2;
    setText(comboPill, `×${next}`);
    if (visible) {
      comboEl.classList.add('is-on');
      if (!wasVisible) {
        animate(
          comboEl,
          [
            { transform: 'translate3d(0, -10px, 0) scale(0.8)', opacity: 0 },
            { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1 },
          ],
          { duration: 320, easing: EASE_IOS },
        );
      } else if (next > previous) {
        pop(comboEl, 1.18, 240);
      }
    } else if (wasVisible) {
      const node = comboEl;
      node.classList.remove('is-on');
      // Keep it painted through the exit; the resting CSS state hides it again.
      animate(
        node,
        [
          { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1, visibility: 'visible' },
          { transform: 'translate3d(0, -14px, 0) scale(0.86)', opacity: 0, visibility: 'visible' },
        ],
        { duration: 260, easing: EASE_IOS },
      );
    }
  };

  return {
    el,
    enter(): void {
      exitSeq += 1;
      resetAnimations(el);
      el.classList.remove('is-leaving');
      animate(
        el,
        [
          { transform: 'translate3d(0, -10px, 0)', opacity: 0 },
          { transform: 'translate3d(0, 0, 0)', opacity: 1 },
        ],
        { duration: 360, easing: EASE_IOS },
      );
    },
    exit(done?: () => void): void {
      el.classList.add('is-leaving');
      coach.classList.remove('is-on');

      const token = (exitSeq += 1);
      let dropped = false;
      const drop = (): void => {
        if (dropped) return;
        dropped = true;
        el.remove();
        done?.();
      };

      runExit(el, [{ opacity: 1 }, { opacity: 0 }], { duration: EXIT_MS, easing: EASE_IOS }, drop);

      /**
       * Safety net, and it earns its keep now that the HUD is opaque.
       *
       * `runExit` deliberately never tears down on `cancel`, because a
       * re-entering `enter()` is reusing this very element — see the note in
       * motion.ts. The gap that leaves is an exit whose animation neither
       * finishes nor is cancelled: a throttled or stalled timeline is enough,
       * and headless software rendering reproduces it every time. The screen
       * then stays parented at its resting opacity, and that is no longer a
       * line of transparent type over the world — it is an order pad sitting
       * on top of the home screen's hero tower.
       *
       * `is-leaving` is the discriminator. `enter()` clears it, so a screen
       * that was genuinely re-entered no-ops here; `token` does the same for an
       * exit that a later exit has already superseded.
       */
      bag.after(() => {
        if (token !== exitSeq) return;
        if (!el.isConnected || !el.classList.contains('is-leaving')) return;
        drop();
      }, EXIT_MS + 240);
    },
    setHud(state: HudState): void {
      score = state.score;
      best = state.best;
      paintScore(score);
      setText(layersEl, `${formatInt(state.layers)} layer${state.layers === 1 ? '' : 's'}`);
      setText(bestEl, `best ${formatInt(state.best)}`);
      const prev = combo;
      combo = state.combo;
      paintCombo(combo, prev);
    },
    setScore(value: number, opts): void {
      const next = Math.max(0, Math.round(value));
      const delta = opts?.delta ?? next - score;
      score = next;
      paintScore(next);
      if (opts?.pop) pop(scoreEl, 1.12, 260);
      if (opts?.delta !== undefined || (opts?.pop && delta > 0)) showDelta(delta);
    },
    setCombo(next: number): void {
      const prev = combo;
      combo = Math.max(0, Math.round(next));
      paintCombo(combo, prev);
    },
    setBest(value: number): void {
      best = Math.max(0, Math.round(value));
      setText(bestEl, `best ${formatInt(best)}`);
    },
    showPerfect(label: string, tier: number): void {
      const t = Math.max(0, Math.min(3, Math.round(tier)));
      bag.cancel(perfectTimer);
      perfectAnim?.cancel();
      perfect.className = `sn-perfect sn-perfect--t${t} is-on`;
      setText(perfectText, label);
      const overshoot = 1.04 + t * 0.035;
      const duration = 640 + t * 60;
      perfectAnim = animate(
        perfect,
        [
          { transform: 'translate3d(0, 8px, 0) scale(0.8)', opacity: 0, offset: 0, easing: EASE_OUT },
          {
            transform: `translate3d(0, 0, 0) scale(${overshoot})`,
            opacity: 1,
            offset: 0.16,
            easing: EASE_IOS,
          },
          { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1, offset: 0.3, easing: 'linear' },
          { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1, offset: 0.74, easing: EASE_IOS },
          { transform: 'translate3d(0, -10px, 0) scale(1.04)', opacity: 0, offset: 1 },
        ],
        { duration, easing: 'linear' },
        'timed',
      );
      perfectTimer = bag.after(() => perfect.classList.remove('is-on'), duration);
    },
    showMilestone(text: string, subText?: string): void {
      bag.cancel(milestoneTimer);
      milestoneAnim?.cancel();
      setText(msTitle, text);
      setText(msSub, subText ?? '');
      toggleClass(msSub, 'is-hidden', !subText);
      milestone.classList.add('is-on');
      milestoneAnim = animate(
        milestone,
        [
          { transform: 'translate3d(0, 12px, 0) scale(0.96)', opacity: 0, offset: 0, easing: EASE_IOS },
          { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1, offset: 0.16, easing: 'linear' },
          { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1, offset: 0.84, easing: EASE_IOS },
          { transform: 'translate3d(0, -8px, 0) scale(1)', opacity: 0, offset: 1 },
        ],
        { duration: 1200, easing: 'linear' },
        'timed',
      );
      milestoneTimer = bag.after(() => milestone.classList.remove('is-on'), 1200);
    },
    setCoach(visible: boolean): void {
      toggleClass(coach, 'is-on', visible);
      coach.setAttribute('aria-hidden', visible ? 'false' : 'true');
    },
    setMode(id: ModeId): void {
      const info = MODE_INFO[id];
      if (info) setText(coachLabel, info.coach);
    },
    setLeftHanded(left: boolean): void {
      toggleClass(el, 'is-left', left);
    },
    destroy(): void {
      perfectAnim?.cancel();
      milestoneAnim?.cancel();
      bag.disposeAll();
      el.remove();
    },
  };
}
