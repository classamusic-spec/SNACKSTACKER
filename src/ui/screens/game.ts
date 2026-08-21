import type { HudState } from '../api';
import { createIconButton } from '../components/button';
import type { UiCtx } from '../ctx';
import { Bag, formatInt, h, setText, toggleClass } from '../dom';
import { iconPause } from '../icons';
import { EASE_IOS, EASE_OUT, animate, isReduced, pop, resetAnimations, runExit } from '../motion';

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
  setLeftHanded(left: boolean): void;
  destroy(): void;
}

/**
 * The in-game HUD. Everything here is `pointer-events: none` except the pause
 * button — the entire screen has to stay tappable as the drop control.
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

  const scoreEl = h('div', {
    class: 'sn-score',
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
    { class: 'sn-hud__sub', aria: { hidden: 'true' } },
    layersEl,
    h('span', { class: 'sn-hud__dot' }),
    bestEl,
  );

  const center = h('div', { class: 'sn-hud__center' }, scoreLine, sub);

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

  const coach = h(
    'div',
    { class: 'sn-coach', aria: { hidden: 'true' } },
    h('span', { class: 'sn-coach__ring' }),
    h('span', { class: 'sn-coach__dot' }),
    h('span', { class: 'sn-coach__label', text: 'Tap to drop' }),
  );

  const el = h('div', { class: 'sn-screen sn-hud' }, corner, center, perfect, milestone, coach);

  let score = 0;
  let combo = 0;
  let best = 0;
  let perfectTimer = 0;
  let milestoneTimer = 0;
  let perfectAnim: Animation | null = null;
  let milestoneAnim: Animation | null = null;

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
      runExit(
        el,
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: 220, easing: EASE_IOS },
        () => {
          el.remove();
          done?.();
        },
      );
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
