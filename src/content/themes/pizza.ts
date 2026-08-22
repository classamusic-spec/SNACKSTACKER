/**
 * PIZZA PIAZZA — deep dish, thin crust, endless cheese.
 *
 * Ingredient run (DESIGN.md order): dough base, tomato sauce, mozzarella,
 * pepperoni, basil leaves, olives, bell pepper, parmesan dust.
 *
 * Silhouette discipline: the dough is a disc wearing a fat raised cornicione,
 * the sauce is a thin pooled sheet with short drips, the mozzarella is a lumpy
 * molten drift, the pepperoni are unmistakable upward-cupped coins, the basil
 * is a fan of pointed leaves, the olives are rings with holes in them, the
 * peppers are curved crescents and the parmesan is the thinnest layer in the
 * game with a granular fringe.
 */
import * as THREE from 'three';
import type { EnvBuildCtx, FoodBuildCtx, FoodDef, ThemeDef } from '../api';
import type { QualityTier } from '../../core/types';
import type { MaterialLibrary } from '../../render/api';
import { Rng } from '../../core/rng';
import { TAU, clamp } from '../../core/math';
import { fbm2, mergeAll, mesh, pour, puck, roughen, scatter, tintGeometry } from '../kit';
import {
  areaCount,
  arcStrip,
  boxAt,
  charPainter,
  coverCount,
  crumbBumpTex,
  cuppedDisc,
  cutSquare,
  ceilGeo,
  domeGeo,
  fineDetail,
  finishLayer,
  fitGeoY,
  geoHeight,
  leafGeo,
  leafVeinTex,
  mergeSafe,
  paintWoodGrain,
  pickQ,
  propSize,
  ringTorus,
  roughAmt,
  safe,
  specklePainter,
} from './shared-savory';

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------

const doughMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('pizza.dough', {
    color: 0xe0b173,
    roughness: 0.85,
    map: m.texture('pizza.doughChar', charPainter(0xf2ebe0, 0x8a5a2b, 120, 13), { size: 256 }),
    bumpMap: crumbBumpTex(m),
    bumpScale: 0.028,
  });

const crustMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('pizza.crust', {
    color: 0xd09a55,
    roughness: 0.88,
    map: m.texture('pizza.crustChar', charPainter(0xece0cf, 0x4d2c11, 240, 17), { size: 256 }),
    bumpMap: crumbBumpTex(m),
    bumpScale: 0.042,
  });

const sauceMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('pizza.sauce', {
    // matte, deep and dry — sauce must not compete with the cheese sheen
    color: 0xffffff,
    roughness: 0.68,
    map: m.texture(
      'pizza.saucePulp',
      specklePainter(
        0xa5271e,
        [
          { color: 0xd8412f, count: 120, min: 0.005, max: 0.028, alpha: 0.45 },
          { color: 0x6e1610, count: 90, min: 0.004, max: 0.02, alpha: 0.4 },
          { color: 0xe8b23a, count: 22, min: 0.003, max: 0.008, alpha: 0.35 },
        ],
        { seed: 61, mottle: 18 },
      ),
      { size: 256, repeat: [1.4, 1.4] },
    ),
  });

const mozzarellaMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('pizza.mozzarella', {
    color: 0xf7efd8,
    roughness: 0.34,
    transmission: 0.12,
    thickness: 0.18,
    ior: 1.4,
    clearcoat: 0.32,
    clearcoatRoughness: 0.35,
  });

const blisterMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('pizza.blister', { color: 0xd9a24e, roughness: 0.5 });

const pepperoniMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('pizza.pepperoni', {
    color: 0xffffff,
    roughness: 0.44,
    // rendered fat pooling in the cup
    clearcoat: 0.4,
    clearcoatRoughness: 0.28,
    map: m.texture(
      'pizza.pepperoniSkin',
      specklePainter(
        0xb0342b,
        [
          { color: 0x6e1c16, count: 110, min: 0.005, max: 0.024, alpha: 0.6 },
          { color: 0xe8dcc0, count: 70, min: 0.004, max: 0.016, alpha: 0.55 },
          { color: 0x2a1008, count: 34, min: 0.003, max: 0.011, alpha: 0.6 },
        ],
        { seed: 77, mottle: 18 },
      ),
      { size: 256, repeat: [1.2, 1.2] },
    ),
  });

const basilMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('pizza.basil', {
    color: 0x2f6b2a,
    roughness: 0.62,
    side: THREE.DoubleSide,
    emissive: 0x1e4a1b,
    emissiveIntensity: 0.24,
    bumpMap: leafVeinTex(m),
    bumpScale: 0.005,
  });

const oliveMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('pizza.olive', {
    color: 0x2a2320,
    roughness: 0.34,
    clearcoat: 0.5,
    clearcoatRoughness: 0.25,
  });

const pepperMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('pizza.pepper', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.28,
    clearcoat: 0.55,
    clearcoatRoughness: 0.18,
  });

const parmesanMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('pizza.parmesan', { color: 0xf6ebc8, roughness: 0.82, flatShading: true });

const parmBedMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('pizza.parmBed', {
    color: 0xffffff,
    roughness: 0.74,
    map: m.texture(
      'pizza.parmDust',
      specklePainter(
        0xf1e2b8,
        [
          { color: 0xffffff, count: 200, min: 0.003, max: 0.012, alpha: 0.7 },
          { color: 0xd6c08a, count: 120, min: 0.003, max: 0.01, alpha: 0.45 },
        ],
        { seed: 88, mottle: 10 },
      ),
      { size: 256, repeat: [1.8, 1.8] },
    ),
  });

// ---------------------------------------------------------------------------
// foods
// ---------------------------------------------------------------------------

const doughBase: FoodDef = {
  id: 'pizza.dough',
  name: 'Dough Base',
  glyph: '🫓',
  thickness: 0.58,
  tint: 0xe0b173,
  tintAlt: 0xa9682c,
  build(ctx) {
    const g = new THREE.Group();
    const h = safe(ctx.height, 1e-3);
    const w = safe(ctx.width);
    const d = safe(ctx.depth);

    const sq = cutSquare(ctx);
    const body = puck(w * 0.97, h * 0.6, d * 0.97, {
      wobble: 0.045 + ctx.rng.range(-0.012, 0.012),
      domed: 0.12,
      radial: pickQ(ctx, 18, 30, 44),
      rings: pickQ(ctx, 3, 4, 6),
      seed: 1.3 + ctx.index * 0.71,
      square: sq,
    });
    roughen(body, roughAmt(ctx, 0.018), 7, ctx.index * 1.7);
    fitGeoY(body, h * 0.64);
    g.add(mesh(body, doughMat(ctx.materials)));

    // The cornicione. tubeFrac is a fraction of the footprint radius, so the
    // outer edge always lands exactly on width/2 and the ring degrades into a
    // thin raised lip on a sliver instead of self-intersecting.
    const ring = ringTorus(
      w,
      d,
      0.16,
      h * 0.36,
      pickQ(ctx, 5, 7, 9),
      pickQ(ctx, 20, 34, 52),
      sq,
    );
    ring.translate(0, h * 0.6, 0);
    roughen(ring, roughAmt(ctx, 0.03), 9, ctx.index * 2.9);
    g.add(mesh(ring, crustMat(ctx.materials)));

    // charred bubbles on the field
    if (fineDetail(ctx)) {
      const bd = propSize(ctx, 0.12, 0.17);
      const bubbles = scatter(
        areaCount(ctx, 6),
        w * 0.7,
        d * 0.7,
        (i) => domeGeo(bd, h * 0.1, 8, 5, 0.5),
        {
          seed: 5 + ctx.index,
          y: h * 0.6,
          margin: bd * 0.6,
          spacing: 0.2,
          randomYaw: true,
        },
      );
      if (bubbles) g.add(mesh(bubbles, crustMat(ctx.materials)));
    }
    return finishLayer(ctx, g);
  },
};

const tomatoSauce: FoodDef = {
  id: 'pizza.sauce',
  name: 'Tomato Sauce',
  glyph: '🍅',
  thickness: 0.24,
  tint: 0xa5271e,
  tintAlt: 0xd8412f,
  build(ctx) {
    const h = safe(ctx.height, 1e-3);
    const geo = pour(safe(ctx.width) * 0.96, h * 0.74, safe(ctx.depth) * 0.96, {
      drips: pickQ(ctx, 3, 4, 6),
      dripLength: 0.45,
      radial: pickQ(ctx, 20, 32, 48),
      seed: 13 + ctx.index * 2.1,
      square: cutSquare(ctx),
    });
    fitGeoY(geo, h);
    return finishLayer(ctx, mesh(geo, sauceMat(ctx.materials)));
  },
};

const mozzarella: FoodDef = {
  id: 'pizza.mozzarella',
  name: 'Mozzarella',
  glyph: '🧀',
  thickness: 0.38,
  tint: 0xf7efd8,
  tintAlt: 0xd9a24e,
  build(ctx) {
    const g = new THREE.Group();
    const h = safe(ctx.height, 1e-3);
    const w = safe(ctx.width);
    const d = safe(ctx.depth);

    const sq = cutSquare(ctx);
    // A molten sheet is a pour, not a slab: it follows the cut and its short
    // drips read as cheese running over the edge.
    const sheet = pour(w * 0.96, h * 0.3, d * 0.96, {
      drips: pickQ(ctx, 3, 4, 5),
      dripLength: 0.34,
      radial: pickQ(ctx, 18, 30, 44),
      seed: 2 + ctx.index,
      square: sq,
    });
    fitGeoY(sheet, h * 0.42);

    const pd = propSize(ctx, 0.55, 0.92);
    const puddles = scatter(
      coverCount(w, d, pd, 0.5, pickQ(ctx, 3, 5, 8)),
      w,
      d,
      (i, rng) => {
        const s = rng.range(0.75, 1.15);
        return puck(pd * s, h * 0.62, pd * s, {
          wobble: 0.22,
          domed: 0.5,
          radial: pickQ(ctx, 10, 14, 20),
          rings: 2,
          seed: 3 + i * 2.3,
          // a puddle is small because it is a puddle, not because it was cut
          square: 0,
        });
      },
      {
        seed: 31 + ctx.index,
        y: h * 0.3,
        margin: pd * 0.44,
        spacing: 0.16,
        randomYaw: true,
      },
    );
    const geo = mergeSafe([sheet, puddles]);
    if (geo) g.add(mesh(geo, mozzarellaMat(ctx.materials)));

    if (fineDetail(ctx)) {
      const bd = propSize(ctx, 0.1, 0.14);
      const blisters = scatter(
        areaCount(ctx, 7),
        w * 0.8,
        d * 0.8,
        () => domeGeo(bd, h * 0.09, 8, 5, 0.5),
        { seed: 45 + ctx.index, y: h * 0.78, margin: bd * 0.6, spacing: 0.18 },
      );
      if (blisters) g.add(mesh(blisters, blisterMat(ctx.materials)));
    }
    return finishLayer(ctx, g);
  },
};

const pepperoni: FoodDef = {
  id: 'pizza.pepperoni',
  name: 'Pepperoni',
  glyph: '🍕',
  thickness: 0.3,
  tint: 0xb0342b,
  tintAlt: 0x6e1c16,
  build(ctx) {
    const g = new THREE.Group();
    const h = safe(ctx.height, 1e-3);
    const w = safe(ctx.width);
    const d = safe(ctx.depth);

    const bed = pour(w * 0.95, h * 0.28, d * 0.95, {
      drips: pickQ(ctx, 3, 4, 5),
      dripLength: 0.3,
      radial: pickQ(ctx, 16, 28, 40),
      seed: 7 + ctx.index,
      square: cutSquare(ctx),
    });
    fitGeoY(bed, h * 0.4);
    g.add(mesh(bed, mozzarellaMat(ctx.materials)));

    // Disc diameter tracks the short axis and the count tracks coverage, so a
    // 0.15-wide sliver gets a row of small coins that stay inside the cut.
    const pepD = propSize(ctx, 0.42, 0.46);
    const n = coverCount(w, d, pepD, 0.32, pickQ(ctx, 4, 9, 14));
    const discs = scatter(
      n,
      w,
      d,
      (i, rng) => {
        const s = rng.range(0.86, 1.08);
        return cuppedDisc(pepD * s, h * 0.5 * rng.range(0.9, 1.1), {
          cup: 0.5,
          rimLift: 0.26,
          radial: pickQ(ctx, 10, 14, 20),
          seed: 2 + i * 1.9,
        });
      },
      {
        seed: 53 + ctx.index,
        y: h * 0.36,
        margin: pepD * 0.56,
        spacing: 0.2,
        randomYaw: true,
        randomTilt: 0.06,
      },
    );
    if (discs) g.add(mesh(discs, pepperoniMat(ctx.materials)));
    return finishLayer(ctx, g);
  },
};

const basilLeaves: FoodDef = {
  id: 'pizza.basil',
  name: 'Basil Leaves',
  glyph: '🌿',
  thickness: 0.26,
  tint: 0x2f6b2a,
  tintAlt: 0x5e9b47,
  build(ctx) {
    const g = new THREE.Group();
    const h = safe(ctx.height, 1e-3);
    const w = safe(ctx.width);
    const d = safe(ctx.depth);

    const len = Math.min(Math.min(w, d) * 0.62, 0.8);
    const wid = len * 0.58;
    const segU = pickQ(ctx, 5, 7, 10);
    const segV = pickQ(ctx, 2, 3, 4);

    // Leaves scale with the SHORT axis, so on a sliver they barely rise. Measure
    // one and let the sauce film take up the slack instead of letting fitHeight
    // stretch the leaves into ribbons.
    const proto = leafGeo(len, wid, { segU, segV, seed: 1 });
    const rise = geoHeight(proto);
    proto.dispose();
    const filmH = clamp(h - rise * 0.9, h * 0.4, h * 0.95);

    const film = pour(w * 0.94, filmH * 0.72, d * 0.94, {
      drips: pickQ(ctx, 2, 3, 4),
      dripLength: 0.26,
      radial: pickQ(ctx, 16, 26, 38),
      seed: 9 + ctx.index,
      square: cutSquare(ctx),
    });
    fitGeoY(film, filmH);
    g.add(mesh(film, sauceMat(ctx.materials)));

    const leaves = scatter(
      coverCount(w, d, len * 0.72, 0.42, pickQ(ctx, 3, 6, 10)),
      w,
      d,
      (i, rng) => {
        const s = rng.range(0.8, 1.15);
        return leafGeo(len * s, wid * s, {
          fold: 0.34,
          arch: 0.34,
          ruffle: 0.12,
          segU,
          segV,
          seed: 2 + i * 1.7,
        });
      },
      {
        seed: 67 + ctx.index,
        y: Math.max(0, filmH - rise * 0.18),
        margin: len * 0.4,
        spacing: 0.2,
        randomYaw: true,
        randomTilt: 0.1,
      },
    );
    if (leaves) g.add(mesh(leaves, basilMat(ctx.materials)));
    return finishLayer(ctx, g);
  },
};

const olives: FoodDef = {
  id: 'pizza.olives',
  name: 'Olives',
  glyph: '🫒',
  thickness: 0.34,
  tint: 0x2a2320,
  tintAlt: 0x6b5f52,
  build(ctx) {
    const g = new THREE.Group();
    const h = safe(ctx.height, 1e-3);
    const w = safe(ctx.width);
    const d = safe(ctx.depth);

    const bed = pour(w * 0.95, h * 0.28, d * 0.95, {
      drips: pickQ(ctx, 3, 4, 5),
      dripLength: 0.3,
      radial: pickQ(ctx, 16, 28, 40),
      seed: 11 + ctx.index,
      square: cutSquare(ctx),
    });
    fitGeoY(bed, h * 0.4);
    g.add(mesh(bed, mozzarellaMat(ctx.materials)));

    const od = propSize(ctx, 0.28, 0.32);
    const rings = scatter(
      coverCount(w, d, od, 0.3, pickQ(ctx, 4, 8, 14)),
      w,
      d,
      (i, rng) => {
        const s = rng.range(0.85, 1.1);
        // a sliced olive is a ring — the hole is the whole silhouette
        return ringTorus(
          od * s,
          od * s,
          0.3,
          h * 0.27,
          pickQ(ctx, 4, 5, 6),
          pickQ(ctx, 10, 13, 18),
        );
      },
      {
        seed: 71 + ctx.index,
        y: h * 0.62,
        margin: od * 0.6,
        spacing: 0.18,
        randomYaw: true,
        randomTilt: 0.12,
      },
    );
    if (rings) g.add(mesh(rings, oliveMat(ctx.materials)));
    return finishLayer(ctx, g);
  },
};

const PEPPER_COLORS = [0xc1272d, 0x5e9b47, 0xe8b23a] as const;

const bellPepper: FoodDef = {
  id: 'pizza.pepper',
  name: 'Bell Pepper',
  glyph: '🫑',
  thickness: 0.28,
  tint: 0xc1272d,
  tintAlt: 0x5e9b47,
  build(ctx) {
    const g = new THREE.Group();
    const h = safe(ctx.height, 1e-3);
    const w = safe(ctx.width);
    const d = safe(ctx.depth);

    const bed = pour(w * 0.95, h * 0.3, d * 0.95, {
      drips: pickQ(ctx, 3, 4, 5),
      dripLength: 0.28,
      radial: pickQ(ctx, 16, 28, 40),
      seed: 15 + ctx.index,
      square: cutSquare(ctx),
    });
    fitGeoY(bed, h * 0.42);
    g.add(mesh(bed, sauceMat(ctx.materials)));

    const outerR = Math.min(Math.min(w, d) * 0.34, 0.42);
    const strips = scatter(
      coverCount(w, d, outerR * 1.5, 0.34, pickQ(ctx, 3, 7, 12)),
      w,
      d,
      (i, rng) => {
        const s = rng.range(0.8, 1.15);
        const strip = arcStrip(
          outerR * s,
          0.34,
          h * 0.45 * rng.range(0.85, 1.1),
          rng.range(1.1, 1.9),
          pickQ(ctx, 3, 5, 7),
        );
        // one shared material, three pepper colours, zero extra draw calls
        return tintGeometry(strip, PEPPER_COLORS[i % PEPPER_COLORS.length]);
      },
      {
        seed: 83 + ctx.index,
        y: h * 0.4,
        margin: outerR * 0.9,
        spacing: 0.2,
        randomYaw: true,
        randomTilt: 0.22,
      },
    );
    if (strips) g.add(mesh(strips, pepperMat(ctx.materials)));
    return finishLayer(ctx, g);
  },
};

const parmesanDust: FoodDef = {
  id: 'pizza.parmesan',
  name: 'Parmesan Dust',
  glyph: '🧀',
  thickness: 0.22,
  tint: 0xf6ebc8,
  tintAlt: 0xe8d9a8,
  build(ctx) {
    const g = new THREE.Group();
    const h = safe(ctx.height, 1e-3);
    const w = safe(ctx.width);
    const d = safe(ctx.depth);

    // The thinnest layer in the game — the bed carries almost all the height so
    // the flakes stay flake-sized at every footprint.
    const bed = pour(w * 0.96, h * 0.66, d * 0.96, {
      drips: pickQ(ctx, 2, 3, 4),
      dripLength: 0.2,
      radial: pickQ(ctx, 16, 26, 38),
      seed: 19 + ctx.index,
      square: cutSquare(ctx),
    });
    fitGeoY(bed, h * 0.9);
    g.add(mesh(bed, parmBedMat(ctx.materials)));

    const fs = propSize(ctx, 0.05, 0.055);
    const flakes = scatter(
      areaCount(ctx, pickQ(ctx, 22, 55, 95), 3),
      w,
      d,
      (i, rng) => {
        const s = new THREE.TetrahedronGeometry(0.5, 0);
        s.scale(fs * rng.range(0.6, 1.2), fs * 0.42, fs * rng.range(0.5, 1));
        return s;
      },
      {
        seed: 97 + ctx.index,
        y: h * 0.88,
        margin: fs * 0.9,
        spacing: 0,
        randomYaw: true,
        randomTilt: 0.9,
      },
    );
    if (flakes) g.add(mesh(flakes, parmesanMat(ctx.materials)));
    return finishLayer(ctx, g);
  },
};

// ---------------------------------------------------------------------------
// plate & scenery
// ---------------------------------------------------------------------------

const boardThickness = (ctx: FoodBuildCtx): number =>
  ctx.height > 0.02 ? ctx.height : 0.15;

function pizzaPlate(ctx: FoodBuildCtx): THREE.Object3D {
  const m = ctx.materials;
  const t = boardThickness(ctx);
  const w = safe(ctx.width, 0.2);
  const d = safe(ctx.depth, 0.2);

  const board = boxAt(w, t, d, Math.min(w, t, d) * 0.12, pickQ(ctx, 2, 3, 4));
  const handle = boxAt(
    w * 0.17,
    t * 0.68,
    w * 0.36,
    Math.min(w * 0.17, t * 0.68) * 0.2,
    pickQ(ctx, 1, 2, 3),
  );
  handle.translate(0, t * 0.16, -(d / 2 + w * 0.15));
  const geo = mergeSafe([board, handle]);
  if (!geo) return new THREE.Group();

  roughen(geo, Math.min(t * 0.012, Math.min(w, d) * 0.01), 6, 3);
  // Built DOWNWARD: the board occupies y in [-t, 0]. ceilGeo (rather than a
  // blind translate) guarantees the top face is exactly y = 0 even after the
  // grain roughening pushes vertices around, so the first layer lands flush.
  ceilGeo(geo, 0);

  return mesh(
    geo,
    m.standard('pizza.board', {
      color: 0xffffff,
      roughness: 0.68,
      // ExtrudeGeometry caps carry world-unit UVs, so the repeat is set in
      // world units: one grain tile every ~2.9 units.
      map: m.texture('pizza.wood', paintWoodGrain, { size: 256, repeat: [0.34, 0.34] }),
      bumpMap: crumbBumpTex(m),
      bumpScale: 0.012,
    }),
    { cast: false },
  );
}

// ===========================================================================
// environment — a piazza terrace at dusk
// ===========================================================================

/**
 * Layout contract, in priority order:
 *
 *  1. The marble lands on `ctx.tableTopY` (a hair below, so it can never punch
 *     through the board or z-fight the contact shadow).
 *  2. Nothing rises above that plane within PROP_R of the middle, so neither
 *     the tower nor the layer sliding above it can ever meet a prop — at any
 *     camera yaw, since the home screen orbits a full turn.
 *  3. The piazza floor is `FLOOR_DROP` down and dissolves into the sweep with
 *     a baked vertex alpha, so there is no hard horizon and the backdrop still
 *     owns the top of frame.
 *
 * Everything merges into eight vertex-coloured draws: a whole street of
 * terracotta facades, roofs, pots and an awning is a single mesh.
 */

const ENV_SINK = 0.0025;
const TABLE_R = 3.35;
const TABLE_T = 0.19;
const FLOOR_DROP = 3.0;

/**
 * Tower clearance. The home screen orbits the camera a full turn, so there is
 * no such thing as "behind the tower" — a prop parked out of the way at 45 deg
 * is straight through the food half a rotation later. Every prop must satisfy
 * ONE of these, at every yaw:
 *
 *   a. it sits at or below the table plane, or
 *   b. it is further than PROP_R from the middle and rises no higher than
 *      PROP_LIFT above the table, or
 *   c. it is further than FAR_R out, where it may be tall: it is background.
 *
 * The bistro top is only 3.35 across, so nothing stands on it at all — the
 * bottle, cruet and shaker live on a lower side table out at SIDE_R.
 */
const PROP_R = 4.6;
const PROP_LIFT = 1.5;
const FAR_R = 9.5;
/** Where the side table stands, and how far its top sits below the bistro top. */
const SIDE_R = 5.7;
const SIDE_DROP = 0.95;

/** Shove a prop radially outwards until it clears the tower's cylinder. */
function clearOf(x: number, z: number, min = PROP_R): [number, number] {
  const r = Math.hypot(x, z);
  if (!(r > 1e-4)) return [min, 0];
  return r >= min ? [x, z] : [(x * min) / r, (z * min) / r];
}

const envPick = <T>(q: QualityTier, low: T, med: T, high: T): T =>
  q === 'low' ? low : q === 'medium' ? med : high;

/**
 * Merge bucket. Each part carries its colour in vertex colours, so a dozen
 * differently-tinted props collapse into a single draw call.
 */
class EnvBucket {
  private readonly parts: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry | null, color: number): void {
    if (!geo) return;
    const pos = geo.getAttribute('position');
    if (!pos || pos.count < 3) {
      geo.dispose();
      return;
    }
    let g = geo;
    // mergeGeometries refuses a mix of indexed and non-indexed inputs and the
    // kit hands back both kinds, so everything is flattened on the way in.
    if (g.index) {
      const flat = g.toNonIndexed();
      g.dispose();
      g = flat;
    }
    tintGeometry(g, color);
    this.parts.push(g);
  }

  build(mat: THREE.Material, cast: boolean, receive: boolean): THREE.Mesh | null {
    const merged = mergeAll(this.parts);
    this.parts.length = 0;
    if (!merged) return null;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    return m;
  }
}

/** Box with its base on y = 0. */
function envBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const hh = Math.max(h, 1e-3);
  const g = new THREE.BoxGeometry(Math.max(w, 1e-3), hh, Math.max(d, 1e-3));
  g.translate(0, hh / 2, 0);
  return g;
}

/** Cylinder / cone with its base on y = 0. */
function envCyl(rTop: number, rBot: number, h: number, sides: number): THREE.BufferGeometry {
  const hh = Math.max(h, 1e-3);
  const g = new THREE.CylinderGeometry(
    Math.max(rTop, 0),
    Math.max(rBot, 1e-4),
    hh,
    Math.max(3, Math.round(sides)),
    1,
  );
  g.translate(0, hh / 2, 0);
  return g;
}

/** Faceted blob, centred on its own origin. */
function envBlob(r: number, detail: number): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(Math.max(r, 1e-3), Math.max(0, detail));
}

/** Author a prop at the origin with its base on y = 0, then post it here. */
function at(g: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0): THREE.BufferGeometry {
  if (yaw) g.rotateY(yaw);
  g.translate(x, y, z);
  return g;
}

/** A rod between two arbitrary points — chair legs, festoon wire. */
const STRUT_UP = new THREE.Vector3(0, 1, 0);
function strut(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r: number,
  sides: number,
): THREE.BufferGeometry | null {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 1e-4) || !Number.isFinite(len)) return null;
  const g = new THREE.CylinderGeometry(Math.max(r, 1e-4), Math.max(r, 1e-4), len, Math.max(3, sides), 1);
  const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(STRUT_UP, dir));
  g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  return g;
}

/**
 * A ring-tessellated ground disc with per-vertex RGBA, so the far rim fades to
 * nothing instead of ending on a hard edge. Planar UVs in world units keep the
 * paving tiling even across every ring.
 */
function envGround(
  radii: readonly number[],
  segments: number,
  uvScale: number,
  shade: (radius: number) => readonly [number, number, number, number],
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const push = (x: number, z: number, r: number): void => {
    pos.push(x, 0, z);
    nrm.push(0, 1, 0);
    uv.push(x * uvScale, z * uvScale);
    const s = shade(r);
    col.push(s[0], s[1], s[2], s[3]);
  };

  push(0, 0, 0);
  for (let ri = 0; ri < radii.length; ri++) {
    const r = radii[ri];
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * TAU;
      push(Math.cos(a) * r, Math.sin(a) * r, r);
    }
  }
  for (let s = 0; s < segments; s++) idx.push(0, 1 + ((s + 1) % segments), 1 + s);
  for (let ri = 0; ri < radii.length - 1; ri++) {
    const a0 = 1 + ri * segments;
    const b0 = a0 + segments;
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      idx.push(a0 + s, a0 + s1, b0 + s);
      idx.push(a0 + s1, b0 + s1, b0 + s);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

// --- painted surfaces ------------------------------------------------------

/** Soft grey veining over a warm off-white. Subtle: it is a table, not agate. */
function paintMarble(c: CanvasRenderingContext2D, size: number): void {
  c.fillStyle = '#F2EDE3';
  c.fillRect(0, 0, size, size);
  const rng = new Rng(0x3a12);

  // broad clouding
  for (let i = 0; i < 26; i++) {
    const g = c.createRadialGradient(
      rng.next() * size,
      rng.next() * size,
      0,
      rng.next() * size,
      rng.next() * size,
      size * rng.range(0.14, 0.42),
    );
    g.addColorStop(0, `rgba(206,199,188,${rng.range(0.05, 0.14).toFixed(3)})`);
    g.addColorStop(1, 'rgba(206,199,188,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
  }

  // veins: a few strong, many faint, all leaning the same way
  for (let i = 0; i < 22; i++) {
    const strong = i < 4;
    let x = rng.next() * size;
    let y = -size * 0.1;
    c.strokeStyle = strong
      ? `rgba(126,124,124,${rng.range(0.16, 0.3).toFixed(3)})`
      : `rgba(158,155,150,${rng.range(0.05, 0.14).toFixed(3)})`;
    c.lineWidth = size * (strong ? rng.range(0.004, 0.009) : rng.range(0.0015, 0.004));
    c.beginPath();
    c.moveTo(x, y);
    const drift = rng.range(0.25, 0.75);
    while (y < size * 1.1) {
      y += size * 0.06;
      x += size * 0.06 * drift + fbm2(x * 0.02, y * 0.02, 3) * size * 0.05;
      c.lineTo(x, y);
    }
    c.stroke();
  }
  // polish grain
  for (let i = 0; i < 500; i++) {
    c.fillStyle = rng.bool() ? 'rgba(255,255,255,0.1)' : 'rgba(190,185,178,0.08)';
    c.fillRect(rng.next() * size, rng.next() * size, size * 0.004, size * 0.004);
  }
}

/** Worn piazza flags: irregular courses, dark joints, a lot of foot polish. */
function paintPiazza(c: CanvasRenderingContext2D, size: number): void {
  c.fillStyle = '#3A2C24';
  c.fillRect(0, 0, size, size);
  const rng = new Rng(0x77a3);
  const rows = 4;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rng.next() * rh;
    while (x < size) {
      const w = rh * rng.range(0.8, 1.9);
      const shade = rng.range(0, 1);
      const base = 128 + Math.round(shade * 44);
      c.fillStyle = `rgb(${base},${base - 16},${base - 34})`;
      c.fillRect(x + size * 0.006, r * rh + size * 0.006, w - size * 0.012, rh - size * 0.012);
      // worn highlight along the top-left of every flag
      c.fillStyle = `rgba(240,228,208,${rng.range(0.04, 0.13).toFixed(3)})`;
      c.fillRect(x + size * 0.006, r * rh + size * 0.006, w - size * 0.012, rh * 0.18);
      x += w;
    }
  }
  // grime and wear
  for (let i = 0; i < 1400; i++) {
    const s = size * rng.range(0.002, 0.008);
    c.fillStyle = rng.bool(0.55) ? 'rgba(58,44,36,0.16)' : 'rgba(226,212,190,0.1)';
    c.fillRect(rng.next() * size, rng.next() * size, s, s);
  }
}

// --- props -----------------------------------------------------------------

/** Straw base, round shoulder, long neck. A fiasco at 120px. */
function chiantiBottle(
  straw: EnvBucket,
  glass: EnvBucket,
  x: number,
  y: number,
  z: number,
  yaw: number,
  sides: number,
): void {
  const base = envCyl(0.36, 0.4, 0.6, sides);
  roughen(base, 0.012, 14, 5);
  straw.add(at(base, x, y, z, yaw), 0xcaa257);
  straw.add(at(envCyl(0.34, 0.38, 0.06, sides), x, y + 0.02, z), 0x9b7a3c);
  straw.add(at(envCyl(0.15, 0.35, 0.3, sides), x, y + 0.6, z), 0xbe9750);
  glass.add(at(envCyl(0.075, 0.14, 0.62, sides), x, y + 0.88, z), 0x1e3f26);
  glass.add(at(envCyl(0.092, 0.082, 0.06, sides), x, y + 1.5, z), 0x27502f);
  straw.add(at(envCyl(0.088, 0.088, 0.09, sides), x, y + 1.47, z), 0x8f2320);
}

/** Terracotta pot, then whatever grows out of it. */
function pot(terra: EnvBucket, x: number, y: number, z: number, s: number, sides: number): number {
  terra.add(at(envCyl(0.42 * s, 0.52 * s, 0.6 * s, sides), x, y, z), 0xb8663c);
  terra.add(at(envCyl(0.48 * s, 0.44 * s, 0.11 * s, sides), x, y + 0.55 * s, z), 0xc4744a);
  terra.add(at(envCyl(0.4 * s, 0.4 * s, 0.04 * s, sides), x, y + 0.58 * s, z), 0x3a2a22);
  return y + 0.6 * s;
}

/** A facade: mass, roof, shuttered windows, a lamp or two behind the glass. */
function facade(
  terra: EnvBucket,
  wood: EnvBucket,
  bulbs: EnvBucket,
  rng: Rng,
  bearing: number,
  radius: number,
  w: number,
  h: number,
  y: number,
  fade: number,
  detail: boolean,
): void {
  const cx = Math.cos(bearing) * radius;
  const cz = Math.sin(bearing) * radius;
  const yaw = -bearing + Math.PI / 2;
  // unit vector along the facade, and the inward face normal
  const ax = Math.sin(bearing);
  const az = -Math.cos(bearing);
  const inx = -Math.cos(bearing);
  const inz = -Math.sin(bearing);
  const d = 3.2;

  const HAZE = new THREE.Color(0xe9d3b8);
  const wall = new THREE.Color(rng.pick([0xd09a63, 0xc87f52, 0xdcae7c, 0xb87550]));
  wall.lerp(HAZE, fade);
  terra.add(at(envBox(w, h, d), cx, y, cz, yaw), wall.getHex());

  const roof = new THREE.Color(0x9c4a33).lerp(HAZE, fade * 0.86);
  terra.add(at(envBox(w + 0.7, 0.34, d + 0.7), cx, y + h, cz, yaw), roof.getHex());
  terra.add(at(envBox(w + 0.3, 0.16, d + 0.3), cx, y + h + 0.34, cz, yaw), roof.getHex());

  if (!detail) return;

  const cols = Math.max(2, Math.round(w / 2.4));
  const rows = Math.max(1, Math.floor((h - 1.4) / 1.9));
  const ww = 0.62;
  const wh = 1.05;
  for (let r = 0; r < rows; r++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const u = (cIdx / (cols - 1 || 1) - 0.5) * (w - 1.4);
      const wy = y + 1.1 + r * 1.9;
      const px = cx + ax * u + inx * (d / 2 + 0.02);
      const pz = cz + az * u + inz * (d / 2 + 0.02);
      const lit = rng.bool(0.4);
      if (lit) bulbs.add(at(envBox(ww, wh, 0.08), px, wy, pz, yaw), 0xffc07a);
      else terra.add(at(envBox(ww, wh, 0.08), px, wy, pz, yaw), 0x241a18);
      // shutters, one of them usually swung open
      const shutter = new THREE.Color(rng.pick([0x41603f, 0x354a57, 0x6c4a35])).lerp(HAZE, fade * 0.62);
      for (const s of [-1, 1]) {
        const open = rng.bool(0.45);
        wood.add(
          at(
            envBox(open ? 0.1 : ww * 0.52, wh * 1.06, open ? ww * 0.5 : 0.09),
            px + ax * s * (ww * (open ? 0.62 : 0.27)),
            wy - wh * 0.03,
            pz + az * s * (ww * (open ? 0.62 : 0.27)),
            yaw,
          ),
          shutter.getHex(),
        );
      }
      terra.add(at(envBox(ww * 1.28, 0.1, 0.16), px, wy - 0.1, pz, yaw), 0xe6d3b4);
    }
  }
}

/**
 * A ring of sagging bulb strings on shared poles.
 *
 * Two earlier tries were wrong in opposite ways: strung far out and taut it was
 * a single sub-pixel scratch across the horizon, and strung per-strand it built
 * a fresh pair of poles at every join, so adjacent runs stacked two heavy black
 * masts side by side. One pole per anchor, wires between consecutive anchors.
 */
function festoonRing(
  wire: EnvBucket,
  bulbs: EnvBucket,
  rng: Rng,
  spans: number,
  floorY: number,
  steps: number,
): void {
  const anchors: Array<[number, number, number]> = [];
  for (let i = 0; i < spans; i++) {
    const b = (i / spans) * TAU + rng.range(-0.14, 0.14);
    const r = rng.range(11, 13.5);
    anchors.push([Math.cos(b) * r, floorY + rng.range(4.3, 4.7), Math.sin(b) * r]);
  }
  for (const [px, top, pz] of anchors) {
    wire.add(strut(px, floorY, pz, px, top + 0.1, pz, 0.055, 5), 0x3a2c22);
    wire.add(at(envBlob(0.11, 0), px, top + 0.16, pz), 0x3a2c22);
  }
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % anchors.length];
    const sag = rng.range(1.5, 2.1);
    let prev = a;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const next: [number, number, number] = [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t),
        a[2] + (b[2] - a[2]) * t,
      ];
      wire.add(strut(prev[0], prev[1], prev[2], next[0], next[1], next[2], 0.045, 4), 0x3a2c22);
      if (k < steps) {
        const bulb = envBlob(0.2, 0);
        bulb.scale(1, 1.25, 1);
        bulbs.add(at(bulb, next[0], next[1] - 0.24, next[2]), k % 3 === 0 ? 0xffe0ac : 0xffc47c);
      }
      prev = next;
    }
  }
}

// --- the build -------------------------------------------------------------

function pizzaEnvironment(ctx: EnvBuildCtx): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'pizza.piazza';

  const m = ctx.materials;
  const q = ctx.quality;
  const rng = ctx.rng;
  const topY = Number.isFinite(ctx.tableTopY) ? ctx.tableTopY : -0.35;
  const deck = topY - ENV_SINK;
  const floorY = deck - FLOOR_DROP;
  const detail = envPick(q, 0, 1, 1);
  const sides = envPick(q, 8, 12, 16);

  // ---- materials (keyed by look; the library shares them across runs) ----
  const marbleMat = m.physical('pizza.env.marble', {
    color: 0xffffff,
    map: m.texture('pizza.env.marble.map', paintMarble, {
      size: 512,
      repeat: [1, 1],
      wrap: THREE.ClampToEdgeWrapping,
    }),
    roughness: 0.24,
    metalness: 0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.18,
  });
  const ironMat = m.standard('pizza.env.iron', {
    color: 0xffffff,
    roughness: 0.44,
    metalness: 0.62,
    vertexColors: true,
  });
  const paveMat = m.standard('pizza.env.pave', {
    color: 0xffffff,
    map: m.texture('pizza.env.pave.map', paintPiazza, { size: 256, repeat: [1, 1] }),
    roughness: 0.92,
    metalness: 0,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
  const terraMat = m.standard('pizza.env.terracotta', {
    color: 0xffffff,
    roughness: 0.86,
    metalness: 0,
    vertexColors: true,
  });
  const woodMat = m.standard('pizza.env.wood', {
    color: 0xffffff,
    roughness: 0.72,
    metalness: 0,
    vertexColors: true,
  });
  const glassMat = m.physical('pizza.env.glass', {
    color: 0xffffff,
    roughness: 0.1,
    metalness: 0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.06,
    transparent: true,
    opacity: 0.86,
    vertexColors: true,
  });
  const greenMat = m.standard('pizza.env.green', {
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
    vertexColors: true,
    flatShading: true,
  });
  const bulbMat = m.standard('pizza.env.bulb', {
    color: 0x1d1206,
    emissive: 0xffc98a,
    emissiveIntensity: 1.3,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });

  const iron = new EnvBucket();
  const terra = new EnvBucket();
  const wood = new EnvBucket();
  const glass = new EnvBucket();
  const green = new EnvBucket();
  const bulbs = new EnvBucket();

  // ---- the table ---------------------------------------------------------
  // Round marble top; its upper surface is the plate's table.
  const top = puck(TABLE_R * 2, TABLE_T, TABLE_R * 2, {
    wobble: 0.004,
    domed: 0,
    radial: envPick(q, 28, 40, 56),
    rings: 2,
    seed: 4,
    square: 0,
  });
  top.translate(0, deck - TABLE_T, 0);
  const topMesh = new THREE.Mesh(top, marbleMat);
  topMesh.castShadow = true;
  topMesh.receiveShadow = true;
  root.add(topMesh);

  // cast-iron pedestal: collar, turned column, three splayed feet
  const collarY = deck - TABLE_T - 0.12;
  iron.add(at(envCyl(0.5, 0.44, 0.12, sides), 0, collarY, 0), 0x2b2523);
  const colH = collarY - (floorY + 0.16);
  iron.add(at(envCyl(0.2, 0.27, colH, sides), 0, floorY + 0.16, 0), 0x241f1d);
  const bulge = envBlob(0.34, detail);
  bulge.scale(1, 0.62, 1);
  iron.add(at(bulge, 0, floorY + 0.16 + colH * 0.55, 0), 0x2f2825);
  iron.add(at(envCyl(0.58, 0.66, 0.16, sides), 0, floorY, 0), 0x241f1d);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    const foot = envBox(1.15, 0.14, 0.3);
    foot.translate(0.62, 0, 0);
    iron.add(at(foot, 0, floorY, 0, -a), 0x2b2523);
    iron.add(at(envBlob(0.16, 0), Math.cos(a) * 1.14, floorY + 0.12, Math.sin(a) * 1.14), 0x2b2523);
  }

  // ---- the side table ----------------------------------------------------
  // Nothing stands on the bistro top: at 3.35 across, every square inch of it
  // is inside the tower's clearance cylinder. The bottle, the cruet, the
  // shaker and the sprig get their own lower table out past PROP_R, which is
  // also a better composition — the food owns the hero table alone.
  const sideA = rng.range(0, TAU);
  const [sideX, sideZ] = clearOf(Math.cos(sideA) * SIDE_R, Math.sin(sideA) * SIDE_R, PROP_R + 0.8);
  const sideTop = deck - SIDE_DROP;
  const sideR = 1.15;
  terra.add(at(envCyl(sideR, sideR * 0.98, 0.12, envPick(q, 12, 18, 26)), sideX, sideTop - 0.12, sideZ), 0xd8cbb4);
  terra.add(at(envCyl(sideR * 0.94, sideR * 0.9, 0.05, envPick(q, 12, 18, 26)), sideX, sideTop - 0.17, sideZ), 0xb2a68f);
  iron.add(at(envCyl(0.34, 0.4, 0.1, sides), sideX, sideTop - 0.27, sideZ), 0x2b2523);
  iron.add(at(envCyl(0.13, 0.18, sideTop - 0.37 - (floorY + 0.1), sides), sideX, floorY + 0.1, sideZ), 0x241f1d);
  iron.add(at(envCyl(0.4, 0.46, 0.1, sides), sideX, floorY, sideZ), 0x241f1d);

  /** Local coordinates on the side table, kept inside its rim. */
  const onSide = (dx: number, dz: number): [number, number] => [sideX + dx, sideZ + dz];

  const [bxx, bzz] = onSide(rng.range(-0.16, 0.16), rng.range(-0.16, 0.16));
  chiantiBottle(wood, glass, bxx, sideTop, bzz, rng.range(0, TAU), sides);

  const [cxx, czz] = onSide(0.6 + rng.range(-0.08, 0.08), -0.42 + rng.range(-0.1, 0.1));
  glass.add(at(envCyl(0.13, 0.2, 0.4, sides), cxx, sideTop, czz), 0x9d8c33);
  glass.add(at(envCyl(0.055, 0.12, 0.28, sides), cxx, sideTop + 0.4, czz), 0xb8a648);
  iron.add(at(envCyl(0.07, 0.06, 0.07, sides), cxx, sideTop + 0.67, czz), 0x8d8f92);
  const pourer = envCyl(0.028, 0.035, 0.26, 6);
  pourer.rotateZ(0.75);
  iron.add(at(pourer, cxx + 0.02, sideTop + 0.68, czz, rng.range(0, TAU)), 0x8d8f92);

  const [sxx, szz] = onSide(-0.52 + rng.range(-0.08, 0.08), 0.5 + rng.range(-0.1, 0.1));
  glass.add(at(envCyl(0.19, 0.2, 0.3, sides), sxx, sideTop, szz), 0xf0e3c4);
  iron.add(at(envCyl(0.2, 0.205, 0.11, sides), sxx, sideTop + 0.3, szz), 0x93959a);
  iron.add(at(envCyl(0.14, 0.19, 0.05, sides), sxx, sideTop + 0.41, szz), 0x93959a);

  const [vxx, vzz] = onSide(0.34 + rng.range(-0.08, 0.08), 0.58 + rng.range(-0.08, 0.08));
  terra.add(at(envCyl(0.13, 0.17, 0.26, sides), vxx, sideTop, vzz), 0xc07a4e);
  for (let i = 0; i < 4; i++) {
    const stem = envCyl(0.012, 0.016, rng.range(0.22, 0.38), 4);
    stem.rotateZ(rng.signed() * 0.4);
    green.add(at(stem, vxx + rng.signed() * 0.05, sideTop + 0.24, vzz + rng.signed() * 0.05, rng.range(0, TAU)), 0x4d7a3a);
    const leaf = envBlob(rng.range(0.05, 0.09), 0);
    leaf.scale(1.5, 0.4, 1);
    green.add(
      at(leaf, vxx + rng.signed() * 0.13, sideTop + rng.range(0.4, 0.58), vzz + rng.signed() * 0.13, rng.range(0, TAU)),
      0x5e9b47,
    );
  }

  // ---- the piazza floor --------------------------------------------------
  const gseg = envPick(q, 28, 44, 60);
  const radii = envPick<readonly number[]>(
    q,
    [2.6, 7, 13, 20, 26, 32],
    [2, 4.5, 8, 12.5, 17, 22, 27, 32],
    [1.8, 3.6, 6.6, 10, 14, 18, 22, 27, 32],
  );
  // The fade has to start beyond the facades or the buildings stand on nothing.
  const ground = envGround(radii, gseg, 0.3, (r) => {
    const fade = 1 - THREE.MathUtils.smoothstep(r, 21, 31);
    // Desaturate AND dim with distance: the world is cool, the food is warm.
    const t = THREE.MathUtils.smoothstep(r, 3, 26);
    const v = 1 - 0.44 * t;
    return [v, v * (1 - 0.05 * t), v * (1 - 0.09 * t), fade];
  });
  ground.translate(0, floorY, 0);
  const groundMesh = new THREE.Mesh(ground, paveMat);
  groundMesh.castShadow = false;
  groundMesh.receiveShadow = false;
  groundMesh.renderOrder = -1;
  root.add(groundMesh);

  // ---- mid ground: a bentwood chair pushed in at the table ---------------
  const chairA = sideA + rng.range(1.9, 2.6);
  const chairR = 5.2;
  const ccx = Math.cos(chairA) * chairR;
  const ccz = Math.sin(chairA) * chairR;
  const chairYaw = -chairA + Math.PI / 2;
  {
    const seatY = floorY + 1.55;
    const legs: Array<[number, number]> = [
      [-0.44, -0.44],
      [0.44, -0.44],
      [-0.4, 0.4],
      [0.4, 0.4],
    ];
    for (const [lx, lz] of legs) {
      const rx = ccx + lx * Math.cos(chairYaw) + lz * Math.sin(chairYaw);
      const rz = ccz - lx * Math.sin(chairYaw) + lz * Math.cos(chairYaw);
      // Splay from the CHAIR's centre, not the world origin — scaling the world
      // position leant every leg the same way and tipped the whole chair over.
      const fx = ccx + (rx - ccx) * 1.22;
      const fz = ccz + (rz - ccz) * 1.22;
      wood.add(strut(fx, floorY, fz, rx, seatY, rz, 0.05, 5), 0x5b3a24);
    }
    wood.add(at(envCyl(0.6, 0.58, 0.09, envPick(q, 10, 14, 18)), ccx, seatY, ccz), 0x6b4527);
    const backX = ccx + Math.cos(chairA) * 0.42;
    const backZ = ccz + Math.sin(chairA) * 0.42;
    const railY = seatY + 1.25;
    for (const s of [-1, 1]) {
      const ux = Math.sin(chairA) * 0.34 * s;
      const uz = -Math.cos(chairA) * 0.34 * s;
      wood.add(strut(backX + ux, seatY, backZ + uz, backX + ux, railY, backZ + uz, 0.045, 5), 0x5b3a24);
    }
    const arch = new THREE.TorusGeometry(0.34, 0.05, 4, envPick(q, 6, 8, 10), Math.PI);
    arch.rotateY(-chairA + Math.PI / 2);
    wood.add(at(arch, backX, railY, backZ), 0x5b3a24);
    const splat = new THREE.TorusGeometry(0.3, 0.035, 4, envPick(q, 5, 7, 9), Math.PI);
    splat.rotateY(-chairA + Math.PI / 2);
    wood.add(at(splat, backX, seatY + 0.62, backZ), 0x5b3a24);
  }

  // pots of cypress and geraniums, scattered around the terrace edge
  const pots = envPick(q, 4, 7, 9);
  for (let i = 0; i < pots; i++) {
    const a = (i / pots) * TAU + rng.range(-0.3, 0.3);
    const r = rng.range(7.4, 10.2);
    const px = Math.cos(a) * r;
    const pz = Math.sin(a) * r;
    const s = rng.range(0.85, 1.2);
    const rim = pot(terra, px, floorY, pz, s, sides);
    if (rng.bool(0.6)) {
      // Height comes from the headroom left under PROP_LIFT, not from a blind
      // random range: a tall roll of the dice used to poke a cypress up past
      // the clearance ceiling on some seeds.
      const ceiling = deck + PROP_LIFT - 0.3;
      const coneH = Math.max(1.2, Math.min(rng.range(2.6, 3.4) * s, ceiling - (rim - 0.05)));
      const cone = envCyl(0.03, 0.44 * s, coneH, envPick(q, 5, 7, 8));
      roughen(cone, 0.05, 5, i + 2);
      green.add(at(cone, px, rim - 0.05, pz, rng.range(0, TAU)), 0x2f5137);
    } else {
      const mound = envBlob(0.52 * s, detail);
      mound.scale(1.2, 0.8, 1.2);
      green.add(at(mound, px, rim + 0.28 * s, pz), 0x3f6b3c);
      for (let f = 0; f < 5; f++) {
        const fa = rng.range(0, TAU);
        const fr = rng.range(0.1, 0.45) * s;
        green.add(
          at(envBlob(rng.range(0.08, 0.13), 0), px + Math.cos(fa) * fr, rim + rng.range(0.4, 0.7) * s, pz + Math.sin(fa) * fr),
          rng.bool(0.7) ? 0xc1272d : 0xe86a4a,
        );
      }
    }
  }

  // ---- background: the piazza itself -------------------------------------
  // Well back and deliberately low: at 16 units a six-unit facade filled the
  // top-right quadrant as a flat orange slab cropped by the frame. Out at 19+
  // with a shorter mass it reads as a street on the far side of the piazza.
  const blocks = envPick(q, 8, 12, 15);
  const facadeBearings: number[] = [];
  const facadeRadii: number[] = [];
  for (let i = 0; i < blocks; i++) {
    const bearing = (i / blocks) * TAU + rng.range(-0.1, 0.1);
    facadeBearings.push(bearing);
    const r = rng.range(19.5, 23);
    facadeRadii.push(r);
    // Heavy wash toward the fog colour: the far wall has to sit BACK, and at
    // this density a saturated terracotta ring would shout over the food.
    const fade = THREE.MathUtils.clamp((r - 11) / 13, 0.56, 0.86);
    facade(terra, wood, bulbs, rng, bearing, r, rng.range(9, 13), rng.range(2.8, 4.2), floorY, fade, q !== 'low');
  }

  // a bell tower and a dome, well back, purely as silhouette
  if (q !== 'low') {
    const ba = rng.range(0, TAU);
    const br = 28;
    const bxr = Math.cos(ba) * br;
    const bzr = Math.sin(ba) * br;
    const towerC = new THREE.Color(0xc08a63).lerp(new THREE.Color(0xe9d3b8), 0.8).getHex();
    terra.add(at(envBox(1.7, 5.4, 1.7), bxr, floorY, bzr, -ba), towerC);
    terra.add(at(envBox(2.1, 0.28, 2.1), bxr, floorY + 5.3, bzr, -ba), 0xcb9a7e);
    terra.add(at(envCyl(0.18, 1.15, 1.1, 4), bxr, floorY + 5.55, bzr, -ba + Math.PI / 4), 0xcb9a7e);
    bulbs.add(at(envBox(0.5, 0.8, 0.1), bxr + Math.cos(ba + Math.PI) * 0.87, floorY + 3.8, bzr + Math.sin(ba + Math.PI) * 0.87, -ba), 0xffbe7a);

    const da = ba + rng.range(0.35, 0.6);
    const dxr = Math.cos(da) * (br - 1.5);
    const dzr = Math.sin(da) * (br - 1.5);
    terra.add(at(envBox(4.4, 3.4, 4.4), dxr, floorY, dzr, -da), towerC);
    terra.add(at(envCyl(2.1, 2.4, 0.7, 12), dxr, floorY + 3.4, dzr), 0xcb9a7e);
    const dome = new THREE.SphereGeometry(2.05, envPick(q, 10, 14, 18), envPick(q, 5, 7, 9), 0, TAU, 0, Math.PI / 2);
    terra.add(at(dome, dxr, floorY + 4.05, dzr), 0xbb9c88);
    terra.add(at(envCyl(0.16, 0.3, 0.7, 8), dxr, floorY + 6.0, dzr), 0xcb9a7e);
  }

  // a striped awning over the nearest shopfront
  for (const awningIdx of envPick<readonly number[]>(q, [], [0, 3], [0, 4, 8])) {
    const idx = awningIdx % facadeBearings.length;
    const ab = facadeBearings[idx] + rng.range(-0.08, 0.08);
    // hung off the front of that facade, not floating in the middle of the square
    const ar = facadeRadii[idx] - 2.3;
    const acx = Math.cos(ab) * ar;
    const acz = Math.sin(ab) * ar;
    const yaw = -ab + Math.PI / 2;
    const ax = Math.sin(ab);
    const az = -Math.cos(ab);
    const inx = -Math.cos(ab);
    const inz = -Math.sin(ab);
    const strips = 9;
    const span = 6.3;
    for (let i = 0; i < strips; i++) {
      const u = (i / (strips - 1) - 0.5) * span;
      const slat = envBox(span / strips + 0.02, 0.09, 2.4);
      slat.rotateX(0.34);
      terra.add(
        at(slat, acx + ax * u + inx * 1.1, floorY + 2.45, acz + az * u + inz * 1.1, yaw),
        i % 2 === 0 ? 0xefe2c8 : 0xb03a34,
      );
      wood.add(
        at(envBox(span / strips + 0.02, 0.34, 0.08), acx + ax * u + inx * 2.28, floorY + 2.11, acz + az * u + inz * 2.28, yaw),
        i % 2 === 0 ? 0xefe2c8 : 0xb03a34,
      );
    }
    for (const s of [-1, 1]) {
      wood.add(
        strut(
          acx + ax * (span / 2) * s + inx * 2.2,
          floorY + 2.15,
          acz + az * (span / 2) * s + inz * 2.2,
          acx + ax * (span / 2) * s,
          floorY + 3.05,
          acz + az * (span / 2) * s,
          0.05,
          5,
        ),
        0x2b2523,
      );
    }
  }

  // festoon lights, strung between the facades
  // Ringed round the terrace so a run is on screen at every yaw, and close
  // enough (11-13.5 units) that the bulbs read as lights rather than pixels.
  festoonRing(iron, bulbs, rng, envPick(q, 4, 5, 6), floorY, envPick(q, 7, 9, 12));

  // ---- assemble ----------------------------------------------------------
  const meshes: Array<THREE.Mesh | null> = [
    iron.build(ironMat, false, true),
    terra.build(terraMat, false, false),
    wood.build(woodMat, false, false),
    glass.build(glassMat, false, false),
    green.build(greenMat, false, false),
    bulbs.build(bulbMat, false, false),
  ];
  for (const mesh of meshes) if (mesh) root.add(mesh);
  return root;
}

// ---------------------------------------------------------------------------
// theme
// ---------------------------------------------------------------------------

export const pizzaTheme: ThemeDef = {
  id: 'pizza',
  name: 'Pizza Piazza',
  tagline: 'Deep dish, thin crust, endless cheese.',
  glyph: '🍕',
  price: 1.99,
  palette: {
    bgTop: 0xffe9c7,
    bgBottom: 0x8c3b3b,
    fog: 0xd99a72,
    fogDensity: 0.018,
    key: 0xfff3de,
    keyIntensity: 2.6,
    fill: 0x86a8c9,
    fillIntensity: 0.6,
    rim: 0xffc17a,
    rimIntensity: 1.4,
    ground: 0x5c2626,
    accent: 0xc1272d,
    accentSoft: 0x5e9b47,
    bloomStrength: 0.5,
    exposure: 1.04,
    vignette: 0.36,
  },
  foods: [
    doughBase,
    tomatoSauce,
    mozzarella,
    pepperoni,
    basilLeaves,
    olives,
    bellPepper,
    parmesanDust,
  ],
  hero: [0, 1, 2, 3, 5, 4],
  plate: pizzaPlate,
  environment: pizzaEnvironment,
  ambience: 'pizza',
};
