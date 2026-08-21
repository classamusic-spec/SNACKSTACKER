import type * as THREE from 'three';
import type { Rng } from '../core/rng';
import type { QualityTier, ThemeId } from '../core/types';
import type { MaterialLibrary, ThemePaletteLike } from '../render/api';

export interface FoodBuildCtx {
  /** Footprint along X. */
  width: number;
  /** Footprint along Z. */
  depth: number;
  /** Vertical thickness the mesh must occupy. */
  height: number;
  /** Tower layer index (0 = first dropped layer) — use for deterministic variety. */
  index: number;
  rng: Rng;
  quality: QualityTier;
  materials: MaterialLibrary;
  /**
   * True when building the sliced-off scrap that tumbles away. Offcuts may use
   * cheaper geometry and are never seen close-up for long.
   */
  offcut: boolean;
}

/**
 * A single stackable food. `build` must return an Object3D whose bounding box is
 * centred on X/Z at the origin and occupies y in [0, height]. Anything that
 * overhangs the width/depth footprint (a lettuce ruffle, a sesame seed) is fine
 * as long as the visual centre of mass stays inside it.
 */
export interface FoodDef {
  id: string;
  name: string;
  /** Emoji shown in UI tickers and the collection book. */
  glyph: string;
  /** Vertical thickness in world units (1 unit == one "standard" slab). */
  thickness: number;
  /** Dominant colour: drives particles, trails and UI accents for this layer. */
  tint: number;
  /** Optional secondary colour for crumbs/splashes. */
  tintAlt?: number;
  /** Relative frequency when the theme picks a random food. Default 1. */
  weight?: number;
  build(ctx: FoodBuildCtx): THREE.Object3D;
}

/**
 * Context for building the world a tower is assembled in. Built once per run,
 * not per layer, so it can afford more geometry than a food — but it must stay
 * behind the tower and never compete with it for attention.
 */
export interface EnvBuildCtx {
  /**
   * World Y of the table's top surface. The plate is already sitting exactly
   * here, so the table top must land on this plane — not above it, or it will
   * poke through the plate.
   */
  tableTopY: number;
  /** Footprint of the plate, so the table is sized in proportion to it. */
  plateWidth: number;
  /** Footprint of a full-size food layer. */
  baseFootprint: number;
  rng: Rng;
  quality: QualityTier;
  materials: MaterialLibrary;
}

export interface ThemeDef {
  id: ThemeId;
  name: string;
  tagline: string;
  glyph: string;
  /** 0 means free / included. */
  price: number;
  palette: ThemePaletteLike;
  /** Foods cycle in order so towers read as a recipe, not noise. */
  foods: FoodDef[];
  /**
   * Indices into `foods`, bottom to top, for the hero tower on the home
   * screen. The gameplay run cycles in authored order, which is right for the
   * game but not necessarily an appetising assembly — a burger is authored
   * top-down and would otherwise be built upside down with loose pickle chips
   * on the summit. Defaults to the first six foods.
   */
  hero?: number[];
  /** The plate/board/tray the tower is built on. */
  plate(ctx: FoodBuildCtx): THREE.Object3D;
  /**
   * The place this theme happens in: the table the plate rests on, and the
   * scene behind it — a backyard barbecue, a blossom garden, a piazza
   * terrace. Everything must sit at or below `tableTopY` so the tower always
   * reads against the sky, and must look right from any angle, because the
   * home screen slowly turns the camera around it.
   */
  environment?(ctx: EnvBuildCtx): THREE.Object3D;
  /** Musical mood key for the audio engine. */
  ambience: 'diner' | 'sushi' | 'candy' | 'taco' | 'breakfast' | 'pizza';
}

export interface ThemeCatalog {
  all: ThemeDef[];
  byId(id: ThemeId): ThemeDef;
  default: ThemeDef;
}
