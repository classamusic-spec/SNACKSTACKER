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
  /** 0 kills shake entirely (reduced motion), 1 is the authored amount. */
  setShakeScale(scale: number): void;
  /** Pin the shadow frustum to a height; null tracks the camera. */
  setFocusY(y: number | null): void;
  /** Tell the backdrop where the plate sits, for the contact shadow. */
  setGround(y: number, contactRadius?: number, contactStrength?: number): void;
  /** Apply tier-correct shadow flags to anything the game adds to the scene. */
  applyShadowFlags(root: THREE.Object3D, cast?: boolean, receive?: boolean): void;
  /** Momentary bloom/exposure punch, 0..1. */
  flash(amount: number): void;
  resize(width: number, height: number): void;
  update(dt: number, elapsed: number): void;
  render(): void;
  /** Drop the tier one step when the frame governor asks. */
  degrade(): void;
  dispose(): void;
}

/**
 * The sky a theme sits under. The cyclorama is a studio sweep by default; an
 * outdoor theme wants actual atmosphere behind it — a sun, cloud, a horizon
 * that glows where the light is coming from.
 */
export interface SkyConfig {
  /** 'studio' keeps the plain sweep. 'open' renders atmosphere. */
  kind: 'studio' | 'open';
  /** Where the light comes from, in radians. Elevation 0 is the horizon. */
  sunAzimuth: number;
  sunElevation: number;
  /** Disc colour and how hot it burns. 0 hides the disc but keeps the glow. */
  sunColor: number;
  sunIntensity: number;
  /** Bloom of light around the sun, spreading into the sky. */
  glowColor: number;
  glowSpread: number;
  /** 0 clear, 1 overcast. */
  cloudCover: number;
  cloudColor: number;
  /** Underside shading, which is what stops clouds reading as white blobs. */
  cloudShadow: number;
  /** How fast the cloud field drifts, in UV units per second. */
  cloudDrift: number;
  /** Haze band where sky meets ground. */
  horizonColor: number;
  horizonSoftness: number;
  /** Night only: 0 none, 1 dense. */
  stars: number;
}

/** Structural copy of ThemePalette so render/ does not import content/. */
export interface ThemePaletteLike {
  /** Optional; omitted means the plain studio sweep. */
  sky?: SkyConfig;
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
