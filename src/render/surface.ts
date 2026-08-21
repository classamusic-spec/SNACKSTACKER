/**
 * One place that knows how to get a 2D drawing surface.
 *
 * OffscreenCanvas keeps texture baking off the DOM (no layout, no style
 * resolution, no compositor churn) which matters when ~40 textures are painted
 * during boot. Older Safari gets a detached <canvas> instead.
 *
 * The two 2D contexts are structurally identical for everything a painter
 * touches, so the offscreen one is presented as a CanvasRenderingContext2D.
 */
export interface PaintSurface {
  readonly width: number;
  readonly height: number;
  readonly ctx: CanvasRenderingContext2D;
  /** The object handed to THREE.CanvasTexture. */
  readonly source: HTMLCanvasElement;
}

type OffscreenCtor = new (width: number, height: number) => OffscreenCanvas;

export function makeSurface(width: number, height: number = width): PaintSurface | null {
  const Ctor = (globalThis as unknown as { OffscreenCanvas?: OffscreenCtor }).OffscreenCanvas;

  if (Ctor) {
    const off = new Ctor(width, height);
    const octx = off.getContext('2d');
    if (octx) {
      return {
        width,
        height,
        ctx: octx as unknown as CanvasRenderingContext2D,
        source: off as unknown as HTMLCanvasElement,
      };
    }
  }

  if (typeof document === 'undefined') return null;
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  const ctx = el.getContext('2d');
  if (!ctx) return null;
  return { width, height, ctx, source: el };
}

/** `#rrggbb` for a 0xRRGGBB literal — canvas2d only speaks CSS. */
export function cssHex(hex: number): string {
  return `#${(hex & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** CSS rgba() for a 0xRRGGBB literal plus an alpha. */
export function cssRgba(hex: number, alpha: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Blend two 0xRRGGBB literals in gamma space — good enough for a backdrop bake. */
export function mixHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
