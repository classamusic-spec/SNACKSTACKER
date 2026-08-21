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
import type { FoodBuildCtx, FoodDef, ThemeDef } from '../api';
import type { MaterialLibrary } from '../../render/api';
import { clamp } from '../../core/math';
import { mesh, pour, puck, roughen, scatter, tintGeometry } from '../kit';
import {
  areaCount,
  arcStrip,
  boxAt,
  charPainter,
  checkerPainter,
  coverCount,
  crumbBumpTex,
  cuppedDisc,
  cutSquare,
  ceilGeo,
  discFace,
  domeGeo,
  fineDetail,
  finishLayer,
  fitGeoY,
  geoHeight,
  groundGeo,
  leafGeo,
  leafVeinTex,
  mergeSafe,
  paintFlourDust,
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

function pizzaScenery(ctx: FoodBuildCtx): THREE.Object3D {
  const g = new THREE.Group();
  const m = ctx.materials;
  const w = safe(ctx.width, 0.4);
  const floorY = -boardThickness(ctx) - 0.004;

  // a dusting of flour on the counter
  const dust = discFace(w * 2.6, w * 2.6, pickQ(ctx, 20, 32, 48));
  dust.translate(0, floorY, 0);
  g.add(
    mesh(
      dust,
      m.standard('pizza.flour', {
        color: 0xffffff,
        roughness: 0.95,
        map: m.texture('pizza.flourDust', paintFlourDust, {
          size: 256,
          wrap: THREE.ClampToEdgeWrapping,
        }),
        transparent: true,
        depthWrite: false,
      }),
      { cast: false, receive: false },
    ),
  );

  // a few clumps so the flour is not just a decal
  const clumps = scatter(
    12,
    w * 2.2,
    w * 2.2,
    (i, rng) => {
      const s = new THREE.TetrahedronGeometry(w * 0.012 * rng.range(0.6, 1.4), 0);
      return s;
    },
    { seed: 5, y: floorY, margin: w * 0.9, spacing: 0, randomYaw: true, randomTilt: 1 },
  );
  if (clumps) {
    g.add(
      mesh(clumps, m.standard('pizza.flourClump', { color: 0xf7efe0, roughness: 0.96 }), {
        cast: false,
        receive: false,
      }),
    );
  }

  // a checkered cloth corner intruding from the far side
  const cloth = boxAt(w * 0.95, w * 0.012, w * 0.72, w * 0.02, 1);
  const fold = boxAt(w * 0.95, w * 0.01, w * 0.16, w * 0.014, 1);
  fold.translate(0, w * 0.011, -w * 0.3);
  const clothGeo = mergeSafe([cloth, fold]);
  if (clothGeo) {
    clothGeo.rotateY(-0.42);
    groundGeo(clothGeo, floorY);
    clothGeo.translate(w * 0.92, 0, w * 0.66);
    g.add(
      mesh(
        clothGeo,
        m.standard('pizza.cloth', {
          color: 0xffffff,
          roughness: 0.92,
          map: m.texture('pizza.checkCloth', checkerPainter(0xf4ece0, 0xc1272d, 4), {
            size: 256,
            repeat: [2.2, 2.2],
          }),
        }),
        { cast: false },
      ),
    );
  }
  return g;
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
  scenery: pizzaScenery,
  ambience: 'pizza',
};
