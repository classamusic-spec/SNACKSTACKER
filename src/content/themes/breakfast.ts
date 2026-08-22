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
import type { EnvBuildCtx, FoodBuildCtx, FoodDef, ThemeDef } from '../api';
import type { MaterialLibrary } from '../../render/api';
import type { Rng } from '../../core/rng';
import { TAU, clamp, clamp01 } from '../../core/math';
import { fbm2, mesh, pour, puck, roughen, scatter } from '../kit';
import {
  areaCount,
  baconPainter,
  blobGeo,
  boxAt,
  clothSheet,
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
  groundDisc,
  groundGeo,
  leafGeo,
  linenPainter,
  mergeSafe,
  mix,
  num,
  pickE,
  pickQ,
  place,
  plankPainter,
  PropBatch,
  propSize,
  rasherRun,
  ringTorus,
  roughAmt,
  safe,
  specklePainter,
  tintEach,
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

// ---------------------------------------------------------------------------
// environment — a sunlit breakfast table
// ---------------------------------------------------------------------------
//
// Early, quiet and a little overexposed: a round scrubbed-pine table under the
// plate with a linen runner, the breakfast things pushed out to the rim, and a
// suggestion of a kitchen behind — a wainscot line, a soft wall, tall windows
// full of morning light, curtains, a pot plant on a sill and two pendants.
//
// Two constraints shape every number here.
//
// **The tower's cylinder.** The food occupies a cylinder of radius ~1.7 rising
// from `tableTopY`, and a sliding layer sweeps it. So anything standing ON the
// table has to live past 4.5 units from the origin and stay under
// `tableTopY + 1.5`; anything taller than that is pushed past 9 units, where it
// reads as background. That is why the table is ROUND: on a rectangle the
// r > 4.5 ring only exists at the two ends, so the jam jar and the coffee pot
// would have had to queue up in the same two spots.
//
// **The lens.** 46 degree FOV at 0.46 aspect is ~22 degrees across, and the
// food alone fills 57% of that. A prop is only both visible AND clear of the
// tower in a narrow band roughly behind it, so props are placed by bearing
// relative to the camera (`CAM_BEARING`), not by world azimuth.

/** Table top down to the kitchen floor. */
const ROOM_DROP = 2.5;
/** The runner is the top surface; the tabletop sits this far under it. */
const RUNNER_LIFT = 0.04;
const WALL_R = 13.5;
const WALL_H = 7.2;
/** The palette's own bgTop. Anything that has to vanish into the sweep fades here. */
const SKY = 0xfff3d6;
/** The yaw the game opens on; props are placed relative to it. */
const CAM_BEARING = Math.PI / 4;

const paleWoodMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('breakfast.env.wood', {
    color: 0xffffff,
    roughness: 0.6,
    vertexColors: true,
    // near-white grain: the hue is in the vertex colours, the map only modulates
    //
    // The repeat matters more here than on any other surface in the game. The
    // table is a 11.8-unit disc and its cap UVs run 0..1 across the whole
    // thing, so at repeat 0.42 the grain was magnified into three soft
    // diagonal smears and the top read as cream plastic. Above 1 it tiles
    // often enough to read as scrubbed boards.
    map: m.texture(
      'breakfast.env.plank',
      plankPainter(0xf1e6d4, 0x9a7f5e, 0xfffdf8, { seed: 21, lines: 52, knots: 2, wear: 0.5 }),
      { size: 256, repeat: [1.35, 1.35] },
    ),
  });

/**
 * Everything soft and matte in the room on one material: the floor, the wall,
 * the dado, the curtains, the plant and the linen runner. Double-sided,
 * because the wall cylinder and the curtain planes are single sheets. The
 * linen weave rides on it as a very fine near-white map, so the runner still
 * has a texture without earning its own draw.
 */
const roomMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('breakfast.env.room', {
    color: 0xffffff,
    roughness: 0.96,
    vertexColors: true,
    side: THREE.DoubleSide,
    map: m.texture('breakfast.env.linen', linenPainter(0xf4f4f4, 0xdad5c9, 4), {
      size: 256,
      repeat: [2.4, 2.4],
    }),
  });

/**
 * Painted joinery AND glazed china on one material. They want almost the same
 * surface, and the merge is what keeps the whole kitchen inside its draw-call
 * budget: window frames, sills, pendant shades, the coffee pot, the mug and
 * the butter dish are a single mesh.
 */
const joineryMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('breakfast.env.joinery', {
    color: 0xffffff,
    roughness: 0.4,
    metalness: 0.06,
    vertexColors: true,
  });

/**
 * Glassware, faked opaque. A genuinely transparent pane costs two draws and a
 * sort, and at 20 units what actually sells "glass" is the hard clearcoat
 * highlight plus the two-tone body — juice below, empty glass above — not the
 * refraction. So the tumbler and the jam jar are solid, glossy, and tinted per
 * vertex.
 */
const tableGlassMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('breakfast.env.glass', {
    color: 0xffffff,
    roughness: 0.05,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    vertexColors: true,
  });

/**
 * The pane itself: blown out, so the window reads as light rather than glass.
 * It has to clip — at 1.7 the panes landed on the same value as the wall and
 * the windows disappeared into it. The whole point of this room is that the
 * light comes from somewhere.
 */
const daylightMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('breakfast.env.daylight', {
    color: 0xfffdf6,
    roughness: 1,
    emissive: 0xfff4dc,
    emissiveIntensity: 3.4,
    toneMapped: true,
  });

/** A round scrubbed table: soft-edged top, apron ring, four turned legs. */
function kitchenTable(batch: PropBatch, topY: number, floorY: number, rng: Rng, q: string): void {
  const R = 5.9;
  const deck = topY - RUNNER_LIFT;
  const top = puck(R * 2, 0.22, R * 2, {
    wobble: 0.002,
    domed: 0,
    radial: q === 'low' ? 28 : 44,
    rings: 2,
    seed: 2.2,
    square: 0,
  });
  // The top is the largest single surface in the frame, and a flat tint left
  // the bottom half of the screen as one dead cream field. A gentle radial
  // fall-off — warm honey in the middle, cooler and deeper at the rim — is
  // what gives the table a middle and an edge from every yaw.
  const warm = mix(0xe4cda6, 0xdcc49b, rng.next() * 0.5);
  place(top, { y: deck, ceil: true });
  tintEach(top, (x, _y, z) => {
    const t = clamp01(Math.hypot(x, z) / R);
    return mix(warm, 0xcbb083, t * t * 0.85);
  });
  batch.keep(top);

  // apron ring just under the top
  batch.cyl(R - 0.42, R - 0.42, 0.3, 0xcfb68e, { y: deck - 0.36 }, q === 'low' ? 20 : 32, true);

  for (let i = 0; i < 4; i++) {
    const a = CAM_BEARING + Math.PI / 4 + (i / 4) * TAU;
    const x = Math.sin(a) * (R - 0.85);
    const z = Math.cos(a) * (R - 0.85);
    // a turned leg: a squat block, a tapered shaft, a foot
    batch.box(0.34, 0.36, 0.34, 0xdcc49f, { x, z, y: deck - 0.28, ceil: true });
    batch.cyl(0.15, 0.21, ROOM_DROP - 0.78, 0xe2caa5, { x, z, y: floorY + 0.1, ground: true }, 8);
    batch.cyl(0.24, 0.2, 0.12, 0xd6bd97, { x, z, y: floorY, ground: true }, 8);
  }
}

/**
 * Build a prop at life size, then blow it up about its own footing.
 *
 * Everything on this table stands about five units out, because that is the
 * nearest a prop can get without the sliding layer sweeping through it — and a
 * life-size jam jar at five units is four pixels of red. Scaling here rather
 * than in the modelling functions keeps those honest about proportion, and
 * keeps the footing exactly on the table.
 */
function oversized(
  dest: PropBatch,
  scale: number,
  x: number,
  y: number,
  z: number,
  build: (b: PropBatch) => void,
): void {
  const b = new PropBatch();
  build(b);
  const geo = b.build();
  if (!geo) return;
  const s = safe(scale, 1);
  geo.translate(-x, -y, -z);
  geo.scale(s, s, s);
  geo.translate(x, y, z);
  dest.keep(geo);
}

/** How much bigger than life the breakfast things are. */
const PROP_S = 1.32;

/** The coffee pot: tapered body, banded shoulder, lid, knob, spout, handle. */
function coffeePot(batch: PropBatch, x: number, z: number, y: number, ry: number): void {
  const CREAM = 0xfbf5ea;
  const NAVY = 0x3f5f86;
  const cs = Math.sin(ry);
  const cz = Math.cos(ry);
  const at = (dx: number, dz: number): [number, number] => [x + dx * cz + dz * cs, z - dx * cs + dz * cz];

  // pot: tapered body, banded shoulder, lid, knob, spout, handle
  batch.cyl(0.3, 0.37, 0.66, CREAM, { x, z, y, ground: true }, 14);
  batch.cyl(0.31, 0.31, 0.05, NAVY, { x, z, y: y + 0.66 }, 14);
  batch.cyl(0.3, 0.31, 0.09, CREAM, { x, z, y: y + 0.7, ground: true }, 14);
  batch.ball(0.07, NAVY, { x, z, y: y + 0.83 }, 7);
  const [sx, sz] = at(0.34, 0);
  batch.add(
    new THREE.CylinderGeometry(0.05, 0.11, 0.3, 8).rotateZ(-0.6),
    CREAM,
    { x: sx, z: sz, y: y + 0.56 },
  );
  const [hx, hz] = at(-0.36, 0);
  batch.add(
    new THREE.TorusGeometry(0.16, 0.04, 5, 10, Math.PI * 1.25).rotateY(Math.PI / 2 - ry),
    NAVY,
    { x: hx, z: hz, y: y + 0.4 },
  );
}

/**
 * Mug on a saucer — the one cool note in a room made entirely of cream. Placed
 * on its own bearing rather than as an offset from the pot: an offset moves a
 * prop radially, and 0.7 units inward is enough to break the clearance rule.
 */
function mugOnSaucer(batch: PropBatch, x: number, z: number, y: number, ry: number): void {
  const BLUE = 0xa8cbee;
  batch.cyl(0.3, 0.28, 0.035, 0xfbf5ea, { x, z, y, ground: true }, 14);
  batch.cyl(0.2, 0.17, 0.32, BLUE, { x, z, y: y + 0.035, ground: true }, 12);
  batch.cyl(0.175, 0.175, 0.012, 0x53321c, { x, z, y: y + 0.33 }, 12);
  batch.add(
    new THREE.TorusGeometry(0.11, 0.032, 5, 9, Math.PI * 1.3).rotateY(Math.PI / 2 - ry),
    BLUE,
    { x: x - 0.22 * Math.cos(ry), z: z + 0.22 * Math.sin(ry), y: y + 0.2 },
  );
}

function butterDish(batch: PropBatch, x: number, z: number, y: number, ry: number): void {
  batch.slab(0.62, 0.07, 0.4, 0xfaf5ec, { x, z, ry, y, ground: true });
  batch.add(
    new THREE.SphereGeometry(0.3, 12, 6, 0, TAU, 0, Math.PI / 2).scale(1, 0.62, 0.62),
    0xfdf9f2,
    { x, z, ry, y: y + 0.07 },
  );
  batch.ball(0.05, 0xf3ead9, { x, z, ry, y: y + 0.26 }, 6);
}

/** A folded broadsheet: two leaves, a masthead bar, nothing else at this size. */
function newspaper(batch: PropBatch, x: number, z: number, y: number, ry: number): void {
  batch.box(0.98, 0.035, 0.62, 0xf2efe6, { x, z, ry, y: y + 0.005 });
  batch.box(0.92, 0.03, 0.57, 0xe9e5d9, { x, z, ry: ry + 0.09, y: y + 0.035 });
  batch.box(0.6, 0.008, 0.09, 0x6d6a62, { x, z, ry: ry + 0.09, y: y + 0.055 });
  for (let i = 0; i < 4; i++) {
    batch.box(0.72, 0.006, 0.02, 0xb3afa4, { x, z, ry: ry + 0.09, y: y + 0.053 + i * 0.0005 });
  }
}

/**
 * A pendant over the far side of the table. `ceilY` is where the flex stops —
 * there is no ceiling to hang it from, so the cord runs up to the height the
 * wall fades out at and fades out with it. A fixed-length flex ran three units
 * past the wall and left a black line drawn on the sky.
 */
function pendantLamp(
  batch: PropBatch,
  x: number,
  z: number,
  shadeY: number,
  segs: number,
  ceilY: number,
): void {
  const top = shadeY + 0.42;
  const len = ceilY - top;
  if (len > 0.05) {
    const flex = new THREE.CylinderGeometry(0.045, 0.045, len, 6, 6);
    place(flex, { x, z, y: top, ground: true });
    tintEach(flex, (_fx, fy) =>
      mix(0x5c5349, SKY, clamp01((fy - top) / Math.max(len, 1e-3) - 0.45) / 0.55),
    );
    batch.keep(flex);
  }
  batch.cyl(0.1, 0.5, 0.46, 0xfff7e8, { x, z, y: shadeY }, segs);
  batch.cyl(0.5, 0.48, 0.05, 0xd8b070, { x, z, y: shadeY - 0.02 }, segs);
  batch.ball(0.12, 0xfff2d8, { x, z, y: shadeY + 0.02 }, 6);
}

/**
 * A sash window seen from inside: reveal, sill, frame, one mullion cross. The
 * pane is handed back so it can go in the emissive daylight batch.
 */
function kitchenWindow(
  joinery: PropBatch,
  panes: PropBatch,
  room: PropBatch,
  a: number,
  floorY: number,
  q: string,
): void {
  const R = WALL_R - 0.1;
  const x = Math.sin(a) * R;
  const z = Math.cos(a) * R;
  const W = 4.5;
  const sill = floorY + 1.95;
  const head = sill + 2.75;
  // A window is a bright hole with dark bars across it. White joinery on a
  // blown pane gives you the hole and no bars, and greige only barely; this is
  // a soft taupe, dark enough that the mullion cross survives at 120px.
  const FRAME = 0xc3ac8c;
  /** Warm brass for the curtain pole — a hair darker than the joinery. */
  const ROD = 0xa88f63;

  // sill and its apron
  joinery.box(W + 0.7, 0.16, 0.5, FRAME, { x, z, ry: a, y: sill, ceil: true });
  joinery.box(W + 0.34, 0.26, 0.16, mix(FRAME, 0xe6dcc8, 0.4), {
    x, z, ry: a, y: sill - 0.16, ceil: true,
  });
  // jambs + head
  for (const s of [-1, 1]) {
    joinery.box(0.24, head - sill + 0.3, 0.26, FRAME, {
      x: x + Math.sin(a + Math.PI / 2) * (s * (W / 2 + 0.12)),
      z: z + Math.cos(a + Math.PI / 2) * (s * (W / 2 + 0.12)),
      ry: a,
      y: sill,
      ground: true,
    });
  }
  joinery.box(W + 0.48, 0.28, 0.26, FRAME, { x, z, ry: a, y: head, ground: true });
  // mullion cross
  joinery.box(0.2, head - sill, 0.17, FRAME, { x, z, ry: a, y: sill, ground: true });
  joinery.box(W, 0.18, 0.17, FRAME, { x, z, ry: a, y: sill + (head - sill) * 0.56 });

  // The pane sits at a LARGER radius than the joinery — further from the room's
  // centre, and so further from the camera. Setting it inboard put the glass in
  // front of its own mullions and the cross vanished.
  panes.box(W, head - sill, 0.05, 0xffffff, {
    x: x + Math.sin(a) * 0.14,
    z: z + Math.cos(a) * 0.14,
    ry: a,
    y: sill,
    ground: true,
  });

  // The pole, and the two finials that cap it. Without it a curtain panel is
  // just a pale vertical slab standing beside the window, and it read as a
  // structural column — the rod is the one line that says "hanging fabric".
  const rodY = head + 0.36;
  joinery.add(
    new THREE.CylinderGeometry(0.055, 0.055, W + 1.3, 6).rotateZ(Math.PI / 2),
    ROD,
    { x, z, ry: a, y: rodY },
  );
  for (const s of [-1, 1]) {
    joinery.ball(0.1, ROD, {
      x: x + Math.sin(a + Math.PI / 2) * (s * (W / 2 + 0.68)),
      z: z + Math.cos(a + Math.PI / 2) * (s * (W / 2 + 0.68)),
      y: rodY,
    }, 6);
  }

  // curtains: two soft panels, rippled, hung from the pole just inside the reveal
  for (const s of [-1, 1]) {
    const cw = 1.05;
    const ch = rodY - sill + 0.22;
    const panel = new THREE.PlaneGeometry(cw, ch, q === 'low' ? 4 : 7, 4);
    const pos = panel.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) / cw;
      const v = clamp01(pos.getY(i) / ch + 0.5);
      // Deeper folds near the pole, opening out below: a gathered heading.
      pos.setZ(i, Math.sin(u * 11 + s) * 0.1 * (0.3 + v * 1.1));
      pos.setX(i, pos.getX(i) * (1 - (1 - v) * 0.16));
    }
    panel.computeVertexNormals();
    const off = s * (W / 2 + 0.14);
    room.add(panel, 0xfaf0dd, {
      ry: a,
      x: x + Math.sin(a + Math.PI / 2) * off - Math.sin(a) * 0.34,
      z: z + Math.cos(a + Math.PI / 2) * off - Math.cos(a) * 0.34,
      y: rodY - 0.04,
      ceil: true,
    });
  }
}

function breakfastEnvironment(ctx: EnvBuildCtx): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'breakfast.kitchen';
  const m = ctx.materials;
  const q = ctx.quality;
  const rng = ctx.rng.fork(9203);
  const topY = num(ctx.tableTopY, -0.35);
  const floorY = topY - ROOM_DROP;
  const HAZE = 0xffe3ba;

  const atBearing = (theta: number, d: number): [number, number] => {
    const a = CAM_BEARING + theta;
    return [Math.sin(a) * d, Math.cos(a) * d];
  };

  // --- the room shell: floor, wall, wainscot, skirting, curtains, plant ----
  const room = new PropBatch();
  room.keep(
    groundDisc(
      20,
      (t, x, z) => {
        const board = 0.5 + fbm2(x * 0.05 + 1.7, z * 0.6 - 3.3, 2) * 0.6;
        const near = mix(0xc79a63, 0xdcb87f, clamp01(board));
        return t < 0.35 ? near : mix(near, HAZE, clamp01((t - 0.35) / 0.5));
      },
      { segments: pickE(q, 26, 36, 46), rings: pickE(q, 5, 7, 8), seed: 8 },
    ),
    { y: floorY },
  );
  const wall = new THREE.CylinderGeometry(
    WALL_R,
    WALL_R,
    WALL_H,
    pickE(q, 20, 28, 36),
    // Enough rings to carry the fade smoothly: the top of the wall has to
    // dissolve, not stop.
    pickE(q, 7, 10, 12),
    true,
  );
  // Mirror it so the faces (and their normals) point into the room.
  wall.scale(-1, 1, 1);
  wall.computeVertexNormals();
  place(wall, { y: floorY, ground: true });
  // The room has no ceiling, so a wall that simply ENDS draws a hard curved
  // rim across the sky — the single worst artefact in this set. Fog is no help
  // at r 13.5 (density 0.012 leaves it 97% visible), so the last third of the
  // wall is faded in vertex colour straight into the backdrop's own bgTop.
  // Everything else that reaches that height (the pendant flexes) stops there.
  // The fade overshoots past the sweep's own colour into near-white, because
  // the wall is lit and the backdrop is not: a vertex tinted exactly bgTop
  // still renders about 6% darker than the sky behind it, and 6% is all a hard
  // arc needs. Overshooting hides the seam; the band is long enough that the
  // overshoot itself never reads as a glow.
  tintEach(wall, (_x, y) => {
    const t = clamp01((y - floorY) / WALL_H);
    const paint = mix(0xe7d8bd, 0xf8f0e1, t * t * (3 - 2 * t));
    return mix(paint, mix(SKY, 0xffffff, 0.55), clamp01((t - 0.4) / 0.6) ** 1.15);
  });
  room.keep(wall);

  // Wainscot: a pale dado capped by a rail, and a skirting at the floor.
  //
  // It had stiles once. The table hides the dado's lower half, so all that
  // survived was a white band ticked with vertical bars — a stadium railing
  // floating behind the plate. Panelling reads at this distance through its
  // HORIZONTAL lines, so the verticals are gone and the cap rail does the
  // work: proud, bright, with a darker reveal tucked under it.
  const WAINS = 1.62;
  const dadoSegs = pickE(q, 20, 28, 36);
  room.cyl(WALL_R - 0.1, WALL_R - 0.1, WAINS, 0xfffcf5, { y: floorY, ground: true }, dadoSegs, true);
  // shadow reveal under the cap — the line that says "this band is proud"
  room.cyl(WALL_R - 0.08, WALL_R - 0.08, 0.1, 0xdfd0b6, { y: floorY + WAINS - 0.1 }, dadoSegs, true);
  room.cyl(WALL_R - 0.02, WALL_R - 0.02, 0.16, 0xfffdf6, { y: floorY + WAINS }, dadoSegs, true);
  room.cyl(WALL_R - 0.04, WALL_R - 0.04, 0.3, 0xfffdf6, { y: floorY, ground: true }, dadoSegs, true);

  // --- windows -------------------------------------------------------------
  const joinery = new PropBatch();
  const panes = new PropBatch();
  const windowBase = CAM_BEARING + 2.967; // ~170 deg off the opening yaw
  const windows = pickE(q, 3, 4, 4);
  for (let i = 0; i < windows; i++) {
    kitchenWindow(joinery, panes, room, windowBase + (i / windows) * TAU, floorY, q);
  }

  // Framed prints on the piers BETWEEN the windows. The orbit spends as long
  // looking at bare wall as it does at glass, and a bare cream cylinder is the
  // one yaw where this stops being a kitchen. Two boxes each — a frame and a
  // mount — so they survive at every tier, hung at slightly different heights
  // because nobody hangs pictures level with each other.
  for (let i = 0; i < windows; i++) {
    const a = windowBase + ((i + 0.5) / windows) * TAU;
    const ax = Math.sin(a) * (WALL_R - 0.12);
    const az = Math.cos(a) * (WALL_R - 0.12);
    const w = 1.05 + rng.range(-0.12, 0.3);
    const h = w * rng.range(0.78, 1.35);
    const y = floorY + 3.1 + rng.range(-0.25, 0.45);
    joinery.box(w, h, 0.1, mix(0x8f7757, 0xb59a74, rng.next()), { x: ax, z: az, ry: a, y });
    room.box(w - 0.22, h - 0.22, 0.06, mix(0xf3e7d2, 0xdcd2c4, rng.next()), {
      x: ax - Math.sin(a) * 0.04,
      z: az - Math.cos(a) * 0.04,
      ry: a,
      y,
    });
  }

  // pot plants on two of the sills: the only strong green in the room, and the
  // thing that stops a blank stretch of wall reading as a blank stretch of wall
  const sillY = floorY + 1.95;
  const plants = pickE(q, 1, 2, 2);
  for (let k = 0; k < plants; k++) {
    const pa = windowBase + (k / Math.max(windows, 1)) * TAU * (k === 0 ? 0 : 1);
    const px = Math.sin(pa) * (WALL_R - 0.3) + Math.sin(pa + Math.PI / 2) * (k ? -1.5 : 1.5);
    const pz = Math.cos(pa) * (WALL_R - 0.3) + Math.cos(pa + Math.PI / 2) * (k ? -1.5 : 1.5);
    room.add(new THREE.CylinderGeometry(0.32, 0.24, 0.46, 10), 0xc97b3c, {
      x: px,
      z: pz,
      y: sillY,
      ground: true,
    });
    const leaves = pickE(q, 5, 8, 11);
    for (let i = 0; i < leaves; i++) {
      const a = (i / leaves) * TAU + rng.range(-0.3, 0.3);
      const leaf = leafGeo(rng.range(0.55, 0.95), rng.range(0.26, 0.44), {
        fold: 0.35,
        arch: 0.5,
        seed: 2 + i + k * 5,
        segU: 5,
        segV: 2,
      });
      room.add(leaf, mix(0x63b878, 0xa6d894, rng.next()), {
        x: px,
        z: pz,
        y: sillY + 0.4,
        ry: a,
        rz: -rng.range(0.35, 0.95),
      });
    }
  }

  // --- pendants ------------------------------------------------------------
  const ceilY = floorY + WALL_H;
  const [pax, paz] = atBearing(-2.793, 9.8);
  pendantLamp(joinery, pax, paz, topY + 2.0, pickE(q, 8, 12, 14), ceilY);
  const [pbx, pbz] = atBearing(0.7, 10.4);
  pendantLamp(joinery, pbx, pbz, topY + 2.25, pickE(q, 8, 12, 14), ceilY);

  // --- the table -----------------------------------------------------------
  const table = new PropBatch();
  kitchenTable(table, topY, floorY, rng, q);
  const tableGeo = table.build();
  if (tableGeo) g.add(mesh(tableGeo, paleWoodMat(m), { cast: false, receive: true }));

  // --- the linen runner: its top face IS ctx.tableTopY ---------------------
  const runner = clothSheet(10.4, 4.1, {
    segments: pickE(q, 7, 11, 14),
    thickness: 0.04,
    rumple: 0.012,
    edgeDrop: 0.022,
    wander: 0.022,
    seed: 9,
  });
  runner.rotateY(rng.range(-0.045, 0.045));
  runner.translate(rng.range(-0.1, 0.1), topY, rng.range(-0.08, 0.08));
  room.add(runner, 0xfaf4e8);

  // --- the breakfast things -----------------------------------------------
  //
  // Every one of these stands ON the table, i.e. above `tableTopY`, so every
  // one has to clear the tower: centre past 4.5 units, nothing taller than
  // tableTopY + 1.5. The table's 5.9 radius is what buys the room for that.
  const glass = new PropBatch();

  const [cpx, cpz] = atBearing(2.72, 5.15);
  oversized(joinery, PROP_S, cpx, topY, cpz, (b) =>
    coffeePot(b, cpx, cpz, topY, Math.atan2(cpx, cpz) + Math.PI + 0.35),
  );
  const [mgx, mgz] = atBearing(2.46, 5.0);
  oversized(joinery, PROP_S, mgx, topY, mgz, (b) =>
    mugOnSaucer(b, mgx, mgz, topY, Math.atan2(mgx, mgz) + 0.6),
  );

  // juice glass: orange to the fill line, clear above it
  const [jgx, jgz] = atBearing(-2.66, 4.95);
  oversized(glass, PROP_S, jgx, topY, jgz, (b) => {
    b.cyl(0.152, 0.135, 0.33, 0xffab33, { x: jgx, z: jgz, y: topY, ground: true }, 12);
    b.cyl(0.16, 0.152, 0.14, 0xe8f1fa, { x: jgx, z: jgz, y: topY + 0.33, ground: true }, 12);
  });

  if (q !== 'low') {
    const [jjx, jjz] = atBearing(-2.42, 5.05);
    oversized(glass, PROP_S, jjx, topY, jjz, (b) => {
      b.cyl(0.185, 0.185, 0.24, 0xa8332c, { x: jjx, z: jjz, y: topY, ground: true }, 12);
      b.cyl(0.19, 0.185, 0.09, 0xeaf2fa, { x: jjx, z: jjz, y: topY + 0.24, ground: true }, 12);
    });
    oversized(joinery, PROP_S, jjx, topY, jjz, (b) =>
      b.cyl(0.2, 0.2, 0.07, 0xd8534a, { x: jjx, z: jjz, y: topY + 0.32, ground: true }, 12),
    );

    const [npx, npz] = atBearing(0.42, 5.2);
    oversized(joinery, PROP_S, npx, topY, npz, (b) =>
      newspaper(b, npx, npz, topY, Math.atan2(npx, npz) + 1.1),
    );
    const [bdx, bdz] = atBearing(1.08, 5.05);
    oversized(joinery, PROP_S, bdx, topY, bdz, (b) =>
      butterDish(b, bdx, bdz, topY, Math.atan2(bdx, bdz) + 0.5),
    );
  }

  const roomGeo = room.build();
  if (roomGeo) g.add(mesh(roomGeo, roomMat(m), { cast: false, receive: true }));
  const joineryGeo = joinery.build();
  if (joineryGeo) g.add(mesh(joineryGeo, joineryMat(m), { cast: true, receive: true }));
  const paneGeo = panes.build();
  if (paneGeo) g.add(mesh(paneGeo, daylightMat(m), { cast: false, receive: false }));
  const glassGeo = glass.build();
  if (glassGeo) g.add(mesh(glassGeo, tableGlassMat(m), { cast: false, receive: false }));

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
    keyIntensity: 2.2,
    fill: 0xa8cbee,
    fillIntensity: 0.6,
    rim: 0xffce7a,
    rimIntensity: 1.4,
    ground: 0xc97b3c,
    accent: 0xff8c42,
    accentSoft: 0x6fcf97,
    bloomStrength: 0.32,
    // Breakfast Rush has the brightest palette in the game (bgTop luma 0.95).
    // Exposure has to run inversely to a palette's key or the scene clips:
    // this one takes the least of the six, the way Candy Stack does.
    exposure: 0.97,
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
  environment: breakfastEnvironment,
  ambience: 'breakfast',
};
