import { clamp } from './math';

export interface FrameInfo {
  /** Seconds since the previous frame, clamped. */
  dt: number;
  /** Seconds since the ticker started. */
  elapsed: number;
  /** Rolling average frames per second. */
  fps: number;
  frame: number;
}

export interface TickerOpts {
  /** Called when the frame budget is missed persistently. */
  onSlow?: (fps: number) => void;
  /** Frames-per-second below which we consider the device struggling. */
  slowThreshold?: number;
  /** How many consecutive slow seconds before onSlow fires. */
  slowSeconds?: number;
}

/**
 * requestAnimationFrame loop with dt clamping, a rolling FPS meter and a frame
 * governor. Tab-switches produce huge dt values; clamping them stops the tower
 * from teleporting when the player comes back.
 */
export class Ticker {
  private raf = 0;
  private last = 0;
  private startedAt = 0;
  private running = false;
  private frame = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private fpsTimer = 0;
  private slowRun = 0;
  private hasReportedSlow = false;
  private cb: ((info: FrameInfo) => void) | null = null;

  readonly info: FrameInfo = { dt: 0, elapsed: 0, fps: 60, frame: 0 };

  constructor(private opts: TickerOpts = {}) {}

  start(cb: (info: FrameInfo) => void): void {
    if (this.running) return;
    this.cb = cb;
    this.running = true;
    this.last = performance.now();
    this.startedAt = this.last;
    this.raf = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Reset the clock without dropping the loop (after a long pause). */
  resync(): void {
    this.last = performance.now();
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);

    // 0.05s == 20fps floor. Anything worse is treated as a hitch, not slow-mo.
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    this.frame++;

    this.fpsAccum += dt;
    this.fpsFrames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      const fps = this.fpsFrames / Math.max(this.fpsAccum, 1e-6);
      this.info.fps = fps;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
      this.fpsTimer = 0;

      const threshold = this.opts.slowThreshold ?? 48;
      const needed = this.opts.slowSeconds ?? 3;
      if (fps < threshold) {
        this.slowRun += 0.5;
        if (this.slowRun >= needed && !this.hasReportedSlow) {
          this.hasReportedSlow = true;
          this.slowRun = 0;
          this.opts.onSlow?.(fps);
        }
      } else {
        this.slowRun = 0;
      }
    }

    this.info.dt = dt;
    this.info.elapsed = (now - this.startedAt) / 1000;
    this.info.frame = this.frame;
    this.cb?.(this.info);
  };

  /** Allow the governor to fire again after a quality change settles. */
  armGovernor(): void {
    this.hasReportedSlow = false;
    this.slowRun = 0;
  }
}
