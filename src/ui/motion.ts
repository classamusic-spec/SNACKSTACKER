/**
 * Motion primitives. Everything animates `transform` / `opacity` only.
 *
 * A single module-level flag mirrors `Settings.reducedMotion`; when it is on,
 * "flourish" animations are dropped entirely and "essential" ones collapse to a
 * short opacity cross-fade. Every entrance animation is authored so that the
 * element's *resting CSS state* is the final frame, which means skipping the
 * animation always leaves the correct visual result.
 */

export const EASE_IOS = 'cubic-bezier(0.32, 0.72, 0, 1)';
export const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
export const EASE_SPRING = 'cubic-bezier(0.34, 1.42, 0.52, 1)';

/**
 * `EASE_IOS` evaluated in JS, for the few things the Web Animations API cannot
 * drive — `scrollLeft` above all. Solves x(u) = t by Newton-Raphson, then
 * returns y(u), so a hand-rolled animation lands on exactly the same curve as
 * every CSS transition in the app.
 */
const CX = 3 * 0.32;
const BX = 3 * (0 - 0.32) - CX;
const AX = 1 - CX - BX;
const CY = 3 * 0.72;
const BY = 3 * (1 - 0.72) - CY;
const AY = 1 - CY - BY;

const bezX = (u: number): number => ((AX * u + BX) * u + CX) * u;
const bezXd = (u: number): number => (3 * AX * u + 2 * BX) * u + CX;
const bezY = (u: number): number => ((AY * u + BY) * u + CY) * u;

export function easeIos(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let u = t;
  for (let i = 0; i < 6; i += 1) {
    const err = bezX(u) - t;
    if (Math.abs(err) < 1e-5) break;
    const d = bezXd(u);
    if (Math.abs(d) < 1e-6) break;
    u -= err / d;
  }
  return bezY(Math.max(0, Math.min(1, u)));
}

/**
 * `essential` — collapses to a short cross-fade under reduced motion.
 * `timed`     — keeps its duration (the player has to *read* it) but loses transforms.
 * `flourish`  — dropped entirely under reduced motion.
 */
export type MotionKind = 'essential' | 'flourish' | 'timed';

let reduced = false;

export function setReducedMotion(value: boolean): void {
  reduced = value;
}

export function isReduced(): boolean {
  return reduced;
}

/** True when the OS itself asks for reduced motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function opacityOnly(frames: Keyframe[]): Keyframe[] | null {
  const hasOpacity = frames.some((f) => f['opacity'] !== undefined);
  if (!hasOpacity) return null;
  return frames.map((f) => {
    const out: Keyframe = { opacity: f['opacity'] as string | number };
    if (f.offset !== undefined && f.offset !== null) out.offset = f.offset;
    return out;
  });
}

export function animate(
  el: Element,
  frames: Keyframe[],
  opts: KeyframeAnimationOptions,
  kind: MotionKind = 'essential',
): Animation | null {
  if (typeof el.animate !== 'function') return null;
  let f = frames;
  let o = opts;
  if (reduced) {
    if (kind === 'flourish') return null;
    const soft = opacityOnly(frames);
    if (!soft) return null;
    f = soft;
    const keep = kind === 'timed';
    o = {
      ...opts,
      duration: keep ? opts.duration : 130,
      easing: 'linear',
      delay: keep ? opts.delay : 0,
    };
  }
  try {
    return el.animate(f, o);
  } catch {
    return null;
  }
}

/**
 * Run an exit animation and always invoke `done` exactly once, even when the
 * animation is skipped (reduced motion) or cancelled.
 */
export function runExit(
  el: Element,
  frames: Keyframe[],
  opts: KeyframeAnimationOptions,
  done: () => void,
): void {
  const anim = animate(el, frames, { fill: 'forwards', ...opts });
  if (!anim) {
    done();
    return;
  }
  let called = false;
  const finish = (): void => {
    if (called) return;
    called = true;
    done();
  };
  anim.addEventListener('finish', finish);
  // Deliberately NOT on 'cancel'. Cancellation means a caller re-entered the
  // screen mid-exit and is reusing the element — `resetAnimations()` at the top
  // of every `enter()` does exactly that. Running the exit's teardown there
  // removes the element that was just re-added, which hard-locks the game:
  // re-opening the pause sheet inside its 300ms close deleted the sheet and
  // left the player paused with no controls, and Home->Play inside 220ms
  // deleted the HUD for the whole run.
}

/**
 * Score / chip "pop": scale up fast, settle on the iOS curve.
 *
 * NOTE: multi-keyframe animations always carry their easing **per keyframe**
 * and run `linear` at the animation level. An animation-level easing warps the
 * whole timeline, which silently collapses any hold phase.
 */
export function pop(el: Element, scale = 1.12, duration = 260): Animation | null {
  return animate(
    el,
    [
      { transform: 'scale(1)', offset: 0, easing: EASE_OUT },
      { transform: `scale(${scale})`, offset: 0.34, easing: EASE_IOS },
      { transform: 'scale(1)', offset: 1 },
    ],
    { duration, easing: 'linear' },
    'flourish',
  );
}

export interface CountOpts {
  from: number;
  to: number;
  duration: number;
  onUpdate(value: number): void;
  onDone?(): void;
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/**
 * rAF count-up. Returns a cancel function. Under reduced motion it snaps to the
 * final value immediately so the number is never withheld from the player.
 */
export function countTo(opts: CountOpts): () => void {
  if (reduced || opts.duration <= 0 || opts.from === opts.to) {
    opts.onUpdate(opts.to);
    opts.onDone?.();
    return () => undefined;
  }
  let raf = 0;
  let cancelled = false;
  const start = performance.now();
  const span = opts.to - opts.from;
  const step = (now: number): void => {
    if (cancelled) return;
    const t = Math.min(1, (now - start) / opts.duration);
    opts.onUpdate(opts.from + span * easeOutCubic(t));
    if (t < 1) {
      raf = window.requestAnimationFrame(step);
    } else {
      opts.onDone?.();
    }
  };
  raf = window.requestAnimationFrame(step);
  return () => {
    cancelled = true;
    if (raf) window.cancelAnimationFrame(raf);
  };
}

/** Cancel any running/filled Web Animations so a re-mounted node starts clean. */
export function resetAnimations(el: Element): void {
  const target = el as Element & { getAnimations?: () => Animation[] };
  if (typeof target.getAnimations !== 'function') return;
  for (const anim of target.getAnimations()) anim.cancel();
}
