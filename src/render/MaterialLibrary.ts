import * as THREE from 'three';
import type { QualityTier } from '../core/types';
import type {
  CanvasPainter,
  MaterialLibrary,
  PhysMatOpts,
  StdMatOpts,
  TextureOpts,
} from './api';
import { makeSurface } from './surface';

/** Anything the library owns and must destroy on dispose(). */
interface Disposable {
  dispose(): void;
}

function isDisposable(value: unknown): value is Disposable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<Disposable>).dispose === 'function'
  );
}

/** Textures stay power-of-two so mip chains are exact on every driver. */
function nearestPot(n: number): number {
  return 1 << Math.round(Math.log2(Math.max(8, Math.min(2048, n))));
}

export interface MaterialLibraryOpts {
  renderer: THREE.WebGLRenderer;
  quality: QualityTier;
}

/**
 * Keyed cache for every GPU resource the food builders ask for.
 *
 * The contract is deliberately blunt: **the key is the identity**. Calling
 * `standard('cheddar', ...)` twice returns the exact same instance and the
 * second set of options is ignored, so a 60-layer tower compiles a handful of
 * shader programs instead of hundreds.
 */
export class MaterialLib implements MaterialLibrary {
  readonly quality: QualityTier;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly standards = new Map<string, THREE.MeshStandardMaterial>();
  private readonly physicals = new Map<string, THREE.MeshPhysicalMaterial>();
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly generic = new Map<string, unknown>();
  /** Every standard/physical material, so an env map swap reaches all of them. */
  private readonly lit: THREE.MeshStandardMaterial[] = [];
  private env: THREE.Texture | null = null;
  private disposed = false;
  private readonly maxAniso: number;
  private readonly texScale: number;

  constructor(opts: MaterialLibraryOpts) {
    this.renderer = opts.renderer;
    this.quality = opts.quality;

    const hwAniso = this.renderer.capabilities.getMaxAnisotropy();
    const tierAniso = opts.quality === 'high' ? 8 : opts.quality === 'medium' ? 4 : 1;
    this.maxAniso = Math.max(1, Math.min(hwAniso, tierAniso));
    this.texScale = opts.quality === 'low' ? 0.5 : 1;
  }

  // ---------------------------------------------------------------- env map

  get environment(): THREE.Texture | null {
    return this.env;
  }

  set environment(tex: THREE.Texture | null) {
    if (this.env === tex) return;
    this.env = tex;
    for (let i = 0; i < this.lit.length; i++) {
      const m = this.lit[i];
      const had = m.envMap !== null;
      m.envMap = tex;
      // Going null -> texture (or back) changes the shader permutation.
      if (had !== (tex !== null)) m.needsUpdate = true;
    }
  }

  // -------------------------------------------------------------- materials

  standard(key: string, opts: StdMatOpts): THREE.MeshStandardMaterial {
    const hit = this.standards.get(key);
    if (hit) return hit;
    const m = new THREE.MeshStandardMaterial();
    m.name = key;
    this.applyStd(m, opts);
    this.standards.set(key, m);
    this.lit.push(m);
    return m;
  }

  physical(key: string, opts: PhysMatOpts): THREE.MeshPhysicalMaterial {
    const hit = this.physicals.get(key);
    if (hit) return hit;
    const m = new THREE.MeshPhysicalMaterial();
    m.name = key;
    this.applyStd(m, opts);

    if (opts.clearcoat !== undefined) m.clearcoat = opts.clearcoat;
    if (opts.clearcoatRoughness !== undefined) m.clearcoatRoughness = opts.clearcoatRoughness;
    if (opts.sheen !== undefined) m.sheen = opts.sheen;
    if (opts.sheenColor !== undefined) m.sheenColor.setHex(opts.sheenColor, THREE.SRGBColorSpace);
    if (opts.sheenRoughness !== undefined) m.sheenRoughness = opts.sheenRoughness;
    if (opts.transmission !== undefined) m.transmission = opts.transmission;
    if (opts.thickness !== undefined) m.thickness = opts.thickness;
    if (opts.ior !== undefined) m.ior = opts.ior;
    if (opts.attenuationColor !== undefined) {
      m.attenuationColor.setHex(opts.attenuationColor, THREE.SRGBColorSpace);
    }
    if (opts.attenuationDistance !== undefined) m.attenuationDistance = opts.attenuationDistance;
    if (opts.iridescence !== undefined) m.iridescence = opts.iridescence;
    if (opts.specularIntensity !== undefined) m.specularIntensity = opts.specularIntensity;

    // Transmission is a second scene render per frame; never on a phone's low tier.
    if (this.quality === 'low' && m.transmission > 0) {
      m.transmission = 0;
      m.transparent = true;
      m.opacity = Math.min(opts.opacity ?? 1, 0.86);
    }

    this.physicals.set(key, m);
    this.lit.push(m);
    return m;
  }

  private applyStd(m: THREE.MeshStandardMaterial, o: StdMatOpts): void {
    m.color.setHex(o.color, THREE.SRGBColorSpace);
    m.roughness = o.roughness ?? 0.6;
    m.metalness = o.metalness ?? 0;
    if (o.emissive !== undefined) m.emissive.setHex(o.emissive, THREE.SRGBColorSpace);
    if (o.emissiveIntensity !== undefined) m.emissiveIntensity = o.emissiveIntensity;
    if (o.map) m.map = o.map;
    if (o.normalMap) {
      m.normalMap = o.normalMap;
      m.normalScale.setScalar(o.normalScale ?? 1);
    }
    if (o.roughnessMap) m.roughnessMap = o.roughnessMap;
    if (o.aoMap) m.aoMap = o.aoMap;
    if (o.bumpMap) {
      m.bumpMap = o.bumpMap;
      m.bumpScale = o.bumpScale ?? 1;
    }
    if (o.flatShading !== undefined) m.flatShading = o.flatShading;
    if (o.transparent !== undefined) m.transparent = o.transparent;
    if (o.opacity !== undefined) m.opacity = o.opacity;
    if (o.side !== undefined) m.side = o.side;
    if (o.vertexColors !== undefined) m.vertexColors = o.vertexColors;
    if (o.toneMapped !== undefined) m.toneMapped = o.toneMapped;
    if (o.depthWrite !== undefined) m.depthWrite = o.depthWrite;

    // Glossy food drinks in more of the studio softboxes than a rough crumb
    // does; this single line is most of the "wet look".
    m.envMapIntensity = THREE.MathUtils.clamp(0.9 - m.roughness * 0.45, 0.5, 0.9);
    m.envMap = this.env;
  }

  // --------------------------------------------------------------- textures

  texture(key: string, paint: CanvasPainter, opts: TextureOpts = {}): THREE.Texture {
    return this.bakeTexture(key, paint, opts, opts.srgb ?? true);
  }

  dataTexture(key: string, paint: CanvasPainter, opts: TextureOpts = {}): THREE.Texture {
    return this.bakeTexture(key, paint, opts, opts.srgb ?? false);
  }

  private bakeTexture(
    key: string,
    paint: CanvasPainter,
    opts: TextureOpts,
    srgb: boolean,
  ): THREE.Texture {
    const hit = this.textures.get(key);
    if (hit) return hit;

    const size = nearestPot((opts.size ?? 256) * this.texScale);
    const surface = makeSurface(size);

    let tex: THREE.Texture;
    if (surface) {
      surface.ctx.save();
      paint(surface.ctx, size);
      surface.ctx.restore();
      tex = new THREE.CanvasTexture(surface.source);
    } else {
      // Headless / context-less fallback: a 1x1 white texture keeps materials valid.
      tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
      tex.needsUpdate = true;
    }

    tex.name = key;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;

    const wrap = opts.wrap ?? THREE.RepeatWrapping;
    tex.wrapS = wrap;
    tex.wrapT = wrap;
    if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);

    tex.anisotropy = Math.max(1, Math.min(opts.anisotropy ?? this.maxAniso, this.maxAniso));
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;

    this.textures.set(key, tex);
    return tex;
  }

  // ---------------------------------------------------------- generic cache

  cache<T>(key: string, make: () => T): T {
    if (this.generic.has(key)) return this.generic.get(key) as T;
    const made = make();
    this.generic.set(key, made);
    return made;
  }

  // ---------------------------------------------------------------- upkeep

  /**
   * Force a shader recompile on everything we own. Needed after a live quality
   * change flips shadow maps or tone mapping, which alters the program key.
   */
  invalidatePrograms(): void {
    this.standards.forEach((m) => {
      m.needsUpdate = true;
    });
    this.physicals.forEach((m) => {
      m.needsUpdate = true;
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.standards.forEach((m) => m.dispose());
    this.physicals.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.generic.forEach((v) => {
      if (isDisposable(v)) v.dispose();
    });

    this.standards.clear();
    this.physicals.clear();
    this.textures.clear();
    this.generic.clear();
    this.lit.length = 0;
    this.env = null;
  }
}

export function createMaterialLibrary(opts: MaterialLibraryOpts): MaterialLib {
  return new MaterialLib(opts);
}
