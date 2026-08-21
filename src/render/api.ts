import type * as THREE from 'three';
import type { QualityTier } from '../core/types';

export interface StdMatOpts {
  color: number;
  roughness?: number;
  metalness?: number;
  emissive?: number;
  emissiveIntensity?: number;
  map?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  normalScale?: number;
  roughnessMap?: THREE.Texture | null;
  aoMap?: THREE.Texture | null;
  bumpMap?: THREE.Texture | null;
  bumpScale?: number;
  flatShading?: boolean;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  vertexColors?: boolean;
  toneMapped?: boolean;
  depthWrite?: boolean;
}

export interface PhysMatOpts extends StdMatOpts {
  clearcoat?: number;
  clearcoatRoughness?: number;
  sheen?: number;
  sheenColor?: number;
  sheenRoughness?: number;
  transmission?: number;
  thickness?: number;
  ior?: number;
  attenuationColor?: number;
  attenuationDistance?: number;
  iridescence?: number;
  specularIntensity?: number;
}

export type CanvasPainter = (
  ctx: CanvasRenderingContext2D,
  size: number,
) => void;

export interface TextureOpts {
  size?: number;
  repeat?: [number, number];
  srgb?: boolean;
  anisotropy?: number;
  wrap?: THREE.Wrapping;
}

/**
 * Central cache for materials, textures and geometry. Everything is keyed so
 * that a 60-layer tower shares a handful of GPU programs instead of hundreds.
 */
export interface MaterialLibrary {
  readonly quality: QualityTier;
  /** Cached MeshStandardMaterial. Same opts -> same instance. */
  standard(key: string, opts: StdMatOpts): THREE.MeshStandardMaterial;
  /** Cached MeshPhysicalMaterial for glaze / jelly / glass looks. */
  physical(key: string, opts: PhysMatOpts): THREE.MeshPhysicalMaterial;
  /** Cached procedural canvas texture. */
  texture(key: string, paint: CanvasPainter, opts?: TextureOpts): THREE.Texture;
  /** Cached bump/normal-ish grayscale texture (linear colour space). */
  dataTexture(key: string, paint: CanvasPainter, opts?: TextureOpts): THREE.Texture;
  /** Cache any disposable resource by key. */
  cache<T>(key: string, make: () => T): T;
  /** Environment map used for reflections; assigned by the scene kit. */
  environment: THREE.Texture | null;
  dispose(): void;
}

export interface RenderQualitySettings {
  tier: QualityTier;
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  softParticles: boolean;
  maxLights: number;
}

export interface SceneKit {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly materials: MaterialLibrary;
  readonly quality: RenderQualitySettings;
  /** Re-tint lights, fog and background for a theme. */
  applyPalette(palette: ThemePaletteLike): void;
  /** Kick a short screen-shake; magnitude in world units. */
  shake(magnitude: number, duration?: number): void;
  /** Momentary bloom/exposure punch, 0..1. */
  flash(amount: number): void;
  resize(width: number, height: number): void;
  update(dt: number, elapsed: number): void;
  render(): void;
  /** Drop the tier one step when the frame governor asks. */
  degrade(): void;
  dispose(): void;
}

/** Structural copy of ThemePalette so render/ does not import content/. */
export interface ThemePaletteLike {
  bgTop: number;
  bgBottom: number;
  fog: number;
  fogDensity: number;
  key: number;
  keyIntensity: number;
  fill: number;
  fillIntensity: number;
  rim: number;
  rimIntensity: number;
  ground: number;
  accent: number;
  accentSoft: number;
  bloomStrength: number;
  exposure: number;
  vignette: number;
}
