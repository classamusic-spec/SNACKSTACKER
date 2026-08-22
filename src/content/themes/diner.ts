/**
 * CLASSIC DINER — the free, cozy default.
 *
 * Ingredient run (DESIGN.md order): sesame bun crown, beef patty, cheddar
 * slice, tomato, lettuce ruffle, pickle chips, bacon rashers, bottom bun.
 *
 * Silhouette discipline: the crown is a tall seeded dome, the patty is a squat
 * craggy puck with a proud seared rim, the cheddar is a thin sheet whose
 * corners droop to the deck, the tomato is a clean thin disc with a skin edge,
 * the lettuce is a frill, the pickles are separated chips with gaps between
 * them, the bacon is parallel wavy ribbons, and the heel is a flat-topped
 * squat disc. No two share a profile in black at 120px.
 */
import * as THREE from 'three';
import type { EnvBuildCtx, FoodBuildCtx, FoodDef, ThemeDef } from '../api';
import type { MaterialLibrary } from '../../render/api';
import type { Rng } from '../../core/rng';
import { TAU, clamp01 } from '../../core/math';
import { droopSlab, fbm2, mesh, puck, roughen, ruffle, scatter } from '../kit';
import {
  areaCount,
  baconPainter,
  charPainter,
  checkerPainter,
  clothSheet,
  coverCount,
  crumbBumpTex,
  cutRadius,
  cutSquare,
  discFace,
  finishLayer,
  fitGeoY,
  glazePainter,
  groundDisc,
  groundGeo,
  catenary,
  ceilGeo,
  leafVeinTex,
  mergeSafe,
  mix,
  num,
  paintTomatoFlesh,
  pickE,
  pickQ,
  plankPainter,
  PropBatch,
  propSize,
  rasherRun,
  ringTorus,
  roughAmt,
  safe,
  specklePainter,
  turfPainter,
} from './shared-savory';

// ---------------------------------------------------------------------------
// materials — keyed by LOOK so all 60 layers share a handful of programs
// ---------------------------------------------------------------------------

const bunMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('diner.bun', {
    color: 0xc98a4b,
    roughness: 0.86,
    sheen: 0.5,
    sheenColor: 0xffe9c9,
    sheenRoughness: 0.85,
    bumpMap: crumbBumpTex(m),
    bumpScale: 0.012,
  });

const bunCrumbMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('diner.bunCrumb', {
    color: 0xf2dcb2,
    roughness: 0.95,
    sheen: 0.35,
    sheenColor: 0xfff4e0,
    bumpMap: crumbBumpTex(m),
    bumpScale: 0.02,
  });

const sesameMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.sesame', { color: 0xf3e2c0, roughness: 0.52 });

const pattyMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.patty', {
    color: 0x5c3a22,
    roughness: 0.72,
    map: m.texture('diner.charFine', charPainter(0xf0e9e0, 0x4a2f1c, 150, 5), { size: 256 }),
    bumpMap: crumbBumpTex(m),
    bumpScale: 0.03,
  });

const searMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.pattySear', {
    color: 0x3a2013,
    roughness: 0.6,
    map: m.texture('diner.charHeavy', charPainter(0xe8ded2, 0x2a1a10, 300, 9), { size: 256 }),
  });

const cheddarMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('diner.cheddar', {
    color: 0xf0a830,
    roughness: 0.45,
    clearcoat: 0.34,
    clearcoatRoughness: 0.42,
  });

const tomatoMat = (m: MaterialLibrary): THREE.Material =>
  // The painted flesh map carries the #D8412F hue itself, so the base colour
  // stays neutral — otherwise the pale seeds would be multiplied back to red.
  m.physical('diner.tomato', {
    color: 0xfff4f0,
    roughness: 0.3,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
    map: m.texture('diner.tomatoFlesh', paintTomatoFlesh, { size: 256 }),
  });

const tomatoSkinMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('diner.tomatoSkin', {
    color: 0xc0392b,
    roughness: 0.28,
    clearcoat: 0.7,
    clearcoatRoughness: 0.18,
  });

const lettuceMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.lettuce', {
    color: 0x7fbf4b,
    roughness: 0.76,
    side: THREE.DoubleSide,
    // a lighter emissive tint fakes the light bleeding through a thin leaf
    emissive: 0x3d7a24,
    emissiveIntensity: 0.24,
    bumpMap: leafVeinTex(m),
    bumpScale: 0.006,
  });

const pickleMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('diner.pickle', {
    color: 0xffffff,
    roughness: 0.4,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
    map: m.texture(
      'diner.pickleSkin',
      specklePainter(
        0x5e8c31,
        [
          { color: 0x9bbf5b, count: 90, min: 0.006, max: 0.03, alpha: 0.55 },
          { color: 0x3d6420, count: 60, min: 0.004, max: 0.02, alpha: 0.5 },
          { color: 0xdcecb0, count: 26, min: 0.004, max: 0.012, alpha: 0.8 },
        ],
        { seed: 21, mottle: 20 },
      ),
      { size: 256 },
    ),
  });

const baconMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.bacon', {
    color: 0xffffff,
    roughness: 0.48,
    map: m.texture('diner.baconStripes', baconPainter(false, 3), { size: 256 }),
    bumpMap: crumbBumpTex(m),
    bumpScale: 0.012,
  });

// ---------------------------------------------------------------------------
// foods
// ---------------------------------------------------------------------------

const CROWN_DOME = 0.62;
const CROWN_TAPER = 0.12;

/**
 * Height of the crown's baked top surface at normalized radius q, in the space
 * the mesh ends up in. Derived from `puck`'s dome term so sesame seeds sit ON
 * the bread instead of hovering over the rim.
 */
function crownSurfaceY(q: number, height: number): number {
  return (height * (1 + CROWN_DOME * (1 - q * q) * 0.5)) / (1 + CROWN_DOME * 0.5);
}

const bunCrown: FoodDef = {
  id: 'diner.bun_crown',
  name: 'Sesame Bun Crown',
  glyph: '🍔',
  thickness: 0.62,
  tint: 0xc98a4b,
  tintAlt: 0xf3e2c0,
  build(ctx) {
    const g = new THREE.Group();
    const h = safe(ctx.height, 1e-3);
    const sq = cutSquare(ctx);
    const body = puck(safe(ctx.width), h, safe(ctx.depth), {
      wobble: 0.055 + ctx.rng.range(-0.012, 0.012),
      domed: CROWN_DOME,
      taper: CROWN_TAPER,
      radial: pickQ(ctx, 16, 26, 40),
      rings: pickQ(ctx, 3, 5, 7),
      seed: 3.1 + ctx.index * 0.37,
    });
    roughen(body, roughAmt(ctx, 0.016), 7, ctx.index * 1.7);
    fitGeoY(body, h);
    g.add(mesh(body, bunMat(ctx.materials)));

    // sesame seeds, placed along the dome so none of them float
    const n = areaCount(ctx, pickQ(ctx, 12, 20, 30));
    if (n > 0 && !ctx.offcut) {
      const len = propSize(ctx, 0.05, 0.072);
      const rng = ctx.rng.fork(11 + ctx.index);
      const seeds: THREE.BufferGeometry[] = [];
      for (let i = 0; i < n; i++) {
        const q = Math.sqrt(rng.next()) * 0.84;
        const a = rng.range(0, TAU);
        // follow the superellipse the kit morphs a cut puck into, so seeds sit
        // on the bread out to the corners instead of stopping at an ellipse
        const spread = (1 - CROWN_TAPER * q * q) * cutRadius(a, sq);
        const s = new THREE.SphereGeometry(0.5, 6, 4);
        s.scale(len, len * 0.4, len * 0.6);
        s.rotateY(rng.range(0, TAU));
        s.translate(
          (safe(ctx.width) / 2) * q * spread * Math.cos(a),
          crownSurfaceY(q, h) - len * 0.14,
          (safe(ctx.depth) / 2) * q * spread * Math.sin(a),
        );
        seeds.push(s);
      }
      const merged = mergeSafe(seeds);
      if (merged) g.add(mesh(merged, sesameMat(ctx.materials)));
    }
    return finishLayer(ctx, g);
  },
};

const beefPatty: FoodDef = {
  id: 'diner.patty',
  name: 'Beef Patty',
  glyph: '🥩',
  thickness: 0.52,
  tint: 0x5c3a22,
  tintAlt: 0x3a2013,
  build(ctx) {
    const g = new THREE.Group();
    const h = safe(ctx.height, 1e-3);
    const w = safe(ctx.width);
    const d = safe(ctx.depth);
    const radial = pickQ(ctx, 16, 26, 40);

    const body = puck(w, h * 0.94, d, {
      wobble: 0.085,
      domed: 0.22,
      radial,
      rings: pickQ(ctx, 3, 4, 6),
      seed: 7.7 + ctx.index * 0.61,
    });
    roughen(body, roughAmt(ctx, 0.055), 8, ctx.index * 2.3);
    fitGeoY(body, h);
    g.add(mesh(body, pattyMat(ctx.materials)));

    // The seared rim: a slightly proud, much rougher band around the waist.
    // 4.5% of the footprint, so even a 0.15 sliver overhangs by 3mm.
    const rim = puck(w * 1.045, h * 0.5, d * 1.045, {
      wobble: 0.13,
      domed: 0,
      radial,
      rings: 2,
      seed: 2.2 + ctx.index * 0.9,
      square: cutSquare(ctx),
    });
    roughen(rim, roughAmt(ctx, 0.07), 11, ctx.index * 3.1);
    groundGeo(rim, h * 0.2);
    g.add(mesh(rim, searMat(ctx.materials)));
    return finishLayer(ctx, g);
  },
};

const cheddarSlice: FoodDef = {
  id: 'diner.cheddar',
  name: 'Cheddar Slice',
  glyph: '🧀',
  thickness: 0.24,
  tint: 0xf0a830,
  tintAlt: 0xffd27a,
  build(ctx) {
    const h = safe(ctx.height, 1e-3);
    const geo = droopSlab(safe(ctx.width) * 0.99, h * 0.42, safe(ctx.depth) * 0.99, {
      droop: 0.55,
      segments: pickQ(ctx, 6, 10, 14),
      seed: 3 + ctx.index * 0.8,
      ripple: 0.34 + ctx.rng.range(-0.08, 0.08),
    });
    fitGeoY(geo, h);
    return finishLayer(ctx, mesh(geo, cheddarMat(ctx.materials)));
  },
};

const tomatoRound: FoodDef = {
  id: 'diner.tomato',
  name: 'Tomato',
  glyph: '🍅',
  thickness: 0.3,
  tint: 0xd8412f,
  tintAlt: 0xf7e5a3,
  build(ctx) {
    const g = new THREE.Group();
    const h = safe(ctx.height, 1e-3);
    const sq = cutSquare(ctx);
    const flesh = puck(safe(ctx.width) * 0.96, h, safe(ctx.depth) * 0.96, {
      wobble: 0.026,
      domed: 0.1,
      radial: pickQ(ctx, 20, 32, 46),
      rings: pickQ(ctx, 2, 3, 4),
      seed: 4.4 + ctx.index * 0.29,
      square: sq,
    });
    fitGeoY(flesh, h);
    g.add(mesh(flesh, tomatoMat(ctx.materials)));

    // the skin: a taut red edge that gives the disc a crisp silhouette
    const skin = ringTorus(
      safe(ctx.width),
      safe(ctx.depth),
      0.05,
      h * 0.44,
      pickQ(ctx, 5, 6, 8),
      pickQ(ctx, 20, 32, 48),
      sq,
    );
    skin.translate(0, h * 0.48, 0);
    g.add(mesh(skin, tomatoSkinMat(ctx.materials)));
    return finishLayer(ctx, g);
  },
};

const lettuceRuffle: FoodDef = {
  id: 'diner.lettuce',
  name: 'Lettuce Ruffle',
  glyph: '🥬',
  thickness: 0.36,
  tint: 0x7fbf4b,
  tintAlt: 0xcfe8a6,
  build(ctx) {
    const h = safe(ctx.height, 1e-3);
    const w = safe(ctx.width);
    const d = safe(ctx.depth);
    // The frill is built at 86% and peaks at ~1.33x, so it feathers ~14% past
    // the footprint — a lettuce leaf should peek out of a burger, but the
    // centre of mass stays well inside the cut.
    const sq = cutSquare(ctx);
    const band = ruffle(w * 0.86, h * 0.82, d * 0.86, {
      folds: 7 + (ctx.index % 4),
      amplitude: 0.26,
      seed: 5 + ctx.index * 0.7,
      segments: pickQ(ctx, 28, 48, 72),
      square: sq,
    });
    const heart = puck(w * 0.78, h * 0.4, d * 0.78, {
      wobble: 0.16,
      domed: 0.55,
      radial: pickQ(ctx, 14, 22, 32),
      rings: 2,
      seed: 9.1 + ctx.index * 0.4,
      square: sq,
    });
    roughen(heart, roughAmt(ctx, 0.07), 9, ctx.index * 1.3);
    const geo = mergeSafe([band, heart]);
    if (!geo) return finishLayer(ctx, new THREE.Group());
    fitGeoY(geo, h);
    return finishLayer(ctx, mesh(geo, lettuceMat(ctx.materials)));
  },
};

const pickleChips: FoodDef = {
  id: 'diner.pickle',
  name: 'Pickle Chips',
  glyph: '🥒',
  thickness: 0.26,
  tint: 0x5e8c31,
  tintAlt: 0x9bbf5b,
  build(ctx) {
    const h = safe(ctx.height, 1e-3);
    // Chip diameter tracks the SHORT axis, so on a 0.15 sliver the chips are
    // 7.5mm across instead of poking out either side.
    const chipD = propSize(ctx, 0.5, 0.62);
    const n = coverCount(ctx.width, ctx.depth, chipD, 0.62, pickQ(ctx, 6, 12, 20));
    const radial = pickQ(ctx, 12, 16, 22);
    const geo = scatter(
      n,
      safe(ctx.width),
      safe(ctx.depth),
      (i, rng) => {
        const s = rng.range(0.86, 1.06);
        const chip = puck(chipD * s, h * rng.range(0.86, 1), chipD * s, {
          wobble: 0.1,
          domed: 0.16,
          radial,
          rings: 2,
          seed: 3 + i * 1.7,
          // a chip is small because a chip is small — never a cut cross-section
          square: 0,
        });
        // crinkle cut — the ridge is the whole point of a pickle chip
        roughen(chip, Math.min(h * 0.1, chipD * 0.08), 15, i * 2.9);
        return chip;
      },
      {
        seed: 17 + ctx.index,
        y: 0,
        margin: chipD * 0.38,
        spacing: 0.14,
        randomYaw: true,
        randomTilt: 0.09,
      },
    );
    if (!geo) return finishLayer(ctx, new THREE.Group());
    return finishLayer(ctx, mesh(geo, pickleMat(ctx.materials)));
  },
};

const baconRashers: FoodDef = {
  id: 'diner.bacon',
  name: 'Bacon Rashers',
  glyph: '🥓',
  thickness: 0.28,
  tint: 0x9a3b24,
  tintAlt: 0xf2dcc0,
  build(ctx) {
    const h = safe(ctx.height, 1e-3);
    // Rashers always run along the LONG axis: a 0.15 x 2.4 sliver gets one
    // full-length rasher rather than a row of confetti.
    const geo = rasherRun(ctx.width, ctx.depth, h * 0.3, {
      maxStrips: pickQ(ctx, 2, 3, 4),
      minPitch: 0.17,
      wave: 0.46,
      curl: 0.5,
      seed: 5 + ctx.index * 1.3,
      segments: pickQ(ctx, 8, 12, 18),
    });
    if (!geo) return finishLayer(ctx, new THREE.Group());
    fitGeoY(geo, h);
    return finishLayer(ctx, mesh(geo, baconMat(ctx.materials)));
  },
};

const bottomBun: FoodDef = {
  id: 'diner.bun_heel',
  name: 'Bottom Bun',
  glyph: '🍞',
  thickness: 0.44,
  tint: 0xc98a4b,
  tintAlt: 0xf0dcb4,
  build(ctx) {
    const g = new THREE.Group();
    const h = safe(ctx.height, 1e-3);
    const w = safe(ctx.width);
    const d = safe(ctx.depth);
    const radial = pickQ(ctx, 16, 26, 38);
    const body = puck(w, h, d, {
      wobble: 0.05 + ctx.rng.range(-0.01, 0.01),
      domed: 0.08,
      radial,
      rings: pickQ(ctx, 3, 4, 6),
      seed: 12.3 + ctx.index * 0.53,
    });
    roughen(body, roughAmt(ctx, 0.014), 7, ctx.index * 1.1);
    fitGeoY(body, h);
    g.add(mesh(body, bunMat(ctx.materials)));

    // the pale cut face — this is what makes a heel read as a heel
    const face = puck(w * 0.965, h * 0.22, d * 0.965, {
      wobble: 0.045,
      domed: 0.12,
      radial,
      rings: 2,
      seed: 5.5 + ctx.index * 0.31,
      square: cutSquare(ctx),
    });
    ceilGeo(face, h);
    g.add(mesh(face, bunCrumbMat(ctx.materials)));
    return finishLayer(ctx, g);
  },
};

// ---------------------------------------------------------------------------
// plate & scenery
// ---------------------------------------------------------------------------

const plateThickness = (ctx: FoodBuildCtx): number =>
  ctx.height > 0.02 ? ctx.height : 0.17;

const chromeMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.chrome', { color: 0xc9d0d8, metalness: 0.88, roughness: 0.34 });

function dinerPlate(ctx: FoodBuildCtx): THREE.Object3D {
  const g = new THREE.Group();
  const m = ctx.materials;
  const t = plateThickness(ctx);
  const w = safe(ctx.width, 0.2);
  const d = safe(ctx.depth, 0.2);
  const radial = pickQ(ctx, 24, 40, 60);

  // Built DOWNWARD: the plate occupies y in [-t, 0] so its top face is exactly
  // y = 0 and the tower's first layer lands flush on it.
  const body = puck(w * 0.94, Math.max(t - 0.004, t * 0.5), d * 0.94, {
    wobble: 0.003,
    domed: 0,
    radial,
    rings: 2,
    seed: 1.1,
    // a plate is never cut, so it stays round whatever the footprint does
    square: 0,
  });
  groundGeo(body, -t);
  g.add(
    mesh(
      body,
      m.standard('diner.plateBody', { color: 0xefe8d8, roughness: 0.4 }),
      { cast: false },
    ),
  );

  // off-white melamine face, sitting exactly on y = 0
  // Stops short of the rim tube: coplanar overlap here z-fights into dashes.
  const face = discFace(w * 0.79, d * 0.79, radial);
  g.add(
    mesh(
      face,
      m.standard('diner.plateFace', {
        color: 0xffffff,
        roughness: 0.3,
        map: m.texture('diner.plateGlaze', glazePainter(0xf6f1e4, 0xe6dcc4, 0.4, 0.452), {
          size: 256,
          wrap: THREE.ClampToEdgeWrapping,
        }),
      }),
      { cast: false },
    ),
  );

  // the chrome rim: outer edge exactly on the footprint, crest exactly on y = 0
  const rim = ringTorus(w, d, 0.055, t * 0.46, pickQ(ctx, 6, 8, 10), pickQ(ctx, 24, 40, 64));
  rim.translate(0, -t * 0.46 - 0.03, 0);
  g.add(mesh(rim, chromeMat(m), { cast: false }));
  return g;
}

// ---------------------------------------------------------------------------
// environment — a backyard barbecue
// ---------------------------------------------------------------------------
//
// Golden hour in a suburban yard: a weathered picnic table under the plate, a
// kettle grill smoking gently, a cooler and a folding chair on the mown grass,
// a board fence closing the yard off and a swag of festoon lights over it all.
//
// Framing notes (camera: FOV 46, yaw 45, pitch 0.5 rad, ~11.5 units back):
//   • the picnic table's near corner falls off the bottom of the frame, so the
//     table fills the foreground rather than floating in it;
//   • the fence at 15.5 units lands about a quarter of the way down the
//     screen — a horizon line ABOVE the tower's crown, so it never crowds it;
//   • the grass disc stops at 26 units, by which point its vertex colours have
//     already faded into the palette's haze, so there is no rim to see.
//
// Nothing within 5 units of the origin rises above `tableTopY`; the fence,
// trees and light posts are the only things that do, and they are 13-23 units
// out and desaturated towards the fog.

/** Drop from the table top to the grass. Compressed: a real one would dwarf the plate. */
const YARD_DROP = 2.3;
/** The cloth is the top surface; the planks sit this far under it. */
const CLOTH_LIFT = 0.045;

const yardWoodMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.env.wood', {
    color: 0xffffff,
    roughness: 0.66,
    metalness: 0,
    vertexColors: true,
    // Near-white grain: the plank's hue lives in the vertex colours, so the map
    // only modulates. Tinting both would square the brown into mud.
    map: m.texture(
      'diner.env.plank',
      plankPainter(0xefe6d8, 0x8a6c46, 0xfffaf0, { seed: 12, lines: 46, knots: 3, wear: 0.9 }),
      { size: 256, repeat: [0.55, 1.1] },
    ),
  });

const turfMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.env.turf', {
    color: 0xffffff,
    roughness: 0.97,
    vertexColors: true,
    map: m.texture('diner.env.turf', turfPainter(0xe4e4e4, 0xb0b0b0, 0xffffff, 6), {
      size: 256,
      repeat: [24, 24],
    }),
  });

const clothMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.env.cloth', {
    color: 0xffffff,
    roughness: 0.93,
    map: m.texture('diner.env.gingham', checkerPainter(0xf4ecdb, 0xc4483a, 6), {
      size: 256,
      repeat: [2.2, 1.9],
    }),
  });

const yardPaintMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.env.paint', {
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0.16,
    vertexColors: true,
  });

const yardFarMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.env.far', {
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
    vertexColors: true,
  });

const bulbMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.env.bulb', {
    color: 0xffe9c4,
    roughness: 0.35,
    emissive: 0xffbf6e,
    emissiveIntensity: 1.7,
  });

const smokeMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.env.smoke', {
    color: 0xf6ece0,
    roughness: 1,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
  });

/** The picnic table: plank top, chunky cross-braced A-frames, two benches. */
function picnicTable(batch: PropBatch, topY: number, yardY: number, rng: Rng): void {
  const HALF_X = 4.3;
  const planks = 5;
  const gap = 0.075;
  const plankW = (5.3 - gap * (planks - 1)) / planks;
  const deck = topY - CLOTH_LIFT;

  for (let i = 0; i < planks; i++) {
    const z = -5.3 / 2 + plankW / 2 + i * (plankW + gap);
    // Every board is a slightly different tree.
    const tone = mix(0xc79256, 0x9d6f3c, rng.next() * 0.85);
    batch.slab(HALF_X * 2, 0.19, plankW, tone, { y: deck, z, ceil: true });
  }

  // spine + skirts under the deck
  batch.box(HALF_X * 1.86, 0.2, 0.34, 0x8a6134, { y: deck - 0.29, z: 0 });
  for (const s of [-1, 1]) {
    batch.box(HALF_X * 1.9, 0.18, 0.2, 0x94693a, { y: deck - 0.24, z: s * 2.35 });
  }

  const legTop = deck - 0.24;
  for (const s of [-1, 1]) {
    const x = s * 2.95;
    // splayed A-frame legs
    for (const t of [-1, 1]) {
      batch.strut(
        new THREE.Vector3(x, legTop, t * 0.8),
        new THREE.Vector3(x, yardY + 0.02, t * 3.5),
        0.28,
        0x8b6236,
        true,
      );
    }
    // bench bearer and the little cross tie that makes it an A, not an H
    batch.box(0.24, 0.19, 7.6, 0x7f5930, { y: yardY + 1.05, x });
    batch.box(0.2, 0.16, 2.4, 0x87602f, { y: yardY + 1.72, x });
  }

  // benches
  for (const s of [-1, 1]) {
    batch.slab(8.0, 0.16, 0.98, mix(0xc08a4d, 0xa1723e, rng.next() * 0.7), {
      y: yardY + 1.15,
      z: s * 3.3,
      ground: true,
    });
  }
}

/** Kettle grill: a dome on three legs. That is the whole silhouette. */
function kettleGrill(batch: PropBatch, x: number, z: number, yardY: number, ry: number): void {
  const ENAMEL = 0x2a2d33;
  const STEEL = 0xb9c0c8;
  const hub = yardY + 1.02;

  for (let i = 0; i < 3; i++) {
    const a = ry + (i / 3) * TAU;
    batch.strut(
      new THREE.Vector3(x + Math.sin(a) * 0.3, hub - 0.1, z + Math.cos(a) * 0.3),
      new THREE.Vector3(x + Math.sin(a) * 0.72, yardY + 0.02, z + Math.cos(a) * 0.72),
      0.11,
      STEEL,
    );
  }
  // bowl (a dome, inverted) and lid
  batch.dome(0.84, 0.6, ENAMEL, { x, y: hub, z, rx: Math.PI }, 14);
  batch.cyl(0.85, 0.85, 0.07, STEEL, { x, y: hub + 0.03, z }, 16);
  batch.dome(0.85, 0.6, ENAMEL, { x, y: hub + 0.06, z }, 14);
  batch.cyl(0.17, 0.2, 0.09, STEEL, { x, y: hub + 0.68, z }, 8);
  // lid handle
  batch.box(0.5, 0.07, 0.09, 0x33363c, { x, y: hub + 0.78, z, ry });
  // a shelf, so it is not perfectly symmetrical from every yaw
  batch.box(0.72, 0.06, 0.34, 0xa9662e, {
    x: x + Math.sin(ry + 1.6) * 1.0,
    y: hub + 0.02,
    z: z + Math.cos(ry + 1.6) * 1.0,
    ry: ry + 1.6,
  });
}

function coolerBox(batch: PropBatch, x: number, z: number, yardY: number, ry: number): void {
  batch.slab(1.5, 0.82, 0.94, 0x2f6ea8, { x, z, ry, y: yardY, ground: true });
  batch.slab(1.58, 0.18, 1.0, 0xe9eef1, { x, z, ry, y: yardY + 0.82, ground: true });
  batch.box(0.5, 0.05, 0.07, 0xd9dee2, { x, z, ry, y: yardY + 1.05 });
}

function foldingChair(batch: PropBatch, x: number, z: number, yardY: number, ry: number): void {
  const FRAME = 0xb6bcc4;
  const CANVAS = 0xd4502c;
  const seat = yardY + 0.98;
  const cs = Math.sin(ry);
  const cz = Math.cos(ry);
  const at = (dx: number, dz: number, y: number): THREE.Vector3 =>
    new THREE.Vector3(x + dx * cz + dz * cs, y, z - dx * cs + dz * cz);

  for (const s of [-1, 1]) {
    batch.strut(at(s * 0.52, -0.42, seat + 0.06), at(s * 0.52, 0.5, yardY + 0.02), 0.07, FRAME);
    batch.strut(at(s * 0.52, 0.42, seat + 0.06), at(s * 0.52, -0.5, yardY + 0.02), 0.07, FRAME);
    batch.strut(at(s * 0.52, -0.42, seat), at(s * 0.62, -0.62, seat + 1.0), 0.07, FRAME);
  }
  batch.box(1.06, 0.09, 0.94, CANVAS, { x, y: seat + 0.06, z, ry });
  batch.box(1.02, 0.72, 0.09, CANVAS, { x, y: seat + 0.62, z, ry, rx: -0.16 });
  // the back rail sits behind the canvas
  batch.box(1.1, 0.07, 0.07, FRAME, {
    x: x - 0.2 * cs,
    y: seat + 1.0,
    z: z - 0.2 * cz,
    ry,
  });
}

function dinerEnvironment(ctx: EnvBuildCtx): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'diner.backyard';
  const m = ctx.materials;
  const q = ctx.quality;
  const rng = ctx.rng.fork(4177);
  const topY = num(ctx.tableTopY, -0.35);
  const yardY = topY - YARD_DROP;

  // --- ground: mown grass fading into the golden-hour haze -----------------
  const HAZE = 0xf7cba6;
  const turf = new PropBatch();
  // `keep`, not `add`: the disc already carries the radial fade in its vertex
  // colours and a flat tint would wipe it back to one green.
  turf.keep(
    groundDisc(
      24,
      (t, x, z) => {
        // broad patchiness first, then the fade into the haze
        const patch = clamp01(0.5 + fbm2(x * 0.085 + 4.1, z * 0.085 - 2.7, 2) * 0.9);
        const near = mix(0x9dbf5e, 0xb6cb78, patch);
        return t < 0.3 ? near : mix(near, HAZE, clamp01((t - 0.3) / 0.52));
      },
      { segments: pickE(q, 30, 42, 54), rings: pickE(q, 6, 8, 10), relief: 0.09, seed: 3 },
    ),
    { y: yardY },
  );

  const tufts = pickE(q, 22, 46, 76);
  for (let i = 0; i < tufts; i++) {
    const a = rng.range(0, TAU);
    const r = 3.4 + Math.sqrt(rng.next()) * 10.5;
    const h = rng.range(0.26, 0.52);
    turf.add(
      new THREE.ConeGeometry(rng.range(0.15, 0.24), h, 4, 1),
      mix(0x8fae56, 0x789a45, rng.next()),
      { x: Math.sin(a) * r, z: Math.cos(a) * r, y: yardY, ground: true, ry: rng.range(0, TAU) },
    );
  }
  const turfGeo = turf.build();
  if (turfGeo) g.add(mesh(turfGeo, turfMat(m), { cast: false, receive: true }));

  // --- the picnic table ----------------------------------------------------
  const table = new PropBatch();
  picnicTable(table, topY, yardY, rng);
  const tableGeo = table.build();
  if (tableGeo) g.add(mesh(tableGeo, yardWoodMat(m), { cast: false, receive: true }));

  // --- the checked cloth: top face exactly on tableTopY --------------------
  const cloth = clothSheet(5.2, 4.35, {
    segments: pickE(q, 7, 11, 15),
    thickness: 0.05,
    rumple: 0.022,
    edgeDrop: 0.035,
    wander: 0.04,
    seed: 6,
  });
  cloth.rotateY(rng.range(-0.09, 0.09));
  cloth.translate(rng.range(-0.16, 0.16), topY, rng.range(-0.14, 0.14));
  g.add(mesh(cloth, clothMat(m), { cast: false, receive: true }));

  // --- mid-ground props: grill, cooler, chair ------------------------------
  const props = new PropBatch();
  const grillA = -2.38 + rng.range(-0.25, 0.25);
  const grillD = 6.9 + rng.range(-0.35, 0.35);
  const grillX = Math.sin(grillA) * grillD;
  const grillZ = Math.cos(grillA) * grillD;
  kettleGrill(props, grillX, grillZ, yardY, rng.range(0, TAU));

  const coolA = -0.9 + rng.range(-0.2, 0.2);
  const coolD = 6.2 + rng.range(-0.35, 0.35);
  coolerBox(props, Math.sin(coolA) * coolD, Math.cos(coolA) * coolD, yardY, coolA + 1.3);

  if (q !== 'low') {
    const chairA = 1.92 + rng.range(-0.2, 0.2);
    const chairD = 6.6 + rng.range(-0.35, 0.35);
    foldingChair(
      props,
      Math.sin(chairA) * chairD,
      Math.cos(chairA) * chairD,
      yardY,
      chairA + Math.PI + rng.range(-0.4, 0.4),
    );
  }
  const propGeo = props.build();
  if (propGeo) g.add(mesh(propGeo, yardPaintMat(m), { cast: true, receive: true }));

  // --- background: fence line, trees, festoon posts ------------------------
  const far = new PropBatch();
  const FENCE_R = 17.2;
  const boards = pickE(q, 60, 96, 130);
  // Board width follows the count, so the line stays a fence at every tier
  // instead of collapsing into a paddock rail on LOW. The 0.82 leaves a hair
  // gap that keeps a little sky in it and stops it reading as a stockade wall.
  const boardW = ((TAU * FENCE_R) / boards) * 0.82;
  const fenceTone = (t: number): number => mix(mix(0xdcbb8c, 0xb99b6c, t), HAZE, 0.34);
  for (let i = 0; i < boards; i++) {
    const a = (i / boards) * TAU;
    const r = FENCE_R * (1 + rng.signed() * 0.008);
    // every eighth board is a post: taller, thicker, and it breaks the ruler line
    const post = i % 8 === 0;
    far.box(
      post ? boardW * 1.5 : boardW,
      (post ? 2.42 : 2.12) + rng.range(-0.06, 0.12),
      post ? 0.2 : 0.09,
      fenceTone(post ? 0.85 : rng.next()),
      { x: Math.sin(a) * r, z: Math.cos(a) * r, ry: a, y: yardY, ground: true },
    );
  }
  // one rail behind the boards, just proud enough to catch the light
  const railSegs = pickE(q, 18, 26, 34);
  for (let i = 0; i < railSegs; i++) {
    const a0 = (i / railSegs) * TAU;
    const a1 = ((i + 1) / railSegs) * TAU;
    const rr = FENCE_R - 0.14;
    far.strut(
      new THREE.Vector3(Math.sin(a0) * rr, yardY + 1.55, Math.cos(a0) * rr),
      new THREE.Vector3(Math.sin(a1) * rr, yardY + 1.55, Math.cos(a1) * rr),
      0.13,
      mix(0xb08c58, HAZE, 0.38),
      true,
    );
  }

  // shrubs along the fence foot: they break the dead line where boards meet grass
  const shrubs = pickE(q, 9, 15, 22);
  for (let i = 0; i < shrubs; i++) {
    const a = (i / shrubs) * TAU + rng.range(-0.22, 0.22);
    const d = FENCE_R - rng.range(0.5, 1.9);
    const w = rng.range(0.75, 1.5);
    far.dome(
      w,
      w * rng.range(0.55, 0.85),
      mix(mix(0x6f9a44, 0x8bab52, rng.next()), HAZE, 0.3),
      { x: Math.sin(a) * d, z: Math.cos(a) * d, y: yardY },
      q === 'low' ? 6 : 9,
    );
  }

  const trees = pickE(q, 5, 7, 9);
  for (let i = 0; i < trees; i++) {
    const a = (i / trees) * TAU + rng.range(-0.35, 0.35);
    const d = 20.0 + rng.range(-1.6, 3.2);
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const trunkH = 1.75 + rng.range(-0.25, 0.5);
    const spread = 1.8 + rng.range(-0.3, 0.7);
    far.cyl(0.16, 0.26, trunkH, mix(0x8a6540, HAZE, 0.42), { x, z, y: yardY, ground: true }, 6);
    const lobes = q === 'low' ? 1 : 3;
    for (let k = 0; k < lobes; k++) {
      const ox = k === 0 ? 0 : rng.range(-0.7, 0.7);
      const oz = k === 0 ? 0 : rng.range(-0.7, 0.7);
      far.ball(spread * (k === 0 ? 1 : rng.range(0.6, 0.82)), mix(0x7ba24c, HAZE, 0.42), {
        x: x + ox,
        z: z + oz,
        y: yardY + trunkH + spread * 0.72 + rng.range(-0.25, 0.3),
      }, q === 'low' ? 6 : 8);
    }
  }

  // festoon lights: four posts, four swags, so a swag crosses every yaw
  const bulbs = new PropBatch();
  if (q !== 'low') {
    const POST_R = 13.2;
    const POST_H = 4.2;
    const posts: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) {
      const a = 0.62 + (i / 4) * TAU;
      const x = Math.sin(a) * POST_R;
      const z = Math.cos(a) * POST_R;
      far.box(0.18, POST_H, 0.18, mix(0x9a7546, HAZE, 0.4), { x, z, y: yardY, ground: true });
      posts.push(new THREE.Vector3(x, yardY + POST_H - 0.1, z));
    }
    for (let i = 0; i < 4; i++) {
      const pts = catenary(posts[i], posts[(i + 1) % 4], 1.05, pickE(q, 5, 7, 9));
      for (let k = 0; k < pts.length - 1; k++) {
        far.strut(pts[k], pts[k + 1], 0.05, 0x4a4038);
        if (k > 0) bulbs.add(new THREE.SphereGeometry(0.11, 6, 4), 0xffffff, {
          x: pts[k].x,
          y: pts[k].y - 0.12,
          z: pts[k].z,
        });
      }
    }
  }
  const farGeo = far.build();
  if (farGeo) g.add(mesh(farGeo, yardFarMat(m), { cast: false, receive: false }));
  const bulbGeo = bulbs.build();
  if (bulbGeo) g.add(mesh(bulbGeo, bulbMat(m), { cast: false, receive: false }));

  // --- a wisp of charcoal smoke -------------------------------------------
  if (q !== 'low') {
    const puffs = new PropBatch();
    const n = q === 'high' ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      puffs.ball(0.3 + t * 0.55, 0xffffff, {
        x: grillX + Math.sin(t * 4.1 + 1.2) * (0.25 + t * 0.75),
        y: yardY + 1.95 + t * 1.7,
        z: grillZ + Math.cos(t * 3.3) * (0.2 + t * 0.6),
      }, 7);
    }
    const smokeGeo = puffs.build();
    if (smokeGeo) g.add(mesh(smokeGeo, smokeMat(m), { cast: false, receive: false }));
  }

  return g;
}

// ---------------------------------------------------------------------------
// theme
// ---------------------------------------------------------------------------

export const dinerTheme: ThemeDef = {
  id: 'diner',
  name: 'Classic Diner',
  tagline: 'Burgers, syrup, the cozy default.',
  glyph: '🍔',
  price: 0,
  palette: {
    bgTop: 0xffe7c4,
    bgBottom: 0xe07a5f,
    fog: 0xf2b48c,
    fogDensity: 0.014,
    key: 0xfff1dc,
    keyIntensity: 2.6,
    fill: 0x8fb8de,
    fillIntensity: 0.6,
    rim: 0xffd9a0,
    rimIntensity: 1.4,
    ground: 0xb4523c,
    accent: 0xe23e57,
    accentSoft: 0xffb4a2,
    bloomStrength: 0.42,
    exposure: 1.06,
    vignette: 0.35,
  },
  foods: [
    bunCrown,
    beefPatty,
    cheddarSlice,
    tomatoRound,
    lettuceRuffle,
    pickleChips,
    baconRashers,
    bottomBun,
  ],
  hero: [7, 1, 2, 3, 4, 0],
  plate: dinerPlate,
  environment: dinerEnvironment,
  ambience: 'diner',
};
