/**
 * BREAKFAST RUSH — pancakes, bacon, and a lake of syrup.
 *
 * Ingredient run (DESIGN.md order): pancake, syrup pool, butter pat, crisp
 * bacon, fried egg, hash brown, blueberry scatter, waffle.
 *
 * Silhouette discipline: the pancake is a soft dome, the syrup is a thin pooled
 * sheet with drips hanging off the rim, the butter is a flat puddle with a
 * proud rectangular block on it, the bacon is wavy ribbons, the egg is a lobed
 * blob with a hemisphere sitting on it, the hash brown is a rough slab with a
 * fringe of shreds, the blueberries are a cluster of balls, and the waffle is a
 * slab carrying a raised grid. Every one of them is a different black shape.
 */
import * as THREE from 'three';
import type { FoodBuildCtx, FoodDef, ThemeDef } from '../api';
import type { MaterialLibrary } from '../../render/api';
import { clamp } from '../../core/math';
import { mesh, pour, puck, roughen, scatter } from '../kit';
import {
  areaCount,
  baconPainter,
  blobGeo,
  boxAt,
  coverCount,
  crumbBumpTex,
  cutSquare,
  discFace,
  domeGeo,
  fineDetail,
  finishLayer,
  fitGeoY,
  geoHeight,
  glazePainter,
  groundGeo,
  mergeSafe,
  pickQ,
  propSize,
  rasherRun,
  ringTorus,
  roughAmt,
  safe,
  specklePainter,
  toastPainter,
} from './shared-savory';

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------

const pancakeMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('breakfast.pancake', {
    // the toast map carries the browning, so the base stays neutral
    color: 0xffffff,
    roughness: 0.8,
    map: m.texture(
      'breakfast.pancakeToast',
      toastPainter(0xf5d09a, 0xd9a05b, 0xa9622c, 0x7a4318, 70, 4),
      { size: 256 },
    ),
    bumpMap: crumbBumpTex(m),
    bumpScale: 0.018,
  });

const syrupMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('breakfast.syrup', {
    color: 0x9a4b12,
    roughness: 0.06,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    transmission: 0.35,
    thickness: 0.55,
    ior: 1.45,
    attenuationColor: 0x6d2f07,
    attenuationDistance: 0.7,
  });

const butterMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('breakfast.butter', {
    color: 0xf7d66a,
    roughness: 0.3,
    clearcoat: 0.45,
    clearcoatRoughness: 0.28,
    transmission: 0.08,
    thickness: 0.18,
    ior: 1.42,
  });

const butterMeltMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('breakfast.butterMelt', {
    color: 0xf2c64e,
    roughness: 0.1,
    clearcoat: 0.95,
    clearcoatRoughness: 0.08,
    transmission: 0.24,
    thickness: 0.24,
    ior: 1.44,
  });

const crispBaconMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('breakfast.bacon', {
    color: 0xffffff,
    roughness: 0.4,
    map: m.texture('breakfast.baconCrisp', baconPainter(true, 8), { size: 256 }),
    bumpMap: crumbBumpTex(m),
    bumpScale: 0.016,
  });

const eggWhiteMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('breakfast.eggWhite', {
    color: 0xfffaf2,
    roughness: 0.25,
    clearcoat: 0.6,
    clearcoatRoughness: 0.22,
    transmission: 0.07,
    thickness: 0.1,
    ior: 1.36,
    sheen: 0.2,
    sheenColor: 0xffffff,
  });

const yolkMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('breakfast.yolk', {
    color: 0xf5a623,
    roughness: 0.16,
    clearcoat: 0.92,
    clearcoatRoughness: 0.05,
    specularIntensity: 1,
    emissive: 0xa85c00,
    emissiveIntensity: 0.12,
  });

const hashMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('breakfast.hash', {
    color: 0xffffff,
    roughness: 0.72,
    map: m.texture(
      'breakfast.potato',
      specklePainter(
        0xc9873a,
        [
          { color: 0xf0c070, count: 130, min: 0.004, max: 0.022, alpha: 0.6 },
          { color: 0x8a4d15, count: 110, min: 0.004, max: 0.018, alpha: 0.55 },
          { color: 0x3f2008, count: 40, min: 0.003, max: 0.01, alpha: 0.7 },
        ],
        { seed: 33, mottle: 22 },
      ),
      { size: 256, repeat: [1.6, 1.6] },
    ),
    bumpMap: crumbBumpTex(m),
    bumpScale: 0.035,
  });

const berryMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('breakfast.blueberry', {
    color: 0x3b4e8c,
    roughness: 0.42,
    clearcoat: 0.28,
    clearcoatRoughness: 0.45,
    // the dusty bloom on a fresh blueberry is pure sheen
    sheen: 0.75,
    sheenColor: 0xb9c7e8,
    sheenRoughness: 0.6,
  });

const berryJuiceMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('breakfast.berryJuice', {
    color: 0x2b1f4e,
    roughness: 0.12,
    clearcoat: 0.85,
    clearcoatRoughness: 0.1,
    transmission: 0.22,
    thickness: 0.2,
    ior: 1.4,
  });

const waffleMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('breakfast.waffle', {
    color: 0xffffff,
    roughness: 0.78,
    map: m.texture(
      'breakfast.waffleBake',
      specklePainter(
        0xe0b368,
        [
          { color: 0xa9682c, count: 120, min: 0.005, max: 0.026, alpha: 0.42 },
          { color: 0xf6dda8, count: 90, min: 0.004, max: 0.02, alpha: 0.4 },
        ],
        { seed: 51, mottle: 14 },
      ),
      { size: 256, repeat: [0.9, 0.9] },
    ),
    bumpMap: crumbBumpTex(m),
    bumpScale: 0.022,
  });

// ---------------------------------------------------------------------------
// foods
// ---------------------------------------------------------------------------

const pancake: FoodDef = {
  id: 'breakfast.pancake',
  name: 'Pancake',
  glyph: '🥞',
  thickness: 0.46,
  tint: 0xd9a05b,
  tintAlt: 0xa9622c,
  build(ctx) {
    const h = safe(ctx.height, 1e-3);
    const geo = puck(safe(ctx.width), h, safe(ctx.depth), {
      // per-layer jitter so two stacked pancakes are never clones
      wobble: 0.062 + ctx.rng.range(-0.018, 0.018),
      domed: 0.34 + ctx.rng.range(-0.06, 0.06),
      radial: pickQ(ctx, 18, 30, 44),
      rings: pickQ(ctx, 3, 5, 7),
      seed: 2.7 + ctx.index * 0.83,
    });
    roughen(geo, roughAmt(ctx, 0.012), 6, ctx.index * 1.9);
    fitGeoY(geo, h);
    return finishLayer(ctx, mesh(geo, pancakeMat(ctx.materials)));
  },
};

const syrupPool: FoodDef = {
  id: 'breakfast.syrup',
  name: 'Syrup Pool',
  glyph: '🍯',
  thickness: 0.24,
  tint: 0x9a4b12,
  tintAlt: 0xd98a3c,
  build(ctx) {
    const h = safe(ctx.height, 1e-3);
    const geo = pour(safe(ctx.width) * 0.98, h * 0.58, safe(ctx.depth) * 0.98, {
      drips: pickQ(ctx, 3, 4, 6),
      dripLength: 0.95,
      radial: pickQ(ctx, 20, 34, 52),
      seed: 11 + ctx.index * 1.7,
      square: cutSquare(ctx),
    });
    // pour() hangs its drips below y = 0; fitGeoY re-grounds and rescales so
    // the whole pool still lands exactly inside [0, height].
    fitGeoY(geo, h);
    return finishLayer(ctx, mesh(geo, syrupMat(ctx.materials)));
  },
};

const butterPat: FoodDef = {
  id: 'breakfast.butter',
  name: 'Butter Pat',
  glyph: '🧈',
  thickness: 0.34,
  tint: 0xf7d66a,
  tintAlt: 0xfff0b8,
  build(ctx) {
    const g = new THREE.Group();
    const h = safe(ctx.height, 1e-3);
    const w = safe(ctx.width);
    const d = safe(ctx.depth);

    const puddle = pour(w * 0.94, h * 0.24, d * 0.94, {
      drips: pickQ(ctx, 3, 4, 5),
      dripLength: 0.6,
      radial: pickQ(ctx, 16, 28, 40),
      seed: 6 + ctx.index,
      square: cutSquare(ctx),
    });
    groundGeo(puddle, 0);
    const puddleTop = geoHeight(puddle);
    g.add(mesh(puddle, butterMeltMat(ctx.materials)));

    // the pat itself — a block, which is exactly what reads at 120px
    const patW = Math.min(w * 0.44, 0.66);
    const patD = Math.min(d * 0.44, 0.66);
    const patH = h * 0.62;
    const pat = boxAt(patW, patH, patD, Math.min(patW, patH, patD) * 0.18, pickQ(ctx, 1, 2, 3));
    roughen(pat, Math.min(patH * 0.03, Math.min(patW, patD) * 0.05), 12, ctx.index * 2.1);
    pat.rotateY(ctx.rng.range(-0.3, 0.3));
    groundGeo(pat, Math.max(0, puddleTop - patH * 0.1));
    g.add(mesh(pat, butterMat(ctx.materials)));
    return finishLayer(ctx, g);
  },
};

const crispBacon: FoodDef = {
  id: 'breakfast.bacon',
  name: 'Crisp Bacon',
  glyph: '🥓',
  thickness: 0.26,
  tint: 0xb0472a,
  tintAlt: 0xe7cba4,
  build(ctx) {
    const h = safe(ctx.height, 1e-3);
    const geo = rasherRun(ctx.width, ctx.depth, h * 0.26, {
      maxStrips: pickQ(ctx, 2, 3, 4),
      minPitch: 0.19,
      wave: 0.62,
      curl: 0.72,
      seed: 21 + ctx.index * 1.9,
      segments: pickQ(ctx, 8, 13, 20),
    });
    if (!geo) return finishLayer(ctx, new THREE.Group());
    fitGeoY(geo, h);
    return finishLayer(ctx, mesh(geo, crispBaconMat(ctx.materials)));
  },
};

const friedEgg: FoodDef = {
  id: 'breakfast.egg',
  name: 'Fried Egg',
  glyph: '🍳',
  thickness: 0.38,
  tint: 0xfffaf2,
  tintAlt: 0xf5a623,
  build(ctx) {
    const g = new THREE.Group();
    const h = safe(ctx.height, 1e-3);
    const w = safe(ctx.width);
    const d = safe(ctx.depth);

    // high wobble = lobed, spread-out white instead of a machined disc
    const white = puck(w * 0.9, h * 0.44, d * 0.9, {
      wobble: 0.17,
      domed: 0.55,
      radial: pickQ(ctx, 20, 32, 48),
      rings: pickQ(ctx, 3, 4, 5),
      seed: 8.2 + ctx.index * 1.11,
      square: cutSquare(ctx),
    });
    roughen(white, roughAmt(ctx, 0.02), 7, ctx.index * 1.5);
    fitGeoY(white, h * 0.46);
    g.add(mesh(white, eggWhiteMat(ctx.materials)));

    const yd = propSize(ctx, 0.44, 0.62);
    const yolk = domeGeo(yd, h * 0.54, pickQ(ctx, 10, 14, 20), pickQ(ctx, 5, 7, 10), 0.58);
    const off = Math.min(w, d) * 0.06;
    yolk.translate(ctx.rng.signed() * off, h * 0.4, ctx.rng.signed() * off);
    g.add(mesh(yolk, yolkMat(ctx.materials)));
    return finishLayer(ctx, g);
  },
};

const hashBrown: FoodDef = {
  id: 'breakfast.hash',
  name: 'Hash Brown',
  glyph: '🥔',
  thickness: 0.44,
  tint: 0xc9873a,
  tintAlt: 0xf0c070,
  build(ctx) {
    const h = safe(ctx.height, 1e-3);
    const w = safe(ctx.width);
    const d = safe(ctx.depth);

    const base = boxAt(
      w * 0.94,
      h * 0.56,
      d * 0.94,
      Math.min(w * 0.94, h * 0.56, d * 0.94) * 0.16,
      pickQ(ctx, 1, 2, 3),
    );
    roughen(base, roughAmt(ctx, 0.06), 9, ctx.index * 2.7);
    groundGeo(base, 0);
    const baseTop = geoHeight(base);

    const strandLen = Math.min(Math.min(w, d) * 0.62, 0.62);
    const strandW = Math.min(Math.min(w, d) * 0.1, 0.05);
    const strandH = h * 0.26;
    const n = areaCount(ctx, pickQ(ctx, 10, 20, 34), 2);
    const shreds = scatter(
      n,
      w,
      d,
      (i, rng) => {
        const s = new THREE.BoxGeometry(
          strandLen * rng.range(0.6, 1.05),
          strandH * rng.range(0.7, 1),
          strandW * rng.range(0.8, 1.2),
        );
        return s;
      },
      {
        seed: 29 + ctx.index,
        y: baseTop - strandH * 0.34,
        margin: strandLen * 0.42,
        spacing: 0.1,
        randomYaw: true,
        randomTilt: 0.14,
      },
    );
    const geo = mergeSafe([base, shreds]);
    if (!geo) return finishLayer(ctx, new THREE.Group());
    return finishLayer(ctx, mesh(geo, hashMat(ctx.materials)));
  },
};

const blueberryScatter: FoodDef = {
  id: 'breakfast.blueberry',
  name: 'Blueberry Scatter',
  glyph: '🫐',
  thickness: 0.3,
  tint: 0x3b4e8c,
  tintAlt: 0x8fa6d8,
  build(ctx) {
    const g = new THREE.Group();
    const h = safe(ctx.height, 1e-3);
    const w = safe(ctx.width);
    const d = safe(ctx.depth);

    const berryD = propSize(ctx, 0.32, 0.34);
    const berryH = berryD * 0.86;
    // The compote bed takes up whatever the berries do not, so a sliver (tiny
    // berries) is not stretched to fill the slot by fitHeight.
    const bedH = Math.max(h * 0.26, h - berryH * 0.92);
    const bed = pour(w * 0.95, bedH * 0.66, d * 0.95, {
      drips: pickQ(ctx, 3, 4, 5),
      dripLength: 0.42,
      radial: pickQ(ctx, 16, 28, 40),
      seed: 4 + ctx.index,
      square: cutSquare(ctx),
    });
    fitGeoY(bed, bedH);
    g.add(mesh(bed, berryJuiceMat(ctx.materials)));

    const n = coverCount(w, d, berryD, 0.34, pickQ(ctx, 5, 9, 15));
    const caps = fineDetail(ctx);
    const berries = scatter(
      n,
      w,
      d,
      (i, rng) => {
        const s = rng.range(0.85, 1.12);
        const b = blobGeo(berryD * s, berryH * s, pickQ(ctx, 8, 10, 12));
        if (!caps) return b;
        // the calyx star on top — the one detail that says "blueberry"
        const star = ringTorus(berryD * s * 0.36, berryD * s * 0.36, 0.22, berryD * 0.03, 4, 8);
        star.translate(0, berryH * s * 0.9, 0);
        return mergeSafe([b, star]);
      },
      {
        seed: 41 + ctx.index,
        y: Math.max(0, bedH - berryH * 0.24),
        margin: berryD * 0.6,
        spacing: 0.15,
        randomYaw: true,
        randomTilt: 0.2,
      },
    );
    if (berries) g.add(mesh(berries, berryMat(ctx.materials)));
    return finishLayer(ctx, g);
  },
};

const waffle: FoodDef = {
  id: 'breakfast.waffle',
  name: 'Waffle',
  glyph: '🧇',
  thickness: 0.52,
  tint: 0xe0b368,
  tintAlt: 0xa9682c,
  build(ctx) {
    const h = safe(ctx.height, 1e-3);
    const w = safe(ctx.width);
    const d = safe(ctx.depth);

    const baseH = h * 0.52;
    const base = boxAt(w, baseH, d, Math.min(w, baseH, d) * 0.14, pickQ(ctx, 1, 2, 3));
    groundGeo(base, 0);

    // Pocket grid: cell count follows each axis independently, so a sliver
    // gets one narrow channel rather than a broken lattice.
    const maxCells = pickQ(ctx, 3, 4, 5);
    const nx = clamp(Math.round(w / 0.55), 1, maxCells);
    const nz = clamp(Math.round(d / 0.55), 1, maxCells);
    const cellX = w / nx;
    const cellZ = d / nz;
    const wallT = clamp(Math.min(cellX, cellZ) * 0.24, 0.012, 0.16);
    const ridgeH = h * 0.5;
    const ridgeY = baseH - ridgeH * 0.2;

    const walls: THREE.BufferGeometry[] = [];
    for (let i = 0; i <= nx; i++) {
      const x = clamp(-w / 2 + i * cellX, -w / 2 + wallT / 2, w / 2 - wallT / 2);
      const b = new THREE.BoxGeometry(wallT, ridgeH, d);
      b.translate(x, ridgeY + ridgeH / 2, 0);
      walls.push(b);
    }
    for (let i = 0; i <= nz; i++) {
      const z = clamp(-d / 2 + i * cellZ, -d / 2 + wallT / 2, d / 2 - wallT / 2);
      const b = new THREE.BoxGeometry(w, ridgeH, wallT);
      b.translate(0, ridgeY + ridgeH / 2, z);
      walls.push(b);
    }

    const geo = mergeSafe([base, ...walls]);
    if (!geo) return finishLayer(ctx, new THREE.Group());
    roughen(geo, roughAmt(ctx, 0.012), 10, ctx.index * 1.3);
    fitGeoY(geo, h);
    return finishLayer(ctx, mesh(geo, waffleMat(ctx.materials)));
  },
};

// ---------------------------------------------------------------------------
// plate & scenery
// ---------------------------------------------------------------------------

const plateThickness = (ctx: FoodBuildCtx): number =>
  ctx.height > 0.02 ? ctx.height : 0.17;

const ceramicMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('breakfast.plateBody', { color: 0xf2ead9, roughness: 0.4 });

function breakfastPlate(ctx: FoodBuildCtx): THREE.Object3D {
  const g = new THREE.Group();
  const m = ctx.materials;
  const t = plateThickness(ctx);
  const w = safe(ctx.width, 0.2);
  const d = safe(ctx.depth, 0.2);
  const radial = pickQ(ctx, 24, 40, 60);

  // Built DOWNWARD: the plate occupies y in [-t, 0]; its top face is exactly
  // y = 0 so the first layer lands flush on it.
  const body = puck(w * 0.93, Math.max(t - 0.004, t * 0.5), d * 0.93, {
    wobble: 0.002,
    domed: 0,
    radial,
    rings: 2,
    seed: 2.4,
  });
  groundGeo(body, -t);
  g.add(mesh(body, ceramicMat(m), { cast: false }));

  // The blue rim stripe is glaze, not geometry — painting it keeps the plate
  // top a single clean plane at y = 0.
  // Stops short of the rim tube: coplanar overlap here z-fights into dashes.
  const face = discFace(w * 0.80, d * 0.80, radial);
  g.add(
    mesh(
      face,
      m.standard('breakfast.plateFace', {
        color: 0xffffff,
        roughness: 0.28,
        map: m.texture('breakfast.plateGlaze', glazePainter(0xf7f2e8, 0x4a79b8, 0.33, 0.375), {
          size: 256,
          wrap: THREE.ClampToEdgeWrapping,
        }),
      }),
      { cast: false },
    ),
  );

  const lip = ringTorus(w, d, 0.045, t * 0.44, pickQ(ctx, 6, 8, 10), pickQ(ctx, 24, 40, 64));
  lip.translate(0, -t * 0.44 - 0.03, 0);
  g.add(mesh(lip, ceramicMat(m), { cast: false }));
  return g;
}

function breakfastScenery(ctx: FoodBuildCtx): THREE.Object3D {
  const g = new THREE.Group();
  const m = ctx.materials;
  const w = safe(ctx.width, 0.4);
  const floorY = -plateThickness(ctx) - 0.004;

  // folded napkin — two slabs, low contrast, deliberately almost invisible
  const nw = w * 0.4;
  const nd = w * 0.28;
  const lower = new THREE.BoxGeometry(nw, w * 0.006, nd);
  const upper = new THREE.BoxGeometry(nw * 0.98, w * 0.005, nd * 0.54);
  upper.translate(0, w * 0.0055, -nd * 0.2);
  const napkin = mergeSafe([lower, upper]);
  if (napkin) {
    napkin.rotateY(0.28);
    groundGeo(napkin, floorY);
    napkin.translate(-w * 0.74, 0, w * 0.46);
    g.add(
      mesh(napkin, m.standard('breakfast.napkin', { color: 0xf2ecde, roughness: 0.93 }), {
        cast: false,
      }),
    );
  }

  // fork — a handle, a neck and four tines, all boxes
  const fl = w * 0.3;
  const parts: THREE.BufferGeometry[] = [];
  const handle = new THREE.BoxGeometry(fl * 0.62, w * 0.008, w * 0.028);
  handle.translate(-fl * 0.19, 0, 0);
  parts.push(handle);
  const neck = new THREE.BoxGeometry(fl * 0.16, w * 0.007, w * 0.05);
  neck.translate(fl * 0.2, 0, 0);
  parts.push(neck);
  for (let i = 0; i < 4; i++) {
    const tine = new THREE.BoxGeometry(fl * 0.26, w * 0.006, w * 0.009);
    tine.translate(fl * 0.4, 0, (i - 1.5) * w * 0.014);
    parts.push(tine);
  }
  const fork = mergeSafe(parts);
  if (fork) {
    fork.rotateY(0.24);
    groundGeo(fork, floorY + w * 0.012);
    fork.translate(-w * 0.74, 0, w * 0.5);
    g.add(
      mesh(
        fork,
        m.standard('breakfast.cutlery', {
          color: 0xc9cfd6,
          metalness: 0.7,
          roughness: 0.34,
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

export const breakfastTheme: ThemeDef = {
  id: 'breakfast',
  name: 'Breakfast Rush',
  tagline: 'Pancakes, bacon, and a lake of syrup.',
  glyph: '🥞',
  price: 1.99,
  palette: {
    bgTop: 0xfff3d6,
    bgBottom: 0xffa65c,
    fog: 0xffdca8,
    fogDensity: 0.012,
    key: 0xfffaf0,
    keyIntensity: 2.6,
    fill: 0xa8cbee,
    fillIntensity: 0.6,
    rim: 0xffce7a,
    rimIntensity: 1.4,
    ground: 0xc97b3c,
    accent: 0xff8c42,
    accentSoft: 0x6fcf97,
    bloomStrength: 0.38,
    exposure: 1.12,
    vignette: 0.34,
  },
  foods: [
    pancake,
    syrupPool,
    butterPat,
    crispBacon,
    friedEgg,
    hashBrown,
    blueberryScatter,
    waffle,
  ],
  hero: [7, 0, 3, 4, 2, 1],
  plate: breakfastPlate,
  // TODO(environment): replaced by the per-theme environment builder.
  // scenery: breakfastScenery,
  ambience: 'breakfast',
};
