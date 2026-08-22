import * as THREE from 'three';
import { clamp01, damp } from '../core/math';
import type { QualityTier } from '../core/types';
import type {
  MaterialLibrary,
  RenderQualitySettings,
  SceneKit,
  SkyConfig,
  ThemePaletteLike,
} from './api';
import { Backdrop, createBackdrop } from './backdrop';
import { createEnvironment, EnvironmentRig } from './environment';
import { createLightRig, LightRig, shadowMapSizeFor } from './lighting';
import { createMaterialLibrary, MaterialLib } from './MaterialLibrary';
import { copyPalette, DEFAULT_PALETTE, PALETTE_FADE, SKY_PRESETS } from './palette';
import { createPostChain, PostChain } from './post';
import { CameraShake } from './shake';
import { cssHex, makeSurface } from './surface';

export type { PostChain } from './post';
export { DEFAULT_PALETTE, SKY_PRESETS } from './palette';
export { MaterialLib } from './MaterialLibrary';

export interface SceneKitOpts {
  canvas: HTMLCanvasElement;
  quality: QualityTier;
  pixelRatio: number;
  /**
   * Optional. Cuts screen shake to nothing. Defaults to the OS setting —
   * `prefers-reduced-motion` — so the kit is well behaved even if the caller
   * forgets to pass it.
   */
  reducedMotion?: boolean;
  /** Optional starting theme. Defaults to Classic Diner. */
  palette?: ThemePaletteLike;
}

const CAMERA_FOV = 42;
const CAMERA_NEAR = 0.5;
const CAMERA_FAR = 220;
/** Fill rate is the number one mobile cost; these caps are deliberate. */
const DPR_CAP: Record<QualityTier, number> = { high: 2, medium: 1.75, low: 1.35 };

function clampDpr(tier: QualityTier, requested: number): number {
  const wanted = Number.isFinite(requested) && requested > 0 ? requested : 1;
  return Math.max(1, Math.min(wanted, DPR_CAP[tier]));
}

/**
 * TEMPORARY — REMOVE. Content owns `palette.sky` and has not wired it yet, so
 * this stands the presets up against the real themes long enough to measure
 * them. Keyed on bgTop because that is unique per palette, and off by default
 * unless the probe harness seeds the flag.
 */
const TEMP_SKY_BY_BGTOP: Record<number, keyof typeof SKY_PRESETS> = {
  0xffe7c4: 'diner',
  0x22384a: 'sushi',
  0xffe3f5: 'candy',
  0xffc46b: 'taco',
  0xfff3d6: 'breakfast',
  0xffe9c7: 'pizza',
};
let TEMP_skyFlag: string | null | undefined;
let TEMP_skyOverride: Partial<SkyConfig> | null | undefined;
function TEMP_injectSky(p: ThemePaletteLike): ThemePaletteLike {
  if (TEMP_skyFlag === undefined) {
    try {
      TEMP_skyFlag = localStorage.getItem('snackery.sky');
      const raw = localStorage.getItem('snackery.sky.override');
      TEMP_skyOverride = raw ? (JSON.parse(raw) as Partial<SkyConfig>) : null;
    } catch {
      TEMP_skyFlag = null;
      TEMP_skyOverride = null;
    }
  }
  let sky = p.sky;
  if (!sky && TEMP_skyFlag === 'on') {
    const id = TEMP_SKY_BY_BGTOP[p.bgTop];
    if (id) sky = SKY_PRESETS[id];
  }
  if (!sky) return p;
  if (TEMP_skyOverride) sky = { ...sky, ...TEMP_skyOverride };
  return sky === p.sky ? p : { ...p, sky };
}

function nextTierDown(tier: QualityTier): QualityTier {
  return tier === 'high' ? 'medium' : 'low';
}

class Kit implements SceneKit {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly materials: MaterialLibrary;
  readonly quality: RenderQualitySettings;

  private readonly lib: MaterialLib;
  private readonly lights: LightRig;
  private readonly backdrop: Backdrop;
  private readonly env: EnvironmentRig;
  private readonly shaker = new CameraShake();
  private post: PostChain | null;

  private readonly palette: ThemePaletteLike = { ...DEFAULT_PALETTE };
  private readonly fog: THREE.FogExp2;
  private width = 1;
  private height = 1;
  private lastDt = 1 / 60;
  private flashAmount = 0;
  private baseExposure = DEFAULT_PALETTE.exposure;
  private focusY: number | null = null;
  private disposed = false;

  // palette crossfade for the pieces the sub-rigs do not own
  private fadeT = 1;
  private fadeDur = PALETTE_FADE;
  private readonly fromFog = new THREE.Color();
  private readonly toFog = new THREE.Color();
  private fromDensity = DEFAULT_PALETTE.fogDensity;
  private toDensity = DEFAULT_PALETTE.fogDensity;
  private fromExposure = DEFAULT_PALETTE.exposure;
  private toExposure = DEFAULT_PALETTE.exposure;

  constructor(opts: SceneKitOpts) {
    const tier = opts.quality;
    const start = opts.palette ?? DEFAULT_PALETTE;
    copyPalette(start, this.palette);

    const dpr = clampDpr(tier, opts.pixelRatio);

    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      // MSAA on the default framebuffer only matters on the low tier, which is
      // the one tier that draws straight to the canvas — but a composer target
      // carries its own samples, so honour the tier rule either way.
      antialias: tier !== 'low',
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = start.exposure;
    this.renderer.shadowMap.enabled = tier !== 'low';
    // r185 removed PCFSoftShadowMap (it warns and silently falls back). Modern
    // PCF is a 5-tap Vogel disk scaled by `light.shadow.radius`, which is where
    // the softness now comes from — see LightRig.setQuality().
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setClearColor(start.bgBottom, 1);

    this.scene = new THREE.Scene();
    this.scene.name = 'snackery';
    this.fog = new THREE.FogExp2(start.fog, start.fogDensity);
    this.scene.fog = this.fog;
    this.scene.environmentIntensity = 0.85;

    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
    this.camera.position.set(0, 5.4, 12.6);
    this.camera.lookAt(0, 2.2, 0);

    this.lib = createMaterialLibrary({ renderer: this.renderer, quality: tier });
    this.materials = this.lib;

    this.env = createEnvironment(this.renderer);
    const envTex = this.env.build(start);
    this.scene.environment = envTex;
    this.lib.environment = envTex;

    this.lights = createLightRig({ quality: tier });
    this.scene.add(this.lights.group);

    this.post = createPostChain({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      tier,
      palette: start,
    });

    this.backdrop = createBackdrop({ direct: this.post === null, quality: tier });
    this.scene.add(this.backdrop.group);

    this.quality = {
      tier,
      pixelRatio: dpr,
      shadows: tier !== 'low',
      shadowMapSize: shadowMapSizeFor(tier),
      bloom: this.post !== null,
      softParticles: tier === 'high',
      maxLights: this.lights.lightCount,
    };

    this.shaker.scale = this.resolveReducedMotion(opts.reducedMotion) ? 0 : 1;

    // Snap, do not fade, for the very first palette.
    this.applyPalette(start, 0);
    this.lights.resetFocus(this.camera.position.y);

    const size = this.measure(opts.canvas);
    this.resize(size[0], size[1]);
  }

  private resolveReducedMotion(explicit: boolean | undefined): boolean {
    if (explicit !== undefined) return explicit;
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private measure(canvas: HTMLCanvasElement): [number, number] {
    const w = canvas.clientWidth || canvas.width || 1;
    const h = canvas.clientHeight || canvas.height || 1;
    return [w, h];
  }

  // ------------------------------------------------------------- palette

  applyPalette(p: ThemePaletteLike, duration = PALETTE_FADE): void {
    p = TEMP_injectSky(p);
    copyPalette(p, this.palette);

    this.fromFog.copy(this.fog.color);
    this.toFog.setHex(p.fog, THREE.SRGBColorSpace);
    this.fromDensity = this.fog.density;
    this.toDensity = p.fogDensity;
    this.fromExposure = this.baseExposure;
    this.toExposure = p.exposure;
    this.fadeDur = Math.max(0, duration);
    this.fadeT = 0;

    this.lights.applyPalette(p, duration);
    this.backdrop.applyPalette(p, duration);
    this.post?.applyPalette(p);

    // The environment is a prefiltered cube, so it cannot be crossfaded — but
    // it is only ever seen as reflections, and a theme swap happens behind a
    // UI transition. Rebuild it once, here.
    const envTex = this.env.build(p);
    this.scene.environment = envTex;
    this.lib.environment = envTex;

    if (this.fadeDur === 0) this.commitPalette(1);
  }

  private commitPalette(t: number): void {
    this.fog.color.lerpColors(this.fromFog, this.toFog, t);
    this.fog.density = this.fromDensity + (this.toDensity - this.fromDensity) * t;
    this.baseExposure = this.fromExposure + (this.toExposure - this.fromExposure) * t;
    this.renderer.setClearColor(this.fog.color, 1);
    this.backdrop.setExposure(this.baseExposure);
    this.fadeT = t;
  }

  // --------------------------------------------------------------- feel

  shake(magnitude: number, duration = 0.36): void {
    this.shaker.add(magnitude, duration);
  }

  /** Extra: 0 kills shake (reduced motion), 1 is the authored amount. */
  setShakeScale(s: number): void {
    this.shaker.scale = Math.max(0, s);
  }

  flash(amount: number): void {
    this.flashAmount = Math.max(this.flashAmount, clamp01(amount));
  }

  /**
   * Extra: pin the shadow frustum to a height. Without it the rig tracks
   * `camera.position.y`, which is right for the normal follow camera.
   */
  setFocusY(y: number | null): void {
    this.focusY = y;
  }

  /** Extra: hand the backdrop the plate's height and contact-shadow size. */
  setGround(y: number, contactRadius = 2.9, contactStrength = 0.4): void {
    this.backdrop.setGroundY(y);
    this.backdrop.setContactShadow(contactRadius, contactStrength);
  }

  /** Extra: hide the studio floor when a theme supplies its own surface. */
  setGroundVisible(visible: boolean): void {
    this.backdrop.setGroundVisible(visible);
  }

  /** Extra: tier-correct shadow flags for anything the game adds to the scene. */
  applyShadowFlags(root: THREE.Object3D, cast = true, receive = true): void {
    const on = this.quality.shadows;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = on && cast;
      mesh.receiveShadow = on && receive;
    });
  }

  // -------------------------------------------------------------- frame

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));

    const dpr = clampDpr(this.quality.tier, this.quality.pixelRatio);
    this.quality.pixelRatio = dpr;

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);

    this.post?.setSize(this.width, this.height, dpr);
    // The backdrop reads gl_FragCoord, which is in drawing-buffer pixels.
    this.backdrop.setSize(this.width * dpr, this.height * dpr);
  }

  update(dt: number, elapsed: number): void {
    // A backgrounded tab hands back a huge dt; clamp so nothing snaps.
    const step = Math.min(Math.max(dt, 0), 0.05);
    this.lastDt = step;

    if (this.fadeT < 1 && this.fadeDur > 0) {
      this.commitPalette(Math.min(1, this.fadeT + step / this.fadeDur));
    }

    if (this.flashAmount > 0) {
      this.flashAmount = damp(this.flashAmount, 0, 7.5, step);
      if (this.flashAmount < 0.002) this.flashAmount = 0;
    }
    this.renderer.toneMappingExposure = this.baseExposure * (1 + this.flashAmount * 0.55);
    this.post?.setFlash(this.flashAmount);

    this.lights.update(step, this.focusY ?? this.camera.position.y);
    this.backdrop.update(step, this.camera);
    this.shaker.update(step);
    this.post?.update(step, elapsed);
  }

  render(): void {
    // Shake is layered on top of whatever transform the game set this frame,
    // then peeled straight back off — see CameraShake.apply().
    this.shaker.apply(this.camera);
    if (this.post) this.post.render(this.lastDt);
    else this.renderer.render(this.scene, this.camera);
    this.shaker.restore(this.camera);
  }

  // ------------------------------------------------------------- quality

  degrade(): void {
    if (this.quality.tier === 'low') return;
    const tier = nextTierDown(this.quality.tier);

    this.quality.tier = tier;
    this.quality.pixelRatio = clampDpr(tier, this.quality.pixelRatio);
    this.quality.shadows = tier !== 'low';
    this.quality.shadowMapSize = shadowMapSizeFor(tier);
    this.quality.softParticles = false;

    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.lights.setQuality(tier);
    this.quality.maxLights = this.lights.lightCount;

    this.post?.dispose();
    this.post = createPostChain({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      tier,
      palette: this.palette,
    });
    this.quality.bloom = this.post !== null;
    this.backdrop.setDirect(this.post === null);
    // Fewer cloud octaves at the new tier. Only recompiles if a sky is up.
    this.backdrop.setQuality(tier);

    // Toggling shadow maps changes every lit program's permutation, and three
    // only re-derives that when a material asks it to.
    this.lib.invalidatePrograms();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material;
      if (Array.isArray(m)) for (let i = 0; i < m.length; i++) m[i].needsUpdate = true;
      else if (m) m.needsUpdate = true;
    });

    this.resize(this.width, this.height);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.post?.dispose();
    this.post = null;
    this.scene.remove(this.backdrop.group, this.lights.group);
    this.backdrop.dispose();
    this.lights.dispose();
    this.env.dispose();
    this.lib.dispose();
    this.scene.environment = null;
    this.scene.fog = null;
    this.scene.clear();
    this.renderer.dispose();
  }
}

export function createSceneKit(opts: SceneKitOpts): SceneKit {
  return new Kit(opts);
}

/**
 * A flat two-stop gradient of the theme, for anywhere that wants the palette as
 * an image (a CSS-free loading screen, a shop card, a `scene.background`
 * fallback). The live backdrop is a shader, not this.
 */
export function paletteToBackground(p: ThemePaletteLike, size = 256): THREE.Texture {
  const surface = makeSurface(4, size);
  if (!surface) {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    tex.needsUpdate = true;
    return tex;
  }
  const ctx = surface.ctx;
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, cssHex(p.bgTop));
  g.addColorStop(1, cssHex(p.bgBottom));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, size);

  const tex = new THREE.CanvasTexture(surface.source);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
