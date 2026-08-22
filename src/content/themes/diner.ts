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
import { SKY_PRESETS } from '../../render/palette';
import type { Rng } from '../../core/rng';
import { TAU, clamp, clamp01 } from '../../core/math';
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
  frameRule,
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
  prismGeo,
  PropBatch,
  propSize,
  rasherRun,
  ringTorus,
  roughAmt,
  safe,
  skyCap,
  specklePainter,
  tintEach,
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
// environment — a backyard barbecue, golden hour
// ---------------------------------------------------------------------------
//
// The note that drove this pass was "I should see the sky in the BBQ
// backyard", and the arithmetic explains why you could not.
//
// The rig frames portrait at FOV 46, pitch 0.5 rad, ~11.5 units back, so the
// camera floats 5.5 units above the tower top and the TOP of the frame looks
// 4.55 degrees BELOW the horizon. The true horizon is off-screen. Everything
// you can ever see is a wedge between that line and the ground, which means
// the sky in shot is not "up there" — it is the narrow band between the top of
// the frame and whatever the furthest object's silhouette reaches. Trees at
// r 20 whose crowns stood 4.8 units off the lawn filled that band completely.
// They were not blocking a view of the sky; they WERE the sky.
//
// So the composition is now built against a skyline instead of against a
// clearance radius: `skyCap(r)` returns the highest a prop at radius r may
// reach before it crosses the line, and every distant piece is clamped through
// it. The fence came down from 2.12 to 1.6 and the crowns from 4.8 to ~3.2,
// which opened roughly a fifth of the frame — and then the middle distance
// went INTO that band, hazed, so it reads as depth rather than as emptiness:
//
//   yard (0-9)    table, grill, cooler, chair, hose reel, bird bath, stones
//   fence (16.4)  low pickets with real gaps, a gate, a hedge run
//   near trees    r 19-23, three of them, crowns clamped to the skyline
//   neighbourhood r 19-27: a treeline at two depths, rooflines, a shed, wires
//   ground rim    r 30, where the lawn runs out of colour before it runs out
//                 of geometry
//   sky           everything above, and now there is some
//
// The clearance cylinder still holds — nothing within 4.6 units rises above
// the table plane, nothing between 4.6 and 9.5 tops `tableTopY + 1.5` — but on
// its own it was never the binding constraint out here. Distance is.

/** Drop from the table top to the grass. Compressed: a real one would dwarf the plate. */
const YARD_DROP = 2.3;
/** The cloth is the top surface; the planks sit this far under it. */
const CLOTH_LIFT = 0.045;
/**
 * Everything far away fades toward this — and it is the sky preset's OWN
 * `horizonColor`, not a hand-picked near-match, so the yard and the sky's haze
 * band can never drift apart as the preset is tuned.
 *
 * Sharing the value is necessary and, on its own, not enough: a LIT ground
 * plane tinted to exactly this still came out a few percent off the unlit
 * backdrop, and at the old 36-unit rim that few percent was a ruled peach line
 * across the top of the yard. The apron therefore overshoots PAST this into
 * near-white before it ends. See the apron's own note.
 */
const HAZE = SKY_PRESETS.diner.horizonColor;
/** The play/home yaw the game opens on; props are placed relative to it. */
const CAM_BEARING = Math.PI / 4;

// --- the sun ---------------------------------------------------------------
//
// Read straight off the sky preset rather than authored twice. The render
// side pins every sun to the light rig's own azimuth, so a shadow baked from
// `DINER_SKY` can never end up falling the opposite way from the glow — and
// the elevation (0.2 rad, a hand's width above the fence) is what makes this
// golden hour rather than mid-afternoon. The real-time shadow map is a 5-unit
// box around the tower and never reaches the grass, so every shadow you can
// see on the lawn is painted here, at exactly this angle.
const DINER_SKY = SKY_PRESETS.diner;
/** Unit XZ direction a shadow runs in: directly away from the sun. */
const SHADOW_X = -Math.sin(DINER_SKY.sunAzimuth);
const SHADOW_Z = -Math.cos(DINER_SKY.sunAzimuth);
/**
 * Shadow length per unit of caster height. A 0.2 rad sun throws a shadow five
 * times the caster's height, which is right and also enormous, so the streak
 * is capped before it crosses the whole yard.
 */
const SHADOW_LEN = 1 / Math.tan(Math.max(DINER_SKY.sunElevation, 0.08));
const SHADOW_MAX = 9.5;

// --- the skyline, and hidden-or-clear ---------------------------------------
//
// Both live in shared-savory now: `skyCap` keeps a strip of sky along the top
// of the frame, and `frameRule` answers the other half of the bible's "the
// cylinder is necessary, not sufficient" note — whether a prop's FEET will be
// visible when the home turntable carries it directly behind the tower. See
// the block above `frameRule` for why the middle state is a bug and this file
// is where it shipped.

/** Total height of the six `hero` foods: the tower the turntable orbits. */
const HERO_H =
  bottomBun.thickness +
  beefPatty.thickness +
  cheddarSlice.thickness +
  tomatoRound.thickness +
  lettuceRuffle.thickness +
  bunCrown.thickness;
const FRAME = frameRule(HERO_H);

/** A caster whose shadow is painted into the lawn's vertex colours. */
interface Caster {
  x: number;
  z: number;
  /** Plan radius of the thing casting. */
  r: number;
  /** Height above the grass. */
  h: number;
}

/**
 * Soft, long, raking shadows baked straight into the turf.
 *
 * The real shadow map is a 5-unit box around the tower — correct, because that
 * is where the food is — so the lawn would otherwise be lit perfectly flat at
 * the exact hour when a lawn is nothing BUT shadows. Each caster projects a
 * capsule down the sun's own bearing, widening and fading as it goes.
 */
function bakedShade(casters: readonly Caster[], x: number, z: number): number {
  let s = 0;
  for (let i = 0; i < casters.length; i++) {
    const c = casters[i];
    const len = clamp(c.h * SHADOW_LEN, 1e-3, SHADOW_MAX);
    const dx = x - c.x;
    const dz = z - c.z;
    const t = clamp(dx * SHADOW_X + dz * SHADOW_Z, 0, len);
    const across = Math.hypot(dx - t * SHADOW_X, dz - t * SHADOW_Z);
    const width = c.r + 0.3 + t * 0.17;
    const near = clamp01(1 - across / width);
    const along = 1 - Math.pow(clamp01(t / len), 1.4);
    s = Math.max(s, near * near * (0.28 + 0.72 * along));
  }
  return clamp01(s);
}

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
    opacity: 0.11,
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
  const ENAMEL = 0x2c3037;
  const STEEL = 0xc3cad2;
  const hub = yardY + 1.12;

  // Three legs, splayed: at 120px this reads "grill" only if the gap between
  // the ground and the bowl is real, so the legs are long and thin.
  for (let i = 0; i < 3; i++) {
    const a = ry + (i / 3) * TAU;
    batch.strut(
      new THREE.Vector3(x + Math.sin(a) * 0.34, hub - 0.12, z + Math.cos(a) * 0.34),
      new THREE.Vector3(x + Math.sin(a) * 0.88, yardY + 0.02, z + Math.cos(a) * 0.88),
      0.12,
      STEEL,
    );
  }
  // bowl (a dome, inverted) and lid
  batch.dome(0.88, 0.64, ENAMEL, { x, y: hub, z, rx: Math.PI }, 14);
  batch.cyl(0.89, 0.89, 0.08, STEEL, { x, y: hub + 0.035, z }, 16);
  batch.dome(0.89, 0.66, ENAMEL, { x, y: hub + 0.07, z }, 14);
  batch.cyl(0.17, 0.21, 0.1, STEEL, { x, y: hub + 0.74, z }, 8);
  // lid handle, held clear of the dome on two little posts
  batch.box(0.56, 0.08, 0.1, 0x3a3e45, { x, y: hub + 0.88, z, ry });
  for (const s of [-1, 1]) {
    batch.box(0.07, 0.12, 0.07, 0x3a3e45, {
      x: x + Math.sin(ry) * s * 0.24,
      y: hub + 0.8,
      z: z + Math.cos(ry) * s * 0.24,
    });
  }
  // side shelf + a slumped sack of charcoal: breaks the symmetry at every yaw
  batch.box(0.8, 0.07, 0.38, 0xb06c2f, {
    x: x + Math.sin(ry + 1.6) * 1.12,
    y: hub + 0.02,
    z: z + Math.cos(ry + 1.6) * 1.12,
    ry: ry + 1.6,
  });
  batch.slab(0.66, 0.48, 0.42, 0x8a7c68, {
    x: x + Math.sin(ry - 1.9) * 0.95,
    y: yardY,
    z: z + Math.cos(ry - 1.9) * 0.95,
    ry: ry - 1.9,
    rz: 0.14,
    ground: true,
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

/**
 * A hose reel abandoned on the grass: a drum on a low frame with three coils
 * of green hose on it and a loose tail running off into the lawn. Reads at
 * 120px purely from the coil stack, so the coils are proud of the drum.
 */
function hoseReel(batch: PropBatch, x: number, z: number, yardY: number, ry: number): void {
  const FRAME = 0x3f6f4a;
  const HOSE = 0x2f7d46;
  const hub = yardY + 0.46;
  for (const s of [-1, 1]) {
    batch.box(0.09, 0.5, 0.09, FRAME, {
      x: x + Math.sin(ry + Math.PI / 2) * s * 0.36,
      z: z + Math.cos(ry + Math.PI / 2) * s * 0.36,
      y: yardY,
      ground: true,
    });
  }
  batch.cyl(0.19, 0.19, 0.66, FRAME, { x, y: hub, z, ry, rz: Math.PI / 2 }, 10);
  for (let i = 0; i < 3; i++) {
    batch.add(
      new THREE.TorusGeometry(0.3 - i * 0.045, 0.075, 5, 12).rotateY(ry + Math.PI / 2),
      mix(HOSE, 0x1f5c33, i * 0.22),
      { x, y: hub, z },
    );
  }
  // the tail, snaking away — the thing that says "someone was watering"
  let px = x + Math.sin(ry) * 0.3;
  let pz = z + Math.cos(ry) * 0.3;
  let a = ry;
  for (let i = 0; i < 4; i++) {
    a += (i % 2 === 0 ? 0.7 : -0.85);
    const nx = px + Math.sin(a) * 0.62;
    const nz = pz + Math.cos(a) * 0.62;
    batch.strut(
      new THREE.Vector3(px, yardY + 0.07, pz),
      new THREE.Vector3(nx, yardY + 0.07, nz),
      0.11,
      HOSE,
    );
    px = nx;
    pz = nz;
  }
}

/** A bird bath: a pedestal, a fluted foot and a shallow dish with a lip. */
function birdBath(batch: PropBatch, x: number, z: number, yardY: number): void {
  const STONE = 0xd6cfc0;
  batch.cyl(0.34, 0.46, 0.14, mix(STONE, 0x9d9789, 0.3), { x, z, y: yardY, ground: true }, 10);
  batch.cyl(0.18, 0.26, 0.92, STONE, { x, z, y: yardY + 0.14, ground: true }, 10);
  batch.cyl(0.62, 0.3, 0.16, mix(STONE, 0xfff6e6, 0.25), { x, z, y: yardY + 1.06, ground: true }, 14);
  batch.add(
    new THREE.TorusGeometry(0.58, 0.055, 5, 16),
    mix(STONE, 0xfff6e6, 0.4),
    { x, z, y: yardY + 1.23 },
  );
  // the water: a disc a shade cooler than the stone, catching the sky
  batch.cyl(0.55, 0.55, 0.03, 0xb9d3dd, { x, z, y: yardY + 1.2 }, 14);
}

/** A scuffed play ball, half-sunk in the grass. */
function gardenBall(batch: PropBatch, x: number, z: number, yardY: number, rng: Rng): void {
  const r = 0.3;
  batch.ball(r, 0xe8e2d4, { x, z, y: yardY + r * 0.82 }, 12);
  for (let i = 0; i < 3; i++) {
    const a = rng.range(0, TAU);
    const t = rng.range(0.3, 1.1);
    batch.add(
      new THREE.SphereGeometry(r * 0.34, 6, 4),
      0x2f3540,
      {
        x: x + Math.sin(a) * Math.sin(t) * r * 0.86,
        y: yardY + r * 0.82 + Math.cos(t) * r * 0.86,
        z: z + Math.cos(a) * Math.sin(t) * r * 0.86,
      },
    );
  }
}

/**
 * A wandering path of stepping stones. Deliberately uneven in spacing, size
 * and angle: evenly spaced stones read as a paving pattern, not as a path
 * somebody wore into a lawn.
 */
function steppingStones(
  batch: PropBatch,
  rng: Rng,
  yardY: number,
  bearing: number,
  fromR: number,
  toR: number,
  count: number,
): void {
  let r = fromR;
  let drift = 0;
  for (let i = 0; i < count && r < toR; i++) {
    drift += rng.range(-0.42, 0.42);
    const a = bearing + drift * 0.075;
    const w = rng.range(0.52, 0.78);
    batch.cyl(w * 0.5, w * 0.46, 0.11, mix(0xcfc7b6, 0xa79f90, rng.next()), {
      x: Math.sin(a) * r + drift * 0.2,
      z: Math.cos(a) * r + drift * 0.2,
      y: yardY + 0.02,
      ry: rng.range(0, TAU),
      rz: rng.range(-0.03, 0.03),
      ground: true,
    }, 9);
    r += rng.range(0.95, 1.5);
  }
}

/**
 * A neighbour's house, seen over the fence: a body, a gable roof and a
 * chimney, hazed hard toward the sky. It is only ever twenty pixels tall, so
 * everything about it is silhouette — the ridge line and the chimney are the
 * only two features that survive, and both are free.
 */
function neighbourHouse(
  far: PropBatch,
  x: number,
  z: number,
  base: number,
  ry: number,
  rng: Rng,
  haze: number,
): void {
  const wall = mix(mix(0xe6cfae, 0xd0b48f, rng.next()), HAZE, haze);
  const roof = mix(mix(0x9c6a55, 0x7f5747, rng.next()), HAZE, haze * 0.86);
  // Small, because the band they live in is four degrees tall. A roof that
  // filled it stopped being a neighbour's house and became a shape.
  const w = rng.range(2.7, 4.1);
  const d = rng.range(2.1, 3.1);
  const bodyH = rng.range(0.9, 1.3);
  const roofH = rng.range(0.68, 1.0);
  far.box(w, bodyH, d, wall, { x, z, ry, y: base, ground: true });
  far.add(prismGeo(w * 1.06, roofH, d * 1.1), roof, { x, z, ry, y: base + bodyH });
  far.box(0.28, rng.range(0.5, 0.8), 0.28, mix(roof, 0x6d4a3c, 0.3), {
    x: x + Math.sin(ry + 1.2) * w * 0.24,
    z: z + Math.cos(ry + 1.2) * w * 0.24,
    ry,
    y: base + bodyH + roofH * 0.45,
    ground: true,
  });
}

/**
 * Poles and wires. Three poles in a line down one side of the yard, not a ring
 * — a power line that circled the garden would read as a circus tent. The
 * wires are square struts because a 5-sided cylinder at 35 units is four
 * wasted triangles a wire's worth of pixels will never show.
 */
function powerLine(
  far: PropBatch,
  yardY: number,
  bearing: number,
  radius: number,
  rng: Rng,
  spans: number,
): void {
  const tone = mix(0x6f5a48, HAZE, 0.5);
  const wireTone = mix(0x4a4038, HAZE, 0.42);
  const tops: THREE.Vector3[] = [];
  for (let i = 0; i <= spans; i++) {
    const a = bearing + (i - spans / 2) * 0.62;
    const r = radius + rng.range(-1.1, 1.1);
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const top = Math.min(yardY + 3.05 + rng.range(-0.15, 0.15), skyCap(r) + 0.14);
    far.cyl(0.1, 0.15, top - yardY, tone, { x, z, y: yardY, ground: true }, 5);
    far.box(1.5, 0.11, 0.13, tone, { x, z, ry: a + Math.PI / 2, y: top - 0.24 });
    tops.push(new THREE.Vector3(x, top - 0.2, z));
  }
  for (let i = 0; i < tops.length - 1; i++) {
    for (const s of [-1, 1]) {
      const off = new THREE.Vector3(
        Math.sin(bearing + Math.PI / 2) * s * 0.6,
        0,
        Math.cos(bearing + Math.PI / 2) * s * 0.6,
      );
      const a = tops[i].clone().add(off);
      const b = tops[i + 1].clone().add(off);
      const pts = catenary(a, b, 0.55, 4);
      for (let k = 0; k < pts.length - 1; k++) {
        far.strut(pts[k], pts[k + 1], 0.075, wireTone, true);
      }
    }
  }
}

function dinerEnvironment(ctx: EnvBuildCtx): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'diner.backyard';
  const m = ctx.materials;
  const q = ctx.quality;
  const rng = ctx.rng.fork(4177);
  const topY = num(ctx.tableTopY, -0.35);
  const yardY = topY - YARD_DROP;

  // Bearings are measured from the camera's own opening yaw, not from world
  // north, because that is what decides whether a prop is behind the tower or
  // off the edge of a 22-degree-wide portrait frame. The four bearings the
  // orbit parks on are `theta` = pi (opening), pi/2 and -pi/2 (the two yaws
  // that used to be dead) and 0 (behind the camera at the start).
  const atBearing = (theta: number, d: number): [number, number] => {
    const a = CAM_BEARING + theta;
    return [Math.sin(a) * d, Math.cos(a) * d];
  };

  // --- yard props, placed first: the lawn needs their shadows ---------------
  /**
   * Ceiling on the height of an ISOLATED prop standing at distance `d`.
   *
   * Past `clearRadius` the prop's feet are above the tower's apex and it may
   * be any height the skyline allows; inside it, the prop has to fit entirely
   * behind the tower or it spends part of the orbit with its feet hidden and
   * its head showing. Continuous rings — the fence, the hedge run, the
   * treeline — are exempt: the eye joins them up with the parts either side,
   * which is the whole reason an isolated object is the one that floats.
   */
  const grounded = (d: number): number =>
    d >= FRAME.clearRadius(yardY) ? Infinity : FRAME.hiddenCap(d, yardY);

  const props = new PropBatch();
  // Radii are set by `hiddenCap` (see above), not by taste: every one of these
  // is an isolated object with legs, and every one of them passes behind the
  // tower once per turn of the home screen. All six sit inside the HIDDEN
  // band, so the moment their feet would disappear is the moment the rest of
  // them does too.
  //
  //   grill  h 1.98  r 6.8  cap 2.25      chair h 1.98  r 6.9  cap 2.21
  //   cooler h 1.00  r 8.6  cap 1.49      bath  h 1.29  r 8.4  cap 1.58
  //   ball   h 0.60  r 6.4  cap 2.31      hose  h 0.55  r 8.2  cap 1.66
  //
  // The grill is the one that has to survive a RUN as well, because it is the
  // only prop near the opening bearing — so it is pushed 0.44 rad off it, far
  // enough that the tower never touches it at any tower height and the grass
  // under its legs is always in shot.
  const [grillX, grillZ] = atBearing(Math.PI - 0.44 + rng.range(-0.04, 0.04), 6.8);
  const [coolX, coolZ] = atBearing(0.55 + rng.range(-0.06, 0.06), 8.6);
  const [chairX, chairZ] = atBearing(-Math.PI / 2 + rng.range(-0.1, 0.1), 6.9);
  const [hoseX, hoseZ] = atBearing(0.34, 8.2);
  const [bathX, bathZ] = atBearing(Math.PI / 2 + 0.12, 8.4);
  const [ballX, ballZ] = atBearing(Math.PI - 1.05, 6.4);

  kettleGrill(props, grillX, grillZ, yardY, Math.atan2(grillX, grillZ) + Math.PI + 0.5);
  coolerBox(props, coolX, coolZ, yardY, Math.atan2(coolX, coolZ) + 1.25);
  foldingChair(props, chairX, chairZ, yardY, Math.atan2(chairX, chairZ) + Math.PI + 0.4);
  birdBath(props, bathX, bathZ, yardY);
  gardenBall(props, ballX, ballZ, yardY, rng);
  // The path and the reel run at every tier. They are the two things that
  // stop the stretch between the table and the fence — which the camera looks
  // straight down at, at every yaw — from being an empty green field, and a
  // low-tier frame that is composed differently is a different scene, not a
  // cheaper one.
  steppingStones(props, rng, yardY, CAM_BEARING + Math.PI / 2 + 0.1, 4.8, 11.4, pickE(q, 5, 7, 8));
  hoseReel(props, hoseX, hoseZ, yardY, Math.atan2(hoseX, hoseZ) + 0.9);

  const casters: Caster[] = [
    // the table itself, which at this hour throws the longest shadow in the yard
    { x: 0, z: 0, r: 3.1, h: YARD_DROP },
    { x: grillX, z: grillZ, r: 0.95, h: 1.98 },
    { x: coolX, z: coolZ, r: 0.85, h: 1.0 },
    { x: chairX, z: chairZ, r: 0.7, h: 1.98 },
    { x: bathX, z: bathZ, r: 0.6, h: 1.29 },
    { x: hoseX, z: hoseZ, r: 0.45, h: 0.55 },
    { x: ballX, z: ballZ, r: 0.3, h: 0.6 },
  ];

  // --- ground: mown grass, raked by a low sun ------------------------------
  //
  // Stripes are the cheapest thing in this file and the one that does the most
  // work: turf without them reads as green paint, and with them it reads as a
  // lawn somebody mows. They run parallel to the opening bearing so they
  // converge toward the horizon instead of banding across the frame, and they
  // are a soft sine rather than a hard band because the disc only carries a
  // vertex per 0.9 units out here and a square wave would alias into stripes
  // that crawl as the camera orbits.
  // The lawn is two pieces, and the split is the whole trick.
  //
  // A single disc big enough for a house at r 26 to stand on cannot also carry
  // mower stripes: its rings are evenly spaced in radius, so a 34-unit disc
  // with an affordable ring count samples the stripe pattern about once per
  // period and the bands turn into a crawling moire. So the LAWN is a dense
  // disc out to 21 — every stripe, every shadow, every daisy lives here — and
  // beyond it an APRON of two flat rings carries the ground out to 30 in pure
  // haze. The apron is free, and it is the difference between a distant
  // roofline standing on the ground and hanging in the air.
  //
  // Its rim used to be at 36 and tinted to the sky's own `horizonColor`, on
  // the theory that a shared value cannot seam. It seamed anyway, and hard: a
  // LIT surface tinted exactly the backdrop's colour still comes out a few
  // percent off it, and at 36 the rim lands a third of the way down the sky
  // where there is nothing to hide it — a peach band with a ruled edge across
  // the top of the yard. Two changes: the rim comes in to 30, where the
  // treeline and the rooflines straddle it, and the last third of the apron
  // OVERSHOOTS past the haze into near-white, the same trick the pendant
  // flexes use, so the ground runs out of colour before it runs out of
  // geometry.
  const LAWN_R = 21;
  const APRON_R = 30;
  // Stripe pitch is set by the FRAME, not by the lawn. The visible strip of
  // grass between the table and the fence is only about ten units wide and
  // sits 24 units from the camera, so a 4-unit stripe filled it end to end and
  // read as "the grass is slightly uneven". Two units puts four bands across
  // it, which is when the eye finally calls it mown.
  const stripeW = pickE(q, 1.8, 1.5, 1.3);
  const turf = new PropBatch();
  // `keep`, not `add`: the disc already carries its colour in vertex colours
  // and a flat tint would wipe it back to one green.
  turf.keep(
    groundDisc(
      LAWN_R,
      (t, x, z) => {
        const patch = clamp01(0.5 + fbm2(x * 0.085 + 4.1, z * 0.085 - 2.7, 2) * 0.9);
        // Squared off, not a sine. A mown stripe is a hard edge where the
        // blades were bent the other way, and a smooth gradient of the same
        // amplitude reads as "the grass is a bit uneven" instead of as turf
        // somebody cut. The wave is still soft over about a third of its
        // period, which is what stops it crawling as the camera orbits.
        const wave = Math.sin(
          ((x * Math.cos(CAM_BEARING) - z * Math.sin(CAM_BEARING)) / stripeW) * Math.PI,
        );
        const band = clamp01(0.5 + wave * 1.6);
        let near = mix(0x6f9235, 0xd2e293, band);
        // broad patchiness rides on top of the stripes, never over them
        near = mix(near, mix(0x6c9139, 0xd6e39a, patch), 0.24);
        // the low sun gilds whatever faces it and leaves the rest cooler
        const rake = clamp01(0.5 - (x * SHADOW_X + z * SHADOW_Z) / 26);
        near = mix(near, 0xe2cd72, rake * 0.2);
        // ...and the long shadows are the other half of the same statement
        near = mix(near, 0x4c6852, bakedShade(casters, x, z) * 0.42);
        // Held green until well past the fence foot, and even at the rim it is
        // only HALF hazed. Running the lawn all the way to the haze colour by
        // r 20 turned the whole band above the fence into a desert: the fence
        // is at 16.4 and the eye reads everything past it as one flat pink
        // field. Grass that is still visibly grass at the rim reads instead as
        // the neighbour's garden, which is what it is.
        return mix(near, HAZE, clamp01((t - 0.62) / 0.38) ** 1.2 * 0.5);
      },
      {
        segments: pickE(q, 80, 96, 112),
        rings: pickE(q, 12, 15, 18),
        relief: 0.09,
        seed: 3,
      },
    ),
    { y: yardY },
  );
  {
    const apron = new THREE.RingGeometry(LAWN_R - 0.4, APRON_R, pickE(q, 32, 44, 56), 3);
    apron.rotateX(-Math.PI / 2);
    tintEach(apron, (x, _y, z) => {
      const r = Math.hypot(x, z);
      // Picks up exactly where the lawn's own fade left off (half hazed) and
      // finishes the job over the next nine units, so the two discs read as one
      // continuous field receding rather than as a lawn and a mat.
      const t = clamp01((r - LAWN_R + 0.4) / (APRON_R - LAWN_R + 0.4));
      const far = mix(0x93ad6a, HAZE, 0.5 + 0.5 * t);
      // a little large-scale mottle: hedgerows and field edges, not a wash
      const mottled = mix(
        far,
        HAZE,
        clamp01(0.4 + fbm2(x * 0.05 - 2.2, z * 0.05 + 5.4, 2) * 0.5) * 0.18,
      );
      // ...and then past the haze entirely. The rim has to stop being a colour
      // before it stops being geometry.
      return mix(mottled, 0xfff3e2, clamp01((t - 0.5) / 0.5) ** 1.25 * 0.82);
    });
    turf.keep(apron, { y: yardY - 0.05 });
  }

  // Tufts: flattened domes, not spikes. A mown lawn is lumpy, not bristly, and
  // a 4-sided cone at this size just reads as a stray dark triangle. Clustered
  // rather than scattered, because grass grows longer where the mower missed.
  const clumps = pickE(q, 5, 8, 11);
  for (let c = 0; c < clumps; c++) {
    const ca = rng.range(0, TAU);
    const cr = 3.6 + Math.sqrt(rng.next()) * 11.2;
    const cx = Math.sin(ca) * cr;
    const cz = Math.cos(ca) * cr;
    const n = pickE(q, 3, 4, 4);
    for (let i = 0; i < n; i++) {
      const w = rng.range(0.32, 0.66);
      turf.dome(
        w,
        w * rng.range(0.2, 0.34),
        // Kept within a shade of the lawn: darker tufts read as holes punched
        // in the grass rather than as clumps of it.
        mix(0x93b457, 0xaec86c, rng.next()),
        {
          x: cx + rng.range(-1.5, 1.5),
          z: cz + rng.range(-1.5, 1.5),
          y: yardY,
          ry: rng.range(0, TAU),
        },
        q === 'low' ? 6 : 7,
      );
    }
  }

  // Daisies and dandelions: two triangles each, tilted so they catch the key.
  // A lawn with no white in it is a golf green.
  {
    const patches = pickE(q, 4, 8, 11);
    for (let p = 0; p < patches; p++) {
      const pa = rng.range(0, TAU);
      const pr = 3.8 + Math.sqrt(rng.next()) * 9.5;
      const px = Math.sin(pa) * pr;
      const pz = Math.cos(pa) * pr;
      const gold = rng.bool(0.4);
      for (let i = 0; i < 5; i++) {
        const s = rng.range(0.1, 0.17);
        turf.add(new THREE.PlaneGeometry(s, s), gold ? 0xf5d64e : 0xfaf3e2, {
          x: px + rng.range(-0.75, 0.75),
          z: pz + rng.range(-0.75, 0.75),
          y: yardY + rng.range(0.06, 0.16),
          rx: -Math.PI / 2 + rng.range(-0.5, 0.5),
          ry: rng.range(0, TAU),
        });
      }
    }
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

  const propGeo = props.build();
  if (propGeo) g.add(mesh(propGeo, yardPaintMat(m), { cast: true, receive: true }));

  // --- the fence: a line to look OVER, not a wall --------------------------
  const far = new PropBatch();
  const FENCE_R = 16.4;
  const FENCE_H = 1.6;
  // The gate goes on one of the two yaws that used to carry nothing; the hedge
  // run goes on the other, so a quarter-turn of the orbit never lands on plain
  // pickets twice running.
  const GATE_A = CAM_BEARING - Math.PI / 2;
  const HEDGE_A = CAM_BEARING + Math.PI / 2;
  const arcDelta = (a: number, b: number): number =>
    Math.abs(((a - b + Math.PI * 3) % TAU) - Math.PI);

  // Boards are a FIXED width at every tier — deriving the width from the count
  // turned LOW into a ring of 1.5-unit panels that read as a stockade wall.
  // Only the pitch changes, so the fence is always a fence, just airier.
  const boards = pickE(q, 84, 104, 122);
  const boardW = Math.min(0.5, ((TAU * FENCE_R) / boards) * 0.62);
  const fenceTone = (t: number): number => mix(mix(0xdcbb8c, 0xb99b6c, t), HAZE, 0.3);
  for (let i = 0; i < boards; i++) {
    const a = (i / boards) * TAU;
    if (arcDelta(a, GATE_A) < 0.075) continue;
    // The radius wanders on a slow noise so the boundary is a yard's boundary
    // and not a compass circle.
    const r = FENCE_R + fbm2(Math.cos(a) * 1.6, Math.sin(a) * 1.6, 2) * 0.55;
    const post = i % 9 === 0;
    const h = (post ? FENCE_H + 0.32 : FENCE_H) + rng.range(-0.05, 0.09);
    const w = post ? boardW * 1.6 : boardW;
    const at = { x: Math.sin(a) * r, z: Math.cos(a) * r, ry: a, y: yardY, ground: true };
    far.box(w, h, post ? 0.18 : 0.08, fenceTone(post ? 0.85 : rng.next()), at);
    // a pointed cap: what makes it a picket fence and lets light between
    if (!post) {
      far.cyl(0, w * 0.62, w * 0.66, fenceTone(0.2), {
        ...at,
        ry: a + Math.PI / 4,
        y: yardY + h,
        ground: true,
      }, 4, true);
    }
  }
  // one rail behind the boards, just proud enough to catch the light
  const railSegs = pickE(q, 16, 22, 30);
  for (let i = 0; i < railSegs; i++) {
    const a0 = (i / railSegs) * TAU;
    const a1 = ((i + 1) / railSegs) * TAU;
    if (arcDelta(a0, GATE_A) < 0.1) continue;
    const rr = FENCE_R - 0.14;
    far.strut(
      new THREE.Vector3(Math.sin(a0) * rr, yardY + FENCE_H * 0.66, Math.cos(a0) * rr),
      new THREE.Vector3(Math.sin(a1) * rr, yardY + FENCE_H * 0.66, Math.cos(a1) * rr),
      0.11,
      mix(0xb08c58, HAZE, 0.34),
      true,
    );
  }

  // The gate: two heavier posts with ball caps, a lower leaf between them, and
  // a genuine hole in the boundary. It is the one place the eye is told the
  // yard has an outside, and the sky comes straight through the gap.
  {
    const gr = FENCE_R;
    for (const s of [-1, 1]) {
      const a = GATE_A + s * 0.085;
      const x = Math.sin(a) * gr;
      const z = Math.cos(a) * gr;
      far.box(0.24, FENCE_H + 0.55, 0.24, fenceTone(0.9), { x, z, ry: a, y: yardY, ground: true });
      far.ball(0.15, fenceTone(0.45), { x, z, y: yardY + FENCE_H + 0.62 }, 7);
    }
    for (let i = 0; i < 5; i++) {
      const a = GATE_A + (i / 4 - 0.5) * 0.13;
      far.box(0.16, FENCE_H * 0.78, 0.07, fenceTone(rng.next() * 0.5), {
        x: Math.sin(a) * gr,
        z: Math.cos(a) * gr,
        ry: a,
        y: yardY,
        ground: true,
      });
    }
    for (const h of [0.34, 0.94]) {
      far.box(0.72, 0.11, 0.06, fenceTone(0.6), {
        x: Math.sin(GATE_A) * gr,
        z: Math.cos(GATE_A) * gr,
        ry: GATE_A,
        y: yardY + FENCE_H * h,
      });
    }
  }

  // Shrubs along the fence foot, and a deeper hedge run on the far side: they
  // break the dead line where boards meet grass, and the hedge gives the
  // second quiet yaw a mass of its own.
  const shrubs = pickE(q, 11, 16, 22);
  for (let i = 0; i < shrubs; i++) {
    const a = (i / shrubs) * TAU + rng.range(-0.22, 0.22);
    // Every fourth one wanders out onto the lawn, so no yaw is a bare green
    // band. They stop at 8.6: past that they are inside the floating band
    // (`hiddenCap` 1.49 at 8.6, and the fattest shrub is 1.28 tall), and a
    // shrub with its foot behind the bun is a green blob in mid-air.
    const d = i % 4 === 3 ? rng.range(6.6, 8.6) : FENCE_R - rng.range(0.4, 1.8);
    const w = rng.range(0.75, 1.5);
    far.dome(
      w,
      Math.min(w * rng.range(0.55, 0.85), skyCap(d) - yardY, grounded(d)),
      mix(mix(0x6f9a44, 0x8bab52, rng.next()), HAZE, 0.28),
      { x: Math.sin(a) * d, z: Math.cos(a) * d, y: yardY },
      q === 'low' ? 6 : 8,
    );
  }
  const hedgeLobes = pickE(q, 7, 10, 14);
  for (let i = 0; i < hedgeLobes; i++) {
    const a = HEDGE_A + (i / (hedgeLobes - 1) - 0.5) * 0.72;
    const d = FENCE_R + rng.range(0.9, 1.9);
    const w = rng.range(1.5, 2.3);
    far.dome(
      w,
      Math.min(w * rng.range(0.62, 0.86), skyCap(d) - yardY),
      mix(mix(0x5f8c3d, 0x7ea24a, rng.next()), HAZE, 0.36),
      { x: Math.sin(a) * d, z: Math.cos(a) * d, y: yardY },
      q === 'low' ? 6 : 8,
    );
  }

  // --- the neighbourhood ---------------------------------------------------
  //
  // Three layers between the fence and the sky, each hazed harder than the
  // last. This is the whole reason the fence came down: without it, an open
  // sky reads as a fence standing against a void.

  // near trees: three of them, crowns clamped to the skyline. They used to be
  // the tallest thing in the frame; now they sit just above the fence and act
  // as the anchor the hazier layers recede from.
  const trees = pickE(q, 2, 3, 3);
  for (let i = 0; i < trees; i++) {
    const a = CAM_BEARING + Math.PI * 0.45 + (i / trees) * TAU + rng.range(-0.3, 0.3);
    const d = 20.5 + rng.range(-1.2, 2.6);
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const cap = skyCap(d);
    const spread = 1.35 + rng.range(-0.2, 0.4);
    const trunkH = 1.15 + rng.range(-0.15, 0.35);
    far.cyl(0.15, 0.24, trunkH, mix(0x8a6540, HAZE, 0.4), { x, z, y: yardY, ground: true }, 5);
    const lobes = pickE(q, 2, 2, 3);
    const canopyTone = mix(0x7ba24c, HAZE, 0.4);
    for (let k = 0; k < lobes; k++) {
      const r = spread * (k === 0 ? 1 : rng.range(0.6, 0.82));
      // the crown centre is whatever leaves the crown itself under the skyline
      const cy = Math.min(yardY + trunkH + r * 0.55, cap - r * 0.86);
      far.add(
        new THREE.SphereGeometry(r, q === 'low' ? 7 : 9, q === 'low' ? 4 : 5).scale(1, 0.86, 1),
        mix(canopyTone, 0xffffff, k * 0.07),
        {
          x: x + (k === 0 ? 0 : rng.range(-0.7, 0.7)),
          z: z + (k === 0 ? 0 : rng.range(-0.7, 0.7)),
          y: cy + (k === 0 ? 0 : rng.range(-0.25, 0.15)),
        },
      );
    }
  }

  // rooflines, and a shed of our own tucked against the fence
  //
  // They sit at 22-26, INSIDE the apron rather than past it. A house at 30 was
  // beyond the ground's own rim and hung in the sky with daylight under its
  // footings — the single ugliest thing in the first pass of this scene, and a
  // reminder that a middle distance is only middle if there is ground under it.
  const houses = pickE(q, 5, 6, 7);
  for (let i = 0; i < houses; i++) {
    const a = (i / houses) * TAU + rng.range(-0.26, 0.26) + 0.4;
    const d = 23.5 + rng.range(-1.6, 2.8);
    neighbourHouse(
      far,
      Math.sin(a) * d,
      Math.cos(a) * d,
      // dropped so the ridge lands just under the skyline at its own distance
      Math.min(yardY, skyCap(d) - 1.85),
      a + Math.PI + rng.range(-0.5, 0.5),
      rng,
      0.7 + rng.next() * 0.14,
    );
  }
  {
    const a = GATE_A + 0.55;
    const d = 20.2;
    const base = Math.min(yardY, skyCap(d) - 2.1);
    const shedTone = mix(0xbfa079, HAZE, 0.34);
    far.box(3.0, 1.35, 2.2, shedTone, { x: Math.sin(a) * d, z: Math.cos(a) * d, ry: a, y: base, ground: true });
    far.add(prismGeo(3.2, 0.62, 2.4), mix(0x8f6a55, HAZE, 0.3), {
      x: Math.sin(a) * d,
      z: Math.cos(a) * d,
      ry: a,
      y: base + 1.35,
    });
  }

  // the far treeline: canopy masses only, no trunks. At 25 units a trunk is one
  // pixel wide and all it does is alias, while the overlapping crowns are what
  // actually says "there is a town behind this fence".
  //
  // It runs the whole way round and the lobes deliberately OVERLAP, because a
  // treeline is a continuous silhouette and a ring of separated blobs is a
  // necklace. It also sits at two depths: an inner run just past the fence
  // that the rooflines rise out of, and a hazier outer run behind them.
  // Count and width are set by the ARC each lobe has to cover, not by taste.
  // At 26 lobes the inner run left a seven-unit gap between four-unit crowns
  // and the band read as a string of separate balloons floating over the
  // fence — which is the treeline making exactly the mistake the kettle grill
  // made. Denser, wider, and the outer run pulled in from 25.5 to 23.5 so it
  // cannot project far enough above the inner one to detach from it.
  const lineLobes = pickE(q, 36, 46, 58);
  for (let i = 0; i < lineLobes; i++) {
    const outer = i % 3 === 2;
    const a = (i / lineLobes) * TAU + rng.range(-0.07, 0.07);
    const d = (outer ? 23.5 : 19.4) + rng.range(-0.8, 1.6);
    const r = outer ? rng.range(1.7, 2.5) : rng.range(1.5, 2.2);
    const squash = 0.62;
    // Sat exactly on the ground — centre at half its own squashed height — so
    // the band has a base and a top instead of hovering. The cap only ever
    // pulls it DOWN, never lifts it off the grass.
    const y = Math.min(yardY + r * squash, skyCap(d) - r * squash);
    far.add(
      new THREE.SphereGeometry(r, pickE(q, 7, 8, 9), pickE(q, 4, 4, 5)).scale(1.55, squash, 1.55),
      mix(
        mix(0x6f9450, 0x8aa65f, rng.next()),
        HAZE,
        // Hazed, but still unmistakably GREEN. At 0.72 the outer run turned
        // the colour of the sky and the treeline read as a row of sand dunes.
        (outer ? 0.55 : 0.3) + rng.next() * 0.1,
      ),
      { x: Math.sin(a) * d, z: Math.cos(a) * d, y },
    );
  }

  if (q !== 'low') {
    powerLine(far, yardY, CAM_BEARING + 0.35, 25.5, rng, 2);
  }

  // festoon lights: four posts, four swags, so a swag crosses every yaw
  const bulbs = new PropBatch();
  if (q !== 'low') {
    const POST_R = 13.2;
    const posts: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) {
      // Offset a quarter-bay from the opening bearing so no post ever stands
      // dead behind the tower: at 13.2 a post is past `clearRadius` on the
      // home screen but back inside the floating band once a run is fifteen
      // layers tall, and the swag is not enough on its own to sell its foot.
      const a = CAM_BEARING + Math.PI / 4 + (i / 4) * TAU;
      const x = Math.sin(a) * POST_R;
      const z = Math.cos(a) * POST_R;
      const top = Math.min(yardY + 4.2, skyCap(POST_R));
      far.box(0.18, top - yardY, 0.18, mix(0x9a7546, HAZE, 0.4), { x, z, y: yardY, ground: true });
      posts.push(new THREE.Vector3(x, top - 0.1, z));
    }
    for (let i = 0; i < 4; i++) {
      const pts = catenary(posts[i], posts[(i + 1) % 4], 1.05, pickE(q, 5, 7, 9));
      for (let k = 0; k < pts.length - 1; k++) {
        far.strut(pts[k], pts[k + 1], 0.05, 0x4a4038);
        if (k > 0) {
          bulbs.add(new THREE.SphereGeometry(0.11, 5, 3), 0xffffff, {
            x: pts[k].x,
            y: pts[k].y - 0.12,
            z: pts[k].z,
          });
        }
      }
    }
  }
  const farGeo = far.build();
  if (farGeo) g.add(mesh(farGeo, yardFarMat(m), { cast: false, receive: false }));
  const bulbGeo = bulbs.build();
  if (bulbGeo) g.add(mesh(bulbGeo, bulbMat(m), { cast: false, receive: false }));

  // --- a wisp of charcoal smoke -------------------------------------------
  if (q !== 'low') {
    // A wisp, not a column: few puffs, leaning downwind, each one wider and
    // fainter than the last. Evenly stacked spheres read as a string of beads.
    //
    // Size is the whole game here. The last puff used to reach 1.3 units and
    // the stack read as a thumbprint smeared over the fence rather than as
    // smoke; under a unit it stays a wisp and the grill keeps its silhouette.
    const puffs = new PropBatch();
    const n = q === 'high' ? 4 : 3;
    const lean = rng.range(0, TAU);
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(n - 1, 1);
      const r = 0.26 + t * t * 0.52;
      const drift = t * t * 1.15;
      puffs.add(
        new THREE.SphereGeometry(r, 8, 5).scale(1, 0.72 - t * 0.2, 1),
        0xffffff,
        {
          x: grillX + Math.sin(lean) * drift + Math.sin(t * 5.3) * 0.18,
          y: yardY + 1.98 + t * 1.35,
          z: grillZ + Math.cos(lean) * drift + Math.cos(t * 4.1) * 0.15,
        },
      );
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
    // Golden-hour suburban afternoon: warm low sun on the light rig's own
    // bearing, scattered fair-weather cumulus. The composition above is built
    // to leave this room — see `skyCap`.
    sky: SKY_PRESETS.diner,
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
