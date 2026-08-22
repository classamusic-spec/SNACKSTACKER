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
import { SKY_PRESETS } from '../../render/palette';
import type { QualityTier } from '../../core/types';
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
  PlaceOpts,
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
  skyCap,
  specklePainter,
  strut,
  tintEach,
  tintEachA,
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
// environment — a garden room at seven in the morning
// ---------------------------------------------------------------------------
//
// This used to be a closed cylinder with its top third faded into the
// backdrop, and the fade was the worst thing in the set. A LIT surface tinted
// to the backdrop's own colour still lands a few percent off it, so a pale arc
// stayed drawn across the top of the frame at every yaw, and fading harder
// only slid the arc down the screen. The fix is not a better fade. It is not
// having an edge to fade.
//
// So the room opened up. A dado runs the whole way round at sill height, four
// piers stand out of it and carry on straight past the top of the frame, and
// everything between them above the transom is open to the morning — sky,
// garden and a hazed tree line. The only horizontal left up there is the
// transom band, and that reads as joinery because it has mouldings on it and
// piers running through it.
//
// Two of the four bays are windows and the other two are the room, which is
// also what fixes the dead yaws: a quarter turn of the orbit now lands on a
// window, then a dresser, then a window, then the door to the hall.
//
// Three constraints shape every number here.
//
// **The tower's cylinder.** The food occupies a cylinder of radius ~1.7 rising
// from `tableTopY`, and a sliding layer sweeps it. So anything standing ON the
// table has to live past 4.5 units from the origin and stay under
// `tableTopY + 1.5`; anything taller is pushed past 9 units, where it reads as
// background. That is why the table is ROUND: on a rectangle the r > 4.5 ring
// only exists at the two ends, so the jam jar and the coffee pot would have had
// to queue up in the same two spots.
//
// **The lens.** 46 degree FOV at 0.46 aspect is ~22 degrees across, and the
// food alone fills 57% of that. A prop is only both visible AND clear of the
// tower in a narrow band roughly behind it, so props are placed by bearing
// relative to the camera (`CAM_BEARING`), not by world azimuth.
//
// **The frame.** See `frameRule` in shared-savory: an isolated prop whose feet
// are hidden by the tower while its head is not reads as floating. Nothing in
// this room is at risk of it — everything freestanding stands against a wall
// 13.5 units out, well past the radius where feet clear the tower's apex — but
// it is the reason the dresser is at the wall and not out on the floor.

/** Table top down to the floor. */
const ROOM_DROP = 2.5;
/** The runner is the top surface; the tabletop sits this far under it. */
const RUNNER_LIFT = 0.04;
const WALL_R = 13.5;
/** Sill height above the floor: the dado's cap, and the window's foot. */
const SILL_UP = 1.95;
/** Where solid wall stops and open glazing carries on. */
const TRANSOM_UP = 5.0;
/**
 * How far the piers run above the floor. This is the number that kills the
 * arc, so it is derived rather than chosen.
 *
 * The top of the frame looks 5.6 degrees BELOW the horizon, so where it
 * crosses the far wall — CAM_BACK + WALL_R, about 23.6 units out — it lands
 * 2.32 units under the camera, and the camera sits CAM_EYE above whatever
 * tower top it is tracking. A fifteen-layer breakfast tower is roughly six
 * units, which puts the frame's top edge at y = 6 + 5.5 - 2.3 = 9.2 at the
 * wall. Any pier shorter than that has its own end on screen. 15.5 above a
 * floor at -2.85 clears about twenty-five layers, and past that the last third
 * of each pier is already fading out — a vertical strip losing its colour,
 * which is not an arc.
 */
const PIER_UP = 15.5;

const BK_SKY = SKY_PRESETS.breakfast;
/**
 * Everything distant dissolves into this — the sky preset's OWN
 * `horizonColor`, not a hand-picked near-match, so the garden's far edge and
 * the sky's haze band cannot drift apart.
 */
const HAZE = BK_SKY.horizonColor;
/** The palette's own bgTop. The few things that still have to vanish go here. */
const SKY = 0xfff3d6;
/** The yaw the game opens on; every bay is placed relative to it. */
const CAM_BEARING = Math.PI / 4;

// --- the sun ---------------------------------------------------------------
//
// Read off the sky preset, which reads its bearing off the light rig, so the
// pool of light on the table can never fall the opposite way from the shadows.
// The altitude is what makes this morning rather than noon: 0.62 rad throws a
// shadow 1.4 times the caster's height, long enough to read and short enough
// that the window's own bars land ON the table instead of past it.
const SUN_A = BK_SKY.sunAzimuth;
const SUN_EL = clamp(BK_SKY.sunElevation, 0.12, 1.4);
/** Unit horizontal vector the light TRAVELS along, and its perpendicular. */
const LX = -Math.sin(SUN_A);
const LZ = -Math.cos(SUN_A);
const PX = Math.cos(SUN_A);
const PZ = -Math.sin(SUN_A);
/** Horizontal run per unit of drop. */
const RUN = 1 / Math.tan(SUN_EL);

// --- the bays --------------------------------------------------------------
const BAYS = 4;
const BAY_STEP = TAU / BAYS;
/**
 * Bay 0 sits directly behind the tower at the opening yaw, so it is the one
 * the player looks at for a whole run. Bay 1 lands within three degrees of
 * KEY_AZIMUTH, so it is the one the light actually comes through. Bays 2 and 3
 * are the two yaws that used to carry nothing.
 *
 *   bay 0  theta  PI    the long window
 *   bay 1  theta -PI/2  the sun window
 *   bay 2  theta  0     the dresser
 *   bay 3  theta +PI/2  the door to the hall
 */
const BAY_A = CAM_BEARING + Math.PI;
const BAY_WINDOW = 0;
const BAY_SUN = 1;
const BAY_DRESSER = 2;
const BAY_DOOR = 3;
/** Half the angular width of a pier, and of the clear opening between two. */
const PIER_HALF = 0.19;
const BAY_HALF = BAY_STEP / 2 - PIER_HALF;
/** Half the doorway, in radians, and how high its head sits above the floor. */
const DOOR_HALF = 0.155;
const DOOR_UP = 4.3;

/**
 * A vertical slice of wall between two bearings, seen from inside.
 *
 * Built by hand rather than through `PropBatch.arc` so a panel can carry a
 * vertical gradient in its vertex colours. Note the negated bearings: the
 * mirror that turns the cylinder inside out mirrors the ANGLE with it.
 */
function wallGeo(
  r: number,
  h: number,
  a0: number,
  a1: number,
  segs: number,
  rings = 1,
): THREE.BufferGeometry | null {
  const span = a1 - a0;
  if (!(span > 1e-4) || !(h > 1e-4)) return null;
  const geo = new THREE.CylinderGeometry(
    safe(r),
    safe(r),
    safe(h),
    Math.max(1, Math.round(segs)),
    Math.max(1, Math.round(rings)),
    true,
    -a1,
    span,
  );
  geo.scale(-1, 1, 1);
  geo.computeVertexNormals();
  return geo;
}

/** A horizontal annulus sector between two bearings: sills, cornices, treads. */
function bandGeo(
  rIn: number,
  rOut: number,
  a0: number,
  a1: number,
  segs: number,
): THREE.BufferGeometry | null {
  const span = a1 - a0;
  if (!(span > 1e-4)) return null;
  const inner = Math.max(rIn, 0.001);
  const geo = new THREE.RingGeometry(
    inner,
    Math.max(rOut, inner + 0.001),
    Math.max(1, Math.round(segs)),
    1,
    a0 - Math.PI / 2,
    span,
  );
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** Point on the wall ring at bearing `a`, pulled `inset` into the room. */
const wallXZ = (a: number, inset = 0): [number, number] => [
  Math.sin(a) * (WALL_R - inset),
  Math.cos(a) * (WALL_R - inset),
];

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
 * Everything soft and matte on one material: the floor, the wall, the dado,
 * the curtains, the plants, the garden outside and the linen runner.
 * Double-sided, because the wall panels and the curtains are single sheets.
 * The linen weave rides on it as a very fine near-white map, so the runner
 * still has a texture without earning its own draw.
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
 * surface, and the merge is what keeps the whole room inside its draw-call
 * budget: window frames, sills, glazing bars, the dresser, the door, the
 * coffee pot, the mug and the butter dish are a single mesh.
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
 * The light itself: the pool on the table, the wash on the floor, and the two
 * shafts between them.
 *
 * There is no emissive pane in this room any more. The windows are HOLES — the
 * backdrop's own sky is what comes through them — so the only thing left to
 * author is what the light does once it is inside. Vertex alpha carries the
 * whole shape, `depthWrite: false` stops the shafts cutting each other, and
 * the emissive is deliberately gentle: this is the brightest palette in the
 * game and the bible's grading rule runs the same way for a pool of light as
 * it does for exposure.
 */
const sunMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('breakfast.env.sun', {
    color: 0xffffff,
    roughness: 1,
    emissive: 0xffe4ae,
    emissiveIntensity: 0.22,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    toneMapped: true,
  });

/**
 * Is a point in the sun, and how much?
 *
 * Traced, not painted. Given a world point, walk the ray BACK along the sun's
 * own direction to the plane of the wall and ask what it passed through: open
 * glazing between the sill and the top of the piers, or a mullion, or a
 * glazing rail, or the pier at the edge of the bay. The same function answers
 * for the table top and for the floor two and a half units below it, which is
 * exactly why the pattern lands as one continuous cast rather than as two
 * decals that happen to be near each other.
 */
function sunMask(
  x: number,
  y: number,
  z: number,
  sillY: number,
  topEdge: number,
  rails: readonly number[],
  mulls: readonly number[],
  acrossMin: number,
  acrossMax: number,
): number {
  const along = x * LX + z * LZ;
  const across = x * PX + z * PZ;
  /** Height the ray was at when it crossed the plane of the wall. */
  const h = y + (along + WALL_R) / RUN;
  if (!Number.isFinite(h)) return 0;
  let a = clamp01((h - sillY) / 0.7) * clamp01((topEdge - h) / 1.6);
  if (a <= 0) return 0;
  // the piers either side of the bay
  a *= clamp01((across - acrossMin) / 0.9) * clamp01((acrossMax - across) / 0.9);
  // horizontal glazing rails, cast as soft bands down the table
  for (let i = 0; i < rails.length; i++) {
    a *= 1 - 0.8 * clamp01(1 - Math.abs(h - rails[i]) / 0.8) ** 1.4;
  }
  // vertical mullions, cast as soft bands across it
  for (let i = 0; i < mulls.length; i++) {
    a *= 1 - 0.76 * clamp01(1 - Math.abs(across - mulls[i]) / 0.5) ** 1.4;
  }
  return clamp01(a);
}

/** A round scrubbed table: soft-edged top, apron ring, four turned legs. */
function kitchenTable(batch: PropBatch, topY: number, floorY: number, rng: Rng, q: QualityTier): void {
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
  // fall-off — warm honey in the middle, cooler and deeper at the rim — gives
  // the table a middle and an edge from every yaw, and a broad directional
  // lift toward the sun window puts the room's light into the wood itself,
  // under the sharper pool the sun mesh lays on top of it.
  const warm = mix(0xe4cda6, 0xdcc49b, rng.next() * 0.5);
  place(top, { y: deck, ceil: true });
  tintEach(top, (x, _y, z) => {
    const t = clamp01(Math.hypot(x, z) / R);
    const lit = clamp01(0.5 - (x * LX + z * LZ) / (R * 2.1));
    return mix(mix(warm, 0xcbb083, t * t * 0.85), 0xffeec6, lit * 0.3);
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
 * A curtain panel: fabric, not a rippled plane.
 *
 * The old one was a single `PlaneGeometry` with a sine pushed into Z, and it
 * read as corrugated card for three reasons — the folds were the same depth
 * top to bottom, the hem was dead level, and the whole sheet was one flat
 * cream. All three are fixed here, and the third matters most: the shading is
 * BAKED crest to trough, so the folds have light in them before a single lamp
 * touches the mesh.
 *
 * It also hangs on the wall's own radius rather than on a chord, gathers at
 * the heading, spreads as it falls, and is pulled in at mid height where a tie
 * would be. Two per window, out of phase with each other.
 */
function curtainPanel(
  room: PropBatch,
  a: number,
  dir: number,
  r: number,
  poleY: number,
  hemY: number,
  spread: number,
  q: QualityTier,
  rng: Rng,
): void {
  const su = pickE(q, 9, 13, 17);
  const sv = pickE(q, 4, 6, 8);
  const folds = 3.5;
  const phase = rng.range(0, TAU);
  const geo = new THREE.PlaneGeometry(1, 1, su, sv);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  const H = Math.max(poleY - hemY, 0.2);
  for (let i = 0; i < pos.count; i++) {
    const u = clamp01(pos.getX(i) + 0.5);
    const v = clamp01(0.5 - pos.getY(i));
    // Very nearly parallel-sided. The first pass gathered the heading to a
    // third of the hem's width and the panel came out a folded paper fan
    // hinged at one corner — a curtain barely changes width down its drop, and
    // all of the movement it does have is in the fold depth.
    const gather = 0.9 + 0.16 * v;
    const ang = a + dir * spread * u * gather;
    const wave = u * folds * TAU + phase;
    // folds deepen toward the hem and pinch out under the heading tape
    const depth = (0.07 + 0.26 * v) * (1 - 0.7 * Math.exp(-v * 12));
    const rr = r - Math.sin(wave) * depth - v * v * 0.16;
    const y = poleY - H * v - Math.cos(u * 5.1 + phase) * 0.13 * v * v;
    pos.setXYZ(i, Math.sin(ang) * rr, y, Math.cos(ang) * rr);
    // Baked fabric: crests take the window, troughs go warm grey, and the
    // whole panel loses light toward the floor.
    const lit = clamp01(0.5 + 0.5 * Math.cos(wave));
    const tone = mix(0xdccdb4, 0xfffbf2, lit * lit);
    col.setHex(mix(tone, 0xcdbba1, v * v * 0.34)).convertSRGBToLinear();
    cols[i * 3] = col.r;
    cols[i * 3 + 1] = col.g;
    cols[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  room.keep(geo);
}

/**
 * A window bay: sill, jambs, mullions, glazing rails, pole and two curtains.
 *
 * There is no pane. The opening is a genuine hole in the wall ring, so what
 * fills it is the backdrop's own sky with the garden standing in front of it —
 * and the bars are dark enough to survive at 120px as a silhouette against all
 * that light, which is what makes a window read as a window rather than as a
 * bright rectangle.
 */
function windowBay(
  joinery: PropBatch,
  room: PropBatch,
  a: number,
  sillY: number,
  transomY: number,
  pierTop: number,
  mullOff: readonly number[],
  rails: readonly number[],
  q: QualityTier,
  rng: Rng,
): void {
  const FRAME_TONE = 0xc3ac8c;
  const ROD = 0xa88f63;
  const segs = pickE(q, 6, 9, 12);
  const wide = BAY_HALF + 0.12;

  // the sill: a board across the whole opening, with a fascia under it
  joinery.add(
    bandGeo(WALL_R - 0.62, WALL_R + 0.04, a - wide, a + wide, segs),
    mix(FRAME_TONE, 0xf6ecda, 0.62),
    { y: sillY },
  );
  joinery.add(wallGeo(WALL_R - 0.58, 0.22, a - wide, a + wide, segs), FRAME_TONE, {
    y: sillY,
    ceil: true,
  });

  // jambs, hard against the piers, and mullions all the way up: the mullions
  // are the bars the light cuts its stripes from, so they are shared with
  // `sunMask` rather than authored twice
  for (const s of [-1, 1]) {
    const [jx, jz] = wallXZ(a + s * BAY_HALF, 0.14);
    joinery.box(0.26, pierTop - sillY, 0.3, FRAME_TONE, {
      x: jx,
      z: jz,
      ry: a + s * BAY_HALF,
      y: sillY,
      ground: true,
    });
  }
  for (const off of mullOff) {
    const [mx, mz] = wallXZ(a + off, 0.12);
    joinery.box(0.22, pierTop - sillY, 0.26, FRAME_TONE, {
      x: mx,
      z: mz,
      ry: a + off,
      y: sillY,
      ground: true,
    });
  }
  // Glazing rails. The first is level with the transom the wall stops at, so
  // the transom band already draws it; the two above are off the top of the
  // frame at the opening yaw and exist only because their SHADOWS are not —
  // they are the bars that land on the table. The one that IS drawn sits low
  // enough to cross the opening where the eye is.
  joinery.add(wallGeo(WALL_R - 0.12, 0.2, a - BAY_HALF, a + BAY_HALF, segs), FRAME_TONE, {
    y: rails[0],
  });

  // the pole and its finials, well clear of the transom so the two do not
  // stack into one thick brown line
  const rodY = transomY - 0.86;
  joinery.add(wallGeo(WALL_R - 0.54, 0.14, a - wide, a + wide, segs), ROD, { y: rodY });
  for (const s of [-1, 1]) {
    const [fx, fz] = wallXZ(a + s * (wide + 0.02), 0.54);
    joinery.ball(0.1, ROD, { x: fx, z: fz, y: rodY }, 6);
  }

  // Four panels, not two. A 68-degree bay is three frames wide, so a pair hung
  // only at the jambs is never in shot at the same time as the glass between
  // them; hanging a second pair off the inner mullions puts fabric in frame at
  // the bay's own centre, which is exactly where the orbit parks.
  const hem = sillY - 1.5;
  for (const s of [-1, 1]) {
    curtainPanel(room, a + s * (BAY_HALF - 0.02), -s, WALL_R - 0.58, rodY + 0.06, hem, 0.14, q, rng);
    curtainPanel(room, a + s * (BAY_HALF / 3), s, WALL_R - 0.62, rodY + 0.06, hem, 0.12, q, rng);
  }
}

/**
 * A Welsh dresser: the mass that fixes one of the two dead yaws.
 *
 * Everything about it is horizontal, because horizontals are what survive at
 * this distance — a worktop, three shelves and a cornice, with plates stood on
 * edge so the shelves have a silhouette instead of a shadow.
 *
 * `out` is how far a piece's CENTRE stands IN from the wall, i.e. toward the
 * camera. Getting that sign backwards is what made the first build a blank
 * olive panel: the back boards were in front of the shelves, and the shelves
 * and every plate on them were inside the wall.
 */
function dresser(joinery: PropBatch, a: number, floorY: number, q: QualityTier, rng: Rng): void {
  const SAGE = 0x93a98d;
  const SAGE_D = 0x6f8770;
  const CREAM = 0xf7f1e4;
  const W = 6.2;
  const at = (dx: number, out: number, y: number): PlaceOpts => ({
    x: Math.sin(a) * (WALL_R - out) + Math.sin(a + Math.PI / 2) * dx,
    z: Math.cos(a) * (WALL_R - out) + Math.cos(a + Math.PI / 2) * dx,
    ry: a,
    y,
  });

  // base: plinth, carcass, two drawers, worktop
  joinery.box(W, 0.26, 1.3, SAGE_D, { ...at(0, 0.8, floorY), ground: true });
  joinery.box(W - 0.2, 1.5, 1.2, SAGE, { ...at(0, 0.8, floorY + 0.26), ground: true });
  for (const s of [-1, 1]) {
    joinery.box(W / 2 - 0.5, 0.62, 0.1, mix(SAGE, CREAM, 0.34), at(s * W * 0.24, 1.44, floorY + 1.3));
    joinery.ball(0.09, 0xd8c9a8, at(s * W * 0.24, 1.56, floorY + 1.3), 6);
  }
  joinery.box(W + 0.24, 0.19, 1.5, CREAM, { ...at(0, 0.85, floorY + 1.76), ground: true });

  // upper: a dark back so the shelves have something to sit against, sides,
  // three shelves, and a cornice
  const upBase = floorY + 1.95;
  const upH = 3.05;
  joinery.box(W - 0.5, upH, 0.1, mix(SAGE_D, 0x4c5c4e, 0.45), { ...at(0, 0.22, upBase), ground: true });
  for (const s of [-1, 1]) {
    joinery.box(0.2, upH, 0.8, SAGE, { ...at((s * (W - 0.5)) / 2, 0.62, upBase), ground: true });
  }
  const shelves = pickE(q, 2, 3, 3);
  for (let i = 0; i < shelves; i++) {
    const sy = upBase + 0.42 + (i * (upH - 0.85)) / shelves;
    joinery.box(W - 0.5, 0.12, 0.74, CREAM, at(0, 0.6, sy));
    // plates on edge, leaning on the dark back: the only thing at this
    // distance that says "dresser" rather than "cupboard"
    const plates = pickE(q, 3, 4, 5);
    for (let k = 0; k < plates; k++) {
      const dx = ((k + 0.5) / plates - 0.5) * (W - 1.3) + rng.range(-0.1, 0.1);
      const rp = rng.range(0.48, 0.66);
      joinery.add(
        new THREE.CylinderGeometry(rp, rp, 0.08, 12).rotateX(Math.PI / 2),
        mix(CREAM, 0xdfe8ea, rng.next() * 0.7),
        { ...at(dx, 0.44, sy + 0.06 + rp), rz: rng.range(-0.07, 0.07) },
      );
    }
    if (i > 0) {
      // two mugs hooked under the shelf, so the shelf line is never clean
      for (const s of [-1, 1]) {
        joinery.cyl(
          0.19,
          0.22,
          0.32,
          mix(CREAM, 0xa8cbee, 0.55 + rng.next() * 0.3),
          { ...at(s * rng.range(0.7, 1.9), 0.8, sy - 0.14), ceil: true },
          9,
        );
      }
    }
  }
  joinery.box(W + 0.1, 0.3, 1.0, CREAM, { ...at(0, 0.68, upBase + upH), ceil: true });
}

/**
 * The door to the hall, and the hall behind it.
 *
 * The other dead yaw. It is a hole in the wall with something visibly on the
 * far side of it — a warm, much darker slab, the only genuinely dark value in
 * the room — which is the cheapest possible way to say that this room is part
 * of a house.
 */
function doorway(
  joinery: PropBatch,
  room: PropBatch,
  a: number,
  floorY: number,
  headY: number,
  q: QualityTier,
): void {
  const CASE = 0xe8dcc6;
  const segs = pickE(q, 4, 6, 8);

  // the hall beyond: a dark warm wall, and a strip of floor running under it
  const hall = wallGeo(WALL_R + 1.6, headY - floorY + 0.5, a - DOOR_HALF - 0.06, a + DOOR_HALF + 0.06, segs, 3);
  if (hall) {
    place(hall, { y: floorY - 0.2, ground: true });
    tintEach(hall, (_x, y) => {
      const t = clamp01((y - floorY) / Math.max(headY - floorY, 0.2));
      // dark at the skirting, warmer where light from a hall window would fall
      return mix(0x6b5743, 0xcda87a, t * t);
    });
    room.keep(hall);
  }
  room.add(
    bandGeo(WALL_R - 0.1, WALL_R + 1.7, a - DOOR_HALF - 0.06, a + DOOR_HALF + 0.06, segs),
    0x8a7156,
    { y: floorY + 0.01 },
  );

  // architrave: two jambs and a head
  for (const s of [-1, 1]) {
    const [jx, jz] = wallXZ(a + s * DOOR_HALF, 0.05);
    joinery.box(0.4, headY - floorY + 0.3, 0.5, CASE, {
      x: jx,
      z: jz,
      ry: a + s * DOOR_HALF,
      y: floorY,
      ground: true,
    });
  }
  joinery.add(
    wallGeo(WALL_R - 0.05, 0.42, a - DOOR_HALF - 0.045, a + DOOR_HALF + 0.045, segs),
    CASE,
    { y: headY, ceil: true },
  );

  // the leaf, standing open into the room
  const hinge = a - DOOR_HALF;
  const [hx, hz] = wallXZ(hinge, 0.4);
  const open = 0.62;
  const leafW = 2 * WALL_R * Math.sin(DOOR_HALF);
  const dirX = Math.sin(hinge + Math.PI / 2 + open);
  const dirZ = Math.cos(hinge + Math.PI / 2 + open);
  joinery.box(leafW, headY - floorY - 0.08, 0.16, mix(CASE, 0xfffdf6, 0.5), {
    x: hx + (dirX * leafW) / 2,
    z: hz + (dirZ * leafW) / 2,
    ry: hinge + open,
    y: floorY,
    ground: true,
  });
  joinery.ball(0.1, 0xb99a5f, {
    x: hx + dirX * (leafW - 0.3),
    z: hz + dirZ * (leafW - 0.3),
    y: floorY + (headY - floorY) * 0.52,
  }, 6);
}

/** A pot of something leafy: window sills, and beside the door. */
function pottedPlant(
  room: PropBatch,
  x: number,
  z: number,
  y: number,
  scale: number,
  leaves: number,
  rng: Rng,
): void {
  const s = safe(scale, 1);
  room.add(new THREE.CylinderGeometry(0.32 * s, 0.24 * s, 0.46 * s, 10), 0xc97b3c, {
    x, z, y, ground: true,
  });
  room.add(new THREE.CylinderGeometry(0.35 * s, 0.33 * s, 0.09 * s, 10), 0xd9884a, {
    x, z, y: y + 0.44 * s,
  });
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * TAU + rng.range(-0.3, 0.3);
    const leaf = leafGeo(rng.range(0.55, 0.95) * s, rng.range(0.26, 0.44) * s, {
      fold: 0.35,
      arch: 0.5,
      seed: 2 + i,
      segU: 5,
      segV: 2,
    });
    room.add(leaf, mix(0x63b878, 0xa6d894, rng.next()), {
      x,
      z,
      y: y + 0.4 * s,
      ry: a,
      rz: -rng.range(0.35, 0.95),
    });
  }
}

function breakfastEnvironment(ctx: EnvBuildCtx): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'breakfast.gardenroom';
  const m = ctx.materials;
  const q = ctx.quality;
  const rng = ctx.rng.fork(9203);
  const topY = num(ctx.tableTopY, -0.35);
  const floorY = topY - ROOM_DROP;
  const sillY = floorY + SILL_UP;
  const transomY = floorY + TRANSOM_UP;
  const pierTop = floorY + PIER_UP;
  /** The garden outside, a step down from the floor. */
  const gardenY = floorY - 0.45;

  const atBearing = (theta: number, d: number): [number, number] => {
    const a = CAM_BEARING + theta;
    return [Math.sin(a) * d, Math.cos(a) * d];
  };
  const bayA = (i: number): number => BAY_A + i * BAY_STEP;
  const doorA = bayA(BAY_DOOR);
  const doorHeadY = floorY + DOOR_UP;

  const room = new PropBatch();
  const joinery = new PropBatch();
  const glass = new PropBatch();
  const sun = new PropBatch();

  // --- floor ---------------------------------------------------------------
  room.keep(
    groundDisc(
      20,
      (t, x, z) => {
        const board = 0.5 + fbm2(x * 0.05 + 1.7, z * 0.6 - 3.3, 2) * 0.6;
        const near = mix(0xc79a63, 0xdcb87f, clamp01(board));
        return t < 0.35 ? near : mix(near, mix(HAZE, 0xfff6ea, 0.3), clamp01((t - 0.35) / 0.5));
      },
      { segments: pickE(q, 26, 36, 46), rings: pickE(q, 5, 7, 8), seed: 8 },
    ),
    { y: floorY },
  );

  // --- the wall ------------------------------------------------------------
  //
  // Four piers, and between them either a hole or a bay's worth of wall. The
  // piers are the only thing that reaches the top of the frame, and they lose
  // their colour over the last third, so a tower tall enough to see their ends
  // sees them dissolve instead of stop.
  const wallSegs = pickE(q, 5, 7, 9);
  const ringSegs = pickE(q, 26, 36, 48);
  const baySegs = pickE(q, 8, 11, 14);
  for (let i = 0; i < BAYS; i++) {
    const a = bayA(i);
    const pa = a + BAY_STEP / 2;
    const pier = wallGeo(WALL_R, pierTop - floorY, pa - PIER_HALF, pa + PIER_HALF, wallSegs,
      pickE(q, 5, 7, 9));
    if (pier) {
      place(pier, { y: floorY, ground: true });
      tintEach(pier, (_x, y) => {
        const t = clamp01((y - floorY) / (pierTop - floorY));
        const paint = mix(0xeadcc2, 0xfdf6e8, clamp01(t * 3) ** 0.7);
        return mix(paint, mix(SKY, 0xffffff, 0.6), clamp01((t - 0.55) / 0.45) ** 1.1);
      });
      room.keep(pier);
    }

    // the wall between the piers: nothing at all on the two window bays, solid
    // to the transom on the two room bays — and on the door bay, solid either
    // side of the opening with a lintel over it
    const spans: Array<[number, number, number, number]> =
      i === BAY_DRESSER
        ? [[a - BAY_HALF, a + BAY_HALF, floorY, transomY]]
        : i === BAY_DOOR
          ? [
              [a - BAY_HALF, a - DOOR_HALF, floorY, transomY],
              [a + DOOR_HALF, a + BAY_HALF, floorY, transomY],
              [a - DOOR_HALF, a + DOOR_HALF, doorHeadY, transomY],
            ]
          : [];
    for (const [a0, a1, y0, y1] of spans) {
      const solid = wallGeo(WALL_R, y1 - y0, a0, a1, baySegs, 3);
      if (!solid) continue;
      place(solid, { y: y0, ground: true });
      tintEach(solid, (_x, y) => {
        const t = clamp01((y - floorY) / (transomY - floorY));
        return mix(0xe9dbc1, 0xfcf5e6, t * t * (3 - 2 * t));
      });
      room.keep(solid);
    }
  }

  // The dado runs the whole way round, including behind the windows where it
  // becomes the wall under the sill — it is the one band that ties four
  // different bays into one room. It stops either side of the doorway, because
  // a door with a wall across its foot is a window.
  const ringA0 = doorA + DOOR_HALF;
  const ringA1 = doorA + TAU - DOOR_HALF;
  room.add(wallGeo(WALL_R - 0.1, SILL_UP, ringA0, ringA1, ringSegs), 0xfffcf5, {
    y: floorY, ground: true,
  });
  // the shadow reveal under the cap — the line that says "this band is proud"
  room.add(wallGeo(WALL_R - 0.08, 0.1, ringA0, ringA1, ringSegs), 0xdfd0b6, { y: sillY - 0.1 });
  room.add(wallGeo(WALL_R - 0.02, 0.16, ringA0, ringA1, ringSegs), 0xfffdf6, { y: sillY });
  room.add(wallGeo(WALL_R - 0.04, 0.3, ringA0, ringA1, ringSegs), 0xfffdf6, {
    y: floorY, ground: true,
  });
  // The transom band: a full ring, above the door head. This is the only
  // horizontal line left in the upper frame, and it is allowed to be there
  // because it has a moulding under it and four piers running through it.
  room.add(wallGeo(WALL_R - 0.06, 0.26, 0, TAU, ringSegs), 0xfffdf6, { y: transomY, ceil: true });
  room.add(wallGeo(WALL_R - 0.15, 0.12, 0, TAU, ringSegs), 0xe3d5bb, {
    y: transomY - 0.3, ceil: true,
  });

  // --- the garden, seen through the holes ----------------------------------
  //
  // The other half of "make the window the hero": a hole with nothing behind it
  // is a hole. Ground, a hedge that closes the bottom of every opening, and a
  // tree line rising through the clerestory into the sky.
  {
    const gnd = new THREE.RingGeometry(WALL_R - 1, 30, pickE(q, 28, 38, 50), 3);
    gnd.rotateX(-Math.PI / 2);
    tintEach(gnd, (x, _y, z) => {
      const t = clamp01((Math.hypot(x, z) - WALL_R) / 15);
      const grass = mix(0x9dba6e, 0xbcd08c, clamp01(0.5 + fbm2(x * 0.07, z * 0.07, 2) * 0.7));
      return mix(mix(grass, HAZE, 0.3 + 0.55 * t), 0xfff6ea, t ** 1.3 * 0.7);
    });
    room.keep(gnd, { y: gardenY });
  }
  {
    // A continuous hedge, so no gap between lobes can show the ground's rim.
    // Low and pale. At full height and full saturation it filled the whole
    // opening with one flat green field and the food lost the only saturated
    // colour in the frame — the bible's rule is that the world is desaturated
    // and the food is not, and a hedge two metres from the glass is still the
    // world.
    const HEDGE_R = 17;
    const HEDGE_H = 2.5;
    const hedge = wallGeo(HEDGE_R, HEDGE_H, 0, TAU, pickE(q, 24, 34, 44), 2);
    if (hedge) {
      place(hedge, { y: gardenY, ground: true });
      tintEach(hedge, (x, y, z) => {
        const t = clamp01((y - gardenY) / HEDGE_H);
        const leafy = mix(0x74985c, 0x93ac6c, clamp01(0.5 + fbm2(x * 0.4, z * 0.4, 2) * 0.9));
        return mix(mix(leafy, HAZE, 0.4), 0xe6e7c8, t * 0.3);
      });
      room.keep(hedge);
    }
    const lobes = pickE(q, 14, 20, 26);
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * TAU + rng.range(-0.08, 0.08);
      const w = rng.range(1.0, 1.7);
      room.dome(
        w,
        w * rng.range(0.34, 0.5),
        mix(mix(0x7ea165, 0x9cb679, rng.next()), HAZE, 0.42),
        { x: Math.sin(a) * HEDGE_R, z: Math.cos(a) * HEDGE_R, y: gardenY + HEDGE_H - 0.1 },
        q === 'low' ? 6 : 8,
      );
    }
  }
  {
    // The tree line: canopy masses only. No trunks — at 22 units a trunk is one
    // pixel wide and all it does is alias. Clamped to `skyCap` so a strip of
    // sky always survives above them.
    const trees = pickE(q, 12, 17, 22);
    for (let i = 0; i < trees; i++) {
      const outer = i % 3 === 2;
      const a = (i / trees) * TAU + rng.range(-0.12, 0.12);
      const d = (outer ? 25.0 : 20.4) + rng.range(-1.2, 1.8);
      const r = outer ? rng.range(1.9, 2.8) : rng.range(1.5, 2.3);
      // The squash is 0.7, so the crown's half-height is 0.7r and not 0.5r —
      // clamping against the wrong one is how a tree line eats the sky it was
      // measured to leave.
      const half = r * 0.7;
      const y = Math.min(gardenY + 3.0 + half, skyCap(d) + 0.55 - half);
      room.add(
        new THREE.SphereGeometry(r, pickE(q, 7, 9, 10), pickE(q, 4, 5, 5)).scale(1.25, 0.7, 1.25),
        mix(mix(0x86a86a, 0xa3bb80, rng.next()), HAZE, (outer ? 0.58 : 0.4) + rng.next() * 0.12),
        { x: Math.sin(a) * d, z: Math.cos(a) * d, y },
      );
    }
  }

  // --- the two windows -----------------------------------------------------
  //
  // Mullion bearings and rail heights are shared with `sunMask` below, because
  // the bars in the room and the bars in the light have to be the same bars.
  const mullOff = [-BAY_HALF / 3, BAY_HALF / 3];
  // The first is a real glazing bar, low enough in the opening to be seen; the
  // rest are the transom and two bars above the top of the frame, which are
  // here only because their shadows land on the table.
  const rails = [transomY - 1.7, transomY, transomY + 4.3, transomY + 7.4];
  for (const i of [BAY_WINDOW, BAY_SUN]) {
    windowBay(joinery, room, bayA(i), sillY, transomY, pierTop, mullOff, rails, q, rng);
    const pa = bayA(i) + (i === BAY_SUN ? -0.4 : 0.42);
    const [sx, sz] = wallXZ(pa, 0.42);
    pottedPlant(room, sx, sz, sillY + 0.08, 1.25, pickE(q, 5, 8, 10), rng);
  }

  // --- the two rooms -------------------------------------------------------
  dresser(joinery, bayA(BAY_DRESSER), floorY, q, rng);
  doorway(joinery, room, doorA, floorY, doorHeadY, q);
  {
    // a plant stand beside the door, so that bay has a second mass in it
    const a = doorA + 0.44;
    const [sx, sz] = wallXZ(a, 1.1);
    joinery.cyl(0.28, 0.34, 1.7, 0xd8c6a4, { x: sx, z: sz, y: floorY, ground: true }, 9);
    joinery.cyl(0.62, 0.5, 0.14, 0xe8dcc6, { x: sx, z: sz, y: floorY + 1.7 }, 12);
    pottedPlant(room, sx, sz, floorY + 1.79, 1.5, pickE(q, 6, 9, 12), rng);
  }
  // Wall furniture. Blank wall is the failure mode of the two room bays — the
  // first build put 0.95-unit prints on a 13.5-unit wall and they measured
  // thirty pixels, which is a fly on a bedsheet. Everything here is authored
  // against the frame instead: a print is two and a half units, which is an
  // eighth of the visible wall at this distance, and they hang in a group.
  const hangings: Array<[number, number]> = [
    [bayA(BAY_DRESSER) + BAY_STEP / 2 - 0.11, 0],
    [bayA(BAY_DRESSER) + BAY_STEP / 2 + 0.12, 1],
    [bayA(BAY_DOOR) - 0.44, 0],
    [bayA(BAY_DOOR) - 0.66, 1],
    [bayA(BAY_DOOR) + BAY_STEP / 2 - 0.06, 0],
  ];
  for (const [a, small] of hangings) {
    const [ax, az] = wallXZ(a, 0.14);
    const w = (small ? 1.5 : 2.5) + rng.range(-0.15, 0.35);
    const h = w * rng.range(0.72, 1.24);
    const y = floorY + 3.0 + rng.range(-0.35, 0.6);
    joinery.box(w, h, 0.14, mix(0x8f7757, 0xb59a74, rng.next()), { x: ax, z: az, ry: a, y });
    room.box(w - 0.34, h - 0.34, 0.07, mix(0xf3e7d2, 0xdcd2c4, rng.next()), {
      x: ax - Math.sin(a) * 0.06,
      z: az - Math.cos(a) * 0.06,
      ry: a,
      y,
    });
  }
  {
    // A wall clock over the door bay's shoulder, and a plate shelf under it:
    // two more horizontals, which is what a wall of this size needs to stop
    // reading as a bedsheet.
    const a = bayA(BAY_DRESSER) - BAY_STEP / 2 + 0.1;
    const [cx, cz] = wallXZ(a, 0.16);
    const cy = floorY + 3.55;
    joinery.cyl(0.72, 0.72, 0.16, 0x8f7757, { x: cx, z: cz, ry: a, rx: Math.PI / 2, y: cy }, 14);
    joinery.cyl(0.58, 0.58, 0.06, 0xfffaf0, {
      x: cx - Math.sin(a) * 0.11, z: cz - Math.cos(a) * 0.11, ry: a, rx: Math.PI / 2, y: cy,
    }, 14);
    for (const [len, ang] of [[0.42, 1.1], [0.3, -2.2]] as const) {
      joinery.box(0.07, len, 0.04, 0x6d6a62, {
        x: cx - Math.sin(a) * 0.15 + Math.sin(a + Math.PI / 2) * Math.sin(ang) * len * 0.5,
        z: cz - Math.cos(a) * 0.15 + Math.cos(a + Math.PI / 2) * Math.sin(ang) * len * 0.5,
        ry: a,
        rz: ang,
        y: cy + Math.cos(ang) * len * 0.5,
      });
    }
    const sy = floorY + 2.05;
    joinery.add(bandGeo(WALL_R - 0.72, WALL_R - 0.06, a - 0.2, a + 0.2, 6), 0xfffaf0, { y: sy });
    joinery.add(wallGeo(WALL_R - 0.68, 0.14, a - 0.2, a + 0.2, 6), 0xefe3cc, { y: sy, ceil: true });
    for (let k = 0; k < pickE(q, 2, 3, 4); k++) {
      const dx = (k - 1) * 0.055;
      joinery.cyl(0.2, 0.24, rng.range(0.4, 0.62), mix(0xfffaf0, 0xd8c9a8, rng.next()), {
        x: Math.sin(a + dx) * (WALL_R - 0.42),
        z: Math.cos(a + dx) * (WALL_R - 0.42),
        y: sy + 0.02,
        ground: true,
      }, 10);
    }
  }

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

  // --- the light -----------------------------------------------------------
  //
  // One mask, traced back through the sun window, evaluated on two planes and
  // along two shafts. Because it is a trace and not a painting, the bars land
  // on the table and on the floor as one continuous cast, which is the whole
  // difference between a pool of light and a decal of one.
  {
    const sunBay = bayA(BAY_SUN);
    const acrossOf = (a: number): number => WALL_R * Math.sin(a - SUN_A);
    const edges = [acrossOf(sunBay - BAY_HALF), acrossOf(sunBay + BAY_HALF)];
    const acrossMin = Math.min(edges[0], edges[1]);
    const acrossMax = Math.max(edges[0], edges[1]);
    const mulls = mullOff.map((o) => acrossOf(sunBay + o));
    const litAt = (x: number, y: number, z: number): number =>
      sunMask(x, y, z, sillY, pierTop, rails, mulls, acrossMin, acrossMax);

    /** A flat sheet of light, clipped to an annulus. */
    const pool = (
      y: number,
      rIn: number,
      rOut: number,
      size: number,
      su: number,
      sv: number,
      peak: number,
    ): void => {
      const geo = new THREE.PlaneGeometry(size, size, su, sv);
      geo.rotateX(-Math.PI / 2);
      // Aligned with the light, so the bars stay parallel to the grid: the
      // pattern is fine ACROSS the beam and broad along it, and a grid rotated
      // out of step with that needs four times the vertices for the same edge.
      geo.rotateY(SUN_A);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) pos.setY(i, y);
      // Colour AND alpha, not alpha alone. A sheet that only ADDS light can
      // never be more than a few percent over a cream table — the first build
      // was invisible for exactly that reason. Carrying a cool grey in the
      // shadowed half and a warm white in the lit half gives the cast two
      // sides, which is what the eye actually reads as sunlight.
      tintEachA(
        geo,
        (x, yy, z) => mix(0x9b8a72, 0xfff5d6, clamp01(litAt(x, yy, z)) ** 0.8),
        (x, yy, z) => {
          const r = Math.hypot(x, z);
          const edge = clamp01((r - rIn) / 0.7) * clamp01((rOut - r) / 0.7);
          return edge * peak * (0.36 + 0.64 * litAt(x, yy, z));
        },
      );
      sun.keep(geo);
    };

    pool(topY + 0.014, 1.45, 5.84, 12.6, pickE(q, 30, 38, 46), pickE(q, 14, 18, 22), 0.62);
    pool(floorY + 0.02, 6.35, 13.2, 28, pickE(q, 22, 28, 34), pickE(q, 9, 12, 15), 0.42);

    if (q !== 'low') {
      // Two shafts, aimed down the gaps between the mullion shadows so neither
      // one crosses the tower — a shaft that grazes the food reads as a smear
      // on the lens, not as air.
      const cosEl = Math.cos(SUN_EL);
      const dir = new THREE.Vector3(LX * cosEl, -Math.sin(SUN_EL), LZ * cosEl);
      const len = 17;
      const probe = new THREE.Vector3();
      for (const across of [mulls[0] - 2.7, mulls[1] + 2.7]) {
        const land = new THREE.Vector3(LX * 1.2 + PX * across, topY, LZ * 1.2 + PZ * across);
        const from = land.clone().addScaledVector(dir, -len);
        const shaft = strut(from, land, q === 'high' ? 1.15 : 1.4, true);
        if (!shaft) continue;
        tintEachA(
          shaft,
          () => 0xfff6e2,
          (x, y, z) => {
            const t = clamp01(probe.set(x, y, z).sub(from).dot(dir) / len);
            return clamp01(t / 0.22) * clamp01((1 - t) / 0.3) * 0.13;
          },
        );
        sun.keep(shaft);
      }
    }
  }

  const roomGeo = room.build();
  if (roomGeo) g.add(mesh(roomGeo, roomMat(m), { cast: false, receive: true }));
  const joineryGeo = joinery.build();
  if (joineryGeo) g.add(mesh(joineryGeo, joineryMat(m), { cast: true, receive: true }));
  const glassGeo = glass.build();
  if (glassGeo) g.add(mesh(glassGeo, tableGlassMat(m), { cast: false, receive: false }));
  const sunGeo = sun.build();
  if (sunGeo) {
    const lit = mesh(sunGeo, sunMat(m), { cast: false, receive: false });
    lit.renderOrder = 3;
    g.add(lit);
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
    // Early morning: a high soft sun on the light rig's own bearing, thin high
    // cloud, and a very broad glow. The room is built to let it in — the two
    // window bays are holes, so this is what is actually behind them.
    sky: SKY_PRESETS.breakfast,
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
