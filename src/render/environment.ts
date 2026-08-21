import * as THREE from 'three';
import type { ThemePaletteLike } from './api';
import { cssHex, cssRgba, makeSurface, mixHex } from './surface';

/**
 * A tiny procedural studio, prefiltered into a PMREM.
 *
 * Nobody ever sees this image directly — it exists so that syrup looks wet,
 * chocolate has a rolling highlight and a cheese slice picks up a cool edge
 * from "the window". It is painted as a 512x256 equirectangular sweep: a
 * ceiling-to-floor gradient plus three soft "softboxes" aimed roughly where the
 * key / fill / rim lights are, then filtered down to a 256px cube.
 */

const SRC_W = 512;
const SRC_H = 256;

/** Direction -> equirect pixel, matching three's equirect sampling. */
function dirToPixel(x: number, y: number, z: number, out: [number, number]): void {
  const len = Math.hypot(x, y, z) || 1;
  const ny = y / len;
  const u = Math.atan2(z / len, x / len) / (Math.PI * 2) + 0.5;
  const v = Math.asin(THREE.MathUtils.clamp(ny, -1, 1)) / Math.PI + 0.5;
  out[0] = u * SRC_W;
  // Textures are flipY by default, so canvas row 0 is the +Y pole.
  out[1] = (1 - v) * SRC_H;
}

function softbox(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  radius: number,
  color: number,
  strength: number,
): void {
  // Drawn three times so a box straddling the u=0 seam stays continuous.
  for (let i = -1; i <= 1; i++) {
    const x = px + i * SRC_W;
    if (x + radius < 0 || x - radius > SRC_W) continue;
    const g = ctx.createRadialGradient(x, py, 0, x, py, radius);
    g.addColorStop(0, cssRgba(color, strength));
    g.addColorStop(0.45, cssRgba(color, strength * 0.45));
    g.addColorStop(1, cssRgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - radius, py - radius, radius * 2, radius * 2);
  }
}

export class EnvironmentRig {
  /** The prefiltered cube. Assign to scene.environment and materials.environment. */
  texture: THREE.Texture | null = null;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly pmrem: THREE.PMREMGenerator;
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly px: [number, number] = [0, 0];

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
  }

  /** Repaint + refilter for a theme. Cheap enough to run on every theme swap. */
  build(p: ThemePaletteLike): THREE.Texture | null {
    const surface = makeSurface(SRC_W, SRC_H);
    if (!surface) return this.texture;
    const ctx = surface.ctx;

    // --- room gradient: bright ceiling, tinted horizon, dark floor ---------
    const grad = ctx.createLinearGradient(0, 0, 0, SRC_H);
    grad.addColorStop(0.0, cssHex(mixHex(p.bgTop, 0xffffff, 0.45)));
    grad.addColorStop(0.34, cssHex(mixHex(p.bgTop, p.fog, 0.5)));
    grad.addColorStop(0.52, cssHex(p.fog));
    grad.addColorStop(0.72, cssHex(mixHex(p.bgBottom, p.ground, 0.55)));
    grad.addColorStop(1.0, cssHex(mixHex(p.ground, 0x000000, 0.4)));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SRC_W, SRC_H);

    // --- softboxes, aimed with the light rig ------------------------------
    ctx.globalCompositeOperation = 'lighter';

    dirToPixel(-4.5, 4.72, 5.0, this.px); // key
    softbox(ctx, this.px[0], this.px[1], SRC_W * 0.30, mixHex(p.key, 0xffffff, 0.35), 0.95);

    dirToPixel(5.6, 2.6, 3.2, this.px); // fill
    softbox(ctx, this.px[0], this.px[1], SRC_W * 0.24, p.fill, 0.5);

    dirToPixel(2.4, 5.6, -6.4, this.px); // rim
    softbox(ctx, this.px[0], this.px[1], SRC_W * 0.20, p.rim, 0.55);

    // A cool overhead pool keeps the very top of a glossy dome from going flat.
    softbox(ctx, SRC_W * 0.5, SRC_H * 0.04, SRC_W * 0.30, mixHex(p.fill, 0xffffff, 0.5), 0.35);

    ctx.globalCompositeOperation = 'source-over';

    const src = new THREE.CanvasTexture(surface.source);
    src.mapping = THREE.EquirectangularReflectionMapping;
    src.colorSpace = THREE.SRGBColorSpace;
    src.needsUpdate = true;

    const previous = this.target;
    this.target = this.pmrem.fromEquirectangular(src);
    this.texture = this.target.texture;

    src.dispose();
    previous?.dispose();

    return this.texture;
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.texture = null;
    this.pmrem.dispose();
  }
}

export function createEnvironment(renderer: THREE.WebGLRenderer): EnvironmentRig {
  return new EnvironmentRig(renderer);
}
