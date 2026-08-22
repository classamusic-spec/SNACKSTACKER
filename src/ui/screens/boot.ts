import logoSvg from '../../assets/snackery-logo.svg?raw';
import { Bag, h } from '../dom';
import { prefersReducedMotion } from '../motion';

export interface BootScreen {
  readonly el: HTMLElement;
  setProgress(p: number): void;
  dismiss(done: () => void): void;
  destroy(): void;
}

/** Logo palette, reused for the crumbs so they read as bits of the wordmark. */
const CRUMB_COLORS = ['#512A16', '#DC4209', '#7C9D17', '#EAC79B', '#FCF5E8'];

const ENTER_MS = 560;
const HOLD_MS = 420;
const BITE_COUNT = 7;
const BITE_GAP_MS = 88;
const SETTLE_MS = 420;

interface Bite {
  /** Normalised position within the logo box. */
  x: number;
  y: number;
  r: number;
  /** 0..1 growth, so a chunk is taken rather than popped. */
  t: number;
  teeth: number;
  phase: number;
}

interface Crumb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  spin: number;
  rot: number;
  color: string;
  life: number;
}

const easeOutBack = (t: number): number => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/**
 * The splash. The wordmark springs in, holds, then is eaten: seven large
 * irregular bites are punched out of it in sequence, each throwing crumbs,
 * before the whole thing cross-dissolves into the game.
 *
 * Drawn on a canvas rather than with CSS masks because a real bite is not a
 * circle — it is an arc with tooth scallops around its rim — and because the
 * crumbs have to survive later bites, which means compositing order matters.
 */
export function createBootScreen(): BootScreen {
  const bag = new Bag();
  const reduced = prefersReducedMotion();

  const canvas = h('canvas', { class: 'sn-boot__logo' }) as HTMLCanvasElement;
  const tagline = h('p', { class: 'sn-boot__tagline', text: 'Stack the snack.' });
  const fill = h('span', { class: 'sn-boot__fill' });
  const bar = h(
    'div',
    {
      class: 'sn-boot__bar',
      role: 'progressbar',
      aria: { label: 'Loading', valuemin: 0, valuemax: 100, valuenow: 0 },
    },
    fill,
  );
  const el = h(
    'div',
    { class: 'sn-screen sn-boot' },
    h('div', { class: 'sn-boot__inner' }, canvas, tagline, bar),
  );
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Snackery — stack the snack');
  // Boot never lets a tap slip through to a game that has not started.
  el.addEventListener('pointerdown', (ev) => ev.stopPropagation());

  const ctx = canvas.getContext('2d');
  const logo = new Image();
  let logoReady = false;
  // An SVG without intrinsic dimensions rasterises to nothing in some
  // browsers, so stamp the viewBox size onto it before encoding.
  const sized = logoSvg.replace(
    /<svg([^>]*)>/,
    (m, attrs: string) => (/\bwidth=/.test(attrs) ? m : `<svg${attrs} width="150" height="46">`),
  );
  logo.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
  logo.decode?.().then(
    () => {
      logoReady = true;
    },
    () => {
      logoReady = false;
    },
  );
  logo.addEventListener('load', () => {
    logoReady = true;
  });

  const bites: Bite[] = [];
  const crumbs: Crumb[] = [];
  let raf = 0;
  let start = 0;
  let biteStart = 0;
  let biting = false;
  let fading = 0;
  let dismissed = false;
  let onDone: (() => void) | null = null;
  let cw = 0;
  let ch = 0;
  let dpr = 1;

  const ASPECT = 46 / 150;

  function resize(): void {
    const width = Math.min(window.innerWidth * 0.74, 430);
    const height = width * ASPECT;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = width;
    ch = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  resize();
  window.addEventListener('resize', resize);
  const dropResize = (): void => window.removeEventListener('resize', resize);
  bag.own(dropResize);

  /**
   * Bites walk left to right the way a person eats, with vertical jitter so
   * the row never looks like a machine punched it.
   */
  function planBites(): void {
    for (let i = 0; i < BITE_COUNT; i++) {
      const t = (i + 0.5) / BITE_COUNT;
      bites.push({
        x: t + (Math.random() - 0.5) * 0.06,
        y: 0.5 + (Math.random() - 0.5) * 0.42,
        r: (0.34 + Math.random() * 0.16) * ch,
        t: 0,
        teeth: 5 + Math.floor(Math.random() * 3),
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  function spawnCrumbs(b: Bite): void {
    const n = 7 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 130;
      crumbs.push({
        x: b.x * cw + Math.cos(a) * b.r * 0.7,
        y: b.y * ch + Math.sin(a) * b.r * 0.7,
        vx: Math.cos(a) * speed * 0.5,
        vy: Math.sin(a) * speed * 0.5 - 60,
        size: 1.6 + Math.random() * 3.6,
        spin: (Math.random() - 0.5) * 12,
        rot: Math.random() * Math.PI,
        color: CRUMB_COLORS[Math.floor(Math.random() * CRUMB_COLORS.length)],
        life: 0,
      });
    }
  }

  /** One bite: a big arc with tooth scallops punched around its rim. */
  function punch(c: CanvasRenderingContext2D, b: Bite): void {
    const grow = easeOutCubic(Math.min(1, b.t));
    if (grow <= 0) return;
    const r = b.r * grow;
    const x = b.x * cw;
    const y = b.y * ch;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    for (let i = 0; i < b.teeth; i++) {
      const a = b.phase + (i / b.teeth) * Math.PI * 2;
      c.beginPath();
      c.arc(x + Math.cos(a) * r * 0.94, y + Math.sin(a) * r * 0.94, r * 0.3, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    // Without a 2D context there is nothing to draw and nothing can ever set
    // `fading`, so bail straight to the caller's teardown rather than spinning
    // forever under an opaque, input-blocking overlay.
    if (!ctx) {
      cancelAnimationFrame(raf);
      raf = 0;
      const finishNow = onDone;
      onDone = null;
      finishNow?.();
      return;
    }
    if (!start) start = now;
    const elapsed = now - start;
    const dt = 1 / 60;

    const enter = Math.min(1, elapsed / ENTER_MS);
    const pop = reduced ? 1 : easeOutBack(enter);
    const alpha = Math.min(1, elapsed / (ENTER_MS * 0.7));

    if (biting) {
      const since = now - biteStart;
      for (let i = 0; i < bites.length; i++) {
        const due = i * BITE_GAP_MS;
        if (since < due) break;
        const b = bites[i];
        if (b.t === 0) spawnCrumbs(b);
        b.t = Math.min(1, (since - due) / 150);
      }
      const last = (bites.length - 1) * BITE_GAP_MS + 150;
      if (since > last + SETTLE_MS && !fading) fading = now;
    }

    for (const cr of crumbs) {
      cr.life += dt;
      cr.vy += 620 * dt;
      cr.x += cr.vx * dt;
      cr.y += cr.vy * dt;
      cr.rot += cr.spin * dt;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    // A small chomp recoil on each bite sells the impact.
    let chomp = 0;
    if (biting) {
      const since = now - biteStart;
      const idx = Math.floor(since / BITE_GAP_MS);
      const local = (since - idx * BITE_GAP_MS) / BITE_GAP_MS;
      if (idx >= 0 && idx < bites.length) chomp = Math.sin(local * Math.PI) * 0.022;
    }

    ctx.save();
    ctx.globalAlpha = alpha * (fading ? Math.max(0, 1 - (now - fading) / 300) : 1);
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(pop * (1 + chomp), pop * (1 - chomp * 0.6));
    ctx.translate(-cw / 2, -ch / 2);
    if (logoReady) ctx.drawImage(logo, 0, 0, cw, ch);
    for (const b of bites) punch(ctx, b);
    ctx.restore();

    // Crumbs are drawn after the punches so a later bite cannot erase them.
    ctx.save();
    for (const cr of crumbs) {
      const a = Math.max(0, 1 - cr.life / 1.1);
      if (a <= 0) continue;
      ctx.globalAlpha = a * (fading ? Math.max(0, 1 - (now - fading) / 300) : 1);
      ctx.translate(cr.x, cr.y);
      ctx.rotate(cr.rot);
      ctx.fillStyle = cr.color;
      ctx.fillRect(-cr.size / 2, -cr.size / 2, cr.size, cr.size * 0.8);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    ctx.restore();

    if (fading && now - fading > 300) {
      cancelAnimationFrame(raf);
      raf = 0;
      onDone?.();
      onDone = null;
    }
  }

  raf = requestAnimationFrame(frame);
  bag.own(() => {
    if (raf) cancelAnimationFrame(raf);
  });

  return {
    el,
    setProgress(p: number): void {
      const v = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0));
      fill.style.setProperty('--p', v.toFixed(4));
      bar.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    },

    dismiss(done: () => void): void {
      if (dismissed) {
        done();
        return;
      }
      dismissed = true;
      el.style.pointerEvents = 'none';

      const finish = (): void => {
        el.classList.add('is-out');
        // The splash is never destroy()ed in the normal flow, so release its
        // resize listener here or it repaints a dead canvas all session.
        dropResize();
        bag.after(() => {
          el.remove();
          done();
        }, 340);
      };

      if (reduced) {
        finish();
        return;
      }

      onDone = finish;
      // Let the logo land and be read before anything eats it.
      const wait = Math.max(0, ENTER_MS + HOLD_MS - (performance.now() - start));
      bag.after(() => {
        planBites();
        biting = true;
        biteStart = performance.now();
        el.classList.add('is-eaten');
      }, wait);
    },

    destroy(): void {
      if (raf) cancelAnimationFrame(raf);
      bag.disposeAll();
      el.remove();
    },
  };
}
